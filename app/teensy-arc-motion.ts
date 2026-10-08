import type { CartesianPose, ExternalAxes, LinearWaypoint } from './teensy-linear-motion.ts';
import * as THREE from 'three';

type Vector3 = [number, number, number];

const add = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (value: Vector3, factor: number): Vector3 => [value[0] * factor, value[1] * factor, value[2] * factor];
const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (value: Vector3) => Math.sqrt(dot(value, value));
const normalize = (value: Vector3, error: string): Vector3 => {
  const magnitude = length(value);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-6) throw new Error(error);
  return scale(value, 1 / magnitude);
};

function rotateAroundAxis(vector: Vector3, axis: Vector3, angle: number): Vector3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(add(scale(vector, cosine), scale(cross(axis, vector), sine)), scale(axis, dot(axis, vector) * (1 - cosine)));
}

function waypointCount(arcLength: number, waypointDistance: number) {
  if (!Number.isFinite(waypointDistance) || waypointDistance <= 0) throw new Error('waypointDistance must be greater than 0.');
  return Math.max(1, Math.ceil(arcLength / waypointDistance));
}

function interpolateOrientation(start: CartesianPose, target: CartesianPose, progress: number): Vector3 {
  const startQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(start[3]),
    THREE.MathUtils.degToRad(start[4]),
    THREE.MathUtils.degToRad(start[5]),
    'XYZ',
  ));
  const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(target[3]),
    THREE.MathUtils.degToRad(target[4]),
    THREE.MathUtils.degToRad(target[5]),
    'XYZ',
  ));
  const orientation = new THREE.Euler().setFromQuaternion(startQuaternion.slerp(targetQuaternion, progress), 'XYZ');
  return [orientation.x, orientation.y, orientation.z].map(THREE.MathUtils.radToDeg) as Vector3;
}

function circumcenter(start: Vector3, mid: Vector3, end: Vector3) {
  const a = subtract(mid, start);
  const b = subtract(end, start);
  const normal = cross(a, b);
  const normalSquared = dot(normal, normal);
  if (!Number.isFinite(normalSquared) || normalSquared <= 1e-8) throw new Error('move_a start, mid, and end points must define an arc.');
  const numerator = add(scale(cross(normal, a), dot(b, b)), scale(cross(b, normal), dot(a, a)));
  return { center: add(start, scale(numerator, 1 / (2 * normalSquared))), normal: normalize(normal, 'move_a arc plane is invalid.') };
}

export function buildArcThroughWaypoints(
  startPose: CartesianPose,
  midPose: CartesianPose,
  endPoint: Vector3,
  external: ExternalAxes,
  waypointDistance = 1,
): LinearWaypoint[] {
  const start = startPose.slice(0, 3) as Vector3;
  const mid = midPose.slice(0, 3) as Vector3;
  const { center, normal } = circumcenter(start, mid, endPoint);
  const startVector = subtract(start, center);
  const radius = length(startVector);
  const basisX = normalize(startVector, 'move_a radius must be greater than 0.');
  const basisY = normalize(cross(normal, basisX), 'move_a arc plane is invalid.');
  const angleFor = (point: Vector3) => {
    const vector = normalize(subtract(point, center), 'move_a arc point must differ from its center.');
    let angle = Math.atan2(dot(vector, basisY), dot(vector, basisX));
    if (angle < 0) angle += Math.PI * 2;
    return angle;
  };
  const midAngle = angleFor(mid);
  let endAngle = angleFor(endPoint);
  if (endAngle + 1e-9 < midAngle) endAngle += Math.PI * 2;
  if (endAngle <= 1e-9) throw new Error('move_a arc length must be greater than 0.');
  const count = waypointCount(radius * endAngle, waypointDistance);
  return Array.from({ length: count }, (_, index) => {
    const progress = (index + 1) / count;
    const point = add(center, rotateAroundAxis(startVector, normal, endAngle * progress));
    const orientation = interpolateOrientation(startPose, midPose, progress);
    return {
      pose: [point[0], point[1], point[2], ...orientation] as CartesianPose,
      external: [...external] as ExternalAxes,
      progress,
    };
  });
}

export function buildCircleWaypoints(
  startPose: CartesianPose,
  center: Vector3,
  planePoint: Vector3,
  orientation: Vector3,
  external: ExternalAxes,
  waypointDistance = 1,
): LinearWaypoint[] {
  const start = startPose.slice(0, 3) as Vector3;
  const startVector = subtract(start, center);
  const radius = length(startVector);
  if (!Number.isFinite(radius) || radius <= 1e-6) throw new Error('move_c start point must differ from its center.');
  const planeVector = subtract(planePoint, center);
  const axis = normalize(cross(startVector, planeVector), 'move_c plane point must define a plane with the start and center points.');
  const count = waypointCount(2 * Math.PI * radius, waypointDistance);
  return Array.from({ length: count }, (_, index) => {
    const progress = (index + 1) / count;
    const point = add(center, rotateAroundAxis(startVector, axis, Math.PI * 2 * progress));
    return {
      pose: [point[0], point[1], point[2], ...orientation] as CartesianPose,
      external: [...external] as ExternalAxes,
      progress,
    };
  });
}
