/* Música de concurso de televisión, sintetizada en el navegador con WebAudio (composición original, sin ficheros de audio).
 * Se silencia con el botón de la barra superior; la preferencia se guarda por dispositivo. */
'use strict';

const music = (() => {
  const KEY = 'quizsolde.music';
  const BPM = { lobby: 112, question: 132, reveal: 104, final: 124 };   // tempo por escena
  const LEVEL = 0.16;                                                   // volumen general (suave)
  let ctx = null, master = null, noiseBuf = null, mode = 'off', step = 0, next = 0, timer = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '0'; } catch { }

  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  /* ── instrumentos ── */
  function osc(type, freq, t, dur, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, vol, hp) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
  }
  function kick(t, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
  }

  /* ── patrones (un paso = semicorchea; 16 pasos = 1 compás; 4 compases = 1 ciclo) ── */
  const Q_CHORDS = [[57, 'm'], [53, 'M'], [55, 'M'], [52, 'm']];      // La m · Fa · Sol · Mi m  (tensión)
  const L_CHORDS = [[48, 'M'], [53, 'M'], [55, 'M'], [48, 'M']];      // Do · Fa · Sol · Do      (alegre)
  const IV = { m: [0, 3, 7, 12], M: [0, 4, 7, 12] };
  const ARP_Q = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2];
  const ARP_L = [0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 1, 3, 3, 2, 1, 0];

  function voice(m, s, t, sd) {
    const bar = Math.floor(s / 16) % 4, st = s % 16;
    if (m === 'question') {
      const [root, q] = Q_CHORDS[bar];
      if (st % 2 === 0) osc('triangle', hz(root - 12), t, sd * 1.9, 0.55);                // bajo pulsante
      if (st === 0 || st === 8) kick(t, 0.5);
      if (st === 4 || st === 12) noise(t, 0.09, 0.22, 1800);                               // caja
      if (st % 2 === 1) noise(t, 0.03, 0.10, 7000);                                        // hi-hat
      osc('triangle', hz(root + 12 + IV[q][ARP_Q[st]]), t, sd * 0.95, st % 4 === 0 ? 0.20 : 0.12);
      if (st === 0) osc('square', hz(root + 12), t, sd * 3, 0.05);
    } else if (m === 'lobby' || m === 'final') {
      const [root, q] = L_CHORDS[bar];
      const up = m === 'final' ? 12 : 0;
      if (st === 0 || st === 6 || st === 8 || st === 14) osc('triangle', hz(root - 12), t, sd * 2, 0.55);
      if (st === 0 || st === 8) kick(t, 0.4);
      if (st === 4 || st === 12) noise(t, 0.1, 0.2, 2200);                                 // palmada
      if (st % 2 === 0) osc('square', hz(root + 12 + up + IV[q][ARP_L[st]]), t, sd * 1.4, 0.07);
      if (st % 2 === 1 && m === 'final') noise(t, 0.03, 0.08, 7000);
    } else if (m === 'reveal') {
      const [root, q] = L_CHORDS[bar];
      if (st === 0 || st === 8) osc('triangle', hz(root - 12), t, sd * 3, 0.4);
      if (st % 4 === 2) osc('sine', hz(root + 24 + IV[q][ARP_L[st] % 4]), t, sd * 3, 0.14);   // campanitas
    }
  }

  function tick() {
    if (!ctx || mode === 'off') return;
    if (ctx.state !== 'running') { next = ctx.currentTime + 0.06; return; }   // sin gesto del usuario todavía
    const sd = 60 / BPM[mode] / 4;
    while (next < ctx.currentTime + 0.12) { voice(mode, step, next, sd); next += sd; step++; }
  }

  function applyGain() {
    if (!ctx) return;
    const on = !muted && mode !== 'off' && !document.hidden;
    master.gain.setTargetAtTime(on ? LEVEL : 0, ctx.currentTime, 0.05);
  }

  function stopLoop() { clearInterval(timer); timer = null; }

  /* ── API pública ── */
  function set(m, opts = {}) {
    if (m === mode && timer) return;
    mode = m; step = 0; stopLoop();
    if (m === 'off' || muted) { applyGain(); return; }
    if (!ensure()) return;
    next = ctx.currentTime + 0.06 + (opts.delay || 0);
    timer = setInterval(tick, 30);
    applyGain();
  }

  /** Debe llamarse desde un gesto del usuario (los navegadores bloquean el audio hasta entonces). */
  function unlock() { if (!ensure()) return; if (ctx.state === 'suspended') ctx.resume(); applyGain(); }

  function sting(kind) {
    if (muted || !ensure() || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.03;
    if (kind === 'good') [72, 76, 79, 84].forEach((n, i) => { osc('triangle', hz(n), t + i * 0.07, 0.45, 0.45); osc('square', hz(n), t + i * 0.07, 0.2, 0.05); });
    else if (kind === 'bad') { osc('sawtooth', hz(55), t, 0.32, 0.18); osc('sawtooth', hz(51), t + 0.26, 0.55, 0.18); }
    else osc('sine', hz(64), t, 0.3, 0.3);
  }

  function fanfare() {
    if (muted || !ensure() || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.03;
    [60, 64, 67, 72].forEach((n, i) => osc('triangle', hz(n), t + i * 0.11, 0.35, 0.45));
    [60, 64, 67, 72, 76].forEach(n => { osc('triangle', hz(n), t + 0.5, 1.1, 0.3); osc('square', hz(n), t + 0.5, 0.6, 0.04); });
  }

  function toggle() {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? '0' : '1'); } catch { }
    if (muted) { stopLoop(); applyGain(); }
    else { const m = mode; mode = 'off'; unlock(); set(m); }
    return muted;
  }

  document.addEventListener('visibilitychange', applyGain);
  return { set, unlock, sting, fanfare, toggle, isMuted: () => muted };
})();
