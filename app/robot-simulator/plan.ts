import type { PlanCommand, PlanMotionCommand, PlanTarget, TcpPose } from './types';

export function isPlanMotionCommand(command: PlanCommand): command is PlanMotionCommand {
  return command.type === 'move_joints' || command.type === 'move_j' || command.type === 'move_l';
}

export function chainPlanCommands(commands: PlanCommand[], firstTargetId: number | null) {
  let startTargetId = firstTargetId;
  return commands.map((command) => {
    if (!isPlanMotionCommand(command)) return command;
    const chained = { ...command, startTargetId };
    startTargetId = chained.endTargetId;
    return chained;
  });
}

export function expandPlanCommands(commands: PlanCommand[]): PlanMotionCommand[] {
  const expandRange = (startIndex: number, expectEnd: boolean): { expanded: PlanMotionCommand[]; nextIndex: number } => {
    const expanded: PlanMotionCommand[] = [];
    let index = startIndex;
    while (index < commands.length) {
      const command = commands[index];
      if (command.type === 'loop-end') {
        if (!expectEnd) throw new Error('loop-end does not have a matching loop-begin.');
        return { expanded, nextIndex: index + 1 };
      }
      if (command.type === 'loop-begin') {
        const nested = expandRange(index + 1, true);
        for (let repeat = 0; repeat < command.count; repeat += 1) expanded.push(...nested.expanded);
        index = nested.nextIndex;
        continue;
      }
      expanded.push(command);
      index += 1;
    }
    if (expectEnd) throw new Error('loop-begin does not have a matching loop-end.');
    return { expanded, nextIndex: index };
  };
  return expandRange(0, false).expanded;
}

export function parsePlan(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Unsupported plan format.');
  const parsed = value as { version?: unknown; targets?: unknown; commands?: unknown };
  if (parsed.version !== 1 || !Array.isArray(parsed.targets) || !Array.isArray(parsed.commands)) {
    throw new Error('Unsupported plan format.');
  }
  const poseKeys: Array<keyof TcpPose> = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
  const targets = parsed.targets.filter((target): target is PlanTarget => {
    if (!target || typeof target !== 'object') return false;
    const candidate = target as Partial<PlanTarget>;
    return Number.isInteger(candidate.id) && typeof candidate.name === 'string' && typeof candidate.visible === 'boolean'
      && !!candidate.pose && poseKeys.every((key) => typeof candidate.pose?.[key] === 'number' && Number.isFinite(candidate.pose[key]));
  });
  const targetIdsList = targets.map((target) => target.id);
  if (new Set(targetIdsList).size !== targetIdsList.length) {
    throw new Error('The plan contains duplicate target IDs.');
  }
  const targetIds = new Set(targets.map((target) => target.id));
  const commands = parsed.commands.filter((command): command is PlanCommand => {
    if (!command || typeof command !== 'object') return false;
    const candidate = command as Partial<PlanCommand>;
    if (!Number.isInteger(candidate.id)) return false;
    if (candidate.type === 'loop-begin') return Number.isInteger(candidate.count) && (candidate.count ?? 0) >= 1;
    if (candidate.type === 'loop-end') return true;
    const hasValidJoints = candidate.type !== 'move_joints'
      || (Array.isArray(candidate.joints) && candidate.joints.length === 9 && candidate.joints.every((joint) => typeof joint === 'number' && Number.isFinite(joint)));
    return (candidate.type === 'move_joints' || candidate.type === 'move_j' || candidate.type === 'move_l')
      && (candidate.startTargetId === null || targetIds.has(candidate.startTargetId ?? -1)) && targetIds.has(candidate.endTargetId ?? -1)
      && [candidate.speed, candidate.acceleration, candidate.deceleration].every((item) => typeof item === 'number' && Number.isFinite(item))
      && hasValidJoints;
  });
  if (targets.length !== parsed.targets.length || commands.length !== parsed.commands.length) {
    throw new Error('The plan contains invalid targets or commands.');
  }
  const commandIds = commands.map((command) => command.id);
  if (new Set(commandIds).size !== commandIds.length) {
    throw new Error('The plan contains duplicate command IDs.');
  }
  if (commands.some((command) => isPlanMotionCommand(command) && (command.speed <= 0 || command.speed > 100
    || command.acceleration < 0 || command.acceleration > 100
    || command.deceleration < 0 || command.deceleration > 100))) {
    throw new Error('Plan motion percentages are outside the supported range.');
  }
  expandPlanCommands(commands);
  return { targets, commands: chainPlanCommands(commands, commands.find(isPlanMotionCommand)?.startTargetId ?? null) };
}

export function serializePlan(targets: PlanTarget[], commands: PlanCommand[]) {
  return JSON.stringify({ version: 1, targets, commands }, null, 2);
}

export function createPlanFilename(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `ar4_plan_${date.getFullYear()}_${pad(date.getMonth() + 1)}_${pad(date.getDate())}_${pad(date.getMinutes())}.json`;
}
