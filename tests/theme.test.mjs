// Pure tile-picking rules of js/theme.js. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../js/grid.js';
import { Door, GateTerminal, Sensor, Exit, CnotTerminal } from '../js/entities.js';
import {
  hash2, floorTile, wallTile, doorTile, sensorTile, exitTile, terminalTile, cnotTile, propFrame,
  isSolidDecoration, isFloorDecal, tileRect, propRect, themeData, WALL_FACES, FLOOR_TILES,
} from '../js/theme.js';
import { smallView, l1snap, objSnap } from './helpers.mjs';

const grid = (extra) => parseLevel(smallView(extra));

test('hash2 is deterministic, unsigned 32-bit and varies with x, y and salt', () => {
  assert.equal(hash2(3, 4), hash2(3, 4));
  assert.ok(Number.isInteger(hash2(3, 4)) && hash2(3, 4) >= 0 && hash2(3, 4) < 2 ** 32);
  assert.notEqual(hash2(3, 4), hash2(4, 3));
  assert.notEqual(hash2(3, 4, 1), hash2(3, 4, 2));
  assert.equal(new Set(Array.from({ length: 200 }, (_, i) => hash2(i % 20, Math.floor(i / 20)))).size > 190, true);
});

test('floorTile: shadow right under a wall, otherwise mostly floor_a/floor_b with rare worn/crack', () => {
  const g = grid();
  for (let x = 1; x < 14; x++) if (x !== 7) assert.equal(floorTile(x, 1, g), 'floor_shadow', `x=${x}`);
  const counts = {};
  const big = parseLevel({
    id: 'big',
    map: ['#'.repeat(20), '#A' + '.'.repeat(16) + 'B#', ...Array.from({ length: 9 }, () => '#' + '.'.repeat(18) + '#'), '#'.repeat(20)],
    legend: { '#': 'wall', '.': 'floor', A: 'alice_start', B: 'bob_start' },
  });
  for (let y = 2; y < 11; y++) for (let x = 1; x < 19; x++) { const t = floorTile(x, y, big); counts[t] = (counts[t] ?? 0) + 1; }
  const total = Object.values(counts).reduce((a, b) => a + b);
  assert.ok((counts.floor_a + counts.floor_b) / total > 0.8, JSON.stringify(counts));
  assert.ok(counts.floor_a > 10 && counts.floor_b > 10, 'both plain variants are used');
  assert.ok(Object.keys(counts).every((t) => FLOOR_TILES.includes(t)), JSON.stringify(counts));
  assert.equal(floorTile(5, 5, big), floorTile(5, 5, big), 'deterministic');
});

test('wallTile: divider column alternates divider / divider_face from the top', () => {
  const g = grid();
  assert.equal(wallTile(7, 0, g), 'divider');
  assert.equal(wallTile(7, 1, g), 'divider_face');
  assert.equal(wallTile(7, 2, g), 'divider');
  assert.equal(wallTile(7, 8, g), 'divider');
});

test('wallTile: a wall with floor below shows a wall face, a wall with wall below is a flat wall_top', () => {
  const g = grid();
  for (const x of [1, 3, 5, 9, 12, 13]) assert.ok(WALL_FACES.includes(wallTile(x, 0, g)), `top row x=${x}: ${wallTile(x, 0, g)}`);
  for (let y = 1; y < 8; y++) { assert.equal(wallTile(0, y, g), 'wall_top'); assert.equal(wallTile(14, y, g), 'wall_top'); }
  assert.equal(wallTile(3, 8, g), 'wall_top', 'bottom outer wall: nothing below');
  assert.equal(wallTile(0, 0, g), 'wall_top', 'corner');
});

test('wallTile: faces are mostly plain a/b, with rare vent/pipe/sign/window variants', () => {
  const wide = parseLevel({
    id: 'wide', map: ['#'.repeat(20), '#A' + '.'.repeat(16) + 'B#', '#'.repeat(20)], legend: { '#': 'wall', '.': 'floor', A: 'alice_start', B: 'bob_start' },
  });
  const seen = new Set();
  let plain = 0;
  for (let x = 0; x < 20; x++) { const t = wallTile(x, 0, wide); seen.add(t); if (t === 'wall_face_a' || t === 'wall_face_b') plain++; }
  assert.ok(plain >= 8, `plain ${plain}`);
  assert.ok(seen.size >= 3, [...seen].join());
});

test('doorTile (engine-driven): door_locked while closed, door_open once open', () => {
  const d = new Door('door_A', 1, 8, 0, undefined, false, true, 'validated_exit');
  assert.equal(doorTile(d, l1snap('initial'), 0, false), 'door_locked');
  assert.equal(doorTile(d, l1snap('validated'), 0, false), 'door_locked', 'objects say super, door_states say closed');
  assert.equal(doorTile(d, l1snap('complete_0'), 0, false), 'door_open');
});

test('doorTile (legacy qubit doors): 0 -> door_0, 1 -> door_1, super flickers a/b at 4 fps and is static a under reduced motion', () => {
  const d = new Door('d', 1, 1, 0, 0, false);
  const snap = (s) => objSnap({ d: s });
  assert.equal(doorTile(d, snap('0'), 0, false), 'door_0');
  assert.equal(doorTile(d, snap('1'), 0, false), 'door_1');
  assert.equal(doorTile(d, snap('super'), 0, false), 'door_super_a');
  assert.equal(doorTile(d, snap('super'), 250, false), 'door_super_b');
  assert.equal(doorTile(d, snap('super'), 500, false), 'door_super_a');
  for (const t of [0, 250, 500, 777]) assert.equal(doorTile(d, snap('super'), t, true), 'door_super_a');
});

test('doorTile: a lethal door that is closed shows the hazard door, an open or superposed one keeps its state art', () => {
  const lethal = new Door('d', 1, 1, 0, 0, true);
  const snap = (s) => objSnap({ d: s });
  assert.equal(doorTile(lethal, snap('1'), 0, false), 'door_lethal');
  assert.equal(doorTile(lethal, snap('0'), 0, false), 'door_0');
  assert.equal(doorTile(lethal, snap('super'), 0, true), 'door_super_a');
});

test('sensorTile: disabled until measurement is enabled, then idle, then the measured value', () => {
  const s = new Sensor(0, 3, 4);
  assert.equal(sensorTile(s, l1snap('built')), 'sensor_disabled');
  assert.equal(sensorTile(s, l1snap('validated')), 'sensor_idle');
  assert.equal(sensorTile(s, objSnap({}, { measured: [null, null] })), 'sensor_idle', 'levels without measurement_enabled stay idle');
  assert.equal(sensorTile(s, objSnap({}, { measured: [1, null] })), 'sensor_1');
  assert.equal(sensorTile(new Sensor(1, 3, 4), objSnap({}, { measured: [1, 0] })), 'sensor_0');
  assert.equal(sensorTile(s, l1snap('measured_q0_1')), 'sensor_1', 'a measured value wins over everything');
});

test('exitTile: closed until the objective is ready or the exits are unlocked, then a/b at 2 fps (a when reduced motion)', () => {
  const e = new Exit('alice', 1, 9);
  assert.equal(exitTile(e, l1snap('validated'), 0, false), 'exit_closed');
  assert.equal(exitTile(e, l1snap('complete_0'), 0, false), 'exit_open_a');
  assert.equal(exitTile(e, l1snap('complete_0'), 500, false), 'exit_open_b');
  assert.equal(exitTile(e, l1snap('complete_0'), 1000, false), 'exit_open_a');
  assert.equal(exitTile(e, l1snap('complete_0'), 500, true), 'exit_open_a');
  assert.equal(exitTile(e, { exits_unlocked: true }, 0, true), 'exit_open_a');
  assert.equal(exitTile(e, { exits_unlocked: false }, 0, true), 'exit_closed');
  assert.equal(exitTile(e, null, 0, false), 'exit_closed');
});

test('terminalTile: gate glyph per terminal, term_off once used up, Bob\'s own CX is the orange owner console', () => {
  assert.equal(terminalTile(new GateTerminal(1, 1, 'h', 'alice', 1, 'a')), 'term_h');
  assert.equal(terminalTile(new GateTerminal(1, 1, 'x', 'bob', 1, 'b')), 'term_x');
  assert.equal(terminalTile(new GateTerminal(1, 1, 'z', 'alice', 1, 'c')), 'term_z');
  assert.equal(terminalTile(new GateTerminal(1, 1, 'cx', 'bob', 1, 'bob_cx', 0, 1)), 'term_cx_owner');
  const used = new GateTerminal(1, 1, 'h', 'alice', 1, 'a');
  used.usesLeft = 0;
  assert.equal(terminalTile(used), 'term_off');
  assert.equal(terminalTile(new GateTerminal(1, 1, 'x', 'bob', null, 'u')), 'term_x', 'unlimited never runs out');
});

test('cnotTile: control / target consoles, both off once used', () => {
  const c = new CnotTerminal([4, 3], [15, 3], 'shared_cx', 1);
  assert.equal(cnotTile(c, 'control'), 'term_cx_control');
  assert.equal(cnotTile(c, 'target'), 'term_cx_target');
  c.usesLeft = 0;
  assert.equal(cnotTile(c, 'control'), 'term_off');
  assert.equal(cnotTile(c, 'target'), 'term_off');
});

test('propFrame: animated pairs alternate at 2 fps, static under reduced motion, plain props never change', () => {
  assert.equal(propFrame('lab', 'dilution_fridge_a', 0, false), 'dilution_fridge_a');
  assert.equal(propFrame('lab', 'dilution_fridge_a', 500, false), 'dilution_fridge_b');
  assert.equal(propFrame('lab', 'dilution_fridge_a', 1000, false), 'dilution_fridge_a');
  assert.equal(propFrame('lab', 'dilution_fridge_a', 500, true), 'dilution_fridge_a');
  assert.equal(propFrame('lab', 'dilution_fridge_b', 0, false), 'dilution_fridge_b');
  assert.equal(propFrame('prison', 'wall_fan_a', 500, false), 'wall_fan_b');
  assert.equal(propFrame('lab', 'optical_table', 500, false), 'optical_table');
  assert.equal(propFrame('lab', 'not_a_prop', 500, false), 'not_a_prop');
});

test('isSolidDecoration: explicit flag wins, else the registry default, else walk-over', () => {
  assert.equal(isSolidDecoration('lab', { sprite: 'optical_table' }), true);
  assert.equal(isSolidDecoration('lab', { sprite: 'optical_table', solid: false }), false);
  assert.equal(isSolidDecoration('lab', { sprite: 'floor_grate' }), false);
  assert.equal(isSolidDecoration('lab', { sprite: 'floor_grate', solid: true }), true);
  assert.equal(isSolidDecoration('lab', { sprite: 'nope' }), false);
  assert.equal(isSolidDecoration('prison', { sprite: 'bunk_a' }), true);
  assert.equal(isSolidDecoration('prison', { sprite: 'optical_table' }), false, 'the registry is per theme');
});

test('isFloorDecal: floor_* names are decals drawn under the other decorations', () => {
  assert.equal(isFloorDecal('floor_grate'), true);
  assert.equal(isFloorDecal('floor_chalk_circle'), true);
  assert.equal(isFloorDecal('plant'), false);
  assert.equal(isFloorDecal('wall_clock'), false);
});

test('tileRect / propRect resolve registry entries to source rects; unknown names are null', () => {
  assert.deepEqual(tileRect('lab', 'floor_a'), { x: 0, y: 0, w: 32, h: 32 });
  assert.deepEqual(tileRect('lab', 'term_cx_owner'), { x: 160, y: 128, w: 32, h: 32 });
  assert.equal(tileRect('lab', 'nope'), null);
  const fridge = propRect('lab', 'dilution_fridge_a');
  assert.deepEqual([fridge.sheet, fridge.footprint], ['props', [2, 2]]);
  assert.equal(fridge.w, 41);
  assert.equal(propRect('lab', 'plant').sheet, 'tiles');
  assert.equal(propRect('lab', 'nope'), null);
  assert.equal(themeData('jungle'), themeData('lab'), 'unknown theme falls back to lab');
});

test('both themes provide every tile the picking rules can return', () => {
  const names = [...FLOOR_TILES, ...WALL_FACES, 'divider', 'divider_face', 'door_locked', 'door_open', 'door_0', 'door_1', 'door_super_a',
    'door_super_b', 'door_lethal', 'sensor_idle', 'sensor_disabled', 'sensor_0', 'sensor_1', 'exit_closed', 'exit_open_a', 'exit_open_b',
    'term_h', 'term_x', 'term_z', 'term_cx_control', 'term_cx_target', 'term_cx_owner', 'term_off', 'floor_shadow'];
  for (const theme of ['lab', 'prison']) for (const n of names) assert.ok(tileRect(theme, n), `${theme}:${n}`);
});
