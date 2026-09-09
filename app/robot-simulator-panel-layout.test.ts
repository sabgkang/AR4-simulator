import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PANEL_VISIBILITY, updatePanelVisibility } from './robot-simulator/panel-layout.ts';

test('PLAN is visible while IMPORT and DEVICE are hidden by default', () => {
  assert.deepEqual(DEFAULT_PANEL_VISIBILITY, {
    import: false,
    plan: true,
    device: false,
    angles: true,
    cartesian: true,
  });
});

test('opening IMPORT does not hide the other panels', () => {
  const next = updatePanelVisibility(DEFAULT_PANEL_VISIBILITY, 'import', true);
  assert.equal(next.import, true);
  assert.equal(next.plan, true);
});

test('opening DEVICE closes PLAN', () => {
  const next = updatePanelVisibility(DEFAULT_PANEL_VISIBILITY, 'device', true);
  assert.equal(next.device, true);
  assert.equal(next.plan, false);
});

test('opening PLAN closes DEVICE', () => {
  const deviceOpen = updatePanelVisibility(DEFAULT_PANEL_VISIBILITY, 'device', true);
  const next = updatePanelVisibility(deviceOpen, 'plan', true);
  assert.equal(next.plan, true);
  assert.equal(next.device, false);
});
