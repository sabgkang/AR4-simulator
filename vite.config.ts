import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import hostingConfig from './.openai/hosting.json';

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
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
