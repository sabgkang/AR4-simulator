import assert from 'node:assert/strict';
import test from 'node:test';
import { formatModelAdjustmentValue, formatModelOrientationSummary, formatModelPositionSummary, isSupportedModelFile, modelFileExtension } from './robot-simulator/imported-model.ts';

test('recognizes STL and both STEP filename extensions without case sensitivity', () => {
  for (const name of ['part.stl', 'part.STL', 'assembly.step', 'assembly.STEP', 'fixture.stp']) {
    assert.equal(isSupportedModelFile({ name }), true, name);
  }
  assert.equal(isSupportedModelFile({ name: 'part.obj' }), false);
});

test('extracts the final lowercase model file extension', () => {
  assert.equal(modelFileExtension({ name: 'robot.tool.Part.STEP' }), 'step');
  assert.equal(modelFileExtension({ name: 'untitled' }), '');
});

test('formats positions to two decimals and rotations to one decimal', () => {
  assert.equal(formatModelAdjustmentValue('x', 12.345), '12.35');
  assert.equal(formatModelAdjustmentValue('z', -0.004), '-0.00');
  assert.equal(formatModelAdjustmentValue('rx', 12.345), '12.3');
  assert.equal(formatModelAdjustmentValue('rz', -8.88), '-8.9');
});

test('formats selected model position and orientation on separate lines', () => {
  const transform = { x: 12.345, y: -4, z: 0, rx: 10.04, ry: 20.05, rz: -30.06 };
  assert.equal(formatModelPositionSummary(transform), 'X 12.35 Y -4.00 Z 0.00');
  assert.equal(formatModelOrientationSummary(transform), 'θx 10.0° θy 20.1° θz -30.1°');
});
