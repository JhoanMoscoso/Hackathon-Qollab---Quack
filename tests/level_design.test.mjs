// Level design rules for the shipped maps (every stage of every level): decor stays visual-safe and every
// interactive cell stays reachable with solid decorations as obstacles. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWall, cellKey } from '../js/grid.js';
import { tileRect, propRect } from '../js/theme.js';
import { view, worldOf, loadLevel } from './helpers.mjs';

const STAGES = [[1, 0], [2, 0], [2, 1], [3, 0]];
const SCENERY = new Set(['wall', 'floor', 'region_separator']);
const THEMES = { 1: 'lab', 2: 'prison', 3: 'lab' };

/** Cells a decoration covers, as [x, y]. */
const covered = (d) => {
  const out = [];
  for (let y = d.cell[1]; y < d.cell[1] + d.footprint[1]; y++) for (let x = d.cell[0]; x < d.cell[0] + d.footprint[0]; x++) out.push([x, y]);
  return out;
};

/**
 * Cells a player can reach from its spawn: floor, doors (closed ones count as passable), sensors, terminals and exits,
 * but never walls, solid decorations or the other player's side of the divider.
 */
function reachable(world, id) {
  const { grid, solidCells } = world;
  const left = id === 'alice';
  const sideOk = (x) => (left ? x <= grid.divider[0] : x >= grid.divider.at(-1));
  const start = grid.spawns[id];
  const seen = new Set([cellKey(...start)]);
  const queue = [start];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (isWall(grid, nx, ny) || solidCells.has(cellKey(nx, ny)) || !sideOk(nx) || seen.has(cellKey(nx, ny))) continue;
      seen.add(cellKey(nx, ny));
      queue.push([nx, ny]);
    }
  }
  return seen;
}

for (const [n, stage] of STAGES) {
  const label = `level${n} stage ${stage}`;
  const v = view(n, stage);
  const world = worldOf(n, stage);
  const { grid } = world;

  test(`${label}: theme is ${THEMES[n]} and the map is 15x9 with the divider in column 7`, () => {
    assert.equal(grid.theme, THEMES[n]);
    assert.deepEqual([grid.width, grid.height, grid.divider], [15, 9, [7]]);
    for (let y = 0; y < 9; y++) {
      assert.equal(isWall(grid, 0, y) && isWall(grid, 14, y) && isWall(grid, 7, y), true, `outer/divider walls row ${y}`);
    }
    for (let x = 0; x < 15; x++) assert.equal(isWall(grid, x, 0) && isWall(grid, x, 8), true, `outer walls col ${x}`);
  });

  test(`${label}: every decoration is in the ${THEMES[n]} registry and fits its footprint`, () => {
    assert.ok(grid.decorations.length >= 15, `dense decor: ${grid.decorations.length}`);
    for (const d of grid.decorations) {
      const p = propRect(grid.theme, d.sprite);
      assert.ok(p, `${d.sprite} exists in the ${grid.theme} theme`);
      assert.ok(p.w <= d.footprint[0] * 32 + 4 && p.h <= d.footprint[1] * 32 + 8, `${d.sprite} (${p.w}x${p.h}) fits footprint ${d.footprint}`);
    }
  });

  test(`${label}: no decoration covers an interactive cell; only wall_* props sit on walls`, () => {
    for (const d of grid.decorations) {
      for (const [x, y] of covered(d)) {
        assert.ok(x >= 0 && x < grid.width && y >= 0 && y < grid.height, `${d.sprite} inside the map at ${x},${y}`);
        const name = v.legend[grid.tiles[y][x]];
        assert.ok(SCENERY.has(name), `${d.sprite} covers ${name} at ${x},${y}`);
        if (name === 'wall') assert.ok(d.sprite.startsWith('wall_'), `${d.sprite} on a wall at ${x},${y}`);
      }
    }
  });

  test(`${label}: wall_* props face the room: on the top wall row`, () => {
    for (const d of grid.decorations.filter((e) => e.sprite.startsWith('wall_'))) assert.equal(d.cell[1], 0, `${d.sprite} at ${d.cell}`);
  });

  test(`${label}: each player reaches its terminals, sensor, doors and exit with solid decor and walls blocked`, () => {
    const have = { alice: reachable(world, 'alice'), bob: reachable(world, 'bob') };
    const mine = (id, [x, y]) => (id === 'alice' ? x <= grid.divider[0] : x >= grid.divider.at(-1));
    for (const id of ['alice', 'bob']) {
      const q = id === 'alice' ? 0 : 1;
      const targets = {
        spawn: grid.spawns[id],
        sensor: grid.sensors.find((s) => s.qubit === q).cell,
        exit: grid.exits[id],
        ...Object.fromEntries(grid.terminals.filter((t) => t.owner === id).map((t) => [t.id, t.cell])),
        ...Object.fromEntries(grid.objects.filter((o) => mine(id, o.cell)).map((o) => [o.name, o.cell])),
        ...(grid.cnot ? { cnot: id === 'alice' ? grid.cnot.control : grid.cnot.target } : {}),
      };
      for (const [name, cell] of Object.entries(targets)) assert.ok(have[id].has(cellKey(...cell)), `${id} reaches ${name} at ${cell}`);
    }
  });

  test(`${label}: the engine tiles needed for these maps exist in the theme art`, () => {
    for (const t of ['floor_a', 'wall_face_a', 'door_locked', 'sensor_idle', 'exit_closed', 'term_h']) assert.ok(tileRect(grid.theme, t), t);
  });
}

test('the level files carry the theme: lab, prison, lab', () => {
  assert.deepEqual([1, 2, 3].map((n) => loadLevel(n).theme), ['lab', 'prison', 'lab']);
});
