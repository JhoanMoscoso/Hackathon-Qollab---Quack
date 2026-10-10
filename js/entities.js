// Game entities and movement/interaction rules. Pure, no DOM.
// Entities NEVER compute quantum state: they only read the engine snapshot and emit events
// that main.js turns into engine calls. Coordinates are [x, y] = [col, row].

import { isWall, inBounds, cellKey } from './grid.js';
import { isSolidDecoration } from './theme.js';

export class Player {
  constructor(id, qubit, x, y) { this.id = id; this.qubit = qubit; this.x = x; this.y = y; }
}

export class Door {
  /**
   * `qubit` is undefined for joint locks (state still comes from snap.objects). `blocking:false` = indicator only.
   * `type: "validated_exit"` doors (L1) are driven by the engine's `snap.door_states` ("open" | "closed"), never by
   * `objects[...]` (which keeps the quantum value of the qubit) and never by `open_on`.
   */
  constructor(name, x, y, qubit, openOn, lethal, blocking = true, type = undefined) {
    Object.assign(this, { name, x, y, qubit, openOn, lethal, blocking, type });
  }
  /** True when the engine decides this door through door_states instead of the qubit value. */
  engineDriven(snap) { return this.type === 'validated_exit' || snap?.door_states?.[this.name] !== undefined; }
  /** '0' | '1' | 'super' (legacy, read from snap.objects) or 'open' | 'closed' (engine-driven). */
  state(snap) {
    if (this.engineDriven(snap)) return snap?.door_states?.[this.name] === 'open' ? 'open' : 'closed';
    return snap.objects?.[this.name];
  }
  isOpen(snap) { return this.engineDriven(snap) ? this.state(snap) === 'open' : this.state(snap) === String(this.openOn); }
  /** Art state for the renderer: engine-driven open/closed reuse the green "0" / red "1" door art. */
  visualState(snap) { return this.engineDriven(snap) ? (this.isOpen(snap) ? '0' : '1') : this.state(snap); }
}

export class Sensor {
  constructor(qubit, x, y) { this.qubit = qubit; this.x = x; this.y = y; }
}

// `uses: null` (or undefined) = unlimited, kept locally as Infinity.
const usesOf = (uses) => uses ?? Infinity;

export class GateTerminal {
  constructor(x, y, gate, owner, uses, id, qubit = undefined, target = undefined) {
    Object.assign(this, { x, y, gate, owner, uses: usesOf(uses), usesLeft: usesOf(uses), id, qubit, target });
  }
}

export class CnotTerminal {
  // The engine checks `actor` against the terminal owner, which is 'shared' for the CX (not the pressing player).
  constructor(control, target, terminalId, uses, owner = 'shared') {
    Object.assign(this, { control, target, terminalId, owner, uses: usesOf(uses), usesLeft: usesOf(uses) });
  }
}

export class Exit {
  constructor(player, x, y) { this.player = player; this.x = x; this.y = y; }
}

/** 'x,y' keys of every cell covered by a solid decoration (explicit flag, else the theme registry default). */
function solidDecorationCells(grid) {
  const cells = new Set();
  for (const d of grid.decorations) {
    if (!isSolidDecoration(grid.theme, d)) continue;
    for (let y = d.cell[1]; y < d.cell[1] + d.footprint[1]; y++) {
      for (let x = d.cell[0]; x < d.cell[0] + d.footprint[0]; x++) cells.add(cellKey(x, y));
    }
  }
  return cells;
}

/** Build all entities from a parseLevel() grid. */
export function createWorld(grid) {
  const { alice, bob } = grid.spawns;
  return {
    grid,
    solidCells: solidDecorationCells(grid),
    players: { alice: new Player('alice', 0, ...alice), bob: new Player('bob', 1, ...bob) },
    doors: grid.objects.map((o) => new Door(o.name, o.cell[0], o.cell[1], o.qubit, o.open_on, o.lethal, o.blocking, o.type)),
    sensors: grid.sensors.map((s) => new Sensor(s.qubit, s.cell[0], s.cell[1])),
    terminals: grid.terminals.map((t) => new GateTerminal(t.cell[0], t.cell[1], t.gate, t.owner, t.uses, t.id, t.qubit, t.target)),
    cnot: grid.cnot ? new CnotTerminal(grid.cnot.control, grid.cnot.target, grid.cnot.terminalId, grid.cnot.uses, grid.cnot.owner) : null,
    exits: ['alice', 'bob'].filter((id) => grid.exits[id]).map((id) => new Exit(id, ...grid.exits[id])),
  };
}

/** Players back to spawn, terminal uses restored. */
export function resetWorld(world) {
  const { alice, bob } = world.grid.spawns;
  [world.players.alice.x, world.players.alice.y] = alice;
  [world.players.bob.x, world.players.bob.y] = bob;
  for (const t of world.terminals) t.usesLeft = t.uses;
  if (world.cnot) world.cnot.usesLeft = world.cnot.uses;
}

/** Mirror the engine's terminal_uses_left onto the local counters (the renderer reads usesLeft). */
export function syncTerminalUses(world, snap) {
  const left = snap?.terminal_uses_left;
  if (!left) return;
  for (const t of [...world.terminals, ...(world.cnot ? [world.cnot] : [])]) {
    const id = t.id ?? t.terminalId;
    if (id in left) t.usesLeft = usesOf(left[id]);
  }
}

// Engine is the source of truth for uses; the local counter is only a fallback.
const usesLeftOf = (terminal, id, snap) => {
  const left = snap?.terminal_uses_left;
  return left && id != null && id in left ? usesOf(left[id]) : terminal.usesLeft;
};

const at = (list, x, y) => list.find((e) => e.x === x && e.y === y);
const blocked = (reason) => [{ type: 'blocked', reason }];

// Rooms are separated by the grid's divider columns: Alice stays left of them, Bob right of them. A gap in the
// divider (the CNOT niche) only lets them stand face to face.
function crossesRooms(grid, playerId, x) {
  const { divider } = grid;
  return playerId === 'alice' ? x > divider[0] : x < divider[divider.length - 1];
}

/**
 * Try to move a player by (dx, dy). Mutates the player only when the move is allowed.
 * Returns events: blocked | move | death | measure. Completion is checked separately (stageComplete).
 */
export function stepPlayer(world, playerId, dx, dy, snap) {
  const player = world.players[playerId];
  const other = world.players[playerId === 'alice' ? 'bob' : 'alice'];
  const x = player.x + dx;
  const y = player.y + dy;

  if (!inBounds(world.grid, x, y) || isWall(world.grid, x, y) || crossesRooms(world.grid, playerId, x)) return blocked('wall');
  if (world.solidCells?.has(cellKey(x, y))) return blocked('solid');
  if (other.x === x && other.y === y) return blocked('occupied');

  const door = at(world.doors, x, y);
  let dies = false;
  if (door?.blocking) { // non-blocking doors are indicators: they never block and never kill
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
  if (sensor && snap.measured[sensor.qubit] == null) {
    // Locked sensors (L1 before a validated RUN) explain themselves instead of calling the engine.
    events.push(snap.measurement_enabled === false ? { type: 'info', reason: 'measurement_locked' } : { type: 'measure', qubit: sensor.qubit });
  }
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
    if (usesLeftOf(terminal, terminal.id, snap) <= 0) return [{ type: 'info', reason: 'terminal_used' }];
    // Gate terminals may fix their own qubit/target (L1: Bob's CX terminal is q0 -> q1, `activation: "owner"`);
    // `actor` is always the interacting player.
    return [{
      type: 'gate', gate: terminal.gate, qubit: terminal.qubit ?? player.qubit, target: terminal.target ?? -1,
      terminalId: terminal.id, actor: playerId, terminal,
    }];
  }

  const { cnot } = world;
  if (cnot && (same(player, cnot.control) || same(player, cnot.target))) {
    if (same(world.players.alice, cnot.control) && same(world.players.bob, cnot.target)) {
      if (usesLeftOf(cnot, cnot.terminalId, snap) <= 0) return [{ type: 'info', reason: 'terminal_used' }];
      return [{
        type: 'cnot', gate: 'cx', qubit: 0, target: 1, terminalId: cnot.terminalId, actor: cnot.owner, terminal: cnot,
      }];
    }
    return [{ type: 'info', reason: 'cnot_needs_both' }];
  }
  return [];
}

/** Call after the engine accepted the gate. */
export function consumeTerminal(terminal) {
  if (terminal.usesLeft > 0) terminal.usesLeft -= 1;
}

/**
 * The stage is complete when the engine says the objective is ready (or the exits are unlocked) AND each
 * player stands on their own exit. The engine decides; entities never compute quantum state.
 */
export function stageComplete(world, snap) {
  const ready = snap?.objective?.status === 'ready' || snap?.exits_unlocked === true;
  if (!ready || world.exits.length < 2) return false;
  return world.exits.every((e) => same(world.players[e.player], [e.x, e.y]));
}

/**
 * Measure events for players already standing on an unmeasured sensor. A sensor only fires when stepped
 * on, so after a successful RUN (which unlocks measurement) a player who waited on it would never be
 * measured; main.js feeds these events through the same path as stepping onto the sensor.
 */
export function sensorsUnderPlayers(world, snap) {
  const events = [];
  if (snap.measurement_enabled === false) return events;
  for (const player of Object.values(world.players)) {
    const sensor = at(world.sensors, player.x, player.y);
    if (sensor && snap.measured[sensor.qubit] == null && !events.some((e) => e.qubit === sensor.qubit)) {
      events.push({ type: 'measure', qubit: sensor.qubit });
    }
  }
  return events;
}

/** True when the engine reports the objective as failed (e.g. measurement outcomes differ). */
export const objectiveFailed = (snap) => snap?.objective?.status === 'failed';

/**
 * Death events for players standing on a lethal door that is now closed or in superposition.
 * Call after every engine snapshot (a measurement can change a door under a player).
 */
export function hazardCheck(world, snap) {
  const events = [];
  for (const player of Object.values(world.players)) {
    const door = at(world.doors, player.x, player.y);
    if (!door || !door.blocking || !door.lethal || door.isOpen(snap)) continue;
    events.push({ type: 'death', cause: door.state(snap) === 'super' ? 'collapse' : door.name });
  }
  return events;
}
