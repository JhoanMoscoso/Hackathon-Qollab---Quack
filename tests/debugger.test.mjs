// Tests for the pure helpers of js/debugger.js. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROB_ORDER, barData, circuitColumns, liveText } from '../js/debugger.js';

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
