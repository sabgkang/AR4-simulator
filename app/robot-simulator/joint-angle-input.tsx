import { useEffect, useRef, useState } from 'react';

export function JointAngleInput({ name, value, min, max, onChange }: {
  name: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const formatAngle = (angle: number) => String(Math.round(angle * 100) / 100);
  const [draft, setDraft] = useState(formatAngle(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(formatAngle(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    onChange(next);
    setDraft(formatAngle(next));
  };

  return <span className="angle-input-wrap">
    <input
      className="angle-input"
      aria-label={`${name} angle in degrees`}
      type="number"
      min={min}
      max={max}
      step="0.01"
      value={draft}
      onFocus={() => { focused.current = true; }}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);
        const parsed = Number(nextDraft);
        if (nextDraft !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
      }}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(formatAngle(value));
          event.currentTarget.blur();
        }
      }}
    />
    <small>°</small>
  </span>;
}
