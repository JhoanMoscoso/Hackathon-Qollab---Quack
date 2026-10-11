// Shared fixtures for the JS tests: real v2 levels (read via fs) and engine-shaped snapshots.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
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

// A synthetic 15x9 map (Batch 3 sizes): divider column 7, Alice cols 1-6, Bob cols 8-13.
export const smallView = (extra = {}) => ({
  id: 'small',
  map: [
    '###############',
    '#.....A#B.....#',
    '#......#......#',
    '#..S...#...s..#',
    '#......#......#',
    '#......#......#',
    '#......#......#',
    '#.E....#....e.#',
    '###############',
  ],
  legend: { A: 'alice_start', B: 'bob_start', S: 'sensor_q0', s: 'sensor_q1', E: 'exit_A', e: 'exit_B', '#': 'wall', '.': 'floor' },
  ...extra,
});

/** Snapshot with the object states of a level that has qubit-bound doors (level 2 opposites, level 3). */
export const objSnap = (objects, extra = {}) => ({
  objects, measured: [null, null], marginals: [[0.5, 0.5], [0.5, 0.5]], terminal_uses_left: {}, ...extra,
});

// Minimal PNG reader for the 8-bit RGBA, non-interlaced V2 atlas (alpha plane only is needed).
export function readPng(path) {
  const buf = readFileSync(path);
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  let width = 0, height = 0;
  const idat = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      assert.deepEqual([...body.subarray(8, 13)], [8, 6, 0, 0, 0], 'expected 8-bit RGBA, no interlace');
    } else if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const cur = raw[y * (stride + 1) + 1 + i];
      const a = i >= 4 ? px[y * stride + i - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? px[(y - 1) * stride + i - 4] : 0;
      const pred = [0, a, b, (a + b) >> 1, (() => {
        const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      })()][filter];
      px[y * stride + i] = (cur + pred) & 255;
    }
  }
  return { width, height, alpha: (x, y) => px[y * stride + x * 4 + 3] };
}

