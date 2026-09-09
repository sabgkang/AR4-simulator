import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export const DEFAULT_COLLISION_JOINT_STEP_DEGREES = 0.5;
export const GROUND_PENETRATION_TOLERANCE_METERS = 0.0001;

export type CollisionHit = {
  bodyAId: string;
  bodyAName: string;
  bodyBId: string;
  bodyBName: string;
};

export type CollisionReport = {
  collided: boolean;
  hits: CollisionHit[];
};

export type CollisionPathSample = {
  progress: number;
  joints: number[];
};

export type CollisionDebugBounds = {
  bodyId: string;
  bodyName: string;
  kind: 'robot' | 'environment';
  box: THREE.Box3;
};

type RobotCollisionMesh = {
  bodyId: string;
  bodyName: string;
  mesh: THREE.Mesh;
  checkGround: boolean;
};

type EnvironmentCollisionBody = {
  bodyId: string;
  bodyName: string;
  root: THREE.Object3D;
  meshes: THREE.Mesh[];
};

const EMPTY_REPORT: CollisionReport = { collided: false, hits: [] };

function geometryBvh(geometry: THREE.BufferGeometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  let bvh = geometry.userData.collisionBvh as MeshBVH | undefined;
  if (!bvh) {
    bvh = new MeshBVH(geometry, { indirect: true });
    geometry.userData.collisionBvh = bvh;
  }
  return bvh;
}

export function prepareCollisionMesh(mesh: THREE.Mesh) {
  geometryBvh(mesh.geometry);
}

function worldBounds(mesh: THREE.Mesh, target: THREE.Box3) {
  mesh.updateWorldMatrix(true, false);
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox;
  return bounds ? target.copy(bounds).applyMatrix4(mesh.matrixWorld) : target.makeEmpty();
}

function meshesIntersect(meshA: THREE.Mesh, meshB: THREE.Mesh) {
  const boundsA = worldBounds(meshA, new THREE.Box3());
  const boundsB = worldBounds(meshB, new THREE.Box3());
  if (!boundsA.intersectsBox(boundsB)) return false;

  const matrixBToA = new THREE.Matrix4().copy(meshA.matrixWorld).invert().multiply(meshB.matrixWorld);
  return geometryBvh(meshA.geometry).bvhcast(geometryBvh(meshB.geometry), matrixBToA, {
    intersectsTriangles: (triangleA, triangleB) => triangleA.intersectsTriangle(triangleB),
  });
}

function meshPenetratesGround(mesh: THREE.Mesh, groundZ: number, tolerance: number) {
  const bounds = worldBounds(mesh, new THREE.Box3());
  if (bounds.min.z >= groundZ - tolerance) return false;

  const worldGround = new THREE.Plane(new THREE.Vector3(0, 0, 1), -groundZ);
  const localGround = worldGround.applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert());
  const minimumCorner = new THREE.Vector3();
  return geometryBvh(mesh.geometry).shapecast({
    intersectsBounds: (box) => {
      minimumCorner.set(
        localGround.normal.x >= 0 ? box.min.x : box.max.x,
        localGround.normal.y >= 0 ? box.min.y : box.max.y,
        localGround.normal.z >= 0 ? box.min.z : box.max.z,
      );
      return localGround.distanceToPoint(minimumCorner) < -tolerance;
    },
    intersectsTriangle: (triangle) => (
      localGround.distanceToPoint(triangle.a) < -tolerance
      || localGround.distanceToPoint(triangle.b) < -tolerance
      || localGround.distanceToPoint(triangle.c) < -tolerance
    ),
  });
}

export class CollisionWorld {
  private robotMeshes: RobotCollisionMesh[] = [];
  private environments = new Map<number, EnvironmentCollisionBody>();

  reset() {
    this.robotMeshes = [];
    this.environments.clear();
  }

  registerRobotMesh(bodyId: string, bodyName: string, mesh: THREE.Mesh, checkGround = true) {
    prepareCollisionMesh(mesh);
    this.robotMeshes.push({ bodyId, bodyName, mesh, checkGround });
  }

  registerEnvironment(id: number, name: string, root: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      prepareCollisionMesh(object);
      meshes.push(object);
    });
    this.environments.set(id, { bodyId: `environment-${id}`, bodyName: name, root, meshes });
  }

  renameEnvironment(id: number, name: string) {
    const body = this.environments.get(id);
    if (body) body.bodyName = name;
  }

  unregisterEnvironment(id: number) {
    this.environments.delete(id);
  }

  meshesForBodies(bodyIds: ReadonlySet<string>) {
    const meshes = this.robotMeshes.filter((body) => bodyIds.has(body.bodyId)).map((body) => body.mesh);
    this.environments.forEach((body) => {
      if (bodyIds.has(body.bodyId)) meshes.push(...body.meshes);
    });
    return meshes;
  }

  debugBounds(): CollisionDebugBounds[] {
    const bodies = new Map<string, CollisionDebugBounds>();
    this.robotMeshes.forEach((body) => {
      if (!body.mesh.visible) return;
      const existing = bodies.get(body.bodyId);
      const bounds = worldBounds(body.mesh, new THREE.Box3());
      if (existing) existing.box.union(bounds);
      else bodies.set(body.bodyId, {
        bodyId: body.bodyId,
        bodyName: body.bodyName,
        kind: 'robot',
        box: bounds,
      });
    });
    this.environments.forEach((body) => {
      if (!body.root.visible) return;
      const box = new THREE.Box3();
      body.meshes.forEach((mesh) => {
        if (mesh.visible) box.union(worldBounds(mesh, new THREE.Box3()));
      });
      if (!box.isEmpty()) bodies.set(body.bodyId, {
        bodyId: body.bodyId,
        bodyName: body.bodyName,
        kind: 'environment',
        box,
      });
    });
    return [...bodies.values()];
  }

  detect(options: { collectAll?: boolean; groundZ?: number } = {}): CollisionReport {
    const hits: CollisionHit[] = [];
    const hitKeys = new Set<string>();
    const collectAll = options.collectAll ?? false;
    const groundZ = options.groundZ ?? 0;
    const addHit = (hit: CollisionHit) => {
      const key = `${hit.bodyAId}|${hit.bodyBId}`;
      if (hitKeys.has(key)) return;
      hitKeys.add(key);
      hits.push(hit);
    };

    for (const robot of this.robotMeshes) {
      if (robot.checkGround && meshPenetratesGround(robot.mesh, groundZ, GROUND_PENETRATION_TOLERANCE_METERS)) {
        addHit({
          bodyAId: robot.bodyId,
          bodyAName: robot.bodyName,
          bodyBId: 'ground',
          bodyBName: 'Ground',
        });
        if (!collectAll) return { collided: true, hits };
      }
    }

    for (const environment of this.environments.values()) {
      if (!environment.root.visible) continue;
      for (const robot of this.robotMeshes) {
        let collided = false;
        for (const environmentMesh of environment.meshes) {
          if (!environmentMesh.visible || !robot.mesh.visible) continue;
          if (meshesIntersect(robot.mesh, environmentMesh)) {
            collided = true;
            break;
          }
        }
        if (!collided) continue;
        addHit({
          bodyAId: robot.bodyId,
          bodyAName: robot.bodyName,
          bodyBId: environment.bodyId,
          bodyBName: environment.bodyName,
        });
        if (!collectAll) return { collided: true, hits };
      }
    }

    return hits.length > 0 ? { collided: true, hits } : EMPTY_REPORT;
  }
}

export function buildCollisionPathSamples(
  path: readonly (readonly number[])[],
  maxJointStepDegrees = DEFAULT_COLLISION_JOINT_STEP_DEGREES,
): CollisionPathSample[] {
  if (!Number.isFinite(maxJointStepDegrees) || maxJointStepDegrees <= 0) {
    throw new Error('Collision joint sample step must be greater than 0.');
  }
  if (path.length === 0) return [];
  if (path.some((joints) => joints.length < 6 || joints.slice(0, 6).some((value) => !Number.isFinite(value)))) {
    throw new Error('Collision paths require at least six finite joint values per point.');
  }

  const segmentSteps = path.slice(1).map((target, segmentIndex) => {
    const start = path[segmentIndex];
    const largestDelta = Math.max(...target.slice(0, 6).map((value, index) => Math.abs(value - start[index])));
    return Math.max(1, Math.ceil(largestDelta / maxJointStepDegrees));
  });
  const totalSteps = segmentSteps.reduce((sum, steps) => sum + steps, 0);
  const samples: CollisionPathSample[] = [{ progress: 0, joints: [...path[0]] }];
  let completedSteps = 0;

  segmentSteps.forEach((steps, segmentIndex) => {
    const start = path[segmentIndex];
    const target = path[segmentIndex + 1];
    for (let step = 1; step <= steps; step += 1) {
      const segmentProgress = step / steps;
      completedSteps += 1;
      samples.push({
        progress: totalSteps === 0 ? 1 : completedSteps / totalSteps,
        joints: start.map((value, index) => value + (target[index] - value) * segmentProgress),
      });
    }
  });
  return samples;
}

export function formatCollisionMessage(hit: CollisionHit, progress?: number) {
  const prefix = progress === undefined ? 'Collision' : `Collision at ${(progress * 100).toFixed(1)}%`;
  return `${prefix}: ${hit.bodyAName} ↔ ${hit.bodyBName}`;
}
