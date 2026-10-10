// Tests for js/layout.js: pure canvas fitting math. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCanvas, debounce } from '../js/layout.js';

test('fitCanvas is limited by height in a wide box and keeps 5:3', () => {
  const r = fitCanvas({ availW: 1500, availH: 600, dpr: 1 });
  assert.equal(r.cssH, 600);
  assert.equal(r.cssW, 1000);
  assert.equal(r.scale, 2); // 1000 / 640 = 1.56 -> 2
});

test('fitCanvas is limited by width in a tall box', () => {
  const r = fitCanvas({ availW: 640, availH: 900, dpr: 1 });
  assert.equal(r.cssW, 640);
  assert.equal(r.cssH, 384);
  assert.equal(r.scale, 1);
});

test('fitCanvas scale follows devicePixelRatio and rounds to an integer', () => {
  assert.equal(fitCanvas({ availW: 640, availH: 384, dpr: 2 }).scale, 2);
  assert.equal(fitCanvas({ availW: 1280, availH: 768, dpr: 1.5 }).scale, 3);
  assert.equal(fitCanvas({ availW: 1000, availH: 600, dpr: 1.25 }).scale, 2); // 1.95 -> 2
});

test('fitCanvas never goes below scale 1 and never returns NaN for a collapsed box', () => {
  assert.equal(fitCanvas({ availW: 100, availH: 60, dpr: 1 }).scale, 1);
  for (const [w, h, d] of [[0, 0, 1], [-5, 10, 1], [NaN, 100, 1], [300, 200, 0], [300, 200, undefined]]) {
    const r = fitCanvas({ availW: w, availH: h, dpr: d });
    assert.ok(Number.isFinite(r.cssW) && Number.isFinite(r.cssH) && r.scale >= 1, JSON.stringify([w, h, d]));
  }
});

test('fitCanvas caps the scale so the backing store stays bounded', () => {
  assert.equal(fitCanvas({ availW: 20000, availH: 12000, dpr: 3 }).scale, 8);
});

test('fitCanvas floors the css size to whole pixels so it never overflows its box', () => {
  const r = fitCanvas({ availW: 1000.7, availH: 500.9, dpr: 1 });
  assert.ok(Number.isInteger(r.cssW) && Number.isInteger(r.cssH));
  assert.ok(r.cssW <= 1000.7 && r.cssH <= 500.9);
});

test('debounce runs the last call once after the delay', async () => {
  const seen = [];
  const d = debounce((v) => seen.push(v), 20);
  d(1); d(2); d(3);
  assert.deepEqual(seen, []);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(seen, [3]);
});
