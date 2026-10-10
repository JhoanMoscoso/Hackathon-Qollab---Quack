// Tests for js/grid.js against the real v2 levels (via stageView). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELL, COLS, ROWS, WALL_COLS, parseLevel, isWall, inBounds, cellKey,
} from '../js/grid.js';
import { view, gridOf, loadLevel } from './helpers.mjs';

const level = () => structuredClone(view(1));

test('constants', () => {
  assert.equal(CELL, 32);
  assert.equal(COLS, 20);
  assert.equal(ROWS, 12);
  assert.deepEqual(WALL_COLS, [9, 10]);
});

test('parses level1 as 20x12 with [y][x] tiles', () => {
  const g = gridOf(1);
  assert.equal(g.width, 20);
  assert.equal(g.height, 12);
  assert.equal(g.tiles.length, 12);
  assert.ok(g.tiles.every((row) => row.length === 20));
  assert.equal(g.tiles[2][2], 'A');
  assert.equal(g.tiles[5][16], 'C'); // Bob's CX terminal sits inside his room
  assert.equal(g.tiles[4][9], '#'); // central wall is solid
});

test('every real level and stage parses', () => {
  for (const n of [1, 2, 3]) {
    const stages = loadLevel(n).stages.length;
    for (let i = 0; i < stages; i++) assert.doesNotThrow(() => gridOf(n, i), `level${n} stage ${i}`);
  }
});

test('level1 spawns, sensors and exits in [x, y]', () => {
  const g = gridOf(1);
  assert.deepEqual(g.spawns, { alice: [2, 2], bob: [17, 2] });
  assert.deepEqual(
    [...g.sensors].sort((a, b) => a.qubit - b.qubit),
    [{ qubit: 0, cell: [3, 4] }, { qubit: 1, cell: [13, 4] }],
  );
  assert.deepEqual(g.exits, { alice: [1, 9], bob: [18, 9] });
});

test("level1 has no co-op cnot: Bob's CX (no target_cell) is a plain owner terminal with qubit and target", () => {
  const g = gridOf(1);
  assert.equal(g.cnot, null);
  assert.deepEqual(g.terminals, [
    { cell: [2, 5], id: 'alice_h', gate: 'h', owner: 'alice', qubit: 0, target: undefined, uses: 1 },
    { cell: [16, 5], id: 'bob_cx', gate: 'cx', owner: 'bob', qubit: 0, target: 1, uses: 1 },
  ]);
});

test('level1 central wall is solid on every row', () => {
  const g = gridOf(1);
  for (let y = 0; y < ROWS; y++) {
    for (const x of WALL_COLS) assert.equal(isWall(g, x, y), true, `${x},${y}`);
  }
});

test('level3 cnot comes from shared_cx / shared_cx_target inside the rooms', () => {
  const g = gridOf(3);
  assert.deepEqual(g.cnot, { control: [4, 3], target: [15, 3], terminalId: 'shared_cx', owner: 'shared', uses: 1 });
  assert.deepEqual(g.terminals.map((t) => t.id), ['alice_h', 'alice_z', 'bob_x']); // the co-op CX is not a plain terminal
  assert.deepEqual(g.terminals.find((t) => t.id === 'alice_z').cell, [4, 2]);
});

test('level without a cx terminal has no cnot', () => {
  assert.equal(gridOf(2, 0).cnot, null);
});

test('objects keep blocking (default true), optional qubit, open_on, lethal, type', () => {
  const g = gridOf(1);
  const byName = Object.fromEntries(g.objects.map((o) => [o.name, o]));
  assert.deepEqual(byName.door_A, {
    name: 'door_A', cell: [1, 8], qubit: 0, open_on: undefined, lethal: false, blocking: true,
    type: 'validated_exit', unlock_when: 'objective_ready',
  });
  assert.deepEqual(byName.door_B.cell, [18, 8]);
  assert.equal(byName.door_B.qubit, 1);
  assert.equal(byName.door_B.open_on, undefined); // L1 doors never use open_on
  const l3 = Object.fromEntries(gridOf(3).objects.map((o) => [o.name, o]));
  assert.deepEqual([l3.bridge_A.qubit, l3.bridge_A.open_on, l3.bridge_A.lethal], [0, 1, true]);
  assert.deepEqual([l3.laser_B.qubit, l3.laser_B.open_on, l3.laser_B.lethal], [1, 0, true]);
});

test('blocking:false is kept; a missing blocking flag defaults to true', () => {
  const v = level();
  v.objects.door_A.blocking = false;
  delete v.objects.door_B.blocking;
  const byName = Object.fromEntries(parseLevel(v).objects.map((o) => [o.name, o]));
  assert.equal(byName.door_A.blocking, false);
  assert.equal(byName.door_B.blocking, true);
});

test('isWall / inBounds / cellKey', () => {
  const g = gridOf(1);
  assert.equal(isWall(g, 0, 0), true);
  assert.equal(isWall(g, 3, 3), false);
  assert.equal(isWall(g, -1, 3), true);
  assert.equal(isWall(g, 20, 3), true);
  assert.equal(isWall(g, 3, 12), true);
  assert.equal(inBounds(0, 0), true);
  assert.equal(inBounds(19, 11), true);
  assert.equal(inBounds(20, 0), false);
  assert.equal(inBounds(0, -1), false);
  assert.equal(cellKey(3, 7), '3,7');
});

test('object cells are not walls', () => {
  for (const n of [1, 2, 3]) {
    const g = gridOf(n);
    for (const o of g.objects) assert.equal(isWall(g, o.cell[0], o.cell[1]), false, `${n}:${o.name}`);
  }
});

test('plain terminals carry id, gate, owner, qubit and uses (null = unlimited)', () => {
  assert.deepEqual(gridOf(2, 0).terminals, [
    { cell: [2, 5], id: 'alice_x', gate: 'x', owner: 'alice', qubit: 0, target: undefined, uses: 1 },
    { cell: [16, 5], id: 'bob_x', gate: 'x', owner: 'bob', qubit: 1, target: undefined, uses: 1 },
  ]);
  assert.equal(gridOf(2, 0).terminals[0].uses, 1);
});

test('throws on a 22-wide map', () => {
  const l = level();
  l.map = l.map.map((r) => r[0] + r + r[0]);
  assert.throws(() => parseLevel(l), /20/);
});

test('throws on wrong row count', () => {
  const l = level();
  l.map = l.map.slice(0, 11);
  assert.throws(() => parseLevel(l), /12/);
});

test('throws when a spawn is missing', () => {
  const l = level();
  l.map = l.map.map((r) => r.replace('B', '.'));
  assert.throws(() => parseLevel(l), /bob_start/);
});

test('terminal on a wall or out of bounds throws', () => {
  const l = level();
  l.terminals[0].cell = [0, 0];
  assert.throws(() => parseLevel(l), /terminal/);
  l.terminals[0].cell = [20, 5];
  assert.throws(() => parseLevel(l), /terminal/);
  l.terminals[0].cell = [2, -1];
  assert.throws(() => parseLevel(l), /terminal/);
});

test('co-op cx terminal (L3) on a wall throws', () => {
  const l = structuredClone(view(3));
  const cx = l.terminals.find((t) => t.target_cell);
  cx.target_cell = [10, 0]; // wall row
  assert.throws(() => parseLevel(l), /terminal/);
});

test('terminal on a floor cell without a terminal legend char is accepted', () => {
  const l = level();
  l.terminals[0].cell = [5, 3];
  assert.deepEqual(parseLevel(l).terminals[0].cell, [5, 3]);
});

// Legacy/spec-style legend names still work: one char "cnot_control/target" on both sides of the wall.
const specLevel = (row5) => ({
  id: 'spec',
  map: [
    '####################',
    '#..................#',
    '#.A..............B.#',
    '#..................#',
    '#..S..........s....#',
    row5,
    '#..................#',
    '#..................#',
    '#.D..............d.#',
    '#.E..............e.#',
    '#..................#',
    '####################',
  ],
  legend: {
    A: 'alice_start', B: 'bob_start', S: 'sensor_q0', s: 'sensor_q1',
    D: 'door_A', d: 'door_B', C: 'cnot_control/target', E: 'exit_A', e: 'exit_B',
  },
  objects: {
    door_A: { qubit: 0, open_on: 0, lethal: false },
    door_B: { qubit: 1, open_on: 0, lethal: false },
  },
  terminals: [{ cell: [3, 6], gate: 'h', owner: 'alice', uses: 1 }],
});
const ROW5 = '#.......C###C......#';

test('spec-style cnot_control/target: smaller x is control, larger x is target', () => {
  const g = parseLevel(specLevel(ROW5));
  assert.deepEqual(g.cnot, { control: [8, 5], target: [12, 5] });
});

test('spec-style cnot with a single cell yields no cnot', () => {
  assert.equal(parseLevel(specLevel('#.......C..........#')).cnot, null);
});

test('legend-only shared_cx / shared_cx_target (no terminal entry) still define the cnot', () => {
  const l = specLevel('#.......C###c......#');
  l.legend.C = 'shared_cx';
  l.legend.c = 'shared_cx_target';
  assert.deepEqual(parseLevel(l).cnot, { control: [8, 5], target: [12, 5], terminalId: 'shared_cx' });
});

test('grid.decorations defaults to [] and passes the stage list through as [x, y] cells', () => {
  assert.deepEqual(gridOf(2).decorations, []);
  const g = gridOf(1);
  assert.ok(g.decorations.length > 0);
  const t = g.decorations.find((d) => d.sprite === 'tank_b');
  assert.deepEqual(t, { sprite: 'tank_b', cell: [12, 1], footprint: [1, 2] });
  const flat = level();
  delete flat.decorations;
  assert.deepEqual(parseLevel(flat).decorations, []);
  flat.decorations = [{ sprite: 'floor_mat', cell: [5, 3] }]; // footprint defaults to 1x1
  assert.deepEqual(parseLevel(flat).decorations, [{ sprite: 'floor_mat', cell: [5, 3], footprint: [1, 1] }]);
});

test('decorations never change tiles, spawns, terminals or objects', () => {
  const withDeco = gridOf(1);
  const flat = level();
  flat.decorations = [];
  const without = parseLevel(flat);
  const strip = ({ decorations, ...rest }) => rest;
  assert.deepEqual(strip(withDeco), strip(without));
});

test('level 1 decorations avoid every gameplay cell and the cells in front of the doors', () => {
  const g = gridOf(1);
  const gameplay = new Set([
    g.spawns.alice, g.spawns.bob, ...g.sensors.map((s) => s.cell), ...g.objects.map((o) => o.cell),
    ...g.terminals.map((t) => t.cell), g.exits.alice, g.exits.bob,
    [1, 7], [18, 7], // cells directly in front of door_A / door_B
  ].map(([x, y]) => cellKey(x, y)));
  for (const d of g.decorations) {
    for (let y = d.cell[1]; y < d.cell[1] + d.footprint[1]; y++) {
      for (let x = d.cell[0]; x < d.cell[0] + d.footprint[0]; x++) {
        assert.ok(!gameplay.has(cellKey(x, y)), `${d.sprite} covers gameplay cell ${x},${y}`);
        if (isWall(g, x, y)) assert.ok(d.sprite.startsWith('wall_') && y === 0, `${d.sprite} on wall ${x},${y}`);
      }
    }
  }
});
