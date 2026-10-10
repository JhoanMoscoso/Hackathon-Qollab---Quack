import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../js/async_util.js';

const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('withTimeout resolves with the value when the promise wins', async () => {
  assert.deepEqual(await withTimeout(later(5, 'ok'), 200), { timedOut: false, value: 'ok' });
});

test('withTimeout reports a timeout and leaves the original promise running', async () => {
  let finished = false;
  const slow = later(60, 'late').then((v) => { finished = true; return v; });
  assert.deepEqual(await withTimeout(slow, 10), { timedOut: true });
  assert.equal(finished, false);
  assert.equal(await slow, 'late'); // the task was not cancelled
  assert.equal(finished, true);
});

test('withTimeout propagates a rejection that happens before the timeout', async () => {
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 100), /boom/);
});

test('withTimeout clears its timer when the promise wins (no pending handle)', async () => {
  const realClear = globalThis.clearTimeout;
  let cleared = 0;
  globalThis.clearTimeout = (id) => { cleared++; return realClear(id); };
  try {
    await withTimeout(Promise.resolve(1), 10_000);
  } finally { globalThis.clearTimeout = realClear; }
  assert.equal(cleared, 1);
});
