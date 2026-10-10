// Tests for js/state.js. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, createStateMachine } from '../js/state.js';

test('STATES lists all five states', () => {
  assert.deepEqual([...Object.values(STATES)].sort(), ['dead', 'level', 'loading', 'menu', 'win']);
});

test('starts in loading by default, or in the given initial state', () => {
  assert.equal(createStateMachine().state, 'loading');
  assert.equal(createStateMachine({ initial: 'menu' }).state, 'menu');
});

test('legal transitions walk the full cycle', () => {
  const sm = createStateMachine();
  for (const next of ['menu', 'level', 'dead', 'level', 'win', 'level', 'menu']) {
    sm.setState(next);
    assert.equal(sm.state, next);
  }
});

test('transition table is exactly the spec', () => {
  const table = {
    loading: ['menu'],
    menu: ['level'],
    level: ['dead', 'win', 'menu'],
    dead: ['level', 'menu'],
    win: ['menu', 'level'],
  };
  for (const from of Object.keys(table)) {
    for (const to of Object.keys(table)) {
      const sm = createStateMachine({ initial: from });
      assert.equal(sm.can(to), table[from].includes(to), `${from} -> ${to}`);
    }
  }
});

test('illegal transition throws naming both states and keeps state', () => {
  const sm = createStateMachine();
  assert.throws(() => sm.setState('level'), (e) => {
    assert.ok(e instanceof Error);
    assert.match(e.message, /loading/);
    assert.match(e.message, /level/);
    return true;
  });
  assert.equal(sm.state, 'loading');
});

test('unknown target state throws', () => {
  const sm = createStateMachine();
  assert.throws(() => sm.setState('bogus'), /bogus/);
});

test('onEnter gets (next, prev, payload) after the state changed', () => {
  const calls = [];
  let sm;
  sm = createStateMachine({
    onEnter: (next, prev, payload) => calls.push([next, prev, payload, sm.state]),
  });
  sm.setState('menu', { a: 1 });
  sm.setState('level');
  assert.deepEqual(calls, [
    ['menu', 'loading', { a: 1 }, 'menu'],
    ['level', 'menu', undefined, 'level'],
  ]);
});

test('onEnter is not called for illegal transitions', () => {
  let n = 0;
  const sm = createStateMachine({ onEnter: () => n++ });
  assert.throws(() => sm.setState('win'));
  assert.equal(n, 0);
});
