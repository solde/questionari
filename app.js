/* Questionari — juego de preguntas tipo Kahoot sin servidor propio.
 * Los cuestionarios viven en localStorage; las partidas usan WebRTC (PeerJS)
 * directamente entre el navegador del host y el de los jugadores. */
'use strict';

const $app = document.getElementById('app');
const PREFIX = 'questionari-';
const STORE_KEY = 'questionari.quizzes.v1';
const SHAPES = ['▲', '◆', '●', '■'];
const MAX_NAME = 20;

/* ───────────── utilidades ───────────── */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = sel => document.querySelector(sel);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = s => (s || 'cuestionario').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cuestionario';

function toast(msg, isErr) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), isErr ? 5000 : 2800);
}

function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ───────────── almacenamiento y formato de cuestionarios ───────────── */
const store = {
  load() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; } },
  save(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; }
    catch { toast('No se pudo guardar: almacenamiento lleno. Prueba con imágenes más pequeñas o exporta y borra cuestionarios.', true); return false; }
  },
};

const blankQuestion = () => ({ id: uid(), text: '', image: null, options: ['', '', '', ''], correct: 0, time: 20, points: 'standard' });
const blankSeparator = () => ({ id: uid(), type: 'title', text: '', subtitle: '', time: 4 });
const isTitle = q => q.type === 'title';
const realCount = quiz => quiz.questions.filter(q => !isTitle(q)).length;
/** Número (1..N) de la pregunta en la posición i, sin contar separadores. */
const qNumber = (quiz, i) => quiz.questions.slice(0, i + 1).filter(q => !isTitle(q)).length;
const blankQuiz = () => ({ id: uid(), title: '', description: '', questions: [blankQuestion()] });

/** Valida y normaliza un cuestionario importado. Lanza Error con mensaje legible. */
function normalizeQuiz(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.questions)) throw new Error('El JSON no tiene una lista "questions".');
  if (!raw.questions.length) throw new Error('El cuestionario no tiene preguntas.');
  const questions = raw.questions.map((q, i) => {
    const n = i + 1;
    if (q && q.type === 'title') {
      if (typeof q.text !== 'string' || !q.text.trim()) throw new Error(`Elemento ${n}: el separador necesita un título ("text").`);
      return { id: uid(), type: 'title', text: q.text.trim().slice(0, 120), subtitle: String(q.subtitle || '').trim().slice(0, 200), time: clamp(Math.round(Number(q.time)) || 4, 2, 30) };
    }
    if (!q || typeof q.text !== 'string' || !q.text.trim()) throw new Error(`Pregunta ${n}: falta el texto ("text").`);
    if (!Array.isArray(q.options)) throw new Error(`Pregunta ${n}: faltan las opciones ("options").`);
    const options = q.options.slice(0, 4).map(o => String(o ?? ''));
    if (options.filter(o => o.trim()).length < 2) throw new Error(`Pregunta ${n}: se necesitan al menos 2 opciones.`);
    const correct = Number.isInteger(q.correct) ? q.correct : 0;
    if (correct < 0 || correct >= options.length || !options[correct].trim()) throw new Error(`Pregunta ${n}: la respuesta correcta ("correct") no es válida.`);
    const image = typeof q.image === 'string' && /^(data:image\/|https?:\/\/)/i.test(q.image) ? q.image : null;
    const time = clamp(Math.round(Number(q.time)) || 20, 5, 120);
    const points = ['standard', 'double', 'none'].includes(q.points) ? q.points : 'standard';
    while (options.length < 2) options.push('');
    return { id: uid(), text: q.text.trim(), image, options, correct, time, points };
  });
  if (!questions.some(q => !isTitle(q))) throw new Error('El cuestionario no tiene preguntas (solo separadores).');
  return { id: uid(), title: String(raw.title || 'Cuestionario importado').slice(0, 120), description: String(raw.description || '').slice(0, 500), questions };
}

function exportable(quiz) {
  return {
    format: 'questionari', version: 1, title: quiz.title, description: quiz.description,
    questions: quiz.questions.map(q => isTitle(q) ? { type: 'title', text: q.text, subtitle: q.subtitle || '', time: q.time } : ({
      text: q.text, image: q.image || null,
      options: q.options.filter((o, i) => o.trim() || i === q.correct),
      correct: q.correct, time: q.time, points: q.points,
    })),
  };
}

/** Reduce una imagen subida a un JPEG de máx. 800px para que quepa en localStorage y viaje rápido. */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('El archivo no es una imagen.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagen no válida.'));
      img.onload = () => {
        const max = 800, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ───────────── estado de la interfaz ───────────── */
const ui = { view: 'home', quizzes: store.load(), editing: null, setupQuizId: null, joinError: '', joinBusy: false, showPaste: false };
let game = null;   // estado del host
let cli = null;    // estado del cliente

function render() {
  const v = views[ui.view];
  $app.innerHTML = v ? v() : '';
  if (ui.view === 'hostFinal' || ui.view === 'clientFinal') launchConfetti();
}
function go(view) { ui.view = view; render(); window.scrollTo(0, 0); }

const inGame = () => !!(game || cli);
function leaveGame() {
  if (game) { clearInterval(game.timer); try { broadcast({ t: 'end' }); } catch { } try { game.peer.destroy(); } catch { } game = null; }
  if (cli) { cli.closing = true; clearInterval(cli.timer); try { cli.peer.destroy(); } catch { } cli = null; }
  $('#conn-badge').textContent = '';
}
window.addEventListener('beforeunload', e => { if (inGame()) { e.preventDefault(); e.returnValue = ''; } });

/* ───────────── vistas: inicio y biblioteca ───────────── */
const views = {};

views.home = () => {
  const prefill = new URLSearchParams(location.search).get('join') || '';
  return `
  <div class="hero"><h1>¡Preguntas, retos y podio!</h1><p>Crea tu cuestionario, comparte el código y juega en directo.</p></div>
  <div class="grid2">
    <div class="card">
      <h2>🎤 Crear / alojar partida</h2>
      <p class="muted">Crea cuestionarios con imágenes, impórtalos o expórtalos en JSON y lanza una partida.</p>
      <button class="btn big" data-act="library">Mis cuestionarios</button>
    </div>
    <form class="card" data-form="join">
      <h2>🎮 Unirse a una partida</h2>
      <label class="f">Código de la partida</label>
      <input type="text" id="join-code" class="code-input" maxlength="5" autocomplete="off" value="${esc(prefill)}" placeholder="ABCDE">
      <label class="f">Tu nombre</label>
      <input type="text" id="join-name" maxlength="${MAX_NAME}" autocomplete="off" placeholder="Tu apodo">
      <div class="err" id="join-err">${esc(ui.joinError)}</div>
      <button class="btn big" type="submit" ${ui.joinBusy ? 'disabled' : ''}>${ui.joinBusy ? 'Conectando…' : 'Entrar'}</button>
    </form>
  </div>`;
};

views.library = () => `
  <div class="row between light" style="margin:10px 0 14px">
    <h1 style="margin:0">Mis cuestionarios</h1>
    <div class="row">
      <button class="btn" data-act="new">＋ Nuevo</button>
      <label class="btn sec">📥 Importar JSON<input type="file" id="import-file" accept=".json,application/json" multiple hidden></label>
      <button class="btn sec" data-act="toggle-paste">Pegar JSON</button>
      ${ui.quizzes.length ? '<button class="btn sec" data-act="export-all">📤 Exportar todos</button>' : ''}
    </div>
  </div>
  ${ui.showPaste ? `<div class="card"><label class="f">Pega aquí el JSON del cuestionario</label>
    <textarea id="paste-json" rows="6" placeholder='{"title": "...", "questions": [...]}'></textarea>
    <div class="row" style="margin-top:8px"><button class="btn" data-act="import-paste">Importar</button><button class="btn ghost" data-act="toggle-paste">Cancelar</button></div></div>` : ''}
  <div class="card">
    ${ui.quizzes.length ? ui.quizzes.map(q => `
      <div class="quiz-item">
        <div><h3>${esc(q.title || 'Sin título')}</h3>
          <span class="muted">${realCount(q)} pregunta${realCount(q) === 1 ? '' : 's'}${q.questions.some(x => x.image) ? ' · 🖼️ con imágenes' : ''}${q.description ? ' · ' + esc(q.description) : ''}</span></div>
        <div class="row">
          <button class="btn ok" data-act="play" data-id="${q.id}">▶ Jugar</button>
          <button class="btn sec" data-act="edit" data-id="${q.id}">✏️ Editar</button>
          <button class="btn sec" data-act="export" data-id="${q.id}">📤 Exportar</button>
          <button class="btn sec" data-act="dup" data-id="${q.id}">⧉</button>
          <button class="btn danger" data-act="del" data-id="${q.id}">🗑</button>
        </div>
      </div>`).join('') : `
      <p class="muted">Aún no tienes cuestionarios. Crea uno nuevo, importa un JSON o carga el de ejemplo.</p>
      <button class="btn sec" data-act="sample">Cargar cuestionario de ejemplo</button>`}
  </div>
  <button class="btn ghost light" data-act="home" style="color:#fff;border-color:rgba(255,255,255,.4)">← Volver</button>`;

/* ───────────── vista: editor ───────────── */
views.editor = () => {
  const z = ui.editing;
  return `
  <div class="row between light" style="margin:10px 0 14px">
    <h1 style="margin:0">${ui.quizzes.some(q => q.id === z.id) ? 'Editar' : 'Nuevo'} cuestionario</h1>
    <div class="row"><button class="btn ok" data-act="save">💾 Guardar</button><button class="btn sec" data-act="library">Cancelar</button></div>
  </div>
  <div class="card">
    <label class="f">Título</label><input type="text" data-bind="title" maxlength="120" value="${esc(z.title)}">
    <label class="f">Descripción (opcional)</label><input type="text" data-bind="description" maxlength="500" value="${esc(z.description)}">
  </div>
  ${z.questions.map((q, i) => editorQuestion(q, i, z.questions.length, z)).join('')}
  <div class="row"><button class="btn big" data-act="add-q">＋ Añadir pregunta</button><button class="btn big sec" data-act="add-sep">➖ Añadir separador</button><button class="btn big ok" data-act="save">💾 Guardar</button></div>`;
};

function editorQuestion(q, i, total, quiz) {
  const head = (label) => `<div class="q-head"><strong>${label}</strong>
      <div class="row">
        <button class="btn sm sec" data-act="q-up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn sm sec" data-act="q-down" data-i="${i}" ${i === total - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn sm sec" data-act="q-dup" data-i="${i}">⧉</button>
        <button class="btn sm danger" data-act="q-del" data-i="${i}" ${total === 1 ? 'disabled' : ''}>🗑</button>
      </div></div>`;
  if (isTitle(q)) return `
  <div class="q-card sep-card" data-qi="${i}">
    ${head('➖ Separador (pantalla de título, sin respuestas)')}
    <label class="f">Título</label><input type="text" data-bind="q.text" data-i="${i}" maxlength="120" value="${esc(q.text)}" placeholder="Ej.: Ronda 2 · Geografía">
    <label class="f">Subtítulo (opcional)</label><input type="text" data-bind="q.subtitle" data-i="${i}" maxlength="200" value="${esc(q.subtitle || '')}">
    <label class="f">Duración en pantalla</label><select data-bind="q.time" data-i="${i}">
      ${[2, 3, 4, 5, 6, 8, 10, 15, 20, 30].map(t => `<option value="${t}" ${q.time === t ? 'selected' : ''}>${t} s</option>`).join('')}</select>
  </div>`;
  return `
  <div class="q-card" data-qi="${i}">
    ${head('Pregunta ' + qNumber(quiz, i))}
    <textarea data-bind="q.text" data-i="${i}" placeholder="Escribe la pregunta…" maxlength="300">${esc(q.text)}</textarea>
    <label class="f">Imagen (opcional)</label>
    ${q.image ? `<img class="img-prev" src="${esc(q.image)}" alt="">
      <button class="btn sm danger" data-act="img-del" data-i="${i}">Quitar imagen</button>` : `
      <div class="row">
        <label class="btn sm sec">🖼️ Subir imagen<input type="file" accept="image/*" data-imgfile="${i}" hidden></label>
        <input type="text" data-imgurl="${i}" placeholder="…o pega una URL de imagen (https://…)" style="flex:1;min-width:200px">
        <button class="btn sm" data-act="img-url" data-i="${i}">Usar URL</button>
      </div>`}
    <label class="f">Opciones (marca la correcta)</label>
    ${q.options.map((o, j) => `
      <div class="opt-row">
        <span class="dot" style="background:var(--c${j})"></span>
        <input type="radio" name="correct-${i}" data-bind="q.correct" data-i="${i}" data-j="${j}" ${q.correct === j ? 'checked' : ''} title="Respuesta correcta">
        <input type="text" data-bind="q.opt" data-i="${i}" data-j="${j}" value="${esc(o)}" maxlength="120" placeholder="Opción ${j + 1}">
        ${q.options.length > 2 ? `<button class="btn sm danger" data-act="opt-del" data-i="${i}" data-j="${j}">✕</button>` : ''}
      </div>`).join('')}
    ${q.options.length < 4 ? `<button class="btn sm sec" data-act="opt-add" data-i="${i}">＋ Añadir opción</button>` : ''}
    <div class="opts-meta">
      <div><label class="f">Tiempo</label><select data-bind="q.time" data-i="${i}">
        ${[5, 10, 15, 20, 30, 45, 60, 90, 120].map(t => `<option value="${t}" ${q.time === t ? 'selected' : ''}>${t} s</option>`).join('')}</select></div>
      <div><label class="f">Puntos</label><select data-bind="q.points" data-i="${i}">
        <option value="standard" ${q.points === 'standard' ? 'selected' : ''}>Estándar</option>
        <option value="double" ${q.points === 'double' ? 'selected' : ''}>Doble ×2</option>
        <option value="none" ${q.points === 'none' ? 'selected' : ''}>Sin puntos</option></select></div>
    </div>
  </div>`;
}

function validateEditing() {
  const z = ui.editing;
  if (!z.title.trim()) return 'Ponle un título al cuestionario.';
  for (let i = 0; i < z.questions.length; i++) {
    const q = z.questions[i], n = isTitle(q) ? `${i + 1} (separador)` : qNumber(z, i);
    if (isTitle(q)) { if (!q.text.trim()) return `Elemento ${n}: escribe el título del separador.`; continue; }
    if (!q.text.trim()) return `Pregunta ${n}: escribe el texto.`;
    if (q.options.filter(o => o.trim()).length < 2) return `Pregunta ${n}: rellena al menos 2 opciones.`;
    if (!q.options[q.correct].trim()) return `Pregunta ${n}: la opción correcta está vacía.`;
  }
  if (!realCount(z)) return 'Añade al menos una pregunta (no solo separadores).';
  return '';
}

/** Antes de guardar o jugar: elimina opciones vacías (conservando la correcta) para que todas las opciones sean válidas. */
function compactQuiz(quiz) {
  const copy = JSON.parse(JSON.stringify(quiz));
  copy.questions.forEach(q => {
    if (isTitle(q)) { q.text = q.text.trim(); q.subtitle = (q.subtitle || '').trim(); return; }
    const keep = q.options.map((o, j) => ({ o: o.trim(), j })).filter(x => x.o);
    q.correct = keep.findIndex(x => x.j === q.correct);
    q.options = keep.map(x => x.o);
    q.text = q.text.trim();
  });
  copy.title = copy.title.trim();
  return copy;
}

/* ───────────── protocolo de red ───────────── */
function peerOptions() {
  const c = window.QUESTIONARI_PEER || {};
  const o = { debug: 0 };
  ['host', 'port', 'path', 'secure', 'key'].forEach(k => { if (c[k] !== undefined) o[k] = c[k]; });
  if (c.config) o.config = c.config;
  return o;
}
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const safeSend = (conn, msg) => { try { if (conn && conn.open) conn.send(msg); } catch (e) { console.warn('send', e); } };

/* ───────────── HOST ───────────── */
views.hostSetup = () => {
  const quiz = ui.quizzes.find(q => q.id === ui.setupQuizId);
  return `
  <div class="card" style="max-width:560px;margin:20px auto">
    <h2>▶ ${esc(quiz.title)}</h2>
    <p class="muted">${realCount(quiz)} preguntas</p>
    <label style="display:flex;gap:10px;align-items:center;font-weight:600;margin:12px 0">
      <input type="checkbox" id="host-plays" style="width:20px;height:20px" checked> Yo también quiero participar como jugador
    </label>
    <div id="host-name-wrap"><label class="f">Tu nombre de jugador</label>
      <input type="text" id="host-name" maxlength="${MAX_NAME}" value="Host"></div>
    <div class="err" id="host-err"></div>
    <div class="row"><button class="btn big ok" data-act="start-lobby" id="start-lobby">Crear sala</button><button class="btn ghost" data-act="library">Cancelar</button></div>
  </div>`;
};

async function createLobby(quiz, hostPlays, hostName) {
  let peer = null, code = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    code = genCode();
    try {
      peer = await new Promise((resolve, reject) => {
        const p = new Peer(PREFIX + code, peerOptions());
        const t = setTimeout(() => { p.destroy(); reject(Object.assign(new Error('timeout'), { type: 'timeout' })); }, 12000);
        p.on('open', () => { clearTimeout(t); resolve(p); });
        p.on('error', e => { clearTimeout(t); p.destroy(); reject(e); });
      });
      break;
    } catch (e) {
      if (e.type !== 'unavailable-id') throw e;
    }
  }
  if (!peer) throw new Error('No se pudo reservar un código de partida.');

  game = {
    peer, code, quiz, hostPlays, state: 'lobby', qIndex: -1, qStart: 0, deadline: 0, timer: null,
    answers: new Map(), players: new Map(), results: null,
  };
  if (hostPlays) game.players.set('host', newPlayer('host', hostName || 'Host', null, true));

  peer.on('connection', conn => {
    conn.on('data', msg => onClientMessage(conn, msg));
    conn.on('close', () => onClientClose(conn));
    conn.on('error', () => onClientClose(conn));
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch { } });
  peer.on('error', e => { console.warn('peer', e); });
  $('#conn-badge').textContent = `Sala ${code}`;
}

const newPlayer = (id, name, conn, isHost = false) => ({
  id, name, conn, isHost, connected: true, score: 0, streak: 0, maxStreak: 0, correct: 0, answered: 0, timeSum: 0, rank: 0, prevRank: 0, last: null,
});

function connectedHumans() { return [...game.players.values()].filter(p => p.isHost || p.connected); }
function broadcast(msg) { if (!game) return; game.players.forEach(p => { if (p.conn) safeSend(p.conn, msg); }); }

function lobbyNames() { return [...game.players.values()].map(p => p.name); }

function onClientMessage(conn, msg) {
  if (!game || !msg || typeof msg !== 'object') return;
  if (msg.t === 'join') return handleJoin(conn, msg);
  const p = [...game.players.values()].find(x => x.conn === conn);
  if (!p) return;
  if (msg.t === 'answer') registerAnswer(p, msg.q, msg.choice);
}

function handleJoin(conn, msg) {
  const id = String(msg.id || '').slice(0, 40);
  const name = String(msg.name || '').trim().slice(0, MAX_NAME);
  if (!id || !name) return safeSend(conn, { t: 'error', msg: 'Nombre no válido.' });
  const existing = game.players.get(id);
  if (existing && !existing.isHost) {
    existing.conn = conn; existing.connected = true;
    safeSend(conn, { t: 'joined', name: existing.name });
    resendState(existing);
    refreshHostLive();
    return;
  }
  if (game.state !== 'lobby') return safeSend(conn, { t: 'error', msg: 'La partida ya ha empezado.' });
  if ([...game.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return safeSend(conn, { t: 'error', msg: 'Ese nombre ya está en uso.' });
  if (game.players.size >= 100) return safeSend(conn, { t: 'error', msg: 'La sala está llena.' });
  game.players.set(id, newPlayer(id, name, conn));
  safeSend(conn, { t: 'joined', name });
  broadcast({ t: 'lobby', names: lobbyNames() });
  refreshHostLive();
}

function onClientClose(conn) {
  if (!game) return;
  const p = [...game.players.values()].find(x => x.conn === conn);
  if (!p) return;
  p.connected = false; p.conn = null;
  if (game.state === 'lobby') { game.players.delete(p.id); broadcast({ t: 'lobby', names: lobbyNames() }); }
  refreshHostLive();
  if (game.state === 'question') maybeCloseQuestion();
}

function resendState(p) {
  const g = game;
  if (g.state === 'lobby') safeSend(p.conn, { t: 'lobby', names: lobbyNames() });
  else if (g.state === 'title') safeSend(p.conn, titlePayload(g.qIndex, Math.max(0, (g.deadline - Date.now()) / 1000)));
  else if (g.state === 'question') {
    safeSend(p.conn, { ...questionPayload(g.qIndex), time: Math.max(0, (g.deadline - Date.now()) / 1000), answered: g.answers.has(p.id), choice: g.answers.get(p.id)?.choice });
  } else if (g.state === 'reveal' && p.last) safeSend(p.conn, revealPayload(p));
  else if (g.state === 'final') safeSend(p.conn, finalPayload(p));
}

function questionPayload(i) {
  const q = game.quiz.questions[i];
  return { t: 'question', index: i, num: qNumber(game.quiz, i), total: realCount(game.quiz), text: q.text, image: q.image, options: q.options, time: q.time, points: q.points };
}

function startQuestion(i) {
  const g = game, q = g.quiz.questions[i];
  if (isTitle(q)) return startTitle(i);
  g.qIndex = i; g.state = 'question'; g.answers = new Map();
  g.qStart = Date.now(); g.deadline = g.qStart + q.time * 1000;
  g.players.forEach(p => { p.prevRank = p.rank; p.last = null; });
  broadcast(questionPayload(i));
  go('hostQuestion');
  clearInterval(g.timer);
  g.timer = setInterval(hostTick, 200);
}

function titlePayload(i, remaining) {
  const q = game.quiz.questions[i];
  return { t: 'title', text: q.text, subtitle: q.subtitle || '', time: q.time, remaining };
}

function startTitle(i) {
  const g = game, q = g.quiz.questions[i];
  g.qIndex = i; g.state = 'title'; g.deadline = Date.now() + q.time * 1000;
  clearInterval(g.timer); clearTimeout(g.timer);
  broadcast(titlePayload(i, q.time));
  go('hostTitle');
  g.timer = setTimeout(() => { if (game === g && g.state === 'title') nextStep(); }, q.time * 1000);
}

function hostTick() {
  const g = game; if (!g || g.state !== 'question') return;
  const q = g.quiz.questions[g.qIndex];
  const left = Math.max(0, g.deadline - Date.now());
  const n = $('#tnum'), f = $('#tfill');
  if (n) n.textContent = Math.ceil(left / 1000);
  if (f) f.style.width = (left / (q.time * 1000) * 100) + '%';
  if (Date.now() > g.deadline + 700) endQuestion();   // 700 ms de cortesía por latencia
}

function registerAnswer(p, qIndex, choice) {
  const g = game;
  if (!g || g.state !== 'question' || qIndex !== g.qIndex || g.answers.has(p.id)) return;
  const q = g.quiz.questions[g.qIndex];
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;
  const now = Date.now();
  if (now > g.deadline + 700) return;
  g.answers.set(p.id, { choice, ms: clamp(now - g.qStart, 0, q.time * 1000) });
  refreshHostLive();
  maybeCloseQuestion();
}

function maybeCloseQuestion() {
  const g = game;
  if (g.state !== 'question') return;
  const waiting = connectedHumans().filter(p => !g.answers.has(p.id));
  if (!waiting.length) endQuestion();
}

function refreshHostLive() {
  if (!game) return;
  if (ui.view === 'hostLobby') render();
  else if (ui.view === 'hostQuestion') {
    const a = $('#acount');
    if (a) a.textContent = `${game.answers.size} / ${connectedHumans().length} respuestas`;
  }
}

/** Puntuación: 500–1000 según rapidez, + bonus de racha (100 por acierto seguido, máx. 500), × multiplicador de la pregunta. */
function scoreFor(ms, q, streakAfter) {
  const mult = { standard: 1, double: 2, none: 0 }[q.points];
  const base = Math.round(1000 * (1 - (ms / (q.time * 1000)) / 2));
  const bonus = Math.min(streakAfter - 1, 5) * 100;
  return { base: base * mult, bonus: bonus * mult };
}

function ranked() {
  const list = [...game.players.values()].sort((a, b) => b.score - a.score || a.timeSum - b.timeSum || a.name.localeCompare(b.name));
  list.forEach((p, i) => { p.rank = i + 1; });
  return list;
}

function endQuestion() {
  const g = game;
  if (!g || g.state !== 'question') return;
  clearInterval(g.timer);
  g.state = 'reveal';
  const q = g.quiz.questions[g.qIndex];
  const dist = q.options.map(() => 0);
  g.players.forEach(p => {
    const a = g.answers.get(p.id);
    const res = { answered: !!a, choice: a ? a.choice : null, ok: false, gained: 0, bonus: 0 };
    p.answered++;
    if (a) {
      dist[a.choice]++;
      res.ok = a.choice === q.correct;
      if (res.ok) {
        p.correct++; p.timeSum += a.ms;
        if (q.points !== 'none') p.streak++;
        p.maxStreak = Math.max(p.maxStreak, p.streak);
        const s = scoreFor(a.ms, q, p.streak);
        res.gained = s.base + s.bonus; res.bonus = s.bonus;
        p.score += res.gained;
      } else if (q.points !== 'none') p.streak = 0;
    } else if (q.points !== 'none') p.streak = 0;
    p.last = res;
  });
  g.dist = dist;
  g.top = ranked().slice(0, 5).map(p => ({ name: p.name, score: p.score }));
  g.players.forEach(p => { if (p.conn) safeSend(p.conn, revealPayload(p)); });
  go('hostReveal');
}

const noMoreQuestions = () => !game.quiz.questions.slice(game.qIndex + 1).some(q => !isTitle(q));

function revealPayload(p) {
  const g = game;
  return { t: 'reveal', index: g.qIndex, correct: g.quiz.questions[g.qIndex].correct, ...p.last, score: p.score, streak: p.streak, rank: p.rank, prevRank: p.prevRank, players: g.players.size, top: g.top, dist: g.dist, last: noMoreQuestions() };
}

function computeAwards() {
  const list = [...game.players.values()].filter(p => p.answered > 0);
  const awards = [];
  const best = (arr, key, dir = -1) => arr.slice().sort((a, b) => dir * (key(a) - key(b)))[0];
  const streak = best(list, p => p.maxStreak);
  if (streak && streak.maxStreak >= 2) awards.push({ icon: '🔥', title: 'Racha de fuego', name: streak.name, detail: `${streak.maxStreak} aciertos seguidos` });
  const fast = best(list.filter(p => p.correct > 0), p => p.timeSum / p.correct, 1);
  if (fast) awards.push({ icon: '⚡', title: 'Rayo', name: fast.name, detail: `${(fast.timeSum / fast.correct / 1000).toFixed(1)} s de media` });
  const acc = best(list, p => p.correct / p.answered + p.score / 1e9);
  if (acc && acc.correct > 0) awards.push({ icon: '🎯', title: 'Francotirador', name: acc.name, detail: `${Math.round(acc.correct / acc.answered * 100)}% de acierto` });
  return awards;
}

function finalPayload(p) {
  const g = game;
  return { t: 'final', ranking: g.results.map(r => ({ name: r.name, score: r.score, correct: r.correct })), awards: g.awards, you: { name: p.name, rank: p.rank, score: p.score, correct: p.correct, total: realCount(g.quiz), maxStreak: p.maxStreak }, total: realCount(g.quiz) };
}

function finishGame() {
  const g = game;
  clearInterval(g.timer);
  g.state = 'final';
  g.results = ranked();
  g.awards = computeAwards();
  g.players.forEach(p => { if (p.conn) safeSend(p.conn, finalPayload(p)); });
  go('hostFinal');
}

function nextStep() {
  const g = game;
  if (g.qIndex + 1 < g.quiz.questions.length) startQuestion(g.qIndex + 1); else finishGame();
}

function hostAnswer(choice) {
  const p = game.players.get('host');
  document.querySelectorAll('.ans').forEach((b, j) => { b.classList.toggle('sel', j === choice); b.classList.toggle('dim', j !== choice); if (b.tagName === 'BUTTON') b.disabled = true; });
  if (p) registerAnswer(p, game.qIndex, choice);
}

/* ── vistas del host ── */
views.hostLobby = () => {
  const g = game, url = location.origin + location.pathname + '?join=' + g.code;
  const humans = g.players.size;
  return `
  <div class="stage">
    <h2>Únete en esta misma web con el código</h2>
    <div class="code-big">${g.code}</div>
    <div class="link">${esc(url)}</div>
    <div class="row" style="justify-content:center;margin-top:8px"><button class="btn sm sec" data-act="copy-link">📋 Copiar enlace</button></div>
    <h3 style="margin-top:20px">${g.quiz.title ? esc(g.quiz.title) : ''}</h3>
    <div class="players">${humans ? [...g.players.values()].map(p => `<span class="chip">${esc(p.name)}${p.isHost ? ' 👑' : `<button data-act="kick" data-id="${esc(p.id)}" title="Expulsar">✕</button>`}</span>`).join('') : '<span class="spinner"></span>&nbsp; Esperando jugadores…'}</div>
    <p>${humans} jugador${humans === 1 ? '' : 'es'} · ${realCount(g.quiz)} preguntas${g.hostPlays ? '' : ' · el host no participa'}</p>
    <div class="row" style="justify-content:center">
      <button class="btn big ok" data-act="start-game" ${humans ? '' : 'disabled'}>▶ Empezar</button>
      <button class="btn big ghost" style="color:#fff;border-color:rgba(255,255,255,.4)" data-act="end-game">Cancelar</button>
    </div>
  </div>`;
};

function answerButtons(q, { interactive, selected, correct }) {
  return `<div class="answers">${q.options.map((o, j) => {
    const cls = ['ans', 'c' + j];
    if (correct !== undefined) cls.push(j === correct ? 'right' : 'dim');
    else if (selected !== undefined && selected !== null) cls.push(j === selected ? 'sel' : 'dim');
    return interactive && correct === undefined && (selected === undefined || selected === null)
      ? `<button class="${cls.join(' ')}" data-act="answer" data-j="${j}"><span class="shape">${SHAPES[j]}</span>${esc(o)}</button>`
      : `<div class="${cls.join(' ')}"><span class="shape">${SHAPES[j]}</span>${esc(o)}</div>`;
  }).join('')}</div>`;
}

function titleHtml(q, skip) {
  return `<div class="stage title-screen">
    <h1 class="title-big">${esc(q.text)}</h1>
    ${q.subtitle ? `<p class="title-sub">${esc(q.subtitle)}</p>` : ''}
    <div class="tbar" style="max-width:420px;margin:28px auto 0"><div class="title-fill" style="animation-duration:${Math.max(0.1, q.remaining ?? q.time)}s"></div></div>
    ${skip ? '<div class="row" style="justify-content:center;margin-top:20px"><button class="btn sec" data-act="skip-title">Saltar ⏭</button></div>' : ''}
  </div>`;
}
views.hostTitle = () => titleHtml({ ...game.quiz.questions[game.qIndex], remaining: Math.max(0, (game.deadline - Date.now()) / 1000) }, true);
views.clientTitle = () => titleHtml(cli.title, false);

views.hostQuestion = () => {
  const g = game, q = g.quiz.questions[g.qIndex];
  const mine = g.answers.get('host');
  return `
  <div class="qbar"><span>Pregunta ${qNumber(g.quiz, g.qIndex)} / ${realCount(g.quiz)}${q.points === 'double' ? ' · ×2 puntos' : q.points === 'none' ? ' · sin puntos' : ''}</span>
    <span id="acount">${g.answers.size} / ${connectedHumans().length} respuestas</span>
    <div class="timer" id="tnum">${q.time}</div></div>
  <div class="tbar"><div id="tfill"></div></div>
  <div class="qtext">${esc(q.text)}</div>
  ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="">` : ''}
  ${answerButtons(q, { interactive: g.hostPlays, selected: mine ? mine.choice : undefined })}
  <div class="row" style="justify-content:center;margin-top:16px"><button class="btn sec" data-act="skip">Terminar pregunta ⏭</button></div>`;
};

views.hostReveal = () => {
  const g = game, q = g.quiz.questions[g.qIndex], me = g.players.get('host');
  const max = Math.max(1, ...g.dist);
  const isLast = noMoreQuestions();
  return `
  <div class="stage">
    <div class="qtext">${esc(q.text)}</div>
    <div class="dist">${g.dist.map((n, j) => `<div class="b"><span>${n}</span><i style="background:var(--c${j});height:${Math.round(n / max * 100)}%;opacity:${j === q.correct ? 1 : .45}"></i></div>`).join('')}</div>
    ${answerButtons(q, { interactive: false, correct: q.correct })}
    ${me && me.last ? `<div class="big-result ${me.last.ok ? 'good' : 'bad'}" style="margin-top:14px"><h2>${me.last.ok ? '¡Correcto! +' + me.last.gained : me.last.answered ? 'Incorrecto' : 'Sin respuesta'}</h2>${me.streak >= 2 ? `<span class="pill">🔥 Racha ×${me.streak}</span>` : ''}</div>` : ''}
    <h3 style="margin-top:20px">Clasificación</h3>
    ${boardHtml(g.top, null)}
    <div class="row" style="justify-content:center;margin-top:16px">
      <button class="btn big ok" data-act="next">${isLast ? '🏆 Ver resultados finales' : 'Siguiente ➜'}</button>
    </div>
  </div>`;
};

function boardHtml(list, meName, limit = list.length) {
  return `<div class="board">${list.slice(0, limit).map((r, i) => `<div class="r ${r.name === meName ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="sc">${r.score} pts</span></div>`).join('')}</div>`;
}

function podiumHtml(ranking) {
  const slot = (i, cls) => ranking[i] ? `<div class="slot ${cls}">${i === 0 ? '<div class="crown">👑</div>' : ''}<div class="who">${esc(ranking[i].name)}</div><div class="pts">${ranking[i].score} pts</div><div class="blk">${i + 1}</div></div>` : `<div class="slot ${cls}"></div>`;
  return `<div class="podium">${slot(1, 'p2')}${slot(0, 'p1')}${slot(2, 'p3')}</div>`;
}

function awardsHtml(awards) {
  return awards.length ? `<div class="awards">${awards.map(a => `<div class="award"><b>${a.icon} ${esc(a.title)}</b>${esc(a.name)}<br><small>${esc(a.detail)}</small></div>`).join('')}</div>` : '';
}

views.hostFinal = () => {
  const g = game;
  return `
  <div class="stage">
    <h1>🏆 ¡Fin de la partida!</h1>
    ${podiumHtml(g.results)}
    ${awardsHtml(g.awards)}
    <h3>Resultados completos</h3>
    <div class="board">${g.results.map((r, i) => `<div class="r"><span class="pos">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="muted">${r.correct}/${realCount(g.quiz)} ✔</span><span class="sc">${r.score} pts</span></div>`).join('')}</div>
    <div class="row" style="justify-content:center;margin-top:18px">
      <button class="btn sec" data-act="csv">📊 Descargar resultados (CSV)</button>
      <button class="btn big" data-act="end-game">Volver al inicio</button>
    </div>
  </div>`;
};

function resultsCsv() {
  const g = game, q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['Puesto', 'Nombre', 'Puntos', 'Aciertos', 'Preguntas', 'Racha máxima'].join(',')];
  g.results.forEach((r, i) => rows.push([i + 1, q(r.name), r.score, r.correct, realCount(g.quiz), r.maxStreak].join(',')));
  return rows.join('\n');
}

/* ───────────── CLIENTE ───────────── */
function getPlayerId(code) {
  const key = 'questionari.pid.' + code;
  try { let v = sessionStorage.getItem(key); if (!v) { v = uid() + uid(); sessionStorage.setItem(key, v); } return v; } catch { return uid() + uid(); }
}

async function joinGame(code, name) {
  const id = getPlayerId(code);
  cli = { code, name, id, peer: null, conn: null, q: null, answered: null, ended: false, closing: false, timer: null, t0: 0, lobby: [], reveal: null, final: null, retries: 0 };
  const peer = await new Promise((resolve, reject) => {
    const p = new Peer(undefined, peerOptions());
    const t = setTimeout(() => { p.destroy(); reject(new Error('No se pudo contactar con el servidor de conexión.')); }, 12000);
    p.on('open', () => { clearTimeout(t); resolve(p); });
    p.on('error', e => { clearTimeout(t); reject(e); });
  });
  cli.peer = peer;
  peer.on('disconnected', () => { try { peer.reconnect(); } catch { } });
  peer.on('error', e => { if (e.type === 'peer-unavailable' && cli) { cli.pending && cli.pending(new Error('no-game')); } });
  await connectToHost();
  $('#conn-badge').textContent = `Sala ${code}`;
}

function connectToHost() {
  return new Promise((resolve, reject) => {
    const c = cli;
    const conn = c.peer.connect(PREFIX + c.code, { reliable: true });
    c.conn = conn;
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timeout); c.pending = null; fn(v); } };
    const timeout = setTimeout(() => { try { conn.close(); } catch { } done(reject, new Error('No se encuentra la partida. Revisa el código.')); }, 12000);
    c.pending = e => done(reject, e.message === 'no-game' ? new Error('No se encuentra ninguna partida con ese código.') : e);
    conn.on('open', () => safeSend(conn, { t: 'join', id: c.id, name: c.name }));
    conn.on('data', msg => {
      if (msg.t === 'error') { done(reject, new Error(msg.msg)); return; }
      if (msg.t === 'joined') { c.name = msg.name; c.retries = 0; done(resolve); }
      onHostMessage(msg);
    });
    conn.on('close', () => onHostClosed(conn));
    conn.on('error', () => { });
  });
}

function onHostClosed(conn) {
  const c = cli;
  if (!c || c.closing || c.conn !== conn || c.ended) return;
  $('#conn-badge').textContent = 'Reconectando…';
  tryReconnect();
}

async function tryReconnect() {
  const c = cli;
  while (cli === c && !c.closing && !c.ended && c.retries < 15) {
    c.retries++;
    await sleep(2000);
    if (cli !== c || c.ended) return;
    try { await connectToHost(); $('#conn-badge').textContent = `Sala ${c.code}`; return; } catch (e) { /* reintentar */ }
  }
  if (cli === c && !c.ended) { toast('Se perdió la conexión con el host.', true); leaveGame(); go('home'); }
}

function onHostMessage(msg) {
  const c = cli; if (!c) return;
  switch (msg.t) {
    case 'joined': case 'lobby':
      if (msg.names) c.lobby = msg.names;
      if (['clientWait', 'home'].includes(ui.view) || msg.t === 'joined') go('clientWait');
      break;
    case 'question':
      c.q = msg; c.answered = msg.answered ? (msg.choice ?? -1) : null; c.reveal = null; c.t0 = performance.now();
      go('clientQuestion');
      clearInterval(c.timer);
      c.timer = setInterval(clientTick, 200);
      break;
    case 'title':
      clearInterval(c.timer); c.title = msg; go('clientTitle'); break;
    case 'reveal':
      clearInterval(c.timer); c.reveal = msg; go('clientReveal'); break;
    case 'final':
      clearInterval(c.timer); c.final = msg; c.ended = true; go('clientFinal'); break;
    case 'kicked':
      c.ended = true; toast('Has sido expulsado de la partida.', true); leaveGame(); go('home'); break;
    case 'end':
      if (!c.final) { c.ended = true; toast('El host ha cerrado la partida.', true); leaveGame(); go('home'); } break;
  }
}

function clientTick() {
  const c = cli; if (!c || !c.q) return;
  const left = Math.max(0, c.q.time * 1000 - (performance.now() - c.t0));
  const n = $('#tnum'), f = $('#tfill');
  if (n) n.textContent = Math.ceil(left / 1000);
  if (f) f.style.width = (left / (c.q.time * 1000) * 100) + '%';
}

views.clientWait = () => `
  <div class="wait"><h2>¡Estás dentro, ${esc(cli.name)}! 🎉</h2>
    <p>${cli.q ? 'Esperando…' : 'Esperando a que el host empiece la partida…'}</p>
    <div class="players">${cli.lobby.map(n => `<span class="chip">${esc(n)}</span>`).join('')}</div>
    <span class="spinner"></span></div>`;

views.clientQuestion = () => {
  const c = cli, q = c.q;
  const answered = c.answered !== null;
  return `
  <div class="qbar"><span>Pregunta ${q.num} / ${q.total}${q.points === 'double' ? ' · ×2' : q.points === 'none' ? ' · sin puntos' : ''}</span><div class="timer" id="tnum">${Math.ceil(q.time)}</div></div>
  <div class="tbar"><div id="tfill"></div></div>
  <div class="qtext">${esc(q.text)}</div>
  ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="">` : ''}
  ${answerButtons(q, { interactive: true, selected: answered ? c.answered : undefined })}
  ${answered ? '<p class="light" style="color:#fff;text-align:center;font-weight:700">Respuesta enviada ✔ Esperando al resto…</p>' : ''}`;
};

function clientAnswer(choice) {
  const c = cli;
  if (!c || !c.q || c.answered !== null) return;
  c.answered = choice;
  safeSend(c.conn, { t: 'answer', q: c.q.index, choice });
  render(); clientTick();
}

views.clientReveal = () => {
  const c = cli, r = c.reveal, q = c.q;
  const cls = r.ok ? 'good' : r.answered ? 'bad' : 'neutral';
  const moved = r.prevRank && r.prevRank !== r.rank ? (r.rank < r.prevRank ? ` ▲${r.prevRank - r.rank}` : ` ▼${r.rank - r.prevRank}`) : '';
  return `
  <div class="stage">
    <div class="big-result ${cls}">
      <h2>${r.ok ? '¡Correcto! 🎉' : r.answered ? 'Incorrecto 😬' : '¡Tiempo agotado! ⏰'}</h2>
      ${r.ok ? `<div style="font-size:1.6rem;font-weight:800;margin-top:6px">+${r.gained} puntos</div>` : ''}
      ${r.ok && r.bonus ? `<span class="pill">Bonus de racha +${r.bonus}</span>` : ''}
      ${r.streak >= 2 ? `<span class="pill">🔥 Racha ×${r.streak}</span>` : ''}
    </div>
    <div class="qtext" style="font-size:1.1rem">Respuesta correcta: <span style="color:var(--c${r.correct})">${SHAPES[r.correct]} ${esc(q.options[r.correct])}</span></div>
    <p style="font-size:1.4rem;font-weight:800">Puesto #${r.rank}${moved} de ${r.players} · ${r.score} pts</p>
    ${boardHtml(r.top, c.name)}
    <p style="margin-top:14px"><span class="spinner"></span> ${r.last ? 'Esperando los resultados finales…' : 'Esperando la siguiente pregunta…'}</p>
  </div>`;
};

views.clientFinal = () => {
  const f = cli.final, y = f.you;
  const mine = f.awards.filter(a => a.name === y.name);
  const medal = y.rank === 1 ? '🥇' : y.rank === 2 ? '🥈' : y.rank === 3 ? '🥉' : '🎖️';
  return `
  <div class="stage">
    <h1>${medal} Has quedado #${y.rank}</h1>
    <p style="font-size:1.3rem;font-weight:700">${y.score} puntos · ${y.correct}/${y.total} aciertos · racha máx. ${y.maxStreak}</p>
    ${mine.length ? `<p>${mine.map(a => `<span class="pill">${a.icon} ${esc(a.title)}</span>`).join('')}</p>` : ''}
    ${podiumHtml(f.ranking)}
    ${awardsHtml(f.awards)}
    <h3>Clasificación</h3>
    ${boardHtml(f.ranking, y.name, 10)}
    <div class="row" style="justify-content:center;margin-top:18px"><button class="btn big" data-act="home">Salir</button></div>
  </div>`;
};

/* ───────────── confeti ───────────── */
function launchConfetti() {
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ['#e21b3c', '#1368ce', '#ffd02f', '#26890c', '#fff', '#ff6bcb'];
  const ps = Array.from({ length: 140 }, () => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * .6, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, vy: 2 + Math.random() * 3, vx: -1.5 + Math.random() * 3, r: Math.random() * 6, vr: -.2 + Math.random() * .4, c: cols[Math.floor(Math.random() * cols.length)] }));
  const t0 = performance.now();           // el confeti arranca con la aparición del 1.º puesto
  (function frame(now) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (now - t0 > 3200 && now - t0 < 9000) {
      ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.r += p.vr; if (p.y > cv.height) p.y = -10; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); });
    }
    if (now - t0 < 9500 && (ui.view === 'hostFinal' || ui.view === 'clientFinal')) requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height);
  })(t0);
}

/* ───────────── acciones (clics) ───────────── */
const actions = {
  home() {
    if (inGame() && !(cli && cli.final) && ui.view !== 'hostFinal' && !confirm('¿Salir de la partida actual?')) return;
    leaveGame(); ui.joinError = ''; history.replaceState(null, '', location.pathname); go('home');
  },
  library() { ui.editing = null; go('library'); },
  new() { ui.editing = blankQuiz(); go('editor'); },
  edit(el) { ui.editing = JSON.parse(JSON.stringify(ui.quizzes.find(q => q.id === el.dataset.id))); go('editor'); },
  dup(el) {
    const q = JSON.parse(JSON.stringify(ui.quizzes.find(x => x.id === el.dataset.id)));
    q.id = uid(); q.title += ' (copia)'; q.questions.forEach(x => x.id = uid());
    ui.quizzes.push(q); if (store.save(ui.quizzes)) render(); else ui.quizzes.pop();
  },
  del(el) {
    const q = ui.quizzes.find(x => x.id === el.dataset.id);
    if (!confirm(`¿Eliminar "${q.title}"? Te recomendamos exportarlo antes.`)) return;
    ui.quizzes = ui.quizzes.filter(x => x !== q); store.save(ui.quizzes); render();
  },
  export(el) {
    const q = ui.quizzes.find(x => x.id === el.dataset.id);
    download(slug(q.title) + '.json', JSON.stringify(exportable(q), null, 2));
  },
  'export-all'() {
    download('questionari-todos.json', JSON.stringify(ui.quizzes.map(exportable), null, 2));
  },
  'toggle-paste'() { ui.showPaste = !ui.showPaste; render(); },
  'import-paste'() { importText($('#paste-json').value); },
  async sample() {
    try { const r = await fetch('examples/ejemplo.json'); importText(await r.text()); } catch { toast('No se pudo cargar el ejemplo.', true); }
  },
  /* editor */
  'add-q'() { ui.editing.questions.push(blankQuestion()); render(); },
  'add-sep'() { ui.editing.questions.push(blankSeparator()); render(); },
  'q-del'(el) { ui.editing.questions.splice(+el.dataset.i, 1); render(); },
  'q-dup'(el) { const i = +el.dataset.i, c = JSON.parse(JSON.stringify(ui.editing.questions[i])); c.id = uid(); ui.editing.questions.splice(i + 1, 0, c); render(); },
  'q-up'(el) { const i = +el.dataset.i, a = ui.editing.questions; [a[i - 1], a[i]] = [a[i], a[i - 1]]; render(); },
  'q-down'(el) { const i = +el.dataset.i, a = ui.editing.questions; [a[i + 1], a[i]] = [a[i], a[i + 1]]; render(); },
  'opt-add'(el) { ui.editing.questions[+el.dataset.i].options.push(''); render(); },
  'opt-del'(el) {
    const q = ui.editing.questions[+el.dataset.i], j = +el.dataset.j;
    q.options.splice(j, 1);
    if (q.correct === j) q.correct = 0; else if (q.correct > j) q.correct--;
    render();
  },
  'img-del'(el) { ui.editing.questions[+el.dataset.i].image = null; render(); },
  'img-url'(el) {
    const i = +el.dataset.i, v = document.querySelector(`[data-imgurl="${i}"]`).value.trim();
    if (!/^https?:\/\//i.test(v)) return toast('Introduce una URL que empiece por http:// o https://', true);
    ui.editing.questions[i].image = v; render();
  },
  save() {
    const err = validateEditing();
    if (err) return toast(err, true);
    const clean = compactQuiz(ui.editing);
    const idx = ui.quizzes.findIndex(q => q.id === clean.id);
    const backup = ui.quizzes.slice();
    if (idx >= 0) ui.quizzes[idx] = clean; else ui.quizzes.push(clean);
    if (!store.save(ui.quizzes)) { ui.quizzes = backup; return; }
    toast('Cuestionario guardado ✔'); ui.editing = null; go('library');
  },
  /* partida: host */
  play(el) {
    ui.setupQuizId = el.dataset.id; go('hostSetup');
    $('#host-plays').addEventListener('change', e => { $('#host-name-wrap').style.display = e.target.checked ? '' : 'none'; });
  },
  async 'start-lobby'() {
    const plays = $('#host-plays').checked, name = $('#host-name').value.trim();
    if (plays && !name) { $('#host-err').textContent = 'Escribe tu nombre de jugador.'; return; }
    const btn = $('#start-lobby'); btn.disabled = true; btn.textContent = 'Creando sala…'; $('#host-err').textContent = '';
    try {
      await createLobby(compactQuiz(ui.quizzes.find(q => q.id === ui.setupQuizId)), plays, name);
      go('hostLobby');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Crear sala';
      $('#host-err').textContent = 'No se pudo crear la sala (' + (e.type || e.message) + '). Comprueba tu conexión.';
    }
  },
  'copy-link'() {
    const url = location.origin + location.pathname + '?join=' + game.code;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Enlace copiado'), () => toast(url));
  },
  kick(el) {
    const p = game.players.get(el.dataset.id); if (!p) return;
    if (p.conn) { safeSend(p.conn, { t: 'kicked' }); setTimeout(() => { try { p.conn && p.conn.close(); } catch { } }, 200); }
    game.players.delete(p.id); broadcast({ t: 'lobby', names: lobbyNames() }); render();
  },
  'start-game'() { startQuestion(0); },
  skip() { endQuestion(); },
  'skip-title'() { clearTimeout(game.timer); nextStep(); },
  next() { nextStep(); },
  answer(el) { const j = +el.dataset.j; if (game) hostAnswer(j); else clientAnswer(j); },
  'end-game'() {
    if (game.state !== 'final' && !confirm('¿Terminar y cerrar la partida?')) return;
    leaveGame(); go('library');
  },
  csv() { download('resultados-' + game.code + '.csv', resultsCsv(), 'text/csv'); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});

/* entrada de datos del editor (sin re-render para no perder el foco) */
document.addEventListener('input', e => {
  const t = e.target, b = t.dataset.bind;
  if (!b || !ui.editing) return;
  const z = ui.editing;
  if (b === 'title' || b === 'description') return void (z[b] = t.value);
  const q = z.questions[+t.dataset.i];
  if (b === 'q.text') q.text = t.value;
  else if (b === 'q.subtitle') q.subtitle = t.value;
  else if (b === 'q.opt') q.options[+t.dataset.j] = t.value;
});
document.addEventListener('change', e => {
  const t = e.target, b = t.dataset.bind;
  if (b && ui.editing) {
    const q = ui.editing.questions[+t.dataset.i];
    if (b === 'q.correct') q.correct = +t.dataset.j;
    else if (b === 'q.time') q.time = +t.value;
    else if (b === 'q.points') q.points = t.value;
    return;
  }
  if (t.dataset.imgfile !== undefined && t.files[0]) {
    fileToDataUrl(t.files[0]).then(url => { ui.editing.questions[+t.dataset.imgfile].image = url; render(); }, err => toast(err.message, true));
  }
  if (t.id === 'import-file') {
    const files = [...t.files];
    Promise.all(files.map(f => f.text())).then(texts => texts.forEach(tx => importText(tx)), () => toast('No se pudo leer el archivo.', true));
    t.value = '';
  }
});

function importText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return toast('El archivo no es un JSON válido.', true); }
  const arr = Array.isArray(raw) ? raw : [raw];
  const added = [];
  try { arr.forEach(r => added.push(normalizeQuiz(r))); } catch (e) { return toast(e.message, true); }
  const backup = ui.quizzes.slice();
  ui.quizzes.push(...added);
  if (!store.save(ui.quizzes)) { ui.quizzes = backup; return; }
  ui.showPaste = false; toast(`Importado${added.length > 1 ? 's' : ''}: ${added.map(q => q.title).join(', ')}`);
  if (ui.view === 'library') render(); else go('library');
}

/* unirse (formulario de inicio) */
document.addEventListener('input', e => { if (e.target.id === 'join-code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
document.addEventListener('submit', async e => {
  if (e.target.dataset.form !== 'join') return;
  e.preventDefault();
  const code = $('#join-code').value.trim().toUpperCase(), name = $('#join-name').value.trim();
  const err = $('#join-err');
  if (code.length !== 5) return void (err.textContent = 'El código tiene 5 caracteres.');
  if (!name) return void (err.textContent = 'Escribe tu nombre.');
  err.textContent = ''; const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Conectando…';
  try {
    await joinGame(code, name);
  } catch (ex) {
    const msg = ex.type === 'peer-unavailable' ? 'No se encuentra ninguna partida con ese código.' : ex.message;
    leaveGame(); ui.joinError = msg; render();
    $('#join-code').value = code; $('#join-name').value = name;
  }
});

render();
