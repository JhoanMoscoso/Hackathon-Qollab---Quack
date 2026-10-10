// Tests for js/level_adapter.js against the real v2 levels. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageView } from '../js/level_adapter.js';
import { loadLevel } from './helpers.mjs';

test('level1 stage 0 becomes a flat view with the stage fields', () => {
  const level = loadLevel(1);
  const v = stageView(level, 0);
  assert.equal(v.id, 'level1');
  assert.equal(v.stageId, 'calibration');
  assert.equal(v.title, 'Calibration Chamber');
  assert.deepEqual(v.map, level.stages[0].map);
  assert.deepEqual(v.legend, level.stages[0].legend);
  assert.deepEqual(v.objects, level.stages[0].objects);
  assert.deepEqual(v.win, { parity: 'equal' });
  assert.equal(v.failure_policy, 'retry_stage');
  assert.deepEqual(v.requires_run, { target: 'Phi+' });
  assert.deepEqual(v.initial_circuit, []);
  assert.deepEqual(v.gate_set, { alice: ['h'], bob: [], shared: ['cx'] });
  assert.equal(v.max_gates, 2);
  assert.equal(v.narration.run_ok, 'Phi+ validated. Both measure now.');
});

test('terminal cells are converted from [row, col] to [x, y]', () => {
  const v = stageView(loadLevel(1), 0);
  const h = v.terminals.find((t) => t.id === 'alice_h');
  assert.deepEqual(h.cell, [3, 1]); // v2 [row 1, col 3]
  assert.equal(v.map[1][3], 'H');   // the map agrees: x=3, y=1
  assert.deepEqual([h.gate, h.owner, h.qubit, h.uses], ['h', 'alice', 0, 1]);
});

test('cx terminal converts cell and target_cell, keeps target and id', () => {
  const v = stageView(loadLevel(1), 0);
  const cx = v.terminals.find((t) => t.id === 'shared_cx');
  assert.deepEqual(cx.cell, [9, 4]);
  assert.deepEqual(cx.target_cell, [10, 4]);
  assert.deepEqual([cx.gate, cx.owner, cx.qubit, cx.target, cx.uses], ['cx', 'shared', 0, 1, 1]);
  assert.equal(v.map[4][9], 'C');
  assert.equal(v.map[4][10], 'c');
});

test('level3 converts every terminal, including unlimited-use ones kept as null', () => {
  const l3 = stageView(loadLevel(3), 0);
  assert.deepEqual(l3.terminals.map((t) => [t.id, ...t.cell]), [
    ['alice_h', 3, 1], ['alice_z', 4, 2], ['bob_x', 15, 1], ['shared_cx', 4, 3],
  ]);
  assert.deepEqual(l3.terminals.find((t) => t.id === 'shared_cx').target_cell, [15, 3]);
  const l2b = stageView(loadLevel(2), 1);
  assert.equal(l2b.stageId, 'feed_forward');
  assert.equal(l2b.terminals[0].uses, null);
  assert.deepEqual(l2b.terminals[0].cell, [13, 1]);
});

test('the source level is not mutated', () => {
  const level = loadLevel(1);
  const before = JSON.stringify(level);
  stageView(level, 0);
  assert.equal(JSON.stringify(level), before);
});

test('multi-stage level: picks the requested stage', () => {
  const level = loadLevel(2);
  assert.equal(stageView(level, 0).stageId, 'opposites');
  assert.equal(stageView(level, 1).stageId, 'feed_forward');
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
  const mat = v.decorations.find((d) => d.sprite === 'floor_mat' && d.cell[0] === 13);
  assert.deepEqual(mat, { sprite: 'floor_mat', cell: [13, 3], footprint: [2, 1] });
  // the input is not mutated
  assert.deepEqual(level.stages[0].decorations.find((d) => d.sprite === 'tank_a').cell, [1, 7]);
});

test('a stage without decorations yields an empty list', () => {
  assert.deepEqual(stageView(loadLevel(2), 0).decorations, []);
  assert.deepEqual(stageView(loadLevel(3), 0).decorations, []);
});
