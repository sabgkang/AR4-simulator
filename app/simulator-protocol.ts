import type { JointValues } from './teensy-motion.ts';

export type TcpValues = [number, number, number, number, number, number];

export const HELLO_RESPONSE = {
  RobotModel: 'AR4 Simulator',
  RobotVersion: 'v1.0',
  FirmwareVersion: 'v1.0',
} as const;

function roundToThree(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function createPositionResponse(joints: JointValues, tcp: TcpValues) {
  return {
    msg: 'robot_pos' as const,
    j: joints.map(roundToThree),
    pose: tcp.map(roundToThree),
    speed_violation: 0,
    debug: '',
    flag: '',
  };
}
