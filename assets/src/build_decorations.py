"""Builds the small lab-decoration atlas embedded in js/sprites.js (Qollab cannot load big files).

Reads assets/lab_elements.png (Fernanda's 1536x1024 atlas; her guide calls it lab_decorations.png)
and the crop spec assets/lab_decorations.json, then for each sprite: crop, alpha-trim, scale to fit
its footprint at 2x (32 px per tile, aspect preserved) and quantise alpha to 0/255 so it reads as
pixel art. Packs the results into assets/lab_decorations_atlas.png + assets/lab_decorations_atlas.json.

Usage (needs Pillow; the repo .venv has none, use the system python):
    /usr/bin/python3 assets/src/build_decorations.py
Deterministic: same inputs, same bytes. Follow with: node scripts/build-sprites.mjs
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "lab_elements.png"
SPEC = ROOT / "assets" / "lab_decorations.json"
OUT_PNG = ROOT / "assets" / "lab_decorations_atlas.png"
OUT_JSON = ROOT / "assets" / "lab_decorations_atlas.json"

TILE = 32            # screen px per logical tile (16 px art at 2x)
ALPHA_CUT = 96       # alpha >= cut -> opaque, else transparent
ATLAS_WIDTH = 128    # shelf-packing width
GAP = 1              # transparent gap between packed sprites


def quantise_alpha(img):
    r, g, b, a = img.split()
    a = a.point(lambda v: 255 if v >= ALPHA_CUT else 0)
    out = Image.merge("RGBA", (r, g, b, a))
    # Fully transparent pixels carry no colour, so output bytes do not depend on glow residue.
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            if px[x, y][3] == 0:
                px[x, y] = (0, 0, 0, 0)
    return out


def build_sprite(source, spec):
    x0, y0, x1, y1 = spec["src"]
    crop = source.crop((x0, y0, x1, y1))
    bbox = crop.getchannel("A").point(lambda v: 255 if v >= ALPHA_CUT else 0).getbbox()
    if bbox is None:
        raise SystemExit(f"empty crop for rect {spec['src']}")
    crop = crop.crop(bbox)
    fw, fh = spec["footprint"]
    scale = min(fw * TILE / crop.width, fh * TILE / crop.height)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    size = (min(size[0], fw * TILE), min(size[1], fh * TILE))
    # Pillow premultiplies alpha internally when resizing RGBA, so edges do not bleed dark colour.
    return quantise_alpha(crop.resize(size, Image.LANCZOS))


def main():
    source = Image.open(SOURCE).convert("RGBA")
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    sprites = {name: build_sprite(source, item) for name, item in spec.items() if not name.startswith("_")}
    footprints = {name: spec[name]["footprint"] for name in sprites}

    # Shelf packing in spec order: deterministic and tiny.
    placed, x, y, shelf_h = {}, 0, 0, 0
    for name, img in sprites.items():
        if x and x + img.width > ATLAS_WIDTH:
            x, y, shelf_h = 0, y + shelf_h + GAP, 0
        placed[name] = (x, y)
        x += img.width + GAP
        shelf_h = max(shelf_h, img.height)
    atlas = Image.new("RGBA", (ATLAS_WIDTH, y + shelf_h), (0, 0, 0, 0))
    for name, img in sprites.items():
        atlas.paste(img, placed[name])
    atlas.save(OUT_PNG, optimize=True)

    frames = {name: {"x": placed[name][0], "y": placed[name][1], "w": sprites[name].width,
                     "h": sprites[name].height, "footprint": footprints[name]} for name in sprites}
    rows = ",\n".join(f"  {json.dumps(name)}: {json.dumps(frame)}" for name, frame in frames.items())
    OUT_JSON.write_text("{\n" + rows + "\n}\n", encoding="utf-8")
    print(f"wrote {OUT_PNG.name} {atlas.size} ({OUT_PNG.stat().st_size} bytes) and {OUT_JSON.name}")


if __name__ == "__main__":
    main()
