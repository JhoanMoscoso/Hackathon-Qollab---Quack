// The theme registries are hand-mapped onto sliced sheets: every rect must contain art, and the embedded copy
// in js/sprites.js (THEMES) must equal the registries plus the PNG sheets byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPng } from './helpers.mjs';

const dir = new URL('../assets/themes/', import.meta.url);
const registry = (t) => JSON.parse(readFileSync(new URL(`${t}.json`, dir), 'utf8'));
const sheet = (t, kind) => readPng(new URL(`${t}_${kind}.png`, dir));
const dataUrl = (t, kind) => `data:image/png;base64,${readFileSync(new URL(`${t}_${kind}.png`, dir)).toString('base64')}`;

const hasArt = (png, x, y, w, h) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (png.alpha(i, j) > 0) return true;
  return false;
};

for (const theme of ['lab', 'prison']) {
  test(`${theme}: every registered tile cell and prop rect contains opaque pixels`, () => {
    const reg = registry(theme);
    const tiles = sheet(theme, 'tiles');
    for (const [name, [c, r]] of Object.entries(reg.tiles)) assert.ok(hasArt(tiles, c * 32, r * 32, 32, 32), `tile ${name}`);
    for (const [name, p] of Object.entries(reg.props)) assert.ok(hasArt(sheet(theme, p.sheet), p.x, p.y, p.w, p.h), `prop ${name}`);
  });

  test(`${theme}: floor tiles are fully opaque so the floor never has holes`, () => {
    const reg = registry(theme);
    const tiles = sheet(theme, 'tiles');
    for (const name of ['floor_a', 'floor_b', 'floor_worn', 'floor_crack', 'floor_drain', 'floor_line', 'floor_shadow', 'floor_hazard']) {
      const [c, r] = reg.tiles[name];
      for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
        assert.ok(tiles.alpha(c * 32 + i, r * 32 + j) >= 250, `${name} pixel ${i},${j}`);
      }
    }
  });

  test(`${theme}: THEMES in js/sprites.js embeds the sheets and the registry`, async () => {
    const { THEMES } = await import('../js/sprites.js');
    const reg = registry(theme);
    assert.equal(THEMES[theme].tilesUrl, dataUrl(theme, 'tiles'));
    assert.equal(THEMES[theme].propsUrl, dataUrl(theme, 'props'));
    assert.deepEqual(THEMES[theme].tiles, reg.tiles);
    assert.deepEqual(THEMES[theme].props, reg.props);
    assert.equal(THEMES[theme].wallTopColor, reg.wall_top_color);
  });
}

test('js/sprites.js stays well under the 2 MB Qollab per-file limit', () => {
  assert.ok(readFileSync(new URL('../js/sprites.js', import.meta.url)).length < 1.5 * 1024 * 1024);
});
