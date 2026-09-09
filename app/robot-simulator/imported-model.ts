export type ModelTransformKey = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz';

export interface ModelAdjustment {
  key: ModelTransformKey;
  value: number;
  phase: 'dragging' | 'editing';
  cursorX: number;
  cursorY: number;
}

export interface ImportedModelInfo {
  name: string;
  transform: Record<ModelTransformKey, number>;
}

export function isSupportedModelFile(file: Pick<File, 'name'>) {
  return /\.(stl|step|stp)$/i.test(file.name);
}

export function modelFileExtension(file: Pick<File, 'name'>) {
  const dot = file.name.lastIndexOf('.');
  return dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase();
}

export function formatModelAdjustmentValue(key: ModelTransformKey, value: number) {
  return value.toFixed(key.startsWith('r') ? 1 : 2);
}
