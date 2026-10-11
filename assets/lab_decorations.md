# Lab decorations (Level 1) - RETIRED

> **Retired:** the game no longer embeds this atlas. Themed tiles and props now come from `assets/themes/`
> (`scripts/slice-themes.sh`, registries `assets/themes/{lab,prison}.json`, embedded as `THEMES` in `js/sprites.js`).
> The files stay on disk for the artist; the text below describes the old pipeline.

`assets/lab_decorations.json` is a **hand-mapped registry** for `assets/lab_elements.png` (Fernanda's V2,
256x256, binary alpha). It was mapped by eye from real pixel rects because the shipped index
(`assets/font/lab_elements.txt`, `docs/lab_elements_integration.md`) does not match the atlas pixels
(see "Index mismatches" below). The index is **not used** by the game.

`scripts/build-sprites.mjs` embeds the PNG whole as `DECOR_URL` and the registry as `DECOR_FRAMES`
in `js/sprites.js`. The renderer draws each frame at an integer 2x (nearest neighbour), bottom-centre
aligned inside its footprint (32 screen px per tile). Names starting with `floor_` draw first.

Format: `name: { x, y, w, h, footprint: [w, h] }`, rect in V2 source pixels, footprint in tiles.

| Name | Rect (x, y, w, h) | Footprint | What it is |
| --- | --- | --- | --- |
| `tank_a` | 79, 7, 7, 17 | 1x2 | cyan tank (Alice side) |
| `tank_b` | 90, 7, 6, 17 | 1x2 | tank with a pink creature (Bob side) |
| `plant` | 51, 23, 6, 8 | 1x1 | green leaves with a small blue pot stub |
| `floor_mat` | 214, 19, 24, 6 | 2x1 | teal floor mat |
| `wall_light` | 227, 7, 6, 3 | 1x1 | small glowing cyan capsule light (the blue twin is at 214, 7) |
| `floor_grate` | 165, 18, 10, 12 | 1x1 | dark-blue square panel with four corner rivets |

Rects are tight (opaque pixels on all four edges) and disjoint; `tests/build_sprites.test.mjs` checks this.
Alternative not used: a vertical tube light at (245, 0, 5, 11); it is noisy at 2x.

## Index mismatches (`assets/font/lab_elements.txt`, 16 px grid, col,row)

All real content sits in x < 250, y < 48 (the 3 top rows); sprites are roughly half the declared footprint
(e.g. tank 7x17 px against a declared 16x32; mat 24x6 against 32x16) and several entries sit across cell borders.

| Index entry (cell, size) | What is actually at that rect |
| --- | --- |
| `plant_small` (0,0) 1x1 | a monitor (blue screen + base) |
| `plant_purple` (1,0) 1x1 | a second, smaller monitor cut by the cell edge, plus a thin bar |
| `plant_medium` (2,0) 1x1 | a thin blue pole and a shelf frame with orange dots |
| `plant_flower` (3,0) 1x1 | scattered grey-blue noise, no plant. The only green plant is at (51, 23) (cell 3,1) |
| `tank_creature_a_f1` (4,0) 1x2 | a green tank with a yellow-green creature; fits (the one entry that roughly matches) |
| `tank_creature_a_f2` (5,0) 1x2 | TWO tanks: the cyan tank at x=79..85 (1 px spills into cell 4) and the pink-creature tank at 90..95 |
| `tank_creature_a_f3` (6,0) 1x2 | one green tank with a blue creature, plus a black shadow column at the right edge |
| `tank_empty` (7,0) 1x2 | TWO tanks side by side (green-teal and blue), neither empty |
| `tank_broken` (8,0) 1x2 | a small orange blob (about 6x8) with a red stripe, not a broken tank |
| `console_single` (9,0) 1x1 | a partial console with a cyan screen, plus loose pixels at the bottom |
| `console_double` (10,0) 2x1 | a wide console top and a separate teal slab below it |
| `server_rack` (12,0) 1x2 | rack frame with orange indicators in the top half; two small flasks at the bottom |
| `lab_bench` (13,0) 2x2 | NOT a bench: it holds the teal floor mat (214,19)-(238,25) and the two capsule lights at y=7..9 |
| `microscope` (15,0) 1x1 | a thin vertical tube light (245,0)-(250,11) with a black shadow; no microscope |
| `lab_bed` (0,1) 2x1 | scattered pale noise, no bed shape |
| `crate_small` (2,1) 1x1 | a few pixels (purple and pale blue marks), no crate |
| `crate_orange` (3,1) 1x1 | the green plant leaves and its pot stub, plus a cyan bar at the right |
| `floor_mat` (9,1) 2x1 | NOT the mat: a tiny object and the dark-blue rivet panel (165,18) that spills across the cell border. The real mat is at cols 13-14 |
| `floor_grate` (11,1) 1x1 | a dark box with a cyan glyph that looks like a screen (181,21)-(191,30); spills outside the cell |
| `wall_light` (15,1) 1x1 | EMPTY (no opaque pixel). Lights are at (214,7) and (227,7) in row 0 |
| `test_tube_rack` (0,2) 1x1 | a small dark box and a black bar, no rack |
| `cabinet` (1,2) 1x1 | a console/desk shape with a blue screen (a workstation, not a cabinet) |
| `wall_screen` (2,2) 1x1 | scattered noise with a small cyan glyph, no screen |
| `hazard_sign` (3,2) 1x1 | pale dotted noise, no sign |

Suggested fix for the index: use real pixel rects (`name: x,y,w,h`) instead of 16 px cells, or re-export the
atlas so each sprite really sits on its declared grid cell at its declared size.
