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

/* ───────────── utilidades ───────────── */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = sel => document.querySelector(sel);
const ic = (n, extra = '') => `<svg class="ic ${extra}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
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

const blankQuestion = () => ({ id: uid(), text: '', image: null, options: ['', '', '', ''], correct: 0, time: 20, points: 'standard' });
const blankSeparator = () => ({ id: uid(), type: 'title', text: '', subtitle: '', time: 4 });
const isTitle = q => q.type === 'title';
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
    const options = q.options.slice(0, 4).map(o => String(o ?? ''));
    if (options.filter(o => o.trim()).length < 2) throw new Error(t('imp.min2', { n }));
    const correct = Number.isInteger(q.correct) ? q.correct : 0;
    if (correct < 0 || correct >= options.length || !options[correct].trim()) throw new Error(t('imp.correct', { n }));
    const image = typeof q.image === 'string' && /^(data:image\/|https?:\/\/)/i.test(q.image) ? q.image : null;
    const time = clamp(Math.round(Number(q.time)) || 20, 5, 120);
    const points = ['standard', 'double', 'none'].includes(q.points) ? q.points : 'standard';
    while (options.length < 2) options.push('');
    return { id: uid(), text: q.text.trim(), image, options, correct, time, points };
  });
  if (!questions.some(q => !isTitle(q))) throw new Error(t('imp.onlysep'));
  return { id: uid(), title: String(raw.title || t('imp.default')).slice(0, 120), description: String(raw.description || '').slice(0, 500), questions };
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
  document.querySelector('meta[name=description]').setAttribute('content', t('meta.desc'));
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => el.dataset.i18nAttr.split(';').forEach(pair => {
    const [attr, key] = pair.split(':'); el.setAttribute(attr, t(key));
  }));
  const sel = $('#lang-select');
  if (!sel.options.length) sel.innerHTML = LANGS.map(x => `<option value="${x.code}" lang="${x.html}">${x.name}</option>`).join('');
  sel.value = LANG;
  const b = $('#conn-badge');
  if (game) b.textContent = t('badge.room', { code: game.code }); else if (cli) b.textContent = t('badge.room', { code: cli.code });
}
document.addEventListener('change', e => {
  if (e.target.id !== 'lang-select') return;
  setLang(e.target.value); applyStatic(); render();
});

/** Cuestionario de ejemplo en el idioma actual. */
function sampleQuiz() {
  const S = SAMPLES[LANG] || SAMPLES.ca;
  const mk = ([text, options, correct], i, arr) => ({ text, image: null, options, correct, time: 20, points: i === arr.length - 1 && S.q.length > 3 ? 'double' : 'standard' });
  const qs = S.q.map(mk);
  const sep = ([text, subtitle]) => ({ type: 'title', text, subtitle, time: 4 });
  return { format: 'questionari', version: 1, title: S.title, description: S.desc,
    questions: [sep(S.r1), ...qs.slice(0, 3), ...(qs[3] ? [sep(S.r2), qs[3]] : [])] };
}

/* tema claro / oscuro (auto por defecto, interruptor manual guardado) */
function effectiveTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function syncThemeIcon() { $('#theme-icon').setAttribute('href', effectiveTheme() === 'dark' ? '#i-sun' : '#i-moon'); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeIcon);
window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 8), { passive: true });

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
      <div class="err" id="join-err" role="alert">${esc(ui.joinError)}</div>
      <button class="btn big" type="submit" ${ui.joinBusy ? 'disabled' : ''}>${ui.joinBusy ? t('join.busy') : `${t('join.btn')} ${ic('arrow', 'ic-arrow')}`}</button>
    </form>
    <div class="card lift">
      <h2>${ic('mic')} ${t('hostcard.title')}</h2>
      <p class="muted">${t('hostcard.text')}</p>
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
    <div class="row">
      <button class="btn" data-act="new">${ic('plus')} ${t('lib.new')}</button>
      <label class="btn sec" tabindex="0">${ic('download')} ${t('lib.import')}<input type="file" id="import-file" accept=".json,application/json" multiple hidden></label>
      <button class="btn sec" data-act="toggle-paste">${ic('clipboard')} ${t('lib.paste')}</button>
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
  return `
  <div class="q-card" data-qi="${i}">
    ${head(ic('help') + ' ' + t('ed.q', { n: qNumber(quiz, i) }))}
    <textarea data-bind="q.text" data-i="${i}" placeholder="${esc(t('ed.q.ph'))}" maxlength="300">${esc(q.text)}</textarea>
    <label class="f">${t('ed.img')}</label>
    ${q.image ? `<img class="img-prev" src="${esc(q.image)}" alt="">
      <button class="btn sm danger" data-act="img-del" data-i="${i}">${ic('trash')} ${t('ed.img.del')}</button>` : `
      <div class="row">
        <label class="btn sm sec">${ic('image')} ${t('ed.img.up')}<input type="file" accept="image/*" data-imgfile="${i}" hidden></label>
        <input type="text" data-imgurl="${i}" placeholder="${esc(t('ed.img.url.ph'))}" style="flex:1;min-width:200px">
        <button class="btn sm" data-act="img-url" data-i="${i}">${t('ed.img.url.btn')}</button>
      </div>`}
    <label class="f">${t('ed.opts')}</label>
    ${q.options.map((o, j) => `
      <div class="opt-row">
        <span class="dot" style="background:var(--c${j})"></span>
        <input type="radio" name="correct-${i}" data-bind="q.correct" data-i="${i}" data-j="${j}" ${q.correct === j ? 'checked' : ''} title="${esc(t('ed.opt.correct'))}" aria-label="${esc(t('ed.opt.correct'))}">
        <input type="text" data-bind="q.opt" data-i="${i}" data-j="${j}" value="${esc(o)}" maxlength="120" placeholder="${esc(t('ed.opt.ph', { n: j + 1 }))}">
        ${q.options.length > 2 ? `<button class="btn sm danger" data-act="opt-del" data-i="${i}" data-j="${j}" aria-label="${esc(t('ed.opt.del'))}" title="${esc(t('ed.opt.del'))}">${ic('x')}</button>` : ''}
      </div>`).join('')}
    ${q.options.length < 4 ? `<button class="btn sm sec" data-act="opt-add" data-i="${i}">${ic('plus')} ${t('ed.opt.add')}</button>` : ''}
    <div class="opts-meta">
      <div><label class="f">${t('ed.time')}</label><select data-bind="q.time" data-i="${i}">${secs([5, 10, 15, 20, 30, 45, 60, 90, 120])}</select></div>
      <div><label class="f">${t('ed.points')}</label><select data-bind="q.points" data-i="${i}">
        <option value="standard" ${q.points === 'standard' ? 'selected' : ''}>${t('ed.pts.std')}</option>
        <option value="double" ${q.points === 'double' ? 'selected' : ''}>${t('ed.pts.dbl')}</option>
        <option value="none" ${q.points === 'none' ? 'selected' : ''}>${t('ed.pts.none')}</option></select></div>
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
    if (q.options.filter(o => o.trim()).length < 2) return t('val.opts', { n });
    if (!q.options[q.correct].trim()) return t('val.correct', { n });
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
    <h2>${ic('play')} ${esc(quiz.title)}</h2>
    <p class="muted">${tn('lib.count', realCount(quiz))}</p>
    <label style="display:flex;gap:10px;align-items:center;font-weight:600;margin:12px 0">
      <input type="checkbox" id="host-plays" style="width:20px;height:20px" checked> ${t('setup.plays')}
    </label>
    <div id="host-name-wrap"><label class="f" for="host-name">${t('setup.name')}</label>
      <input type="text" id="host-name" maxlength="${MAX_NAME}" value="Host"></div>
    <div class="err" id="host-err" role="alert"></div>
    <div class="row"><button class="btn big ok" data-act="start-lobby" id="start-lobby">${ic('users')} ${t('setup.create')}</button><button class="btn ghost" data-act="library">${t('common.cancel')}</button></div>
  </div>`;
};

async function createLobby(quiz, hostPlays, hostName) {
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
  $('#conn-badge').textContent = t('badge.room', { code });
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
  if (!id || !name) return safeSend(conn, { t: 'error', code: 'bad_name' });
  const existing = game.players.get(id);
  if (existing && !existing.isHost) {
    existing.conn = conn; existing.connected = true;
    safeSend(conn, { t: 'joined', name: existing.name });
    resendState(existing);
    refreshHostLive();
    return;
  }
  if (game.state !== 'lobby') return safeSend(conn, { t: 'error', code: 'started' });
  if ([...game.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return safeSend(conn, { t: 'error', code: 'name_taken' });
  if (game.players.size >= 100) return safeSend(conn, { t: 'error', code: 'full' });
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
  g.revealDeadline = Date.now() + REVEAL_SECS * 1000;
  clearTimeout(g.timer);
  g.timer = setTimeout(() => { if (game === g && g.state === 'reveal') nextStep(); }, REVEAL_SECS * 1000);
  g.players.forEach(p => { if (p.conn) safeSend(p.conn, revealPayload(p)); });
  go('hostReveal');
}

const noMoreQuestions = () => !game.quiz.questions.slice(game.qIndex + 1).some(q => !isTitle(q));

function revealPayload(p) {
  const g = game;
  return { t: 'reveal', index: g.qIndex, correct: g.quiz.questions[g.qIndex].correct, ...p.last, score: p.score, streak: p.streak, rank: p.rank, prevRank: p.prevRank, players: g.players.size, top: g.top, dist: g.dist, last: noMoreQuestions(), wait: Math.max(0, (g.revealDeadline - Date.now()) / 1000) };
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
  clearTimeout(g.timer);
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
    <h2>${t('lobby.join')}</h2>
    <div class="code-big">${g.code}</div>
    <div class="link">${esc(url)}</div>
    <div class="row center" style="margin-top:8px"><button class="btn sm sec" data-act="copy-link">${ic('link')} ${t('lobby.copy')}</button></div>
    <h3 style="margin-top:20px">${g.quiz.title ? esc(g.quiz.title) : ''}</h3>
    <div class="players">${humans ? [...g.players.values()].map(p => `<span class="chip">${esc(p.name)}${p.isHost ? ic('crown') : `<button data-act="kick" data-id="${esc(p.id)}" title="${esc(t('lobby.kick'))}" aria-label="${esc(t('lobby.kick.aria', { name: p.name }))}">${ic('x')}</button>`}</span>`).join('') : `<span class="spinner"></span>&nbsp; ${t('lobby.waiting')}`}</div>
    <p>${tn('lobby.players', humans)} · ${tn('lib.count', realCount(g.quiz))}${g.hostPlays ? '' : ' · ' + t('lobby.nohost')}</p>
    <div class="row" style="justify-content:center">
      <button class="btn big ok" data-act="start-game" ${humans ? '' : 'disabled'}>${ic('play')} ${t('lobby.start')}</button>
      <button class="btn big ghost" data-act="end-game">${t('common.cancel')}</button>
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
    ${skip ? `<div class="row center" style="margin-top:24px"><button class="btn sec" data-act="skip-title">${t('skip')} ${ic('skip')}</button></div>` : ''}
  </div>`;
}
views.hostTitle = () => titleHtml({ ...game.quiz.questions[game.qIndex], remaining: Math.max(0, (game.deadline - Date.now()) / 1000) }, true);
views.clientTitle = () => titleHtml(cli.title, false);

views.hostQuestion = () => {
  const g = game, q = g.quiz.questions[g.qIndex];
  const mine = g.answers.get('host');
  return `
  <div class="qbar"><span>${t('qbar.q', { n: qNumber(g.quiz, g.qIndex), total: realCount(g.quiz) })}${q.points === 'double' ? ' · ' + t('qbar.x2') : q.points === 'none' ? ' · ' + t('qbar.none') : ''}</span>
    <span id="acount">${t('qbar.answers', { n: g.answers.size, total: connectedHumans().length })}</span>
    <div class="timer" id="tnum">${q.time}</div></div>
  <div class="tbar"><div id="tfill"></div></div>
  <div class="qtext">${esc(q.text)}</div>
  ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="">` : ''}
  ${answerButtons(q, { interactive: g.hostPlays, selected: mine ? mine.choice : undefined })}
  <div class="row" style="justify-content:center;margin-top:16px"><button class="btn sec" data-act="skip">${t('q.end')} ${ic('skip')}</button></div>`;
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
    ${me && me.last ? `<div class="big-result ${me.last.ok ? 'good' : 'bad'}" style="margin-top:14px"><h2>${ic(me.last.ok ? 'check-circle' : 'x-circle')} ${me.last.ok ? t('reveal.correct') + ' +' + me.last.gained : me.last.answered ? t('reveal.wrong') : t('reveal.noanswer')}</h2>${me.streak >= 2 ? `<span class="pill">${ic('flame')} ${t('reveal.streak', { n: me.streak })}</span>` : ''}</div>` : ''}
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
  return `<div class="board">${list.slice(0, limit).map((r, i) => `<div class="r ${r.name === meName ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="sc">${r.score} ${t('pts.short')}</span></div>`).join('')}</div>`;
}

function podiumHtml(ranking) {
  const slot = (i, cls) => ranking[i] ? `<div class="slot ${cls}">${i === 0 ? `<div class="crown">${ic('crown')}</div>` : ''}<div class="who">${esc(ranking[i].name)}</div><div class="pts">${ranking[i].score} ${t('pts.short')}</div><div class="blk">${i + 1}</div></div>` : `<div class="slot ${cls}"></div>`;
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
    <div class="board">${g.results.map((r, i) => `<div class="r"><span class="pos">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="muted">${r.correct}/${realCount(g.quiz)} ${ic('check')}</span><span class="sc">${r.score} ${t('pts.short')}</span></div>`).join('')}</div>
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
    conn.on('open', () => safeSend(conn, { t: 'join', id: c.id, name: c.name }));
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
      c.ended = true; toast(t('err.kicked'), true); leaveGame(); go('home'); break;
    case 'end':
      if (!c.final) { c.ended = true; toast(t('err.hostclosed'), true); leaveGame(); go('home'); } break;
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
    <p>${cli.q ? t('wait.msg2') : t('wait.msg')}</p>
    <div class="players">${cli.lobby.map(n => `<span class="chip">${esc(n)}</span>`).join('')}</div>
    <span class="spinner"></span></div>`;

views.clientQuestion = () => {
  const c = cli, q = c.q;
  const answered = c.answered !== null;
  return `
  <div class="qbar"><span>${t('qbar.q', { n: q.num, total: q.total })}${q.points === 'double' ? ' · ' + t('qbar.x2') : q.points === 'none' ? ' · ' + t('qbar.none') : ''}</span><div class="timer" id="tnum">${Math.ceil(q.time)}</div></div>
  <div class="tbar"><div id="tfill"></div></div>
  <div class="qtext">${esc(q.text)}</div>
  ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="">` : ''}
  ${answerButtons(q, { interactive: true, selected: answered ? c.answered : undefined })}
  ${answered ? `<p class="center-note">${ic('check-circle')} ${t('q.sent')}</p>` : ''}`;
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
  const moved = r.prevRank && r.prevRank !== r.rank ? (r.rank < r.prevRank ? ` <span class="rank-up">${ic('up')}${r.prevRank - r.rank}</span>` : ` <span class="rank-down">${ic('down')}${r.rank - r.prevRank}</span>`) : '';
  return `
  <div class="stage">
    <div class="big-result ${cls}">
      <h2>${ic(r.ok ? 'check-circle' : r.answered ? 'x-circle' : 'clock')} ${r.ok ? t('reveal.correct') : r.answered ? t('reveal.wrong') : t('reveal.timeout')}</h2>
      ${r.ok ? `<div class="pts-big" data-count="${r.gained}" data-prefix="+" data-suffix="${esc(t('pts.unit'))}">+${r.gained}${t('pts.unit')}</div>` : ''}
      ${r.ok && r.bonus ? `<span class="pill">${t('reveal.bonus', { n: r.bonus })}</span>` : ''}
      ${r.streak >= 2 ? `<span class="pill">${ic('flame')} ${t('reveal.streak', { n: r.streak })}</span>` : ''}
    </div>
    <div class="qtext" style="font-size:1.1rem;border-top-color:var(--c${r.correct})"><span class="muted">${t('reveal.right')}</span> <span style="color:var(--c${r.correct})">${SHAPES[r.correct]} ${esc(q.options[r.correct])}</span></div>
    <p class="rankline">${t('reveal.rank', { r: r.rank, moved, n: r.players })} · <span data-count="${r.score}" data-suffix=" ${esc(t('pts.short'))}">${r.score} ${t('pts.short')}</span></p>
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
    ${mine.length ? `<p>${mine.map(a => `<span class="pill" style="background:var(--grad);color:#fff">${ic(a.icon)} ${t('award.' + a.key)}</span>`).join('')}</p>` : ''}
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
  theme() {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('quizsolde.theme', next); } catch { }
    syncThemeIcon();
  },
  home() {
    if (inGame() && !(cli && cli.final) && ui.view !== 'hostFinal' && !confirm(t('leave.confirm'))) return;
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
    $('#host-plays').addEventListener('change', e => { $('#host-name-wrap').style.display = e.target.checked ? '' : 'none'; });
  },
  async 'start-lobby'() {
    const plays = $('#host-plays').checked, name = $('#host-name').value.trim();
    if (plays && !name) { $('#host-err').textContent = t('setup.nameerr'); return; }
    const btn = $('#start-lobby'); btn.disabled = true; btn.textContent = t('setup.creating'); $('#host-err').textContent = '';
    try {
      await createLobby(compactQuiz(ui.quizzes.find(q => q.id === ui.setupQuizId)), plays, name);
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
    game.players.delete(p.id); broadcast({ t: 'lobby', names: lobbyNames() }); render();
  },
  'start-game'() { startQuestion(0); },
  skip() { endQuestion(); },
  'skip-title'() { clearTimeout(game.timer); nextStep(); },
  next() { nextStep(); },
  answer(el) { const j = +el.dataset.j; if (game) hostAnswer(j); else clientAnswer(j); },
  'end-game'() {
    if (game.state !== 'final' && !confirm(t('end.confirm'))) return;
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
  else if (b === 'q.opt') q.options[+t.dataset.j] = t.value;
});
document.addEventListener('change', e => {
  const el = e.target, b = el.dataset.bind;
  if (b && ui.editing) {
    const q = ui.editing.questions[+el.dataset.i];
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
    Promise.all(files.map(f => f.text())).then(texts => texts.forEach(tx => importText(tx)), () => toast(t('imp.readfail'), true));
    el.value = '';
  }
});

function importText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return toast(t('imp.invalid'), true); }
  const arr = Array.isArray(raw) ? raw : [raw];
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
  const code = $('#join-code').value.trim().toUpperCase(), name = $('#join-name').value.trim();
  const err = $('#join-err');
  if (code.length !== 5) return void (err.textContent = t('join.codelen'));
  if (!name) return void (err.textContent = t('join.needname'));
  err.textContent = ''; const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = t('join.busy');
  try {
    await joinGame(code, name);
  } catch (ex) {
    const msg = ex.type === 'peer-unavailable' ? t('err.nogame') : ex.message;
    leaveGame(); ui.joinError = msg; render();
    $('#join-code').value = code; $('#join-name').value = name;
  }
});

syncThemeIcon();
applyStatic();
render();
