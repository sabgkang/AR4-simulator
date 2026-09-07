import type { PlanCommand, PlanTarget } from './types';
import { expandPlanCommands } from './plan.ts';

function roundCommandNumber(value: number) {
  const rounded = Number(value.toFixed(2));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function targetPose(target: PlanTarget) {
  const { x, y, z, rx, ry, rz } = target.pose;
  return [x, y, z, rx, ry, rz].map(roundCommandNumber);
}

export function serializePlanCommands(targets: PlanTarget[], commands: PlanCommand[]) {
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const exported = expandPlanCommands(commands).map((command) => {
    const target = targetsById.get(command.endTargetId);
    if (!target) throw new Error(`Target ${command.endTargetId} was not found.`);
    const profile = {
      spd_type: 'percent',
      spd: roundCommandNumber(command.speed),
      acc: roundCommandNumber(command.acceleration),
      dec: roundCommandNumber(command.deceleration),
    } as const;

    if (command.type === 'move_joints') {
      if (!command.joints || command.joints.length !== 9) throw new Error('move_joints requires nine joint values.');
      return { cmd: 'move_joints', j: command.joints.map(roundCommandNumber), ...profile };
    }

    if (command.type === 'move_l') {
      return {
        cmd: 'move_l',
        pose: targetPose(target),
        ext: [0, 0, 0],
        ...profile,
        rounding: 0,
        w: 'A',
      };
    }

    return { cmd: 'move_j', pose: targetPose(target), ...profile, w: 'A' };
  });

  return exported.map((command) => JSON.stringify(command)).join('\n') + (exported.length > 0 ? '\n' : '');
}

export function createCommandsFilename(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `ar4-mk5-cmds-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}.json`;
}
