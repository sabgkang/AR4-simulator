import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDisplayNumber } from './robot-simulator/number-format.ts';

test('display numbers use two decimal places by default', () => {
  assert.equal(formatDisplayNumber(12), '12.00');
  assert.equal(formatDisplayNumber(12.345), '12.35');
});

test('tiny negative floating-point values display as positive zero', () => {
  assert.equal(formatDisplayNumber(-9.369718875422568e-14), '0.00');
  assert.equal(formatDisplayNumber(-0), '0.00');
});
