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

    if (command.type === 'move_a' || command.type === 'move_c') {
      const reference = targetsById.get(command.referenceTargetId ?? -1);
      if (!reference) throw new Error(`${command.type} reference target was not found.`);
      const targetValues = targetPose(target);
      const referenceValues = targetPose(reference);
      if (command.type === 'move_a') {
        return { cmd: 'move_a', mid: referenceValues, end: targetValues.slice(0, 3), ...profile, ramp: 50, w: 'A' };
      }
      return { cmd: 'move_c', center: targetValues.slice(0, 3), plane: referenceValues.slice(0, 3), pose: targetValues.slice(3), ...profile, ramp: 50, w: 'A' };
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
