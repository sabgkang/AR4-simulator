import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingsFilename, parseSettings, serializeSettings, type SimulatorSettings } from './robot-simulator/settings-file.ts';

const settings: SimulatorSettings = {
  version: 1,
  jointRanges: Array.from({ length: 6 }, () => ({ min: -90, max: 90 })),
  motorSpeeds: [10, 10, 10, 10, 10, 10],
  motion: { speedPercent: 15, accelerationPercent: 10, decelerationPercent: 10 },
  serial: { portName: 'No COM port selected', auxiliaryPortNames: [] },
};

test('settings serialization round-trips valid data', () => {
  assert.deepEqual(parseSettings(JSON.parse(serializeSettings(settings))), settings);
});

test('settings filename uses local date components', () => {
  assert.equal(createSettingsFilename(new Date(2026, 8, 4, 9, 7)), 'ar4_settings_2026_09_04_07.json');
});

test('settings parser rejects invalid percentages and ranges', () => {
  assert.throws(() => parseSettings({ ...settings, motion: { ...settings.motion, speedPercent: 0 } }), /greater than zero/);
  assert.throws(() => parseSettings({ ...settings, motion: { ...settings.motion, speedPercent: 101 } }), /motion percentages/);
  assert.throws(() => parseSettings({ ...settings, jointRanges: [{ min: 10, max: 10 }, ...settings.jointRanges.slice(1)] }), /joint ranges/);
});
