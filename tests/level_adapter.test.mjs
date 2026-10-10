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
  assert.deepEqual(cx.cell, [16, 5]);
  assert.equal('target_cell' in cx, false);
  assert.deepEqual([cx.gate, cx.owner, cx.qubit, cx.target, cx.uses, cx.activation], ['cx', 'bob', 0, 1, 1, 'owner']);
  assert.equal(v.map[5][16], 'C');
});

test('level3 co-op cx terminal converts cell and target_cell, keeps target and id', () => {
  const cx = stageView(loadLevel(3), 0).terminals.find((t) => t.id === 'shared_cx');
  assert.deepEqual(cx.cell, [8, 4]);
  assert.deepEqual(cx.target_cell, [11, 4]);
  assert.deepEqual([cx.gate, cx.owner, cx.qubit, cx.target, cx.uses], ['cx', 'shared', 0, 1, 1]);
});

test('validated_exit doors keep type, qubit and unlock_when', () => {
  const v = stageView(loadLevel(1), 0);
  assert.deepEqual(v.objects.door_A, { type: 'validated_exit', qubit: 0, blocking: true, unlock_when: 'objective_ready' });
});

test('level3 keeps HUD terminals without cells and converts shared CX plates', () => {
  const l3 = stageView(loadLevel(3), 0);
  assert.deepEqual(l3.terminals.map((t) => [t.id, ...(t.cell ?? [])]), [
    ['alice_h'], ['alice_z'], ['bob_x'], ['shared_cx', 8, 4],
  ]);
  assert.deepEqual(l3.terminals.find((t) => t.id === 'shared_cx').target_cell, [11, 4]);
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
  const tank = v.decorations.find((d) => d.sprite === 'tank_a');
  assert.deepEqual(tank, { sprite: 'tank_a', cell: [7, 1], footprint: [1, 2] }); // v2 [row 1, col 7]
  const mat = v.decorations.find((d) => d.sprite === 'floor_mat' && d.cell[0] === 14);
  assert.deepEqual(mat, { sprite: 'floor_mat', cell: [14, 6], footprint: [2, 1] }); // v2 [row 6, col 14]
  // the input is not mutated
  assert.deepEqual(level.stages[0].decorations.find((d) => d.sprite === 'tank_a').cell, [1, 7]);
});

test('a stage without decorations yields an empty list', () => {
  assert.deepEqual(stageView(loadLevel(2), 0).decorations, []);
  assert.deepEqual(stageView(loadLevel(3), 0).decorations, []);
});
