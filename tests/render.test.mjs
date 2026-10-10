// Smoke tests for js/render.js with a stub 2D context (no browser). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel } from '../js/grid.js';
import { createWorld } from '../js/entities.js';
import { createRenderer, drawSprite } from '../js/render.js';

function stubCtx() {
  const calls = [];
  const target = { calls };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }),
    set: (t, k, v) => { t[k] = v; if (k === 'fillStyle') calls.push(['fillStyle', v]); return true; },
  });
}
const canvasWith = (ctx) => ({ getContext: () => ctx });

const level = JSON.parse(readFileSync(new URL('../levels/test.json', import.meta.url), 'utf8'));
const snap = (a, b) => ({ objects: { door_A: a, door_B: b }, measured: [null, 1] });
const view = (extra = {}) => ({ mode: '1p', active: 'alice', overlay: null, ...extra });

test('drawSprite returns false without a spritesheet and draws nothing', () => {
  const ctx = stubCtx();
  assert.equal(globalThis.SPRITES, undefined);
  assert.equal(drawSprite(ctx, 'wall', 0, 0), false);
  assert.equal(ctx.calls.length, 0);
});

test('drawSprite draws when the sheet has the frame', () => {
  const ctx = stubCtx();
  globalThis.SPRITES = { image: {}, frames: { wall: { x: 0, y: 0, w: 16, h: 16 } } };
  try {
    assert.equal(drawSprite(ctx, 'wall', 32, 64), true);
    assert.equal(drawSprite(ctx, 'unknown', 0, 0), false);
    assert.equal(ctx.calls.filter((c) => c[0] === 'drawImage').length, 1);
  } finally { delete globalThis.SPRITES; }
});

test('renderer disables smoothing and draws every door state without throwing', () => {
  const ctx = stubCtx();
  const r = createRenderer(canvasWith(ctx), { reduceMotion: false });
  assert.equal(ctx.imageSmoothingEnabled, false);
  const world = createWorld(parseLevel(level));
  for (const [a, b] of [['0', '1'], ['super', '0'], ['1', 'super']]) {
    r.draw(world, snap(a, b), view(), 1234);
  }
  r.draw(world, snap('0', '0'), view({ mode: '2p' }), 0);
});

test('overlays render text; reduceMotion freezes super stripes', () => {
  const world = createWorld(parseLevel(level));
  const lines = (reduce, t) => {
    const ctx = stubCtx();
    const r = createRenderer(canvasWith(ctx), { reduceMotion: reduce });
    r.draw(world, snap('super', 'super'), view(), t);
    return JSON.stringify(ctx.calls.filter((c) => c[0] === 'moveTo'));
  };
  assert.equal(lines(true, 0), lines(true, 250));
  assert.notEqual(lines(false, 0), lines(false, 250));

  const ctx = stubCtx();
  const r = createRenderer(canvasWith(ctx));
  r.draw(world, snap('0', '0'), view({ overlay: 'win' }), 0);
  assert.ok(ctx.calls.some((c) => c[0] === 'fillText' && c[1] === 'Level complete'));
  assert.ok(ctx.calls.some((c) => c[0] === 'fillText' && c[1] === 'Press Enter to return to menu'));
  const ctx2 = stubCtx();
  createRenderer(canvasWith(ctx2)).draw(world, snap('0', '0'), view({ overlay: 'dead' }), 0);
  assert.ok(ctx2.calls.some((c) => c[0] === 'fillText' && c[1] === 'Wavefunction collapsed'));
});
