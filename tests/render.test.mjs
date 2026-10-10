// Smoke tests for js/render.js with a stub 2D context (no browser). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, drawSprite, COLORS, ON_ONE } from '../js/render.js';
import { worldOf, l1snap, objSnap, view as levelView } from './helpers.mjs';
import { parseLevel } from '../js/grid.js';
import { createWorld } from '../js/entities.js';
import { DECOR_FRAMES } from '../js/sprites.js';

function stubCtx() {
  const calls = [];
  const target = { calls };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }),
    set: (t, k, v) => { t[k] = v; if (k === 'fillStyle') calls.push(['fillStyle', v]); return true; },
  });
}
const canvasWith = (ctx) => ({ getContext: () => ctx });

// The L1 map with legacy qubit-value "joint lock" doors (open_on 0, state from snap.objects). L2/L3 still use
// that door contract; the real L1 doors are engine-driven `validated_exit`s (see the door_states tests below).
function jointWorld() {
  const v = structuredClone(levelView(1));
  for (const name of ['door_A', 'door_B']) {
    v.objects[name] = { type: 'objective_controlled_joint_lock', blocking: true, lethal: false, open_on: 0 };
  }
  return createWorld(parseLevel(v));
}

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
  const world = jointWorld();
  for (const [a, b] of [['0', '1'], ['super', '0'], ['1', 'super']]) {
    r.draw(world, snap(a, b), view(), 1234);
  }
  r.draw(world, snap('0', '0'), view({ mode: '2p' }), 0);
});

test('overlays render text; reduceMotion freezes super stripes', () => {
  const world = jointWorld();
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
  const world = jointWorld();
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
  const world = jointWorld();
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
  assert.equal(worldOf(1).cnot, null, 'L1 has no co-op CX: Bob owns a plain CX terminal');
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
  const world = jointWorld();
  assert.ok(arcs(world, '1') > arcs(world, '0'), 'lock shackle only while closed');
  const dashes = (blocking) => {
    const flat = jointWorld();
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
  const world = jointWorld();
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
  const world = jointWorld();
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

test('sprites: validated_exit doors are drawn from door_states (open door_0 dimmed / closed door_1 + padlock), never from objects', () => withSprites(() => {
  const world = worldOf(1);
  const [a, b] = world.doors;
  const run = (name) => {
    const { ctx, calls } = recCtx();
    createRenderer(canvasWith(ctx)).draw(world, l1snap(name), view(), 0);
    const arcs = calls.filter((c) => c.name === 'arc' && c.args[0] > a.x * 32 && c.args[0] < a.x * 32 + 32
      && c.args[1] > a.y * 32 && c.args[1] < a.y * 32 + 32).length;
    return { a: lastAt(calls, a.x, a.y), b: lastAt(calls, b.x, b.y), arcs };
  };
  const initial = run('initial'); // objects say "0" (|00>), door_states say closed
  assert.deepEqual(initial.a.args.slice(1, 5), rect(FRAMES.door_1));
  assert.equal(initial.a.alpha, 1);
  // A validated Bell pair has objects "super": still plain closed art, not the violet superposition door.
  const validated = run('validated');
  assert.equal(l1snap('validated').objects.door_A, 'super');
  assert.deepEqual(validated.a.args.slice(1, 5), rect(FRAMES.door_1));
  assert.deepEqual(validated.b.args.slice(1, 5), rect(FRAMES.door_1));
  assert.ok(validated.arcs > 0, 'padlock shackle while locked');
  for (const name of ['complete_0', 'complete_1']) {
    const done = run(name);
    assert.deepEqual(done.a.args.slice(1, 5), rect(FRAMES.door_0), name);
    assert.equal(done.a.alpha, 0.35);
    assert.deepEqual(done.b.args.slice(1, 5), rect(FRAMES.door_0), name);
    assert.equal(done.arcs, 0, `${name}: no padlock once open`);
  }
}));

test('procedural doors: engine-driven closed draws a lock, open does not', () => {
  const world = worldOf(1);
  const arcs = (name) => {
    const ctx = stubCtx();
    createRenderer(canvasWith(ctx)).draw(world, l1snap(name), view(), 0);
    const door = world.doors[0];
    return ctx.calls.filter((c) => c[0] === 'arc' && c[1] > door.x * 32 && c[1] < door.x * 32 + 32
      && c[2] > door.y * 32 && c[2] < door.y * 32 + 32).length;
  };
  assert.ok(arcs('validated') > 0);
  assert.equal(arcs('complete_0'), 0);
});

test('sprites: door value badge glyph is drawn at full alpha with a readable fill', () => withSprites(() => {
  const world = jointWorld();
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
  const world = jointWorld();
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
  assert.equal(dashes(jointWorld(), l1snap()), 0);
  assert.equal(dashes(worldOf(3), l3snap()), 2); // bridge_A and laser_B
}));

test('level 1 and level 3 render with engine-shaped snapshots (joint locks, cx, sprites on and off)', () => {
  for (const sprites of [false, true]) {
    if (sprites) globalThis.SPRITES = { image: SHEET, frames: FRAMES };
    try {
      const { ctx } = recCtx();
      const r = createRenderer(canvasWith(ctx));
      r.draw(worldOf(1), l1snap(), view(), 0);
      r.draw(worldOf(1), l1snap('complete_1'), view(), 0);
      r.draw(jointWorld(), snap('0', '0'), view(), 0);
      r.draw(worldOf(1), l1snap('complete_0'), view(), 0);
      r.draw(worldOf(3), l3snap('super', '1'), view(), 0);
    } finally { delete globalThis.SPRITES; }
  }
});

test('sprites: sensors use idle until measured, then the measured value', () => withSprites(() => {
  const world = jointWorld();
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
  // L3's CX cells are far apart; move the target next to the control so the cable is drawn too.
  const v = structuredClone(levelView(3));
  v.terminals.find((t) => t.target_cell).target_cell = [5, 3];
  const world = createWorld(parseLevel(v));
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(world, l3snap(), view(), 0);
  const [cx, cy] = world.cnot.control;
  const [tx, ty] = world.cnot.target;
  assert.deepEqual(lastAt(calls, cx, cy).args.slice(1, 5), rect(FRAMES.cnot_control));
  assert.deepEqual(lastAt(calls, tx, ty).args.slice(1, 5), rect(FRAMES.cnot_target));
  assert.ok(calls.some((c) => c.name === 'lineTo' && c.args[1] === cy * 32 + 16 && c.args[0] === tx * 32 + 16));
}));

test('sprites: exits use the exit sprite plus a player letter (identity not by color alone)', () => withSprites(() => {
  const world = jointWorld();
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
  const world = jointWorld();
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
  const world = jointWorld();
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
  const world = jointWorld();
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(world, snap('0', '0'), view({ active: 'alice' }), 0);
  const a = world.players.alice;
  assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === 'A' && c.args[1] > a.x * 32 && c.args[1] < a.x * 32 + 32 && c.args[2] > a.y * 32 && c.args[2] < a.y * 32 + 32));
  assert.ok(calls.some((c) => c.name === 'setLineDash' && c.args[0].length === 2), 'active ring dashed');
}));

test('fallback: sheet without character strips still draws procedural players', () => {
  globalThis.SPRITES = { image: SHEET, frames: FRAMES };
  try {
    const world = jointWorld();
    const { ctx, calls } = recCtx();
    createRenderer(canvasWith(ctx)).draw(world, snap('0', '0'), view(), 0);
    assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === 'A'));
    assert.ok(calls.some((c) => c.name === 'arc'));
  } finally { delete globalThis.SPRITES; }
});

test('fallback: without SPRITES nothing calls drawImage and procedural shapes are drawn', () => {
  assert.equal(globalThis.SPRITES, undefined);
  const world = jointWorld();
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(world, snap('super', '1'), view(), 0);
  assert.equal(calls.filter((c) => c.name === 'drawImage').length, 0);
  assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === 'A'));
  assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === '?'));
});

// ---------- lab decorations (separate atlas: SPRITES.decor) ----------
const DECOR = { id: 'decor-atlas' };
const DFRAMES = DECOR_FRAMES; // the real hand-mapped V2 registry (source pixels, drawn at 2x)
const withDecor = (fn, { decor = { image: DECOR, frames: DFRAMES }, sheet = true } = {}) => {
  globalThis.SPRITES = { ...(sheet ? { image: SHEET, frames: FRAMES, characters: { alice: ALICE, bob: BOB } } : {}), ...(decor ? { decor } : {}) };
  try { return fn(); } finally { delete globalThis.SPRITES; }
};
const decorCalls = (calls) => calls.filter((c) => c.name === 'drawImage' && c.args[0] === DECOR);
const drawL1 = (opts) => {
  const { ctx, calls } = recCtx();
  const world = worldOf(1);
  createRenderer(canvasWith(ctx)).draw(world, opts?.snap ?? l1snap(), view(), 0);
  return { ctx, calls, world };
};

test('decor: every level 1 decoration is drawn once from the V2 atlas, source pixels scaled 2x on integers', () => withDecor(() => {
  const { ctx, calls, world } = drawL1();
  assert.equal(ctx.imageSmoothingEnabled, false);
  const drawn = decorCalls(calls);
  assert.equal(drawn.length, world.grid.decorations.length);
  assert.equal(drawn.length, 12);
  for (const c of drawn) {
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = c.args;
    assert.ok([dx, dy, dw, dh].every(Number.isInteger));
    assert.deepEqual([dw, dh], [sw * 2, sh * 2], 'integer 2x, nearest neighbour');
    assert.ok(Object.values(DFRAMES).some((f) => f.x === sx && f.y === sy && f.w === sw && f.h === sh));
  }
  const find = (name, cx, cy) => drawn.find((c) => c.args[1] === DFRAMES[name].x && c.args[2] === DFRAMES[name].y
    && c.args[5] >= cx * 32 && c.args[5] < cx * 32 + 64 && c.args[6] >= cy * 32 && c.args[6] < cy * 32 + 64);
  // bottom-centre aligned in the footprint (hand-computed from the V2 rects)
  assert.deepEqual(find('tank_a', 7, 1).args.slice(5, 9), [7 * 32 + 9, 62, 14, 34]);
  assert.deepEqual(find('tank_b', 12, 1).args.slice(5, 9), [12 * 32 + 10, 62, 12, 34]);
  assert.deepEqual(find('plant', 1, 1).args.slice(5, 9), [32 + 10, 2 * 32 - 16, 12, 16]);
  assert.deepEqual(find('plant', 18, 1).args.slice(5, 9), [18 * 32 + 10, 2 * 32 - 16, 12, 16]);
  assert.deepEqual(find('floor_mat', 4, 6).args.slice(5, 9), [4 * 32 + 8, 6 * 32 + 20, 48, 12]);
  assert.deepEqual(find('floor_mat', 14, 6).args.slice(5, 9), [14 * 32 + 8, 6 * 32 + 20, 48, 12]);
  assert.deepEqual(find('wall_light', 5, 0).args.slice(5, 9), [5 * 32 + 10, 26, 12, 6]);
  assert.deepEqual(find('wall_light', 14, 0).args.slice(5, 9), [14 * 32 + 10, 26, 12, 6]);
  assert.equal(drawn.filter((c) => c.args[1] === DFRAMES.floor_grate.x && c.args[2] === DFRAMES.floor_grate.y).length, 4);
  assert.deepEqual(drawn.filter((c) => c.args[1] === DFRAMES.floor_grate.x).map((c) => c.args.slice(5, 9))[0], [5 * 32 + 6, 7 * 32 + 8, 20, 24]);
}));

test('decor: draw order is floor+walls, floor details, decorations, consoles/sensors/doors/exits, players, HUD', () => withDecor(() => {
  const { calls } = drawL1();
  const idx = (pred) => calls.map((c, i) => (pred(c) ? i : -1)).filter((i) => i >= 0);
  const sheetFrame = (frameNames) => (c) => c.name === 'drawImage' && c.args[0] === SHEET
    && frameNames.some((n) => c.args[1] === FRAMES[n].x && c.args[2] === FRAMES[n].y);
  const lastFloorOrWall = Math.max(...idx(sheetFrame(['floor', 'wall', 'wall_center'])));
  const isDetail = (c) => c.args[0] === DECOR && [DFRAMES.floor_mat, DFRAMES.floor_grate].some((f) => f.x === c.args[1] && f.y === c.args[2]);
  const details = idx((c) => c.name === 'drawImage' && isDetail(c));
  const others = idx((c) => c.name === 'drawImage' && c.args[0] === DECOR && !isDetail(c));
  const objects = idx(sheetFrame(['door_1', 'door_0', 'sensor_idle', 'terminal_h', 'exit']));
  const players = idx((c) => c.name === 'drawImage' && (c.args[0] === ALICE || c.args[0] === BOB));
  assert.equal(details.length, 6);
  assert.equal(others.length, 6);
  assert.ok(lastFloorOrWall < Math.min(...details), 'floor and walls first');
  assert.ok(Math.max(...details) < Math.min(...others), 'floor details before the other decorations');
  assert.ok(Math.max(...others) < Math.min(...objects), 'decorations before consoles/sensors/doors/exits');
  assert.ok(Math.max(...objects) < Math.min(...players), 'players after objects');
}));

test('decor: overlay (HUD) text is drawn after every decoration and player', () => withDecor(() => {
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(jointWorld(), snap('0', '0'), view({ overlay: 'win' }), 0);
  const lastImage = Math.max(...calls.map((c, i) => (c.name === 'drawImage' ? i : -1)));
  const overlayText = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === 'Level complete');
  assert.ok(overlayText > lastImage);
}));

test('decor: decorations are drawn even before the first snapshot (static scenery)', () => withDecor(() => {
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(jointWorld(), null, view(), 0);
  assert.equal(decorCalls(calls).length, 12);
}));

test('decor: nothing is drawn when SPRITES.decor is absent (sprites still draw normally)', () => withDecor(() => {
  const { calls } = drawL1();
  assert.equal(decorCalls(calls).length, 0);
  assert.ok(calls.some((c) => c.name === 'drawImage' && c.args[0] === SHEET));
}, { decor: null }));

test('decor: nothing is drawn without any spritesheet, and a decor-only SPRITES does not crash the base layers', () => {
  delete globalThis.SPRITES;
  assert.equal(drawL1().calls.filter((c) => c.name === 'drawImage').length, 0);
  withDecor(() => {
    const { calls } = drawL1();
    assert.equal(decorCalls(calls).length, 12); // decor atlas alone is enough for scenery; base art is procedural
  }, { sheet: false });
});

test('decor: unknown sprite names and levels without decorations draw nothing extra', () => withDecor(() => {
  const world = jointWorld();
  world.grid.decorations = [{ sprite: 'unobtainium', cell: [3, 3], footprint: [1, 1] }, { sprite: 'floor_grate', cell: [3, 3], footprint: [1, 1] }];
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(world, snap('1', '1'), view(), 0);
  assert.equal(decorCalls(calls).length, 1);
  const l2 = recCtx();
  createRenderer(canvasWith(l2.ctx)).draw(worldOf(2), objSnap({ opp_A: '1', opp_B: '1' }), view(), 0);
  assert.equal(decorCalls(l2.calls).length, 0);
}));

test('decor: no decoration rectangle overlaps a gameplay cell of level 1', () => withDecor(() => {
  const { calls, world } = drawL1();
  const cells = new Set([
    ...world.terminals.map((t) => [t.x, t.y]),
    ...world.doors.map((d) => [d.x, d.y]), ...world.sensors.map((s) => [s.x, s.y]), ...world.exits.map((e) => [e.x, e.y]),
    [world.players.alice.x, world.players.alice.y], [world.players.bob.x, world.players.bob.y],
  ].map(([x, y]) => `${x},${y}`));
  assert.equal(cells.size, 10);
  for (const c of decorCalls(calls)) {
    const [, , , , , dx, dy, dw, dh] = c.args;
    for (let y = Math.floor(dy / 32); y <= Math.floor((dy + dh - 1) / 32); y++) {
      for (let x = Math.floor(dx / 32); x <= Math.floor((dx + dw - 1) / 32); x++) {
        assert.ok(!cells.has(`${x},${y}`), `decoration pixels overlap gameplay cell ${x},${y}`);
      }
    }
  }
}));

test('renderer draws through setTransform(scale) so drawing keeps logical 640x384 coordinates', () => {
  const ctx = stubCtx();
  const canvas = { getContext: () => ctx, width: 640, height: 384 };
  const r = createRenderer(canvas);
  r.draw(jointWorld(), snap('0', '0'), view(), 0);
  assert.deepEqual(ctx.calls.find((c) => c[0] === 'setTransform'), ['setTransform', 1, 0, 0, 1, 0, 0]);
  assert.equal(canvas.width, 640);
  ctx.calls.length = 0;
  r.setScale(3);
  assert.equal(canvas.width, 1920);
  assert.equal(canvas.height, 1152);
  assert.equal(ctx.imageSmoothingEnabled, false); // resizing resets context state: it is switched off again
  r.draw(jointWorld(), snap('0', '0'), view(), 0);
  assert.deepEqual(ctx.calls.find((c) => c[0] === 'setTransform'), ['setTransform', 3, 0, 0, 3, 0, 0]);
  assert.ok(ctx.calls.some((c) => c[0] === 'clearRect' && c[3] === 640 && c[4] === 384)); // still logical units
});

test('renderer.setScale ignores an unchanged scale (resizing a canvas clears it)', () => {
  const ctx = stubCtx();
  let widthWrites = 0;
  let w = 640;
  const canvas = { getContext: () => ctx, height: 384, get width() { return w; }, set width(v) { widthWrites++; w = v; } };
  const r = createRenderer(canvas);
  r.setScale(2); r.setScale(2); r.setScale(0); r.setScale(NaN);
  assert.equal(widthWrites, 1);
  assert.equal(w, 1280);
});
