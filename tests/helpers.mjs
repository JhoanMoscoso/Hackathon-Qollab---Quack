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

const l1fixtures = JSON.parse(readFileSync(new URL('./fixtures/level1_snapshots.json', import.meta.url), 'utf8'));

/**
 * Real engine snapshot of level1 (tests/fixtures/level1_snapshots.json, generated from quantum.engine.Engine):
 * initial | built_h | built | validated | measured_q0_0 | measured_q0_1 | complete_0 | complete_1.
 * `patch` is shallow-merged over a deep copy, e.g. l1snap('validated', { measured: [1, null] }).
 */
export function l1snap(name = 'initial', patch = {}) {
  if (!(name in l1fixtures) || name.startsWith('_')) throw new Error(`unknown level1 fixture ${name}`);
  return { ...structuredClone(l1fixtures[name]), ...patch };
}

/** Snapshot with the object states of a level that has qubit-bound doors (level 2 opposites, level 3). */
export const objSnap = (objects, extra = {}) => ({
  objects, measured: [null, null], marginals: [[0.5, 0.5], [0.5, 0.5]], terminal_uses_left: {}, ...extra,
});
