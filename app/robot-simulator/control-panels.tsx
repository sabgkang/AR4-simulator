import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { JOINTS, PRESETS } from './config';
import { HiddenIcon } from './icons';
import { JointAngleInput } from './joint-angle-input';
import type { IkTarget, JointRange, Pose, StatusMessage } from './types';

export function AnglesPanel({ angles, jointRanges, displayOnly, onHide, onJointChange, onMove }: {
  angles: Pose;
  jointRanges: JointRange[];
  displayOnly: boolean;
  onHide: () => void;
  onJointChange: (index: number, value: number) => void;
  onMove: (pose: Pose) => void;
}) {
  return <aside className="control-panel">
    <div className="panel-heading"><div className="panel-title"><button className="panel-visibility-button" type="button" title="Hide ANGLES" aria-label="Hide ANGLES column" onClick={onHide}><HiddenIcon /></button><span className="eyebrow">ANGLES</span></div><button className="zero-button" disabled={displayOnly} onClick={() => onMove(PRESETS.Home)}>Zero all</button></div>
    <div className="joint-list">
      {JOINTS.map((joint, index) => {
        const range = jointRanges[index];
        const progress = ((angles[index] - range.min) / (range.max - range.min)) * 100;
        return <div className="joint-control" key={joint.name}>
          <div className="joint-label"><span className="joint-id" style={{ background: joint.accent }}>{joint.name}</span><span><strong>{joint.label}</strong><small>{range.min}° to {range.max}°</small></span><JointAngleInput name={joint.name} value={angles[index]} min={range.min} max={range.max} disabled={displayOnly} onChange={(value) => onJointChange(index, value)} /></div>
          <input aria-label={`${joint.name} ${joint.label}`} type="range" min={range.min} max={range.max} step="1" value={angles[index]} disabled={displayOnly} onChange={(event) => onJointChange(index, Number(event.target.value))} style={{ '--range': `${progress}%`, '--accent': joint.accent } as CSSProperties} />
        </div>;
      })}
    </div>
  </aside>;
}

export function CartesianPanel({ target, message, disabled, displayOnly, onHide, onUseCurrent, onTargetChange, onSubmit }: {
  target: IkTarget;
  message: StatusMessage | null;
  disabled: boolean;
  displayOnly: boolean;
  onHide: () => void;
  onUseCurrent: () => void;
  onTargetChange: Dispatch<SetStateAction<IkTarget>>;
  onSubmit: () => void;
}) {
  return <aside className="ik-panel">
    <div className="panel-heading">
      <div className="panel-title"><button className="panel-visibility-button" type="button" title="Hide CARTESIAN" aria-label="Hide CARTESIAN column" onClick={onHide}><HiddenIcon /></button><span className="eyebrow">CARTESIAN</span></div>
      <button type="button" className="current-pose-button" disabled={displayOnly} onClick={onUseCurrent}>Use TCP</button>
    </div>
    <form className="ik-section" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="ik-grid">
        {([['x', 'X', 'mm'], ['y', 'Y', 'mm'], ['z', 'Z', 'mm'], ['rx', 'θx', 'deg'], ['ry', 'θy', 'deg'], ['rz', 'θz', 'deg']] as const).map(([key, label, unit]) => <label key={key}>
          <span>{label}<small>{unit}</small></span>
          <input aria-label={`${label} (${unit})`} type="number" step="0.1" value={target[key]} disabled={displayOnly} onChange={(event) => onTargetChange((current) => ({ ...current, [key]: event.target.value }))} />
        </label>)}
      </div>
      <button className="solve-button" type="submit" disabled={disabled || displayOnly}>Calculate &amp; move</button>
      {message && <p className={`ik-message ${message.type}`} role="status" aria-live="polite">{message.text}</p>}
    </form>
  </aside>;
}
