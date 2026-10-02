/* GENERADO por tools/gen-themes.py (lista) + lógica de aplicación. Se carga en <head> para evitar parpadeos. */
'use strict';
/* Cada familia de colores tiene variante clara y oscura; el modo (claro/oscuro) es independiente de la familia. */
const FAMILIES = [{"id": "dracula", "name": "Dracula", "sw": {"dark": ["#282a36", "#bd93f9", "#ff79c6", "#f8f8f2"], "light": ["#fffbeb", "#644ac9", "#a3144d", "#1f1f1f"]}, "theme": {"dark": "#282a36", "light": "#fffbeb"}}, {"id": "nord", "name": "Nord", "sw": {"dark": ["#2e3440", "#88c0d0", "#b894b1", "#eceff4"], "light": ["#eceff4", "#55759b", "#84687f", "#2e3440"]}, "theme": {"dark": "#2e3440", "light": "#eceff4"}}, {"id": "solarized", "name": "Solarized", "sw": {"light": ["#fdf6e3", "#2077b4", "#d33682", "#073642"], "dark": ["#002b36", "#3b96d6", "#dd649e", "#eee8d5"]}, "theme": {"light": "#fdf6e3", "dark": "#002b36"}}, {"id": "gruvbox", "name": "Gruvbox", "sw": {"dark": ["#282828", "#fe8019", "#fb5b48", "#ebdbb2"], "light": ["#fbf1c7", "#af3a03", "#9d0006", "#3c3836"]}, "theme": {"dark": "#282828", "light": "#fbf1c7"}}, {"id": "monokai", "name": "Monokai", "sw": {"dark": ["#272822", "#a6e22e", "#f94e8c", "#f8f8f2"], "light": ["#fafaf5", "#d1175f", "#7c4dd6", "#272822"]}, "theme": {"dark": "#272822", "light": "#fafaf5"}}, {"id": "one", "name": "Atom One", "sw": {"dark": ["#282c34", "#61afef", "#c678dd", "#abb2bf"], "light": ["#fafafa", "#3a6cda", "#a626a4", "#383a42"]}, "theme": {"dark": "#282c34", "light": "#fafafa"}}, {"id": "tokyo-night", "name": "Tokyo Night", "sw": {"dark": ["#1a1b26", "#7aa2f7", "#bb9af7", "#c0caf5"], "light": ["#e1e2e7", "#2a71d2", "#9050e5", "#3760bf"]}, "theme": {"dark": "#1a1b26", "light": "#e1e2e7"}}, {"id": "catppuccin", "name": "Catppuccin", "sw": {"dark": ["#1e1e2e", "#cba6f7", "#f5c2e7", "#cdd6f4"], "light": ["#eff1f5", "#8839ef", "#ab5695", "#4c4f69"]}, "theme": {"dark": "#1e1e2e", "light": "#eff1f5"}}, {"id": "rose-pine", "name": "Rosé Pine", "sw": {"dark": ["#191724", "#c4a7e7", "#ebbcba", "#e0def4"], "light": ["#faf4ed", "#826e99", "#a66562", "#575279"]}, "theme": {"dark": "#191724", "light": "#faf4ed"}}, {"id": "github", "name": "GitHub", "sw": {"light": ["#ffffff", "#0969da", "#8250df", "#1f2328"], "dark": ["#0d1117", "#4493f8", "#ab7df8", "#e6edf3"]}, "theme": {"light": "#ffffff", "dark": "#0d1117"}}, {"id": "night-owl", "name": "Night Owl", "sw": {"dark": ["#011627", "#82aaff", "#c792ea", "#d6deeb"], "light": ["#fbfbfb", "#4470cb", "#994cc3", "#403f53"]}, "theme": {"dark": "#011627", "light": "#fbfbfb"}}, {"id": "palenight", "name": "Material Palenight", "sw": {"dark": ["#292d3e", "#c792ea", "#82aaff", "#bfc7d5"], "light": ["#fafafa", "#7c4dff", "#2a7f85", "#546e7a"]}, "theme": {"dark": "#292d3e", "light": "#fafafa"}}, {"id": "everforest", "name": "Everforest", "sw": {"dark": ["#2d353b", "#a7c080", "#d699b6", "#d3c6aa"], "light": ["#fdf6e3", "#6d7c01", "#ac5290", "#5c6a72"]}, "theme": {"dark": "#2d353b", "light": "#fdf6e3"}}, {"id": "contrast", "name": "HC", "sw": {"dark": ["#000000", "#ffd400", "#00e5ff", "#ffffff"], "light": ["#ffffff", "#0033cc", "#b3001b", "#000000"]}, "theme": {"dark": "#000000", "light": "#ffffff"}}];
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
