import assert from 'node:assert/strict';
import test from 'node:test';
import { createPositionResponse, HELLO_RESPONSE, type TcpValues } from './simulator-protocol.ts';
import type { JointValues } from './teensy-motion.ts';

test('hello identifies the simulator', () => {
  assert.deepEqual(HELLO_RESPONSE, {
    RobotModel: 'AR4 Simulator',
    RobotVersion: 'v1.0',
    FirmwareVersion: 'v1.0',
  });
});

test('get_position returns J1-J9 and six TCP values rounded to three decimals', () => {
  const joints: JointValues = [1.23456, 2, 3, 4, 5, 6, 7, 8, 9];
  const tcp: TcpValues = [315.1236, 0, 450, 0, 135, -0.0001];
  const response = createPositionResponse(joints, tcp);
  assert.deepEqual(response.j, [1.235, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(response.pose, [315.124, 0, 450, 0, 135, 0]);
});
