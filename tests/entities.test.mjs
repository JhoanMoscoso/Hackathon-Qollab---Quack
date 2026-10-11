// Tests for js/entities.js against the real v2 levels. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../js/grid.js';
import {
  Player, Door, Sensor, GateTerminal, CnotTerminal, Exit,
  createWorld, resetWorld, stepPlayer, interact, consumeTerminal, syncTerminalUses,
  stageComplete, objectiveFailed, hazardCheck, sensorsUnderPlayers,
} from '../js/entities.js';
import * as entities from '../js/entities.js';
import { view, worldOf, place, pos, l1snap, objSnap, smallView } from './helpers.mjs';

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
  assert.equal(d.visualState({ objects: { door_A: '1' } }), '1');
  const d1 = new Door('x', 0, 0, 0, 1, true, false);
  assert.equal(d1.isOpen({ objects: { x: '1' } }), true);
  assert.equal(d1.blocking, false);
  assert.ok(new Sensor(0, 1, 2) && new Exit('alice', 1, 9) && new CnotTerminal([9, 4], [10, 4], 'shared_cx', 1));
  const t = new GateTerminal(2, 5, 'h', 'alice', 1, 'alice_h');
  assert.deepEqual([t.usesLeft, t.id], [1, 'alice_h']);
  assert.equal(new GateTerminal(2, 5, 'x', 'bob', null, 'b').usesLeft, Infinity); // null = unlimited
  const cx = new GateTerminal(16, 5, 'cx', 'bob', 1, 'bob_cx', 0, 1);
  assert.deepEqual([cx.qubit, cx.target], [0, 1]);
});

test('createWorld builds level1 entities from the parsed grid', () => {
  const w = w1();
  assert.deepEqual(pos(w, 'alice'), [2, 2]);
  assert.deepEqual(pos(w, 'bob'), [12, 2]);
  assert.equal(w.players.alice.qubit, 0);
  assert.equal(w.players.bob.qubit, 1);
  assert.equal(w.doors.length, 2);
  assert.equal(w.sensors.length, 2);
  assert.deepEqual(w.terminals.map((t) => [t.id, t.gate, t.owner, t.x, t.y, t.qubit, t.target]), [
    ['alice_h', 'h', 'alice', 2, 5, 0, undefined],
    ['bob_cx', 'cx', 'bob', 11, 5, 0, 1], // Bob's own terminal: a CX without target_cell is not co-op
  ]);
  assert.equal(w.cnot, null);
  assert.equal(w.exits.length, 2);
  const door = w.doors.find((d) => d.name === 'door_B');
  assert.deepEqual([door.x, door.y, door.qubit, door.openOn, door.lethal, door.blocking, door.type],
    [13, 6, 1, undefined, false, true, 'validated_exit']);
});

test('walls and bounds block', () => {
  const w = w1();
  place(w, 'alice', 1, 1);
  assert.deepEqual(stepPlayer(w, 'alice', -1, 0, l1snap()), [{ type: 'blocked', reason: 'wall' }]);
  assert.deepEqual(stepPlayer(w, 'alice', 0, -1, l1snap()), [{ type: 'blocked', reason: 'wall' }]);
  assert.deepEqual(pos(w, 'alice'), [1, 1]);
  place(w, 'alice', 6, 3);
  assert.equal(stepPlayer(w, 'alice', 1, 0, l1snap())[0].type, 'blocked'); // centre wall
  place(w, 'alice', 0, 0);
  assert.equal(stepPlayer(w, 'alice', -1, 0, l1snap())[0].type, 'blocked'); // out of bounds
});

test('normal move emits move event and mutates position', () => {
  const w = w1();
  const ev = stepPlayer(w, 'alice', 1, 0, l1snap());
  assert.deepEqual(ev, [{ type: 'move', player: 'alice', x: 3, y: 2 }]);
  assert.deepEqual(pos(w, 'alice'), [3, 2]);
});

test('level1 central wall is solid: neither player gets to the divider column 7 (no co-op CX niche in L1)', () => {
  const w = w1();
  for (let y = 1; y <= 7; y++) {
    place(w, 'alice', 6, y);
    assert.deepEqual(stepPlayer(w, 'alice', 1, 0, l1snap()), [{ type: 'blocked', reason: 'wall' }], `alice row ${y}`);
    place(w, 'bob', 8, y);
    assert.deepEqual(stepPlayer(w, 'bob', -1, 0, l1snap()), [{ type: 'blocked', reason: 'wall' }], `bob row ${y}`);
  }
});

test('each player walks from the spawn to their own terminal', () => {
  const w = w1();
  const walk = (id, dx, dy, steps) => { for (let i = 0; i < steps; i++) stepPlayer(w, id, dx, dy, l1snap()); };
  walk('alice', 0, 1, 3); // (2,2) -> alice_h (2,5)
  assert.deepEqual(pos(w, 'alice'), [2, 5]);
  walk('bob', 0, 1, 3);   // (12,2) -> (12,5)
  walk('bob', -1, 0, 1);  // -> bob_cx (11,5)
  assert.deepEqual(pos(w, 'bob'), [11, 5]);
});

test('players block each other', () => {
  const w = w1();
  place(w, 'bob', 3, 2);
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, l1snap()), [{ type: 'blocked', reason: 'occupied' }]);
  assert.deepEqual(pos(w, 'alice'), [2, 2]);
});

test('validated_exit door follows snap.door_states, never snap.objects or open_on', () => {
  const w = w1();
  place(w, 'alice', 1, 5);
  const door = w.doors.find((d) => d.name === 'door_A');
  // Initial: door_states closed even though objects.door_A is the quantum value "0".
  assert.equal(l1snap().objects.door_A, '0');
  assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap()), [{ type: 'blocked', reason: 'closed' }]);
  // Validated Bell pair: objects says "super" but the door is simply closed (not "superposition").
  assert.equal(l1snap('validated').objects.door_A, 'super');
  assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap('validated')), [{ type: 'blocked', reason: 'closed' }]);
  // One qubit measured: still closed until the whole objective is ready.
  assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap('measured_q0_0')), [{ type: 'blocked', reason: 'closed' }]);
  assert.equal(door.isOpen(l1snap('measured_q0_0')), false);
  // Both measured and equal: open, whatever the measured value (00 or 11).
  for (const name of ['complete_0', 'complete_1']) {
    place(w, 'alice', 1, 5);
    assert.equal(door.isOpen(l1snap(name)), true, name);
    assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap(name)), [{ type: 'move', player: 'alice', x: 1, y: 6 }], name);
    assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap(name)), [{ type: 'move', player: 'alice', x: 1, y: 7 }], name);
  }
  // A snapshot without door_states never opens a validated_exit door (no open_on fallback).
  const bare = { objects: { door_A: '0', door_B: '0' }, measured: [null, null] };
  assert.equal(door.isOpen(bare), false);
  assert.equal(door.state(bare), 'closed');
});

test('bob side mirror: door_B at (13,6) opens from door_states', () => {
  const w = w1();
  place(w, 'bob', 13, 5);
  assert.equal(stepPlayer(w, 'bob', 0, 1, l1snap('validated'))[0].reason, 'closed');
  assert.equal(stepPlayer(w, 'bob', 0, 1, l1snap('complete_1'))[0].type, 'move');
});

test('blocking:false door never blocks and never kills (indicator only)', () => {
  const v = structuredClone(view(1));
  v.objects.door_A.blocking = false;
  v.objects.door_A.lethal = true; // even a lethal flag must not matter for an indicator
  const w = createWorld(parseLevel(v));
  for (const name of ['initial', 'validated', 'complete_0']) {
    place(w, 'alice', 1, 5);
    assert.deepEqual(stepPlayer(w, 'alice', 0, 1, l1snap(name)), [{ type: 'move', player: 'alice', x: 1, y: 6 }], name);
  }
  // standing on it while closed is not a hazard either
  assert.deepEqual(hazardCheck(w, l1snap('initial')), []);
  assert.deepEqual(hazardCheck(w, l1snap('validated')), []);
  // the other (blocking) door still blocks
  place(w, 'bob', 13, 5);
  assert.equal(stepPlayer(w, 'bob', 0, 1, l1snap('validated'))[0].reason, 'closed');
});

test('level3 lethal qubit-bound doors: super blocks, closed kills, open passes', () => {
  const w = worldOf(3);
  const bridge = w.doors.find((d) => d.name === 'bridge_A');
  const laser = w.doors.find((d) => d.name === 'laser_B');
  assert.deepEqual([bridge.x, bridge.y, bridge.qubit, bridge.openOn], [1, 8, 0, 1]);
  place(w, 'alice', 1, 7);
  assert.deepEqual(stepPlayer(w, 'alice', 0, 1, objSnap({ bridge_A: 'super', laser_B: '0' })), [{ type: 'blocked', reason: 'superposition' }]);
  assert.deepEqual(stepPlayer(w, 'alice', 0, 1, objSnap({ bridge_A: '0', laser_B: '0' })), [
    { type: 'move', player: 'alice', x: 1, y: 8 }, { type: 'death', cause: 'bridge_A' },
  ]);
  place(w, 'alice', 1, 7);
  assert.equal(stepPlayer(w, 'alice', 0, 1, objSnap({ bridge_A: '1', laser_B: '0' })).length, 1);
  place(w, 'bob', 18, 7);
  assert.deepEqual(stepPlayer(w, 'bob', 0, 1, objSnap({ bridge_A: '1', laser_B: '1' })), [
    { type: 'move', player: 'bob', x: 18, y: 8 }, { type: 'death', cause: 'laser_B' },
  ]);
  assert.deepEqual(hazardCheck(w, objSnap({ bridge_A: '1', laser_B: '1' })), [{ type: 'death', cause: 'laser_B' }]);
  assert.deepEqual(hazardCheck(w, objSnap({ bridge_A: '1', laser_B: 'super' })), [{ type: 'death', cause: 'collapse' }]);
  assert.deepEqual(hazardCheck(w, objSnap({ bridge_A: '1', laser_B: '0' })), []);
});

test('sensor emits measure only while its qubit is unmeasured and measurement is enabled', () => {
  const w = w1();
  place(w, 'alice', 2, 4); // sensor_q0 at (3,4)
  const ev = stepPlayer(w, 'alice', 1, 0, l1snap('validated'));
  assert.deepEqual(ev, [{ type: 'move', player: 'alice', x: 3, y: 4 }, { type: 'measure', qubit: 0 }]);
  place(w, 'alice', 2, 4);
  const ev2 = stepPlayer(w, 'alice', 1, 0, l1snap('measured_q0_0'));
  assert.deepEqual(ev2, [{ type: 'move', player: 'alice', x: 3, y: 4 }]);
  place(w, 'bob', 9, 4); // sensor_q1 at (10,4)
  assert.deepEqual(stepPlayer(w, 'bob', 1, 0, l1snap('validated'))[1], { type: 'measure', qubit: 1 });
});

test('sensor before a validated RUN gives a hint instead of a measure event (no engine call)', () => {
  const w = w1();
  for (const name of ['initial', 'built_h', 'built']) {
    const snap = l1snap(name);
    assert.equal(snap.measurement_enabled, false, name);
    place(w, 'alice', 2, 4);
    assert.deepEqual(stepPlayer(w, 'alice', 1, 0, snap), [
      { type: 'move', player: 'alice', x: 3, y: 4 }, { type: 'info', reason: 'measurement_locked' },
    ], name);
  }
  // Stages without the flag (L2/L3) keep measuring on contact.
  const legacy = l1snap('initial');
  delete legacy.measurement_enabled;
  place(w, 'alice', 2, 4);
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, legacy)[1], { type: 'measure', qubit: 0 });
});

test('per-qubit measurement permission overrides the legacy global flag', () => {
  const w = w1();
  const snap = { ...l1snap(), measured: [null, null], measurement_enabled: false, measurement_allowed: [true, false] };
  assert.deepEqual(sensorsUnderPlayers(w, snap), []); // Spawns/terminals are not sensors.
  place(w, 'alice', 2, 4);
  assert.equal(stepPlayer(w, 'alice', 1, 0, snap)[1].type, 'measure');
  place(w, 'bob', 12, 4);
  assert.deepEqual(stepPlayer(w, 'bob', 1, 0, snap)[1], { type: 'info', reason: 'measurement_locked' });
  assert.deepEqual(sensorsUnderPlayers(w, snap), [{ type: 'measure', qubit: 0 }]);
});

test('gate terminal: event payload carries terminalId, actor and target -1; interact does not consume', () => {
  const w = w1();
  const t = w.terminals[0];
  place(w, 'alice', 2, 5);
  assert.deepEqual(interact(w, 'alice', l1snap()), [
    { type: 'gate', gate: 'h', qubit: 0, target: -1, terminalId: 'alice_h', actor: 'alice', terminal: t },
  ]);
  assert.equal(t.usesLeft, 1);
  consumeTerminal(t);
  assert.equal(t.usesLeft, 0);
  consumeTerminal(t);
  assert.equal(t.usesLeft, 0); // never negative
});

test("Bob's own CX terminal (no target_cell) is a normal owner terminal: q0 -> q1, actor is bob", () => {
  const w = w1();
  const t = w.terminals.find((x) => x.id === 'bob_cx');
  place(w, 'bob', 11, 5);
  assert.deepEqual(interact(w, 'bob', l1snap('built_h')), [
    { type: 'gate', gate: 'cx', qubit: 0, target: 1, terminalId: 'bob_cx', actor: 'bob', terminal: t },
  ]);
  // No partner needed, and only the owner can use it.
  place(w, 'alice', 11, 5);
  place(w, 'bob', 12, 2);
  assert.deepEqual(interact(w, 'alice', l1snap()), [{ type: 'info', reason: 'wrong_owner' }]);
  assert.equal(w.cnot, null);
});

test('terminal: wrong owner, exhausted (local fallback without terminal_uses_left), reset', () => {
  const w = w1();
  const t = w.terminals[0];
  place(w, 'bob', 2, 5);
  place(w, 'alice', 2, 2);
  assert.deepEqual(interact(w, 'bob', l1snap()), [{ type: 'info', reason: 'wrong_owner' }]);
  place(w, 'alice', 2, 5);
  place(w, 'bob', 12, 2);
  consumeTerminal(t);
  const noUses = { ...l1snap() };
  delete noUses.terminal_uses_left;
  assert.deepEqual(interact(w, 'alice', noUses), [{ type: 'info', reason: 'terminal_used' }]);
  resetWorld(w);
  assert.equal(t.usesLeft, 1);
  assert.deepEqual(pos(w, 'alice'), [2, 2]);
  assert.deepEqual(pos(w, 'bob'), [12, 2]);
});

test('terminal uses come from snap.terminal_uses_left when present (engine is the source of truth)', () => {
  const w = w1();
  const t = w.terminals[0];
  place(w, 'alice', 2, 5);
  // engine says used up even though the local counter was never decremented
  assert.deepEqual(interact(w, 'alice', l1snap('built_h')), [{ type: 'info', reason: 'terminal_used' }]);
  // engine says one use left even though the local counter hit 0 (e.g. after a stage reset)
  t.usesLeft = 0;
  assert.equal(interact(w, 'alice', l1snap('initial'))[0].type, 'gate');
});

test('level2 Bob X terminal honors the engine use count', () => {
  const w = worldOf(2);
  const t = w.terminals.find((terminal) => terminal.id === 'bob_x');
  assert.equal(t.usesLeft, 1);
  place(w, 'bob', t.x, t.y);
  const snap = objSnap({}, { terminal_uses_left: { bob_x: 1 } });
  const ev = interact(w, 'bob', snap);
  assert.equal(ev[0].type, 'gate');
  assert.equal(ev[0].terminalId, 'bob_x');
  assert.equal(ev[0].qubit, 1);
  consumeTerminal(ev[0].terminal);
  assert.equal(interact(w, 'bob', { ...snap, terminal_uses_left: { bob_x: 0 } })[0].reason, 'terminal_used');
});

test('interact on an empty cell does nothing', () => {
  assert.deepEqual(interact(w1(), 'alice', l1snap()), []);
});

test('level3 cnot needs alice on the control and bob on the target (payload carries terminalId; actor is the terminal owner "shared")', () => {
  const w = worldOf(3);
  const snap = objSnap({}, { terminal_uses_left: { shared_cx: 1 } });
  place(w, 'alice', ...w.cnot.control);
  assert.deepEqual(interact(w, 'alice', snap), [{ type: 'info', reason: 'cnot_needs_both' }]);
  place(w, 'bob', ...w.cnot.target);
  // The engine matches `actor` against the terminal owner ('shared'), whoever presses E.
  const expected = [{
    type: 'cnot', gate: 'cx', qubit: 0, target: 1, terminalId: 'shared_cx', actor: 'shared', terminal: w.cnot,
  }];
  assert.deepEqual(interact(w, 'alice', snap), expected);
  assert.deepEqual(interact(w, 'bob', snap), expected);
  // only bob at the target: not enough
  place(w, 'alice', 1, 1);
  assert.deepEqual(interact(w, 'bob', snap), [{ type: 'info', reason: 'cnot_needs_both' }]);
});

test('cnot uses: engine terminal_uses_left wins, local counter is the fallback', () => {
  const w = worldOf(3);
  place(w, 'alice', ...w.cnot.control);
  place(w, 'bob', ...w.cnot.target);
  assert.deepEqual(interact(w, 'alice', objSnap({}, { terminal_uses_left: { shared_cx: 0 } })), [{ type: 'info', reason: 'terminal_used' }]);
  consumeTerminal(w.cnot);
  assert.deepEqual(interact(w, 'alice', objSnap({})), [{ type: 'info', reason: 'terminal_used' }]);
  assert.equal(interact(w, 'alice', objSnap({}, { terminal_uses_left: { shared_cx: 1 } }))[0].type, 'cnot'); // engine says 1 left
  resetWorld(w);
  assert.equal(w.cnot.usesLeft, 1);
});

test('level3 cnot plates flank the central wall: control (8,4), target (11,4)', () => {
  const w = worldOf(3);
  place(w, 'alice', ...w.cnot.control);
  place(w, 'bob', ...w.cnot.target);
  const ev = interact(w, 'alice', objSnap({}, { terminal_uses_left: { shared_cx: 1 } }));
  assert.deepEqual(ev.map((e) => [e.type, e.gate, e.terminalId, e.actor]), [['cnot', 'cx', 'shared_cx', 'shared']]);
});

test('syncTerminalUses copies engine uses onto the local counters', () => {
  const w = w1();
  syncTerminalUses(w, l1snap('initial', { terminal_uses_left: { alice_h: 0, bob_cx: 1 } }));
  assert.deepEqual(w.terminals.map((t) => t.usesLeft), [0, 1]);
  syncTerminalUses(w, { objects: {} }); // no field: leave as is
  assert.equal(w.terminals[0].usesLeft, 0);
  syncTerminalUses(w, l1snap('initial', { terminal_uses_left: { alice_h: null } })); // null = unlimited
  assert.equal(w.terminals[0].usesLeft, Infinity);
});

test('stageComplete: objective ready AND alice on exit_A AND bob on exit_B', () => {
  const w = w1();
  for (const name of ['complete_0', 'complete_1']) {
    const ready = l1snap(name);
    place(w, 'alice', 1, 7);
    place(w, 'bob', 13, 7);
    assert.equal(stageComplete(w, ready), true, name);
    place(w, 'bob', 13, 6);
    assert.equal(stageComplete(w, ready), false); // bob not on exit
    place(w, 'bob', 13, 7);
    place(w, 'alice', 1, 6);
    assert.equal(stageComplete(w, ready), false); // alice not on exit
    place(w, 'alice', 13, 7); // alice on bob's exit does not count
    place(w, 'bob', 1, 7);
    assert.equal(stageComplete(w, ready), false);
  }
  place(w, 'alice', 1, 7);
  place(w, 'bob', 13, 7);
  assert.equal(stageComplete(w, l1snap('validated')), false);
  assert.equal(stageComplete(w, l1snap('measured_q0_0')), false);
  assert.equal(stageComplete(w, l1snap('validated', { measured: [0, 1], objective: { status: 'failed' } })), false);
  assert.equal(stageComplete(w, undefined), false);
  assert.equal(stageComplete(w, { objective: {} }), false);
  // exits_unlocked alone (without objective.status) also counts; explicit false does not.
  assert.equal(stageComplete(w, { objective: {}, exits_unlocked: true }), true);
  assert.equal(stageComplete(w, { objective: { status: 'ready' }, exits_unlocked: false }), true);
  assert.equal(stageComplete(w, { objective: {}, exits_unlocked: false }), false);
});

test('stageComplete is false for a world without two exits', () => {
  const w = w1();
  w.exits = w.exits.slice(0, 1);
  place(w, 'alice', 1, 7);
  assert.equal(stageComplete(w, l1snap('complete_0')), false);
});

test('objectiveFailed reads objective.status', () => {
  const withStatus = (status) => l1snap('validated', { objective: { status } });
  assert.equal(objectiveFailed(withStatus('failed')), true);
  assert.equal(objectiveFailed(withStatus('ready')), false);
  assert.equal(objectiveFailed(withStatus('pending')), false);
  assert.equal(objectiveFailed(undefined), false);
  assert.equal(objectiveFailed({}), false);
});

test('bit-based checkWin is gone', () => {
  assert.equal(entities.checkWin, undefined);
});

test('hazardCheck: non-lethal door never kills', () => {
  const w = w1();
  place(w, 'alice', 1, 6);
  assert.deepEqual(hazardCheck(w, l1snap('validated')), []);
});

test('sensorsUnderPlayers: players already on an unmeasured sensor produce measure events (post-Run re-fire)', () => {
  const w = w1();
  place(w, 'alice', 3, 4); // sensor_q0
  assert.deepEqual(sensorsUnderPlayers(w, l1snap('validated')), [{ type: 'measure', qubit: 0 }]);
  place(w, 'bob', 10, 4); // sensor_q1
  assert.deepEqual(sensorsUnderPlayers(w, l1snap('validated')), [
    { type: 'measure', qubit: 0 }, { type: 'measure', qubit: 1 },
  ]);
});

test('sensorsUnderPlayers: nothing for measured qubits, players off their sensors or locked measurement', () => {
  const w = w1();
  assert.deepEqual(sensorsUnderPlayers(w, l1snap('validated')), []);
  place(w, 'alice', 3, 4);
  assert.deepEqual(sensorsUnderPlayers(w, l1snap('measured_q0_1')), []);
  assert.deepEqual(sensorsUnderPlayers(w, l1snap('built')), []); // measurement_enabled false: no engine call
  place(w, 'alice', 2, 4);
  assert.deepEqual(sensorsUnderPlayers(w, l1snap('validated')), []);
});

test('wall-light decorations do not make the top wall walkable', () => {
  const w = w1();
  place(w, 'alice', 5, 1);
  assert.deepEqual(stepPlayer(w, 'alice', 0, -1, l1snap()), [{ type: 'blocked', reason: 'wall' }]);
});

// ---------- variable map size: divider columns and solid decorations ----------
const smallWorld = (extra = {}) => createWorld(parseLevel(smallView(extra)));
const SNAP = { objects: {}, measured: [null, null], terminal_uses_left: {} };

test('room rule follows the grid divider: a gap in the 15x9 divider lets each player in, but not past it', () => {
  const v = smallView();
  v.map[4] = v.map[4].slice(0, 7) + '.' + v.map[4].slice(8); // gap at (7, 4)
  const w = createWorld(parseLevel(v));
  place(w, 'alice', 6, 4);
  assert.equal(stepPlayer(w, 'alice', 1, 0, SNAP)[0].type, 'move');
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, SNAP), [{ type: 'blocked', reason: 'wall' }], 'alice may not cross to 8');
  place(w, 'alice', 1, 1);
  place(w, 'bob', 8, 4);
  assert.equal(stepPlayer(w, 'bob', -1, 0, SNAP)[0].type, 'move');
  assert.deepEqual(stepPlayer(w, 'bob', -1, 0, SNAP), [{ type: 'blocked', reason: 'wall' }], 'bob may not cross to 6');
});

test('solid decorations block movement over their whole footprint, floor decals do not', () => {
  const w = smallWorld({ decorations: [
    { sprite: 'server_rack_a', cell: [2, 2], footprint: [1, 2], solid: true },
    { sprite: 'floor_grate', cell: [4, 4], footprint: [2, 1] },
  ] });
  assert.equal(w.solidCells.size, 2);
  place(w, 'alice', 1, 2);
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, SNAP), [{ type: 'blocked', reason: 'solid' }]);
  place(w, 'alice', 1, 3);
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, SNAP), [{ type: 'blocked', reason: 'solid' }], 'second row of the footprint');
  place(w, 'alice', 3, 4);
  assert.equal(stepPlayer(w, 'alice', 1, 0, SNAP)[0].type, 'move', 'grate is walk-over');
  assert.equal(stepPlayer(w, 'alice', 1, 0, SNAP)[0].type, 'move');
});

test('solid defaults to the theme registry; an explicit solid:false wins; unknown sprites are walk-over', () => {
  const w = smallWorld({ decorations: [
    { sprite: 'locker', cell: [2, 2], footprint: [1, 2] },                    // registry: solid
    { sprite: 'locker', cell: [4, 2], footprint: [1, 2], solid: false },       // explicit override
    { sprite: 'no_such_sprite', cell: [2, 5], footprint: [1, 1] },
    { sprite: 'plant', cell: [4, 5], footprint: [1, 1] },                      // lab registry: solid plant
  ] });
  assert.deepEqual([...w.solidCells].sort(), ['2,2', '2,3', '4,5']);
  const prison = smallWorld({ theme: 'prison', decorations: [{ sprite: 'bunk_a', cell: [2, 2], footprint: [1, 2] }, { sprite: 'locker', cell: [4, 2], footprint: [1, 2] }] });
  assert.equal(prison.solidCells.size, 4, 'prison registry knows bunk_a and locker');
});

test('solid decorations never block a player standing next to another entity: occupied/solid are distinct reasons', () => {
  const w = smallWorld({ decorations: [{ sprite: 'plant', cell: [3, 2], footprint: [1, 1], solid: true }] });
  place(w, 'alice', 2, 2);
  place(w, 'bob', 8, 2);
  assert.equal(stepPlayer(w, 'alice', 1, 0, SNAP)[0].reason, 'solid');
});
