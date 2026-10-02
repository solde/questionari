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

## Formato JSON
```json
{
  "format": "questionari", "version": 1,
  "title": "Mi cuestionario", "description": "opcional",
  "questions": [
    { "text": "¿…?", "image": null, "options": ["A", "B", "C", "D"], "correct": 1, "time": 20, "points": "standard" }
  ]
}
```
`image`: `null`, una URL `https://…` o un data-URL `data:image/…`. `points`: `standard` | `double` | `none`. Para un separador: `{ "type": "title", "text": "Ronda 2", "subtitle": "opcional", "time": 4 }` (`time` en segundos, 2–30). Ver `examples/ejemplo.json`.

## Notas técnicas
- Señalización con el servidor público de PeerJS; para uno propio edita `config.js`. En redes muy restrictivas (sin STUN/TURN) algunos jugadores podrían no conectar.
- El host debe mantener su pestaña abierta durante la partida.
- Los cuestionarios se guardan en el `localStorage` del navegador: exporta copias de seguridad.
