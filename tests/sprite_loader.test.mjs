// Tests for js/sprite_loader.js with a fake Image factory (no browser). Run: node --test
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSprites } from '../js/sprite_loader.js';
import { THEMES } from '../js/sprites.js';

const okImage = () => ({ set src(v) { this.url = v; }, decode: async () => {} });
const badImage = () => ({ set src(v) { this.url = v; }, decode: async () => { throw new Error('decode failed'); } });

let warns;
let origWarn;
beforeEach(() => { delete globalThis.SPRITES; warns = []; origWarn = console.warn; console.warn = (...a) => warns.push(a); });
afterEach(() => { console.warn = origWarn; delete globalThis.SPRITES; });

test('loadSprites sets globalThis.SPRITES from the six data URLs: two character strips and a tiles + props sheet per theme', async () => {
  const made = [];
  const ok = await loadSprites({ createImage: () => { const i = okImage(); made.push(i); return i; } });
  assert.equal(ok, true);
  assert.equal(made.length, 6);
  for (const i of made) assert.match(i.url, /^data:image\/png;base64,/);
  const s = globalThis.SPRITES;
  assert.ok(s.characters.alice && s.characters.bob);
  assert.notEqual(s.characters.alice, s.characters.bob);
  assert.deepEqual(Object.keys(s.themes).sort(), ['lab', 'prison']);
  for (const name of ['lab', 'prison']) {
    const t = s.themes[name];
    assert.equal(t.tilesImage.url, THEMES[name].tilesUrl);
    assert.equal(t.propsImage.url, THEMES[name].propsUrl);
    assert.equal(t.tiles, THEMES[name].tiles);
    assert.equal(t.props, THEMES[name].props);
    assert.equal(t.wallTopColor, THEMES[name].wallTopColor);
  }
  assert.notEqual(s.themes.lab.tilesImage, s.themes.prison.tilesImage);
  assert.equal(warns.length, 0);
});

test('a theme-only decode failure is non-fatal: characters load, that theme is absent, one warning', async () => {
  const failOnPrison = () => ({
    set src(v) { this.url = v; },
    decode: async function decode() { if (this.url === THEMES.prison.propsUrl) throw new Error('prison decode failed'); },
  });
  const ok = await loadSprites({ createImage: failOnPrison });
  assert.equal(ok, true);
  assert.ok(globalThis.SPRITES.characters.alice);
  assert.ok(globalThis.SPRITES.themes.lab);
  assert.equal(globalThis.SPRITES.themes.prison, undefined);
  assert.equal(warns.length, 1);
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
