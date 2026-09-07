import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandsFilename, serializePlanCommands } from './robot-simulator/command-export.ts';

const targets = [
  { id: 1, name: 'Joint target', pose: { x: 315, y: 0, z: 450, rx: 0, ry: 135, rz: 0 }, visible: true },
  { id: 2, name: 'Linear target', pose: { x: 300, y: 25, z: 425, rx: 0, ry: 90, rz: 10 }, visible: true },
];

test('PLAN commands export as one serial JSON command per line', () => {
  const content = serializePlanCommands(targets, [
    { id: 0, type: 'move_joints', startTargetId: null, endTargetId: 1, joints: [10.123, 20, 30, 40, 50, 60, 70, 80, 90], speed: 20, acceleration: 11, deceleration: 12 },
    { id: 1, type: 'move_j', startTargetId: null, endTargetId: 1, speed: 15, acceleration: 10, deceleration: 10 },
    { id: 2, type: 'move_l', startTargetId: 1, endTargetId: 2, speed: 12, acceleration: 10, deceleration: 10 },
  ]);
  const commands = content.trim().split('\n').map((line) => JSON.parse(line) as unknown);

  assert.deepEqual(commands, [
    { cmd: 'move_joints', j: [10.12, 20, 30, 40, 50, 60, 70, 80, 90], spd_type: 'percent', spd: 20, acc: 11, dec: 12 },
    { cmd: 'move_j', pose: [315, 0, 450, 0, 135, 0], spd_type: 'percent', spd: 15, acc: 10, dec: 10, w: 'A' },
    { cmd: 'move_l', pose: [300, 25, 425, 0, 90, 10], ext: [0, 0, 0], spd_type: 'percent', spd: 12, acc: 10, dec: 10, rounding: 0, w: 'A' },
  ]);
});

test('command export filename includes local date and time', () => {
  assert.equal(createCommandsFilename(new Date(2026, 8, 6, 8, 7)), 'ar4-mk5-cmds-2026-09-06-08-07.json');
});

test('command export expands loop blocks', () => {
  const motion = { id: 2, type: 'move_j' as const, startTargetId: null, endTargetId: 1, speed: 15, acceleration: 10, deceleration: 10 };
  const content = serializePlanCommands(targets, [
    { id: 1, type: 'loop-begin', count: 2 },
    motion,
    { id: 3, type: 'loop-end' },
  ]);
  assert.equal(content.trim().split('\n').length, 2);
});

test('command export rejects missing targets', () => {
  assert.throws(() => serializePlanCommands([], [
    { id: 1, type: 'move_j', startTargetId: null, endTargetId: 99, speed: 15, acceleration: 10, deceleration: 10 },
  ]), /Target 99 was not found/);
});

test('command export rounds numbers to two decimal places without changing PLAN data', () => {
  const preciseTarget = {
    ...targets[0],
    pose: { ...targets[0].pose, x: -9.369718875422568e-14, y: 12.3456 },
  };
  const command = { id: 1, type: 'move_j' as const, startTargetId: null, endTargetId: 1, speed: 12.3456, acceleration: 10.004, deceleration: 9.999 };
  const exported = JSON.parse(serializePlanCommands([preciseTarget], [command]).trim()) as { pose: number[]; spd: number; acc: number; dec: number };

  assert.deepEqual(exported.pose.slice(0, 2), [0, 12.35]);
  assert.deepEqual([exported.spd, exported.acc, exported.dec], [12.35, 10, 10]);
  assert.equal(preciseTarget.pose.x, -9.369718875422568e-14);
  assert.equal(preciseTarget.pose.y, 12.3456);
  assert.equal(command.speed, 12.3456);
});
