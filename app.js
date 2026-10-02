/* Questionari — juego de preguntas tipo Kahoot sin servidor propio.
 * Los cuestionarios viven en localStorage; las partidas usan WebRTC (PeerJS)
 * directamente entre el navegador del host y el de los jugadores. */
'use strict';

const $app = document.getElementById('app');
const PREFIX = 'questionari-';
const STORE_KEY = 'questionari.quizzes.v1';
const SHAPES = ['▲', '◆', '●', '■'];
const MAX_NAME = 20;
const REVEAL_SECS = 8;   // la pantalla de resultados pasa sola a la siguiente pregunta
/** Segundos de la pantalla de resultados: 8 s, más tiempo de lectura si hay explicación (máx. 30 s). */
const revealSecs = q => q.explanation ? clamp(REVEAL_SECS + Math.ceil(q.explanation.length / 18), REVEAL_SECS, 30) : REVEAL_SECS;

/* ───────────── utilidades ───────────── */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = sel => document.querySelector(sel);
const ic = (n, extra = '') => `<svg class="ic ${extra}${n === 'arrow' || n === 'back' ? ' ic-dir' : ''}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = s => (s || 'quiz').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quiz';

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
    catch { toast(t('store.full'), true); return false; }
  },
};

const blankQuestion = () => ({ id: uid(), text: '', image: null, options: ['', '', '', ''], correct: 0, time: 20, points: 'standard', explanation: '' });
const blankSeparator = () => ({ id: uid(), type: 'title', text: '', subtitle: '', time: 4 });
const isTitle = q => q.type === 'title';
const isOrder = q => q.type === 'order';
const isPoll = q => q.type === 'poll';
const shuffleArr = arr => { const r = arr.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
/** Permutación aleatoria de 0..n-1 que no sea la identidad (para que la lista a ordenar nunca salga ya resuelta). */
const shuffledPerm = n => { const id = Array.from({ length: n }, (_, i) => i); let p = shuffleArr(id); for (let k = 0; k < 8 && n > 1 && p.every((v, i) => v === i); k++) p = shuffleArr(id); return p; };
const isPerm = (arr, n) => Array.isArray(arr) && arr.length === n && new Set(arr).size === n && arr.every(v => Number.isInteger(v) && v >= 0 && v < n);
const hasAns = v => Number.isInteger(v) || Array.isArray(v);
const PU_KINDS = ['fifty', 'double', 'shield', 'skip'], PU_ICON = { fifty: 'target', double: 'zap', shield: 'shield', skip: 'skip' };
const AVATARS = ['😀', '😎', '🤓', '🦊', '🐱', '🐶', '🐼', '🦄', '🐸', '🐙', '🚀', '⚽', '🎸', '🍕', '🌈', '⭐'];
const firstGrapheme = s => { try { const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next(); return it.done ? '' : it.value.segment; } catch { return Array.from(s)[0] || ''; } };
/** Avatar = un emoji o una letra (primer grafema). Sin avatar válido se usa la inicial del nombre. */
function cleanAvatar(s, name) {
  let g = firstGrapheme(String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').trim());
  if (g.length > 16) g = '';
  return g || firstGrapheme(String(name || '?').trim()).toUpperCase() || '?';
}
const av = x => x ? `<span class="av" aria-hidden="true">${esc(x)}</span>` : '';
const savedAvatar = () => { try { return localStorage.getItem('quizsolde.avatar') || ''; } catch { return ''; } };
const saveAvatar = v => { try { localStorage.setItem('quizsolde.avatar', v); } catch { } };
const avatarPicker = (id, val) => `<label class="f" for="${id}">${t('avatar.label')}</label>
  <div class="av-pick"><input type="text" id="${id}" class="av-input" maxlength="12" autocomplete="off" value="${esc(val)}" placeholder="${esc(t('avatar.ph'))}">
  <div class="av-grid">${AVATARS.map(x => `<button type="button" class="av-opt" data-act="av-pick" data-v="${x}" data-for="${id}" aria-label="${x}">${x}</button>`).join('')}</div></div>`;
function qrSvg(text) {
  if (typeof qrcode !== 'function') return '';
  try {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), m = 2; let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    return `<svg class="qr" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  } catch { return ''; }
}
const gradable = q => !isTitle(q) && !isPoll(q);            // las encuestas y los separadores no puntúan
const maxOpts = q => isOrder(q) ? 6 : 4;
const realCount = quiz => quiz.questions.filter(q => !isTitle(q)).length;
/** Número (1..N) de la pregunta en la posición i, sin contar separadores. */
const qNumber = (quiz, i) => quiz.questions.slice(0, i + 1).filter(q => !isTitle(q)).length;
const blankQuiz = () => ({ id: uid(), title: '', description: '', questions: [blankQuestion()] });

/** Valida y normaliza un cuestionario importado. Lanza Error con mensaje legible. */
function normalizeQuiz(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.questions)) throw new Error(t('imp.nolist'));
  if (!raw.questions.length) throw new Error(t('imp.noq'));
  const questions = raw.questions.map((q, i) => {
    const n = i + 1;
    if (q && q.type === 'title') {
      if (typeof q.text !== 'string' || !q.text.trim()) throw new Error(t('imp.sep', { n }));
      return { id: uid(), type: 'title', text: q.text.trim().slice(0, 120), subtitle: String(q.subtitle || '').trim().slice(0, 200), time: clamp(Math.round(Number(q.time)) || 4, 2, 30) };
    }
    if (!q || typeof q.text !== 'string' || !q.text.trim()) throw new Error(t('imp.qtext', { n }));
    if (!Array.isArray(q.options)) throw new Error(t('imp.qopts', { n }));
    const type = q.type === 'order' ? 'order' : q.type === 'poll' ? 'poll' : 'choice';
    let options = q.options.slice(0, type === 'order' ? 6 : 4).map(o => String(o ?? ''));
    if (type !== 'choice') options = options.map(o => o.trim()).filter(Boolean);       // ordenar y encuesta: sin huecos
    if (options.filter(o => o.trim()).length < 2) throw new Error(t(type === 'order' ? 'imp.order' : 'imp.min2', { n }));
    let correct = 0;
    if (type === 'choice') {
      correct = Number.isInteger(q.correct) ? q.correct : 0;
      if (correct < 0 || correct >= options.length || !options[correct].trim()) throw new Error(t('imp.correct', { n }));
    }
    const image = typeof q.image === 'string' && /^(data:image\/|https?:\/\/)/i.test(q.image) ? q.image : null;
    const time = clamp(Math.round(Number(q.time)) || 20, 5, 120);
    const points = type === 'poll' ? 'none' : ['standard', 'double', 'none'].includes(q.points) ? q.points : 'standard';
    while (options.length < 2) options.push('');
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim().slice(0, 500) : '';
    return { id: uid(), ...(type !== 'choice' ? { type } : {}), text: q.text.trim(), image, options, correct, time, points, explanation };
  });
  if (!questions.some(q => !isTitle(q))) throw new Error(t('imp.onlysep'));
  return { id: uid(), title: String(raw.title || t('imp.default')).slice(0, 120), description: String(raw.description || '').slice(0, 500), questions };
}

function exportable(quiz) {
  return {
    format: 'questionari', version: 1, title: quiz.title, description: quiz.description,
    questions: quiz.questions.map(q => isTitle(q) ? { type: 'title', text: q.text, subtitle: q.subtitle || '', time: q.time } : ({
      ...(isOrder(q) || isPoll(q) ? { type: q.type } : {}),
      text: q.text, image: q.image || null,
      options: isOrder(q) || isPoll(q) ? q.options.filter(o => o.trim()) : q.options.filter((o, i) => o.trim() || i === q.correct),
      ...(isOrder(q) || isPoll(q) ? {} : { correct: q.correct }), time: q.time, points: isPoll(q) ? 'none' : q.points,
      ...(q.explanation ? { explanation: q.explanation } : {}),
    })),
  };
}

/** Reduce una imagen subida a un JPEG de máx. 800px para que quepa en localStorage y viaje rápido. */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error(t('img.notimg')));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('img.readfail')));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(t('img.invalid')));
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

let lastView = null, enterNext = false, revealObs = null;
function render() {
  const v = views[ui.view];
  const changed = enterNext || ui.view !== lastView;
  enterNext = false; lastView = ui.view;
  $app.innerHTML = v ? v() : '';
  $app.classList.remove('view-enter');
  if (changed) { void $app.offsetWidth; $app.classList.add('view-enter'); }
  setupReveal(changed);
  if (changed) {
    runCounters();
    updateMusic();
    if (ui.view === 'hostFinal' || ui.view === 'clientFinal') launchConfetti();
  }
}
function go(view) { ui.view = view; enterNext = true; render(); window.scrollTo(0, 0); }

/** Revelado al hacer scroll: una sola vez por elemento. */
function setupReveal(fresh) {
  const els = $app.querySelectorAll('.reveal');
  if (!els.length) return;
  if (!fresh || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  revealObs = revealObs || new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); }
  }), { threshold: 0.12 });
  els.forEach(e => revealObs.observe(e));
}

/** Contadores que suben hasta su valor (el texto ya contiene el valor final). */
function runCounters() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $app.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count, pre = el.dataset.prefix || '', suf = el.dataset.suffix || '', t0 = performance.now(), dur = 800;
    (function step(now) {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = pre + Math.round(to * e) + suf;
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  });
}

/* idioma: textos estáticos del index.html + selector */
function applyStatic() {
  const l = LANGS.find(x => x.code === LANG);
  document.documentElement.lang = l.html;
  document.documentElement.dir = l.dir || 'ltr';
  document.querySelector('meta[name=description]').setAttribute('content', t('meta.desc'));
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => el.dataset.i18nAttr.split(';').forEach(pair => {
    const [attr, key] = pair.split(':'); el.setAttribute(attr, t(key));
  }));
  buildSchemeMenu();
  const cur = LANGS.find(x => x.code === LANG);
  $('#lang-flag').innerHTML = FLAGS[LANG];
  $('#lang-name').textContent = cur.name;
  $('#lang-list').innerHTML = LANGS.map(x => `<li role="option" id="lang-opt-${x.code}" data-lang="${x.code}" lang="${x.html}" tabindex="-1" aria-selected="${x.code === LANG}">${FLAGS[x.code]}<span>${x.name}</span>${x.code === LANG ? ic('check') : ''}</li>`).join('');
  const b = $('#conn-badge');
  if (game) b.textContent = t('badge.room', { code: game.code }); else if (cli) b.textContent = t('badge.room', { code: cli.code });
}
/* selector de idioma con banderas (lista desplegable accesible) */
const langBtn = $('#lang-btn'), langList = $('#lang-list');
function langOpen(open, focusSel) {
  langList.hidden = !open;
  langBtn.setAttribute('aria-expanded', String(open));
  if (open && focusSel) (langList.querySelector('[aria-selected=true]') || langList.firstElementChild).focus();
}
function langChoose(code) {
  langOpen(false); langBtn.focus();
  if (code === LANG) return;
  setLang(code); applyStatic(); render();
}
langBtn.addEventListener('click', () => { langOpen(langList.hidden, true); if (!langList.hidden) schemeOpen(false); });
langBtn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); langOpen(true, true); } });
langList.addEventListener('click', e => { const li = e.target.closest('[data-lang]'); if (li) langChoose(li.dataset.lang); });
langList.addEventListener('keydown', e => {
  const items = [...langList.children], i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) langChoose(items[i].dataset.lang); }
  else if (e.key === 'Escape') { e.preventDefault(); langOpen(false); langBtn.focus(); }
  else if (e.key === 'Tab') langOpen(false);
});
document.addEventListener('click', e => { if (!langList.hidden && !e.target.closest('#lang')) langOpen(false); });


/** Plantilla descargable: un separador y una pregunta de ejemplo, con todos los campos, lista para editar e importar. */
function templateQuiz() {
  const sep = (SAMPLES[LANG] || SAMPLES.ca).r1;
  return {
    _help: 'questions: array of items. Types: (default) multiple choice { text, options (2-4), correct (index of the right option, 0 = first), time (5-120 s), points (standard | double | none), image (null, https://... or data:image/...), explanation (optional) } · "order": options (2-6) listed in the CORRECT order, they are shuffled when played · "poll": options (2-4), no correct answer, no points · "title" (separator): { text, subtitle, time (2-30 s) }.',
    format: 'questionari', version: 1,
    title: t('ed.title'), description: t('ed.desc'),
    questions: [
      { type: 'title', text: sep[0], subtitle: sep[1], time: 4 },
      { text: t('ed.q.ph'), image: null, options: [1, 2, 3, 4].map(n => t('ed.opt.ph', { n })), correct: 1, time: 20, points: 'standard', explanation: t('ed.expl.ph') },
      { type: 'order', text: t('type.order') + ' — ' + t('ed.q.ph'), image: null, options: [1, 2, 3].map(n => t('ed.item', { n })), time: 30, points: 'standard', explanation: t('ed.expl.ph') },
      { type: 'poll', text: t('type.poll') + ' — ' + t('ed.q.ph'), image: null, options: [1, 2, 3].map(n => t('ed.opt.ph', { n })), time: 20 },
    ],
  };
}

/* ───────────── CSV: lectura y plantilla ─────────────
 * Columnas: type,text,option1..option6,correct,time,points,image,explanation,subtitle
 *  type: (vacío = respuesta múltiple) | order | poll | title.  correct: nº de opción (1 = primera) o letra A-D.
 *  Para "order" las opciones van en el orden CORRECTO. Delimitador: coma, punto y coma o tabulador. */
const CSV_COLS = ['type', 'text', 'option1', 'option2', 'option3', 'option4', 'option5', 'option6', 'correct', 'time', 'points', 'image', 'explanation', 'subtitle'];
function parseCsv(text) {
  text = text.replace(/^\ufeff/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const count = ch => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  const delim = [',', ';', '\t'].map(d => [d, count(d)]).sort((x, y) => y[1] - x[1])[0];
  const D = delim[1] ? delim[0] : ',';
  const rows = []; let row = [], f = '', q = false;
  const endField = () => { row.push(f); f = ''; };
  const endRow = () => { endField(); if (row.some(c => c.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"' && f === '') q = true;
    else if (c === D) endField();
    else if (c === '\n') endRow();
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) endRow();
  return rows;
}
/** Convierte un CSV al mismo formato que el JSON (después pasa por normalizeQuiz). */
function csvToRaw(text, name) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error(t('imp.csv.empty'));
  const head = rows[0].map(c => c.trim().toLowerCase());
  const hasHeader = head.includes('text') && head.includes('option1');
  const idx = {}; (hasHeader ? head : CSV_COLS).forEach((c, k) => { idx[c] = k; });
  const body = hasHeader ? rows.slice(1) : rows;
  if (!body.length) throw new Error(t('imp.csv.empty'));
  const questions = body.map((r, k) => {
    const get = k2 => (idx[k2] != null ? String(r[idx[k2]] ?? '').trim() : '');
    const type = get('type').toLowerCase();
    if (['title', 'separator', 'separador'].includes(type)) return { type: 'title', text: get('text'), subtitle: get('subtitle'), time: parseInt(get('time'), 10) || 4 };
    const options = [1, 2, 3, 4, 5, 6].map(n => get('option' + n));
    while (options.length && options[options.length - 1] === '') options.pop();
    const cv = get('correct');
    let correct;
    if (/^\d+$/.test(cv)) correct = parseInt(cv, 10) - 1;
    else if (/^[a-f]$/i.test(cv)) correct = cv.toUpperCase().charCodeAt(0) - 65;
    if (correct === undefined && type !== 'order' && type !== 'poll') throw new Error(t('imp.correct', { n: k + 1 }));
    return { ...(type === 'order' || type === 'poll' ? { type } : {}), text: get('text'), options, correct, time: parseInt(get('time'), 10) || undefined, points: get('points').toLowerCase() || undefined, image: get('image') || null, explanation: get('explanation') };
  });
  return { title: name || undefined, questions };
}
/** Plantilla CSV: las mismas filas de ejemplo que la plantilla JSON. */
function csvTemplate() {
  const tq = templateQuiz();
  const lines = [CSV_COLS.join(',')];
  tq.questions.forEach(q => {
    const o = q.options || [];
    const correct = q.type === 'order' || q.type === 'poll' || q.type === 'title' ? '' : q.correct + 1;
    const cells = [q.type || '', q.text, ...[0, 1, 2, 3, 4, 5].map(k => o[k] || ''), correct, q.time ?? '', q.type === 'title' || q.type === 'poll' ? '' : (q.points || ''), q.image || '', q.explanation || '', q.subtitle || ''];
    lines.push(cells.map(csvCell).join(','));
  });
  return '\ufeff' + lines.join('\r\n');
}

/** Cuestionario de ejemplo en el idioma actual. */
function sampleQuiz() {
  const S = SAMPLES[LANG] || SAMPLES.ca;
  const E = SAMPLE_EXPL[LANG] || SAMPLE_EXPL.ca;
  const mk = ([text, options, correct], i, arr) => ({ text, image: null, options, correct, time: 20, points: i === arr.length - 1 && S.q.length > 3 ? 'double' : 'standard', explanation: E[i] || '' });
  const qs = S.q.map(mk);
  const sep = ([text, subtitle]) => ({ type: 'title', text, subtitle, time: 4 });
  return { format: 'questionari', version: 1, title: S.title, description: S.desc,
    questions: [sep(S.r1), ...qs.slice(0, 3), ...(qs[3] ? [sep(S.r2), qs[3]] : [])] };
}

/* tema claro / oscuro (auto por defecto, interruptor manual guardado) */
/** En la pantalla de preparación: el examen oculta "yo también juego" (el host solo podrá hacerlo si está solo en la sala). */
function syncSetup() {
  const exam = ($('input[name=mode]:checked') || {}).value === 'exam';
  $('#host-plays-wrap').style.display = exam ? 'none' : 'flex';
  $('#host-name-wrap').style.display = !exam && !$('#host-plays').checked ? 'none' : '';
}
document.addEventListener('change', e => { if (e.target.name === 'mode' || e.target.id === 'host-plays') syncSetup(); });

/* selector de temas: familia de colores (desplegable) + botón de modo claro/oscuro, en un mismo control */
const DEFAULT_SW = { light: ['#f6f4ff', '#6d3bf2', '#c026d3', '#1b1740'], dark: ['#0b0a1e', '#7c4dff', '#d946ef', '#f1efff'] };
const schemeBtn = $('#scheme-btn'), schemePanel = $('#scheme-panel'), schemeList = $('#scheme-list'), modeBtn = $('#mode-btn');
function buildSchemeMenu() {
  const cur = currentFamily(), mode = currentMode();
  const item = (id, label, sw) => `<li role="option" data-scheme="${id}" tabindex="-1" aria-selected="${id === cur}"><span class="sw" style="--a:${sw[0]};--b:${sw[1]};--c:${sw[2]};--d:${sw[3]}"></span><span>${esc(label)}</span>${id === cur ? ic('check') : ''}</li>`;
  schemeList.innerHTML = item('quiz', t('theme.default'), DEFAULT_SW[mode])
    + FAMILIES.map(f => item(f.id, f.id === 'contrast' ? t('theme.hc') : f.name, f.sw[mode])).join('');
  const dark = mode === 'dark';
  $('#mode-icon').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  $('#mode-label').textContent = t(dark ? 'theme.toLight' : 'theme.toDark');
}
function schemeOpen(open, focusSel) {
  schemePanel.hidden = !open; schemeBtn.setAttribute('aria-expanded', String(open));
  if (open && focusSel) (schemeList.querySelector('[aria-selected=true]') || modeBtn).focus();
}
function schemeChoose(id) { schemeOpen(false); schemeBtn.focus(); applyScheme(id); buildSchemeMenu(); }
function toggleMode() { applyScheme(currentFamily(), currentMode() === 'dark' ? 'light' : 'dark'); buildSchemeMenu(); }
schemeBtn.addEventListener('click', () => { schemeOpen(schemePanel.hidden, true); if (!schemePanel.hidden) langOpen(false); });
schemeBtn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); schemeOpen(true, true); } });
modeBtn.addEventListener('click', toggleMode);
schemeList.addEventListener('click', e => { const li = e.target.closest('[data-scheme]'); if (li) schemeChoose(li.dataset.scheme); });
schemePanel.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); schemeOpen(false); schemeBtn.focus(); return; }
  const items = [...schemeList.querySelectorAll('[role=option]')], i = items.indexOf(document.activeElement);
  if (i < 0) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); schemeChoose(items[i].dataset.scheme); }
});
schemePanel.addEventListener('focusout', e => { if (e.relatedTarget && !schemePanel.contains(e.relatedTarget) && e.relatedTarget !== schemeBtn) schemeOpen(false); });
document.addEventListener('click', e => { if (!schemePanel.hidden && !e.target.closest('#scheme')) schemeOpen(false); });
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => buildSchemeMenu());

/* música de concurso: una pista por escena; el botón de la barra la silencia */
function syncMusicIcon() {
  const m = music.isMuted(), v = Math.round(music.getVolume() * 100), r = $('#vol-range');
  $('#music-icon').setAttribute('href', m ? '#i-volume-x' : v < 50 ? '#i-volume-1' : '#i-volume');
  $('#music-toggle').setAttribute('aria-pressed', String(!m));
  r.value = v; r.style.setProperty('--pct', v + '%');
  r.setAttribute('aria-valuetext', v + '%');
}
$('#vol-range').addEventListener('input', e => { music.setVolume(e.target.value / 100); syncMusicIcon(); });
const MUSIC_SCENE = { hostLobby: 'lobby', clientWait: 'lobby', hostTitle: 'lobby', clientTitle: 'lobby', hostQuestion: 'question', clientQuestion: 'question', hostReveal: 'reveal', clientReveal: 'reveal', hostFinal: 'final', clientFinal: 'final' };
function updateMusic() {
  const scene = MUSIC_SCENE[ui.view] || 'off';
  if (scene === 'reveal') {
    const r = ui.view === 'hostReveal' ? (game && game.players.get('host') && game.players.get('host').last) : (cli && cli.reveal);
    music.sting(r ? (r.ok ? 'good' : r.answered ? 'bad' : 'neutral') : 'neutral');
    music.set('reveal', { delay: 0.9 });
  } else if (scene === 'final') {
    music.fanfare(); music.set('final', { delay: 1.8 });
  } else music.set(scene);
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => music.unlock(), { once: true, capture: true }));
window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 8), { passive: true });

const inGame = () => !!(game || cli);
function leaveGame() {
  if (game) { clearInterval(game.timer); clearTimeout(game.examTimer); try { broadcast({ t: 'end' }); } catch { } try { game.peer.destroy(); } catch { } game = null; }
  if (cli) { cli.closing = true; clearInterval(cli.timer); try { cli.peer.destroy(); } catch { } cli = null; }
  $('#conn-badge').textContent = '';
  music.set('off');
}
window.addEventListener('beforeunload', e => { if (inGame()) { e.preventDefault(); e.returnValue = ''; } });

/* ───────────── vistas: inicio y biblioteca ───────────── */
const views = {};

views.home = () => {
  const prefill = new URLSearchParams(location.search).get('join') || '';
  return `
  <section class="hero">
    <div class="hero-shapes" aria-hidden="true"><i class="s0"></i><i class="s1"></i><i class="s2"></i><i class="s3"></i></div>
    <h1>${t('home.title', { em: `<span class="grad-text">${t('home.em')}</span>` })}</h1>
    <p>${t('home.sub')}</p>
  </section>
  <div class="grid2">
    <form class="card join" data-form="join">
      <h2>${ic('gamepad')} ${t('join.title')}</h2>
      <label class="f" for="join-code">${t('join.code')}</label>
      <input type="text" id="join-code" class="code-input" maxlength="5" autocomplete="off" autocapitalize="characters" value="${esc(prefill)}" placeholder="ABCDE">
      <label class="f" for="join-name">${t('join.name')}</label>
      <input type="text" id="join-name" maxlength="${MAX_NAME}" autocomplete="off" placeholder="${esc(t('join.name.ph'))}">
      ${avatarPicker('join-avatar', savedAvatar())}
      <div class="err" id="join-err" role="alert">${esc(ui.joinError)}</div>
      <button class="btn big" type="submit" ${ui.joinBusy ? 'disabled' : ''}>${ui.joinBusy ? t('join.busy') : `${t('join.btn')} ${ic('arrow', 'ic-arrow')}`}</button>
    </form>
    <div class="card lift">
      <h2>${ic('mic')} ${t('hostcard.title')}</h2>
      <p class="muted">${t('hostcard.text')}</p>
      <ul class="feat">${[['list', 'f1'], ['gamepad', 'f2'], ['users', 'f3'], ['upload', 'f4']].map(([i, k]) => `<li><span class="feat-ic">${ic(i === 'list' ? 'check-circle' : i)}</span>${t('host.' + k)}</li>`).join('')}</ul>
      <button class="btn big" data-act="library">${t('hostcard.btn')} ${ic('arrow', 'ic-arrow')}</button>
    </div>
  </div>
  <div class="bento">
    <div class="tile t1 reveal"><div class="badge">${ic('pencil')}</div><h3>${t('tile1.t')}</h3><p>${t('tile1.d')}</p></div>
    <div class="tile t2 reveal" style="transition-delay:.08s"><div class="badge">${ic('image')}</div><h3>${t('tile2.t')}</h3><p>${t('tile2.d')}</p></div>
    <div class="tile t3 reveal" style="transition-delay:.16s"><div class="badge">${ic('file')}</div><h3>${t('tile3.t')}</h3><p>${t('tile3.d')}</p></div>
    <div class="tile t4 reveal" style="transition-delay:.24s"><div class="badge">${ic('trophy')}</div><h3>${t('tile4.t')}</h3><p>${t('tile4.d')}</p></div>
  </div>`;
};

views.library = () => `
  <div class="page-head">
    <h1>${t('lib.title')}</h1>
    <div class="row lib-actions">
      <button class="btn" data-act="new">${ic('plus')} ${t('lib.new')}</button>
      <label class="btn sec" tabindex="0">${ic('download')} ${t('lib.import')}<input type="file" id="import-file" accept=".json,.csv,application/json,text/csv" multiple hidden></label>
      <button class="btn sec" data-act="toggle-paste">${ic('clipboard')} ${t('lib.paste')}</button>
      <details class="dd" id="tpl-dd"><summary class="btn sec">${ic('file')} ${t('lib.templates')} ${ic('chevron')}</summary>
        <div class="dd-menu"><button class="btn sec" data-act="template">${ic('file')} ${t('lib.template')}</button>
        <button class="btn sec" data-act="template-csv">${ic('file')} ${t('lib.template.csv')}</button></div></details>
      ${ui.quizzes.length ? `<button class="btn sec" data-act="export-all">${ic('upload')} ${t('lib.exportall')}</button>` : ''}
    </div>
  </div>
  ${ui.showPaste ? `<div class="card"><label class="f" for="paste-json">${t('lib.pastelabel')}</label>
    <textarea id="paste-json" rows="6" placeholder='{"title": "...", "questions": [...]}'></textarea>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="import-paste">${t('lib.pastebtn')}</button><button class="btn ghost" data-act="toggle-paste">${t('common.cancel')}</button></div></div>` : ''}
  <div class="card">
    ${ui.quizzes.length ? ui.quizzes.map(q => `
      <div class="quiz-item reveal">
        <div><h3>${esc(q.title || t('lib.untitled'))}</h3>
          <span class="muted">${tn('lib.count', realCount(q))}${q.questions.some(x => x.image) ? ` · ${ic('image')} ${t('lib.images')}` : ''}${q.description ? ' · ' + esc(q.description) : ''}</span></div>
        <div class="row">
          <button class="btn ok" data-act="play" data-id="${q.id}">${ic('play')} ${t('lib.play')}</button>
          <button class="btn sec" data-act="edit" data-id="${q.id}">${ic('pencil')} ${t('lib.edit')}</button>
          <button class="btn sec" data-act="export" data-id="${q.id}">${ic('upload')} ${t('lib.export')}</button>
          <button class="btn sec" data-act="dup" data-id="${q.id}" aria-label="${esc(t('lib.dup'))}" title="${esc(t('lib.dup'))}">${ic('copy')}</button>
          <button class="btn danger" data-act="del" data-id="${q.id}" aria-label="${esc(t('lib.del'))}" title="${esc(t('lib.del'))}">${ic('trash')}</button>
        </div>
      </div>`).join('') : `
      <div class="empty">
        <div class="badge">${ic('book')}</div>
        <h3>${t('lib.empty.t')}</h3>
        <p class="muted">${t('lib.empty.p')}</p>
        <button class="btn" data-act="sample">${t('lib.sample')}</button>
      </div>`}
  </div>
  <button class="btn ghost" data-act="home">${ic('back')} ${t('common.back')}</button>`;

/* ───────────── vista: editor ───────────── */
views.editor = () => {
  const z = ui.editing;
  return `
  <div class="page-head">
    <h1>${ui.quizzes.some(q => q.id === z.id) ? t('ed.edit') : t('ed.new')}</h1>
    <div class="row"><button class="btn ok" data-act="save">${ic('save')} ${t('common.save')}</button><button class="btn sec" data-act="library">${t('common.cancel')}</button></div>
  </div>
  <div class="card">
    <label class="f" for="quiz-title">${t('ed.title')}</label><input type="text" id="quiz-title" data-bind="title" maxlength="120" value="${esc(z.title)}">
    <label class="f" for="quiz-desc">${t('ed.desc')}</label><input type="text" id="quiz-desc" data-bind="description" maxlength="500" value="${esc(z.description)}">
  </div>
  ${z.questions.map((q, i) => editorQuestion(q, i, z.questions.length, z)).join('')}
  <div class="row"><button class="btn big" data-act="add-q">${ic('plus')} ${t('ed.addq')}</button><button class="btn big sec" data-act="add-sep">${ic('heading')} ${t('ed.addsep')}</button><button class="btn big ok" data-act="save">${ic('save')} ${t('common.save')}</button></div>`;
};

const qType = q => isOrder(q) ? 'order' : isPoll(q) ? 'poll' : 'choice';
function editorQuestion(q, i, total, quiz) {
  const head = (label) => `<div class="q-head"><strong>${label}</strong>
      <div class="row">
        <button class="btn sm sec" data-act="q-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('ed.up'))}" title="${esc(t('ed.up'))}">${ic('up')}</button>
        <button class="btn sm sec" data-act="q-down" data-i="${i}" ${i === total - 1 ? 'disabled' : ''} aria-label="${esc(t('ed.down'))}" title="${esc(t('ed.down'))}">${ic('down')}</button>
        <button class="btn sm sec" data-act="q-dup" data-i="${i}" aria-label="${esc(t('lib.dup'))}" title="${esc(t('lib.dup'))}">${ic('copy')}</button>
        <button class="btn sm danger" data-act="q-del" data-i="${i}" ${total === 1 ? 'disabled' : ''} aria-label="${esc(t('lib.del'))}" title="${esc(t('lib.del'))}">${ic('trash')}</button>
      </div></div>`;
  const secs = (arr) => arr.map(v => `<option value="${v}" ${q.time === v ? 'selected' : ''}>${v} ${t('unit.s')}</option>`).join('');
  if (isTitle(q)) return `
  <div class="q-card sep-card" data-qi="${i}">
    ${head(ic('heading') + ' ' + t('ed.sep.head'))}
    <label class="f">${t('ed.title')}</label><input type="text" data-bind="q.text" data-i="${i}" maxlength="120" value="${esc(q.text)}" placeholder="${esc(t('ed.sep.ph'))}">
    <label class="f">${t('ed.sep.sub')}</label><input type="text" data-bind="q.subtitle" data-i="${i}" maxlength="200" value="${esc(q.subtitle || '')}">
    <label class="f">${t('ed.sep.dur')}</label><select data-bind="q.time" data-i="${i}">${secs([2, 3, 4, 5, 6, 8, 10, 15, 20, 30])}</select>
  </div>`;
  const qt = qType(q), typeSel = `<label class="f" for="qtype-${i}">${t('type.label')}</label><select id="qtype-${i}" data-bind="q.type" data-i="${i}">
      ${['choice', 'order', 'poll'].map(v => `<option value="${v}" ${qt === v ? 'selected' : ''}>${t('type.' + v)}</option>`).join('')}</select>`;
  const optRows = qt === 'order'
    ? q.options.map((o, j) => `
      <div class="opt-row">
        <span class="dot num">${j + 1}</span>
        <input type="text" data-bind="q.opt" data-i="${i}" data-j="${j}" value="${esc(o)}" maxlength="120" placeholder="${esc(t('ed.item', { n: j + 1 }))}">
        <button class="btn sm sec" data-act="item-up" data-i="${i}" data-j="${j}" ${j === 0 ? 'disabled' : ''} aria-label="${esc(t('ed.up'))}" title="${esc(t('ed.up'))}">${ic('up')}</button>
        <button class="btn sm sec" data-act="item-down" data-i="${i}" data-j="${j}" ${j === q.options.length - 1 ? 'disabled' : ''} aria-label="${esc(t('ed.down'))}" title="${esc(t('ed.down'))}">${ic('down')}</button>
        ${q.options.length > 2 ? `<button class="btn sm danger" data-act="opt-del" data-i="${i}" data-j="${j}" aria-label="${esc(t('ed.opt.del'))}" title="${esc(t('ed.opt.del'))}">${ic('x')}</button>` : ''}
      </div>`).join('')
    : q.options.map((o, j) => `
      <div class="opt-row">
        <span class="dot" style="background:var(--c${j})"></span>
        ${qt === 'choice' ? `<input type="radio" name="correct-${i}" data-bind="q.correct" data-i="${i}" data-j="${j}" ${q.correct === j ? 'checked' : ''} title="${esc(t('ed.opt.correct'))}" aria-label="${esc(t('ed.opt.correct'))}">` : ''}
        <input type="text" data-bind="q.opt" data-i="${i}" data-j="${j}" value="${esc(o)}" maxlength="120" placeholder="${esc(t('ed.opt.ph', { n: j + 1 }))}">
        ${q.options.length > 2 ? `<button class="btn sm danger" data-act="opt-del" data-i="${i}" data-j="${j}" aria-label="${esc(t('ed.opt.del'))}" title="${esc(t('ed.opt.del'))}">${ic('x')}</button>` : ''}
      </div>`).join('');
  return `
  <div class="q-card" data-qi="${i}">
    ${head(ic('help') + ' ' + t('ed.q', { n: qNumber(quiz, i) }))}
    ${typeSel}
    <textarea data-bind="q.text" data-i="${i}" placeholder="${esc(t('ed.q.ph'))}" maxlength="300">${esc(q.text)}</textarea>
    <label class="f">${t('ed.img')}</label>
    ${q.image ? `<img class="img-prev" src="${esc(q.image)}" alt="">
      <button class="btn sm danger" data-act="img-del" data-i="${i}">${ic('trash')} ${t('ed.img.del')}</button>` : `
      <div class="row">
        <label class="btn sm sec">${ic('image')} ${t('ed.img.up')}<input type="file" accept="image/*" data-imgfile="${i}" hidden></label>
        <input type="text" data-imgurl="${i}" placeholder="${esc(t('ed.img.url.ph'))}" style="flex:1;min-width:200px">
        <button class="btn sm" data-act="img-url" data-i="${i}">${t('ed.img.url.btn')}</button>
      </div>`}
    <label class="f">${qt === 'order' ? t('type.order') : t('ed.opts')}</label>
    ${qt === 'order' ? `<p class="hint">${t('ed.order.hint')}</p>` : qt === 'poll' ? `<p class="hint">${t('ed.poll.hint')}</p>` : ''}
    ${optRows}
    ${q.options.length < maxOpts(q) ? `<button class="btn sm sec" data-act="opt-add" data-i="${i}">${ic('plus')} ${qt === 'order' ? t('ed.item.add') : t('ed.opt.add')}</button>` : ''}
    <label class="f">${t('ed.expl')}</label>
    <textarea data-bind="q.expl" data-i="${i}" rows="2" maxlength="500" placeholder="${esc(t('ed.expl.ph'))}">${esc(q.explanation || '')}</textarea>
    <div class="opts-meta">
      <div><label class="f">${t('ed.time')}</label><select data-bind="q.time" data-i="${i}">${secs([5, 10, 15, 20, 30, 45, 60, 90, 120])}</select></div>
      ${qt === 'poll' ? '' : `<div><label class="f">${t('ed.points')}</label><select data-bind="q.points" data-i="${i}">
        <option value="standard" ${q.points === 'standard' ? 'selected' : ''}>${t('ed.pts.std')}</option>
        <option value="double" ${q.points === 'double' ? 'selected' : ''}>${t('ed.pts.dbl')}</option>
        <option value="none" ${q.points === 'none' ? 'selected' : ''}>${t('ed.pts.none')}</option></select></div>`}
    </div>
  </div>`;
}

function validateEditing() {
  const z = ui.editing;
  if (!z.title.trim()) return t('val.title');
  for (let i = 0; i < z.questions.length; i++) {
    const q = z.questions[i];
    if (isTitle(q)) { if (!q.text.trim()) return t('val.sep', { n: i + 1 }); continue; }
    const n = qNumber(z, i);
    if (!q.text.trim()) return t('val.qtext', { n });
    if (q.options.filter(o => o.trim()).length < 2) return t(isOrder(q) ? 'val.order' : 'val.opts', { n });
    if (!isOrder(q) && !isPoll(q) && !q.options[q.correct].trim()) return t('val.correct', { n });
  }
  if (!realCount(z)) return t('val.none');
  return '';
}

/** Antes de guardar o jugar: elimina opciones vacías (conservando la correcta) para que todas las opciones sean válidas. */
function compactQuiz(quiz) {
  const copy = JSON.parse(JSON.stringify(quiz));
  copy.questions.forEach(q => {
    if (isTitle(q)) { q.text = q.text.trim(); q.subtitle = (q.subtitle || '').trim(); return; }
    const keep = q.options.map((o, j) => ({ o: o.trim(), j })).filter(x => x.o);
    q.correct = isOrder(q) || isPoll(q) ? 0 : keep.findIndex(x => x.j === q.correct);
    if (isPoll(q)) q.points = 'none';
    q.options = keep.map(x => x.o);
    q.text = q.text.trim();
    q.explanation = (q.explanation || '').trim();
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
    <h2>${ic('play')} ${esc(quiz.title)}</h2>
    <p class="muted">${tn('lib.count', realCount(quiz))}</p>
    <fieldset class="mode-pick"><legend class="f">${t('mode.title')}</legend>
      <label class="mode-card"><input type="radio" name="mode" value="live" checked><span><b>${ic('gamepad')} ${t('mode.live')}</b><small>${t('mode.live.d')}</small></span></label>
      <label class="mode-card"><input type="radio" name="mode" value="exam"><span><b>${ic('clipboard')} ${t('mode.exam')}</b><small>${t('mode.exam.d')}</small></span></label>
    </fieldset>
    <label id="host-plays-wrap" style="display:flex;gap:10px;align-items:center;font-weight:600;margin:12px 0">
      <input type="checkbox" id="host-plays" style="width:20px;height:20px" checked> ${t('setup.plays')}
    </label>
    <div id="host-name-wrap"><label class="f" for="host-name">${t('setup.name')}</label>
      <input type="text" id="host-name" maxlength="${MAX_NAME}" value="Host">${avatarPicker('host-avatar', savedAvatar())}</div>
    <div class="err" id="host-err" role="alert"></div>
    <div class="row"><button class="btn big ok" data-act="start-lobby" id="start-lobby">${ic('users')} ${t('setup.create')}</button><button class="btn ghost" data-act="library">${t('common.cancel')}</button></div>
  </div>`;
};

async function createLobby(quiz, hostPlays, hostName, mode = 'live', hostAvatar = '') {
  let peer = null, code = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    code = genCode();
    try {
      peer = await new Promise((resolve, reject) => {
        const p = new Peer(PREFIX + code, peerOptions());
        const to = setTimeout(() => { p.destroy(); reject(Object.assign(new Error('timeout'), { type: 'timeout' })); }, 12000);
        p.on('open', () => { clearTimeout(to); resolve(p); });
        p.on('error', e => { clearTimeout(to); p.destroy(); reject(e); });
      });
      break;
    } catch (e) {
      if (e.type !== 'unavailable-id') throw e;
    }
  }
  if (!peer) throw new Error(t('err.lobby'));

  game = {
    peer, code, quiz, hostPlays, hostName: hostName || 'Host', hostAvatar: cleanAvatar(hostAvatar, hostName || 'Host'), puOn: new Set(PU_KINDS), act: new Map(), hostQs: null, perm: null, shuf: null, mode, solo: null, state: 'lobby', qIndex: -1, qStart: 0, deadline: 0, timer: null,
    answers: new Map(), players: new Map(), results: null,
  };
  if (hostPlays && mode === 'live') game.players.set('host', newPlayer('host', hostName || 'Host', null, true, game.hostAvatar));

  peer.on('connection', conn => {
    conn.on('data', msg => onClientMessage(conn, msg));
    conn.on('close', () => onClientClose(conn));
    conn.on('error', () => onClientClose(conn));
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch { } });
  peer.on('error', e => { console.warn('peer', e); });
  $('#conn-badge').textContent = t('badge.room', { code });
}

const newPlayer = (id, name, conn, isHost = false, avatar = '') => ({
  id, name, avatar, conn, pu: {}, isHost, connected: true, score: 0, streak: 0, maxStreak: 0, correct: 0, answered: 0, timeSum: 0, rank: 0, prevRank: 0, last: null,
});

function connectedHumans() { return [...game.players.values()].filter(p => p.isHost || p.connected); }
function broadcast(msg) { if (!game) return; game.players.forEach(p => { if (p.conn) safeSend(p.conn, msg); }); }

function lobbyList() { return [...game.players.values()].map(p => ({ name: p.name, avatar: p.avatar })); }

function onClientMessage(conn, msg) {
  if (!game || !msg || typeof msg !== 'object') return;
  if (msg.t === 'join') return handleJoin(conn, msg);
  const p = [...game.players.values()].find(x => x.conn === conn);
  if (!p) return;
  if (msg.t === 'answer') registerAnswer(p, msg.q, msg.choice, msg.order);
  else if (msg.t === 'powerup') usePowerup(p, msg.q, msg.kind);
  else if (typeof msg.t === 'string' && msg.t.startsWith('exam_')) examMsg(p, msg);
}

function handleJoin(conn, msg) {
  const id = String(msg.id || '').slice(0, 40);
  const name = String(msg.name || '').trim().slice(0, MAX_NAME);
  if (!id || !name) return safeSend(conn, { t: 'error', code: 'bad_name' });
  const existing = game.players.get(id);
  if (existing && !existing.isHost) {
    existing.conn = conn; existing.connected = true;
    safeSend(conn, { t: 'joined', name: existing.name, mode: game.mode });
    resendState(existing);
    refreshHostLive();
    return;
  }
  if (game.state !== 'lobby') return safeSend(conn, { t: 'error', code: 'started' });
  if ([...game.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return safeSend(conn, { t: 'error', code: 'name_taken' });
  if (game.players.size >= 100) return safeSend(conn, { t: 'error', code: 'full' });
  game.players.set(id, newPlayer(id, name, conn, false, cleanAvatar(msg.avatar, name)));
  safeSend(conn, { t: 'joined', name, mode: game.mode });
  broadcast({ t: 'lobby', list: lobbyList() });
  refreshHostLive();
}

function onClientClose(conn) {
  if (!game) return;
  const p = [...game.players.values()].find(x => x.conn === conn);
  if (!p) return;
  p.connected = false; p.conn = null;
  if (game.state === 'lobby') { game.players.delete(p.id); broadcast({ t: 'lobby', list: lobbyList() }); }
  refreshHostLive();
  if (game.state === 'question') maybeCloseQuestion();
}

function resendState(p) {
  const g = game;
  if (g.state === 'lobby') safeSend(p.conn, { t: 'lobby', list: lobbyList() });
  else if (g.state === 'title') safeSend(p.conn, titlePayload(g.qIndex, Math.max(0, (g.deadline - Date.now()) / 1000)));
  else if (g.state === 'question') {
    safeSend(p.conn, { ...questionPayload(g.qIndex, p), time: Math.max(0, (g.deadline - Date.now()) / 1000), answered: g.answers.has(p.id), choice: g.answers.get(p.id)?.choice, skipped: !!g.answers.get(p.id)?.skip });
  } else if (g.state === 'reveal' && p.last) safeSend(p.conn, revealPayload(p));
  else if (g.state === 'final') safeSend(p.conn, finalPayload(p));
  else if (g.state === 'exam' && p.ex) { if (p.ex.done) toPlayer(p, { t: 'exam_report', report: p.ex.report }); else examSendBegin(p); }
}

function questionPayload(i, p) {
  const g = game, q = g.quiz.questions[i];
  const o = { t: 'question', index: i, num: qNumber(g.quiz, i), total: realCount(g.quiz), type: qType(q), text: q.text, image: q.image, options: isOrder(q) ? g.shuf : q.options, time: q.time, points: q.points };
  if (p) { o.pu = p.pu || {}; const ac = g.act.get(p.id); if (ac) { o.act = ac.kinds; o.hide = ac.hide; } }
  return o;
}

function startQuestion(i) {
  const g = game, q = g.quiz.questions[i];
  if (isTitle(q)) return startTitle(i);
  g.qIndex = i; g.state = 'question'; g.answers = new Map();
  g.qStart = Date.now(); g.deadline = g.qStart + q.time * 1000;
  g.act = new Map(); g.hostQs = { ord: null, act: [], hide: [] };
  if (isOrder(q)) { g.perm = shuffledPerm(q.options.length); g.shuf = g.perm.map(k => q.options[k]); g.hostQs.ord = g.shuf.map((_, k) => k); }
  g.players.forEach(p => { p.prevRank = p.rank; p.last = null; if (p.conn) safeSend(p.conn, questionPayload(i, p)); });
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

function registerAnswer(p, qIndex, choice, order, skip) {
  const g = game;
  if (!g || g.state !== 'question' || qIndex !== g.qIndex || g.answers.has(p.id)) return;
  const q = g.quiz.questions[g.qIndex];
  const now = Date.now();
  if (now > g.deadline + 700) return;
  const ms = clamp(now - g.qStart, 0, q.time * 1000);
  let a;
  if (skip) a = { skip: true, ms };
  else if (isOrder(q)) { if (!isPerm(order, q.options.length)) return; a = { order: order.slice(), ms }; }
  else {
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;
    const ac = g.act.get(p.id);
    if (ac && ac.hide.includes(choice)) return;       // opción eliminada por el 50/50
    a = { choice, ms };
  }
  g.answers.set(p.id, a);
  refreshHostLive();
  maybeCloseQuestion();
}

/** Comodines (solo partida en directo): cada jugador tiene uno de cada tipo habilitado por el host. */
function usePowerup(p, qIndex, kind) {
  const g = game;
  if (!g || g.state !== 'question' || qIndex !== g.qIndex || g.answers.has(p.id)) return null;
  if (!g.puOn.has(kind) || !(p.pu && p.pu[kind] > 0)) return null;
  const q = g.quiz.questions[g.qIndex];
  if (isPoll(q)) return null;
  const ac = g.act.get(p.id) || { kinds: [], hide: [] };
  if (ac.kinds.includes(kind)) return null;
  if (kind === 'fifty') {
    if (isOrder(q) || q.options.length < 3) return null;
    const wrong = q.options.map((_, j) => j).filter(j => j !== q.correct);
    ac.hide = shuffleArr(wrong).slice(0, Math.min(2, wrong.length - 1));
  }
  p.pu[kind]--; ac.kinds.push(kind); g.act.set(p.id, ac);
  const res = { t: 'pu_ok', q: qIndex, kind, hide: ac.hide, act: ac.kinds, pu: p.pu };
  if (p.conn) safeSend(p.conn, res);
  if (kind === 'skip') registerAnswer(p, qIndex, null, null, true);
  return res;
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
  else if (ui.view === 'hostExam') render();
  else if (ui.view === 'hostQuestion') {
    const a = $('#acount');
    if (a) a.textContent = t('qbar.answers', { n: game.answers.size, total: connectedHumans().length });
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
  const q = g.quiz.questions[g.qIndex], type = qType(q);
  const dist = q.options.map(() => 0);
  let okCount = 0, voted = 0;
  g.players.forEach(p => {
    const a = g.answers.get(p.id), kinds = (g.act.get(p.id) || { kinds: [] }).kinds;
    const res = { answered: !!a && !a.skip, skipped: !!(a && a.skip), choice: a && a.choice !== undefined ? a.choice : null, ok: false, gained: 0, bonus: 0, used: kinds, saved: false, poll: type === 'poll' };
    const miss = () => { if (q.points === 'none') return; if (kinds.includes('shield')) res.saved = true; else p.streak = 0; };
    if (type === 'poll') { if (res.answered) { dist[a.choice]++; voted++; } }
    else if (!res.skipped) {
      p.answered++;
      if (res.answered) {
        if (type === 'order') res.ok = a.order.every((s, k) => g.perm[s] === k);
        else { dist[a.choice]++; res.ok = a.choice === q.correct; }
      }
      if (res.ok) {
        okCount++;
        p.correct++; p.timeSum += a.ms;
        if (q.points !== 'none') p.streak++;
        p.maxStreak = Math.max(p.maxStreak, p.streak);
        const s = scoreFor(a.ms, q, p.streak), mul = kinds.includes('double') ? 2 : 1;
        res.gained = (s.base + s.bonus) * mul; res.bonus = s.bonus * mul;
        p.score += res.gained;
      } else miss();
    }
    p.last = res;
  });
  g.dist = dist; g.okCount = okCount; g.voted = voted;
  g.top = ranked().slice(0, 5).map(p => ({ name: p.name, score: p.score, avatar: p.avatar }));
  const rs = revealSecs(q);
  g.revealDeadline = Date.now() + rs * 1000;
  clearTimeout(g.timer);
  g.timer = setTimeout(() => { if (game === g && g.state === 'reveal') nextStep(); }, rs * 1000);
  g.players.forEach(p => { if (p.conn) safeSend(p.conn, revealPayload(p)); });
  go('hostReveal');
}

const noMoreQuestions = () => !game.quiz.questions.slice(game.qIndex + 1).some(q => !isTitle(q));

function revealPayload(p) {
  const g = game;
  const q = g.quiz.questions[g.qIndex];
  return { t: 'reveal', index: g.qIndex, type: qType(q), correct: qType(q) === 'choice' ? q.correct : null, correctOrder: isOrder(q) ? q.options : null, okCount: g.okCount, voted: g.voted, ...p.last, score: p.score, streak: p.streak, rank: p.rank, prevRank: p.prevRank, players: g.players.size, top: g.top, dist: g.dist, last: noMoreQuestions(), explanation: q.explanation || '', wait: Math.max(0, (g.revealDeadline - Date.now()) / 1000) };
}

function computeAwards() {
  const list = [...game.players.values()].filter(p => p.answered > 0);
  const awards = [];
  const best = (arr, key, dir = -1) => arr.slice().sort((a, b) => dir * (key(a) - key(b)))[0];
  const streak = best(list, p => p.maxStreak);
  if (streak && streak.maxStreak >= 2) awards.push({ icon: 'flame', key: 'streak', name: streak.name, val: streak.maxStreak });
  const fast = best(list.filter(p => p.correct > 0), p => p.timeSum / p.correct, 1);
  if (fast) awards.push({ icon: 'zap', key: 'fast', name: fast.name, val: (fast.timeSum / fast.correct / 1000).toFixed(1) });
  const acc = best(list, p => p.correct / p.answered + p.score / 1e9);
  if (acc && acc.correct > 0) awards.push({ icon: 'target', key: 'acc', name: acc.name, val: Math.round(acc.correct / acc.answered * 100) });
  return awards;
}

function finalPayload(p) {
  const g = game;
  return { t: 'final', ranking: g.results.map(r => ({ name: r.name, avatar: r.avatar, score: r.score, correct: r.correct })), awards: g.awards, you: { name: p.name, rank: p.rank, score: p.score, correct: p.correct, total: g.quiz.questions.filter(gradable).length, maxStreak: p.maxStreak }, total: g.quiz.questions.filter(gradable).length };
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
  clearTimeout(g.timer);
  if (g.qIndex + 1 < g.quiz.questions.length) startQuestion(g.qIndex + 1); else finishGame();
}

function hostAnswer(choice) {
  const p = game.players.get('host');
  if (p) registerAnswer(p, game.qIndex, choice);
  if (game.state === 'question') render();
}
function hostPu(kind) {
  const p = game.players.get('host'), res = p && usePowerup(p, game.qIndex, kind);
  if (res) { game.hostQs.act = res.act; game.hostQs.hide = res.hide; if (game.state === 'question') render(); }
}
function hostOrderSubmit() {
  const p = game.players.get('host');
  if (p) registerAnswer(p, game.qIndex, null, game.hostQs.ord);
  if (game.state === 'question') render();
}
const moveItem = (arr, k, d) => { const j = k + d; if (j >= 0 && j < arr.length) [arr[k], arr[j]] = [arr[j], arr[k]]; };

/** Lista de elementos a ordenar (con flechas) o ya resuelta (solo lectura). */
function orderHtml(texts, arr, { prefix, locked }) {
  return `<ol class="ord">${arr.map((s, k) => `<li class="ord-item"><span class="dot num">${k + 1}</span><span class="ord-t">${esc(texts[s])}</span>${locked ? '' : `<span class="ord-btns">
    <button type="button" class="btn sm sec" data-act="${prefix}-up" data-k="${k}" ${k === 0 ? 'disabled' : ''} aria-label="${esc(t('ed.up'))}">${ic('up')}</button>
    <button type="button" class="btn sm sec" data-act="${prefix}-down" data-k="${k}" ${k === arr.length - 1 ? 'disabled' : ''} aria-label="${esc(t('ed.down'))}">${ic('down')}</button></span>`}</li>`).join('')}</ol>`;
}
const solvedHtml = texts => `<ol class="ord solved">${texts.map((x, k) => `<li class="ord-item"><span class="dot num">${k + 1}</span><span class="ord-t">${esc(x)}</span></li>`).join('')}</ol>`;

/** Botones de comodines para el jugador (o el host que juega). */
function puBar(q, pu, act, locked) {
  const kinds = PU_KINDS.filter(k => pu && k in pu && !isPoll(q) && !(k === 'fifty' && (isOrder(q) || q.options.length < 3)));
  if (!kinds.length) return '';
  return `<div class="pu-bar" role="group" aria-label="${esc(t('pu.title'))}">${kinds.map(k => {
    const on = act.includes(k);
    return `<button type="button" class="pu ${on ? 'on' : ''}" data-act="pu" data-k="${k}" ${locked || on || !(pu[k] > 0) ? 'disabled' : ''} title="${esc(t('pu.' + k + '.d'))}">${ic(PU_ICON[k])} ${t(on && (k === 'double' || k === 'shield') ? 'pu.' + k + '.on' : 'pu.' + k)}</button>`;
  }).join('')}</div>`;
}

/** Zona de respuesta en directo (cliente y host que juega). `qv` trae las opciones tal como se muestran. */
function liveAnswers(qv, qs, { answered, interactive, selected, pu }) {
  if (isOrder(qv)) {
    return `<p class="muted center-note">${t('order.hint')}</p>${orderHtml(qv.options, qs.ord, { prefix: 'ord', locked: answered || !interactive })}
    ${interactive && !answered ? `<div class="row center"><button class="btn big ok" data-act="ord-submit">${ic('check-circle')} ${t('order.confirm')}</button></div>` : ''}
    ${interactive ? puBar(qv, pu, qs.act, answered) : ''}`;
  }
  return `${answerButtons(qv, { interactive, selected: answered ? selected : undefined, hide: qs.hide })}${interactive ? puBar(qv, pu, qs.act, answered) : ''}`;
}

/* ── vistas del host ── */
views.hostLobby = () => {
  const g = game, url = location.origin + location.pathname + '?join=' + g.code;
  const humans = g.players.size;
  return `
  <div class="stage">
    <h2>${t('lobby.join')}</h2>
    <div class="code-big">${g.code}</div>
    <div class="link">${esc(url)}</div>
    <div class="row center" style="margin-top:8px"><button class="btn sm sec" data-act="copy-link">${ic('link')} ${t('lobby.copy')}</button></div>
    ${(g.qr = g.qr ?? qrSvg(url)) ? `<div class="qr-card">${g.qr}<small>${t('lobby.qr')}</small></div>` : ''}
    ${g.mode === 'exam' ? `<p style="margin-top:12px"><span class="pill-exam">${ic('clipboard')} ${t('lobby.exam')} · ${t('exam.duration', { time: fmtClock(examTotalSecs(g.quiz)) })}</span></p><p class="muted">${t('exam.random')}</p>` : `<fieldset class="pu-pick"><legend class="f">${t('pu.title')}</legend><p class="muted">${t('pu.hint')}</p>
      <div class="pu-list">${PU_KINDS.map(k => `<label class="mode-card"><input type="checkbox" data-pu="${k}" ${g.puOn.has(k) ? 'checked' : ''}><span><b>${ic(PU_ICON[k])} ${t('pu.' + k)}</b><small>${t('pu.' + k + '.d')}</small></span></label>`).join('')}</div></fieldset>`}
    <h3 style="margin-top:20px">${g.quiz.title ? esc(g.quiz.title) : ''}</h3>
    <div class="players">${humans ? [...g.players.values()].map(p => `<span class="chip">${av(p.avatar)}${esc(p.name)}${p.isHost ? ic('crown') : `<button data-act="kick" data-id="${esc(p.id)}" title="${esc(t('lobby.kick'))}" aria-label="${esc(t('lobby.kick.aria', { name: p.name }))}">${ic('x')}</button>`}</span>`).join('') : `<span class="spinner"></span>&nbsp; ${t('lobby.waiting')}`}</div>
    <p>${tn('lobby.players', humans)} · ${tn('lib.count', realCount(g.quiz))}${g.hostPlays || g.mode === 'exam' ? '' : ' · ' + t('lobby.nohost')}</p>
    ${g.mode === 'exam' && !humans ? `<p class="muted" style="max-width:520px;margin:0 auto 12px">${t('lobby.solo.hint')}</p>` : ''}
    <div class="row" style="justify-content:center">
      ${g.mode === 'exam' && !humans
        ? `<button class="btn big ok" data-act="exam-solo">${ic('clipboard')} ${t('lobby.solo')}</button>`
        : `<button class="btn big ok" data-act="start-game" ${humans ? '' : 'disabled'}>${ic('play')} ${g.mode === 'exam' ? t('lobby.start.exam') : t('lobby.start')}</button>`}
      <button class="btn big ghost" data-act="end-game">${t('common.cancel')}</button>
    </div>
  </div>`;
};

function answerButtons(q, { interactive, selected, correct, hide = [] }) {
  return `<div class="answers">${q.options.map((o, j) => {
    const cls = ['ans', 'c' + j];
    if (hide.includes(j)) return `<div class="ans c${j} dim gone" aria-hidden="true"><span class="shape">${SHAPES[j]}</span>—</div>`;
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
    ${skip ? `<div class="row center" style="margin-top:24px"><button class="btn sec" data-act="skip-title">${t('skip')} ${ic('skip')}</button></div>` : ''}
  </div>`;
}
views.hostTitle = () => titleHtml({ ...game.quiz.questions[game.qIndex], remaining: Math.max(0, (game.deadline - Date.now()) / 1000) }, true);
views.clientTitle = () => titleHtml(cli.title, false);

views.hostQuestion = () => {
  const g = game, q = g.quiz.questions[g.qIndex];
  const mine = g.answers.get('host'), me = g.players.get('host');
  const qv = { ...q, options: isOrder(q) ? g.shuf : q.options };
  return `
  <div class="qbar"><span>${t('qbar.q', { n: qNumber(g.quiz, g.qIndex), total: realCount(g.quiz) })}${q.points === 'double' ? ' · ' + t('qbar.x2') : q.points === 'none' ? ' · ' + t('qbar.none') : ''}</span>
    <span id="acount">${t('qbar.answers', { n: g.answers.size, total: connectedHumans().length })}</span>
    <div class="timer" id="tnum">${q.time}</div></div>
  <div class="tbar"><div id="tfill"></div></div>
  <div class="qtext">${esc(q.text)}</div>
  ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="">` : ''}
  ${liveAnswers(qv, g.hostQs, { answered: !!mine, interactive: g.hostPlays, selected: mine ? mine.choice : undefined, pu: me ? me.pu : null })}
  ${mine && mine.skip ? `<p class="center-note">${ic('skip')} ${t('pu.skipped')}</p>` : ''}
  <div class="row" style="justify-content:center;margin-top:16px"><button class="btn sec" data-act="skip">${t('q.end')} ${ic('skip')}</button></div>`;
};

const resHead = r => r.poll ? { cls: 'neutral', icon: r.answered ? 'check-circle' : 'clock', text: r.answered ? t('poll.thanks') : t('reveal.timeout') }
  : r.skipped ? { cls: 'neutral', icon: 'skip', text: t('pu.skipped') }
  : r.ok ? { cls: 'good', icon: 'check-circle', text: t('reveal.correct') }
  : r.answered ? { cls: 'bad', icon: 'x-circle', text: t('reveal.wrong') } : { cls: 'neutral', icon: 'clock', text: t('reveal.timeout') };
/** Distribución de votos / aciertos de una pregunta, según su tipo. */
function revealBody(qv, r, dist, correct) {
  if (qv.type === 'order' || isOrder(qv)) return `<p class="muted center-note">${t('order.correct')}</p>${solvedHtml(r.correctOrder)}<p class="center-note">${ic('check')} ${r.okCount} / ${r.players}</p>`;
  const max = Math.max(1, ...dist);
  const poll = isPoll(qv);
  return `<div class="dist">${dist.map((n, j) => `<div class="b"><span>${n}</span><i style="background:var(--c${j});height:${Math.round(n / max * 100)}%;opacity:${poll || j === correct ? 1 : .45}"></i></div>`).join('')}</div>
    ${answerButtons(qv, { interactive: false, correct: poll ? undefined : correct })}`;
}

views.hostReveal = () => {
  const g = game, q = g.quiz.questions[g.qIndex], me = g.players.get('host');
  const isLast = noMoreQuestions();
  const rv = { ...revealPayload(me || { last: {}, score: 0, streak: 0, rank: 0, prevRank: 0 }), players: g.players.size };
  const h = me && me.last ? resHead(me.last) : null;
  return `
  <div class="stage">
    <div class="qtext">${esc(q.text)}</div>
    ${isPoll(q) ? `<h3>${t('poll.results')}</h3>` : ''}
    ${revealBody(q, rv, g.dist, q.correct)}
    ${q.explanation ? `<div class="explain">${ic('lightbulb')}<div><b>${t('reveal.why')}</b><p>${esc(q.explanation)}</p></div></div>` : ''}
    ${h ? `<div class="big-result ${h.cls}" style="margin-top:14px"><h2>${ic(h.icon)} ${h.text}${me.last.ok ? ' +' + me.last.gained : ''}</h2>${me.streak >= 2 ? `<span class="pill">${ic('flame')} ${t('reveal.streak', { n: me.streak })}</span>` : ''}${me.last.saved ? `<span class="pill">${ic('shield')} ${t('pu.saved')}</span>` : ''}</div>` : ''}
    <h3 style="margin-top:20px">${t('reveal.board')}</h3>
    ${boardHtml(g.top, null)}
    <div class="tbar" style="max-width:420px;margin:20px auto 0" aria-hidden="true"><div class="title-fill" style="animation-duration:${Math.max(0.1, (g.revealDeadline - Date.now()) / 1000)}s"></div></div>
    <p class="muted" style="margin:6px 0 0">${isLast ? t('reveal.finalin') : t('reveal.nextin')}</p>
    <div class="row center" style="margin-top:12px">
      <button class="btn big ok" data-act="next">${isLast ? `${ic('trophy')} ${t('reveal.seefinal')}` : `${t('reveal.next')} ${ic('arrow', 'ic-arrow')}`}</button>
    </div>
  </div>`;
};

function boardHtml(list, meName, limit = list.length) {
  return `<div class="board">${list.slice(0, limit).map((r, i) => `<div class="r ${r.name === meName ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="nm">${av(r.avatar)}${esc(r.name)}</span><span class="sc">${r.score} ${t('pts.short')}</span></div>`).join('')}</div>`;
}

function podiumHtml(ranking) {
  const slot = (i, cls) => ranking[i] ? `<div class="slot ${cls}">${i === 0 ? `<div class="crown">${ic('crown')}</div>` : ''}<div class="who">${av(ranking[i].avatar)}${esc(ranking[i].name)}</div><div class="pts">${ranking[i].score} ${t('pts.short')}</div><div class="blk">${i + 1}</div></div>` : `<div class="slot ${cls}"></div>`;
  return `<div class="podium">${slot(1, 'p2')}${slot(0, 'p1')}${slot(2, 'p3')}</div>`;
}

function awardsHtml(awards) {
  return awards.length ? `<div class="awards">${awards.map(a => `<div class="award"><span class="badge">${ic(a.icon)}</span><b>${t('award.' + a.key)}</b><span>${esc(a.name)}</span><small>${t('award.' + a.key + '.d', { v: a.val })}</small></div>`).join('')}</div>` : '';
}

views.hostFinal = () => {
  const g = game;
  return `
  <div class="stage">
    <h1>${t('final.title')}</h1>
    ${podiumHtml(g.results)}
    ${awardsHtml(g.awards)}
    <h3>${t('final.all')}</h3>
    <div class="board">${g.results.map((r, i) => `<div class="r"><span class="pos">${i + 1}</span><span class="nm">${av(r.avatar)}${esc(r.name)}</span><span class="muted">${r.correct}/${g.quiz.questions.filter(gradable).length} ${ic('check')}</span><span class="sc">${r.score} ${t('pts.short')}</span></div>`).join('')}</div>
    <div class="row center" style="margin-top:24px">
      <button class="btn sec" data-act="csv">${ic('chart')} ${t('final.csv')}</button>
      <button class="btn big" data-act="end-game">${ic('back')} ${t('final.back')}</button>
    </div>
  </div>`;
};

function resultsCsv() {
  const g = game, q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['csv.rank', 'csv.name', 'csv.points', 'csv.correct', 'csv.questions', 'csv.streak'].map(k => q(t(k))).join(',')];
  g.results.forEach((r, i) => rows.push([i + 1, q(r.name), r.score, r.correct, realCount(g.quiz), r.maxStreak].join(',')));
  return rows.join('\n');
}

/* ───────────── MODO EXAMEN ─────────────
 * Cada alumno avanza a su ritmo y puede ir atrás, saltar y corregir hasta entregar. El host guarda las respuestas correctas
 * y no las envía hasta la entrega; si está solo en la sala, puede hacer el examen con la misma vista que un alumno. */
/** Duración del examen = suma de la duración de todas sus preguntas (en segundos). */
const examTotalSecs = quiz => quiz.questions.reduce((s, q) => s + (isTitle(q) ? 0 : q.time), 0);
const fmtClock = sec => { sec = Math.max(0, Math.ceil(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
/** Orden aleatorio por alumno: las preguntas se barajan dentro de cada bloque entre separadores; los separadores se quedan en su sitio. */
function examSeq(quiz) {
  const out = []; let block = [];
  const flush = () => { out.push(...shuffleArr(block)); block = []; };
  quiz.questions.forEach((q, i) => { if (isTitle(q)) { flush(); out.push(i); } else block.push(i); });
  flush();
  return out;
}
const examKinds = e => e.seq.map(oi => isTitle(game.quiz.questions[oi]) ? 't' : 'q');
const examIsOk = (e, oi, q) => { const v = e.answers[oi]; return isOrder(q) ? Array.isArray(v) && v.every((s, k) => e.perm[oi][s] === k) : gradable(q) && v === q.correct; };
const newExam = quiz => ({ seq: examSeq(quiz), perm: {}, idx: 0, answers: [], times: [], enteredAt: 0, done: false, report: null, startedAt: Date.now(), finishedAt: 0 });
const examAllDone = () => !!game && game.mode === 'exam' && game.state === 'exam' && [...game.players.values()].every(p => p.ex && p.ex.done);

/** Entrega un mensaje a un jugador; el host en solitario lo recibe en local. */
function toPlayer(p, msg) { if (p.isHost) examReceive(game.solo, msg); else safeSend(p.conn, msg); }

/** Elemento en la posición `i` de la secuencia propia del alumno. */
function examItemPayload(p, i) {
  const e = p.ex, oi = e.seq[i], q = game.quiz.questions[oi];
  if (isTitle(q)) return { t: 'exam_item', i, kind: 't', text: q.text, subtitle: q.subtitle || '' };
  let options = q.options;
  if (isOrder(q)) { e.perm[oi] = e.perm[oi] || shuffledPerm(q.options.length); options = e.perm[oi].map(k => q.options[k]); }
  const n = e.seq.slice(0, i + 1).filter(k => !isTitle(game.quiz.questions[k])).length;
  return { t: 'exam_item', i, kind: 'q', type: qType(q), n, total: realCount(game.quiz), text: q.text, image: q.image, options };
}
function examSendBegin(p) {
  const e = p.ex;
  e.enteredAt = Date.now();
  toPlayer(p, { t: 'exam_begin', total: examTotalSecs(game.quiz), remaining: Math.max(0, (game.examDeadline - Date.now()) / 1000), kinds: examKinds(e), answers: e.seq.map(oi => hasAns(e.answers[oi]) ? e.answers[oi] : null), idx: e.idx, nq: realCount(game.quiz) });
  toPlayer(p, examItemPayload(p, e.idx));
}
function startExam() {
  const g = game;
  g.state = 'exam';
  const secs = examTotalSecs(g.quiz);
  g.examDeadline = Date.now() + secs * 1000;
  clearTimeout(g.examTimer);
  g.examTimer = setTimeout(() => { if (game === g && g.state === 'exam') g.players.forEach(p => finishExamFor(p, 'time')); }, secs * 1000);
  g.players.forEach(p => { p.ex = newExam(g.quiz); if (p.isHost || p.conn) examSendBegin(p); });
  if (!g.solo) go('hostExam');
}
/** El host, solo en la sala, hace el examen con la vista de un alumno. */
function examSolo() {
  const g = game;
  if (g.players.size) return;
  g.hostPlays = true;
  g.players.set('host', newPlayer('host', g.hostName, null, true, g.hostAvatar));
  g.solo = { kinds: [], answers: [], items: {}, idx: 0, nq: 0, report: null };
  startExam();
}
function examLeaveItem(e) {
  if (e.enteredAt) { const oi = e.seq[e.idx]; e.times[oi] = (e.times[oi] || 0) + Date.now() - e.enteredAt; e.enteredAt = 0; }
}
/** Mensajes de un alumno (por red) o del host en solitario (en local). */
function examMsg(p, msg) {
  const g = game, e = p.ex;
  if (!g || g.state !== 'exam' || !e || e.done) return;
  const items = g.quiz.questions;
  if (msg.t === 'exam_answer') {
    const oi = e.seq[msg.i], q = items[oi];
    if (!q || isTitle(q)) return;
    if (isOrder(q)) { if (isPerm(msg.order, q.options.length)) e.answers[oi] = msg.order.slice(); }
    else if (msg.choice === null || (Number.isInteger(msg.choice) && msg.choice >= 0 && msg.choice < q.options.length)) e.answers[oi] = msg.choice;
    refreshHostLive();
  } else if (msg.t === 'exam_goto') {
    if (!Number.isInteger(msg.i) || msg.i < 0 || msg.i >= e.seq.length) return;
    examLeaveItem(e); e.idx = msg.i; e.enteredAt = Date.now();
    if (msg.need) toPlayer(p, examItemPayload(p, msg.i));
    refreshHostLive();
  } else if (msg.t === 'exam_submit') {
    finishExamFor(p);
  }
}
function buildReport(p) {
  const g = game, e = p.ex, rows = [];
  let correct = 0, wrong = 0, blank = 0, totalMs = 0, pos = 0;
  e.seq.forEach(oi => {
    const q = g.quiz.questions[oi];
    if (isTitle(q)) return;
    pos++;
    const v = e.answers[oi], has = hasAns(v), ms = e.times[oi] || 0;
    totalMs += ms;
    let yours = '', right = '', status;
    if (isOrder(q)) {
      right = q.options.join(' > ');
      if (has) yours = v.map(s => q.options[e.perm[oi][s]]).join(' > ');
    } else if (isPoll(q)) { if (has) yours = q.options[v]; }
    else { if (has) yours = q.options[v]; right = q.options[q.correct]; }
    if (isPoll(q)) status = 'poll';
    else if (!has) { blank++; status = 'blank'; }
    else if (examIsOk(e, oi, q)) { correct++; status = 'ok'; } else { wrong++; status = 'bad'; }
    rows.push({ n: pos, orig: qNumber(g.quiz, oi), text: q.text, yours, right, status, explanation: q.explanation || '', ms });
  });
  const total = correct + wrong + blank;
  return { name: p.name, total, correct, wrong, blank, pct: total ? Math.round(correct / total * 100) : 0, grade: total ? +(correct / total * 10).toFixed(1) : 0, totalMs, avgMs: Math.round(totalMs / (rows.length || 1)), rows };
}
function finishExamFor(p, reason) {
  const e = p.ex;
  if (!e || e.done) return;
  examLeaveItem(e);
  e.done = true; e.finishedAt = Date.now(); e.report = buildReport(p);
  if (p.isHost || p.conn) toPlayer(p, { t: 'exam_report', report: e.report, reason });
  refreshHostLive();
}

/* ── lado alumno (red o host en solitario) ── */
const exState = () => cli ? cli.exam : game.solo;
function exSend(msg) { if (cli) safeSend(cli.conn, msg); else examMsg(game.players.get('host'), msg); }
function examReceive(st, msg) {
  if (msg.t === 'exam_begin') { st.deadline = performance.now() + msg.remaining * 1000; st.total = msg.total; st.kinds = msg.kinds; st.answers = msg.answers; st.idx = msg.idx; st.nq = msg.nq; st.items = {}; st.report = null; }
  else if (msg.t === 'exam_item') { st.items[msg.i] = msg; st.idx = msg.i; go('clientExam'); }
  else if (msg.t === 'exam_report') { st.report = msg.report; if (msg.reason === 'time') toast(t('exam.timeup')); go('clientReport'); }
}
function examPick(j) {
  const st = exState(), i = st.idx;
  if (!st || st.report || st.kinds[i] !== 'q') return;
  st.answers[i] = st.answers[i] === j ? null : j;
  exSend({ t: 'exam_answer', i, choice: st.answers[i] });
  render();
}
const examOrd = (st, it) => Array.isArray(st.answers[st.idx]) ? st.answers[st.idx] : it.options.map((_, k) => k);
function examMove(k, d) {
  const st = exState(), it = st.items[st.idx];
  if (!st || st.report || !it) return;
  const arr = examOrd(st, it).slice(); moveItem(arr, k, d);
  st.answers[st.idx] = arr; exSend({ t: 'exam_answer', i: st.idx, order: arr }); render();
}
function examOrderOk() {
  const st = exState(), it = st.items[st.idx];
  if (!st || st.report || !it) return;
  const arr = examOrd(st, it).slice();
  st.answers[st.idx] = arr; exSend({ t: 'exam_answer', i: st.idx, order: arr }); render();
}
function examNavigate(i) {
  const st = exState();
  if (!st || st.report || !Number.isInteger(i) || i < 0 || i >= st.kinds.length) return;
  const cached = !!st.items[i];
  exSend({ t: 'exam_goto', i, need: !cached });
  if (cached) { st.idx = i; go('clientExam'); }
}
const examBlanks = st => st.kinds.reduce((n, k, i) => n + (k === 'q' && !hasAns(st.answers[i]) ? 1 : 0), 0);
function examSubmit() {
  const st = exState(), blanks = examBlanks(st);
  if (blanks && !confirm(t('exam.submit.confirm', { n: blanks }))) return;
  exSend({ t: 'exam_submit' });
}

/** Cuenta atrás del examen (alumno y panel del host). */
function examClock() {
  const x = $('#xt');
  if (x && ui.view === 'clientExam') {
    const st = exState(), left = st && st.deadline ? (st.deadline - performance.now()) / 1000 : 0;
    x.querySelector('span').textContent = fmtClock(left);
    x.classList.toggle('urgent', left <= 60);
  }
  const hl = $('#xtl');
  if (hl && game && game.examDeadline) hl.textContent = fmtClock((game.examDeadline - Date.now()) / 1000);
}
setInterval(examClock, 500);

function examTop(st) {
  const answered = st.kinds.reduce((n, k, i) => n + (k === 'q' && hasAns(st.answers[i]) ? 1 : 0), 0);
  const left = st.deadline ? (st.deadline - performance.now()) / 1000 : 0;
  return `<div class="exam-top"><span class="chip-info">${t('exam.answered', { n: answered, total: st.nq })}</span>
    <span class="chip-info xtimer ${left <= 60 ? 'urgent' : ''}" id="xt" title="${esc(t('exam.left'))}">${ic('clock')}<span>${fmtClock(left)}</span></span></div>`;
}

function examNav(st) {
  const last = st.kinds.length - 1;
  let qn = 0;
  const chips = st.kinds.map((k, i) => k === 'q' ? (qn++, `<button class="qchip ${hasAns(st.answers[i]) ? 'done' : ''} ${i === st.idx ? 'cur' : ''}" data-act="exam-go" data-i="${i}" aria-label="${esc(t('exam.jump', { n: qn }))}" ${i === st.idx ? 'aria-current="true"' : ''}>${qn}</button>`) : '').join('');
  return `
  <div class="exam-nav">
    <div class="qchips">${chips}</div>
    <div class="row between exam-btns">
      <button class="btn sec" data-act="exam-prev" ${st.idx === 0 ? 'disabled' : ''}>${ic('back')} ${t('exam.prev')}</button>
      <button class="btn sec" data-act="exam-next" ${st.idx === last ? 'disabled' : ''}>${t('exam.next')} ${ic('arrow', 'ic-arrow')}</button>
    </div>
    <div class="row center"><button class="btn big ok" data-act="exam-submit">${ic('check-circle')} ${t('exam.last')}</button></div>
  </div>`;
}

views.clientExam = () => {
  const st = exState(), it = st.items[st.idx];
  if (!it) return `<div class="wait"><span class="spinner"></span></div>`;
  if (it.kind === 't') return `${examTop(st)}<div class="stage title-screen" style="padding-block:clamp(24px,8vh,80px)"><h1 class="title-big">${esc(it.text)}</h1>${it.subtitle ? `<p class="title-sub">${esc(it.subtitle)}</p>` : ''}</div>${examNav(st)}`;
  const sel = st.answers[st.idx];
  const order = it.type === 'order', arr = order ? examOrd(st, it) : null;
  return `
  ${examTop(st)}
  <div class="qbar"><span>${t('qbar.q', { n: it.n, total: it.total })}${it.type === 'poll' ? ' · ' + t('type.poll') : ''}</span></div>
  <div class="qtext">${esc(it.text)}</div>
  ${it.image ? `<img class="qimg" src="${esc(it.image)}" alt="">` : ''}
  ${order ? `<p class="muted center-note">${t('order.hint')}</p>${orderHtml(it.options, arr, { prefix: 'xord', locked: false })}<div class="row center"><button class="btn ${Array.isArray(sel) ? 'sec' : 'ok'}" data-act="xord-ok">${ic('check-circle')} ${t('order.confirm')}</button></div>` : `<div class="answers">${it.options.map((o, j) => `<button class="ans c${j} ${sel === j ? 'sel' : ''}" data-act="exam-pick" data-j="${j}" aria-pressed="${sel === j}"><span class="shape">${SHAPES[j]}</span>${esc(o)}</button>`).join('')}</div>`}
  ${examNav(st)}`;
};

const fmtMs = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} ${t('unit.s')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
views.clientReport = () => {
  const r = exState().report;
  const icon = { ok: 'check-circle', bad: 'x-circle', blank: 'help', poll: 'chart' };
  const stat = (label, val, cls = '') => `<div class="stat ${cls}"><b>${val}</b><span>${label}</span></div>`;
  return `
  <div class="stage">
    <h1 class="grad-text">${ic('clipboard')} ${t('rep.title')}</h1>
    <p class="rankline">${esc(r.name)}</p>
    <div class="stat-grid">
      ${stat(t('rep.grade'), `${r.grade} <small>/ 10</small>`, 'big')}
      ${stat(t('rep.pct'), r.pct + '%')}
      ${stat(t('rep.correct'), r.correct, 'good')}
      ${stat(t('rep.wrong'), r.wrong, 'bad')}
      ${stat(t('rep.blank'), r.blank)}
      ${stat(t('rep.time'), fmtMs(r.totalMs))}
      ${stat(t('rep.avg'), fmtMs(r.avgMs))}
    </div>
    <p class="muted" style="margin-top:12px">${t('rep.private')}</p>
    <div class="row center" style="margin:16px 0">
      <button class="btn big" data-act="exam-csv-me">${ic('chart')} ${t('rep.csv')}</button>
      <button class="btn ghost" data-act="${cli ? 'home' : 'end-game'}">${ic('back')} ${t('final.leave')}</button>
    </div>
    <h3 style="margin-top:24px">${t('rep.review')}</h3>
    <div class="review">${r.rows.map(x => `
      <details class="rev ${x.status}"><summary>${ic(icon[x.status])}<span class="rn">${x.n}.</span><span class="rt">${esc(x.text)}</span></summary>
        <dl><dt>${t('rep.yours')}</dt><dd>${x.yours ? esc(x.yours) : '—'}</dd>
        <dt>${t('rep.right')}</dt><dd>${x.right ? esc(x.right) : '—'}</dd>
        ${x.explanation ? `<dt>${t('reveal.why')}</dt><dd>${esc(x.explanation)}</dd>` : ''}</dl></details>`).join('')}</div>
  </div>`;
};

/* ── CSV: una fila por pregunta (respuesta dada, respuesta correcta y explicación) ── */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;       // evita que Excel interprete el texto como fórmula
  return `"${s.replace(/"/g, '""')}"`;
}
function downloadReportCsv(reports, withStudent) {
  if (!reports.length) return;
  const statusText = { ok: t('rep.res.ok'), bad: t('rep.res.bad'), blank: t('rep.res.blank'), poll: t('rep.res.poll') };
  const head = [...(withStudent ? ['csv.student'] : []), 'csv.qn', 'csv.orig', 'csv.question', 'csv.yours', 'csv.right', 'csv.result', 'csv.expl', 'csv.secs'].map(k => csvCell(t(k)));
  const lines = [head.join(',')];
  reports.forEach(r => r.rows.forEach(x => lines.push([...(withStudent ? [r.name] : []), x.n, x.orig, x.text, x.yours, x.right, statusText[x.status], x.explanation, (x.ms / 1000).toFixed(1)].map(csvCell).join(','))));
  const name = withStudent ? `exam-${game ? game.code : 'all'}-all.csv` : `exam-${slug(reports[0].name)}.csv`;
  download(name, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

/* ── panel del host ── */
views.hostExam = () => {
  const g = game, nq = realCount(g.quiz);
  const studs = [...g.players.values()].filter(p => !p.isHost && p.ex);
  const done = studs.filter(p => p.ex.done), all = examAllDone();
  const avg = done.length ? (done.reduce((s, p) => s + p.ex.report.grade, 0) / done.length).toFixed(1) : '—';
  const rows = studs.map(p => {
    const e = p.ex, ans = g.quiz.questions.reduce((n, q, i) => n + (!isTitle(q) && hasAns(e.answers[i]) ? 1 : 0), 0);
    const ok = g.quiz.questions.reduce((n, q, i) => n + (!isTitle(q) && examIsOk(e, i, q) ? 1 : 0), 0);
    const st = e.done ? 'done' : p.connected ? 'going' : 'off';
    return `<div class="erow"><span class="en">${av(p.avatar)}${esc(p.name)}</span>
      <span class="ep"><span class="prog"><i style="width:${Math.round(ans / nq * 100)}%"></i></span><small>${ans} / ${nq}</small></span>
      <span class="es">${e.done ? `<b>${e.report.grade}</b> <small>/ 10</small>` : `${ok}`}</span>
      <span class="est st-${st}">${t('exam.st.' + st)}</span>
      <span class="ea">${e.done ? `<button class="btn sm sec" data-act="exam-csv" data-id="${esc(p.id)}">${ic('chart')} ${t('exam.csv.one')}</button>` : ''}</span></div>`;
  }).join('');
  return `
  <div class="stage">
    <h1>${ic('clipboard')} ${t('exam.dash')}</h1>
    <h3 class="muted">${esc(g.quiz.title)}</h3>
    <div class="stat-grid" style="max-width:640px;margin:16px auto">
      <div class="stat"><b>${done.length} / ${studs.length}</b><span>${t('exam.finished')}</span></div>
      <div class="stat big"><b>${avg}</b><span>${t('exam.avg')}</span></div>
      <div class="stat"><b id="xtl">${fmtClock((g.examDeadline - Date.now()) / 1000)}</b><span>${t('exam.left')} · ${t('exam.duration', { time: fmtClock(examTotalSecs(g.quiz)) })}</span></div>
    </div>
    ${all ? `<p class="center-note">${ic('check-circle')} ${t('exam.alldone')}</p>` : ''}
    <div class="exam-table">
      <div class="erow ehead"><span>${t('exam.col.student')}</span><span>${t('exam.col.progress')}</span><span>${t('exam.col.score')}</span><span>${t('exam.col.status')}</span><span></span></div>
      ${rows}
    </div>
    <div class="row center" style="margin-top:20px">
      ${all ? '' : `<button class="btn sec" data-act="exam-finish">${ic('skip')} ${t('exam.finish')}</button>`}
      <button class="btn" data-act="exam-csv-all" ${done.length ? '' : 'disabled'}>${ic('chart')} ${t('exam.csv.all')}</button>
      <button class="btn ghost" data-act="end-game">${ic('back')} ${t('final.leave')}</button>
    </div>
  </div>`;
};

/* ───────────── CLIENTE ───────────── */
function getPlayerId(code) {
  const key = 'questionari.pid.' + code;
  try { let v = sessionStorage.getItem(key); if (!v) { v = uid() + uid(); sessionStorage.setItem(key, v); } return v; } catch { return uid() + uid(); }
}

async function joinGame(code, name, avatar = '') {
  const id = getPlayerId(code);
  cli = { code, name, avatar, id, qs: null, pu: {}, peer: null, conn: null, q: null, answered: null, ended: false, closing: false, timer: null, t0: 0, lobby: [], reveal: null, final: null, retries: 0 };
  const peer = await new Promise((resolve, reject) => {
    const p = new Peer(undefined, peerOptions());
    const to = setTimeout(() => { p.destroy(); reject(new Error(t('err.server'))); }, 12000);
    p.on('open', () => { clearTimeout(to); resolve(p); });
    p.on('error', e => { clearTimeout(to); reject(e); });
  });
  cli.peer = peer;
  peer.on('disconnected', () => { try { peer.reconnect(); } catch { } });
  peer.on('error', e => { if (e.type === 'peer-unavailable' && cli) { cli.pending && cli.pending(new Error('no-game')); } });
  await connectToHost();
  $('#conn-badge').textContent = t('badge.room', { code });
}

function connectToHost() {
  return new Promise((resolve, reject) => {
    const c = cli;
    const conn = c.peer.connect(PREFIX + c.code, { reliable: true });
    c.conn = conn;
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timeout); c.pending = null; fn(v); } };
    const timeout = setTimeout(() => { try { conn.close(); } catch { } done(reject, new Error(t('err.nogame2'))); }, 12000);
    c.pending = e => done(reject, e.message === 'no-game' ? new Error(t('err.nogame')) : e);
    conn.on('open', () => safeSend(conn, { t: 'join', id: c.id, name: c.name, avatar: c.avatar }));
    conn.on('data', msg => {
      if (msg.t === 'error') { done(reject, new Error(t('err.' + msg.code))); return; }
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
  $('#conn-badge').textContent = t('badge.reconnecting');
  tryReconnect();
}

async function tryReconnect() {
  const c = cli;
  while (cli === c && !c.closing && !c.ended && c.retries < 15) {
    c.retries++;
    await sleep(2000);
    if (cli !== c || c.ended) return;
    try { await connectToHost(); $('#conn-badge').textContent = t('badge.room', { code: c.code }); return; } catch (e) { /* reintentar */ }
  }
  if (cli === c && !c.ended) { toast(t('err.lost'), true); leaveGame(); go('home'); }
}

function onHostMessage(msg) {
  const c = cli; if (!c) return;
  switch (msg.t) {
    case 'exam_begin': case 'exam_item': case 'exam_report':
      c.mode = 'exam'; c.exam = c.exam || { kinds: [], answers: [], items: {}, idx: 0, report: null };
      examReceive(c.exam, msg);
      if (msg.t === 'exam_report') { c.ended = true; clearInterval(c.timer); }
      break;
    case 'joined': case 'lobby':
      if (msg.mode) c.mode = msg.mode;
      if (msg.list) c.lobby = msg.list;
      if (['clientWait', 'home'].includes(ui.view) || msg.t === 'joined') go('clientWait');
      break;
    case 'question':
      c.q = msg; c.answered = msg.answered ? (msg.skipped ? -2 : msg.choice ?? -1) : null; c.reveal = null; c.t0 = performance.now();
      c.qs = { ord: msg.type === 'order' ? msg.options.map((_, k) => k) : null, act: msg.act || [], hide: msg.hide || [] }; c.pu = msg.pu || {};
      go('clientQuestion');
      clearInterval(c.timer);
      c.timer = setInterval(clientTick, 200);
      break;
    case 'pu_ok':
      if (c.q && c.q.index === msg.q) { c.qs.act = msg.act; c.qs.hide = msg.hide; c.pu = msg.pu; if (msg.kind === 'skip') c.answered = -2; render(); clientTick(); }
      break;
    case 'title':
      clearInterval(c.timer); c.title = msg; go('clientTitle'); break;
    case 'reveal':
      clearInterval(c.timer); c.reveal = msg; go('clientReveal'); break;
    case 'final':
      clearInterval(c.timer); c.final = msg; c.ended = true; go('clientFinal'); break;
    case 'kicked':
      c.ended = true; toast(t('err.kicked'), true); leaveGame(); go('home'); break;
    case 'end':
      if (!c.final && !(c.exam && c.exam.report)) { c.ended = true; toast(t('err.hostclosed'), true); leaveGame(); go('home'); } break;
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
  <div class="wait"><h2>${ic('check-circle')} ${t('wait.in', { name: esc(cli.name) })}</h2>
    ${cli.mode === 'exam' ? `<p><span class="pill-exam">${ic('clipboard')} ${t('lobby.exam')}</span></p><p>${t('wait.exam')}</p><p class="muted">${t('exam.random')}</p>` : `<p>${cli.q ? t('wait.msg2') : t('wait.msg')}</p>`}
    <div class="players">${cli.lobby.map(x => `<span class="chip">${av(x.avatar)}${esc(x.name)}</span>`).join('')}</div>
    <span class="spinner"></span></div>`;

views.clientQuestion = () => {
  const c = cli, q = c.q;
  const answered = c.answered !== null;
  return `
  <div class="qbar"><span>${t('qbar.q', { n: q.num, total: q.total })}${q.points === 'double' ? ' · ' + t('qbar.x2') : q.points === 'none' ? ' · ' + t('qbar.none') : ''}</span><div class="timer" id="tnum">${Math.ceil(q.time)}</div></div>
  <div class="tbar"><div id="tfill"></div></div>
  <div class="qtext">${esc(q.text)}</div>
  ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="">` : ''}
  ${liveAnswers(q, c.qs, { answered, interactive: true, selected: c.answered, pu: c.pu })}
  ${answered ? `<p class="center-note">${c.answered === -2 ? `${ic('skip')} ${t('pu.skipped')}` : `${ic('check-circle')} ${t('q.sent')}`}</p>` : ''}`;
};

const curQs = () => game ? game.hostQs : cli.qs;
function clientPu(kind) { const c = cli; if (c && c.q && c.answered === null) safeSend(c.conn, { t: 'powerup', q: c.q.index, kind }); }
function clientOrderSubmit() {
  const c = cli;
  if (!c || !c.q || c.answered !== null) return;
  c.answered = -1;
  safeSend(c.conn, { t: 'answer', q: c.q.index, order: c.qs.ord });
  render(); clientTick();
}
function clientAnswer(choice) {
  const c = cli;
  if (!c || !c.q || c.answered !== null) return;
  c.answered = choice;
  safeSend(c.conn, { t: 'answer', q: c.q.index, choice });
  render(); clientTick();
}

views.clientReveal = () => {
  const c = cli, r = c.reveal, q = c.q;
  const h = resHead(r);
  const moved = r.prevRank && r.prevRank !== r.rank ? (r.rank < r.prevRank ? ` <span class="rank-up">${ic('up')}${r.prevRank - r.rank}</span>` : ` <span class="rank-down">${ic('down')}${r.rank - r.prevRank}</span>`) : '';
  let body;
  if (r.type === 'order') body = `<p class="muted center-note">${t('order.correct')}</p>${solvedHtml(r.correctOrder)}`;
  else if (r.type === 'poll') {
    const max = Math.max(1, ...r.dist);
    body = `<h3>${t('poll.results')}</h3><div class="dist">${r.dist.map((n, j) => `<div class="b"><span>${n}</span><i style="background:var(--c${j});height:${Math.round(n / max * 100)}%"></i></div>`).join('')}</div>${answerButtons(q, { interactive: false })}`;
  } else body = `<div class="qtext" style="font-size:1.1rem;border-top-color:var(--c${r.correct})"><span class="muted">${t('reveal.right')}</span> <span style="color:var(--c${r.correct})">${SHAPES[r.correct]} ${esc(q.options[r.correct])}</span></div>`;
  return `
  <div class="stage">
    <div class="big-result ${h.cls}">
      <h2>${ic(h.icon)} ${h.text}</h2>
      ${r.ok ? `<div class="pts-big" data-count="${r.gained}" data-prefix="+" data-suffix="${esc(t('pts.unit'))}">+${r.gained}${t('pts.unit')}</div>` : ''}
      ${r.ok && r.bonus ? `<span class="pill">${t('reveal.bonus', { n: r.bonus })}</span>` : ''}
      ${r.streak >= 2 ? `<span class="pill">${ic('flame')} ${t('reveal.streak', { n: r.streak })}</span>` : ''}
      ${r.saved ? `<span class="pill">${ic('shield')} ${t('pu.saved')}</span>` : ''}
    </div>
    ${body}
    ${r.explanation ? `<div class="explain">${ic('lightbulb')}<div><b>${t('reveal.why')}</b><p>${esc(r.explanation)}</p></div></div>` : ''}
    <p class="rankline" style="margin-top:var(--s4)">${t('reveal.rank', { r: r.rank, moved, n: r.players })} · <span data-count="${r.score}" data-suffix=" ${esc(t('pts.short'))}">${r.score} ${t('pts.short')}</span></p>
    ${boardHtml(r.top, c.name)}
    <div class="tbar" style="max-width:420px;margin:20px auto 8px" aria-hidden="true"><div class="title-fill" style="animation-duration:${Math.max(0.1, r.wait ?? 8)}s"></div></div>
    <p class="muted">${r.last ? t('reveal.finalin') : t('reveal.nextin')}</p>
  </div>`;
};

views.clientFinal = () => {
  const f = cli.final, y = f.you;
  const mine = f.awards.filter(a => a.name === y.name);
  const medal = ic(y.rank <= 3 ? 'trophy' : 'award');
  return `
  <div class="stage">
    <h1 class="grad-text">${medal} ${t('final.rank', { r: y.rank })}</h1>
    <p class="rankline">${t('final.stats', { score: y.score, c: y.correct, total: y.total, s: y.maxStreak })}</p>
    ${mine.length ? `<p>${mine.map(a => `<span class="pill" style="background:var(--grad);color:var(--on-brand)">${ic(a.icon)} ${t('award.' + a.key)}</span>`).join('')}</p>` : ''}
    ${podiumHtml(f.ranking)}
    ${awardsHtml(f.awards)}
    <h3>${t('final.board')}</h3>
    ${boardHtml(f.ranking, y.name, 10)}
    <div class="row center" style="margin-top:24px"><button class="btn big" data-act="home">${ic('back')} ${t('final.leave')}</button></div>
  </div>`;
};

/* ───────────── confeti ───────────── */
function launchConfetti() {
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim() || '#fff';
  const cols = ['--c0', '--c1', '--c2', '--c3', '--brand-hi', '--text'].map(v);
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

const closeTpl = () => { const d = $('#tpl-dd'); if (d) d.open = false; };
document.addEventListener('click', e => { if (!e.target.closest('#tpl-dd')) closeTpl(); });

/* ───────────── acciones (clics) ───────────── */
const actions = {
  music() {
    const muted = music.toggle();
    syncMusicIcon(); toast(t(muted ? 'music.off' : 'music.on'));
  },
  home() {
    if (inGame() && !(cli && cli.final) && ui.view !== 'hostFinal' && ui.view !== 'clientReport' && !confirm(t('leave.confirm'))) return;
    leaveGame(); ui.joinError = ''; history.replaceState(null, '', location.pathname); go('home');
  },
  library() { ui.editing = null; go('library'); },
  new() { ui.editing = blankQuiz(); go('editor'); },
  edit(el) { ui.editing = JSON.parse(JSON.stringify(ui.quizzes.find(q => q.id === el.dataset.id))); go('editor'); },
  dup(el) {
    const q = JSON.parse(JSON.stringify(ui.quizzes.find(x => x.id === el.dataset.id)));
    q.id = uid(); q.title += ' ' + t('copy.suffix'); q.questions.forEach(x => x.id = uid());
    ui.quizzes.push(q); if (store.save(ui.quizzes)) render(); else ui.quizzes.pop();
  },
  del(el) {
    const q = ui.quizzes.find(x => x.id === el.dataset.id);
    if (!confirm(t('del.confirm', { title: q.title }))) return;
    ui.quizzes = ui.quizzes.filter(x => x !== q); store.save(ui.quizzes); render();
  },
  export(el) {
    const q = ui.quizzes.find(x => x.id === el.dataset.id);
    download(slug(q.title) + '.json', JSON.stringify(exportable(q), null, 2));
  },
  'export-all'() {
    download('quiz-solde-cat-all.json', JSON.stringify(ui.quizzes.map(exportable), null, 2));
  },
  'toggle-paste'() { ui.showPaste = !ui.showPaste; render(); },
  'import-paste'() { importText($('#paste-json').value); },
  'template-csv'() { closeTpl(); download('quiz-template.csv', csvTemplate(), 'text/csv;charset=utf-8'); },
  template() {
    closeTpl();
    download('quiz-template.json', JSON.stringify(templateQuiz(), null, 2));
  },
  sample() {
    try { importText(JSON.stringify(sampleQuiz())); } catch { toast(t('sample.fail'), true); }
  },
  /* editor */
  'add-q'() { ui.editing.questions.push(blankQuestion()); render(); },
  'add-sep'() { ui.editing.questions.push(blankSeparator()); render(); },
  'q-del'(el) { ui.editing.questions.splice(+el.dataset.i, 1); render(); },
  'q-dup'(el) { const i = +el.dataset.i, c = JSON.parse(JSON.stringify(ui.editing.questions[i])); c.id = uid(); ui.editing.questions.splice(i + 1, 0, c); render(); },
  'q-up'(el) { const i = +el.dataset.i, a = ui.editing.questions; [a[i - 1], a[i]] = [a[i], a[i - 1]]; render(); },
  'q-down'(el) { const i = +el.dataset.i, a = ui.editing.questions; [a[i + 1], a[i]] = [a[i], a[i + 1]]; render(); },
  'opt-add'(el) { ui.editing.questions[+el.dataset.i].options.push(''); render(); },
  'item-up'(el) { const o = ui.editing.questions[+el.dataset.i].options, j = +el.dataset.j; [o[j - 1], o[j]] = [o[j], o[j - 1]]; render(); },
  'item-down'(el) { const o = ui.editing.questions[+el.dataset.i].options, j = +el.dataset.j; [o[j + 1], o[j]] = [o[j], o[j + 1]]; render(); },
  'opt-del'(el) {
    const q = ui.editing.questions[+el.dataset.i], j = +el.dataset.j;
    q.options.splice(j, 1);
    if (q.correct === j) q.correct = 0; else if (q.correct > j) q.correct--;
    render();
  },
  'img-del'(el) { ui.editing.questions[+el.dataset.i].image = null; render(); },
  'img-url'(el) {
    const i = +el.dataset.i, v = document.querySelector(`[data-imgurl="${i}"]`).value.trim();
    if (!/^https?:\/\//i.test(v)) return toast(t('img.urlerr'), true);
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
    toast(t('saved')); ui.editing = null; go('library');
  },
  /* partida: host */
  play(el) {
    ui.setupQuizId = el.dataset.id; go('hostSetup');
    syncSetup();
  },
  async 'start-lobby'() {
    const mode = $('input[name=mode]:checked').value;
    const plays = mode === 'live' && $('#host-plays').checked, name = $('#host-name').value.trim();
    if ((plays || mode === 'exam') && !name) { $('#host-err').textContent = t('setup.nameerr'); return; }
    const btn = $('#start-lobby'); btn.disabled = true; btn.textContent = t('setup.creating'); $('#host-err').textContent = '';
    try {
      const hav = $('#host-avatar').value; saveAvatar(hav.trim());
      await createLobby(compactQuiz(ui.quizzes.find(q => q.id === ui.setupQuizId)), plays, name, mode, hav);
      go('hostLobby');
    } catch (e) {
      btn.disabled = false; btn.textContent = t('setup.create');
      $('#host-err').textContent = t('setup.fail', { e: e.type || e.message });
    }
  },
  'copy-link'() {
    const url = location.origin + location.pathname + '?join=' + game.code;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast(t('lobby.copied')), () => toast(url));
  },
  kick(el) {
    const p = game.players.get(el.dataset.id); if (!p) return;
    if (p.conn) { safeSend(p.conn, { t: 'kicked' }); setTimeout(() => { try { p.conn && p.conn.close(); } catch { } }, 200); }
    game.players.delete(p.id); broadcast({ t: 'lobby', list: lobbyList() }); render();
  },
  'start-game'() {
    if (game.mode === 'exam') return startExam();
    game.players.forEach(p => { p.pu = Object.fromEntries([...game.puOn].map(k => [k, 1])); });
    startQuestion(0);
  },
  'av-pick'(el) { const i = document.getElementById(el.dataset.for); if (i) { i.value = el.dataset.v; i.focus(); } },
  pu(el) { if (game) hostPu(el.dataset.k); else clientPu(el.dataset.k); },
  'ord-up'(el) { moveItem(curQs().ord, +el.dataset.k, -1); render(); clientTick(); },
  'ord-down'(el) { moveItem(curQs().ord, +el.dataset.k, 1); render(); clientTick(); },
  'ord-submit'() { if (game) hostOrderSubmit(); else clientOrderSubmit(); },
  'xord-up'(el) { examMove(+el.dataset.k, -1); },
  'xord-down'(el) { examMove(+el.dataset.k, 1); },
  'xord-ok'() { examOrderOk(); },
  'exam-solo'() { examSolo(); },
  'exam-finish'() { if (confirm(t('exam.finish.confirm'))) game.players.forEach(p => { if (!p.isHost && p.ex && !p.ex.done) finishExamFor(p, 'host'); }); },
  'exam-csv'(el) { const p = game.players.get(el.dataset.id); if (p && p.ex && p.ex.report) downloadReportCsv([p.ex.report], false); },
  'exam-csv-all'() { downloadReportCsv([...game.players.values()].filter(p => !p.isHost && p.ex && p.ex.report).map(p => p.ex.report), true); },
  'exam-csv-me'() { const st = exState(); if (st && st.report) downloadReportCsv([st.report], false); },
  'exam-pick'(el) { examPick(+el.dataset.j); },
  'exam-go'(el) { examNavigate(+el.dataset.i); },
  'exam-prev'() { examNavigate(exState().idx - 1); },
  'exam-next'() { examNavigate(exState().idx + 1); },
  'exam-submit'() { examSubmit(); },
  skip() { endQuestion(); },
  'skip-title'() { clearTimeout(game.timer); nextStep(); },
  next() { nextStep(); },
  answer(el) { const j = +el.dataset.j; if (game) hostAnswer(j); else clientAnswer(j); },
  'end-game'() {
    if (game.state !== 'final' && !examAllDone() && !confirm(t('end.confirm'))) return;
    leaveGame(); go('library');
  },
  csv() { download('results-' + game.code + '.csv', '\ufeff' + resultsCsv(), 'text/csv;charset=utf-8'); },
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
  else if (b === 'q.expl') q.explanation = t.value;
  else if (b === 'q.opt') q.options[+t.dataset.j] = t.value;
});
document.addEventListener('change', e => {
  if (e.target.dataset.pu && game) { game.puOn[e.target.checked ? 'add' : 'delete'](e.target.dataset.pu); return; }
  const el = e.target, b = el.dataset.bind;
  if (b && ui.editing) {
    const q = ui.editing.questions[+el.dataset.i];
    if (b === 'q.type') {
      if (el.value === 'choice') delete q.type; else q.type = el.value;
      if (!isOrder(q) && q.options.length > 4) q.options = q.options.slice(0, 4);
      if (q.correct >= q.options.length) q.correct = 0;
      if (isPoll(q)) q.points = 'none'; else if (q.points === 'none' && !isOrder(q)) q.points = 'standard';
      render(); return;
    }
    if (b === 'q.correct') q.correct = +el.dataset.j;
    else if (b === 'q.time') q.time = +el.value;
    else if (b === 'q.points') q.points = el.value;
    return;
  }
  if (el.dataset.imgfile !== undefined && el.files[0]) {
    fileToDataUrl(el.files[0]).then(url => { ui.editing.questions[+el.dataset.imgfile].image = url; render(); }, err => toast(err.message, true));
  }
  if (el.id === 'import-file') {
    const files = [...el.files];
    Promise.all(files.map(f => f.text())).then(texts => texts.forEach((tx, k) => importText(tx, files[k].name.replace(/\.[^.]+$/, ''))), () => toast(t('imp.readfail'), true));
    el.value = '';
  }
});

/** Importa JSON o CSV (se detecta por el contenido). `name` (nombre del archivo sin extensión) da título a un CSV. */
function importText(text, name) {
  let arr;
  const looksJson = /^[\s\ufeff]*[\[{]/.test(text);
  try {
    if (looksJson) { let raw; try { raw = JSON.parse(text); } catch { return toast(t('imp.invalid'), true); } arr = Array.isArray(raw) ? raw : [raw]; }
    else arr = [csvToRaw(text, name)];
  } catch (e) { return toast(e.message, true); }
  const added = [];
  try { arr.forEach(r => added.push(normalizeQuiz(r))); } catch (e) { return toast(e.message, true); }
  const backup = ui.quizzes.slice();
  ui.quizzes.push(...added);
  if (!store.save(ui.quizzes)) { ui.quizzes = backup; return; }
  ui.showPaste = false; toast(t('imp.ok', { names: added.map(q => q.title).join(', ') }));
  if (ui.view === 'library') render(); else go('library');
}

/* unirse (formulario de inicio) */
document.addEventListener('input', e => { if (e.target.id === 'join-code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
document.addEventListener('submit', async e => {
  if (e.target.dataset.form !== 'join') return;
  e.preventDefault();
  const code = $('#join-code').value.trim().toUpperCase(), name = $('#join-name').value.trim(), avatar = $('#join-avatar').value.trim();
  const err = $('#join-err');
  if (code.length !== 5) return void (err.textContent = t('join.codelen'));
  if (!name) return void (err.textContent = t('join.needname'));
  err.textContent = ''; const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = t('join.busy');
  try {
    saveAvatar(avatar);
    await joinGame(code, name, avatar);
  } catch (ex) {
    const msg = ex.type === 'peer-unavailable' ? t('err.nogame') : ex.message;
    leaveGame(); ui.joinError = msg; render();
    $('#join-code').value = code; $('#join-name').value = name; $('#join-avatar').value = avatar;
  }
});

buildSchemeMenu();
syncMusicIcon();
applyStatic();
render();
