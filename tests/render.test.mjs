// Smoke tests for js/render.js with a stub 2D context (no browser). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, logicalSize, COLORS, ON_ONE } from '../js/render.js';
import { worldOf, l1snap, objSnap, view as levelView, smallView } from './helpers.mjs';
import { parseLevel } from '../js/grid.js';
import { createWorld } from '../js/entities.js';
import { THEMES } from '../js/sprites.js';

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

// ---------- sprite path (fake SPRITES from the real theme registries, recording context) ----------
// Records every call with the globalAlpha and fillStyle in force at that moment.
function recCtx() {
  const calls = [];
  const state = { globalAlpha: 1, fillStyle: '#000' };
  const stack = [];
  const ctx = new Proxy(state, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'save') return () => stack.push([t.globalAlpha, t.fillStyle]);
      if (k === 'restore') return () => { [t.globalAlpha, t.fillStyle] = stack.pop() ?? [1, '#000']; };
      return (...a) => { calls.push({ name: k, alpha: t.globalAlpha, style: t.fillStyle, args: a }); };
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { ctx, calls };
}

const ALICE = { id: 'alice-strip' };
const BOB = { id: 'bob-strip' };
const IMG = { lab: { tiles: { id: 'lab-tiles' }, props: { id: 'lab-props' } }, prison: { tiles: { id: 'prison-tiles' }, props: { id: 'prison-props' } } };
const fakeTheme = (name) => ({
  tilesImage: IMG[name].tiles, propsImage: IMG[name].props, tiles: THEMES[name].tiles, props: THEMES[name].props, wallTopColor: THEMES[name].wallTopColor,
});
const withSprites = (fn, { themes = ['lab', 'prison'] } = {}) => {
  globalThis.SPRITES = { characters: { alice: ALICE, bob: BOB }, themes: Object.fromEntries(themes.map((n) => [n, fakeTheme(n)])) };
  try { return fn(); } finally { delete globalThis.SPRITES; }
};
/** Source rect of a named tile of a theme's tiles sheet. */
const tile = (name, theme = 'lab') => { const [c, r] = THEMES[theme].tiles[name]; return [c * 32, r * 32, 32, 32]; };
/** drawImage calls landing exactly on the 32 px cell (cx, cy), in draw order, optionally from one image. */
const imagesAt = (calls, cx, cy, image) => calls
  .filter((c) => c.name === 'drawImage' && (!image || c.args[0] === image) && c.args[5] === cx * 32 && c.args[6] === cy * 32);
const lastAt = (calls, cx, cy, image = IMG.lab.tiles) => imagesAt(calls, cx, cy, image).at(-1);
const srcOf = (c) => c.args.slice(1, 5);
const drawn = (world, s, v = view(), t = 0, opts) => {
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx), opts).draw(world, s, v, t);
  return calls;
};

test('sprites: every cell gets a floor tile first, tiles are 32x32 on integers, smoothing stays off', () => withSprites(() => {
  const { ctx, calls } = recCtx();
  const world = jointWorld();
  createRenderer(canvasWith(ctx)).draw(world, snap('0', '0'), view(), 0);
  assert.equal(ctx.imageSmoothingEnabled, false);
  const tiles = calls.filter((c) => c.name === 'drawImage' && c.args[0] === IMG.lab.tiles);
  assert.ok(tiles.length > 0);
  for (const c of tiles) {
    assert.deepEqual([c.args[3], c.args[4], c.args[7], c.args[8]], [32, 32, 32, 32]);
    assert.ok(Number.isInteger(c.args[5]) && Number.isInteger(c.args[6]));
  }
  const floors = new Set(Object.keys(THEMES.lab.tiles).filter((n) => n.startsWith('floor_')).map((n) => tile(n).join()));
  for (let y = 1; y < 8; y++) assert.ok(floors.has(srcOf(imagesAt(calls, 3, y)[0]).join()), `cell 3,${y} starts with a floor tile`);
}));

test('sprites: wall faces come from the sheet, wall tops are a flat fill of the theme cap colour, the divider uses its own tiles', () => withSprites(() => {
  const world = worldOf(1); // top row has floor below, outer columns have wall below
  world.grid.decorations = []; // bare walls: the tile at a cell is the wall itself, not a wall-mounted prop
  const { ctx, calls } = recCtx();
  createRenderer(canvasWith(ctx)).draw(world, l1snap(), view(), 0);
  const faceNames = ['wall_face_a', 'wall_face_b', 'wall_face_c', 'wall_face_pipe', 'wall_face_sign', 'wall_face_window'];
  const faces = new Set(faceNames.map((n) => tile(n).join()));
  assert.ok(faces.has(srcOf(lastAt(calls, 3, 0)).join()), 'top wall row shows a wall face');
  const flat = calls.filter((c) => c.name === 'fillRect' && c.args[0] === 0 && c.args[1] === 32 && c.args[2] === 32);
  assert.equal(flat.at(-1).style, THEMES.lab.wallTopColor, 'left outer wall, wall below: flat cap colour');
  assert.equal(imagesAt(calls, 0, 1, IMG.lab.tiles).length, 1, 'only the floor was drawn under the flat wall top');
  const divider = [tile('divider').join(), tile('divider_face').join()];
  for (const x of world.grid.divider) assert.ok(divider.includes(srcOf(lastAt(calls, x, 4)).join()), `divider column ${x}`);
}));

test('sprites: a level of the prison theme draws from the prison sheets and cap colour', () => withSprites(() => {
  const v = smallView({ theme: 'prison' });
  const world = createWorld(parseLevel(v));
  const calls = drawn(world, { objects: {}, measured: [null, null] });
  assert.ok(calls.some((c) => c.name === 'drawImage' && c.args[0] === IMG.prison.tiles));
  assert.ok(!calls.some((c) => c.name === 'drawImage' && c.args[0] === IMG.lab.tiles));
  assert.ok(calls.some((c) => c.name === 'fillRect' && c.style === THEMES.prison.wallTopColor));
}));

test('sprites: legacy qubit doors use door_0 (open, dimmed), door_1 (closed) and a flickering super door, each with a text badge', () => withSprites(() => {
  const world = jointWorld();
  const [d] = world.doors;
  const run = (state, t = 0, opts) => lastAt(drawn(world, snap(state, '1'), view(), t, opts), d.x, d.y);
  const open = run('0');  // open_on 0 -> passable
  assert.deepEqual(srcOf(open), tile('door_0'));
  assert.equal(open.alpha, 0.35);
  const closed = run('1');
  assert.deepEqual(srcOf(closed), tile('door_1'));
  assert.equal(closed.alpha, 1);
  assert.deepEqual(srcOf(run('super', 0)), tile('door_super_a'));
  assert.deepEqual(srcOf(run('super', 250)), tile('door_super_b'));
  assert.deepEqual(srcOf(run('super', 250, { reduceMotion: true })), tile('door_super_a'), 'reduced motion: static');
  const badge = (state) => drawn(world, snap(state, '1'), view(), 0)
    .find((c) => c.name === 'fillText' && c.args[0] === (state === 'super' ? '?' : state) && c.args[1] > d.x * 32 && c.args[1] < d.x * 32 + 32);
  for (const st of ['0', '1', 'super']) assert.equal(badge(st)?.alpha, 1, `badge for ${st} at full alpha`);
}));

test('sprites: validated_exit doors follow door_states: padlocked hatch while closed (even if objects say super), doorway once open', () => withSprites(() => {
  const world = worldOf(1);
  const [a, b] = world.doors;
  const run = (name) => {
    const calls = drawn(world, l1snap(name));
    const digits = calls.filter((c) => c.name === 'fillText' && /^[01?]$/.test(c.args[0])).length;
    const inDoor = (c) => c.args[0] > a.x * 32 && c.args[0] < a.x * 32 + 32 && c.args[1] > a.y * 32 && c.args[1] < a.y * 32 + 32;
    return { a: lastAt(calls, a.x, a.y), b: lastAt(calls, b.x, b.y), digits, arcs: calls.filter((c) => c.name === 'arc' && inDoor(c)).length };
  };
  for (const name of ['initial', 'validated']) {
    const r = run(name);
    assert.deepEqual(srcOf(r.a), tile('door_locked'), name);
    assert.deepEqual(srcOf(r.b), tile('door_locked'), name);
    assert.equal(r.a.alpha, 1);
  }
  assert.equal(l1snap('validated').objects.door_A, 'super');
  for (const name of ['complete_0', 'complete_1']) {
    const r = run(name);
    assert.deepEqual(srcOf(r.a), tile('door_open'), name);
    assert.equal(r.a.alpha, 1, 'the open doorway art is already transparent: no ghosting');
    assert.equal(r.digits, 0, 'engine doors carry their state in the art, no digit badges');
  }
  assert.equal(run('validated').arcs, 0, 'no procedural padlock over the lock sprite');
}));

test('sprites: lethal door keeps its dashed hazard border; a closed lethal door is the hazard door', () => withSprites(() => {
  const dashes = (world, s) => drawn(world, s, view({ mode: '2p' })).filter((c) => c.name === 'setLineDash' && c.args[0].length === 2).length;
  assert.equal(dashes(jointWorld(), l1snap()), 0);
  const l3 = worldOf(3);
  assert.equal(dashes(l3, l3snap()), 2); // bridge_A and laser_B
  const bridge = l3.doors.find((d) => d.name === 'bridge_A');
  const calls = drawn(l3, l3snap('1', '0'));
  assert.deepEqual(srcOf(lastAt(drawn(l3, l3snap('0', '0')), bridge.x, bridge.y)), tile('door_lethal'), 'bridge_A opens on 1: at 0 it is closed and deadly');
  assert.deepEqual(srcOf(lastAt(calls, bridge.x, bridge.y)), tile('door_1'), 'open (value 1): normal state art, ghosted');
}));

test('sprites: sensors are locked until measurement is enabled, idle, then show the measured value; labels stay', () => withSprites(() => {
  const world = worldOf(1);
  const [s0, s1] = world.sensors;
  const at = (calls, s) => srcOf(lastAt(calls, s.x, s.y));
  const locked = drawn(world, l1snap('built'));
  assert.deepEqual(at(locked, s0), tile('sensor_disabled'));
  assert.deepEqual(at(locked, s1), tile('sensor_disabled'));
  const idle = drawn(world, l1snap('validated'));
  assert.deepEqual(at(idle, s0), tile('sensor_idle'));
  assert.ok(idle.some((c) => c.name === 'fillText' && c.args[0] === 'Q0' && c.alpha === 1));
  const done = drawn(world, l1snap('validated', { measured: [1, 0] }));
  assert.deepEqual(at(done, s0), tile('sensor_1'));
  assert.deepEqual(at(done, s1), tile('sensor_0'));
  assert.ok(done.some((c) => c.name === 'fillText' && c.args[0] === 'Q1' && c.alpha === 1));
  const lines = (calls) => calls.filter((c) => c.name === 'lineTo').length;
  assert.ok(lines(done) > lines(idle), 'check mark once measured');
}));

test('sprites: terminals pick the gate console; Bob\'s CX is the owner console; used ones are term_off with a check mark', () => withSprites(() => {
  const l1 = worldOf(1);
  const [h, cx] = l1.terminals; // alice_h, bob_cx
  const fresh = drawn(l1, l1snap());
  assert.deepEqual(srcOf(lastAt(fresh, h.x, h.y)), tile('term_h'));
  assert.deepEqual(srcOf(lastAt(fresh, cx.x, cx.y)), tile('term_cx_owner'));
  const l3 = worldOf(3);
  const x = l3.terminals.find((t) => t.gate === 'x');
  assert.deepEqual(srcOf(lastAt(drawn(l3, l3snap()), x.x, x.y)), tile('term_x'));
  h.usesLeft = 0;
  const used = drawn(l1, l1snap());
  assert.deepEqual(srcOf(lastAt(used, h.x, h.y)), tile('term_off'));
  assert.equal(lastAt(used, h.x, h.y).alpha, 1);
  const checks = (calls) => calls.filter((c) => c.name === 'lineTo' && c.alpha === 1).length;
  assert.ok(checks(used) > checks(fresh));
}));

test('sprites: cnot cells use control/target consoles and keep the cable when adjacent, CX labels when far', () => withSprites(() => {
  const v = structuredClone(levelView(3));
  v.terminals.find((t) => t.target_cell).target_cell = [5, 5];
  const near = createWorld(parseLevel(v));
  const calls = drawn(near, l3snap());
  const [cx, cy] = near.cnot.control;
  const [tx, ty] = near.cnot.target;
  assert.deepEqual(srcOf(lastAt(calls, cx, cy)), tile('term_cx_control'));
  assert.deepEqual(srcOf(lastAt(calls, tx, ty)), tile('term_cx_target'));
  assert.ok(calls.some((c) => c.name === 'lineTo' && c.args[1] === cy * 32 + 16 && c.args[0] === tx * 32 + 16));
  const far = drawn(worldOf(3), l3snap());
  assert.equal(far.filter((c) => c.name === 'fillText' && c.args[0] === 'CX').length, 2);
  near.cnot.usesLeft = 0;
  assert.deepEqual(srcOf(lastAt(drawn(near, l3snap()), cx, cy)), tile('term_off'));
}));

test('sprites: exits are a closed hatch, then the glowing doorway (a/b at 2 fps, a under reduced motion), plus the player letter', () => withSprites(() => {
  const world = worldOf(1);
  const [ea, eb] = world.exits;
  const at = (s, t, opts) => srcOf(lastAt(drawn(world, s, view(), t, opts), ea.x, ea.y));
  assert.deepEqual(at(l1snap('validated'), 0), tile('exit_closed'));
  assert.deepEqual(at(l1snap('complete_0'), 0), tile('exit_open_a'));
  assert.deepEqual(at(l1snap('complete_0'), 500), tile('exit_open_b'));
  assert.deepEqual(at(l1snap('complete_0'), 500, { reduceMotion: true }), tile('exit_open_a'));
  const calls = drawn(world, l1snap());
  for (const e of [ea, eb]) {
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
  const calls = drawn(world, snap('0', '0'), view({ active: 'alice' }));
  const a = world.players.alice;
  assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === 'A' && c.args[1] > a.x * 32 && c.args[1] < a.x * 32 + 32 && c.args[2] > a.y * 32 && c.args[2] < a.y * 32 + 32));
  assert.ok(calls.some((c) => c.name === 'setLineDash' && c.args[0].length === 2), 'active ring dashed');
}));

test('fallback: characters without theme art still draw procedural tiles; a missing theme falls back per level', () => {
  globalThis.SPRITES = { characters: { alice: ALICE, bob: BOB }, themes: {} };
  try {
    const world = jointWorld();
    const calls = drawn(world, snap('0', '0'));
    assert.ok(calls.some((c) => c.name === 'fillText' && c.args[1] !== undefined && c.args[0] === 'H'), 'procedural terminal letter');
    assert.ok(calls.every((c) => c.name !== 'drawImage' || c.args[0] === ALICE || c.args[0] === BOB), 'only character strips are drawn');
  } finally { delete globalThis.SPRITES; }
  withSprites(() => {
    const prison = createWorld(parseLevel(smallView({ theme: 'prison' })));
    const calls = drawn(prison, { objects: {}, measured: [null, null] });
    assert.ok(!calls.some((c) => c.name === 'drawImage' && c.args[0] === IMG.prison.tiles));
  }, { themes: ['lab'] }); // prison sheets missing: procedural, no crash
});

test('fallback: sheet without character strips still draws procedural players', () => {
  globalThis.SPRITES = { themes: { lab: fakeTheme('lab') } };
  try {
    const calls = drawn(jointWorld(), snap('0', '0'));
    assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === 'A'));
    assert.ok(calls.some((c) => c.name === 'arc'));
  } finally { delete globalThis.SPRITES; }
});

test('fallback: without SPRITES nothing calls drawImage and procedural shapes are drawn', () => {
  assert.equal(globalThis.SPRITES, undefined);
  const calls = drawn(jointWorld(), snap('super', '1'));
  assert.equal(calls.filter((c) => c.name === 'drawImage').length, 0);
  assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === 'A'));
  assert.ok(calls.some((c) => c.name === 'fillText' && c.args[0] === '?'));
});

test('level 1 and level 3 render with engine-shaped snapshots (joint locks, cx, sprites on and off)', () => {
  for (const sprites of [false, true]) {
    const run = () => {
      const r = createRenderer(canvasWith(recCtx().ctx));
      r.draw(worldOf(1), l1snap(), view(), 0);
      r.draw(worldOf(1), l1snap('complete_1'), view(), 0);
      r.draw(jointWorld(), snap('0', '0'), view(), 0);
      r.draw(worldOf(1), l1snap('complete_0'), view(), 0);
      r.draw(worldOf(3), l3snap('super', '1'), view(), 0);
      r.draw(worldOf(3), null, view(), 0);
    };
    if (sprites) withSprites(run); else run();
  }
});

// ---------- decorations (theme props) ----------
// A 20x12 map (the engine maximum): two-column divider.
const wideWorld = () => createWorld(parseLevel({
  id: 'wide',
  map: ['#'.repeat(20), '#A' + '.'.repeat(7) + '##' + '.'.repeat(7) + 'B#', ...Array.from({ length: 9 }, () => '#' + '.'.repeat(8) + '##' + '.'.repeat(8) + '#'), '#'.repeat(20)],
  legend: { '#': 'wall', '.': 'floor', A: 'alice_start', B: 'bob_start' },
}));
const decoWorld = (decorations, theme = 'lab') => createWorld(parseLevel(smallView({ theme, decorations })));
const S0 = { objects: {}, measured: [null, null] };

test('props: a prop is drawn 1:1 from its sheet at the bottom-centre of its footprint', () => withSprites(() => {
  const world = decoWorld([{ sprite: 'dilution_fridge_a', cell: [2, 2], footprint: [2, 2] }, { sprite: 'optical_table', cell: [9, 4], footprint: [3, 2] }]);
  const calls = drawn(world, S0);
  const fridge = THEMES.lab.props.dilution_fridge_a;
  const c = calls.find((x) => x.name === 'drawImage' && x.args[0] === IMG.lab.props && x.args[1] === fridge.x && x.args[2] === fridge.y);
  assert.deepEqual(c.args.slice(3, 9), [fridge.w, fridge.h, 2 * 32 + Math.floor((64 - fridge.w) / 2), 2 * 32 + 64 - fridge.h, fridge.w, fridge.h]);
  const table = THEMES.lab.props.optical_table;
  const t = calls.find((x) => x.name === 'drawImage' && x.args[1] === table.x && x.args[2] === table.y);
  assert.equal(t.args[7], table.w, 'drawn 1:1, no scaling');
  assert.ok(Number.isInteger(t.args[5]) && Number.isInteger(t.args[6]));
}));

test('props: small 1x1 props come from the tiles sheet (registry sheet: "tiles")', () => withSprites(() => {
  const p = THEMES.lab.props.plant;
  assert.equal(p.sheet, 'tiles');
  const calls = drawn(decoWorld([{ sprite: 'plant', cell: [3, 3], footprint: [1, 1] }]), S0);
  const c = calls.find((x) => x.name === 'drawImage' && x.args[0] === IMG.lab.tiles && x.args[1] === p.x && x.args[2] === p.y && x.args[3] === 32);
  assert.ok(c, 'plant cut from the tiles sheet');
}));

test('props: draw order is floor+walls, floor decals, furniture back to front, consoles/doors/sensors/exits, players', () => withSprites(() => {
  const world = decoWorld([
    { sprite: 'locker', cell: [2, 5], footprint: [1, 2] },           // lower: drawn after the one above it
    { sprite: 'server_rack_a', cell: [4, 2], footprint: [1, 2] },
    { sprite: 'floor_grate', cell: [5, 5], footprint: [2, 1] },        // listed late but a floor decal: drawn first
  ]);
  const calls = drawn(world, S0);
  const imgs = calls.filter((c) => c.name === 'drawImage');
  const idxOf = (name) => imgs.findIndex((c) => c.args[0] === IMG.lab.props && c.args[1] === THEMES.lab.props[name].x && c.args[2] === THEMES.lab.props[name].y);
  const lastFloor = imgs.findIndex((c) => c.args[0] === IMG.lab.tiles && c.args[5] === 13 * 32 && c.args[6] === 6 * 32); // last room cell
  assert.ok(idxOf('floor_grate') >= 0 && idxOf('server_rack_a') >= 0 && idxOf('locker') >= 0);
  assert.ok(lastFloor >= 0 && lastFloor < idxOf('floor_grate'), 'floor first');
  assert.ok(idxOf('floor_grate') < idxOf('server_rack_a'), 'decal before furniture');
  assert.ok(idxOf('server_rack_a') < idxOf('locker'), 'back to front');
  const firstPlayer = imgs.findIndex((c) => c.args[0] === ALICE || c.args[0] === BOB);
  assert.ok(idxOf('locker') < firstPlayer, 'players after props');
}));

test('props: animated pairs alternate at 2 fps and stay on frame a under reduced motion', () => withSprites(() => {
  const world = decoWorld([{ sprite: 'dilution_fridge_a', cell: [2, 2], footprint: [2, 2] }]);
  const frame = (t, opts) => {
    const c = drawn(world, S0, view(), t, opts).find((x) => x.name === 'drawImage' && x.args[0] === IMG.lab.props && x.args[3] !== 32);
    return Object.entries(THEMES.lab.props).find(([, p]) => p.sheet === 'props' && p.x === c.args[1] && p.y === c.args[2])[0];
  };
  assert.equal(frame(0), 'dilution_fridge_a');
  assert.equal(frame(500), 'dilution_fridge_b');
  assert.equal(frame(1000), 'dilution_fridge_a');
  assert.equal(frame(500, { reduceMotion: true }), 'dilution_fridge_a');
}));

test('props: unknown sprite names and an absent theme draw nothing extra and never throw', () => {
  const world = decoWorld([{ sprite: 'unobtainium', cell: [3, 3], footprint: [1, 1] }, { sprite: 'floor_grate', cell: [3, 3], footprint: [2, 1] }]);
  withSprites(() => {
    const calls = drawn(world, S0);
    const g = THEMES.lab.props.floor_grate;
    assert.equal(calls.filter((c) => c.name === 'drawImage' && c.args[0] === IMG.lab.props && c.args[1] === g.x && c.args[2] === g.y).length, 1);
  });
  assert.equal(drawn(world, S0).filter((c) => c.name === 'drawImage').length, 0);
});

test('props: scenery is drawn before the first snapshot; a wall_* prop may sit on the top wall row', () => withSprites(() => {
  const world = decoWorld([{ sprite: 'wall_clock', cell: [3, 0], footprint: [1, 1] }]);
  const calls = drawn(world, null);
  const clock = THEMES.lab.props.wall_clock;
  assert.ok(calls.some((c) => c.name === 'drawImage' && c.args[1] === clock.x && c.args[2] === clock.y));
}));

test('props: the overlay text is drawn after every prop and player', () => withSprites(() => {
  const world = decoWorld([{ sprite: 'plant', cell: [3, 3], footprint: [1, 1] }]);
  const calls = drawn(world, S0, view({ overlay: 'win' }));
  const lastImage = Math.max(...calls.map((c, i) => (c.name === 'drawImage' ? i : -1)));
  assert.ok(calls.findIndex((c) => c.name === 'fillText' && c.args[0] === 'Level complete') > lastImage);
}));

test('variable map size: a 15x9 level is 480x288 logical px, the canvas follows the grid and the overlay is centred on it', () => {
  const world = createWorld(parseLevel(smallView()));
  assert.deepEqual(logicalSize(world.grid), { w: 480, h: 288 });
  const ctx = stubCtx();
  const canvas = { getContext: () => ctx, width: 640, height: 384 };
  const r = createRenderer(canvas);
  r.setScale(2);
  r.draw(world, S0, view({ overlay: 'win' }), 0);
  assert.deepEqual([canvas.width, canvas.height], [960, 576]);
  assert.ok(ctx.calls.some((c) => c[0] === 'clearRect' && c[3] === 480 && c[4] === 288));
  assert.ok(ctx.calls.some((c) => c[0] === 'fillText' && c[1] === 'Level complete' && c[2] === 240 && c[3] === 144 - 14));
  r.draw(wideWorld(), S0, view(), 0); // a 20x12 map again
  assert.deepEqual([canvas.width, canvas.height], [1280, 768]);
});

test('variable map size: the divider (single column on odd widths) is drawn on every row, procedural too', () => {
  const world = createWorld(parseLevel(smallView()));
  const calls = drawn(world, S0);
  const rects = calls.filter((c) => c.name === 'strokeRect' && c.args[0] === 7 * 32 + 1);
  assert.equal(rects.length, 9);
});


test('renderer draws through setTransform(scale) so drawing keeps logical coordinates (cells x 32)', () => {
  const ctx = stubCtx();
  const canvas = { getContext: () => ctx, width: 640, height: 384 };
  const r = createRenderer(canvas);
  r.draw(wideWorld(), S0, view(), 0);
  assert.deepEqual(ctx.calls.find((c) => c[0] === 'setTransform'), ['setTransform', 1, 0, 0, 1, 0, 0]);
  assert.deepEqual([canvas.width, canvas.height], [640, 384]);
  ctx.calls.length = 0;
  r.setScale(3);
  assert.equal(canvas.width, 1920);
  assert.equal(canvas.height, 1152);
  assert.equal(ctx.imageSmoothingEnabled, false); // resizing resets context state: it is switched off again
  r.draw(wideWorld(), S0, view(), 0);
  assert.deepEqual(ctx.calls.find((c) => c[0] === 'setTransform'), ['setTransform', 3, 0, 0, 3, 0, 0]);
  assert.ok(ctx.calls.some((c) => c[0] === 'clearRect' && c[3] === 640 && c[4] === 384)); // still logical units
  ctx.calls.length = 0;
  r.draw(jointWorld(), snap('0', '0'), view(), 0); // level 1 is 15x9: 480x288 logical, x3 backing
  assert.deepEqual([canvas.width, canvas.height], [1440, 864]);
  assert.ok(ctx.calls.some((c) => c[0] === 'clearRect' && c[3] === 480 && c[4] === 288));
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
