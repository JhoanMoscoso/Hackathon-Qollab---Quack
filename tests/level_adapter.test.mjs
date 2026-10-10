// Tests for js/level_adapter.js against the real v2 levels. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageView } from '../js/level_adapter.js';
import { loadLevel } from './helpers.mjs';

test('level1 stage 0 becomes a flat view with the stage fields', () => {
  const level = loadLevel(1);
  const v = stageView(level, 0);
  assert.equal(v.id, 'level1');
  assert.equal(v.stageId, 'bell_preparation');
  assert.equal(v.title, 'Build, Run, Measure and Escape'); // stage title wins over level.title
  assert.deepEqual(v.map, level.stages[0].map);
  assert.deepEqual(v.legend, level.stages[0].legend);
  assert.deepEqual(v.objects, level.stages[0].objects);
  assert.deepEqual(v.win, { parity: 'equal' });
  assert.equal(v.failure_policy, 'retry_stage');
  assert.equal('requires_run' in v, false); // L1 validation lives in the engine (circuit_validation), not in the view
  assert.deepEqual(v.initial_circuit, []);
  assert.deepEqual(v.gate_set, { alice: ['h'], bob: ['cx'], shared: [] });
  assert.equal(v.max_gates, 2);
  assert.match(v.narration.circuit_validated, /Bell state verified/);
  assert.ok(v.narration.validation_failed);
});

test('terminal cells are converted from [row, col] to [x, y]', () => {
  const v = stageView(loadLevel(1), 0);
  const h = v.terminals.find((t) => t.id === 'alice_h');
  assert.deepEqual(h.cell, [2, 5]); // v2 [row 5, col 2]
  assert.equal(v.map[5][2], 'H');   // the map agrees: x=2, y=5
  assert.deepEqual([h.gate, h.owner, h.qubit, h.uses], ['h', 'alice', 0, 1]);
});

test("Bob's L1 cx terminal has no target_cell: cell is converted, qubit/target/activation are kept", () => {
  const v = stageView(loadLevel(1), 0);
  const cx = v.terminals.find((t) => t.id === 'bob_cx');
  assert.deepEqual(cx.cell, [11, 5]);
  assert.equal('target_cell' in cx, false);
  assert.deepEqual([cx.gate, cx.owner, cx.qubit, cx.target, cx.uses, cx.activation], ['cx', 'bob', 0, 1, 1, 'owner']);
  assert.equal(v.map[5][11], 'C');
});

test('level3 co-op cx terminal converts cell and target_cell, keeps target and id', () => {
  const cx = stageView(loadLevel(3), 0).terminals.find((t) => t.id === 'shared_cx');
  assert.deepEqual(cx.cell, [4, 5]);
  assert.deepEqual(cx.target_cell, [12, 5]);
  assert.deepEqual([cx.gate, cx.owner, cx.qubit, cx.target, cx.uses], ['cx', 'shared', 0, 1, 1]);
});

test('validated_exit doors keep type, qubit and unlock_when', () => {
  const v = stageView(loadLevel(1), 0);
  assert.deepEqual(v.objects.door_A, { type: 'validated_exit', qubit: 0, blocking: true, unlock_when: 'objective_ready' });
});

test('level3 converts every terminal, including unlimited-use ones kept as null', () => {
  const l3 = stageView(loadLevel(3), 0);
  assert.deepEqual(l3.terminals.map((t) => [t.id, ...t.cell]), [
    ['alice_h', 3, 1], ['alice_z', 4, 2], ['bob_x', 11, 1], ['shared_cx', 4, 5],
  ]);
  assert.deepEqual(l3.terminals.find((t) => t.id === 'shared_cx').target_cell, [15, 3]);
  const l2b = stageView(loadLevel(2), 0);
  assert.equal(l2b.stageId, 'bell_block');
  assert.equal(l2b.terminals[0].uses, 1);
  assert.deepEqual(l2b.terminals[0].cell, [2, 5]);
});

test('the source level is not mutated', () => {
  const level = loadLevel(1);
  const before = JSON.stringify(level);
  stageView(level, 0);
  assert.equal(JSON.stringify(level), before);
});

test('multi-stage level: picks the requested stage', () => {
  const level = loadLevel(2);
  level.stages.push({ ...level.stages[0], id: 'second_fixture' });
  assert.equal(stageView(level, 0).stageId, 'bell_block');
  assert.equal(stageView(level, 1).stageId, 'second_fixture');
});

test('bad stage index throws a clear error', () => {
  const level = loadLevel(1);
  for (const bad of [1, -1, 1.5, '0', undefined, NaN]) {
    assert.throws(() => stageView(level, bad), /level1.*stage/i, String(bad));
  }
  assert.throws(() => stageView(null, 0), /level/i);
});

test('legacy flat format (no stages) is returned unchanged', () => {
  const flat = { id: 'old', map: ['#'], legend: {}, terminals: [{ cell: [1, 2] }] };
  assert.equal(stageView(flat, 0), flat);
  assert.deepEqual(flat.terminals[0].cell, [1, 2]);
});

test('decorations convert cell [row, col] -> [x, y] and keep sprite + footprint [w, h]', () => {
  const level = loadLevel(1);
  const v = stageView(level, 0);
  assert.equal(v.decorations.length, level.stages[0].decorations.length);
  const fridge = v.decorations.find((d) => d.sprite === 'dilution_fridge_a');
  assert.deepEqual(fridge, { sprite: 'dilution_fridge_a', cell: [5, 1], footprint: [2, 2] }); // v2 [row 1, col 5]
  const grate = v.decorations.find((d) => d.sprite === 'floor_grate' && d.cell[0] === 11);
  assert.deepEqual(grate, { sprite: 'floor_grate', cell: [11, 3], footprint: [2, 1] }); // v2 [row 3, col 11]
  // the input is not mutated
  assert.deepEqual(level.stages[0].decorations.find((d) => d.sprite === 'dilution_fridge_a').cell, [1, 5]);
});

test('a stage without decorations yields an empty list', () => {
  const level = structuredClone(loadLevel(2));
  delete level.stages[0].decorations;
  assert.deepEqual(stageView(level, 0).decorations, []);
});

test('theme passes through to the stage view, defaulting to lab; decoration solid flags and [row, col] cells survive', () => {
  const level = structuredClone(loadLevel(1));
  assert.equal(stageView(level, 0).theme, 'lab');
  level.theme = 'prison';
  level.stages[0].decorations = [{ sprite: 'locker', cell: [2, 7], footprint: [1, 2], solid: true }];
  const v = stageView(level, 0);
  assert.equal(v.theme, 'prison');
  assert.deepEqual(v.decorations, [{ sprite: 'locker', cell: [7, 2], footprint: [1, 2], solid: true }]);
});
