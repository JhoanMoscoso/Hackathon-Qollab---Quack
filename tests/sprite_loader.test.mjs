// Tests for js/sprite_loader.js with a fake Image factory (no browser). Run: node --test
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSprites } from '../js/sprite_loader.js';
import { ATLAS } from '../js/sprite_map.js';

const okImage = () => ({ set src(v) { this.url = v; }, decode: async () => {} });
const badImage = () => ({ set src(v) { this.url = v; }, decode: async () => { throw new Error('decode failed'); } });

let warns;
let origWarn;
beforeEach(() => { delete globalThis.SPRITES; warns = []; origWarn = console.warn; console.warn = (...a) => warns.push(a); });
afterEach(() => { console.warn = origWarn; delete globalThis.SPRITES; });

test('loadSprites sets globalThis.SPRITES from the three data URLs', async () => {
  const made = [];
  const ok = await loadSprites({ createImage: () => { const i = okImage(); made.push(i); return i; } });
  assert.equal(ok, true);
  assert.equal(made.length, 3);
  for (const i of made) assert.match(i.url, /^data:image\/png;base64,/);
  const s = globalThis.SPRITES;
  assert.equal(s.frames, ATLAS);
  assert.ok(s.image && s.characters.alice && s.characters.bob);
  assert.notEqual(s.characters.alice, s.characters.bob);
  assert.equal(warns.length, 0);
});

test('a decode failure leaves SPRITES undefined and warns exactly once', async () => {
  const ok = await loadSprites({ createImage: badImage });
  assert.equal(ok, false);
  assert.equal(globalThis.SPRITES, undefined);
  assert.equal(warns.length, 1);
});

test('a missing Image constructor does not throw', async () => {
  const ok = await loadSprites({ createImage: () => { throw new ReferenceError('Image is not defined'); } });
  assert.equal(ok, false);
  assert.equal(globalThis.SPRITES, undefined);
  assert.equal(warns.length, 1);
});
