import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MODEL_EXTENSIONS = new Set(['.stl', '.step', '.stp']);
const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

function safeStem(filename: string, extension: string, fallback: string) {
  const basename = path.basename(filename);
  const stem = (extension ? basename.slice(0, -extension.length) : basename)
    .replace(INVALID_FILENAME_CHARACTERS, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return (stem || fallback).slice(0, 180);
}

export function normalizeSceneFilename(filename: string) {
  const extension = path.extname(filename).toLowerCase();
  const stem = safeStem(filename, extension, 'ar4-mk4-scene');
  return `${stem}.json`;
}

export async function storeModelFile(filename: string, bytes: Uint8Array, projectRoot = process.cwd()) {
  const extension = path.extname(filename).toLowerCase();
  if (!MODEL_EXTENSIONS.has(extension)) throw new Error('Only STL and STEP files are supported.');
  const stem = safeStem(filename, extension, 'model');
  const directory = path.join(projectRoot, 'Models');
  await mkdir(directory, { recursive: true });
  const incomingHash = createHash('sha256').update(bytes).digest('hex');

  for (let suffix = 1; suffix < 10000; suffix += 1) {
    const storedName = `${stem}${suffix === 1 ? '' : `-${suffix}`}${extension}`;
    const storedPath = path.join(directory, storedName);
    try {
      const existingBytes = await readFile(storedPath);
      const existingHash = createHash('sha256').update(existingBytes).digest('hex');
      if (existingHash === incomingHash) return `Models/${storedName}`;
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await writeFile(storedPath, bytes, { flag: 'wx' });
      return `Models/${storedName}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      suffix -= 1;
    }
  }
  throw new Error('Too many files use the same model name.');
}

export function resolveModelPath(relativePath: string, projectRoot = process.cwd()) {
  if (!/^Models\/[^/\\]+\.(stl|step|stp)$/i.test(relativePath)) throw new Error('Invalid model path.');
  const modelsDirectory = path.resolve(projectRoot, 'Models');
  const resolved = path.resolve(projectRoot, relativePath);
  if (path.dirname(resolved) !== modelsDirectory) throw new Error('Invalid model path.');
  return resolved;
}

export async function readModelFile(relativePath: string, projectRoot = process.cwd()) {
  return readFile(resolveModelPath(relativePath, projectRoot));
}

export async function storeSceneFile(filename: string, content: string, overwrite: boolean, projectRoot = process.cwd()) {
  const storedName = normalizeSceneFilename(filename);
  const directory = path.join(projectRoot, 'Scenes');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, storedName), content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
  return storedName;
}
