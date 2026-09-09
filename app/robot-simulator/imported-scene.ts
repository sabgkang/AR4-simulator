import { createZeroModelTransform, type ImportedModelInfo, type ModelFileFormat, type ModelTransformKey } from './imported-model.ts';

const TRANSFORM_KEYS: ModelTransformKey[] = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
const MODEL_FORMATS: ModelFileFormat[] = ['stl', 'step', 'stp'];

export interface ImportedSceneModel {
  name: string;
  filename: string;
  format: ModelFileFormat;
  sourcePath: string;
  visible: boolean;
  transform: Record<ModelTransformKey, number>;
}

export interface ImportedSceneFile {
  version: 1;
  robotTransform: Record<ModelTransformKey, number>;
  models: ImportedSceneModel[];
}

export function createImportedSceneFilename(date = new Date()) {
  const values = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ];
  return `ar4-mk4-scene-${values.map((value) => String(value).padStart(2, '0')).join('-')}.json`;
}

export function serializeImportedScene(models: ImportedModelInfo[], robotTransform = createZeroModelTransform()) {
  const scene: ImportedSceneFile = {
    version: 1,
    robotTransform: { ...robotTransform },
    models: models.map(({ name, filename, format, sourcePath, visible, transform }) => ({
      name,
      filename,
      format,
      sourcePath,
      visible,
      transform: { ...transform },
    })),
  };
  return `${JSON.stringify(scene, null, 2)}\n`;
}

export function parseImportedScene(value: unknown): ImportedSceneFile {
  if (!value || typeof value !== 'object') throw new Error('Scene file must be a JSON object.');
  const candidate = value as Partial<ImportedSceneFile>;
  if (candidate.version !== 1) throw new Error('Unsupported scene file version.');
  if (!Array.isArray(candidate.models)) throw new Error('Scene file models must be an array.');

  const parseTransform = (transformValue: unknown, label: string) => {
    if (!transformValue || typeof transformValue !== 'object') throw new Error(`${label} has no transform.`);
    return Object.fromEntries(TRANSFORM_KEYS.map((key) => {
      const coordinate = (transformValue as Partial<Record<ModelTransformKey, unknown>>)[key];
      if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) throw new Error(`${label} has an invalid ${key} value.`);
      return [key, coordinate];
    })) as Record<ModelTransformKey, number>;
  };

  return {
    version: 1,
    robotTransform: candidate.robotTransform === undefined
      ? createZeroModelTransform()
      : parseTransform(candidate.robotTransform, 'Scene robot'),
    models: candidate.models.map((rawModel, index) => {
      if (!rawModel || typeof rawModel !== 'object') throw new Error(`Scene object ${index + 1} is invalid.`);
      const model = rawModel as Partial<ImportedSceneModel>;
      if (typeof model.name !== 'string' || !model.name.trim()) throw new Error(`Scene object ${index + 1} has no name.`);
      if (typeof model.filename !== 'string' || !model.filename.trim()) throw new Error(`Scene object ${index + 1} has no filename.`);
      if (!MODEL_FORMATS.includes(model.format as ModelFileFormat)) throw new Error(`Scene object ${index + 1} has an unsupported format.`);
      if (typeof model.sourcePath !== 'string' || !/^Models\/[^/\\]+\.(stl|step|stp)$/i.test(model.sourcePath)) {
        throw new Error(`Scene object ${index + 1} has an invalid model path.`);
      }
      if (typeof model.visible !== 'boolean') throw new Error(`Scene object ${index + 1} has an invalid visibility value.`);
      const transform = parseTransform(model.transform, `Scene object ${index + 1}`);
      return {
        name: model.name,
        filename: model.filename,
        format: model.format as ModelFileFormat,
        sourcePath: model.sourcePath,
        visible: model.visible,
        transform,
      };
    }),
  };
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === 'string') return payload.error;
  } catch {
    // Use the caller's fallback when the server did not return JSON.
  }
  return fallback;
}

export async function uploadModelFile(file: File) {
  const response = await fetch('/api/models', {
    method: 'POST',
    headers: { 'X-Model-Filename': encodeURIComponent(file.name) },
    body: file,
  });
  if (!response.ok) throw new Error(await responseError(response, 'Could not copy the model into Models/.'));
  const payload = await response.json() as { path?: unknown };
  if (typeof payload.path !== 'string') throw new Error('The model storage response is invalid.');
  return payload.path;
}

export async function sceneModelToFile(model: ImportedSceneModel) {
  const response = await fetch(`/api/models?path=${encodeURIComponent(model.sourcePath)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response, `Could not load ${model.sourcePath}.`));
  return new File([await response.blob()], model.filename, { type: model.format === 'stl' ? 'model/stl' : 'application/step' });
}

export async function saveSceneToProject(filename: string, content: string, overwrite = false) {
  const response = await fetch('/api/scenes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, content, overwrite }),
  });
  const payload = await response.json() as { error?: unknown; filename?: unknown; path?: unknown };
  if (!response.ok) {
    const error = new Error(typeof payload.error === 'string' ? payload.error : 'Could not save the scene.') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (typeof payload.filename !== 'string' || typeof payload.path !== 'string') throw new Error('The scene storage response is invalid.');
  return { filename: payload.filename, path: payload.path };
}
