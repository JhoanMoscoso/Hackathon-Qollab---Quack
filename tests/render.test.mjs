// Smoke tests for js/render.js with a stub 2D context (no browser). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, drawSprite, COLORS, ON_ONE } from '../js/render.js';
import { worldOf, l1snap, objSnap } from './helpers.mjs';

function stubCtx() {
  const calls = [];
  const target = { calls };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }),
    set: (t, k, v) => { t[k] = v; if (k === 'fillStyle') calls.push(['fillStyle', v]); return true; },
  });
}
const canvasWith = (ctx) => ({ getContext: () => ctx });

// Real v2 levels via stageView: level 1 for doors/sensors/cx, level 3 for lethal doors and X/Z terminals.
const l3snap = (a = '0', b = '0') => objSnap({ bridge_A: a, laser_B: b });
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
  const world = worldOf(1);
  for (const [a, b] of [['0', '1'], ['super', '0'], ['1', 'super']]) {
    r.draw(world, snap(a, b), view(), 1234);
  }
  r.draw(world, snap('0', '0'), view({ mode: '2p' }), 0);
});

test('overlays render text; reduceMotion freezes super stripes', () => {
  const world = worldOf(1);
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
  const world = worldOf(1);
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
  const world = worldOf(1);
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

test('cnot: cable only between adjacent cells, otherwise a CX label on each cell', () => {
  const count = (world, name) => {
    const ctx = stubCtx();
    createRenderer(canvasWith(ctx)).draw(world, l3snap(), view(), 0);
    return ctx.calls.filter((c) => c[0] === name || (c[0] === 'fillText' && c[1] === name)).length;
  };
  const near = worldOf(1);
  assert.equal(count(near, 'CX'), 0, 'L1 niche: adjacent, no labels');
  const far = worldOf(3);
  assert.deepEqual(far.cnot.control.map((v, i) => Math.abs(v - far.cnot.target[i])).reduce((a, b) => a + b) > 1, true);
  assert.equal(count(far, 'CX'), 2, 'L3: far apart, one label per cell');
});

test('joint lock: closed ("1") draws a lock; blocking:false doors are indicators without hazard border', () => {
  const lineDashes = (ctx) => ctx.calls.filter((c) => c[0] === 'setLineDash' && c[1].length === 2).length;
  const arcs = (world, state) => {
    const ctx = stubCtx();
    createRenderer(canvasWith(ctx)).draw(world, snap(state, state), view(), 0);
    return ctx.calls.filter((c) => c[0] === 'arc').length;
  };
  const world = worldOf(1);
  assert.ok(arcs(world, '1') > arcs(world, '0'), 'lock shackle only while closed');
  const dashes = (blocking) => {
    const flat = worldOf(1);
    flat.doors.forEach((d) => { d.blocking = blocking; d.lethal = true; });
    const ctx = stubCtx();
    createRenderer(canvasWith(ctx)).draw(flat, snap('1', '1'), view(), 0);
    return { dashes: lineDashes(ctx), one: ctx.calls.some((c) => c[0] === 'fillText' && c[1] === '1') };
  };
  const solid = dashes(true);
  const indicator = dashes(false);
  assert.equal(solid.dashes - indicator.dashes, 2, 'two lethal doors lose their dashed hazard border');
  assert.ok(indicator.one, 'indicator still shows the 1 glyph');
});

// ---------- sprite path (fake SPRITES, recording context) ----------
// Records every call with the globalAlpha in force at that moment.
function recCtx() {
  const calls = [];
  const state = { globalAlpha: 1 };
  const stack = [];
  const ctx = new Proxy(state, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'save') return () => stack.push(t.globalAlpha);
      if (k === 'restore') return () => { t.globalAlpha = stack.pop() ?? 1; };
      return (...a) => { calls.push({ name: k, alpha: t.globalAlpha, args: a }); };
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { ctx, calls };
}

const SHEET = { id: 'sheet' };
const ALICE = { id: 'alice-strip' };
const BOB = { id: 'bob-strip' };
const FRAMES = {
  floor: { x: 0, y: 176, w: 16, h: 16 }, wall: { x: 16, y: 64, w: 16, h: 16 }, wall_center: { x: 32, y: 64, w: 16, h: 16 },
  door_0: { x: 16, y: 32, w: 16, h: 16 }, door_1: { x: 32, y: 32, w: 16, h: 16 }, door_super: { x: 48, y: 32, w: 16, h: 16 },
  sensor_idle: { x: 0, y: 48, w: 16, h: 16 }, sensor_0: { x: 16, y: 48, w: 16, h: 16 }, sensor_1: { x: 32, y: 48, w: 16, h: 16 },
  terminal_h: { x: 0, y: 128, w: 16, h: 16 }, terminal_x: { x: 16, y: 128, w: 16, h: 16 }, terminal_z: { x: 32, y: 128, w: 16, h: 16 },
  cnot_control: { x: 48, y: 128, w: 16, h: 16 }, cnot_target: { x: 80, y: 128, w: 16, h: 16 }, exit: { x: 64, y: 176, w: 16, h: 16 },
};
const withSprites = (fn) => {
  globalThis.SPRITES = { image: SHEET, frames: FRAMES, characters: { alice: ALICE, bob: BOB } };
  try { return fn(); } finally { delete globalThis.SPRITES; }
};
const rect = (f) => [f.x, f.y, f.w, f.h];
/** drawImage calls of `image` landing exactly on the 32 px cell (cx, cy), in draw order. */
const imagesAt = (calls, cx, cy, image) => calls
  .filter((c) => c.name === 'drawImage' && (!image || c.args[0] === image) && c.args[5] === cx * 32 && c.args[6] === cy * 32);
const lastAt = (calls, cx, cy, image = SHEET) => imagesAt(calls, cx, cy, image).at(-1);

test('sprites: tiles are drawn 32x32 on integer positions, floor under everything, smoothing off', () => withSprites(() => {
  const { ctx, calls } = recCtx();
  const world = worldOf(1);
  createRenderer(canvasWith(ctx)).draw(world, snap('0', '0'), view(), 0);
  assert.equal(ctx.imageSmoothingEnabled, false);
  const imgs = calls.filter((c) => c.name === 'drawImage');
  assert.ok(imgs.length > 0);
  for (const c of imgs) {
    assert.equal(c.args[7], 32);
    assert.equal(c.args[8], 32);
    assert.ok(Number.isInteger(c.args[5]) && Number.isInteger(c.args[6]));
  }
  // every cell gets a floor first; walls drawn after the floor on the same cell
  assert.equal(imgs.filter((c) => c.args[0] === SHEET && c.args[1] === 0 && c.args[2] === 176).length, 20 * 12);
  const atWall = imagesAt(calls, 0, 0, SHEET);
  assert.deepEqual(atWall.map((c) => c.args.slice(1, 5)), [rect(FRAMES.floor), rect(FRAMES.wall)]);
  const atCenter = imagesAt(calls, 9, 0, SHEET);
  assert.deepEqual(atCenter.at(-1).args.slice(1, 5), rect(FRAMES.wall_center));
}));

test('sprites: door_A uses door_0 (open, dimmed), door_1 (closed, full) and door_super (full)', () => withSprites(() => {
  const world = worldOf(1);
  const doorAt = [world.doors[0].x, world.doors[0].y];
  const run = (state) => {
    const { ctx, calls } = recCtx();
    createRenderer(canvasWith(ctx)).draw(world, snap(state, '1'), view(), 0);
    return lastAt(calls, ...doorAt);
  };
  const open = run('0');   // open_on 0 -> passable
  assert.deepEqual(open.args.slice(1, 5), rect(FRAMES.door_0));
  assert.equal(open.alpha, 0.35);
  const closed = run('1');
  assert.deepEqual(closed.args.slice(1, 5), rect(FRAMES.door_1));
  assert.equal(closed.alpha, 1);
  const sup = run('super');
  assert.deepEqual(sup.args.slice(1, 5), rect(FRAMES.door_super));
  assert.equal(sup.alpha, 1);
}));

test('sprites: door value badge glyph is drawn at full alpha with a readable fill', () => withSprites(() => {
  const world = worldOf(1);
  const run = (state) => {
    const { ctx, calls } = recCtx();
    createRenderer(canvasWith(ctx)).draw(world, snap(state, '1'), view(), 0);
    return calls.filter((c) => c.name === 'fillText');
  };
  const doorA = world.doors[0];
  const open = run('0').find((c) => c.args[0] === '0' && c.args[1] > doorA.x * 32 && c.args[1] < doorA.x * 32 + 32);
  assert.ok(open, 'glyph 0 near door_A');
  assert.equal(open.alpha, 1);
  assert.ok(run('1').some((c) => c.args[0] === '1' && c.args[1] > doorA.x * 32 && c.args[1] < doorA.x * 32 + 32));
  assert.ok(run('super').some((c) => c.args[0] === '?'));
}));

test('sprites: badge contrast on the zero and one fills is at least 4.5:1', () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  assert.ok(ratio(ON_ONE, COLORS.one) >= 4.5);
  assert.ok(ratio(ON_ONE, COLORS.zero) >= 4.5);
});

test('sprites: super stripes overlay animates at 4 fps and freezes with reduceMotion', () => withSprites(() => {
  const world = worldOf(1);
  const moves = (reduce, t) => {
    const { ctx, calls } = recCtx();
    createRenderer(canvasWith(ctx), { reduceMotion: reduce }).draw(world, snap('super', 'super'), view(), t);
    return JSON.stringify(calls.filter((c) => c.name === 'moveTo').map((c) => c.args));
  };
  assert.equal(moves(true, 0), moves(true, 250));
  assert.notEqual(moves(false, 0), moves(false, 250));
}));

test('sprites: lethal door keeps its dashed hazard border; non-lethal joint locks have none', () => withSprites(() => {
  const dashes = (world, s) => {
    const { ctx, calls } = recCtx();
    createRenderer(canvasWith(ctx)).draw(world, s, view({ mode: '2p' }), 0); // 2P: no dashed active ring
    return calls.filter((c) => c.name === 'setLineDash' && c.args[0].length === 2).length;
  };
  assert.equal(dashes(worldOf(1), l1snap()), 0);
  assert.equal(dashes(worldOf(3), l3snap()), 2); // bridge_A and laser_B
}));

test('level 1 and level 3 render with engine-shaped snapshots (joint locks, cx, sprites on and off)', () => {
  for (const sprites of [false, true]) {
    if (sprites) globalThis.SPRITES = { image: SHEET, frames: FRAMES };
    try {
      const { ctx } = recCtx();
      const r = createRenderer(canvasWith(ctx));
      r.draw(worldOf(1), l1snap(), view(), 0);
      r.draw(worldOf(1), l1snap({ doors: '0', status: 'ready', measured: [0, 0], validated: true }), view(), 0);
      r.draw(worldOf(3), l3snap('super', '1'), view(), 0);
    } finally { delete globalThis.SPRITES; }
  }
});

test('sprites: sensors use idle until measured, then the measured value', () => withSprites(() => {
  const world = worldOf(1);
  const [s0, s1] = world.sensors;
  const draw = (measured) => {
    const { ctx, calls } = recCtx();
    createRenderer(canvasWith(ctx)).draw(world, { objects: {}, measured }, view(), 0);
    return calls;
  };
  const a = draw([null, null]);
  assert.deepEqual(lastAt(a, s0.x, s0.y).args.slice(1, 5), rect(FRAMES.sensor_idle));
  assert.deepEqual(lastAt(a, s1.x, s1.y).args.slice(1, 5), rect(FRAMES.sensor_idle));
  assert.ok(a.some((c) => c.name === 'fillText' && c.args[0] === 'Q0' && c.alpha === 1));
  const b = draw([1, 0]);
  assert.deepEqual(lastAt(b, s0.x, s0.y).args.slice(1, 5), rect(FRAMES.sensor_1));
  assert.deepEqual(lastAt(b, s1.x, s1.y).args.slice(1, 5), rect(FRAMES.sensor_0));
  assert.ok(b.some((c) => c.name === 'fillText' && c.args[0] === 'Q1' && c.alpha === 1));
}));

test('sprites: terminals pick the gate sprite; used ones are dimmed but keep a full-alpha check mark', () => withSprites(() => {
  const world = worldOf(3);
  const [h, , x] = world.terminals; // alice_h, alice_z, bob_x
  const draw = (used) => {
    world.terminals[0].usesLeft = used ? 0 : 1;
    const { ctx, calls } = recCtx();
    createRenderer(canvasWith(ctx)).draw(world, l3snap(), view(), 0);
    return calls;
  };
  const fresh = draw(false);
  assert.deepEqual(lastAt(fresh, h.x, h.y).args.slice(1, 5), rect(FRAMES.terminal_h));
  assert.deepEqual(lastAt(fresh, x.x, x.y).args.slice(1, 5), rect(FRAMES.terminal_x));
  assert.equal(lastAt(fresh, h.x, h.y).alpha, 1);
  const used = draw(true);
  assert.equal(lastAt(used, h.x, h.y).alpha, 0.4);
  const checks = (calls) => calls.filter((c) => c.name === 'lineTo' && c.alpha === 1).length;
  assert.ok(checks(used) > checks(fresh));
  world.terminals[0].usesLeft = 1;
}));

test('sprites: cnot cells use control/target sprites and keep the cable', () => withSprites(() => {
  const world = worldOf(1);
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(world, snap('0', '0'), view(), 0);
  const [cx, cy] = world.cnot.control;
  const [tx, ty] = world.cnot.target;
  assert.deepEqual(lastAt(calls, cx, cy).args.slice(1, 5), rect(FRAMES.cnot_control));
  assert.deepEqual(lastAt(calls, tx, ty).args.slice(1, 5), rect(FRAMES.cnot_target));
  assert.ok(calls.some((c) => c.name === 'lineTo' && c.args[1] === cy * 32 + 16 && c.args[0] === tx * 32 + 16));
}));

test('sprites: exits use the exit sprite plus a player letter (identity not by color alone)', () => withSprites(() => {
  const world = worldOf(1);
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(world, snap('0', '0'), view(), 0);
  for (const e of world.exits) {
    assert.deepEqual(lastAt(calls, e.x, e.y).args.slice(1, 5), rect(FRAMES.exit));
    const letter = e.player === 'alice' ? 'A' : 'B';
    assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === letter
      && c.args[1] > e.x * 32 && c.args[1] < e.x * 32 + 32 && c.args[2] > e.y * 32 && c.args[2] < e.y * 32 + 32), `${letter} on exit`);
  }
}));

test('sprites: players use their own strip, face where they moved and walk-cycle at 8 fps', () => withSprites(() => {
  const world = worldOf(1);
  const { ctx, calls } = recCtx();
  const r = createRenderer(canvasWith(ctx));
  const a = world.players.alice;
  const frameOf = (t) => {
    calls.length = 0;
    r.draw(world, snap('0', '0'), view(), t);
    return lastAt(calls, a.x, a.y, ALICE).args.slice(1, 5);
  };
  assert.deepEqual(frameOf(1000), [0, 0, 16, 16]);       // idle, facing down
  a.x += 1;                                               // step right
  assert.deepEqual(frameOf(1010), [0, 32, 16, 16]);      // right row, walk frame 0 (1010/125 -> 8 even)
  assert.deepEqual(frameOf(1130), [16, 32, 16, 16]);     // 1130/125 -> 9 odd
  assert.deepEqual(frameOf(1270), [0, 32, 16, 16]);      // 1270/125 -> 10 even
  assert.deepEqual(frameOf(1400), [0, 32, 16, 16]);      // idle after 250 ms, still facing right
  a.y -= 1;                                               // step up
  assert.deepEqual(frameOf(1500)[1], 48);
  const bobCalls = (calls.length = 0, r.draw(world, snap('0', '0'), view(), 1600), calls);
  const b = world.players.bob;
  assert.ok(lastAt(bobCalls, b.x, b.y, BOB));
}));

test('sprites: reduceMotion keeps the walk frame at 0', () => withSprites(() => {
  const world = worldOf(1);
  const { ctx, calls } = recCtx();
  const r = createRenderer(canvasWith(ctx), { reduceMotion: true });
  const a = world.players.alice;
  r.draw(world, snap('0', '0'), view(), 1000);
  a.x += 1;
  for (const t of [1010, 1130, 1260]) {
    calls.length = 0;
    r.draw(world, snap('0', '0'), view(), t);
    assert.deepEqual(lastAt(calls, a.x, a.y, ALICE).args.slice(1, 5), [0, 32, 16, 16]);
  }
  a.x -= 1;
}));

test('sprites: players keep the A/B marker and the 1P active ring', () => withSprites(() => {
  const world = worldOf(1);
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(world, snap('0', '0'), view({ active: 'alice' }), 0);
  const a = world.players.alice;
  assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === 'A' && c.args[1] > a.x * 32 && c.args[1] < a.x * 32 + 32 && c.args[2] > a.y * 32 && c.args[2] < a.y * 32 + 32));
  assert.ok(calls.some((c) => c.name === 'setLineDash' && c.args[0].length === 2), 'active ring dashed');
}));

test('fallback: sheet without character strips still draws procedural players', () => {
  globalThis.SPRITES = { image: SHEET, frames: FRAMES };
  try {
    const world = worldOf(1);
    const { ctx, calls } = recCtx();
    createRenderer(canvasWith(ctx)).draw(world, snap('0', '0'), view(), 0);
    assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === 'A'));
    assert.ok(calls.some((c) => c.name === 'arc'));
  } finally { delete globalThis.SPRITES; }
});

test('fallback: without SPRITES nothing calls drawImage and procedural shapes are drawn', () => {
  assert.equal(globalThis.SPRITES, undefined);
  const world = worldOf(1);
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(world, snap('super', '1'), view(), 0);
  assert.equal(calls.filter((c) => c.name === 'drawImage').length, 0);
  assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === 'A'));
  assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === '?'));
});
