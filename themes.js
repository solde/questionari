/* GENERADO por tools/gen-themes.py (lista) + lógica de aplicación. Se carga en <head> para evitar parpadeos. */
'use strict';
const THEMES = [{"id": "dracula", "name": "Dracula", "mode": "dark", "pair": null, "sw": ["#282a36", "#bd93f9", "#ff79c6", "#f8f8f2"], "theme": "#282a36"}, {"id": "nord", "name": "Nord", "mode": "dark", "pair": null, "sw": ["#2e3440", "#88c0d0", "#b894b1", "#eceff4"], "theme": "#2e3440"}, {"id": "solarized-light", "name": "Solarized Light", "mode": "light", "pair": "solarized-dark", "sw": ["#fdf6e3", "#2077b4", "#d33682", "#073642"], "theme": "#fdf6e3"}, {"id": "solarized-dark", "name": "Solarized Dark", "mode": "dark", "pair": "solarized-light", "sw": ["#002b36", "#3b96d6", "#dd649e", "#eee8d5"], "theme": "#002b36"}, {"id": "gruvbox-dark", "name": "Gruvbox Dark", "mode": "dark", "pair": "gruvbox-light", "sw": ["#282828", "#fe8019", "#fb5b48", "#ebdbb2"], "theme": "#282828"}, {"id": "gruvbox-light", "name": "Gruvbox Light", "mode": "light", "pair": "gruvbox-dark", "sw": ["#fbf1c7", "#af3a03", "#9d0006", "#3c3836"], "theme": "#fbf1c7"}, {"id": "monokai", "name": "Monokai", "mode": "dark", "pair": null, "sw": ["#272822", "#a6e22e", "#f94e8c", "#f8f8f2"], "theme": "#272822"}, {"id": "one-dark", "name": "One Dark", "mode": "dark", "pair": "one-light", "sw": ["#282c34", "#61afef", "#c678dd", "#abb2bf"], "theme": "#282c34"}, {"id": "one-light", "name": "One Light", "mode": "light", "pair": "one-dark", "sw": ["#fafafa", "#3a6cda", "#a626a4", "#383a42"], "theme": "#fafafa"}, {"id": "tokyo-night", "name": "Tokyo Night", "mode": "dark", "pair": null, "sw": ["#1a1b26", "#7aa2f7", "#bb9af7", "#c0caf5"], "theme": "#1a1b26"}, {"id": "catppuccin-mocha", "name": "Catppuccin Mocha", "mode": "dark", "pair": "catppuccin-latte", "sw": ["#1e1e2e", "#cba6f7", "#f5c2e7", "#cdd6f4"], "theme": "#1e1e2e"}, {"id": "catppuccin-latte", "name": "Catppuccin Latte", "mode": "light", "pair": "catppuccin-mocha", "sw": ["#eff1f5", "#8839ef", "#ab5695", "#4c4f69"], "theme": "#eff1f5"}, {"id": "rose-pine", "name": "Rosé Pine", "mode": "dark", "pair": "rose-pine-dawn", "sw": ["#191724", "#c4a7e7", "#ebbcba", "#e0def4"], "theme": "#191724"}, {"id": "rose-pine-dawn", "name": "Rosé Pine Dawn", "mode": "light", "pair": "rose-pine", "sw": ["#faf4ed", "#826e99", "#a66562", "#575279"], "theme": "#faf4ed"}, {"id": "github-light", "name": "GitHub Light", "mode": "light", "pair": "github-dark", "sw": ["#ffffff", "#0969da", "#8250df", "#1f2328"], "theme": "#ffffff"}, {"id": "github-dark", "name": "GitHub Dark", "mode": "dark", "pair": "github-light", "sw": ["#0d1117", "#4493f8", "#ab7df8", "#e6edf3"], "theme": "#0d1117"}, {"id": "night-owl", "name": "Night Owl", "mode": "dark", "pair": null, "sw": ["#011627", "#82aaff", "#c792ea", "#d6deeb"], "theme": "#011627"}, {"id": "palenight", "name": "Material Palenight", "mode": "dark", "pair": null, "sw": ["#292d3e", "#c792ea", "#82aaff", "#bfc7d5"], "theme": "#292d3e"}, {"id": "everforest-dark", "name": "Everforest Dark", "mode": "dark", "pair": "everforest-light", "sw": ["#2d353b", "#a7c080", "#d699b6", "#d3c6aa"], "theme": "#2d353b"}, {"id": "everforest-light", "name": "Everforest Light", "mode": "light", "pair": "everforest-dark", "sw": ["#fdf6e3", "#6d7c01", "#ac5290", "#5c6a72"], "theme": "#fdf6e3"}, {"id": "contrast", "name": "HC", "mode": "dark", "pair": null, "sw": ["#000000", "#ffd400", "#00e5ff", "#ffffff"], "theme": "#000000"}];
const THEME_KEY = 'quizsolde.scheme', MODE_KEY = 'quizsolde.theme';
const themeById = id => THEMES.find(x => x.id === id);
const currentScheme = () => document.documentElement.dataset.scheme || 'quiz';
/** Aplica un tema. 'quiz' es el diseño por defecto (claro/oscuro automático o elegido con el interruptor). */
function applyScheme(id, opts = {}) {
  const root = document.documentElement, th = themeById(id);
  if (!th) id = 'quiz';
  if (id === 'quiz') {
    delete root.dataset.scheme;
    let mode = opts.mode;
    if (!mode) { try { mode = localStorage.getItem(MODE_KEY); } catch (e) { } }
    if (mode === 'light' || mode === 'dark') root.dataset.theme = mode; else delete root.dataset.theme;
    if (opts.mode) { try { localStorage.setItem(MODE_KEY, opts.mode); } catch (e) { } }
  } else {
    root.dataset.scheme = id; root.dataset.theme = th.mode;
  }
  try { localStorage.setItem(THEME_KEY, id); } catch (e) { }
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', th ? th.theme : '#6d3bf2');
}
(function () { let id = 'quiz'; try { id = localStorage.getItem(THEME_KEY) || 'quiz'; } catch (e) { } applyScheme(id); })();
