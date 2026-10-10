// Smoke tests for js/render.js with a stub 2D context (no browser). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel } from '../js/grid.js';
import { createWorld } from '../js/entities.js';
import { createRenderer, drawSprite, COLORS, ON_ONE } from '../js/render.js';

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

test('glyph on the "1" door reaches 4.5:1 contrast', () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  assert.ok(ratio(ON_ONE, COLORS.one) >= 4.5, `contrast ${ratio(ON_ONE, COLORS.one)}`);
});

// Context that records globalAlpha at every fillText/stroke so dimming can be inspected.
function alphaCtx() {
  const log = [];
  const state = { globalAlpha: 1 };
  const stack = [];
  return {
    log,
    ctx: new Proxy(state, {
      get: (t, k) => {
        if (k in t) return t[k];
        if (k === 'save') return () => stack.push(t.globalAlpha);
        if (k === 'restore') return () => { t.globalAlpha = stack.pop() ?? 1; };
        return (...a) => { log.push([k, t.globalAlpha, a[0]]); };
      },
      set: (t, k, v) => { t[k] = v; return true; },
    }),
  };
}

test('used terminal: base dimmed, label at full alpha, check mark drawn', () => {
  const world = createWorld(parseLevel(level));
  const draw = (used) => {
    world.terminals[0].usesLeft = used ? 0 : 1;
    const { ctx, log } = alphaCtx();
    createRenderer(canvasWith(ctx)).draw(world, snap('0', '0'), view(), 0);
    return log;
  };
  const label = (log) => log.find((c) => c[0] === 'fillText' && c[2] === 'H');
  assert.equal(label(draw(true))[1], 1);
  assert.equal(label(draw(false))[1], 1);
  const dimmedRects = draw(true).filter((c) => c[0] === 'strokeRect' && c[1] === 0.4).length;
  assert.ok(dimmedRects >= 1);
  const lineTos = (log) => log.filter((c) => c[0] === 'lineTo').length;
  assert.ok(lineTos(draw(true)) > lineTos(draw(false)), 'used terminal draws an extra check mark');
});

test('measured sensor: label full alpha and check mark drawn', () => {
  const world = createWorld(parseLevel(level));
  const run = (measured) => {
    const { ctx, log } = alphaCtx();
    createRenderer(canvasWith(ctx)).draw(world, { objects: {}, measured }, view(), 0);
    return log;
  };
  const done = run([0, null]);
  assert.equal(done.find((c) => c[0] === 'fillText' && c[2] === 'Q0')[1], 1);
  const lineTos = (log) => log.filter((c) => c[0] === 'lineTo').length;
  assert.ok(lineTos(done) > lineTos(run([null, null])));
});
