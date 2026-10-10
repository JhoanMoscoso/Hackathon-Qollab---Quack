// Tests for the DEV-ONLY mock engine (js/mock_engine.js). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as eng from '../js/mock_engine.js';

// Seeded PRNG (mulberry32) so statistical tests are reproducible.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const call = async (name, ...args) => JSON.parse(await eng[name].callPromising(...args));
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} !~ ${b}`);

const ALL = { alice: ['h', 'z', 'x'], bob: ['x', 'h', 'z'], shared: ['cx'] };
const OBJECTS = {
  door_A: { qubit: 0, open_on: 0, lethal: false },
  door_B: { qubit: 1, open_on: 0, lethal: true },
};

let n = 0;
// Registers a fresh test level and opens a session on it; returns the snapshot.
async function session(initial, opts = {}) {
  const id = `t${n++}`;
  eng.__loadLevelObject({
    id, title: id, initial_circuit: initial,
    gate_set: opts.gate_set ?? ALL, max_gates: opts.max_gates ?? 6,
    win: { q0: 0, q1: 0 }, objects: OBJECTS,
  });
  await call('load_level', id);
  return call('new_session', id);
}
const PHI_PLUS = [['h', 0], ['cx', 0, 1]];

test('Phi+ measured q0 then q1 1000x -> always equal', async () => {
  eng.__setRng(mulberry32(1234));
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    await session(PHI_PLUS);
    const a = await call('measure', 0);
    const b = await call('measure', 1);
    assert.equal(a.outcome, b.outcome);
    assert.equal(a.qubit, 0);
    seen.add(a.outcome);
  }
  assert.equal(seen.size, 2, 'both outcomes should occur');
});

test('Phi+ + X(q1) -> always opposite, bell_label Psi+', async () => {
  eng.__setRng(mulberry32(99));
  for (let i = 0; i < 1000; i++) {
    await session(PHI_PLUS);
    const s = await call('apply_gate', 'x', 1);
    assert.equal(s.bell_label, 'Psi+');
    const a = await call('measure', 0);
    const b = await call('measure', 1);
    assert.notEqual(a.outcome, b.outcome);
  }
});

test('Phi+ -> CX -> H(0) gives |00> with p=1', async () => {
  const s0 = await session(PHI_PLUS);
  close(s0.probs['00'], 0.5); close(s0.probs['11'], 0.5);
  await call('apply_gate', 'cx', 0, 1);
  const s = await call('apply_gate', 'h', 0);
  close(s.probs['00'], 1);
  assert.equal(s.entangled, false);
});

test('H,Z,H on |0> (q0) -> |10>', async () => {
  await session([]);
  await call('apply_gate', 'h', 0);
  await call('apply_gate', 'z', 0);
  const s = await call('apply_gate', 'h', 0);
  close(s.probs['10'], 1);
});

test('X(q0) on |00> -> probs["10"]=1, not "01"', async () => {
  await session([]);
  const s = await call('apply_gate', 'x', 0);
  close(s.probs['10'], 1);
  close(s.probs['01'], 0);
  close(s.marginals[0][1], 1);
  close(s.marginals[1][1], 0);
});

test('bell labels Phi+, Phi-, Psi+, Psi-, null', async () => {
  assert.equal((await session(PHI_PLUS)).bell_label, 'Phi+');
  assert.equal((await session([...PHI_PLUS, ['z', 0]])).bell_label, 'Phi-');
  assert.equal((await session([...PHI_PLUS, ['x', 1]])).bell_label, 'Psi+');
  assert.equal((await session([...PHI_PLUS, ['x', 1], ['z', 0]])).bell_label, 'Psi-');
  assert.equal((await session([['h', 0]])).bell_label, null);
});

test('global phase is ignored: label and state_key', async () => {
  const s = await session(PHI_PLUS);
  const key = s.state_key;
  // X Z X Z = -I on q0 -> global phase -1
  for (const g of ['x', 'z', 'x', 'z']) await call('apply_gate', g, 0);
  const t = await call('snapshot');
  assert.equal(t.bell_label, 'Phi+');
  assert.equal(t.state_key, key);
  const u = await call('apply_gate', 'z', 0); // Phi-
  assert.notEqual(u.state_key, key);
  assert.equal(typeof key, 'string');
});

test('entangled: true for Phi+, false for |+0>', async () => {
  assert.equal((await session(PHI_PLUS)).entangled, true);
  assert.equal((await session([['h', 0]])).entangled, false);
});

test('ket string and snapshot shape', async () => {
  const s = await session(PHI_PLUS);
  assert.equal(s.ket, '0.707|00⟩ + 0.707|11⟩');
  assert.equal(s.num_qubits, 2);
  assert.equal(s.amplitudes.length, 4);
  // (JS orders integer-like keys first, so compare as a sorted set)
  assert.deepEqual(Object.keys(s.probs).sort(), ['00', '01', '10', '11']);
  assert.deepEqual(s.measured, [null, null]);
  assert.deepEqual(s.history, [['h', 0], ['cx', 0, 1]]);
  assert.equal(s.gates_left, 6);
  assert.equal((await session(PHI_PLUS.concat([['z', 0]]))).ket, '0.707|00⟩ - 0.707|11⟩');
  assert.equal((await session([['x', 0]])).ket, '|10⟩');
});

test('objects: super for Phi+, definite after measuring', async () => {
  eng.__setRng(mulberry32(7));
  const s = await session(PHI_PLUS);
  assert.deepEqual(s.objects, { door_A: 'super', door_B: 'super' });
  const m = await call('measure', 0);
  const o = m.snapshot.objects;
  assert.equal(o.door_A, String(m.outcome));
  assert.equal(o.door_B, String(m.outcome));
  assert.deepEqual(m.snapshot.measured, [m.outcome, null]);
  assert.deepEqual(m.snapshot.history.at(-1), ['m', 0, m.outcome]);
  // definite "1" case
  const x = await session([['x', 0]]);
  assert.deepEqual(x.objects, { door_A: '1', door_B: '0' });
});

test('correlation rule: unmeasured fixed qubit accepts gates, measured one rejects', async () => {
  await session(PHI_PLUS);
  await call('measure', 0);
  const ok = await call('apply_gate', 'x', 1);
  assert.equal(ok.error, undefined);
  assert.equal(ok.measured[1], null);
  const bad = await call('apply_gate', 'h', 0);
  assert.equal(typeof bad.error, 'string');
  const badCx = await call('apply_gate', 'cx', 0, 1);
  assert.equal(typeof badCx.error, 'string');
  const again = await call('measure', 0);
  assert.equal(typeof again.error, 'string');
});

test('budget: gates_left counts player gates only; exhausted -> error', async () => {
  const s = await session(PHI_PLUS, { max_gates: 2 });
  assert.equal(s.gates_left, 2);
  assert.equal((await call('apply_gate', 'z', 0)).gates_left, 1);
  const last = await call('apply_gate', 'z', 0);
  assert.equal(last.gates_left, 0);
  const err = await call('apply_gate', 'z', 0);
  assert.equal(typeof err.error, 'string');
  assert.equal((await call('snapshot')).gates_left, 0);
});

test('gate not in gate set / unknown gate / wrong owner -> error', async () => {
  await session(PHI_PLUS, { gate_set: { alice: ['h', 'z'], bob: ['x'], shared: ['cx'] } });
  assert.ok((await call('apply_gate', 'x', 0)).error, 'alice has no x');
  assert.ok((await call('apply_gate', 'h', 1)).error, 'bob has no h');
  assert.ok((await call('apply_gate', 'y', 0)).error, 'unknown gate');
  assert.ok((await call('apply_gate', 'cx', 1, 0)).error, 'cx must be control 0 target 1');
  assert.equal((await call('apply_gate', 'x', 1)).error, undefined);
  assert.equal((await call('apply_gate', 'cx', 0, 1)).error, undefined);
  assert.equal((await call('snapshot')).history.length, 4);
});

test('reset_level restores initial state, history, measured, budget', async () => {
  eng.__setRng(mulberry32(3));
  const s0 = await session(PHI_PLUS);
  await call('apply_gate', 'z', 0);
  await call('measure', 1);
  const r = await call('reset_level');
  assert.deepEqual(r, s0);
});

test('precompute stub', async () => {
  assert.deepEqual(await call('precompute'), { states: 0, circuits: 0, source: 'mock', backend: 'mock' });
});

test('load_level returns level with num_qubits; unknown id -> error', async () => {
  const lv = await call('load_level', 't0');
  assert.equal(lv.num_qubits, 2);
  assert.equal(lv.id, 't0');
  assert.ok((await call('new_session', 'nope-not-loaded')).error);
});

test('levels/test.json: 12 rows x 20 cols, centre wall, loads and plays', async () => {
  const lv = JSON.parse(readFileSync(new URL('../levels/test.json', import.meta.url), 'utf8'));
  assert.equal(lv.id, 'test');
  assert.equal(lv.map.length, 12);
  for (const row of lv.map) assert.equal(row.length, 20);
  const niche = new Set();
  lv.map.forEach((row, y) => {
    assert.equal(row[0], '#'); assert.equal(row[19], '#');
    for (const x of [9, 10]) {
      const ch = row[x];
      if (ch !== '#') niche.add(`${x},${y},${lv.legend[ch]}`);
    }
  });
  assert.equal(niche.size, 2);
  const ys = [...niche].map((k) => k.split(',')[1]);
  assert.equal(ys[0], ys[1], 'CNOT control/target on the same row');
  assert.ok([...niche].some((k) => k.startsWith('9,') && k.endsWith('cnot_control')));
  assert.ok([...niche].some((k) => k.startsWith('10,') && k.endsWith('cnot_target')));
  for (const t of lv.terminals) {
    assert.equal(lv.map[t.cell[1]][t.cell[0]] !== '#', true);
  }
  const count = (name) => lv.map.join('').split('').filter((c) => lv.legend[c] === name).length;
  for (const nm of ['alice_start', 'bob_start', 'exit_A', 'exit_B', 'door_A', 'door_B', 'sensor_q0', 'sensor_q1']) {
    assert.equal(count(nm), 1, nm);
  }
  eng.__loadLevelObject(lv);
  const loaded = await call('load_level', 'test');
  assert.equal(loaded.num_qubits, 2);
  const s = await call('new_session', 'test');
  assert.equal(s.bell_label, 'Phi+');
  assert.equal(s.gates_left, 6);
  assert.deepEqual(s.objects, { door_A: 'super', door_B: 'super' });
});
