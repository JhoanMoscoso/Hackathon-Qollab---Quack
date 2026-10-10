# Entangled - lab decoration atlas integration

- Atlas filename: `assets/lab_elements.png`
- Index filename: `assets/lab_elements.txt`
- Editable/reference source: `assets/src/lab_elements_reference.png`
- Native logical tile: 16x16 px; multi-tile footprints are integer multiples of 16.
- Transparency: alpha is binary (0 or 255); no partial alpha.
- Rendering: nearest-neighbor / `imageSmoothingEnabled = false`.
- Palette: decorative plants and tank contents are intentionally muted; avoid bright state-like fills.
  Interactive state colors remain owned by qubit/UI sprites and game logic.

IMPORTANT:
The actual `levels/level1.json` was not supplied with the current request, so this package does not
claim to place props at verified map coordinates. Add them only after checking the real level JSON.
Do not change coordinates, IDs, handlers, or state logic for H, CX/CNOT, M, sensors, doors, exits,
player spawns, or the tile directly in front of a door. Keep decorations in a separate non-interactive
layer and preserve one-tile-wide walking paths.
