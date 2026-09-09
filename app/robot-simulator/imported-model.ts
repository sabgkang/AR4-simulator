export type ModelTransformKey = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz';
export type ModelFileFormat = 'stl' | 'step' | 'stp';

export interface ModelAdjustment {
  key: ModelTransformKey;
  value: number;
  phase: 'dragging' | 'editing';
  cursorX: number;
  cursorY: number;
}

export interface ImportedModelInfo {
  id: number;
  name: string;
  filename: string;
  format: ModelFileFormat;
  sourcePath: string;
  visible: boolean;
  transform: Record<ModelTransformKey, number>;
}

export type ImportedModelDraft = Pick<ImportedModelInfo, 'id' | 'name' | 'transform'>;

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

export function formatModelPositionSummary(transform: ImportedModelInfo['transform']) {
  return `X ${transform.x.toFixed(2)} Y ${transform.y.toFixed(2)} Z ${transform.z.toFixed(2)}`;
}

export function formatModelOrientationSummary(transform: ImportedModelInfo['transform']) {
  return `θx ${transform.rx.toFixed(1)}° θy ${transform.ry.toFixed(1)}° θz ${transform.rz.toFixed(1)}°`;
}
