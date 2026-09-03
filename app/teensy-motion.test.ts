import assert from 'node:assert/strict';
import test from 'node:test';
import { createJointMotion, DEFAULT_MAX_SPEEDS, type JointValues } from './teensy-motion.ts';

const ZERO: JointValues = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const SPEEDS = [...DEFAULT_MAX_SPEEDS] as JointValues;

test('move_joints defaults ramp to 10 and reaches the target', () => {
  const target: JointValues = [10, 0, 0, 0, 0, 0, 0, 0, 0];
  const motion = createJointMotion({
    start: ZERO, target, maxSpeeds: SPEEDS,
    speedPercent: 15, accelerationPercent: 10, decelerationPercent: 10,
  });
  assert.equal(motion.effectiveRamp, 10);
  assert.deepEqual(motion.sample(motion.durationMs), target);
  assert.ok(Math.abs(motion.durationMs - 1185.3) < 2);
});

test('an explicit ramp changes acceleration and deceleration timing', () => {
  const target: JointValues = [10, 0, 0, 0, 0, 0, 0, 0, 0];
  const common = {
    start: ZERO, target, maxSpeeds: SPEEDS,
    speedPercent: 15, accelerationPercent: 10, decelerationPercent: 10,
  };
  const noRamp = createJointMotion(common);
  const ramped = createJointMotion({ ...common, ramp: 50 });
  assert.ok(ramped.durationMs > noRamp.durationMs);
  assert.equal(ramped.effectiveRamp, 50);
});

test('all axes remain synchronized and finish together', () => {
  const target: JointValues = [20, 10, -10, 5, 30, -25, 100, 50, 25];
  const motion = createJointMotion({
    start: ZERO, target, maxSpeeds: SPEEDS,
    speedPercent: 25, accelerationPercent: 15, decelerationPercent: 20, ramp: 40,
  });
  const middle = motion.sample(motion.durationMs / 2);
  middle.forEach((value, index) => {
    assert.ok(Math.abs(value) <= Math.abs(target[index]));
  });
  assert.deepEqual(motion.sample(motion.durationMs), target);
});

test('invalid speed percentages are rejected', () => {
  assert.throws(() => createJointMotion({
    start: ZERO, target: [1, 0, 0, 0, 0, 0, 0, 0, 0], maxSpeeds: SPEEDS,
    speedPercent: 0, accelerationPercent: 10, decelerationPercent: 10,
  }), /greater than 0/);
});
