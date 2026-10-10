import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callEngine, runProbe, summarize } from '../dev/qollab-bridge/probe.js';

test('bridge call awaits callPromising and rejects JSON errors', async () => {
  const engine = { broken: { callPromising: async () => JSON.stringify({ error: 'bad', code: 'INVALID' }) } };
  await assert.rejects(callEngine(engine, 'broken'), /INVALID: bad/);
});

test('timing summary sorts a copy and reports nearest-rank percentiles', () => {
  const samples = [4, 1, 3, 2];
  assert.deepEqual(summarize(samples), { samples: 4, p50_ms: 2, p95_ms: 4, max_ms: 4 });
  assert.deepEqual(samples, [4, 1, 3, 2]);
});

test('bridge warms up, excludes setup and precomputes once', async () => {
  const calls = [];
  const snapshot = { objective: { quantum_ready: true }, source: 'backend',
    sampling: { counts: { '00': 100, '11': 100 } }, last_measurement: { source: 'backend' } };
  const result = (name, args) => {
    if (name === 'snapshot') return snapshot;
    if (name === 'precompute') return { backend_states: 10, source: 'mixed' };
    if (name === 'measure') return { outcome: args[0], snapshot };
    return {};
  };
  const engine = Object.fromEntries(['load_level', 'new_session', 'precompute', 'snapshot', 'apply_gate', 'measure', 'reset_stage']
    .map((name) => [name, { callPromising: async (...args) => {
      calls.push({ name, args });
      return JSON.stringify(result(name, args));
    } }]));
  let clock = 0;
  const report = await runProbe(engine, 'provided-backend', () => clock++);
  assert.equal(calls.filter(({ name }) => name === 'precompute').length, 1);
  assert.deepEqual(calls.find(({ name }) => name === 'precompute').args, ['provided-backend', 200]);
  assert.equal(calls.filter(({ name }) => name === 'reset_stage').length, 23);
  assert.equal(report.timings.apply_gate.samples, 20);
  assert.equal(report.timings.measure.samples, 20);
  assert.equal(report.timings.snapshot.samples, 20);
  assert.equal(report.target_20ms_met, true);
});
