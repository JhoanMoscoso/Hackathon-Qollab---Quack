// Tests for js/sprite_map.js (pure registry of selected sprite cells). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, SHEET_W, SHEET_H, ATLAS, DIRS, characterFrame, dirFromDelta, walkFrameIndex } from '../js/sprite_map.js';

const REQUIRED = [
  'floor', 'wall', 'wall_center', 'door_0', 'door_1', 'door_super',
  'sensor_idle', 'sensor_0', 'sensor_1', 'terminal_h', 'terminal_x', 'terminal_z',
  'cnot_control', 'cnot_target', 'exit',
];

test('sheet constants match the 256x192 atlas of 16 px cells', () => {
  assert.equal(TILE, 16);
  assert.equal(SHEET_W, 256);
  assert.equal(SHEET_H, 192);
});

test('ATLAS has every selected entry', () => {
  for (const name of REQUIRED) assert.ok(ATLAS[name], `missing ${name}`);
});

test('ATLAS entries are 16-aligned 16x16 rects inside the sheet', () => {
  for (const [name, f] of Object.entries(ATLAS)) {
    assert.equal(f.w, TILE, `${name}.w`);
    assert.equal(f.h, TILE, `${name}.h`);
    assert.equal(f.x % TILE, 0, `${name}.x aligned`);
    assert.equal(f.y % TILE, 0, `${name}.y aligned`);
    assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= SHEET_W && f.y + f.h <= SHEET_H, `${name} inside sheet`);
  }
});

test('ATLAS cells are the reviewed (col,row) selections', () => {
  const cell = (n) => [ATLAS[n].x / TILE, ATLAS[n].y / TILE];
  const expected = {
    floor: [0, 11], wall: [1, 4], wall_center: [2, 4],
    door_0: [1, 2], door_1: [2, 2], door_super: [3, 2],
    sensor_idle: [0, 3], sensor_0: [1, 3], sensor_1: [2, 3],
    terminal_h: [0, 8], terminal_x: [1, 8], terminal_z: [2, 8],
    cnot_control: [3, 8], cnot_target: [5, 8], exit: [4, 11],
  };
  for (const [name, rc] of Object.entries(expected)) assert.deepEqual(cell(name), rc, name);
});

test('ATLAS entries are independent objects (no shared mutable rect)', () => {
  assert.notEqual(ATLAS.door_0, ATLAS.door_1);
});

test('DIRS row order: down, left, right, up', () => {
  assert.deepEqual({ ...DIRS }, { down: 0, left: 1, right: 2, up: 3 });
});

test('characterFrame maps (dir, frame) to the 16x16 strip rect', () => {
  assert.deepEqual(characterFrame('down', 0), { x: 0, y: 0, w: 16, h: 16 });
  assert.deepEqual(characterFrame('left', 1), { x: 16, y: 16, w: 16, h: 16 });
  assert.deepEqual(characterFrame('right', 0), { x: 0, y: 32, w: 16, h: 16 });
  assert.deepEqual(characterFrame('up', 7), { x: 112, y: 48, w: 16, h: 16 });
});

test('characterFrame stays inside the 128x64 strip and rejects bad input', () => {
  for (const dir of Object.keys(DIRS)) {
    for (let i = 0; i < 8; i++) {
      const f = characterFrame(dir, i);
      assert.ok(f.x + f.w <= 128 && f.y + f.h <= 64);
    }
  }
  assert.throws(() => characterFrame('sideways', 0));
  assert.throws(() => characterFrame('down', 8));
  assert.throws(() => characterFrame('down', -1));
});

test('dirFromDelta picks the facing direction', () => {
  assert.equal(dirFromDelta(0, 1), 'down');
  assert.equal(dirFromDelta(0, -1), 'up');
  assert.equal(dirFromDelta(-1, 0), 'left');
  assert.equal(dirFromDelta(1, 0), 'right');
  assert.equal(dirFromDelta(0, 0), null);
  assert.equal(dirFromDelta(2, 1), 'right'); // dominant axis wins
  assert.equal(dirFromDelta(1, -3), 'up');
});

test('walkFrameIndex alternates 0/1 at 8 fps while walking, 0 when idle or reduced motion', () => {
  assert.equal(walkFrameIndex(0, true, false), 0);
  assert.equal(walkFrameIndex(124, true, false), 0);
  assert.equal(walkFrameIndex(125, true, false), 1);
  assert.equal(walkFrameIndex(250, true, false), 0);
  assert.equal(walkFrameIndex(125, false, false), 0);
  assert.equal(walkFrameIndex(125, true, true), 0);
});
