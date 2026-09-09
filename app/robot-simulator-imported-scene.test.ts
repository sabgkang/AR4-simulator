import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportedSceneFilename, parseImportedScene, serializeImportedScene } from './robot-simulator/imported-scene.ts';

const MODEL = {
  id: 7,
  name: 'Fixture',
  filename: 'fixture.step',
  format: 'step' as const,
  sourcePath: 'Models/fixture.step',
  visible: false,
  transform: { x: 12.25, y: -4, z: 9.5, rx: 10, ry: 20.5, rz: -30 },
};

test('creates the requested local-time scene filename', () => {
  assert.equal(createImportedSceneFilename(new Date(2026, 8, 9, 14, 5)), 'ar4-mk4-scene-2026-09-09-14-05.json');
});

test('serializes model data without transient object ids and parses it back', () => {
  const serialized = serializeImportedScene([MODEL]);
  assert.equal(serialized.includes('"id"'), false);
  assert.deepEqual(parseImportedScene(JSON.parse(serialized)), {
    version: 1,
    robotTransform: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
    models: [{
      name: MODEL.name,
      filename: MODEL.filename,
      format: MODEL.format,
      sourcePath: MODEL.sourcePath,
      visible: MODEL.visible,
      transform: MODEL.transform,
    }],
  });
});

test('round-trips the AR4-MK5 position and orientation', () => {
  const robotTransform = { x: 100, y: 200, z: 300, rx: 10, ry: 20, rz: 30 };
  assert.deepEqual(parseImportedScene(JSON.parse(serializeImportedScene([], robotTransform))).robotTransform, robotTransform);
});

test('loads older scene files with the AR4-MK5 at world origin', () => {
  assert.deepEqual(parseImportedScene({ version: 1, models: [] }).robotTransform, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
});

test('rejects scene models with invalid transform values', () => {
  const scene = JSON.parse(serializeImportedScene([MODEL])) as { models: Array<{ transform: { x: unknown } }> };
  scene.models[0].transform.x = '12';
  assert.throws(() => parseImportedScene(scene), /invalid x value/);
});

test('rejects model paths outside Models', () => {
  const scene = JSON.parse(serializeImportedScene([MODEL])) as { models: Array<{ sourcePath: string }> };
  scene.models[0].sourcePath = '../fixture.step';
  assert.throws(() => parseImportedScene(scene), /invalid model path/);
});
