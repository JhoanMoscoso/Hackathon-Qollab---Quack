// Tests for js/sprite_map.js (pure registry of selected sprite cells). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TILE, SHEET_W, SHEET_H, ATLAS, DIRS, characterFrame, dirFromDelta, walkFrameIndex, isFloorDetail, decorSpritePos, DECOR_SCALE,
} from '../js/sprite_map.js';

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

test('isFloorDetail: floor_* names (mats, grates) sit under the other decorations', () => {
  for (const name of ['floor_mat', 'floor_grate', 'floor_crack', 'grate', 'mat']) assert.equal(isFloorDetail(name), true, name);
  for (const name of ['tank_a', 'tank_b', 'plant', 'wall_light', 'desk', '']) assert.equal(isFloorDetail(name), false, name);
});

test('decorSpritePos: frames are source pixels drawn at 2x; integer, bottom-centre aligned in the footprint', () => {
  const tile = 32;
  assert.equal(DECOR_SCALE, 2);
  // full-footprint sprite (16x32 source = 32x64 on screen): exactly on the cell
  assert.deepEqual(decorSpritePos([7, 1], [1, 2], { w: 16, h: 32 }), [7 * tile, 1 * tile]);
  // shorter than the footprint: bottom aligned, centred horizontally (6x8 source = 12x16 screen)
  assert.deepEqual(decorSpritePos([1, 4], [1, 1], { w: 6, h: 8 }), [1 * tile + 10, 4 * tile + 16]);
  // 24x6 source mat in a 2x1 footprint: 48x12 screen
  assert.deepEqual(decorSpritePos([5, 3], [2, 1], { w: 24, h: 6 }), [5 * tile + 8, 3 * tile + 20]);
  // tank 7x17 source = 14x34 screen in a 1x2 footprint
  assert.deepEqual(decorSpritePos([7, 1], [1, 2], { w: 7, h: 17 }), [7 * tile + 9, 1 * tile + 64 - 34]);
  // 6x3 source light on a wall tile: 12x6 screen, resting on the bottom of the tile
  assert.deepEqual(decorSpritePos([5, 0], [1, 1], { w: 6, h: 3 }), [5 * tile + 10, 26]);
  // odd source widths still land on integers
  const [x, y] = decorSpritePos([5, 0], [1, 1], { w: 5, h: 11 });
  assert.ok(Number.isInteger(x) && Number.isInteger(y));
  assert.deepEqual([x, y], [5 * tile + 11, 10]);
});
