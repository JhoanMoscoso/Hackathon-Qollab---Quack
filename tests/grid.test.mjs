// Tests for js/grid.js against the real levels/test.json. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CELL, COLS, ROWS, WALL_COLS, parseLevel, isWall, inBounds, cellKey,
} from '../js/grid.js';

const level = () => JSON.parse(readFileSync(new URL('../levels/test.json', import.meta.url), 'utf8'));

test('constants', () => {
  assert.equal(CELL, 32);
  assert.equal(COLS, 20);
  assert.equal(ROWS, 12);
  assert.deepEqual(WALL_COLS, [9, 10]);
});

test('parses test.json as 20x12 with [y][x] tiles', () => {
  const g = parseLevel(level());
  assert.equal(g.width, 20);
  assert.equal(g.height, 12);
  assert.equal(g.tiles.length, 12);
  assert.ok(g.tiles.every((row) => row.length === 20));
  assert.equal(g.tiles[2][2], 'A');
  assert.equal(g.tiles[5][9], 'C');
});

test('spawns', () => {
  const g = parseLevel(level());
  assert.deepEqual(g.spawns, { alice: [2, 2], bob: [17, 2] });
});

test('cnot control/target in the wall niche', () => {
  const g = parseLevel(level());
  assert.deepEqual(g.cnot, { control: [9, 5], target: [10, 5] });
});

test('center wall at columns 9-10 except the niche row', () => {
  const g = parseLevel(level());
  for (let y = 0; y < ROWS; y++) {
    for (const x of WALL_COLS) {
      if (y === 5) assert.equal(isWall(g, x, y), false, `niche ${x},${y}`);
      else assert.equal(isWall(g, x, y), true, `wall ${x},${y}`);
    }
  }
});

test('isWall / inBounds / cellKey', () => {
  const g = parseLevel(level());
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
  const g = parseLevel(level());
  for (const o of g.objects) assert.equal(isWall(g, o.cell[0], o.cell[1]), false);
});

test('two sensors', () => {
  const g = parseLevel(level());
  assert.deepEqual(
    [...g.sensors].sort((a, b) => a.qubit - b.qubit),
    [{ qubit: 0, cell: [3, 4] }, { qubit: 1, cell: [16, 4] }],
  );
});

test('two terminals with config', () => {
  const g = parseLevel(level());
  assert.deepEqual(g.terminals, [
    { cell: [2, 5], gate: 'h', owner: 'alice', uses: 1 },
    { cell: [16, 5], gate: 'x', owner: 'bob', uses: 1 },
  ]);
});

test('two objects merged with config, door_B lethal', () => {
  const g = parseLevel(level());
  assert.equal(g.objects.length, 2);
  const byName = Object.fromEntries(g.objects.map((o) => [o.name, o]));
  assert.deepEqual(byName.door_A, { name: 'door_A', cell: [1, 8], qubit: 0, open_on: 0, lethal: false });
  assert.deepEqual(byName.door_B, { name: 'door_B', cell: [18, 8], qubit: 1, open_on: 0, lethal: true });
});

test('exits', () => {
  const g = parseLevel(level());
  assert.deepEqual(g.exits, { alice: [1, 9], bob: [18, 9] });
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

test('throws when a terminal cell has no legend char', () => {
  const l = level();
  l.terminals[0].cell = [5, 7];
  assert.throws(() => parseLevel(l), /terminal/);
});
