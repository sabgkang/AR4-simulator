import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { buildCollisionPathSamples, CollisionWorld, formatCollisionMessage } from './robot-simulator/collision.ts';
import { JOINT_FRAMES, JOINT_ZERO_OFFSETS, LINK_MESHES, LINK_MESH_TRANSFORMS, MESH_ROOT, PRESETS } from './robot-simulator/config.ts';

function box(size = 1) {
  return new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial());
}

test('detects AR4 collision with an imported mesh', () => {
  const world = new CollisionWorld();
  const link = box();
  const fixture = box();
  world.registerRobotMesh('robot-link-2', 'Link 2', link, false);
  world.registerEnvironment(4, 'Fixture', fixture);
  assert.equal(world.detect().collided, true);

  fixture.position.x = 2;
  assert.equal(world.detect().collided, false);
});

test('hidden imported objects do not participate in collision detection', () => {
  const world = new CollisionWorld();
  const link = box();
  const fixture = box();
  fixture.visible = false;
  world.registerRobotMesh('robot-link-3', 'Link 3', link, false);
  world.registerEnvironment(5, 'Hidden fixture', fixture);
  assert.equal(world.detect().collided, false);
});

test('overlapping AR4 links are intentionally not checked against each other', () => {
  const world = new CollisionWorld();
  world.registerRobotMesh('robot-link-2', 'Link 2', box(), false);
  world.registerRobotMesh('robot-link-5', 'Link 5', box(), false);
  assert.equal(world.detect().collided, false);
});

test('debug bounds combine robot meshes by link and imported meshes by object', () => {
  const world = new CollisionWorld();
  const linkPartA = box();
  const linkPartB = box();
  linkPartB.position.x = 2;
  world.registerRobotMesh('robot-link-2', 'Link 2', linkPartA, false);
  world.registerRobotMesh('robot-link-2', 'Link 2', linkPartB, false);
  const fixture = new THREE.Group();
  fixture.add(box());
  world.registerEnvironment(9, 'Fixture', fixture);

  const bounds = world.debugBounds();
  assert.equal(bounds.length, 2);
  assert.equal(bounds.find((body) => body.bodyId === 'robot-link-2')?.box.max.x, 2.5);
  assert.equal(bounds.find((body) => body.bodyId === 'environment-9')?.kind, 'environment');
});

test('ground collision applies only to opted-in AR4 meshes', () => {
  const world = new CollisionWorld();
  const base = box();
  const link = box();
  base.position.z = -0.25;
  link.position.z = -0.25;
  world.registerRobotMesh('robot-base', 'Base', base, false);
  world.registerRobotMesh('robot-link-1', 'Link 1', link, true);
  const report = world.detect();
  assert.equal(report.collided, true);
  assert.equal(report.hits[0].bodyAName, 'Link 1');
  assert.equal(report.hits[0].bodyBName, 'Ground');
});

test('imported objects are not checked against the ground', () => {
  const world = new CollisionWorld();
  const fixture = box();
  fixture.position.z = -2;
  world.registerEnvironment(8, 'Below ground fixture', fixture);
  assert.equal(world.detect().collided, false);
});

test('collision path sampling catches intermediate joint poses', () => {
  const samples = buildCollisionPathSamples([
    [0, 0, 0, 0, 0, 0],
    [0, 2, 0, 0, 0, 0],
  ], 0.5);
  assert.deepEqual(samples.map((sample) => sample.joints[1]), [0, 0.5, 1, 1.5, 2]);
  assert.equal(samples.at(-1)?.progress, 1);
  assert.equal(formatCollisionMessage({ bodyAId: 'a', bodyAName: 'Link 2', bodyBId: 'b', bodyBName: 'Fixture' }, 0.425), 'Collision at 42.5%: Link 2 ↔ Fixture');
});

test('standard AR4 poses remain above the collision ground', async () => {
  const world = new CollisionWorld();
  const root = new THREE.Group();
  const loader = new STLLoader();
  const rotors: THREE.Group[] = [];
  let parent: THREE.Object3D = root;

  for (let index = 0; index < JOINT_FRAMES.length; index += 1) {
    const fixedFrame = new THREE.Group();
    const frame = JOINT_FRAMES[index];
    fixedFrame.position.set(frame.xyz[0], frame.xyz[1], frame.xyz[2]);
    fixedFrame.rotation.set(frame.rpy[0], frame.rpy[1], frame.rpy[2], 'ZYX');
    parent.add(fixedFrame);
    const rotor = new THREE.Group();
    fixedFrame.add(rotor);
    rotors.push(rotor);
    for (const filename of LINK_MESHES[index]) {
      const bytes = await readFile(`public${MESH_ROOT}${filename}`);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const mesh = new THREE.Mesh(loader.parse(data));
      const transform = LINK_MESH_TRANSFORMS[index];
      mesh.position.set(transform.xyz[0], transform.xyz[1], transform.xyz[2]);
      mesh.rotation.set(transform.rpy[0], transform.rpy[1], transform.rpy[2], 'ZYX');
      rotor.add(mesh);
      world.registerRobotMesh(`robot-link-${index + 1}`, `Link ${index + 1}`, mesh, true);
    }
    parent = rotor;
  }

  Object.entries(PRESETS).forEach(([name, pose]) => {
    rotors.forEach((rotor, index) => rotor.quaternion.setFromAxisAngle(
      new THREE.Vector3(...JOINT_FRAMES[index].axis),
      THREE.MathUtils.degToRad(pose[index]) + JOINT_ZERO_OFFSETS[index],
    ));
    root.updateWorldMatrix(true, true);
    assert.equal(world.detect().collided, false, `${name} should not collide with the ground`);
  });
});
