export const STEPS_PER_UNIT = [88.888, 111.111, 111.111, 99.555, 43.72, 44.444, 14.2857, 14.2857, 14.2857] as const;
export const DEFAULT_MAX_SPEEDS = [56.251, 45, 45, 50.224, 114.364, 112.501, 350, 350, 350] as const;

export type JointValues = [number, number, number, number, number, number, number, number, number];

export type JointMotionOptions = {
  start: JointValues;
  target: JointValues;
  maxSpeeds: JointValues;
  speedPercent: number;
  accelerationPercent: number;
  decelerationPercent: number;
  ramp?: number;
};

export type JointMotion = {
  durationMs: number;
  effectiveRamp: number;
  highStep: number;
  sample: (elapsedMs: number) => JointValues;
};

function finitePercent(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be between 0 and 100.`);
  }
}

function findCompletedTicks(timeline: Float64Array, elapsedMs: number) {
  let low = 0;
  let high = timeline.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (timeline[middle] <= elapsedMs) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Builds the same shared-master-step speed profile used by Teensy's driveMotorsJ(). */
export function createJointMotion(options: JointMotionOptions): JointMotion {
  const {
    start,
    target,
    maxSpeeds,
    speedPercent,
    accelerationPercent,
    decelerationPercent,
  } = options;

  finitePercent(speedPercent, 'spd');
  finitePercent(accelerationPercent, 'acc');
  finitePercent(decelerationPercent, 'dec');
  if (speedPercent <= 0) throw new Error('spd must be greater than 0.');
  const stepCounts = target.map((value, index) => Math.round(Math.abs(value - start[index]) * STEPS_PER_UNIT[index]));
  const highStep = Math.max(...stepCounts);
  const effectiveRamp = Math.max(10, Number.isFinite(options.ramp) ? options.ramp as number : 10);

  if (highStep === 0) {
    return { durationMs: 0, effectiveRamp, highStep, sample: () => [...target] as JointValues };
  }

  // Teensy uses one master tick for all axes. The fastest safe master rate is
  // constrained by every active axis and its configured joint speed limit.
  const speedScale = speedPercent / 100;
  let masterTicksPerSecond = Number.POSITIVE_INFINITY;
  stepCounts.forEach((steps, index) => {
    if (steps === 0) return;
    const axisLimit = maxSpeeds[index];
    if (!Number.isFinite(axisLimit) || axisLimit <= 0) throw new Error(`J${index + 1} maximum speed must be greater than 0.`);
    const allowedMasterRate = axisLimit * speedScale * STEPS_PER_UNIT[index] * highStep / steps;
    masterTicksPerSecond = Math.min(masterTicksPerSecond, allowedMasterRate);
  });

  const cruiseDelayMs = 1000 / masterTicksPerSecond;
  const accelerationSteps = highStep * accelerationPercent / 100;
  const decelerationSteps = highStep * decelerationPercent / 100;
  const rampFactor = effectiveRamp / 10;
  const startDelayMs = cruiseDelayMs * rampFactor;
  const endDelayMs = cruiseDelayMs * rampFactor;
  const accelerationIncrement = accelerationSteps > 0 ? (startDelayMs - cruiseDelayMs) / accelerationSteps : 0;
  const decelerationIncrement = decelerationSteps > 0 ? (endDelayMs - cruiseDelayMs) / decelerationSteps : 0;

  // Index n contains the elapsed time after n master ticks. This preserves the
  // firmware's delay ramp while allowing requestAnimationFrame time sampling.
  const timeline = new Float64Array(highStep + 1);
  let currentDelayMs = startDelayMs;
  for (let tick = 0; tick < highStep; tick += 1) {
    if (tick <= accelerationSteps) currentDelayMs -= accelerationIncrement;
    else if (tick >= highStep - decelerationSteps) currentDelayMs += decelerationIncrement;
    else currentDelayMs = cruiseDelayMs;
    timeline[tick + 1] = timeline[tick] + Math.max(cruiseDelayMs, currentDelayMs);
  }

  const durationMs = timeline[highStep];
  const sample = (elapsedMs: number) => {
    if (elapsedMs >= durationMs) return [...target] as JointValues;
    if (elapsedMs <= 0) return [...start] as JointValues;
    const completedMasterTicks = findCompletedTicks(timeline, elapsedMs);
    return start.map((value, index) => {
      const completedAxisSteps = Math.floor(completedMasterTicks * stepCounts[index] / highStep);
      const direction = Math.sign(target[index] - value);
      return value + direction * completedAxisSteps / STEPS_PER_UNIT[index];
    }) as JointValues;
  };

  return { durationMs, effectiveRamp, highStep, sample };
}
