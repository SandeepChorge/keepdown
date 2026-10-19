// Per-device preferences: light/dark theme and the collapsible sidebar.
// index.html applies both before first paint using the same storage keys.

import { $, ls, IS_MAC, MOD, narrowMq } from './util.js';
import { openDrawer, toggleDrawer } from './ui.js';

/* ---------- light / dark ---------- */
const LS_THEME = 'keepdown.theme';
const darkMq = matchMedia('(prefers-color-scheme: dark)');
const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const currentTheme = () => document.documentElement.getAttribute('data-theme') || (darkMq.matches ? 'dark' : 'light');

function renderTheme() {
  const dark = currentTheme() === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  for (const [btn, icon] of [['themeBtn', 'themeIcon'], ['miniTheme', 'miniThemeIcon']]) {
    $(icon).innerHTML = dark ? SUN : MOON;
    $(btn).title = label;
    $(btn).setAttribute('aria-label', label);
  }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = bg;
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  ls.set(LS_THEME, next);
  renderTheme();
}

/* ---------- collapsible sidebar ---------- */
const LS_RAIL = 'keepdown.rail';
const SLASH = IS_MAC ? '⌘\\' : 'Ctrl+\\';
const railCollapsed = () => document.documentElement.getAttribute('data-rail') === 'collapsed';

function setRail(collapsed) {
  if (collapsed) document.documentElement.setAttribute('data-rail', 'collapsed');
  else document.documentElement.removeAttribute('data-rail');
  ls.set(LS_RAIL, collapsed ? 'collapsed' : 'open');
  renderRail();
}
export function toggleRail() {
  if (narrowMq.matches) { toggleDrawer(); return; }   // phones keep the slide-in drawer
  setRail(!railCollapsed());
}
export function focusSearch() {
  if (narrowMq.matches) openDrawer();
  else if (railCollapsed()) setRail(false);
  $('search').focus(); $('search').select();
}
function renderRail() {
  const narrow = narrowMq.matches;
  for (const b of document.querySelectorAll('[data-rail-toggle]')) {
    const showing = !b.closest('.rail-mini');
    const label = narrow ? 'Close sidebar' : showing ? 'Hide sidebar' : 'Show sidebar';
    b.title = label + (narrow ? '' : ' (' + SLASH + ')');
    b.setAttribute('aria-label', label);
  }
  $('miniSearch').title = 'Search notes (' + MOD + 'K)';
  $('miniNew').title = 'New note (' + (IS_MAC ? '⌥N' : 'Alt+N') + ')';
}

export function initPrefs() {
  $('themeBtn').addEventListener('click', toggleTheme);
  $('miniTheme').addEventListener('click', toggleTheme);
  darkMq.addEventListener('change', renderTheme);
  renderTheme();

  for (const b of document.querySelectorAll('[data-rail-toggle]')) b.addEventListener('click', toggleRail);
  narrowMq.addEventListener('change', renderRail);
  renderRail();
}
