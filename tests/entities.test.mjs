// Tests for js/entities.js against the real levels/test.json. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel } from '../js/grid.js';
import {
  Player, Door, Sensor, GateTerminal, CnotTerminal, Exit,
  createWorld, resetWorld, stepPlayer, interact, consumeTerminal, checkWin, hazardCheck,
} from '../js/entities.js';

const level = () => JSON.parse(readFileSync(new URL('../levels/test.json', import.meta.url), 'utf8'));
const world = () => createWorld(parseLevel(level()));

// Hand-written snapshots: only the fields entities read.
const snap = ({ a = '0', b = '0', measured = [null, null], marginals = [[0.5, 0.5], [0.5, 0.5]] } = {}) => ({
  objects: { door_A: a, door_B: b }, measured, marginals,
});

const place = (w, id, x, y) => { w.players[id].x = x; w.players[id].y = y; };
const pos = (w, id) => [w.players[id].x, w.players[id].y];

test('classes expose their fields', () => {
  const p = new Player('bob', 1, 3, 4);
  assert.deepEqual([p.id, p.qubit, p.x, p.y], ['bob', 1, 3, 4]);
  const d = new Door('door_A', 1, 8, 0, 0, false);
  assert.equal(d.isOpen({ objects: { door_A: '0' } }), true);
  assert.equal(d.isOpen({ objects: { door_A: '1' } }), false);
  assert.equal(d.isOpen({ objects: { door_A: 'super' } }), false);
  assert.equal(d.state({ objects: { door_A: 'super' } }), 'super');
  const d1 = new Door('x', 0, 0, 0, 1, true);
  assert.equal(d1.isOpen({ objects: { x: '1' } }), true);
  assert.ok(new Sensor(0, 1, 2) && new Exit('alice', 1, 9) && new CnotTerminal([9, 5], [10, 5]));
  const t = new GateTerminal(2, 5, 'h', 'alice', 1);
  assert.equal(t.usesLeft, 1);
});

test('createWorld builds entities from the parsed grid', () => {
  const w = world();
  assert.deepEqual(pos(w, 'alice'), [2, 2]);
  assert.deepEqual(pos(w, 'bob'), [17, 2]);
  assert.equal(w.players.alice.qubit, 0);
  assert.equal(w.players.bob.qubit, 1);
  assert.equal(w.doors.length, 2);
  assert.equal(w.sensors.length, 2);
  assert.equal(w.terminals.length, 2);
  assert.deepEqual(w.cnot.control, [9, 5]);
  assert.equal(w.exits.length, 2);
  const door = w.doors.find((d) => d.name === 'door_B');
  assert.deepEqual([door.x, door.y, door.qubit, door.openOn, door.lethal], [18, 8, 1, 0, true]);
});

test('walls and bounds block', () => {
  const w = world();
  place(w, 'alice', 1, 1);
  assert.deepEqual(stepPlayer(w, 'alice', -1, 0, snap()), [{ type: 'blocked', reason: 'wall' }]);
  assert.deepEqual(stepPlayer(w, 'alice', 0, -1, snap()), [{ type: 'blocked', reason: 'wall' }]);
  assert.deepEqual(pos(w, 'alice'), [1, 1]);
  place(w, 'alice', 9, 4);
  assert.equal(stepPlayer(w, 'alice', 1, 0, snap())[0].type, 'blocked'); // centre wall
  place(w, 'alice', 0, 0);
  assert.equal(stepPlayer(w, 'alice', -1, 0, snap())[0].type, 'blocked'); // out of bounds
});

test('normal move emits move event and mutates position', () => {
  const w = world();
  const ev = stepPlayer(w, 'alice', 1, 0, snap());
  assert.deepEqual(ev, [{ type: 'move', player: 'alice', x: 3, y: 2 }]);
  assert.deepEqual(pos(w, 'alice'), [3, 2]);
});

test('niche: alice enters (9,5) but cannot cross to (10,5); bob mirrors', () => {
  const w = world();
  place(w, 'alice', 8, 5);
  assert.equal(stepPlayer(w, 'alice', 1, 0, snap())[0].type, 'move');
  assert.deepEqual(pos(w, 'alice'), [9, 5]);
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, snap()), [{ type: 'blocked', reason: 'wall' }]);
  assert.deepEqual(pos(w, 'alice'), [9, 5]);
  place(w, 'alice', 2, 2);
  place(w, 'bob', 11, 5);
  assert.equal(stepPlayer(w, 'bob', -1, 0, snap())[0].type, 'move');
  assert.deepEqual(pos(w, 'bob'), [10, 5]);
  assert.deepEqual(stepPlayer(w, 'bob', -1, 0, snap()), [{ type: 'blocked', reason: 'wall' }]);
});

test('players block each other', () => {
  const w = world();
  place(w, 'bob', 3, 2);
  assert.deepEqual(stepPlayer(w, 'alice', 1, 0, snap()), [{ type: 'blocked', reason: 'occupied' }]);
  assert.deepEqual(pos(w, 'alice'), [2, 2]);
});

test('door in superposition blocks', () => {
  const w = world();
  place(w, 'alice', 1, 7);
  const ev = stepPlayer(w, 'alice', 0, 1, snap({ a: 'super' }));
  assert.deepEqual(ev, [{ type: 'blocked', reason: 'superposition' }]);
  assert.deepEqual(pos(w, 'alice'), [1, 7]);
});

test('open door passes', () => {
  const w = world();
  place(w, 'alice', 1, 7);
  const ev = stepPlayer(w, 'alice', 0, 1, snap({ a: '0' }));
  assert.deepEqual(ev, [{ type: 'move', player: 'alice', x: 1, y: 8 }]);
});

test('closed non-lethal door_A blocks', () => {
  const w = world();
  place(w, 'alice', 1, 7);
  const ev = stepPlayer(w, 'alice', 0, 1, snap({ a: '1' }));
  assert.deepEqual(ev, [{ type: 'blocked', reason: 'closed' }]);
  assert.deepEqual(pos(w, 'alice'), [1, 7]);
});

test('closed lethal door_B moves and kills; super lethal door blocks', () => {
  const w = world();
  place(w, 'bob', 18, 7);
  assert.deepEqual(stepPlayer(w, 'bob', 0, 1, snap({ b: 'super' })), [{ type: 'blocked', reason: 'superposition' }]);
  const ev = stepPlayer(w, 'bob', 0, 1, snap({ b: '1' }));
  assert.deepEqual(ev, [
    { type: 'move', player: 'bob', x: 18, y: 8 },
    { type: 'death', cause: 'door_B' },
  ]);
  assert.deepEqual(pos(w, 'bob'), [18, 8]);
});

test('sensor emits measure only while its qubit is unmeasured', () => {
  const w = world();
  place(w, 'alice', 3, 4); // sensor_q0 at (3,4); step from (2,4)
  place(w, 'alice', 2, 4);
  const ev = stepPlayer(w, 'alice', 1, 0, snap());
  assert.deepEqual(ev, [{ type: 'move', player: 'alice', x: 3, y: 4 }, { type: 'measure', qubit: 0 }]);
  place(w, 'alice', 2, 4);
  const ev2 = stepPlayer(w, 'alice', 1, 0, snap({ measured: [1, null] }));
  assert.deepEqual(ev2, [{ type: 'move', player: 'alice', x: 3, y: 4 }]);
});

test('terminal: gate event, wrong owner, exhausted, consume, reset', () => {
  const w = world();
  const t = w.terminals.find((x) => x.gate === 'h');
  place(w, 'alice', 2, 5);
  assert.deepEqual(interact(w, 'alice', snap()), [{ type: 'gate', gate: 'h', qubit: 0, terminal: t }]);
  assert.equal(t.usesLeft, 1); // interact does not decrement
  consumeTerminal(t);
  assert.equal(t.usesLeft, 0);
  assert.deepEqual(interact(w, 'alice', snap()), [{ type: 'info', reason: 'terminal_used' }]);
  consumeTerminal(t);
  assert.equal(t.usesLeft, 0); // never negative
  place(w, 'bob', 2, 5);
  place(w, 'alice', 2, 2);
  assert.deepEqual(interact(w, 'bob', snap()), [{ type: 'info', reason: 'wrong_owner' }]);
  resetWorld(w);
  assert.equal(t.usesLeft, 1);
  assert.deepEqual(pos(w, 'alice'), [2, 2]);
  assert.deepEqual(pos(w, 'bob'), [17, 2]);
});

test('bob terminal gives qubit 1', () => {
  const w = world();
  place(w, 'bob', 16, 5);
  const ev = interact(w, 'bob', snap());
  assert.equal(ev[0].type, 'gate');
  assert.equal(ev[0].gate, 'x');
  assert.equal(ev[0].qubit, 1);
});

test('interact on empty cell does nothing', () => {
  assert.deepEqual(interact(world(), 'alice', snap()), []);
});

test('cnot requires alice on control and bob on target', () => {
  const w = world();
  place(w, 'alice', 9, 5);
  assert.deepEqual(interact(w, 'alice', snap()), [{ type: 'info', reason: 'cnot_needs_both' }]);
  place(w, 'bob', 10, 5);
  assert.deepEqual(interact(w, 'alice', snap()), [{ type: 'cnot', control: 0, target: 1 }]);
  assert.deepEqual(interact(w, 'bob', snap()), [{ type: 'cnot', control: 0, target: 1 }]);
  // Only bob at target: still not enough
  place(w, 'alice', 2, 2);
  assert.deepEqual(interact(w, 'bob', snap()), [{ type: 'info', reason: 'cnot_needs_both' }]);
});

test('checkWin with measured and marginals', () => {
  const w = world();
  const win = { q0: 0, q1: 0 };
  place(w, 'alice', 1, 9);
  place(w, 'bob', 18, 9);
  assert.equal(checkWin(w, snap({ measured: [0, 0] }), win), true);
  assert.equal(checkWin(w, snap({ measured: [0, 1] }), win), false);
  assert.equal(checkWin(w, snap({ marginals: [[1, 0], [1, 0]] }), win), true);
  assert.equal(checkWin(w, snap({ marginals: [[1, 0], [0.5, 0.5]] }), win), false);
  assert.equal(checkWin(w, snap({ measured: [0, null], marginals: [[0.5, 0.5], [1, 0]] }), win), true);
  assert.equal(checkWin(w, snap({ marginals: [[0, 1], [0, 1]] }), { q0: 1, q1: 1 }), true);
  place(w, 'bob', 17, 2);
  assert.equal(checkWin(w, snap({ measured: [0, 0] }), win), false); // bob not on exit
  place(w, 'bob', 18, 9);
  place(w, 'alice', 2, 2);
  assert.equal(checkWin(w, snap({ measured: [0, 0] }), win), false); // alice not on exit
});

test('hazardCheck kills a player standing on a lethal door that closed or collapsed', () => {
  const w = world();
  place(w, 'bob', 18, 8);
  assert.deepEqual(hazardCheck(w, snap({ b: '0' })), []);
  assert.deepEqual(hazardCheck(w, snap({ b: '1' })), [{ type: 'death', cause: 'door_B' }]);
  assert.deepEqual(hazardCheck(w, snap({ b: 'super' })), [{ type: 'death', cause: 'collapse' }]);
  // Non-lethal door never kills
  place(w, 'bob', 17, 2);
  place(w, 'alice', 1, 8);
  assert.deepEqual(hazardCheck(w, snap({ a: '1' })), []);
});
