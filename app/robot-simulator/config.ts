import { DEFAULT_MAX_SPEEDS } from '../teensy-motion.ts';
import type { JointRange, Pose } from './types';

export const JOINTS = [
  { name: 'J1', label: 'Base', min: -170, max: 170, accent: '#2563eb' },
  { name: 'J2', label: 'Shoulder', min: -42, max: 90, accent: '#7c3aed' },
  { name: 'J3', label: 'Elbow', min: -89, max: 52, accent: '#0891b2' },
  { name: 'J4', label: 'Wrist roll', min: -165, max: 165, accent: '#059669' },
  { name: 'J5', label: 'Wrist bend', min: -105, max: 105, accent: '#d97706' },
  { name: 'J6', label: 'Tool roll', min: -155, max: 155, accent: '#dc2626' },
] as const;

export const DEFAULT_JOINT_RANGES: JointRange[] = JOINTS.map(({ min, max }) => ({ min, max }));
export const DEFAULT_MOTOR_SPEEDS: Pose = DEFAULT_MAX_SPEEDS.slice(0, 6) as Pose;
export const JOINT_ZERO_OFFSETS: Pose = [Math.PI / 2, 0, 0, 0, 0, 0];

export const PRESETS: Record<string, Pose> = {
  Home: [0, 0, 0, 0, 0, 0],
  Upright: [0, 0, -89, 0, 0, 0],
  Inspect: [0, 45, 20, 0, 0, 0],
};

export const MESH_ROOT = '/meshes/ar4_mk5/';
export const TOOL_TIP_OFFSET = 0;
export const TOOL_TIP_MARKER_RADIUS = 0.01;
export const TCP_AXIS_LENGTH = 0.05;
export const TCP_AXIS_THICKNESS = 0.005;
export const TCP_FRAME_ROTATION_Z = -Math.PI / 2;
export const BASE_AXIS_LENGTH = 0.1;
export const BASE_AXIS_THICKNESS = 0.005;

export const LINK_MESHES = [
  ['Link_1_Aluminum.STL', 'Link_1_Motor.STL'],
  ['Link_2_Aluminum.STL', 'Link_2_Motor.STL', 'Link_2_Cover.STL', 'Link_2_Logo.STL'],
  ['Link_3_Aluminum.STL', 'Link_3_Motor.STL'],
  ['Link_4_Aluminum.STL', 'Link_4_Motor.STL', 'Link_4_Cover.STL', 'Link_4_Logo.STL'],
  ['Link_5_Aluminum.STL', 'Link_5_Motor.STL'],
  ['Link_6_Aluminum.STL'],
];

export const LINK_MESH_TRANSFORMS = [
  { xyz: [0, 0, 0], rpy: [0, 0, 0] },
  { xyz: [0, 0, -0.00887], rpy: [Math.PI, 0, 0] },
  { xyz: [0, 0, -0.03671], rpy: [0, 0, 0] },
  { xyz: [0, 0, -0.07594], rpy: [0, 0, -Math.PI / 2] },
  { xyz: [0, 0, -0.0275], rpy: [0, 0, 0] },
  { xyz: [0, 0, -0.016], rpy: [0, 0, 0] },
] as const;

export const JOINT_FRAMES = [
  { xyz: [0, 0, 0.092], rpy: [Math.PI, 0, 0], axis: [0, 0, -1] },
  { xyz: [0, 0.06415, -0.07778], rpy: [Math.PI / 2, 0, -Math.PI / 2], axis: [0, 0, -1] },
  { xyz: [0, -0.305, 0], rpy: [0, 0, Math.PI], axis: [0, 0, -1] },
  { xyz: [0, 0, 0], rpy: [Math.PI / 2, 0, -Math.PI / 2], axis: [0, 0, -1] },
  { xyz: [0, 0, -0.22294], rpy: [Math.PI, 0, -Math.PI / 2], axis: [1, 0, 0] },
  { xyz: [0, 0, 0.041], rpy: [0, 0, 0], axis: [0, 0, 1] },
] as const;
