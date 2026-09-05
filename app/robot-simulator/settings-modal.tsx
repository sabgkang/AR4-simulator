import { useRef, type Dispatch, type SetStateAction } from 'react';
import { DEFAULT_MOTOR_SPEEDS, JOINTS } from './config';
import { DeleteIcon, LoadIcon, PlusIcon, SaveIcon } from './icons';
import type { JointRange, Pose, SettingsCategory, StatusMessage } from './types';

type PercentSetter = Dispatch<SetStateAction<number>>;

export function SettingsModal({ category, jointRanges, motorSpeeds, speedPercent, accelerationPercent, decelerationPercent, serialPortName, auxiliarySerialPortNames, serialMessage, settingsFilename, settingsFileMessage, loadDisabled, onCategoryChange, onClose, onAddAuxiliaryPort, onDeleteAuxiliaryPort, onRequestSerialPort, onJointRangeChange, onMotorSpeedChange, onResetJointRanges, onResetMotorSettings, onSpeedChange, onAccelerationChange, onDecelerationChange, onSaveSettings, onBeginLoad, onLoadSettings }: {
  category: SettingsCategory;
  jointRanges: JointRange[];
  motorSpeeds: Pose;
  speedPercent: number;
  accelerationPercent: number;
  decelerationPercent: number;
  serialPortName: string;
  auxiliarySerialPortNames: string[];
  serialMessage: string | null;
  settingsFilename: string;
  settingsFileMessage: StatusMessage | null;
  loadDisabled: boolean;
  onCategoryChange: (category: SettingsCategory) => void;
  onClose: () => void;
  onAddAuxiliaryPort: () => void;
  onDeleteAuxiliaryPort: (index: number) => void;
  onRequestSerialPort: (index?: number) => Promise<void>;
  onJointRangeChange: (index: number, key: keyof JointRange, value: number) => void;
  onMotorSpeedChange: (index: number, value: number) => void;
  onResetJointRanges: () => void;
  onResetMotorSettings: () => void;
  onSpeedChange: PercentSetter;
  onAccelerationChange: PercentSetter;
  onDecelerationChange: PercentSetter;
  onSaveSettings: () => void;
  onBeginLoad: () => void;
  onLoadSettings: (file: File) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header">
        <div><span className="eyebrow">AR4 STUDIO</span><h2 id="settings-title">Settings</h2></div>
        <button className="modal-close" type="button" aria-label="Close settings" onClick={onClose}>×</button>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings categories">
          <button className={category === 'com' ? 'active' : ''} onClick={() => onCategoryChange('com')}><span>COM</span><small>Serial connection</small></button>
          <button className={category === 'ranges' ? 'active' : ''} onClick={() => onCategoryChange('ranges')}><span>Joint ranges</span><small>Motion limits</small></button>
          <button className={category === 'motors' ? 'active' : ''} onClick={() => onCategoryChange('motors')}><span>Motors</span><small>Speed profile</small></button>
          <div className="settings-file-actions">
            <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onLoadSettings(file);
              event.target.value = '';
            }} />
            <div>
              <button type="button" disabled={loadDisabled} onClick={() => { onBeginLoad(); fileInputRef.current?.click(); }}><LoadIcon />Load</button>
              <button type="button" onClick={onSaveSettings}><SaveIcon />Save</button>
            </div>
            <small className="settings-filename" title={settingsFilename}>{settingsFilename}</small>
            {settingsFileMessage && <small className={`settings-file-message ${settingsFileMessage.type}`} role="status">{settingsFileMessage.text}</small>}
          </div>
        </nav>
        <div className="settings-content">
          {category === 'com' && <div className="settings-page">
            <div className="settings-page-title"><div><h3>COM Ports</h3><p>Select serial ports.</p></div></div>
            <div className="serial-port-list">
              <div className="setting-field serial-field"><span>Robot COM port</span><div className="serial-select-wrap">
                <button className="serial-add-button" type="button" title="Add Auxiliary COM port" aria-label="Add Auxiliary COM port" onClick={onAddAuxiliaryPort}><PlusIcon /></button>
                <button type="button" className="serial-select" onClick={() => { void onRequestSerialPort(); }}><strong>{serialPortName}</strong><i aria-hidden="true">⌄</i></button>
              </div></div>
              {auxiliarySerialPortNames.map((portName, index) => <div className="setting-field serial-field" key={index}><span>Auxiliary COM port {index + 1}</span><div className="serial-select-wrap">
                <button className="serial-delete-button" type="button" title={`Delete Auxiliary COM port ${index + 1}`} aria-label={`Delete Auxiliary COM port ${index + 1}`} onClick={() => onDeleteAuxiliaryPort(index)}><DeleteIcon /></button>
                <button className="serial-add-button" type="button" title={`Add Auxiliary COM port ${auxiliarySerialPortNames.length + 1}`} aria-label={`Add Auxiliary COM port ${auxiliarySerialPortNames.length + 1}`} onClick={onAddAuxiliaryPort}><PlusIcon /></button>
                <button type="button" className="serial-select" onClick={() => { void onRequestSerialPort(index); }}><strong>{portName}</strong><i aria-hidden="true">⌄</i></button>
              </div></div>)}
            </div>
            {serialMessage && <p className="settings-note" role="status">{serialMessage}</p>}
          </div>}

          {category === 'ranges' && <div className="settings-page">
            <div className="settings-page-title"><div><h3>Joint ranges</h3><p>Set the permitted angular travel for each joint.</p></div><button className="default-button" type="button" onClick={onResetJointRanges}>Default</button></div>
            <div className="settings-table range-table"><div className="settings-table-head"><span>Joint</span><span>Minimum</span><span>Maximum</span></div>
              {JOINTS.map((joint, index) => <div className="settings-table-row" key={joint.name}>
                <strong><i style={{ background: joint.accent }} />{joint.name}</strong>
                <label><input aria-label={`${joint.name} minimum range`} type="number" step="0.1" max={jointRanges[index].max} value={jointRanges[index].min} onChange={(event) => onJointRangeChange(index, 'min', Number(event.target.value))} /><small>deg</small></label>
                <label><input aria-label={`${joint.name} maximum range`} type="number" step="0.1" min={jointRanges[index].min} value={jointRanges[index].max} onChange={(event) => onJointRangeChange(index, 'max', Number(event.target.value))} /><small>deg</small></label>
              </div>)}
            </div>
          </div>}

          {category === 'motors' && <div className="settings-page">
            <div className="settings-page-title"><div><h3>Motors</h3><p>Configure joint speed limits and the default motion profile.</p></div><button className="default-button" type="button" onClick={onResetMotorSettings}>Default</button></div>
            <div className="settings-table motor-table"><div className="settings-table-head"><span>Motor</span><span>Maximum speed</span></div>
              {JOINTS.map((joint, index) => <div className="settings-table-row" key={joint.name}>
                <strong><i style={{ background: joint.accent }} />{joint.name}</strong>
                <label><input aria-label={`${joint.name} maximum speed`} type="number" min="0" max={DEFAULT_MOTOR_SPEEDS[index]} step="0.001" value={motorSpeeds[index]} onChange={(event) => onMotorSpeedChange(index, Number(event.target.value))} /><small>deg/s</small></label>
              </div>)}
            </div>
            <div className="profile-settings">
              {([['Speed Percentage %', speedPercent, onSpeedChange, 15, 1], ['Acceleration Percentage %', accelerationPercent, onAccelerationChange, 10, 0], ['Deceleration Percentage %', decelerationPercent, onDecelerationChange, 10, 0]] as const).map(([label, value, setter, defaultValue, minimum]) => <label className="profile-row" key={label}>
                <span><strong>{label}</strong><small>Default {defaultValue}% · Maximum 100%</small></span>
                <span className="percent-input"><input type="number" min={minimum} max="100" step="1" value={value} onChange={(event) => setter(Math.min(100, Math.max(minimum, Number(event.target.value) || minimum)))} /><small>%</small></span>
              </label>)}
            </div>
          </div>}
        </div>
      </div>
    </section>
  </div>;
}
