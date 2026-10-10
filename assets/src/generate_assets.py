# First-pass Entangled spritesheet generator
# Requires Pillow. The authoritative rendered output is ../spritesheet.png.
# See the handoff index in ../spritesheet.txt for cell mapping.
from PIL import Image
from pathlib import Path
# This script intentionally keeps generated output immutable in the handoff.
# To revise individual 16x16 cells, edit assets/spritesheet.png in a pixel editor
# and update assets/spritesheet.txt with matching zero-based coordinates.
print('Spritesheet: 256x192 px; cells: 16x16; grid: 16x12')
