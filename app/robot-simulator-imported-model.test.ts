import assert from 'node:assert/strict';
import test from 'node:test';
import { formatModelAdjustmentValue, isSupportedModelFile, modelFileExtension } from './robot-simulator/imported-model.ts';

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
