// Shared fixtures for the JS tests: real v2 levels (read via fs) and engine-shaped snapshots.
import { readFileSync } from 'node:fs';
import { stageView } from '../js/level_adapter.js';
import { parseLevel } from '../js/grid.js';
import { createWorld } from '../js/entities.js';

export const loadLevel = (n) => JSON.parse(readFileSync(new URL(`../levels/level${n}.json`, import.meta.url), 'utf8'));
/** Flat stage view of levels/level<n>.json, as parseLevel() takes it. */
export const view = (n, stageIndex = 0) => stageView(loadLevel(n), stageIndex);
export const gridOf = (n, stageIndex = 0) => parseLevel(view(n, stageIndex));
export const worldOf = (n, stageIndex = 0) => createWorld(gridOf(n, stageIndex));

export const place = (w, id, x, y) => { w.players[id].x = x; w.players[id].y = y; };
export const pos = (w, id) => [w.players[id].x, w.players[id].y];

/** Level 1 snapshot shaped like quantum.engine.new_session('level1') (only the fields the JS reads). */
export function l1snap({
  doors = '1', status = 'pending', measured = [null, null], validated = false,
  uses = { alice_h: 1, shared_cx: 1 }, marginals = [[1, 0], [1, 0]],
} = {}) {
  return {
    schema_version: 2,
    level_id: 'level1',
    stage_id: 'calibration',
    stage_index: 0,
    stage_count: 1,
    objects: { door_A: doors, door_B: doors },
    measured,
    marginals,
    history: [],
    initial_circuit: [],
    gates_left: 2,
    terminal_uses_left: { ...uses },
    objective: {
      status,
      quantum_ready: status === 'ready',
      failure_policy: 'retry_stage',
      required_measurements: [0, 1],
      requires_run: 'Phi+',
      validated,
    },
  };
}

/** Snapshot with the object states of a level that has qubit-bound doors (level 2 opposites, level 3). */
export const objSnap = (objects, extra = {}) => ({
  objects, measured: [null, null], marginals: [[0.5, 0.5], [0.5, 0.5]], terminal_uses_left: {}, ...extra,
});
