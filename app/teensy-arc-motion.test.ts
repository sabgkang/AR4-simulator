import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildArcThroughWaypoints, buildCircleWaypoints } from './teensy-arc-motion.ts';

test('move_a waypoints pass through the arc end with the requested orientation', () => {
  const waypoints = buildArcThroughWaypoints([10, 0, 0, 0, 0, 0], [0, 10, 0, 10, 20, 30], [-10, 0, 0], [0, 0, 0], 2);
  const last = waypoints.at(-1);
  assert.ok(last);
  assert.ok(Math.min(...waypoints.map((waypoint) => Math.hypot(waypoint.pose[0], waypoint.pose[1] - 10, waypoint.pose[2]))) < 2.1);
  assert.deepEqual(last.pose.map((value) => Math.round(value * 1e6) / 1e6), [-10, 0, 0, 10, 20, 30]);
});

test('move_c returns to its start after one full circle', () => {
  const waypoints = buildCircleWaypoints([10, 0, 0, 1, 2, 3], [0, 0, 0], [0, 10, 0], [4, 5, 6], [0, 0, 0], 2);
  const last = waypoints.at(-1);
  assert.ok(last);
  last.pose.forEach((value, index) => assert.ok(Math.abs(value - [10, 0, 0, 4, 5, 6][index]) < 1e-6));
});

test('move_a keeps equivalent orientations stable at the Euler gimbal lock', () => {
  const waypoints = buildArcThroughWaypoints(
    [10, 0, 0, 0, 90, 0],
    [0, 10, 0, 180, 90, -180],
    [-10, 0, 0],
    [0, 0, 0],
    2,
  );
  const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'XYZ'));
  waypoints.forEach(({ pose }) => {
    const actual = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(pose[3]),
      THREE.MathUtils.degToRad(pose[4]),
      THREE.MathUtils.degToRad(pose[5]),
      'XYZ',
    ));
    assert.ok(Math.abs(actual.dot(expected)) > 1 - 1e-10);
  });
});

test('arc commands reject collinear geometry', () => {
  assert.throws(() => buildArcThroughWaypoints([0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0], [2, 0, 0], [0, 0, 0]), /must define an arc/);
  assert.throws(() => buildCircleWaypoints([10, 0, 0, 0, 0, 0], [0, 0, 0], [20, 0, 0], [0, 0, 0], [0, 0, 0]), /must define a plane/);
});
