import { createJointMotion, STEPS_PER_UNIT, type JointMotion, type JointValues } from './teensy-motion.ts';

export type CartesianPose = [number, number, number, number, number, number];
export type ExternalAxes = [number, number, number];

export type LinearWaypoint = {
  pose: CartesianPose;
  external: ExternalAxes;
  progress: number;
};

export type LinearJointWaypoint = {
  joints: JointValues;
  progress: number;
};

export type LinearMotionSequence = {
  durationMs: number;
  waypointCount: number;
  sample: (elapsedMs: number) => JointValues;
};

function finitePercent(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be between 0 and 100.`);
  }
}

function interpolate(start: readonly number[], target: readonly number[], progress: number) {
  return start.map((value, index) => value + (target[index] - value) * progress);
}

function roundLikeLround(value: number) {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function buildLinearWaypoints(
  startPose: CartesianPose,
  targetPose: CartesianPose,
  startExternal: ExternalAxes,
  targetExternal: ExternalAxes,
  waypointDistance = 1,
) {
  if (!Number.isFinite(waypointDistance) || waypointDistance <= 0) {
    throw new Error('waypointDistance must be greater than 0.');
  }
  const lineDistance = Math.sqrt(targetPose.reduce((sum, value, index) => {
    const difference = value - startPose[index];
    return sum + difference * difference;
  }, 0));
  // Teensy moveL returns immediately when the six-dimensional Cartesian
  // distance is zero, even if an external-axis target was supplied.
  if (lineDistance === 0) return [];

  const waypointCount = Math.max(1, Math.ceil(lineDistance / waypointDistance));
  return Array.from({ length: waypointCount }, (_, index): LinearWaypoint => {
    const progress = (index + 1) / waypointCount;
    return {
      pose: interpolate(startPose, targetPose, progress) as CartesianPose,
      external: interpolate(startExternal, targetExternal, progress) as ExternalAxes,
      progress,
    };
  });
}

/** Teensy moveL changes the delay linearly across Cartesian waypoints. */
export function linearDelayMultiplier(progress: number, accelerationPercent: number, decelerationPercent: number, ramp = 80) {
  finitePercent(accelerationPercent, 'acc');
  finitePercent(decelerationPercent, 'dec');
  if (!Number.isFinite(ramp) || ramp <= 0 || ramp > 100) throw new Error('ramp must be between 0 and 100.');

  const startAndEndMultiplier = 200 / ramp;
  const accelerationFraction = accelerationPercent / 100;
  const decelerationFraction = decelerationPercent / 100;
  if (accelerationFraction > 0 && progress <= accelerationFraction) {
    return startAndEndMultiplier - (startAndEndMultiplier - 1) * progress / accelerationFraction;
  }
  if (decelerationFraction > 0 && progress >= 1 - decelerationFraction) {
    return 1 + (startAndEndMultiplier - 1) * (progress - (1 - decelerationFraction)) / decelerationFraction;
  }
  return 1;
}

/** Quantizes absolute waypoint targets while carrying the same rounding remainder as moveL. */
export function quantizeLinearJointWaypoints(waypoints: LinearJointWaypoint[]) {
  const remainder = Array(9).fill(0);
  return waypoints.map(({ joints, progress }) => ({
    progress,
    joints: joints.map((value, index) => {
      const desiredSteps = value * STEPS_PER_UNIT[index] + remainder[index];
      const roundedSteps = roundLikeLround(desiredSteps);
      remainder[index] = desiredSteps - roundedSteps;
      return roundedSteps / STEPS_PER_UNIT[index];
    }) as JointValues,
  }));
}

export function createLinearMotionSequence(options: {
  start: JointValues;
  waypoints: LinearJointWaypoint[];
  maxSpeeds: JointValues;
  speedPercent: number;
  accelerationPercent: number;
  decelerationPercent: number;
  ramp?: number;
}): LinearMotionSequence {
  finitePercent(options.speedPercent, 'spd');
  if (options.speedPercent <= 0) throw new Error('spd must be greater than 0.');
  const quantized = quantizeLinearJointWaypoints(options.waypoints);
  const segments: Array<{ startsAt: number; endsAt: number; motion: JointMotion }> = [];
  let segmentStart = [...options.start] as JointValues;
  let elapsed = 0;

  quantized.forEach(({ joints, progress }) => {
    const delayMultiplier = linearDelayMultiplier(
      progress,
      options.accelerationPercent,
      options.decelerationPercent,
      options.ramp ?? 80,
    );
    const motion = createJointMotion({
      start: segmentStart,
      target: joints,
      maxSpeeds: options.maxSpeeds,
      speedPercent: options.speedPercent / delayMultiplier,
      accelerationPercent: 0,
      decelerationPercent: 0,
      ramp: 10,
    });
    if (motion.durationMs > 0) {
      segments.push({ startsAt: elapsed, endsAt: elapsed + motion.durationMs, motion });
      elapsed += motion.durationMs;
    }
    segmentStart = joints;
  });

  const finalTarget = quantized.at(-1)?.joints ?? [...options.start] as JointValues;
  const sample = (elapsedMs: number) => {
    if (segments.length === 0 || elapsedMs >= elapsed) return [...finalTarget] as JointValues;
    if (elapsedMs <= 0) return [...options.start] as JointValues;
    let low = 0;
    let high = segments.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (segments[middle].endsAt > elapsedMs) high = middle;
      else low = middle + 1;
    }
    const segment = segments[low];
    return segment.motion.sample(elapsedMs - segment.startsAt);
  };

  return { durationMs: elapsed, waypointCount: options.waypoints.length, sample };
}
