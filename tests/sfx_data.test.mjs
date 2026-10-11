// js/sfx_data.js must carry exactly the data of Samuel's original audio/sfx_data.js. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SFX_DATA } from '../js/sfx_data.js';

const NAMES = ['step', 'gate_H', 'gate_X', 'gate_Z', 'gate_CX', 'measure', 'collapse0', 'collapse1', 'death', 'win', 'click'];

function loadOriginal() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../audio/sfx_data.js', import.meta.url), 'utf8'), ctx);
  return ctx.window.SFX_DATA;
}

test('port has the same data as audio/sfx_data.js', () => {
  const original = loadOriginal();
  assert.ok(original, 'original defines window.SFX_DATA');
  assert.deepEqual(JSON.parse(JSON.stringify(SFX_DATA)), JSON.parse(JSON.stringify(original)));
});

test('all 11 sounds are present with numeric params', () => {
  assert.deepEqual(Object.keys(SFX_DATA).sort(), [...NAMES].sort());
  for (const [name, p] of Object.entries(SFX_DATA)) {
    for (const [key, value] of Object.entries(p)) assert.equal(typeof value, 'number', `${name}.${key}`);
  }
});
