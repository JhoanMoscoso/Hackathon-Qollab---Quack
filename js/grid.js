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
 * Parse a flat stage view ({ map, legend, objects, terminals }, see level_adapter.stageView)
 * into a grid description. Terminal cells are already [x, y]. Throws a clear Error if the map
 * is malformed or spawns are missing. `decorations` (optional) become grid.decorations, default [].
 */
export function parseLevel(level) {
  const { map, legend = {}, objects: objectCfg = {}, terminals: terminalCfg = [], decorations: decorationCfg = [] } = level;
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
    // Visual layer only: never read by collision, interaction or the engine. cell = top-left [x, y].
    decorations: decorationCfg.map((d) => ({
      sprite: d.sprite, cell: [d.cell[0], d.cell[1]], footprint: d.footprint ? [d.footprint[0], d.footprint[1]] : [1, 1],
    })),
  };

  const cnot = {};
  const cnotBoth = []; // spec-style legend: one char "cnot_control/target" on both sides
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
      else if (/^shared_cx(_target)?$/.test(name)) { // legend value = terminal id (+ "_target" for the target cell)
        cnot[name.endsWith('_target') ? 'target' : 'control'] = cell;
        cnot.terminalId = name.replace(/_target$/, '');
      }
      else if (name === 'cnot_control/target') cnotBoth.push(cell);
      else if (name === 'exit_A') grid.exits.alice = cell;
      else if (name === 'exit_B') grid.exits.bob = cell;
      else if (sensor) grid.sensors.push({ qubit: Number(sensor[1]), cell });
      else if (name in objectCfg) {
        const { qubit, open_on, lethal, blocking, type, unlock_when } = objectCfg[name];
        // qubit is undefined for objective-bound joint locks; blocking:false = indicator only
        grid.objects.push({
          name, cell, qubit, open_on, lethal: !!lethal, blocking: blocking !== false, type, unlock_when,
        });
      }
    }
  }

  for (const key of ['alice', 'bob']) {
    if (!grid.spawns[key]) throw new Error(`Level "${id}": missing spawn ${key}_start in map/legend`);
  }
  if (cnotBoth.length === 2) { // scan order is row-major, so sort by x: smaller x = control (Alice's side)
    const [control, target] = [...cnotBoth].sort((p, q) => p[0] - q[0]);
    cnot.control ??= control;
    cnot.target ??= target;
  }
  if (cnot.control && cnot.target) grid.cnot = cnot;

  // The map may omit a terminal legend char (spec-style levels): any in-bounds non-wall cell is fine.
  const checkCell = (cell) => {
    if (!Array.isArray(cell) || isWall({ tiles }, cell[0], cell[1])) {
      throw new Error(`Level "${id}": terminal at [${cell}] is out of bounds or on a wall`);
    }
    return [cell[0], cell[1]];
  };
  for (const t of terminalCfg) {
    // HUD-only terminals are engine resources, not physical entities on the map.
    if (t.placement === 'hud') continue;
    // Co-op CX (L3): control cell + target cell, never a plain gate terminal. A CX without target_cell
    // (L1: Bob's own terminal, activation "owner") is an ordinary owner terminal below.
    if (t.gate === 'cx' && t.target_cell) {
      grid.cnot = {
        control: checkCell(t.cell), target: checkCell(t.target_cell), terminalId: t.id, owner: t.owner, uses: t.uses,
      };
      continue;
    }
    grid.terminals.push({
      cell: checkCell(t.cell), id: t.id, gate: t.gate, owner: t.owner, qubit: t.qubit, target: t.target, uses: t.uses,
    });
  }

  return grid;
}
