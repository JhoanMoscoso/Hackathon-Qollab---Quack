// Tests for the pure helpers of js/debugger.js. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROB_ORDER, barData, circuitColumns, liveText, statusRows, samplingLabel, describeChange, changedBars, hintFor,
} from '../js/debugger.js';

test('PROB_ORDER is the fixed game order', () => {
  assert.deepEqual(PROB_ORDER, ['00', '01', '10', '11']);
});

test('barData follows PROB_ORDER regardless of key order', () => {
  const bars = barData({ 11: 0.5, 10: 0, '01': 0, '00': 0.5 });
  assert.deepEqual(bars.map((b) => b.key), ['00', '01', '10', '11']);
  assert.deepEqual(bars.map((b) => b.label), ['|00⟩', '|01⟩', '|10⟩', '|11⟩']);
  assert.deepEqual(bars.map((b) => b.pct), ['50.0%', '0.0%', '0.0%', '50.0%']);
  assert.equal(bars[0].p, 0.5);
});

test('barData formats rounding and tolerates missing keys', () => {
  const bars = barData({ '00': 1 / 3, '11': 2 / 3 });
  assert.equal(bars[0].pct, '33.3%');
  assert.equal(bars[3].pct, '66.7%');
  assert.equal(bars[1].p, 0);
  assert.equal(bars[1].pct, '0.0%');
  assert.deepEqual(barData(undefined).map((b) => b.pct), ['0.0%', '0.0%', '0.0%', '0.0%']);
});

test('circuitColumns: one column per history entry', () => {
  const cols = circuitColumns([['h', 0], ['cx', 0, 1], ['x', 1], ['z', 0], ['m', 1, 0]]);
  assert.deepEqual(cols, [
    { kind: 'gate', label: 'H', qubit: 0 },
    { kind: 'cx', label: 'CX', control: 0, target: 1 },
    { kind: 'gate', label: 'X', qubit: 1 },
    { kind: 'gate', label: 'Z', qubit: 0 },
    { kind: 'm', label: 'M', qubit: 1, outcome: 0 },
  ]);
});

test('circuitColumns: empty or missing history', () => {
  assert.deepEqual(circuitColumns([]), []);
  assert.deepEqual(circuitColumns(undefined), []);
});

test('circuitColumns ignores malformed entries', () => {
  assert.deepEqual(circuitColumns([null, [], ['h', 0]]), [{ kind: 'gate', label: 'H', qubit: 0 }]);
});

test('circuitColumns: measurement aliases m / M / measure are equivalent', () => {
  for (const name of ['m', 'M', 'measure']) {
    assert.deepEqual(circuitColumns([[name, 1, 0]]), [{ kind: 'm', label: 'M', qubit: 1, outcome: 0 }], name);
  }
});

test('circuitColumns: measurement without outcome keeps label "M"', () => {
  const [col] = circuitColumns([['m', 0]]);
  assert.equal(col.kind, 'm');
  assert.equal(col.label, 'M');
  assert.equal(col.outcome, undefined);
});

test('circuitColumns: unknown gate names are uppercased and cut to 3 chars', () => {
  assert.equal(circuitColumns([['sdg', 0]])[0].label, 'SDG');
  assert.equal(circuitColumns([['rotation', 1]])[0].label, 'ROT');
  assert.equal(circuitColumns([['cx', 0, 1]])[0].kind, 'cx');
  assert.equal(circuitColumns([['CX', 0, 1]])[0].kind, 'cx');
  assert.equal(circuitColumns([[7, 0]])[0].label, '7');
});

const bell = { ket: '0.707|00⟩ + 0.707|11⟩', bell_label: 'Phi+', entangled: true };

test('liveText: ket + Bell label + measurement', () => {
  assert.equal(
    liveText(bell, { qubit: 0, outcome: 1 }),
    'State: 0.707|00⟩ + 0.707|11⟩. Bell state Phi+. Measured Alice qubit: 1.',
  );
  assert.equal(
    liveText(bell, { qubit: 1, outcome: 0 }),
    'State: 0.707|00⟩ + 0.707|11⟩. Bell state Phi+. Measured Bob qubit: 0.',
  );
});

test('liveText: no Bell label, no measurement', () => {
  assert.equal(liveText({ ket: '|01⟩', bell_label: null }, null), 'State: |01⟩.');
  assert.equal(liveText({ ket: '|01⟩' }, undefined), 'State: |01⟩.');
});

test('liveText: no snapshot yet', () => {
  assert.equal(liveText(null, null), '');
});

// ---------- Batch D helpers ----------
test('circuitColumns: initial circuit comes first, flagged as prepared', () => {
  const cols = circuitColumns([['x', 1]], [['h', 0], ['cx', 0, 1]]);
  assert.deepEqual(cols, [
    { kind: 'gate', label: 'H', qubit: 0, prep: true },
    { kind: 'cx', label: 'CX', control: 0, target: 1, prep: true },
    { kind: 'gate', label: 'X', qubit: 1 },
  ]);
  assert.deepEqual(circuitColumns([['h', 0]], []), [{ kind: 'gate', label: 'H', qubit: 0 }]);
  assert.deepEqual(circuitColumns(undefined, undefined), []);
});

test('circuitColumns: ["run"] becomes a run barrier', () => {
  const cols = circuitColumns([['h', 0], ['cx', 0, 1], ['run'], ['measure', 0, 1]]);
  assert.deepEqual(cols[2], { kind: 'run', label: 'RUN' });
  assert.equal(cols.length, 4);
});

const snapOf = (over = {}) => ({
  ket: '|00⟩', bell_label: null, entangled: false, source: 'statevector_fallback',
  probs: { '00': 1, '01': 0, '10': 0, '11': 0 }, marginals: [[1, 0], [1, 0]],
  stage_index: 0, stage_count: 1,
  objective: { status: 'pending', requires_run: null, validated: false },
  ...over,
});
const rowMap = (rows) => Object.fromEntries(rows.map((r) => [r.name, r.value]));

test('statusRows: circuit row only when the stage requires a run', () => {
  assert.equal('Circuit' in rowMap(statusRows(snapOf(), null)), false);
  const need = snapOf({ objective: { status: 'pending', requires_run: 'Phi+', validated: false } });
  assert.equal(rowMap(statusRows(need, null)).Circuit, 'building');
  const done = snapOf({ objective: { status: 'pending', requires_run: 'Phi+', validated: true } });
  assert.equal(rowMap(statusRows(done, null)).Circuit, 'validated ✓');
});

test('statusRows: objective, stage and sampling', () => {
  const rows = rowMap(statusRows(snapOf({ stage_index: 1, stage_count: 2, objective: { status: 'ready' } }), null));
  assert.equal(rows.Objective, 'ready');
  assert.equal(rows.Stage, '2 / 2');
  assert.equal(rows.Sampling, 'local');
  assert.equal(rowMap(statusRows(snapOf({ objective: { status: 'failed' } }), null)).Objective, 'failed');
});

test('samplingLabel: backend / local / mixed from the snapshot and the boot summary', () => {
  assert.equal(samplingLabel('backend', null), 'backend');
  assert.equal(samplingLabel('statevector_fallback', null), 'local');
  assert.equal(samplingLabel('mixed', null), 'mixed');
  assert.equal(samplingLabel(undefined, { source: 'backend' }), 'backend');
  assert.equal(samplingLabel(undefined, null), 'local');
  assert.equal(samplingLabel('statevector_fallback', { source: 'mixed' }), 'local (other states: backend)');
  assert.equal(samplingLabel('backend', { source: 'mixed' }), 'backend');
});

const phi = snapOf({
  ket: '0.707|00⟩ + 0.707|11⟩', bell_label: 'Phi+', entangled: true, marginals: [[0.5, 0.5], [0.5, 0.5]],
  probs: { '00': 0.5, '01': 0, '10': 0, '11': 0.5 },
});
const psi = { ...phi, ket: '0.707|10⟩ + 0.707|01⟩', bell_label: 'Psi+', probs: { '00': 0, '01': 0.5, '10': 0.5, '11': 0 } };

test('describeChange: Bob X on Phi+ names the Bell change and the correlation', () => {
  const text = describeChange(phi, psi, { gate: 'x', qubit: 1, actor: 'bob' });
  assert.ok(text.startsWith('Bob applied X to q1: Phi+ → Psi+ (results now always opposite)'), text);
  assert.ok(/50\/50/.test(text), 'explains why doors do not change');
});

test('describeChange: Alice H from |00⟩ shows kets', () => {
  const next = snapOf({
    ket: '0.707|00⟩ + 0.707|10⟩', probs: { '00': 0.5, '01': 0, '10': 0.5, '11': 0 }, marginals: [[0.5, 0.5], [1, 0]],
  });
  assert.equal(describeChange(snapOf(), next, { gate: 'h', qubit: 0, actor: 'alice' }),
    'Alice applied H to q0: |00⟩ → 0.707|00⟩ + 0.707|10⟩');
});

test('describeChange: a lone basis ket drops the engine\'s "1" coefficient', () => {
  const text = describeChange(snapOf({ ket: '1|00⟩' }), snapOf({ ket: '1|10⟩' }), { gate: 'x', qubit: 0, actor: 'alice' });
  assert.equal(text, 'Alice applied X to q0: |00⟩ → |10⟩');
});

test('describeChange: CNOT creating Phi+ reports entanglement', () => {
  const prev = snapOf({ ket: '0.707|00⟩ + 0.707|10⟩', marginals: [[0.5, 0.5], [1, 0]] });
  const text = describeChange(prev, phi, { gate: 'cx', qubit: 0, target: 1, actor: 'shared' });
  assert.equal(text, 'CNOT applied: 0.707|00⟩ + 0.707|10⟩ → Phi+ (entangled; results now always the same)');
});

test('describeChange: Z on Phi+ gives Phi-, unchanged state is said so, run and measure', () => {
  const minus = { ...phi, bell_label: 'Phi-', ket: '0.707|00⟩ - 0.707|11⟩' };
  assert.ok(describeChange(phi, minus, { gate: 'z', qubit: 0, actor: 'alice' }).includes('Phi+ → Phi- (results now always the same)'));
  assert.ok(describeChange(snapOf(), snapOf(), { gate: 'x', qubit: 0 }).includes('state unchanged'));
  assert.equal(describeChange(phi, phi, { type: 'run' }), 'Circuit validated: Phi+ ✓');
  assert.equal(describeChange(snapOf(), snapOf(), { type: 'measure', qubit: 1, outcome: 0 }), 'Bob measured q1: 0');
  assert.equal(describeChange(null, snapOf(), { gate: 'x', qubit: 0 }), '');
});

test('changedBars: keys whose probability changed', () => {
  assert.deepEqual(changedBars(phi, psi), ['00', '01', '10', '11']);
  assert.deepEqual(changedBars(snapOf(), phi), ['00', '11']);
  assert.deepEqual(changedBars(phi, phi), []);
  assert.deepEqual(changedBars(null, phi), []);
});

test('hintFor: known engine codes map to short hints, unknown ones keep the engine message', () => {
  assert.equal(hintFor('CIRCUIT_MISMATCH', 'x'), "Circuit isn't Phi+ yet. Press R to reset.");
  assert.equal(hintFor('NOT_VALIDATED', 'x'), 'Build the circuit, then press Space to run it.');
  assert.equal(hintFor('CIRCUIT_LOCKED', 'x'), 'Circuit already validated — measure now.');
  assert.equal(hintFor('RUN_NOT_REQUIRED', 'x'), 'This stage has no run step.');
  assert.equal(hintFor('STAGE_FINISHED', 'x'), 'Stage finished — head to the exits.');
  assert.equal(hintFor('INVALID_ACTOR', 'x'), "That terminal isn't yours.");
  assert.equal(hintFor('GATE_NOT_ALLOWED', 'x'), "That terminal isn't yours.");
  assert.equal(hintFor('SOMETHING_ELSE', 'engine says no'), 'engine says no');
  assert.equal(hintFor(undefined, 'plain'), 'plain');
});
