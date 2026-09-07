import type { Dispatch, SetStateAction } from 'react';
import type { PlanCommand, PlanTarget } from './types';

export function TargetDialog({ draft, onChange, onClose, onSave }: {
  draft: PlanTarget;
  onChange: Dispatch<SetStateAction<PlanTarget | null>>;
  onClose: () => void;
  onSave: (target: PlanTarget) => void;
}) {
  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="plan-dialog" role="dialog" aria-modal="true" aria-labelledby="target-dialog-title" onSubmit={(event) => {
      event.preventDefault();
      onSave({ ...draft, name: draft.name.trim() || `Target${draft.id}` });
    }}>
      <header className="settings-header"><h2 id="target-dialog-title">Edit Target</h2><button className="modal-close" type="button" aria-label="Close target editor" onClick={onClose}>×</button></header>
      <div className="plan-dialog-body">
        <label className="plan-dialog-name"><span>Name</span><input aria-label="Target name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
        <div className="plan-dialog-grid">
          {([['x', 'X', 'mm'], ['y', 'Y', 'mm'], ['z', 'Z', 'mm'], ['rx', 'θX', 'deg'], ['ry', 'θY', 'deg'], ['rz', 'θZ', 'deg']] as const).map(([key, label, unit]) => <label key={key}><span>{label}<small>{unit}</small></span><input aria-label={`Target ${label}`} type="number" step="0.1" value={draft.pose[key]} onChange={(event) => onChange({ ...draft, pose: { ...draft.pose, [key]: Number(event.target.value) } })} /></label>)}
        </div>
        <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">Save Target</button></div>
      </div>
    </form>
  </div>;
}
export function CommandDialog({ draft, targets, defaultJoints, onChange, onClose, onSave }: {
  draft: PlanCommand;
  targets: PlanTarget[];
  defaultJoints: number[];
  onChange: Dispatch<SetStateAction<PlanCommand | null>>;
  onClose: () => void;
  onSave: (command: PlanCommand) => void;
}) {
  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="plan-dialog command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-dialog-title" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <header className="settings-header"><h2 id="command-dialog-title">Edit Command</h2><button className="modal-close" type="button" aria-label="Close command editor" onClick={onClose}>×</button></header>
      <div className="plan-dialog-body">
        <div className="command-dialog-grid">
          <label><span>Start Target</span><input aria-label="Start target" value={draft.startTargetId === null ? 'Current position' : targets.find((target) => target.id === draft.startTargetId)?.name ?? 'Missing'} disabled /></label>
          <label><span>End Target</span><select aria-label="End target" value={draft.endTargetId} onChange={(event) => onChange({ ...draft, endTargetId: Number(event.target.value) })}>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
          <label><span>Command</span><select aria-label="Command type" value={draft.type} onChange={(event) => {
            const type = event.target.value as PlanCommand['type'];
            onChange({ ...draft, type, joints: type === 'move_joints' ? draft.joints ?? [...defaultJoints] : draft.joints });
          }}><option value="move_joints">move_joints</option><option value="move_j">move_j</option><option value="move_l">move_l</option></select></label>
          {([['speed', 'Speed'], ['acceleration', 'Acceleration'], ['deceleration', 'Deceleration']] as const).map(([key, label]) => <label key={key}><span>{label}<small>%</small></span><input aria-label={label} type="number" min="1" max="100" step="1" value={draft[key]} onChange={(event) => onChange({ ...draft, [key]: Math.min(100, Math.max(1, Number(event.target.value))) })} /></label>)}
        </div>
        {draft.type === 'move_joints' && <fieldset className="command-joints-grid">
          <legend>Joint angles</legend>
          {Array.from({ length: 9 }, (_, index) => <label key={index}><span>J{index + 1}<small>deg</small></span><input aria-label={`Joint ${index + 1}`} type="number" step="0.1" value={draft.joints?.[index] ?? 0} onChange={(event) => {
            const joints = Array.from({ length: 9 }, (_, jointIndex) => draft.joints?.[jointIndex] ?? 0);
            joints[index] = Number(event.target.value);
            onChange({ ...draft, joints });
          }} /></label>)}
        </fieldset>}
        <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">Save Command</button></div>
      </div>
    </form>
  </div>;
}
