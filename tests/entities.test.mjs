// Tests for js/entities.js against the real v2 levels. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../js/grid.js';
import {
  Player, Door, Sensor, GateTerminal, CnotTerminal, Exit,
  createWorld, resetWorld, stepPlayer, interact, consumeTerminal, syncTerminalUses,
  stageComplete, objectiveFailed, hazardCheck,
} from '../js/entities.js';
import * as entities from '../js/entities.js';
import { view, worldOf, place, pos, l1snap, objSnap } from './helpers.mjs';

const w1 = () => worldOf(1);

test('classes expose their fields', () => {
  const p = new Player('bob', 1, 3, 4);
  assert.deepEqual([p.id, p.qubit, p.x, p.y], ['bob', 1, 3, 4]);
  const d = new Door('door_A', 1, 8, 0, 0, false);
  assert.equal(d.blocking, true);
  assert.equal(d.isOpen({ objects: { door_A: '0' } }), true);
  assert.equal(d.isOpen({ objects: { door_A: '1' } }), false);
  assert.equal(d.isOpen({ objects: { door_A: 'super' } }), false);
  assert.equal(d.state({ objects: { door_A: 'super' } }), 'super');
  const d1 = new Door('x', 0, 0, 0, 1, true, false);
  assert.equal(d1.isOpen({ objects: { x: '1' } }), true);
  assert.equal(d1.blocking, false);
  assert.ok(new Sensor(0, 1, 2) && new Exit('alice', 1, 9) && new CnotTerminal([9, 4], [10, 4], 'shared_cx', 1));
  const t = new GateTerminal(2, 5, 'h', 'alice', 1, 'alice_h');
  assert.deepEqual([t.usesLeft, t.id], [1, 'alice_h']);
  assert.equal(new GateTerminal(2, 5, 'x', 'bob', null, 'b').usesLeft, Infinity); // null = unlimited
});

test('createWorld builds level1 entities from the parsed grid', () => {
  const w = w1();
  assert.deepEqual(pos(w, 'alice'), [1, 1]);
  assert.deepEqual(pos(w, 'bob'), [16, 1]);
  assert.equal(w.players.alice.qubit, 0);
  assert.equal(w.players.bob.qubit, 1);
  assert.equal(w.doors.length, 2);
  assert.equal(w.sensors.length, 2);
  assert.equal(w.terminals.length, 1); // the CX is not a plain terminal
  assert.deepEqual(w.cnot.control, [9, 4]);
  assert.deepEqual(w.cnot.target, [10, 4]);
  assert.equal(w.cnot.terminalId, 'shared_cx');
  assert.equal(w.exits.length, 2);
  const door = w.doors.find((d) => d.name === 'door_B');
  assert.deepEqual([door.x, door.y, door.qubit, door.openOn, door.lethal, door.blocking], [15, 6, undefined, 0, false, true]);
});

test('walls and bounds block', () => {
  const w = w1();
  place(w, 'alice', 1, 1);
  assert.deepEqual(stepPlayer(w, 'alice', -1, 0, l1snap()), [{ type: 'blocked', reason: 'wall' }]);
  assert.deepEqual(stepPlayer(w, 'alice', 0, -1, l1snap()), [{ type: 'blocked', reason: 'wall' }]);
  assert.deepEqual(pos(w, 'alice'), [1, 1]);
  place(w, 'alice', 9, 3);
  assert.equal(stepPlayer(w, 'alice', 1, 0, l1snap())[0].type, 'blocked'); // centre wall
  place(w, 'alice', 0, 0);
  assert.equal(stepPlayer(w, 'alice', -1, 0, l1snap())[0].type, 'blocked'); // out of bounds
});

test('normal move emits move event and mutates position', () => {
  const w = w1();
  const ev = stepPlayer(w, 'alice', 1, 0, l1snap());
  assert.deepEqual(ev, [{ type: 'move', player: 'alice', x: 2, y: 1 }]);
  assert.deepEqual(pos(w, 'alice'), [2, 1]);
});

test('level1 cx niche: alice reaches (9,4), bob reaches (10,4), neither crosses', () => {
  const w = w1();
  place(w, 'alice', 8, 4);
  assert.equal(stepPlayer(w, 'alice', 1, 0, l1snap())[0].type, 'move');
  assert.deepEqual(pos(w, 'alice'), [9, 4]);
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, l1snap()), [{ type: 'blocked', reason: 'wall' }]);
  assert.deepEqual(pos(w, 'alice'), [9, 4]);
  place(w, 'alice', 1, 1);
  place(w, 'bob', 11, 4);
  assert.equal(stepPlayer(w, 'bob', -1, 0, l1snap())[0].type, 'move');
  assert.deepEqual(pos(w, 'bob'), [10, 4]);
  assert.deepEqual(stepPlayer(w, 'bob', -1, 0, l1snap()), [{ type: 'blocked', reason: 'wall' }]);
});

test('level1 niche is reachable by walking from the spawns', () => {
  const w = w1();
  const path = (id, dx, steps) => { for (let i = 0; i < steps; i++) stepPlayer(w, id, dx, 0, l1snap()); };
  stepPlayer(w, 'alice', 0, 1, l1snap()); stepPlayer(w, 'alice', 0, 1, l1snap()); stepPlayer(w, 'alice', 0, 1, l1snap()); // y 1 -> 4
  path('alice', 1, 10); // x 1 -> 9 (the 10th step hits the wall)
  assert.deepEqual(pos(w, 'alice'), [9, 4]);
  for (let i = 0; i < 3; i++) stepPlayer(w, 'bob', 0, 1, l1snap());
  path('bob', -1, 10);
  assert.deepEqual(pos(w, 'bob'), [10, 4]);
});

test('players block each other', () => {
  const w = w1();
  place(w, 'bob', 2, 1);
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, l1snap()), [{ type: 'blocked', reason: 'occupied' }]);
  assert.deepEqual(pos(w, 'alice'), [1, 1]);
});

test('joint-lock door (no qubit) blocks until snap.objects says "0"', () => {
  const w = w1();
  place(w, 'alice', 4, 5);
  assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap({ doors: '1' })), [{ type: 'blocked', reason: 'closed' }]);
  assert.deepEqual(pos(w, 'alice'), [4, 5]);
  assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap({ doors: 'super' })), [{ type: 'blocked', reason: 'superposition' }]);
  assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap({ doors: '0', status: 'ready' })), [{ type: 'move', player: 'alice', x: 4, y: 6 }]);
  // ...and on to the exit
  assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap({ doors: '0', status: 'ready' })), [{ type: 'move', player: 'alice', x: 4, y: 7 }]);
});

test('bob joint-lock mirror: door_B at (15,6) opens on "0"', () => {
  const w = w1();
  place(w, 'bob', 15, 5);
  assert.equal(stepPlayer(w, 'bob', 0, 1, l1snap({ doors: '1' }))[0].reason, 'closed');
  assert.equal(stepPlayer(w, 'bob', 0, 1, l1snap({ doors: '0' }))[0].type, 'move');
});

test('blocking:false door never blocks and never kills (indicator only)', () => {
  const v = structuredClone(view(1));
  v.objects.door_A.blocking = false;
  v.objects.door_A.lethal = true; // even a lethal flag must not matter for an indicator
  const w = createWorld(parseLevel(v));
  place(w, 'alice', 4, 5);
  for (const doors of ['1', 'super', '0']) {
    place(w, 'alice', 4, 5);
    assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap({ doors })), [{ type: 'move', player: 'alice', x: 4, y: 6 }], doors);
  }
  // standing on it while closed is not a hazard either
  assert.deepEqual(hazardCheck(w, l1snap({ doors: '1' })), []);
  assert.deepEqual(hazardCheck(w, l1snap({ doors: 'super' })), []);
  // the other (blocking) door still blocks
  place(w, 'bob', 15, 5);
  assert.equal(stepPlayer(w, 'bob', 0, 1, l1snap({ doors: '1' }))[0].reason, 'closed');
});

test('level3 lethal qubit-bound doors: super blocks, closed kills, open passes', () => {
  const w = worldOf(3);
  const bridge = w.doors.find((d) => d.name === 'bridge_A');
  const laser = w.doors.find((d) => d.name === 'laser_B');
  assert.deepEqual([bridge.x, bridge.y, bridge.qubit, bridge.openOn], [7, 3, 0, 1]);
  place(w, 'alice', 6, 3);
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, objSnap({ bridge_A: 'super', laser_B: '0' })), [{ type: 'blocked', reason: 'superposition' }]);
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, objSnap({ bridge_A: '0', laser_B: '0' })), [
    { type: 'move', player: 'alice', x: 7, y: 3 }, { type: 'death', cause: 'bridge_A' },
  ]);
  place(w, 'alice', 6, 3);
  assert.equal(stepPlayer(w, 'alice', 1, 0, objSnap({ bridge_A: '1', laser_B: '0' })).length, 1);
  place(w, 'bob', 12, 3);
  assert.deepEqual(stepPlayer(w, 'bob', -1, 0, objSnap({ bridge_A: '1', laser_B: '1' })), [
    { type: 'move', player: 'bob', x: 11, y: 3 }, { type: 'death', cause: 'laser_B' },
  ]);
  assert.deepEqual(hazardCheck(w, objSnap({ bridge_A: '1', laser_B: '1' })), [{ type: 'death', cause: 'laser_B' }]);
  assert.deepEqual(hazardCheck(w, objSnap({ bridge_A: '1', laser_B: 'super' })), [{ type: 'death', cause: 'collapse' }]);
  assert.deepEqual(hazardCheck(w, objSnap({ bridge_A: '1', laser_B: '0' })), []);
});

test('sensor emits measure only while its qubit is unmeasured', () => {
  const w = w1();
  place(w, 'alice', 1, 3); // sensor_q0 at (2,3)
  const ev = stepPlayer(w, 'alice', 1, 0, l1snap({ validated: true }));
  assert.deepEqual(ev, [{ type: 'move', player: 'alice', x: 2, y: 3 }, { type: 'measure', qubit: 0 }]);
  place(w, 'alice', 1, 3);
  const ev2 = stepPlayer(w, 'alice', 1, 0, l1snap({ measured: [1, null] }));
  assert.deepEqual(ev2, [{ type: 'move', player: 'alice', x: 2, y: 3 }]);
  place(w, 'bob', 16, 3); // sensor_q1 at (17,3)
  assert.deepEqual(stepPlayer(w, 'bob', 1, 0, l1snap())[1], { type: 'measure', qubit: 1 });
});

test('gate terminal: event payload carries terminalId, actor and target -1; interact does not consume', () => {
  const w = w1();
  const t = w.terminals[0];
  place(w, 'alice', 3, 1);
  assert.deepEqual(interact(w, 'alice', l1snap()), [
    { type: 'gate', gate: 'h', qubit: 0, target: -1, terminalId: 'alice_h', actor: 'alice', terminal: t },
  ]);
  assert.equal(t.usesLeft, 1);
  consumeTerminal(t);
  assert.equal(t.usesLeft, 0);
  consumeTerminal(t);
  assert.equal(t.usesLeft, 0); // never negative
});

test('terminal: wrong owner, exhausted (local fallback without terminal_uses_left), reset', () => {
  const w = w1();
  const t = w.terminals[0];
  place(w, 'bob', 3, 1);
  place(w, 'alice', 1, 1);
  assert.deepEqual(interact(w, 'bob', l1snap()), [{ type: 'info', reason: 'wrong_owner' }]);
  place(w, 'alice', 3, 1);
  consumeTerminal(t);
  const noUses = { ...l1snap() };
  delete noUses.terminal_uses_left;
  assert.deepEqual(interact(w, 'alice', noUses), [{ type: 'info', reason: 'terminal_used' }]);
  resetWorld(w);
  assert.equal(t.usesLeft, 1);
  assert.deepEqual(pos(w, 'alice'), [1, 1]);
  assert.deepEqual(pos(w, 'bob'), [16, 1]);
});

test('terminal uses come from snap.terminal_uses_left when present (engine is the source of truth)', () => {
  const w = w1();
  const t = w.terminals[0];
  place(w, 'alice', 3, 1);
  // engine says used up even though the local counter was never decremented
  assert.deepEqual(interact(w, 'alice', l1snap({ uses: { alice_h: 0, shared_cx: 1 } })), [{ type: 'info', reason: 'terminal_used' }]);
  // engine says one use left even though the local counter hit 0 (e.g. after a stage reset)
  t.usesLeft = 0;
  assert.equal(interact(w, 'alice', l1snap({ uses: { alice_h: 1, shared_cx: 1 } }))[0].type, 'gate');
});

test('uses: null means unlimited (level2 feed_forward bob_x)', () => {
  const w = worldOf(2, 1);
  const t = w.terminals[0];
  assert.equal(t.usesLeft, Infinity);
  place(w, 'bob', 13, 1);
  const snap = objSnap({}, { terminal_uses_left: { bob_x_feed_forward: null } });
  for (let i = 0; i < 3; i++) {
    const ev = interact(w, 'bob', snap);
    assert.equal(ev[0].type, 'gate');
    assert.equal(ev[0].terminalId, 'bob_x_feed_forward');
    assert.equal(ev[0].qubit, 1);
    consumeTerminal(ev[0].terminal);
  }
  assert.equal(t.usesLeft, Infinity);
  assert.equal(interact(w, 'bob', snap)[0].type, 'gate');
});

test('interact on an empty cell does nothing', () => {
  assert.deepEqual(interact(w1(), 'alice', l1snap()), []);
});

test('cnot needs alice on the control and bob on the target (payload carries terminalId; actor is the terminal owner "shared")', () => {
  const w = w1();
  place(w, 'alice', 9, 4);
  assert.deepEqual(interact(w, 'alice', l1snap()), [{ type: 'info', reason: 'cnot_needs_both' }]);
  place(w, 'bob', 10, 4);
  // The engine matches `actor` against the terminal owner ('shared'), whoever presses E.
  const expected = [{
    type: 'cnot', gate: 'cx', qubit: 0, target: 1, terminalId: 'shared_cx', actor: 'shared', terminal: w.cnot,
  }];
  assert.deepEqual(interact(w, 'alice', l1snap()), expected);
  assert.deepEqual(interact(w, 'bob', l1snap()), expected);
  // only bob at the target: not enough
  place(w, 'alice', 1, 1);
  assert.deepEqual(interact(w, 'bob', l1snap()), [{ type: 'info', reason: 'cnot_needs_both' }]);
});

test('cnot uses: engine terminal_uses_left wins, local counter is the fallback', () => {
  const w = w1();
  place(w, 'alice', 9, 4);
  place(w, 'bob', 10, 4);
  assert.deepEqual(interact(w, 'alice', l1snap({ uses: { alice_h: 0, shared_cx: 0 } })), [{ type: 'info', reason: 'terminal_used' }]);
  consumeTerminal(w.cnot);
  const noUses = { ...l1snap() };
  delete noUses.terminal_uses_left;
  assert.deepEqual(interact(w, 'alice', noUses), [{ type: 'info', reason: 'terminal_used' }]);
  assert.equal(interact(w, 'alice', l1snap())[0].type, 'cnot'); // engine says 1 left
  resetWorld(w);
  assert.equal(w.cnot.usesLeft, 1);
});

test('level3 cnot sits inside the rooms: control (4,3), target (15,3)', () => {
  const w = worldOf(3);
  place(w, 'alice', 4, 3);
  place(w, 'bob', 15, 3);
  const ev = interact(w, 'alice', objSnap({}, { terminal_uses_left: { shared_cx: 1 } }));
  assert.deepEqual(ev.map((e) => [e.type, e.gate, e.terminalId, e.actor]), [['cnot', 'cx', 'shared_cx', 'shared']]);
});

test('syncTerminalUses copies engine uses onto the local counters', () => {
  const w = w1();
  syncTerminalUses(w, l1snap({ uses: { alice_h: 0, shared_cx: 1 } }));
  assert.deepEqual([w.terminals[0].usesLeft, w.cnot.usesLeft], [0, 1]);
  syncTerminalUses(w, { objects: {} }); // no field: leave as is
  assert.equal(w.terminals[0].usesLeft, 0);
  syncTerminalUses(w, l1snap({ uses: { alice_h: null } })); // null = unlimited
  assert.equal(w.terminals[0].usesLeft, Infinity);
});

test('stageComplete: objective ready AND alice on exit_A AND bob on exit_B', () => {
  const w = w1();
  const ready = l1snap({ doors: '0', status: 'ready', measured: [0, 0], validated: true });
  place(w, 'alice', 4, 7);
  place(w, 'bob', 15, 7);
  assert.equal(stageComplete(w, ready), true);
  assert.equal(stageComplete(w, l1snap({ doors: '0', status: 'pending' })), false);
  assert.equal(stageComplete(w, l1snap({ status: 'failed', measured: [0, 1] })), false);
  assert.equal(stageComplete(w, undefined), false);
  assert.equal(stageComplete(w, { objective: {} }), false);
  place(w, 'bob', 15, 6);
  assert.equal(stageComplete(w, ready), false); // bob not on exit
  place(w, 'bob', 15, 7);
  place(w, 'alice', 4, 6);
  assert.equal(stageComplete(w, ready), false); // alice not on exit
  place(w, 'alice', 15, 7); // alice on bob's exit does not count
  place(w, 'bob', 4, 7);
  assert.equal(stageComplete(w, ready), false);
});

test('stageComplete is false for a world without two exits', () => {
  const w = w1();
  w.exits = w.exits.slice(0, 1);
  place(w, 'alice', 4, 7);
  assert.equal(stageComplete(w, l1snap({ status: 'ready' })), false);
});

test('objectiveFailed reads objective.status', () => {
  assert.equal(objectiveFailed(l1snap({ status: 'failed' })), true);
  assert.equal(objectiveFailed(l1snap({ status: 'ready' })), false);
  assert.equal(objectiveFailed(l1snap({ status: 'pending' })), false);
  assert.equal(objectiveFailed(undefined), false);
  assert.equal(objectiveFailed({}), false);
});

test('bit-based checkWin is gone', () => {
  assert.equal(entities.checkWin, undefined);
});

test('hazardCheck: non-lethal door never kills', () => {
  const w = w1();
  place(w, 'alice', 4, 6);
  assert.deepEqual(hazardCheck(w, l1snap({ doors: '1' })), []);
});
