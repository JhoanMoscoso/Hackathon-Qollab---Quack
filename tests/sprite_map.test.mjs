// Tests for js/sprite_map.js (pure registry of selected sprite cells). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, DIRS, characterFrame, dirFromDelta, walkFrameIndex, decorSpritePos } from '../js/sprite_map.js';

test('TILE is the 16 px cell of the character strips', () => {
  assert.equal(TILE, 16);
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

test('decorSpritePos: prop sheets are drawn 1:1; integer, bottom-centre aligned in the footprint', () => {
  const tile = 32;
  // full-footprint sprite (32x64) sits exactly on the cell
  assert.deepEqual(decorSpritePos([7, 1], [1, 2], { w: 32, h: 64 }), [7 * tile, 1 * tile]);
  // shorter than the footprint: bottom aligned, centred horizontally (12x16 in a 1x1 cell)
  assert.deepEqual(decorSpritePos([1, 4], [1, 1], { w: 12, h: 16 }), [1 * tile + 10, 4 * tile + 16]);
  // 41x59 dilution fridge in a 2x2 footprint
  assert.deepEqual(decorSpritePos([2, 3], [2, 2], { w: 41, h: 59 }), [2 * tile + 11, 3 * tile + 5]);
  // wider than its footprint (bench 63 px in 2 cells): still integer, overflows by floor(0.5) px on the left
  assert.deepEqual(decorSpritePos([3, 3], [2, 1], { w: 65, h: 20 }), [3 * tile - 1, 3 * tile + 12]);
  const [x, y] = decorSpritePos([5, 0], [1, 1], { w: 25, h: 11 });
  assert.ok(Number.isInteger(x) && Number.isInteger(y));
  assert.deepEqual([x, y], [5 * tile + 3, 21]);
});
