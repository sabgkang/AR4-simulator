import assert from 'node:assert/strict';
import test from 'node:test';
import { saveJsonFile } from './robot-simulator/file-io.ts';

function withWindow(value: object, callback: () => Promise<void>) {
  const original = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
  return callback().finally(() => Object.defineProperty(globalThis, 'window', { configurable: true, value: original }));
}

test('saveJsonFile reports cancellation without claiming success', async () => {
  await withWindow({ showSaveFilePicker: async () => { throw new DOMException('Cancelled', 'AbortError'); } }, async () => {
    assert.deepEqual(await saveJsonFile('plan.json', '{}'), { status: 'cancelled' });
  });
});

test('saveJsonFile reports the actual filename after the stream closes', async () => {
  let closed = false;
  await withWindow({
    showSaveFilePicker: async () => ({
      name: 'renamed.json',
      createWritable: async () => ({
        write: async () => undefined,
        close: async () => { closed = true; },
      }),
    }),
  }, async () => {
    assert.deepEqual(await saveJsonFile('plan.json', '{}'), { status: 'saved', filename: 'renamed.json' });
    assert.equal(closed, true);
  });
});
