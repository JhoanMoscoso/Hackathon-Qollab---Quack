import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bridge from '../dev/engine_bridge.js';

const NAMES = ['load_level', 'new_session', 'precompute', 'apply_gate', 'measure', 'reset_level',
  'reset_stage', 'advance_stage', 'snapshot', 'load_audio', 'run_circuit'];

function stubFetch(t, impl) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init); };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('every engine function name is exported with callPromising', () => {
  for (const name of NAMES) assert.equal(typeof bridge[name]?.callPromising, 'function', name);
});

test('posts args to /engine/<fn> and returns the response text', async (t) => {
  const calls = stubFetch(t, async () => ({ text: async () => '{"ok":"|00⟩"}' }));
  const out = await bridge.apply_gate.callPromising('h', 0, -1, null, 'alice');
  assert.equal(out, '{"ok":"|00⟩"}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/engine/apply_gate');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { args: ['h', 0, -1, null, 'alice'] });
});

test('returns the error JSON text even on 4xx/5xx responses', async (t) => {
  stubFetch(t, async () => ({ ok: false, status: 404, text: async () => '{"error":"x","code":"UNKNOWN_FUNCTION"}' }));
  assert.equal(await bridge.snapshot.callPromising(), '{"error":"x","code":"UNKNOWN_FUNCTION"}');
});

test('network failure resolves to a BRIDGE_ERROR payload', async (t) => {
  stubFetch(t, async () => { throw new TypeError('fetch failed'); });
  const parsed = JSON.parse(await bridge.measure.callPromising(0));
  assert.equal(parsed.code, 'BRIDGE_ERROR');
  assert.match(parsed.error, /fetch failed/);
});

test('precompute sends null instead of the backend object', async (t) => {
  const calls = stubFetch(t, async () => ({ text: async () => '{}' }));
  await bridge.precompute.callPromising({ some: 'backend' }, 200);
  assert.deepEqual(JSON.parse(calls[0].init.body), { args: [null, 200] });
  await bridge.precompute.callPromising();
  assert.deepEqual(JSON.parse(calls[1].init.body), { args: [null] });
});
