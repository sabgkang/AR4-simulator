import { DEFAULT_MOTOR_SPEEDS } from './config.ts';
import type { JointRange, Pose } from './types';

export type SimulatorSettings = {
  version: 1;
  jointRanges: JointRange[];
  motorSpeeds: Pose;
  motion: {
    speedPercent: number;
    accelerationPercent: number;
    decelerationPercent: number;
  };
  serial: {
    portName: string;
    auxiliaryPortNames: string[];
  };
};

function isPercentage(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function parseSettings(value: unknown): SimulatorSettings {
  if (!value || typeof value !== 'object') throw new Error('Unsupported settings format.');
  const candidate = value as Partial<SimulatorSettings>;
  if (candidate.version !== 1 || !Array.isArray(candidate.jointRanges) || candidate.jointRanges.length !== 6) {
    throw new Error('Unsupported settings format.');
  }
  if (!candidate.jointRanges.every((range) => range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min < range.max)) {
    throw new Error('Settings contain invalid joint ranges.');
  }
  if (!Array.isArray(candidate.motorSpeeds) || candidate.motorSpeeds.length !== 6
    || !candidate.motorSpeeds.every((speed, index) => Number.isFinite(speed) && speed >= 0 && speed <= DEFAULT_MOTOR_SPEEDS[index])) {
    throw new Error('Settings contain invalid motor speeds.');
  }
  if (!candidate.motion || !isPercentage(candidate.motion.speedPercent)
    || !isPercentage(candidate.motion.accelerationPercent) || !isPercentage(candidate.motion.decelerationPercent)) {
    throw new Error('Settings contain invalid motion percentages.');
  }
  if (candidate.motion.speedPercent <= 0) {
    throw new Error('Settings speed percentage must be greater than zero.');
  }
  if (!candidate.serial || typeof candidate.serial.portName !== 'string'
    || !Array.isArray(candidate.serial.auxiliaryPortNames)
    || !candidate.serial.auxiliaryPortNames.every((name) => typeof name === 'string')) {
    throw new Error('Settings contain invalid serial port names.');
  }
  return {
    version: 1,
    jointRanges: candidate.jointRanges.map((range) => ({ ...range })),
    motorSpeeds: [...candidate.motorSpeeds] as Pose,
    motion: { ...candidate.motion },
    serial: { portName: candidate.serial.portName, auxiliaryPortNames: [...candidate.serial.auxiliaryPortNames] },
  };
}

export function serializeSettings(settings: SimulatorSettings) {
  return JSON.stringify(settings, null, 2);
}

export function createSettingsFilename(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `ar4_settings_${date.getFullYear()}_${pad(date.getMonth() + 1)}_${pad(date.getDate())}_${pad(date.getMinutes())}.json`;
}
