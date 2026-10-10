# Guía de integración de assets — Entangled

Esta guía explica cómo consumir en el juego los recursos gráficos y de audio de Fernanda. La hoja actual es una **primera versión**: revisa visualmente cada celda antes de asignarla a una mecánica. El índice de `assets/spritesheet.txt` describe familias y usos previstos, no un mapa exhaustivo de nombres por celda.

## Archivos

- `assets/spritesheet.png`: atlas transparente de 256×192 px, con celdas de 16×16 (16 columnas × 12 filas).
- `assets/spritesheet.txt`: índice de familias y notas de integración.
- `assets/characters/alice_walk_4dir.png` y `bob_walk_4dir.png`: tiras de movimiento; cada frame mide 16×16, 8 columnas × 4 direcciones.
- `assets/characters/alice_actions.png` y `bob_actions.png`: poses de acción; inspeccionar antes de fijar sus índices.
- `audio/soundtrack.ogg`: música provisional, iniciar tras una acción del usuario por las restricciones de autoplay del navegador.
- `assets/src/`: fuentes/generación de los assets actuales; conservar como origen editable.

## Recortar sprites del atlas

Las coordenadas del atlas son **columna, fila, empezando en cero**. Para una celda `(col, row)`, el rectángulo fuente es:

```js
const TILE = 16;
const sx = col * TILE;
const sy = row * TILE;
ctx.drawImage(sheet, sx, sy, TILE, TILE, x, y, TILE * scale, TILE * scale);
```

Cargar el PNG una sola vez y reutilizarlo. Mantener `imageSmoothingEnabled = false` para pixel art y dibujar en múltiplos enteros (la escala objetivo es 2). Ejemplo de carga:

```js
const sheet = new Image();
sheet.src = "assets/spritesheet.png";
await sheet.decode();
```

En un atlas animado, cada frame debe recortarse por separado. No dibujes una fila completa como una sola imagen a menos que la animación realmente abarque toda esa fila.

## Mapa y escala

La resolución lógica indicada por el handoff es 320×192 px: 20×12 tiles de 16×16, dibujados a 2× en un canvas de 640×384. Por tanto, un tile lógico `(col, row)` se muestra en `(col*32, row*32)` con tamaño 32×32. La pared divisoria ocupa las columnas lógicas 9 y 10.

El atlas es una **biblioteca de sprites**, no el mapa del nivel. Define el mapa por separado (por ejemplo, matriz de símbolos/IDs en los datos del nivel), coloca las entidades en coordenadas de tile y deja que la lógica de colisión y el estado cuántico determinen qué variante se dibuja.

## Familias del atlas

Según `assets/spritesheet.txt`:

| Filas (y) | Familia | Uso previsto |
|---|---|---|
| 0 | Alice, estados y efectos | Personaje, orbes 0/1/superposición y destellos |
| 1 | Bob y efectos | Personaje y efectos |
| 2 | Puertas y rejas | Variantes de Lab, Prison y Core |
| 3 | Sensores y terminales | Sensores, interruptores e indicadores |
| 4–6 | Tiles de entorno | Lab, Prison y Core, respectivamente |
| 7 | Efectos/enlaces | Haces, pulsos, puentes y colapsos |
| 8 | Iconos de HUD | H, X, Z, CX, M y otros símbolos |
| 9 | Paneles | Piezas de marcos y diálogo |
| 10 | Props | Detalles decorativos |
| 11 | Suelos, salidas y marcadores | Patrones e indicadores de estado |

El índice detalla algunos rangos (p. ej. estado 0/1/superposición en fila 0, columnas 8–10), pero varios rangos son solo familias. Inspecciona `assets/spritesheet.png` o el preview y anota las coordenadas exactas que el juego adopte en un registro de sprites versionado. No asumas que cada tile del rango es una animación ordenada.

## Personajes y animación

Las hojas direccionales separadas tienen 8 columnas × 4 filas de frames de 16 px. Recorta frame `(frame, dirección)` con origen `(frame*16, dirección*16)`. Confirma visualmente qué filas corresponden a abajo/arriba/izquierda/derecha antes de codificar el orden. Para caminar alterna los dos frames elegidos a ~8 fps; usa un frame fijo al estar quieto. Si se espeja la vista izquierda/derecha, comprueba que los detalles asimétricos no queden incorrectos.

No deduzcas la identidad de los personajes únicamente por el color: la versión actual representa a Alice y Bob como pollitos astronautas amarillos con acentos de personaje. Las poses de `*_actions.png` también requieren selección y validación manual.

## Variantes de estado y reglas de juego

El código, no el sprite, es la fuente de verdad del estado cuántico. Representa estados y resultados usando lógica de juego y usa los sprites solo como presentación:

- `0`: verde `#5BBF6A`.
- `1`: rojo `#D64550`.
- superposición: violeta `#A66CFF` **más rayas/patrón**; no depender solo del color.
- Alice: acento cian `#4ADBE6`; Bob: acento naranja `#F5A742`.

Una apariencia de superposición no significa que el resultado de una medición ya esté decidido. Antes de medir, muestra probabilidades/estado; después, muestra el resultado muestreado. La fila 8 incluye iconos de operaciones, pero activar H/X/Z/CX/M debe llamar a la operación correspondiente del motor, no limitarse a cambiar el dibujo.

Para puertas, sensores y salidas, define una tabla de estados explícita (por ejemplo `closed/open/locked` o `idle/active`) y asocia cada estado a una coordenada revisada. Evita inferir automáticamente que los rangos de fila 2 son necesariamente `0/1/super`.

## Interfaz, audio y accesibilidad

- Compón el marco del Observer con las piezas de la fila 9 solo después de verificar sus esquinas y bordes; no estires los píxeles, repite los segmentos centrales.
- Respeta el límite narrativo del handoff: texto en inglés, hasta 2 líneas de 40 caracteres.
- Reproduce `audio/soundtrack.ogg` en loop solo después de Start/gesto del jugador; ofrece mute/volumen y detén o pausa al salir del juego.
- Mantén formas y patrones además del color, alto contraste y opción de movimiento reducido. Con movimiento reducido, usa un frame estático para superposición/efectos.

## Validación antes de integrar

1. Comprueba dimensiones del PNG (256×192) y transparencia; cada celda debe alinearse a múltiplos de 16.
2. Crea una pantalla de prueba que muestre la grilla numerada y revisa sprites a 1× y 2× con nearest-neighbor.
3. Registra en código o datos las coordenadas exactas seleccionadas y el significado de cada estado.
4. Verifica que colisiones, animaciones y eventos no dependan del arte ni modifiquen el circuito cuántico.
5. Prueba Lab/Prison/Core, HUD, audio y accesibilidad en el canvas de 640×384.

El arte actual es provisional. Ajusta la tabla de coordenadas conforme el equipo valide cada tile en el juego; no edites el atlas a mano sin actualizar `assets/spritesheet.txt` y las referencias del código.

## Decoraciones de laboratorio — Nivel 1

El atlas `assets/lab_decorations.png` debe tratarse como una **biblioteca visual separada** del atlas principal. No reemplaza `assets/spritesheet.png` ni cambia las referencias de Alice, Bob, H, CX/CNOT, M, sensores, puertas o salidas.

- Carga la imagen decorativa por separado y crea un registro de sprites con coordenadas/recortes verificados.
- Mantén las decoraciones en una capa o lista de datos independiente (por ejemplo, `level.decorations`).
- Por defecto, tanques, plantas, tapetes, luces, rejillas y conductos son no sólidos y no interactivos.
- Computadores/mesas solo deben bloquear el movimiento si su huella se marca explícitamente como sólida y se comprueba que no interrumpe el camino.
- No dibujes decoración encima de las consolas H/CX/M, sensores, puertas, spawns ni pasos del divisor central.
- Reserva un corredor transitable de al menos un tile lógico de ancho desde cada spawn hacia sus objetivos.
- Dibuja en este orden: suelo y paredes; detalles de suelo; decoraciones; consolas/sensores/puertas; jugadores; efectos y HUD.
- La decoración no debe modificar el estado cuántico, el orden de compuertas, la medición, la colisión de las puertas ni la condición de victoria.

Consulta `docs/level1_calibration_map.txt` para un borrador de distribución y una lista de colocación. Es un plano conceptual, no un reemplazo directo de las coordenadas que ya usa el código: antes de aplicarlo, conserva los IDs y posiciones actuales de los objetos interactivos y traduce únicamente las decoraciones a la estructura de mapa real.
