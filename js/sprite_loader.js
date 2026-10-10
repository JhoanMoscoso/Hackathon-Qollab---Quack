// Decodes the embedded PNG data URLs and publishes them as globalThis.SPRITES for render.js.
// Never throws and never blocks the game: on any failure it warns once and leaves SPRITES undefined,
// so the renderer keeps using its procedural shapes. The decoration atlas is optional on top of that:
// if only it fails, SPRITES is still set and the level simply has no decorations.
import { SHEET_URL, ALICE_URL, BOB_URL, DECOR_URL, DECOR_FRAMES } from './sprites.js';
import { ATLAS } from './sprite_map.js';

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
    const decorTry = decoded(createImage, DECOR_URL).then((image) => ({ image }), (error) => ({ error }));
    const [sheet, alice, bob] = await Promise.all([SHEET_URL, ALICE_URL, BOB_URL].map((u) => decoded(createImage, u)));
    globalThis.SPRITES = { image: sheet, frames: ATLAS, characters: { alice, bob } };
    const { image: decor, error } = await decorTry;
    if (decor) globalThis.SPRITES.decor = { image: decor, frames: DECOR_FRAMES };
    else console.warn('Decorations unavailable, drawing without them:', error?.message ?? error);
    return true;
  } catch (e) {
    console.warn('Sprites unavailable, using procedural art:', e?.message ?? e);
    return false;
  }
}
