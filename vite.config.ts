import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { appendFile, mkdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import hostingConfig from './.openai/hosting.json';
import { readModelFile, storeModelFile, storeSceneFile } from './app/robot-simulator/scene-storage';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

function browserErrorLogPlugin(): Plugin {
  return {
    name: 'ar4-browser-error-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__client-log', (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
          if (body.length < 64 * 1024) body += chunk;
        });
        request.on('end', () => {
          void (async () => {
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(body) as Record<string, unknown>;
            } catch {
              payload = { type: 'client-error', message: body || 'Unknown browser error' };
            }

            const logDirectory = path.join(process.cwd(), 'logs');
            const logFile = path.join(logDirectory, 'browser-errors.log');
            await mkdir(logDirectory, { recursive: true });
            await appendFile(logFile, `${JSON.stringify({ receivedAt: new Date().toISOString(), ...payload })}\n`, 'utf8');
            response.statusCode = 204;
            response.end();
          })().catch((error: unknown) => {
            console.error('[browser-error-log] Failed to write browser error:', error);
            response.statusCode = 500;
            response.end();
          });
        });
      });
    },
  };
}

function readRequestBytes(request: IncomingMessage, maximumBytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximumBytes) {
        reject(new Error('Request is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
}

function localSceneStoragePlugin(): Plugin {
  return {
    name: 'ar4-local-scene-storage',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname !== '/api/models' && url.pathname !== '/api/scenes') {
          next();
          return;
        }

        void (async () => {
          if (url.pathname === '/api/models' && request.method === 'POST') {
            const encodedFilename = request.headers['x-model-filename'];
            if (typeof encodedFilename !== 'string') {
              sendJson(response, 400, { error: 'A model filename is required.' });
              return;
            }
            const filename = decodeURIComponent(encodedFilename);
            const bytes = await readRequestBytes(request, 1024 * 1024 * 1024);
            const relativePath = await storeModelFile(filename, bytes);
            sendJson(response, 200, { path: relativePath });
            return;
          }

          if (url.pathname === '/api/models' && request.method === 'GET') {
            const relativePath = url.searchParams.get('path');
            if (!relativePath) {
              sendJson(response, 400, { error: 'A model path is required.' });
              return;
            }
            const bytes = await readModelFile(relativePath);
            response.statusCode = 200;
            response.setHeader('Content-Type', path.extname(relativePath).toLowerCase() === '.stl' ? 'model/stl' : 'application/step');
            response.setHeader('Cache-Control', 'no-store');
            response.end(bytes);
            return;
          }

          if (url.pathname === '/api/scenes' && request.method === 'POST') {
            const bytes = await readRequestBytes(request, 10 * 1024 * 1024);
            const payload = JSON.parse(bytes.toString('utf8')) as { filename?: unknown; content?: unknown; overwrite?: unknown };
            if (typeof payload.filename !== 'string' || !payload.filename.trim()) throw new Error('A scene filename is required.');
            if (typeof payload.content !== 'string') throw new Error('Scene content is required.');
            JSON.parse(payload.content);
            const filename = await storeSceneFile(payload.filename, payload.content, payload.overwrite === true);
            sendJson(response, 200, { filename, path: `Scenes/${filename}` });
            return;
          }

          sendJson(response, 405, { error: 'Method not allowed.' });
        })().catch((error: unknown) => {
          const code = (error as NodeJS.ErrnoException).code;
          sendJson(response, code === 'EEXIST' ? 409 : code === 'ENOENT' ? 404 : 400, {
            error: error instanceof Error ? error.message : 'Local scene storage failed.',
          });
        });
      });
    },
  };
}

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/app-router-entry',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      hmr: { overlay: false },
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      browserErrorLogPlugin(),
      localSceneStoragePlugin(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
