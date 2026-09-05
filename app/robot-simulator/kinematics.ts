import * as THREE from 'three';
import { TCP_FRAME_ROTATION_Z } from './config';

export function setFrame(object: THREE.Object3D, xyz: readonly number[], rpy: readonly number[]) {
  object.position.set(xyz[0], xyz[1], xyz[2]);
  object.rotation.set(rpy[0], rpy[1], rpy[2], 'ZYX');
}

export function getTcpWorldQuaternion(end: THREE.Object3D) {
  const tcpRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), TCP_FRAME_ROTATION_Z);
  return end.getWorldQuaternion(new THREE.Quaternion()).multiply(tcpRotation);
}

export function rotationVector(from: THREE.Quaternion, to: THREE.Quaternion) {
  const delta = to.clone().multiply(from.clone().invert()).normalize();
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(delta.w, -1, 1));
  const scale = Math.sqrt(Math.max(0, 1 - delta.w * delta.w));
  if (scale < 1e-8 || angle < 1e-8) return new THREE.Vector3();
  return new THREE.Vector3(delta.x / scale, delta.y / scale, delta.z / scale).multiplyScalar(angle);
}

export function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) augmented[column][entry] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= size; entry += 1) augmented[row][entry] -= factor * augmented[column][entry];
    }
  }
  return augmented.map((row) => row[size]);
}

export function angularDifferenceDegrees(value: number, reference: number) {
  return ((value - reference + 540) % 360) - 180;
}
