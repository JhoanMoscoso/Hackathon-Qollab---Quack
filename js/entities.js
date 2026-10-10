// Game entities and movement/interaction rules. Pure, no DOM.
// Entities NEVER compute quantum state: they only read the engine snapshot and emit events
// that main.js turns into engine calls. Coordinates are [x, y] = [col, row].

import { isWall, inBounds, WALL_COLS } from './grid.js';

const EPS = 1e-9;

export class Player {
  constructor(id, qubit, x, y) { this.id = id; this.qubit = qubit; this.x = x; this.y = y; }
}

export class Door {
  constructor(name, x, y, qubit, openOn, lethal) {
    Object.assign(this, { name, x, y, qubit, openOn, lethal });
  }
  /** '0' | '1' | 'super', read from the snapshot. */
  state(snap) { return snap.objects[this.name]; }
  isOpen(snap) { return this.state(snap) === String(this.openOn); }
}

export class Sensor {
  constructor(qubit, x, y) { this.qubit = qubit; this.x = x; this.y = y; }
}

export class GateTerminal {
  constructor(x, y, gate, owner, uses) {
    Object.assign(this, { x, y, gate, owner, uses, usesLeft: uses });
  }
}

export class CnotTerminal {
  constructor(control, target) { this.control = control; this.target = target; }
}

export class Exit {
  constructor(player, x, y) { this.player = player; this.x = x; this.y = y; }
}

/** Build all entities from a parseLevel() grid. */
export function createWorld(grid) {
  const { alice, bob } = grid.spawns;
  return {
    grid,
    players: { alice: new Player('alice', 0, ...alice), bob: new Player('bob', 1, ...bob) },
    doors: grid.objects.map((o) => new Door(o.name, o.cell[0], o.cell[1], o.qubit, o.open_on, o.lethal)),
    sensors: grid.sensors.map((s) => new Sensor(s.qubit, s.cell[0], s.cell[1])),
    terminals: grid.terminals.map((t) => new GateTerminal(t.cell[0], t.cell[1], t.gate, t.owner, t.uses)),
    cnot: grid.cnot ? new CnotTerminal(grid.cnot.control, grid.cnot.target) : null,
    exits: ['alice', 'bob'].filter((id) => grid.exits[id]).map((id) => new Exit(id, ...grid.exits[id])),
  };
}

/** Players back to spawn, terminal uses restored. */
export function resetWorld(world) {
  const { alice, bob } = world.grid.spawns;
  [world.players.alice.x, world.players.alice.y] = alice;
  [world.players.bob.x, world.players.bob.y] = bob;
  for (const t of world.terminals) t.usesLeft = t.uses;
}

const at = (list, x, y) => list.find((e) => e.x === x && e.y === y);
const blocked = (reason) => [{ type: 'blocked', reason }];

// Rooms are separated: Alice stays left of the wall, Bob right of it. The CNOT niche only lets
// them stand face to face.
function crossesRooms(playerId, x) {
  return playerId === 'alice' ? x > WALL_COLS[0] : x < WALL_COLS[1];
}

/**
 * Try to move a player by (dx, dy). Mutates the player only when the move is allowed.
 * Returns events: blocked | move | death | measure. Win is checked separately (checkWin).
 */
export function stepPlayer(world, playerId, dx, dy, snap) {
  const player = world.players[playerId];
  const other = world.players[playerId === 'alice' ? 'bob' : 'alice'];
  const x = player.x + dx;
  const y = player.y + dy;

  if (!inBounds(x, y) || isWall(world.grid, x, y) || crossesRooms(playerId, x)) return blocked('wall');
  if (other.x === x && other.y === y) return blocked('occupied');

  const door = at(world.doors, x, y);
  let dies = false;
  if (door) {
    if (door.state(snap) === 'super') return blocked('superposition');
    if (!door.isOpen(snap)) {
      if (!door.lethal) return blocked('closed');
      dies = true;
    }
  }

  player.x = x;
  player.y = y;
  const events = [{ type: 'move', player: playerId, x, y }];
  if (dies) {
    events.push({ type: 'death', cause: door.name });
    return events;
  }
  const sensor = at(world.sensors, x, y);
  if (sensor && snap.measured[sensor.qubit] == null) events.push({ type: 'measure', qubit: sensor.qubit });
  return events;
}

const same = (p, [x, y]) => p.x === x && p.y === y;

/**
 * Events for pressing E. A gate event does NOT consume a use: call consumeTerminal() once the
 * engine confirms success, so engine errors never burn uses.
 */
export function interact(world, playerId, snap) {
  const player = world.players[playerId];

  const terminal = at(world.terminals, player.x, player.y);
  if (terminal) {
    if (terminal.owner !== playerId) return [{ type: 'info', reason: 'wrong_owner' }];
    if (terminal.usesLeft <= 0) return [{ type: 'info', reason: 'terminal_used' }];
    return [{ type: 'gate', gate: terminal.gate, qubit: player.qubit, terminal }];
  }

  const { cnot } = world;
  if (cnot && (same(player, cnot.control) || same(player, cnot.target))) {
    if (same(world.players.alice, cnot.control) && same(world.players.bob, cnot.target)) {
      return [{ type: 'cnot', control: 0, target: 1 }];
    }
    return [{ type: 'info', reason: 'cnot_needs_both' }];
  }
  return [];
}

/** Call after the engine accepted the gate. */
export function consumeTerminal(terminal) {
  if (terminal.usesLeft > 0) terminal.usesLeft -= 1;
}

// Qubit N is definite at `bit` if it was measured as `bit`, or its marginal is certain.
function qubitIs(snap, n, bit) {
  if (snap.measured[n] === bit) return true;
  return (snap.marginals?.[n]?.[bit] ?? 0) > 1 - EPS;
}

/** win = level.win, e.g. {"q0":0,"q1":0}. */
export function checkWin(world, snap, win) {
  const onExit = world.exits.every((e) => same(world.players[e.player], [e.x, e.y]));
  if (!onExit || world.exits.length < 2) return false;
  return Object.entries(win).every(([key, bit]) => qubitIs(snap, Number(key.slice(1)), bit));
}

/**
 * Death events for players standing on a lethal door that is now closed or in superposition.
 * Call after every engine snapshot (a measurement can change a door under a player).
 */
export function hazardCheck(world, snap) {
  const events = [];
  for (const player of Object.values(world.players)) {
    const door = at(world.doors, player.x, player.y);
    if (!door || !door.lethal || door.isOpen(snap)) continue;
    events.push({ type: 'death', cause: door.state(snap) === 'super' ? 'collapse' : door.name });
  }
  return events;
}
