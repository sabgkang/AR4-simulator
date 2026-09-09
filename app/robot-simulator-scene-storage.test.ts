import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeSceneFilename, storeModelFile, storeSceneFile } from './robot-simulator/scene-storage.ts';

test('normalizes scene filenames and keeps the json extension', () => {
  assert.equal(normalizeSceneFilename('assembly draft.JSON'), 'assembly draft.json');
  assert.equal(normalizeSceneFilename('scene'), 'scene.json');
});

test('reuses matching model content and numbers only different files with the same name', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ar4-scene-storage-'));
  try {
    assert.equal(await storeModelFile('case.step', new Uint8Array([1]), projectRoot), 'Models/case.step');
    assert.equal(await storeModelFile('case.step', new Uint8Array([1]), projectRoot), 'Models/case.step');
    assert.equal(await storeModelFile('case.step', new Uint8Array([2]), projectRoot), 'Models/case-2.step');
    assert.equal(await storeModelFile('case.step', new Uint8Array([2]), projectRoot), 'Models/case-2.step');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('stores a named scene inside Scenes', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ar4-scene-storage-'));
  try {
    assert.equal(await storeSceneFile('cell-layout', '{"version":1}', false, projectRoot), 'cell-layout.json');
    assert.equal(await readFile(path.join(projectRoot, 'Scenes', 'cell-layout.json'), 'utf8'), '{"version":1}');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('concurrent matching uploads resolve to one stored model', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'ar4-scene-storage-'));
  try {
    const paths = await Promise.all(Array.from({ length: 4 }, () => storeModelFile('tool.stl', new Uint8Array([4, 2]), projectRoot)));
    assert.deepEqual([...new Set(paths)], ['Models/tool.stl']);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
