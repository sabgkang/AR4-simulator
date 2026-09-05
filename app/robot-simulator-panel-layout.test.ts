import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PANEL_VISIBILITY, updatePanelVisibility } from './robot-simulator/panel-layout.ts';

test('PLAN is visible and DEVICE is hidden by default', () => {
  assert.deepEqual(DEFAULT_PANEL_VISIBILITY, {
    plan: true,
    device: false,
    angles: true,
    cartesian: true,
  });
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
