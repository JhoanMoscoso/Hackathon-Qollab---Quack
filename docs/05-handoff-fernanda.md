# Handoff — Fernanda (arte, historia, música, SFX)

Todo el texto que ve el jugador va en **inglés**. Este documento es interno (español).

## 1. Historia (spine fijo; tú eliges los detalles marcados con ▢)

**Título:** Entangled
**Premisa en una frase (para el menú):** *Two rooms. Two players. One entangled register. You cannot win alone.*

**Personajes**
- **Alice** (jugador 1, color cian). Controla el qubit `q0`.
- **Bob** (jugador 2, color naranja). Controla el qubit `q1`.
- **The Observer** (narrador): la IA del laboratorio. Habla en cajas de texto cortas (máx. 2 líneas de 40 caracteres). ▢ Elige su voz: (a) fría y burocrática ("Subject A: proceed to the scanner."), (b) sarcástica tipo asistente de laboratorio, (c) curiosa y casi afectuosa, que aprende de los jugadores. Yo iría por (b) con un giro a (c) en el final.

**Arco en tres niveles**

| Nivel | Contexto | Lo que pasa | Lo que se aprende |
|-------|----------|-------------|-------------------|
| L1 — *Calibration* | **The Lab.** Cámaras gemelas de contención del "Project Bell". | The Observer entrelaza a Alice y Bob "para calibrar el enlace". Primero prueban una cerradura con dos interruptores independientes (falla la mitad de las veces); luego con el par entrelazado (siempre coinciden). | Correlación: medidos juntos, siempre dan lo mismo. |
| L2 — *Bell Block* | **The Prison.** El pabellón de contención del complejo, construido sobre el entrelazamiento: "los gemelos siempre se mueven juntos". | The Observer los encierra. Las celdas están diseñadas para que las puertas gemelas siempre sean iguales y eso dispare la alarma. Bob descubre la terminal X: ahora siempre son opuestas. Luego Alice mide primero y Bob corrige mirando el resultado. | Anticorrelación y feed-forward: el enlace es un canal de coordinación. |
| L3 — *The Core* | **The Core.** El interior del procesador cuántico: cables, nodos, luz. Donde el enlace fue escrito. | La única salida exige un estado que el enlace **no** puede dar (medir a ciegas = muerte segura). Deben pasar juntos por la terminal CNOT y usar H y Z para deshacer el enlace. Salen como individuos. ▢ Último diálogo del Observer: (a) "Correlation ended. You are free." (b) "You untangled yourselves. I did not expect that." | Determinismo: desentrelazar + interferencia (H·Z·H). |

**Escena de cierre:** pantalla de créditos con el circuito completo que los jugadores construyeron en los tres niveles, y la frase "This effort is supported by Qollab & IonQ".

**Muerte:** en L1 no hay muerte (la cerradura "se atasca" y se reinicia). En L2 y L3 sí: alarma / reja electrificada / caída al vacío / vaporización por láser. Nada gore: el sprite se disuelve en píxeles (3 frames) y el nivel reinicia.

## 2. Especificación técnica del arte

- **Tile:** 16×16 px. El canvas es 640×384 y dibuja a escala ×2 → mapa de **20×12 celdas**. La pared central divisoria ocupa 2 columnas (columnas 9 y 10).
- **Paleta:** máximo 32 colores globales. Recomendación: partir de **Endesga 32** o **Apollo** (lospec.com/palette-list) y fijar:
  - Alice: `#4ADBE6` (cian) · Bob: `#F5A742` (naranja). Son distinguibles para daltonismo rojo-verde y pasan contraste sobre fondos oscuros.
  - Estado `0` (desactivado/libre): verde apagado `#5BBF6A` · Estado `1` (activado/bloqueo): rojo `#D64550` · **Superposición:** violeta `#A66CFF` con patrón de rayas (no solo color; obligatorio por accesibilidad).
  - Cada nivel cambia solo la paleta de **fondo y paredes**: Lab = grises fríos/azul; Prison = ocres y gris cálido; Core = negro + neón cian/magenta.
- **Formato de entrega:** un único `spritesheet.png` (RGBA, fondo transparente, sin compresión con pérdida) con grilla estricta de 16×16, más `spritesheet.txt` con el mapa `nombre: fila,columna,frames`. Jhoan lo convierte a base64 (`js/sprites.js`). Tamaño objetivo < 200 KB.
- **Fuente:** *Press Start 2P* (OFL, Google Fonts). Se entrega el `.ttf`; Jhoan la embebe en `main.css` como base64 (en Qollab no hay garantía de cargar Google Fonts).

## 3. Lista de assets (prioridad en orden; lo marcado ★ es imprescindible)

**Personajes (compartidos por los 3 niveles)**
- ★ Alice: idle (1 frame) + caminar 4 direcciones × 2 frames = 9 frames. ★ Bob: igual, 9 frames. (Si falta tiempo: 2 direcciones y espejo horizontal → 5 frames cada uno.)
- ★ Muerte: 3 frames de disolución (un solo sprite, se tiñe por código del color del personaje).
- Victoria: 2 frames de brillo.

**Objetos cuánticos (3 estados cada uno: `0`, `1`, `super`; `super` con 2 frames de parpadeo)**
- ★ Puerta corrediza (Lab/Prison), ★ Reja de celda (Prison), ★ Puente de energía (Core), ★ Reja láser (Core).
- ★ Sensor / placa de observación: idle + activo (2 frames). Lleva un ojo o lente: es "mirar".
- ★ Terminal de compuerta: base + icono superpuesto `H`, `Z`, `X` (3 iconos de 8×8). Estado usado (apagado).
- ★ Terminal CNOT: dos mitades (control ●, target ⊕) en la pared central, con un cable que las une. 2 frames cuando ambos están encima.
- ★ Salida: 2 frames (cerrada / abierta).
- Alarma (Prison): 2 frames.

**Tiles por contexto (6–8 cada uno)**
- Lab: suelo, pared, pared superior, cristal de observación, consola decorativa, tubo/cápsula.
- Prison: suelo, pared de ladrillo, barrote decorativo, catre, foco de vigilancia.
- Core: suelo "cable", nodo, pared negra, cable vertical, cable horizontal, cruce.

**UI / Debugger (16×16 o 8×8)**
- Iconos de compuerta para el historial: `H`, `X`, `Z`, `CX`, `M` (medición).
- Marco de caja de texto del Observer (9-slice de 3×3 tiles).

## 4. Herramientas de IA y prompts

Regla general: **la IA produce el borrador; el pixel final lo cierras tú** (paleta, grilla, limpieza). Toda herramienta usada se declara en la project page (lo exigen las reglas y suma en "Documentation"). Verifica licencia y precio actuales de cada herramienta antes de usarla.

### 4.1 PixelLab (pixellab.ai) — recomendación principal
Hecho para esto: genera personajes pixel art en 4/8 direcciones, **animaciones de caminar** a partir de un esqueleto, tilesets y variaciones de un mismo personaje. Tiene plugin para Aseprite. Flujo:
1. Crea el personaje base con un prompt (abajo), 16×16 o 32×32 (luego reduces a 16×16 si hace falta).
2. Usa "Animate with skeleton" → walk cycle, 4 direcciones, 2–4 frames. Exporta spritesheet.
3. Tilesets: "Tileset" con el prompt de cada contexto; pide 16×16, "top-down, seamless".

Prompts (PixelLab entiende descripciones cortas):
- Alice: `16x16 pixel art, top-down RPG character, young scientist in a cyan hazmat-style lab suit, white helmet visor, simple shapes, 4 colors, transparent background`
- Bob: `16x16 pixel art, top-down RPG character, young technician in an orange jumpsuit, dark goggles, simple shapes, 4 colors, transparent background`
- Lab tiles: `16x16 top-down tileset, sci-fi laboratory floor and walls, cold grey and blue metal panels, seamless, limited palette`
- Prison tiles: `16x16 top-down tileset, old prison block, brick walls, warm grey floor, rusty bars, seamless, limited palette`
- Core tiles: `16x16 top-down tileset, inside a quantum processor, black background, glowing cyan and magenta circuit traces, nodes, seamless`

### 4.2 Retro Diffusion (extensión de Aseprite, astropulse) — alternativa pixel-perfect
Modelo de difusión entrenado en pixel art real; genera directamente en la grilla, con paleta, y hace tilesets y animaciones simples. Ideal si ya trabajas en Aseprite. Prompts iguales a los de arriba, añadiendo el estilo: `, game sprite, clean pixels, no anti-aliasing`.

### 4.3 ChatGPT (generación de imágenes GPT-image) o Gemini (modelo de imagen "Nano Banana") — para hojas de concepto y consistencia
Muy buenos para **hojas de personaje consistentes** y para editar por conversación ("same character, now facing left", "same tile, prison version"). No producen pixel real: salen "pixel-look" en alta resolución. Flujo: generar a 1024, pedir "on a strict 16x16 grid, 8 columns x 4 rows, transparent background" y luego **reducir con vecino más cercano** y reindexar a la paleta en Aseprite/LibreSprite/Piskel.

Prompt de hoja de personaje:
```
Pixel art character sprite sheet for a top-down 2D puzzle game. One character: Alice, a young scientist in a cyan lab suit with a white visor. Sheet layout: 4 rows (facing down, up, left, right) x 3 columns (idle, walk 1, walk 2). Each cell exactly 16x16 pixels, drawn on a 32x32 canvas per cell for visibility. Flat colors, 4-color palette plus black outline, no anti-aliasing, no gradients, transparent background, no text, no labels.
```
Prompt de objeto con tres estados:
```
Pixel art top-down game object: a sliding metal lab door seen from above, 16x16 tile. Three versions side by side: (1) open, green light; (2) closed, red light; (3) flickering/uncertain, purple with diagonal stripes and semi-transparent. Flat colors, no anti-aliasing, transparent background.
```
Prompt de edición para consistencia (Gemini/ChatGPT): `Keep the exact same character and palette. Only change the facing direction to left. Same 16x16 grid.`

### 4.4 Midjourney / Stable Diffusion + LoRA de pixel art
Midjourney (`--style raw`, añadir `pixel art, 16-bit, top-down tileset`) da ambientación muy rica para **concept art y pantalla de título**, pero no sprites utilizables sin rehacerlos. Stable Diffusion/Flux con LoRA "pixel art" (Civitai) sirve si tienes GPU; mismo post-proceso de 4.3.

### 4.5 Post-proceso (obligatorio)
- Aseprite (de pago) o LibreSprite / Piskel (gratis): `Sprite → Color Mode → Indexed` con la paleta del proyecto; `Resize` con *Nearest Neighbor*; borrar píxeles sueltos; alinear a la grilla.
- Comprobar contraste de cada estado sobre el suelo de su nivel (contrast-ratio.com): texto ≥ 4.5:1, objetos ≥ 3:1.
- Exportar `spritesheet.png` + `spritesheet.txt`.

### 4.6 Animación mínima que funciona
- Caminar: 2 frames alternando a 8 fps. Idle: 1 frame.
- Superposición: 2 frames (rayas desplazadas) a 4 fps. Con "Reduce motion" activado, Jhoan muestra solo el frame 1.
- Sensor activo: 2 frames a 6 fps. Muerte: 3 frames a 6 fps.

## 5. Música y SFX

**Soundtrack:** 1 loop de 60–90 s, exportado a **OGG Vorbis ≤ 2 MB** (a 96 kbps, 90 s ≈ 1.1 MB). Lo lee Python y lo reproduce JS; arranca al pulsar Start. Mood: sintetizador frío con pulso lento; si hay tiempo, una segunda capa de intensidad para L3 (se mezcla por código).
- Opciones: (a) componerlo en **BeepBox** o **Bosca Ceoil** (gratis, chiptune, exportan WAV → OGG con Audacity/ffmpeg); (b) **Suno** o **Udio** con prompt tipo `dark minimal synthwave loop, slow pulse, 90 bpm, no vocals, seamless loop, 90 seconds` — **revisa la licencia**: el proyecto se publica bajo MIT y la pista debe poder redistribuirse; si el plan no lo permite, usa (a) o un CC0 de OpenGameArt/Pixabay con atribución en el README.
- Convertir: `ffmpeg -i loop.wav -c:a libvorbis -b:a 96k soundtrack.ogg`.

**SFX:** no van como archivos; Jhoan los sintetiza en Web Audio. Tú defines el sonido en **jsfxr** (sfxr.me) y entregas los parámetros exportados (JSON) o una descripción de 1 línea por efecto: paso, compuerta aplicada (tono según H/X/Z), medición (idea del juego: el tono sube con la probabilidad del resultado), colapso a 0, colapso a 1, muerte, victoria, menú.

## 6. Entregables y fechas (horas desde el arranque)

| Hora | Entrega |
|------|---------|
| H+2 | Decisión de voz del Observer y look de los personajes (una imagen de referencia de cada uno). Paleta fijada en `docs/palette.md`. |
| H+6 | Alice y Bob con caminar 4 direcciones; puerta y sensor en 3 estados; tiles de Lab. Primer `spritesheet.png`. |
| H+10 | Terminales H/Z/X y CNOT, salida, tiles de Prison. Soundtrack v1 (OGG). |
| H+16 | Tiles de Core, puente y láser, muerte y victoria, iconos del debugger, marco del Observer. Parámetros de SFX. |
| H+20 | Pantalla de título (puede ser concept art de Midjourney reducido a pixel) y textos finales del Observer revisados en inglés. |
| H+24 | Congelación de arte. Solo correcciones. |

Dónde va cada cosa en el repo: `assets/src/` (fuentes editables: .aseprite, .piskel, wav), `assets/spritesheet.png`, `assets/spritesheet.txt`, `audio/soundtrack.ogg`, `assets/font/PressStart2P.ttf`, `docs/palette.md`, `docs/narration.md` (todos los textos del Observer, por nivel y por evento: `enter`, `first_gate`, `first_measure`, `death`, `win`).
