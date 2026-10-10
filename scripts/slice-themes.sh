#!/usr/bin/env bash
# Slices the four AI-generated 2048x2048 theme sheets in assets/src/ into game-ready 256x256 RGBA PNGs:
#   assets/themes/{lab,prison}_tiles.png  normalized 8x8 grid of 32 px cells (the renderer's CELL), see below
#   assets/themes/{lab,prison}_props.png  objects at 1/8 scale, same relative layout as the source sheet
# Needs ImageMagick 7 (`magick`). Deterministic. Usage: scripts/slice-themes.sh [lab|prison ...]
#
# 1. KEY: on the full-resolution JPEG every pixel within FUZZ of magenta #FF00FF becomes transparent, then the
#    alpha is choked CHOKE px so what is left of the JPEG halo disappears (visually checked on dark and light
#    backgrounds, no pink fringe). The prison tile sheet also has one purple-tinted cell (disabled sensor) whose
#    tint is keyed too.
# 2. SCALE: every output pixel is the box (area) average of an 8x8 block, alpha-aware (ImageMagick resizes
#    premultiplied), so glyphs (H/X/Z, bars, circles) stay readable at 32 px.
# Tile sheets: the source rows are NOT on an even grid (doors are 1.2 cells tall, small props are loose), so each
# output cell is cut from a hand-measured source rect:
#   S  stretch the rect to the whole 32x32 cell (floors, walls, doors, exits: they must fill their cell)
#   C  scale 1/8 (or less if bigger than the cell), centred   (floor plates: sensors)
#   F  scale 1/8 (or less if bigger than the cell), bottom-centred (freestanding objects: terminals, small props)
# Floors are cut 8 px inside the source rect to drop the black outline that every AI floor tile has, so they tile.
# Props sheets: the listed regions (output px) are kept, everything else (the black/pink region borders of the
# source) is erased. Region lists must match assets/themes/*.json.
set -euo pipefail
cd "$(dirname "$0")/.."

FUZZ="${FUZZ:-26%}"
CHOKE="${CHOKE:-2}"
OUT=assets/themes
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

key() { # <src.jpg> <keyed.png> [extra key color]
  local extra=()
  if [[ -n "${3:-}" ]]; then extra=(-fuzz 12% -transparent "$3"); fi
  magick "$1" -alpha set -fuzz "$FUZZ" -fill none -opaque '#FF00FF' "${extra[@]}" \
    -channel A -morphology Erode "Disk:$CHOKE" +channel "$2"
}

# cell <keyed.png> <out.png> <col> <row> <mode> <sx> <sy> <sw> <sh>
cell() {
  local keyed="$1" out="$2" col="$3" row="$4" mode="$5" sx="$6" sy="$7" sw="$8" sh="$9" nw nh ox oy
  if [[ "$mode" == S ]]; then
    nw=32; nh=32; ox=0; oy=0
  else
    read -r nw nh < <(awk -v w="$sw" -v h="$sh" 'BEGIN{s=1/8; m=(w>h?w:h); if (m*s>32) s=32/m; nw=int(w*s+0.5); nh=int(h*s+0.5); if(nw<1)nw=1; if(nh<1)nh=1; print nw, nh}')
    ox=$(( (32 - nw) / 2 ))
    if [[ "$mode" == C ]]; then oy=$(( (32 - nh) / 2 )); else oy=$(( 32 - nh )); fi
  fi
  magick "$keyed" -crop "${sw}x${sh}+${sx}+${sy}" +repage -filter Box -resize "${nw}x${nh}!" "$TMP/cell.png"
  magick "$out" "$TMP/cell.png" -geometry "+$((col * 32 + ox))+$((row * 32 + oy))" -compose Over -composite -strip "$out"
}

# region <keyed.png> <out.png> <x> <y> <w> <h>   (output px; copies the box-scaled region to the same place)
region() {
  local keyed="$1" out="$2" x="$3" y="$4" w="$5" h="$6"
  magick "$keyed" -crop "$((w * 8))x$((h * 8))+$((x * 8))+$((y * 8))" +repage -filter Box -resize "${w}x${h}!" "$TMP/region.png"
  magick "$out" "$TMP/region.png" -geometry "+${x}+${y}" -compose Over -composite -strip "$out"
}

blank() { magick -size 256x256 xc:none -strip PNG32:"$1"; } # -strip: no timestamps, so reruns are byte-identical

# ---------------------------------------------------------------- lab tiles
lab_tiles() {
  local src=assets/src/lab_tiles.jpg out=$OUT/lab_tiles.png keyed="$TMP/lab_tiles_keyed.png" c
  key "$src" "$keyed"; blank "$out"
  for c in 0 1 2 3 4 5 6 7; do
    cell "$keyed" "$out" $c 0 S $((4 + 256 * c + 8)) 11 232 238                 # row 0 floors
    cell "$keyed" "$out" $c 1 S $((4 + 256 * c)) 271 248 242                     # row 1 walls
  done
  local dx=(7 263 519 775 1031 1287 1543 1799)
  for c in 0 1 2 3 4 5 6 7; do cell "$keyed" "$out" $c 2 S ${dx[$c]} 530 242 310; done   # row 2 doors
  # row 3: sensors (floor plates) and exits
  cell "$keyed" "$out" 0 3 C 16 876 225 215
  cell "$keyed" "$out" 1 3 C 271 876 226 220
  cell "$keyed" "$out" 2 3 C 528 876 225 215
  cell "$keyed" "$out" 3 3 C 783 876 226 215
  cell "$keyed" "$out" 4 3 S 1030 860 244 245
  cell "$keyed" "$out" 5 3 S 1284 859 248 248
  cell "$keyed" "$out" 6 3 S 1540 854 248 253
  cell "$keyed" "$out" 7 3 S 1798 860 244 247
  for c in 0 1 2 3 4 5 6; do cell "$keyed" "$out" $c 4 F $((30 + 256 * c)) 1116 201 272; done   # row 4 terminals (col 7 = pink console, unusable)
  # rows 5-7: small props, row-major, 23 of them (see assets/themes/lab.json)
  local i=0 r k x y w h
  while read -r x y w h; do
    cell "$keyed" "$out" $((i % 8)) $((5 + i / 8)) F "$x" "$y" "$w" "$h"; i=$((i + 1))
  done <<'ITEMS'
49 1401 158 209
326 1397 121 217
571 1427 137 183
823 1421 146 189
1083 1401 137 209
1319 1417 178 177
1555 1417 218 182
1821 1427 198 156
29 1652 188 157
275 1641 218 174
582 1631 116 197
827 1642 138 186
1098 1642 108 162
1354 1642 108 162
1555 1631 218 188
1810 1632 220 187
24 1883 203 136
281 1847 212 193
535 1872 210 153
812 1867 168 148
1068 1847 168 193
1284 1838 248 206
1540 1838 248 206
ITEMS
}

# ---------------------------------------------------------------- prison tiles
prison_tiles() {
  local src=assets/src/prison_titles.jpg out=$OUT/prison_tiles.png keyed="$TMP/prison_tiles_keyed.png" c
  key "$src" "$keyed" 'rgb(130,17,130)'; blank "$out"
  for c in 0 1 2 3 4 5 6 7; do
    cell "$keyed" "$out" $c 0 S $((3 + 256 * c + 8)) 11 234 235                  # row 0 floors
    cell "$keyed" "$out" $c 1 S $((3 + 256 * c)) 260 250 316                     # row 1 walls
    cell "$keyed" "$out" $c 2 S $((9 + 256 * c)) 589 238 349                     # row 2 doors
    cell "$keyed" "$out" $c 4 S $((256 * c)) 1230 256 205                        # row 4 wall terminals (dark plates)
  done
  cell "$keyed" "$out" 0 3 C 34 1046 187 184
  cell "$keyed" "$out" 1 3 C 292 1040 190 160     # disabled sensor, purple tint keyed out
  cell "$keyed" "$out" 2 3 C 542 1033 196 197
  cell "$keyed" "$out" 3 3 C 798 1033 196 197
  cell "$keyed" "$out" 4 3 C 1055 1045 190 185    # glow pad (the translucent light beam above it is cropped away)
  cell "$keyed" "$out" 5 3 C 1312 1048 192 182
  cell "$keyed" "$out" 6 3 F 1568 950 192 280
  cell "$keyed" "$out" 7 3 C 1818 1018 204 212
  # rows 5-7: 24 of the 28 loose props (padlock, blindfold, wall plate and the mattress roll are dropped), row-major (see assets/themes/prison.json)
  local i=0 x y w h
  while read -r x y w h; do
    cell "$keyed" "$out" $((i % 8)) $((5 + i / 8)) F "$x" "$y" "$w" "$h"; i=$((i + 1))
  done <<'ITEMS'
17 1443 172 191
250 1438 114 196
444 1443 136 185
658 1468 121 158
847 1517 150 77
1031 1484 183 114
1237 1474 187 148
1448 1468 176 138
1657 1490 171 160
25 1672 156 148
653 1676 133 133
852 1668 148 150
1052 1668 148 150
1248 1674 169 119
1457 1674 162 140
1687 1655 105 165
1891 1655 106 165
37 1860 131 171
241 1864 133 164
1060 1854 128 180
1232 1850 197 192
1441 1876 189 154
1643 1870 196 158
468 1896 101 102
ITEMS
}

# ---------------------------------------------------------------- props sheets
lab_props() {
  local out=$OUT/lab_props.png keyed="$TMP/lab_props_keyed.png" x y w h
  key assets/src/lab_props.jpg "$keyed"; blank "$out"
  while read -r x y w h; do region "$keyed" "$out" "$x" "$y" "$w" "$h"; done <<'REGIONS'
9 1 41 59
9 65 41 59
65 1 30 62
97 1 30 62
129 6 92 57
229 1 22 62
65 66 62 61
130 65 60 30
194 65 60 30
129 97 62 30
198 97 25 62
226 98 28 61
1 138 30 12
42 129 12 30
71 138 24 21
97 129 30 30
129 129 30 30
67 164 52 59
129 168 30 16
161 166 30 20
198 161 20 30
229 161 26 30
2 194 60 28
133 193 54 30
195 193 58 30
10 232 13 16
33 225 30 30
65 225 30 30
97 225 30 30
REGIONS
}

prison_props() {
  local out=$OUT/prison_props.png keyed="$TMP/prison_props_keyed.png" x y w h
  key assets/src/prison_props.jpg "$keyed"; blank "$out"
  while read -r x y w h; do region "$keyed" "$out" "$x" "$y" "$w" "$h"; done <<'REGIONS'
0 11 32 44
35 6 45 50
82 7 45 40
128 0 64 32
128 32 64 32
199 5 50 53
5 70 21 49
38 72 20 47
65 82 63 34
128 64 64 64
192 64 64 64
0 129 32 31
32 129 32 31
64 129 32 31
96 129 32 31
128 129 32 31
160 129 32 31
192 129 32 31
224 129 32 31
0 160 64 64
75 173 44 37
128 160 64 64
193 168 61 23
194 194 61 21
9 231 14 19
32 224 32 32
64 224 64 32
REGIONS
}

targets=("$@"); [[ ${#targets[@]} -gt 0 ]] || targets=(lab prison)
for t in "${targets[@]}"; do
  case "$t" in
    lab) lab_tiles; lab_props ;;
    prison) prison_tiles; prison_props ;;
    *) echo "unknown theme: $t" >&2; exit 2 ;;
  esac
  echo "sliced $t"
done
