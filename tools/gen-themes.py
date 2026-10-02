#!/usr/bin/env python3
"""Genera themes.css y themes.js a partir de paletas de colores populares.
Ajusta automáticamente los colores que se usan como texto o como relleno para cumplir WCAG AA (4.5:1).
Uso: python3 tools/gen-themes.py   (desde la raíz del repo)"""
import colorsys, json, os

def hex2rgb(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def rgb2hex(c): return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in c)
def lum(h):
    r, g, b = [v / 255 for v in hex2rgb(h)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def cr(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
def mix(a, b, t):  # t = parte de b
    A, B = hex2rgb(a), hex2rgb(b)
    return rgb2hex([A[i] + (B[i] - A[i]) * t for i in range(3)])
def toward(color, target, bgs, need=4.5):
    """Acerca `color` a `target` (blanco/negro) hasta superar el contraste `need` contra todos los fondos."""
    c = color
    for i in range(40):
        if all(cr(c, b) >= need for b in bgs): return c
        c = mix(c, target, 0.06)
    return c
def best_on(fill, cands):
    return max(cands, key=lambda c: cr(fill, c))
def fix_fill(fill, on, need=4.5):
    """Oscurece/aclara el relleno hasta que el texto `on` se lea bien."""
    away = '#000000' if lum(on) > 0.5 else '#ffffff'
    c = fill
    for i in range(40):
        if cr(c, on) >= need: return c
        c = mix(c, away, 0.05)
    return c

# (familia, modo, paleta) — cada familia tiene variante clara y oscura. Las marcadas (*) son adaptaciones propias o oficiales de la familia.
NAMES = {'dracula': 'Dracula', 'nord': 'Nord', 'solarized': 'Solarized', 'gruvbox': 'Gruvbox', 'monokai': 'Monokai', 'one': 'Atom One',
         'tokyo-night': 'Tokyo Night', 'catppuccin': 'Catppuccin', 'rose-pine': 'Rosé Pine', 'github': 'GitHub', 'night-owl': 'Night Owl',
         'palenight': 'Material Palenight', 'everforest': 'Everforest', 'contrast': 'HC'}
P = lambda **k: k
T = [
 ('dracula', 'dark', P(bg='#282a36', s='#343746', s2='#44475a', fg='#f8f8f2', mu='#b4bad4', br='#bd93f9', br2='#ff79c6', br3='#8be9fd', red='#ff5555', blue='#8be9fd', yel='#f1fa8c', grn='#50fa7b', org='#ffb86c', pnk='#ff79c6')),
 ('dracula', 'light', P(bg='#fffbeb', s='#f4efd9', s2='#e6e0c5', fg='#1f1f1f', mu='#6c664b', br='#644ac9', br2='#a3144d', br3='#036a96', red='#cb3a2a', blue='#036a96', yel='#846e15', grn='#14710a', org='#a34d14', pnk='#a3144d')),   # Alucard
 ('nord', 'dark', P(bg='#2e3440', s='#3b4252', s2='#434c5e', fg='#eceff4', mu='#aab4c8', br='#88c0d0', br2='#b48ead', br3='#8fbcbb', red='#bf616a', blue='#81a1c1', yel='#ebcb8b', grn='#a3be8c', org='#d08770', pnk='#b48ead')),
 ('nord', 'light', P(bg='#eceff4', s='#e5e9f0', s2='#d8dee9', fg='#2e3440', mu='#4c566a', br='#5e81ac', br2='#b48ead', br3='#5e9aa0', red='#bf616a', blue='#5e81ac', yel='#ebcb8b', grn='#a3be8c', org='#d08770', pnk='#b48ead')),
 ('solarized', 'light', P(bg='#fdf6e3', s='#eee8d5', s2='#e3dcc4', fg='#073642', mu='#586e75', br='#268bd2', br2='#d33682', br3='#2aa198', red='#dc322f', blue='#268bd2', yel='#b58900', grn='#859900', org='#cb4b16', pnk='#d33682')),
 ('solarized', 'dark', P(bg='#002b36', s='#073642', s2='#0f4655', fg='#eee8d5', mu='#93a1a1', br='#268bd2', br2='#d33682', br3='#2aa198', red='#dc322f', blue='#268bd2', yel='#b58900', grn='#859900', org='#cb4b16', pnk='#d33682')),
 ('gruvbox', 'dark', P(bg='#282828', s='#3c3836', s2='#504945', fg='#ebdbb2', mu='#a89984', br='#fe8019', br2='#fb4934', br3='#8ec07c', red='#fb4934', blue='#83a598', yel='#fabd2f', grn='#b8bb26', org='#fe8019', pnk='#d3869b')),
 ('gruvbox', 'light', P(bg='#fbf1c7', s='#ebdbb2', s2='#d5c4a1', fg='#3c3836', mu='#665c54', br='#af3a03', br2='#9d0006', br3='#427b58', red='#9d0006', blue='#076678', yel='#b57614', grn='#79740e', org='#af3a03', pnk='#8f3f71')),
 ('monokai', 'dark', P(bg='#272822', s='#3e3d32', s2='#49483e', fg='#f8f8f2', mu='#b0af9a', br='#a6e22e', br2='#f92672', br3='#66d9ef', red='#f92672', blue='#66d9ef', yel='#e6db74', grn='#a6e22e', org='#fd971f', pnk='#ae81ff')),
 ('monokai', 'light', P(bg='#fafaf5', s='#f0efe6', s2='#e2e1d3', fg='#272822', mu='#6b6a58', br='#d1175f', br2='#7c4dd6', br3='#1c8fae', red='#f92672', blue='#1c8fae', yel='#a38f00', grn='#5a9d00', org='#d96f00', pnk='#7c4dd6')),   # (*)
 ('one', 'dark', P(bg='#282c34', s='#2f343e', s2='#3e4451', fg='#abb2bf', mu='#8f99ab', br='#61afef', br2='#c678dd', br3='#56b6c2', red='#e06c75', blue='#61afef', yel='#e5c07b', grn='#98c379', org='#d19a66', pnk='#c678dd')),
 ('one', 'light', P(bg='#fafafa', s='#ffffff', s2='#eaeaeb', fg='#383a42', mu='#696c77', br='#4078f2', br2='#a626a4', br3='#0184bc', red='#e45649', blue='#4078f2', yel='#c18401', grn='#50a14f', org='#986801', pnk='#a626a4')),
 ('tokyo-night', 'dark', P(bg='#1a1b26', s='#24283b', s2='#2f334d', fg='#c0caf5', mu='#9aa5ce', br='#7aa2f7', br2='#bb9af7', br3='#7dcfff', red='#f7768e', blue='#7aa2f7', yel='#e0af68', grn='#9ece6a', org='#ff9e64', pnk='#bb9af7')),
 ('tokyo-night', 'light', P(bg='#e1e2e7', s='#ebecf2', s2='#d0d5e3', fg='#3760bf', mu='#5b6a9a', br='#2e7de9', br2='#9854f1', br3='#007197', red='#f52a65', blue='#2e7de9', yel='#8c6c3e', grn='#587539', org='#b15c00', pnk='#9854f1')),   # Tokyo Night Day
 ('catppuccin', 'dark', P(bg='#1e1e2e', s='#313244', s2='#45475a', fg='#cdd6f4', mu='#a6adc8', br='#cba6f7', br2='#f5c2e7', br3='#89dceb', red='#f38ba8', blue='#89b4fa', yel='#f9e2af', grn='#a6e3a1', org='#fab387', pnk='#f5c2e7')),   # Mocha
 ('catppuccin', 'light', P(bg='#eff1f5', s='#e6e9ef', s2='#ccd0da', fg='#4c4f69', mu='#5c5f77', br='#8839ef', br2='#ea76cb', br3='#04a5e5', red='#d20f39', blue='#1e66f5', yel='#df8e1d', grn='#40a02b', org='#fe640b', pnk='#ea76cb')),   # Latte
 ('rose-pine', 'dark', P(bg='#191724', s='#1f1d2e', s2='#26233a', fg='#e0def4', mu='#908caa', br='#c4a7e7', br2='#ebbcba', br3='#9ccfd8', red='#eb6f92', blue='#9ccfd8', yel='#f6c177', grn='#3e8fb0', org='#ebbcba', pnk='#eb6f92')),
 ('rose-pine', 'light', P(bg='#faf4ed', s='#fffaf3', s2='#f2e9e1', fg='#575279', mu='#6e6a86', br='#907aa9', br2='#d7827e', br3='#56949f', red='#b4637a', blue='#286983', yel='#ea9d34', grn='#56949f', org='#d7827e', pnk='#b4637a')),   # Dawn
 ('github', 'light', P(bg='#ffffff', s='#f6f8fa', s2='#eaeef2', fg='#1f2328', mu='#59636e', br='#0969da', br2='#8250df', br3='#1b7c83', red='#cf222e', blue='#0969da', yel='#9a6700', grn='#1a7f37', org='#bc4c00', pnk='#bf3989')),
 ('github', 'dark', P(bg='#0d1117', s='#151b23', s2='#212830', fg='#e6edf3', mu='#9198a1', br='#4493f8', br2='#ab7df8', br3='#39c5cf', red='#f85149', blue='#4493f8', yel='#d29922', grn='#3fb950', org='#db6d28', pnk='#db61a2')),
 ('night-owl', 'dark', P(bg='#011627', s='#0b2942', s2='#1d3b53', fg='#d6deeb', mu='#8fa6bd', br='#82aaff', br2='#c792ea', br3='#7fdbca', red='#ef5350', blue='#82aaff', yel='#ecc48d', grn='#addb67', org='#f78c6c', pnk='#c792ea')),
 ('night-owl', 'light', P(bg='#fbfbfb', s='#f0f0f0', s2='#e0e7ea', fg='#403f53', mu='#5f6a7a', br='#4876d6', br2='#994cc3', br3='#0c969b', red='#de3d3b', blue='#4876d6', yel='#c79a00', grn='#08916a', org='#d96a2c', pnk='#994cc3')),   # Light Owl
 ('palenight', 'dark', P(bg='#292d3e', s='#32374d', s2='#444267', fg='#bfc7d5', mu='#959dc0', br='#c792ea', br2='#82aaff', br3='#89ddff', red='#f07178', blue='#82aaff', yel='#ffcb6b', grn='#c3e88d', org='#f78c6c', pnk='#ff5370')),
 ('palenight', 'light', P(bg='#fafafa', s='#ffffff', s2='#eceff1', fg='#546e7a', mu='#6a7f8a', br='#7c4dff', br2='#39adb5', br3='#6182b8', red='#e53935', blue='#6182b8', yel='#e0a400', grn='#6a9a3c', org='#f76d47', pnk='#ff5370')),   # Material Lighter
 ('everforest', 'dark', P(bg='#2d353b', s='#343f44', s2='#3d484d', fg='#d3c6aa', mu='#9da9a0', br='#a7c080', br2='#d699b6', br3='#83c092', red='#e67e80', blue='#7fbbb3', yel='#dbbc7f', grn='#a7c080', org='#e69875', pnk='#d699b6')),
 ('everforest', 'light', P(bg='#fdf6e3', s='#f4f0d9', s2='#e6e2cc', fg='#5c6a72', mu='#6a777d', br='#8da101', br2='#df69ba', br3='#35a77c', red='#f85552', blue='#3a94c5', yel='#dfa000', grn='#8da101', org='#f57d26', pnk='#df69ba')),
 ('contrast', 'dark', P(bg='#000000', s='#0a0a0a', s2='#1c1c1c', fg='#ffffff', mu='#e6e6e6', br='#ffd400', br2='#00e5ff', br3='#ffffff', red='#ff5c5c', blue='#5cb0ff', yel='#ffd400', grn='#3dff6b', org='#ff9e00', pnk='#ff7ad9')),
 ('contrast', 'light', P(bg='#ffffff', s='#ffffff', s2='#eeeeee', fg='#000000', mu='#1a1a1a', br='#0033cc', br2='#b3001b', br3='#006400', red='#c00000', blue='#0033cc', yel='#7a5c00', grn='#006400', org='#8a3b00', pnk='#a000a0')),
]

def build(fam, mode, p):
    tid = f'{fam}-{mode}'
    name = NAMES[fam]
    pair = None
    dark = mode == 'dark'
    bg, s, s2, fg = p['bg'], p['s'], p['s2'], p['fg']
    bgs = [bg, s, s2]
    away = '#ffffff' if dark else '#000000'                   # dirección para textos que deben ganar contraste
    muted = toward(p['mu'], away, bgs)
    link = toward(p['br'], away, bgs)
    ok = toward(p['grn'], away, bgs); bad = toward(p['red'], away, bgs)
    on = bg if dark else '#ffffff'                            # texto sobre rellenos de marca
    if fam == 'contrast': on = '#000000' if dark else '#ffffff'
    brand = fix_fill(p['br'], on); brand2 = fix_fill(p['br2'], on); brand3 = p['br3']
    on_ok = best_on(ok, ['#ffffff', '#000000', bg]); on_bad = best_on(bad, ['#ffffff', '#000000', bg])
    cols = [p['red'], p['blue'], p['yel'], p['grn']]
    ans_text = max(['#ffffff', '#000000', bg], key=lambda c: min(cr(x, c) for x in cols))
    chips = [brand, p['pnk'], brand3 if lum(brand3) < 0.9 else p['org'], p['org'], p['grn']]
    on_chip = max(['#ffffff', '#000000', bg], key=lambda c: min(cr(x, c) for x in chips))
    chips = [fix_fill(c, on_chip) for c in chips]
    tiles = [link, p['pnk'], brand3, p['org']]
    tiles = [toward(c, away, [bg, s], 3.0) for c in tiles]
    line = ('rgba(255,255,255,%s)' % ('.55' if fam == 'contrast' else '.12')) if dark else ('rgba(0,0,0,.7)' if fam == 'contrast' else 'rgba(%d,%d,%d,.16)' % hex2rgb(fg))
    sh = ('0 1px 2px rgba(0,0,0,.4)', '0 8px 24px rgba(0,0,0,.4)', '0 24px 60px rgba(0,0,0,.55)') if dark else tuple('%s rgba(%d,%d,%d,%s)' % (a, *hex2rgb(fg), b) for a, b in (('0 1px 2px', '.08'), ('0 8px 24px', '.12'), ('0 24px 60px', '.2')))
    a = '.30' if dark else '.26'
    css = f""":root[data-scheme="{tid}"][data-theme] {{
  color-scheme: {mode};
  --bg: {bg}; --surface: {s}; --surface-2: {s2}; --text: {fg}; --muted: {muted}; --line: {line}; --link: {link};
  --brand: {brand}; --brand-hi: {brand2}; --brand-3: {brand3}; --on-brand: {on};
  --grad: linear-gradient(135deg, {brand} 0%, {brand2} 100%);
  --grad-soft: linear-gradient(135deg, color-mix(in srgb, {brand} 18%, transparent), color-mix(in srgb, {brand2} 18%, transparent));
  --grad-text: linear-gradient(120deg, {link}, {p['pnk']} 55%, {p['org']});
  --ok: {ok}; --ok-bg: {ok}; --on-ok: {on_ok}; --bad: {bad}; --bad-bg: {bad}; --on-bad: {on_bad}; --gold: {p['yel']};
  --c0: {p['red']}; --c1: {p['blue']}; --c2: {p['yel']}; --c3: {p['grn']}; --ans-text: {ans_text};
  --chip1: {chips[0]}; --chip2: {chips[1]}; --chip3: {chips[2]}; --chip4: {chips[3]}; --chip5: {chips[4]}; --on-chip: {on_chip};
  --t1: {tiles[0]}; --t2: {tiles[1]}; --t3: {tiles[2]}; --t4: {tiles[3]};
  --blob-1: color-mix(in srgb, {brand} {int(float(a)*100)}%, transparent); --blob-2: color-mix(in srgb, {brand2} {int(float(a)*100)}%, transparent); --blob-3: color-mix(in srgb, {brand3} {int(float(a)*100)}%, transparent);
  --shadow-sm: {sh[0]}; --shadow-md: {sh[1]}; --shadow-lg: {sh[2]};
}}
"""
    if fam == 'contrast':
        sel = f':root[data-scheme="{tid}"][data-theme]'
        css += f'{sel} .bg-fx::before {{ opacity: 0; }}\n{sel} .card, {sel} .tile, {sel} .board {{ border-width: 2px; }}\n'
    # informe de contraste
    checks = {
      'text/bg': cr(fg, bg), 'text/surface': cr(fg, s), 'muted/surface2': cr(muted, s2), 'link/bg': cr(link, bg),
      'on-brand/brand': cr(on, brand), 'on-brand/brand2': cr(on, brand2), 'ok/surface': cr(ok, s), 'bad/surface': cr(bad, s),
      'on-ok/ok': cr(on_ok, ok), 'on-bad/bad': cr(on_bad, bad), 'ans/min': min(cr(x, ans_text) for x in cols), 'chip/min': min(cr(x, on_chip) for x in chips),
    }
    sw = [bg, brand, brand2, fg]
    return css, checks, dict(fam=fam, mode=mode, sw=sw, theme=bg)

css_all = '/* GENERADO por tools/gen-themes.py — no editar a mano */\n'
fams = {}; bad_count = 0
for fam, mode, p in T:
    css, checks, m = build(fam, mode, p)
    css_all += css
    f = fams.setdefault(fam, dict(id=fam, name=NAMES[fam], sw={}, theme={}))
    f['sw'][mode] = m['sw']; f['theme'][mode] = m['theme']
    low = {k: round(v, 2) for k, v in checks.items() if v < 4.5 and not (k == 'ans/min' and v >= 3.0)}
    print(f'{fam + "-" + mode:22s} min={min(checks.values()):5.2f}', 'LOW:' + str(low) if low else 'ok')
    bad_count += bool(low)
assert all(set(f['sw']) == {'light', 'dark'} for f in fams.values()), 'cada familia necesita claro y oscuro'
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
open(os.path.join(root, 'themes.css'), 'w').write(css_all)
js = '''/* GENERADO por tools/gen-themes.py (lista) + lógica de aplicación. Se carga en <head> para evitar parpadeos. */
'use strict';
/* Cada familia de colores tiene variante clara y oscura; el modo (claro/oscuro) es independiente de la familia. */
const FAMILIES = %s;
const FAMILY_KEY = 'quizsolde.scheme', MODE_KEY = 'quizsolde.theme';
const familyById = id => FAMILIES.find(x => x.id === id);
const systemMode = () => (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
const storedMode = () => { try { const m = localStorage.getItem(MODE_KEY); return m === 'light' || m === 'dark' ? m : null; } catch (e) { return null; } };
const currentFamily = () => { try { const f = localStorage.getItem(FAMILY_KEY); return f && familyById(f) ? f : 'quiz'; } catch (e) { return 'quiz'; } };
/** Modo efectivo: el elegido con el botón o, si no hay, el del sistema. */
const currentMode = () => storedMode() || systemMode();
/** Aplica familia y/o modo. `mode` explícito se recuerda; sin él se sigue el sistema. */
function applyScheme(family, mode) {
  const root = document.documentElement, fam = familyById(family);
  if (mode === 'light' || mode === 'dark') { try { localStorage.setItem(MODE_KEY, mode); } catch (e) { } }
  const eff = currentMode();
  try { localStorage.setItem(FAMILY_KEY, fam ? family : 'quiz'); } catch (e) { }
  if (!fam) {
    delete root.dataset.scheme;
    const sm = storedMode(); if (sm) root.dataset.theme = sm; else delete root.dataset.theme;
  } else {
    root.dataset.scheme = family + '-' + eff; root.dataset.theme = eff;
  }
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', fam ? fam.theme[eff] : '#6d3bf2');
}
applyScheme(currentFamily());
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!storedMode()) applyScheme(currentFamily()); });
''' % json.dumps(list(fams.values()), ensure_ascii=False)
open(os.path.join(root, 'themes.js'), 'w').write(js)
print('familias:', len(fams), 'variantes:', len(T), '| con avisos:', bad_count)
