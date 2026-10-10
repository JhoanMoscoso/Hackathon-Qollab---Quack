// Tests for js/input.js. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyToIntent, createInput } from '../js/input.js';

// ---------- keyToIntent ----------
test('1P: WASD move the active player', () => {
  assert.deepEqual(keyToIntent('KeyW', '1p', 'alice'), { player: 'alice', type: 'move', dx: 0, dy: -1 });
  assert.deepEqual(keyToIntent('KeyS', '1p', 'bob'), { player: 'bob', type: 'move', dx: 0, dy: 1 });
  assert.deepEqual(keyToIntent('KeyA', '1p', 'alice'), { player: 'alice', type: 'move', dx: -1, dy: 0 });
  assert.deepEqual(keyToIntent('KeyD', '1p', 'bob'), { player: 'bob', type: 'move', dx: 1, dy: 0 });
});

test('1P: arrows also move the active player; E and Enter interact; Tab switches', () => {
  assert.deepEqual(keyToIntent('ArrowUp', '1p', 'bob'), { player: 'bob', type: 'move', dx: 0, dy: -1 });
  assert.deepEqual(keyToIntent('ArrowRight', '1p', 'alice'), { player: 'alice', type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(keyToIntent('KeyE', '1p', 'bob'), { player: 'bob', type: 'interact' });
  assert.deepEqual(keyToIntent('Enter', '1p', 'alice'), { player: 'alice', type: 'interact' });
  assert.deepEqual(keyToIntent('Tab', '1p', 'alice'), { type: 'switch' });
});

test('2P: WASD/E are Alice, arrows/Enter are Bob, Tab is null', () => {
  assert.deepEqual(keyToIntent('KeyW', '2p', 'bob'), { player: 'alice', type: 'move', dx: 0, dy: -1 });
  assert.deepEqual(keyToIntent('KeyE', '2p', 'bob'), { player: 'alice', type: 'interact' });
  assert.deepEqual(keyToIntent('ArrowDown', '2p', 'alice'), { player: 'bob', type: 'move', dx: 0, dy: 1 });
  assert.deepEqual(keyToIntent('ArrowLeft', '2p', 'alice'), { player: 'bob', type: 'move', dx: -1, dy: 0 });
  assert.deepEqual(keyToIntent('Enter', '2p', 'alice'), { player: 'bob', type: 'interact' });
  assert.equal(keyToIntent('Tab', '2p', 'alice'), null);
});

test('Space is the run intent in 1P and 2P, independent of the active player', () => {
  for (const mode of ['1p', '2p']) {
    for (const active of ['alice', 'bob']) assert.deepEqual(keyToIntent('Space', mode, active), { type: 'run' }, `${mode}/${active}`);
  }
});

test('unknown key -> null', () => {
  assert.equal(keyToIntent('KeyQ', '1p', 'alice'), null);
  assert.equal(keyToIntent('KeyQ', '2p', 'alice'), null);
});

// ---------- createInput ----------
function fakeTarget() {
  const l = {};
  return {
    l,
    addEventListener(t, f) { (l[t] ??= new Set()).add(f); },
    removeEventListener(t, f) { l[t]?.delete(f); },
    fire(t, e) { for (const f of [...(l[t] ?? [])]) f(e); },
  };
}
function key(code, extra = {}) {
  const e = { code, repeat: false, prevented: false, preventDefault() { e.prevented = true; }, ...extra };
  return e;
}
function setup(opts = {}) {
  const target = fakeTarget();
  const clock = { t: 0 };
  const input = createInput(target, { now: () => clock.t, ...opts });
  return { target, clock, input };
}

test('first press emits immediately; poll drains the queue', () => {
  const { target, input } = setup();
  target.fire('keydown', key('KeyD'));
  assert.deepEqual(input.poll(), [{ player: 'alice', type: 'move', dx: 1, dy: 0 }]);
  assert.deepEqual(input.poll(), []);
});

test('held movement key repeats every repeatMs; event.repeat is ignored', () => {
  const { target, clock, input } = setup({ repeatMs: 150 });
  target.fire('keydown', key('KeyD'));
  assert.equal(input.poll().length, 1);
  target.fire('keydown', key('KeyD', { repeat: true })); // OS auto-repeat: ignored
  assert.equal(input.poll().length, 0);
  clock.t = 100;
  assert.equal(input.poll().length, 0);
  clock.t = 150;
  assert.equal(input.poll().length, 1);
  clock.t = 200;
  assert.equal(input.poll().length, 0);
  clock.t = 300;
  assert.equal(input.poll().length, 1);
});

test('keyup stops repeat', () => {
  const { target, clock, input } = setup();
  target.fire('keydown', key('KeyD'));
  input.poll();
  target.fire('keyup', key('KeyD'));
  clock.t = 1000;
  assert.deepEqual(input.poll(), []);
});

test('blur clears held keys', () => {
  const { target, clock, input } = setup();
  target.fire('keydown', key('KeyD'));
  input.poll();
  target.fire('blur', {});
  clock.t = 1000;
  assert.deepEqual(input.poll(), []);
});

test('interact is not repeated while held', () => {
  const { target, clock, input } = setup();
  target.fire('keydown', key('KeyE'));
  assert.deepEqual(input.poll(), [{ player: 'alice', type: 'interact' }]);
  clock.t = 1000;
  assert.deepEqual(input.poll(), []);
});

test('run fires once per press: held Space and OS auto-repeat do not repeat it', () => {
  for (const mode of ['1p', '2p']) {
    const { target, clock, input } = setup({ mode });
    const space = key('Space');
    target.fire('keydown', space);
    assert.equal(space.prevented, true); // page must not scroll
    assert.deepEqual(input.poll(), [{ type: 'run' }]);
    target.fire('keydown', key('Space', { repeat: true }));
    clock.t = 1000;
    assert.deepEqual(input.poll(), []);
    target.fire('keyup', key('Space'));
    target.fire('keydown', key('Space'));
    assert.deepEqual(input.poll(), [{ type: 'run' }]); // a new press fires again
  }
});

test('Tab toggles active, still emits switch, and affects 1P moves', () => {
  const { target, input } = setup();
  assert.equal(input.active, 'alice');
  target.fire('keydown', key('Tab'));
  assert.equal(input.active, 'bob');
  assert.deepEqual(input.poll(), [{ type: 'switch' }]);
  target.fire('keydown', key('KeyW'));
  assert.deepEqual(input.poll(), [{ player: 'bob', type: 'move', dx: 0, dy: -1 }]);
  target.fire('keydown', key('Tab'));
  assert.equal(input.active, 'alice');
});

test('2P: two players can hold keys at once; Tab does nothing', () => {
  const { target, clock, input } = setup({ mode: '2p' });
  target.fire('keydown', key('KeyD'));
  target.fire('keydown', key('ArrowLeft'));
  const first = input.poll();
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((i) => i.player).sort(), ['alice', 'bob']);
  target.fire('keydown', key('Tab'));
  assert.deepEqual(input.poll(), []);
  assert.equal(input.active, 'alice');
  clock.t = 150;
  assert.equal(input.poll().length, 2);
});

test('setMode switches mapping and clears held keys', () => {
  const { target, clock, input } = setup();
  assert.equal(input.mode, '1p');
  target.fire('keydown', key('KeyD'));
  input.poll();
  input.setMode('2p');
  assert.equal(input.mode, '2p');
  clock.t = 1000;
  assert.deepEqual(input.poll(), []);
});

test('preventDefault for Tab and arrows, not for unhandled keys', () => {
  const { target } = setup();
  for (const code of ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    const e = key(code);
    target.fire('keydown', e);
    assert.equal(e.prevented, true, code);
  }
  const q = key('KeyQ');
  target.fire('keydown', q);
  assert.equal(q.prevented, false);
});

test('native controls and Shift+Tab from the canvas keep browser keyboard behavior', () => {
  const { target, input } = setup();
  for (const tagName of ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']) {
    const event = key('Space', { target: { tagName } });
    target.fire('keydown', event);
    assert.equal(event.prevented, false, tagName);
  }
  const backTab = key('Tab', { shiftKey: true, target: { tagName: 'CANVAS' } });
  target.fire('keydown', backTab);
  assert.equal(backTab.prevented, false);
  assert.equal(input.active, 'alice');
  assert.deepEqual(input.poll(), []);
});

test('dispose removes listeners', () => {
  const { target, input } = setup();
  input.dispose();
  assert.ok(Object.values(target.l).every((s) => s.size === 0));
  target.fire('keydown', key('KeyD'));
  assert.deepEqual(input.poll(), []);
});
