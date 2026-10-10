// Level grid: map parsing and cell lookup. Pure, no DOM.
// Coordinates are [x, y] = [col, row] everywhere; tiles are indexed [y][x].

export const CELL = 32;
export const COLS = 20;
export const ROWS = 12;
export const WALL_COLS = [9, 10]; // central wall separating Alice's and Bob's rooms

export const inBounds = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
export const cellKey = (x, y) => `${x},${y}`;

/** True for '#' tiles and anything out of bounds. Objects (doors etc.) are NOT walls here. */
export function isWall(grid, x, y) {
  return !inBounds(x, y) || grid.tiles[y][x] === '#';
}

/**
 * Parse a level JSON ({ map, legend, objects, terminals }) into a grid description.
 * Throws a clear Error if the map is malformed or spawns are missing.
 */
export function parseLevel(level) {
  const { map, legend = {}, objects: objectCfg = {}, terminals: terminalCfg = [] } = level;
  const id = level.id ?? '?';
  if (!Array.isArray(map) || map.length !== ROWS) {
    throw new Error(`Level "${id}": map must have ${ROWS} rows, got ${Array.isArray(map) ? map.length : typeof map}`);
  }
  map.forEach((row, y) => {
    if (typeof row !== 'string' || row.length !== COLS) {
      throw new Error(`Level "${id}": map row ${y} must be ${COLS} wide, got ${row?.length}`);
    }
  });

  const tiles = map.map((row) => [...row]);
  const grid = {
    width: COLS,
    height: ROWS,
    tiles,
    spawns: {},
    objects: [],
    sensors: [],
    terminals: [],
    cnot: null,
    exits: { alice: null, bob: null },
  };

  const cnot = {};
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const name = legend[tiles[y][x]];
      if (!name) continue;
      const cell = [x, y];
      const sensor = /^sensor_q(\d+)$/.exec(name);
      if (name === 'alice_start') grid.spawns.alice = cell;
      else if (name === 'bob_start') grid.spawns.bob = cell;
      else if (name === 'cnot_control') cnot.control = cell;
      else if (name === 'cnot_target') cnot.target = cell;
      else if (name === 'exit_A') grid.exits.alice = cell;
      else if (name === 'exit_B') grid.exits.bob = cell;
      else if (sensor) grid.sensors.push({ qubit: Number(sensor[1]), cell });
      else if (name in objectCfg) {
        const { qubit, open_on, lethal } = objectCfg[name];
        grid.objects.push({ name, cell, qubit, open_on, lethal: !!lethal });
      }
    }
  }

  for (const key of ['alice', 'bob']) {
    if (!grid.spawns[key]) throw new Error(`Level "${id}": missing spawn ${key}_start in map/legend`);
  }
  if (cnot.control && cnot.target) grid.cnot = cnot;

  for (const t of terminalCfg) {
    const [x, y] = t.cell;
    const name = inBounds(x, y) ? legend[tiles[y][x]] : undefined;
    if (!name || !name.startsWith('terminal')) {
      throw new Error(`Level "${id}": terminal at [${x},${y}] has no matching terminal legend char in map`);
    }
    grid.terminals.push({ cell: [x, y], gate: t.gate, owner: t.owner, uses: t.uses });
  }

  return grid;
}
