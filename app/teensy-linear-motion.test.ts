import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLinearWaypoints,
  createLinearMotionSequence,
  linearDelayMultiplier,
  type CartesianPose,
  type ExternalAxes,
  type LinearJointWaypoint,
} from './teensy-linear-motion.ts';
import { DEFAULT_MAX_SPEEDS, type JointValues } from './teensy-motion.ts';

const ZERO_POSE: CartesianPose = [0, 0, 0, 0, 0, 0];
const ZERO_EXTERNAL: ExternalAxes = [0, 0, 0];
const ZERO_JOINTS: JointValues = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const SPEEDS = [...DEFAULT_MAX_SPEEDS] as JointValues;

test('Cartesian waypoints stay on the line and end without overshoot', () => {
  const waypoints = buildLinearWaypoints(ZERO_POSE, [2.4, 0, 0, 0, 0, 0], ZERO_EXTERNAL, ZERO_EXTERNAL);
  assert.equal(waypoints.length, 3);
  waypoints.forEach(({ pose }, index) => assert.ok(Math.abs(pose[0] - [0.8, 1.6, 2.4][index]) < 1e-12));
  assert.equal(waypoints.at(-1)?.progress, 1);
});

test('zero Cartesian distance returns no waypoints like Teensy moveL', () => {
  const waypoints = buildLinearWaypoints(ZERO_POSE, ZERO_POSE, ZERO_EXTERNAL, [10, 20, 30]);
  assert.equal(waypoints.length, 0);
});

test('move_l delay profile defaults to Teensy ramp 80', () => {
  assert.equal(linearDelayMultiplier(0, 10, 10), 2.5);
  assert.ok(Math.abs(linearDelayMultiplier(0.1, 10, 10) - 1) < 1e-12);
  assert.equal(linearDelayMultiplier(0.5, 10, 10), 1);
  assert.ok(Math.abs(linearDelayMultiplier(1, 10, 10) - 2.5) < 1e-12);
});

test('linear joint sequence reaches its quantized endpoint', () => {
  const waypoints: LinearJointWaypoint[] = [
    { progress: 0.5, joints: [5, 0, 0, 0, 0, 0, 0, 0, 0] },
    { progress: 1, joints: [10, 0, 0, 0, 0, 0, 0, 0, 0] },
  ];
  const motion = createLinearMotionSequence({
    start: ZERO_JOINTS,
    waypoints,
    maxSpeeds: SPEEDS,
    speedPercent: 20,
    accelerationPercent: 50,
    decelerationPercent: 50,
  });
  const endpoint = motion.sample(motion.durationMs);
  assert.ok(Math.abs(endpoint[0] - 10) <= 1 / 88.888);
  assert.ok(motion.durationMs > 0);
});

test('linear motion rejects invalid ramp values', () => {
  assert.throws(() => linearDelayMultiplier(0.5, 10, 10, 0), /ramp/);
  assert.throws(() => linearDelayMultiplier(0.5, 10, 10, 101), /ramp/);
});
