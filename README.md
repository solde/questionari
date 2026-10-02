# 🎯 Questionari

Juego de preguntas tipo Kahoot que se ejecuta **solo con archivos estáticos** (ideal para GitHub Pages). No hay backend propio: las partidas usan WebRTC (PeerJS) directamente entre el navegador del host y el de los jugadores.

## Publicar en GitHub Pages
1. Sube el repo a GitHub.
2. *Settings → Pages → Build and deployment*: Source = **Deploy from a branch**, rama `main` (o la tuya), carpeta `/ (root)`.
3. Abre `https://<usuario>.github.io/<repo>/`.

## Funcionalidades
- Crear/editar cuestionarios a mano (2–4 opciones, tiempo, puntos estándar/doble/sin puntos).
- Separadores entre preguntas: pantalla de título (y subtítulo) de unos segundos, sin respuestas, que avanza sola.
- Preguntas con imagen (subida desde el dispositivo, se reduce a 800 px, o URL).
- Importar (archivo o pegando texto) y exportar cuestionarios en JSON. Las imágenes subidas viajan dentro del JSON.
- Partida: el host crea una sala con un código de 5 letras; los jugadores entran con código + nombre (o con el enlace `?join=CODE`). El host decide si también juega.
- Gamificación: puntos por rapidez (500–1000), bonus por racha de aciertos, preguntas ×2, clasificación tras cada pregunta, podio animado, premios (🔥 Racha, ⚡ Rayo, 🎯 Francotirador) y CSV de resultados.
- Reconexión automática de jugadores que pierdan la conexión.

## Tipos de pregunta, comodines y avatares

- **Tipos de pregunta**: respuesta múltiple, **ordenar** (se escriben los elementos en el orden correcto y se barajan al jugar; puntúa todo o nada) y **encuesta** (sin respuesta correcta, no puntúa; se muestran los votos).
- **Comodines** (partida en directo): el host elige en el lobby cuáles se permiten — 50/50, puntos dobles, escudo de racha y saltar. Cada jugador puede usar cada uno una vez.
- **Avatar**: al unirse, cada jugador elige un emoji o una letra (si no, se usa la inicial del nombre).
- **Código QR** en el lobby, además del enlace para copiar (usa `qrcode-generator` desde unpkg).
- **Examen**: cada alumno recibe las preguntas en orden aleatorio (dentro de cada bloque entre separadores); el informe CSV añade la columna «Núm. original».

### Importar CSV

Además de JSON se puede importar CSV (delimitador `,` `;` o tabulador, UTF-8). Descarga la plantilla desde la biblioteca. Columnas:
`type,text,option1..option6,correct,time,points,image,explanation,subtitle`

- `type`: vacío (respuesta múltiple), `order`, `poll` o `title` (separador).
- `correct`: número (1 = primera opción) o letra A–F; no se usa en `order` ni `poll`.
- En JSON, las preguntas de ordenar/encuesta llevan `"type": "order"` / `"type": "poll"`; en `order` las opciones van en el orden correcto.

## Modo examen
Al crear la sala se elige **Partida en directo** o **Examen**.
- Cada alumno avanza a su ritmo: puede volver atrás, saltar de pregunta con el navegador numerado y corregir hasta entregar.
- Duración del examen = suma de la duración de todas sus preguntas, con cuenta atrás; al agotarse se entrega solo lo respondido.
- El host no participa: ve un panel con el progreso (respondidas, aciertos, estado) de cada alumno. Solo si está **solo en la sala** puede hacer el examen él mismo, con la vista de un alumno.
- Al entregar, el alumno ve en pantalla **solo su informe** (nota, aciertos, errores, en blanco, tiempos y revisión pregunta a pregunta) y puede descargarlo en **CSV** (pregunta, respuesta dada, respuesta correcta, resultado, explicación y tiempo). El host puede descargar el CSV de cada alumno o uno con todos.
- Las respuestas correctas y explicaciones no salen del host hasta que el alumno entrega.

## Temas de color
Un único control en la barra superior (icono de paleta) reúne el **desplegable de temas** y el **botón de modo claro/oscuro**. El tema (diseño por defecto, Dracula, Nord, Solarized, Gruvbox, Monokai, Atom One, Tokyo Night, Catppuccin, Rosé Pine, GitHub, Night Owl, Material Palenight, Everforest y Alto contraste) es independiente del modo: cada uno tiene variante clara y oscura, y el botón cambia entre ambas conservando el tema. Si no se ha elegido modo, se sigue el del sistema. Todo se recuerda en el navegador.
`themes.css` y `themes.js` se generan con `python3 tools/gen-themes.py`, que ajusta los colores para cumplir contraste WCAG AA; para añadir un tema, añade las dos paletas (clara y oscura) en ese script y vuelve a ejecutarlo.

## Música
Durante la partida suena música de concurso sintetizada en el navegador (sin archivos de audio). En el resto de la web (inicio, biblioteca, editor) suena una melodía tranquila tipo lo-fi, distinta a la de la partida; en el examen no hay música. Cada jugador ajusta el volumen con el control deslizante de la barra superior (el altavoz silencia y restaura el último volumen); se recuerda en ese dispositivo.

## Idiomas
Interfaz en catalán (por defecto), castellano, gallego, euskera, inglés, francés, alemán, italiano, polaco, ruso, árabe (RTL), hindi, chino simplificado, japonés y klingon (`tlhIngan Hol`, romanización estándar; traducción de mejor esfuerzo). Selector en la barra superior; la elección se guarda en el navegador. Las traducciones están en `i18n.js` y `i18n-extra.js`. El host y los jugadores pueden usar idiomas distintos. El contenido de los cuestionarios no se traduce.

## Formato JSON
En *Mis cuestionarios* → **Descargar plantilla JSON** se obtiene un archivo con un separador y una pregunta de ejemplo (todos los campos), listo para editar e importar.

```json
{
  "format": "questionari", "version": 1,
  "title": "Mi cuestionario", "description": "opcional",
  "questions": [
    { "text": "¿…?", "image": null, "options": ["A", "B", "C", "D"], "correct": 1, "time": 20, "points": "standard" }
  ]
}
```
`explanation` (opcional, máx. 500 caracteres): texto que se muestra en la pantalla de resultados con el porqué de la respuesta correcta; la pantalla dura más si el texto es largo. `image`: `null`, una URL `https://…` o un data-URL `data:image/…`. `points`: `standard` | `double` | `none`. Para un separador: `{ "type": "title", "text": "Ronda 2", "subtitle": "opcional", "time": 4 }` (`time` en segundos, 2–30). Ver `examples/ejemplo.json` y `examples/tanatopraxia-uc1605-3.json` (132 preguntas con imágenes).

## Notas técnicas
- Señalización con el servidor público de PeerJS; para uno propio edita `config.js`. En redes muy restrictivas (sin STUN/TURN) algunos jugadores podrían no conectar.
- El host debe mantener su pestaña abierta durante la partida.
- Los cuestionarios se guardan en el `localStorage` del navegador: exporta copias de seguridad.
