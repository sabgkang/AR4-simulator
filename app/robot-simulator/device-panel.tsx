import { HiddenIcon } from './icons';

export function DevicePanel({ onHide }: { onHide: () => void }) {
  return <aside className="device-panel">
    <div className="panel-heading">
      <div className="panel-title">
        <button className="panel-visibility-button" type="button" title="Hide DEVICE" aria-label="Hide DEVICE column" onClick={onHide}><HiddenIcon /></button>
        <span className="eyebrow">DEVICE</span>
      </div>
    </div>
    <div className="device-content">
      <output className="device-empty" aria-live="polite">No serial data</output>
    </div>
  </aside>;
}
