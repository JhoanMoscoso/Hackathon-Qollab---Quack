// Decodes the embedded PNG data URLs and publishes them as globalThis.SPRITES for render.js.
// Never throws and never blocks the game: on any failure it warns once and leaves SPRITES undefined,
// so the renderer keeps using its procedural shapes. The themed tile/prop sheets are optional on top of the
// character strips: if a theme fails to decode, SPRITES is still set and that theme draws procedurally.
//
// SPRITES = { characters: { alice, bob }, themes: { lab|prison: { tilesImage, propsImage, tiles, props, wallTopColor } } }
import { ALICE_URL, BOB_URL, THEMES } from './sprites.js';

async function decoded(createImage, url) {
  const img = createImage();
  img.src = url;
  await img.decode();
  return img;
}

/**
 * @param {{ createImage?: () => any }} [opts] createImage is injectable for tests (default: new Image()).
 * @returns {Promise<boolean>} true when SPRITES was set.
 */
export async function loadSprites({ createImage = () => new Image() } = {}) {
  try {
    const themeTries = Object.entries(THEMES).map(([name, t]) => Promise.all([
      decoded(createImage, t.tilesUrl), decoded(createImage, t.propsUrl),
    ]).then(([tilesImage, propsImage]) => ({ name, tilesImage, propsImage, t }), (error) => ({ name, error })));
    const [alice, bob] = await Promise.all([ALICE_URL, BOB_URL].map((u) => decoded(createImage, u)));
    globalThis.SPRITES = { characters: { alice, bob }, themes: {} };
    for (const r of await Promise.all(themeTries)) {
      if (r.error) { console.warn(`Theme "${r.name}" unavailable, drawing it procedurally:`, r.error?.message ?? r.error); continue; }
      globalThis.SPRITES.themes[r.name] = {
        tilesImage: r.tilesImage, propsImage: r.propsImage, tiles: r.t.tiles, props: r.t.props, wallTopColor: r.t.wallTopColor,
      };
    }
    return true;
  } catch (e) {
    console.warn('Sprites unavailable, using procedural art:', e?.message ?? e);
    return false;
  }
}
