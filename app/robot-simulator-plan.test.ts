import assert from 'node:assert/strict';
import test from 'node:test';
import { chainPlanCommands, createPlanFilename, parsePlan, serializePlan } from './robot-simulator/plan.ts';

const targets = [
  { id: 1, name: 'HOME', pose: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }, visible: true },
  { id: 2, name: 'Target2', pose: { x: 1, y: 2, z: 3, rx: 4, ry: 5, rz: 6 }, visible: false },
];

test('chainPlanCommands links each command to the previous destination', () => {
  const commands = [
    { id: 1, type: 'move_j' as const, startTargetId: null, endTargetId: 1, speed: 10, acceleration: 10, deceleration: 10 },
    { id: 2, type: 'move_l' as const, startTargetId: null, endTargetId: 2, speed: 20, acceleration: 20, deceleration: 20 },
  ];
  assert.deepEqual(chainPlanCommands(commands, null).map((command) => command.startTargetId), [null, 1]);
});

test('plan serialization round-trips valid data', () => {
  const commands = [{ id: 1, type: 'move_j' as const, startTargetId: null, endTargetId: 1, speed: 10, acceleration: 10, deceleration: 10 }];
  assert.deepEqual(parsePlan(JSON.parse(serializePlan(targets, commands))), { targets, commands });
});

test('parsePlan rejects dangling target references', () => {
  assert.throws(() => parsePlan({ version: 1, targets, commands: [{ id: 1, type: 'move_j', startTargetId: null, endTargetId: 99, speed: 10, acceleration: 10, deceleration: 10 }] }), /invalid targets or commands/);
});

test('parsePlan rejects duplicate target and command IDs', () => {
  const command = { id: 1, type: 'move_j' as const, startTargetId: null, endTargetId: 1, speed: 10, acceleration: 10, deceleration: 10 };
  assert.throws(() => parsePlan({ version: 1, targets: [targets[0], { ...targets[1], id: 1 }], commands: [command] }), /duplicate target IDs/);
  assert.throws(() => parsePlan({ version: 1, targets, commands: [command, { ...command, endTargetId: 2 }] }), /duplicate command IDs/);
});

test('parsePlan rejects unsupported motion percentages', () => {
  const command = { id: 1, type: 'move_j' as const, startTargetId: null, endTargetId: 1, speed: 10, acceleration: 10, deceleration: 10 };
  assert.throws(() => parsePlan({ version: 1, targets, commands: [{ ...command, speed: 0 }] }), /motion percentages/);
  assert.throws(() => parsePlan({ version: 1, targets, commands: [{ ...command, acceleration: 101 }] }), /motion percentages/);
  assert.throws(() => parsePlan({ version: 1, targets, commands: [{ ...command, deceleration: -1 }] }), /motion percentages/);
});

test('plan filename uses local date components', () => {
  assert.equal(createPlanFilename(new Date(2026, 8, 4, 9, 7)), 'ar4_plan_2026_09_04_07.json');
});
