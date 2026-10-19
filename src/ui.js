// Everything on screen: the note list, the toolbar and status line, the preview, toasts,
// and opening, creating and deleting notes.

import { $, MOD, IS_MAC, narrowMq, esc, fmtNum, fmtDayYear, fmtFull, rel } from './util.js';
import { on } from './events.js';
import {
  state, active, sortedNotes, firstId, ensureActive, metaOf, terms, savePrefs,
  createNote, touch, markDirty, removeNote, restoreNote,
} from './notes.js';
import { gh, fullRepo, noteHistoryUrl } from './github.js';
import { renderMarkdown } from './markdown.js';

export const app = $('app'), editor = $('editor'), previewPane = $('previewPane');
const listEl = $('list'), preview = $('preview');

/* ---------- drawer (phones) ---------- */
export const closeDrawer = () => app.classList.remove('drawer-open');
export const openDrawer = () => app.classList.add('drawer-open');
export const toggleDrawer = () => app.classList.toggle('drawer-open');

/* ---------- toast ---------- */
const toastEl = $('toast');
let toastTimer = 0, toastHide = 0;
export function toast(msg, opts = {}) {
  clearTimeout(toastTimer); clearTimeout(toastHide);
  toastEl.textContent = '';
  const s = document.createElement('span'); s.textContent = msg; toastEl.append(s);
  if (opts.action) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = opts.action;
    b.addEventListener('click', () => { hideToast(); opts.onAction(); });
    toastEl.append(b);
  }
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(hideToast, opts.ms || 3200);
}
function hideToast() {
  toastEl.classList.remove('show');
  toastHide = setTimeout(() => { toastEl.hidden = true; }, 200);
}

/* ---------- views ---------- */
export function effectiveView() { return narrowMq.matches && state.view === 'split' ? 'write' : state.view; }
export function setView(v) { state.view = v; savePrefs(); applyView(); }
export function applyView() {
  const v = effectiveView();
  app.dataset.view = v;
  for (const b of $('viewSeg').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.view === v));
  if (v !== 'write') renderPreview();
}

/* ---------- rendering ---------- */
function hl(text, ts) {
  if (!ts.length) return esc(text);
  const re = new RegExp(ts.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  let out = '', last = 0, m;
  while ((m = re.exec(text))) {
    if (!m[0]) { re.lastIndex++; continue; }
    out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
function searchSnip(body, ts) {
  const lower = body.toLowerCase();
  let i = -1;
  for (const t of ts) { i = lower.indexOf(t); if (i >= 0) break; }
  if (i < 0) return '';
  const start = Math.max(0, i - 50);
  return (start > 0 ? '…' : '') + body.slice(start, i + 120).replace(/\s+/g, ' ').trim();
}

const PIN_SVG = '<svg class="i" viewBox="0 0 24 24" aria-label="Pinned"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
export function renderList() {
  const ts = terms();
  let notes = sortedNotes();
  if (ts.length) notes = notes.filter(n => { const b = n.body.toLowerCase(); return ts.every(t => b.includes(t)); });
  if (!state.notes.size) {
    listEl.innerHTML = '<li class="list-empty">' + (gh.token && !gh.lastSync && gh.status === 'syncing' ? 'Loading notes from GitHub…' : 'Your notes will appear here.') + '</li>';
    return;
  }
  if (!notes.length) { listEl.innerHTML = '<li class="list-empty">No notes contain “' + esc(state.query.trim()) + '”.</li>'; return; }
  const pinned = ts.length ? 0 : notes.filter(n => n.pinned).length;
  let html = '', group = null;
  const label = (name, count) => '<li class="list-label">' + name + '<span>' + count + '</span></li>';
  if (ts.length) html += label(notes.length === 1 ? '1 match' : notes.length + ' matches', '');
  for (const n of notes) {
    if (!ts.length) {
      const g = pinned && n.pinned ? 'Pinned' : 'Notes';
      if (g !== group) { group = g; html += label(g, g === 'Pinned' ? pinned : notes.length - pinned); }
    }
    const m = metaOf(n);
    const snip = ts.length ? searchSnip(n.body, ts) : m.snip;
    const cur = n.id === state.activeId;
    html += '<li><button type="button" class="item" data-id="' + esc(n.id) + '"' + (cur ? ' aria-current="true"' : '') + ' title="Edited ' + esc(fmtFull.format(n.updatedAt)) + '">'
      + '<span class="item-title' + (m.title ? '' : ' untitled') + '">' + (n.pinned ? PIN_SVG : '') + '<b>' + (m.title ? hl(m.title, ts) : 'Empty note') + '</b></span>'
      + '<span class="item-time">' + rel(n.updatedAt) + '</span>'
      + (snip ? '<span class="item-snip">' + hl(snip, ts) + '</span>' : '')
      + '</button></li>';
  }
  listEl.innerHTML = html;
}
let listTimer = 0;
export function renderListSoon() { clearTimeout(listTimer); listTimer = setTimeout(renderList, 180); }

export function renderStore() {
  let st = 'local', main = 'Saved in this browser only', sub = 'Set up GitHub sync';
  if (!state.storageOk) { st = 'error'; main = 'This browser is blocking storage'; sub = 'Notes will not be kept here'; }
  else if (gh.token) {
    if (gh.status === 'auth') { st = 'error'; main = 'GitHub sync stopped'; sub = 'Reconnect to keep syncing'; }
    else if (gh.status === 'offline') { st = 'local'; main = 'Offline'; sub = 'Notes are kept in this browser'; }
    else if (gh.status === 'error') { st = 'error'; main = 'Sync paused'; sub = gh.error; }
    else if (gh.status === 'syncing' && !gh.lastSync) { st = 'busy'; main = 'Connecting to GitHub…'; sub = fullRepo(); }
    else { st = gh.busy ? 'busy' : 'cloud'; main = 'Synced to GitHub'; sub = fullRepo(); }
  }
  const el = $('store');
  el.dataset.state = st;
  $('storeMain').textContent = main;
  $('storeSub').textContent = sub;
  el.title = gh.token ? (gh.error || 'Notes sync to ' + fullRepo()) : 'Notes live only in this browser. Set up GitHub sync to keep them in your account.';
  const mini = $('miniStore');
  mini.dataset.state = st;
  mini.title = main + ' · ' + sub;
  mini.setAttribute('aria-label', main + '. ' + sub);
}
export function renderSaveState() {
  const el = $('saveState'), txt = $('saveText');
  const n = active();
  let st = 'ok', t = '';
  if (!n) { el.dataset.state = ''; txt.textContent = ''; return; }
  if (!state.storageOk && !gh.token) { st = 'error'; t = 'Not saved. Storage is blocked'; }
  else if (!n.body.trim() && !n.sha) { st = ''; t = 'Empty notes are not saved'; }
  else if (!gh.token) { st = 'ok'; t = 'Saved in this browser'; }
  else if (gh.status === 'auth') { st = 'warn'; t = n.dirty ? 'Saved in this browser · reconnect GitHub to sync' : 'Saved'; }
  else if (gh.status === 'offline' || gh.status === 'error') { st = 'warn'; t = n.dirty ? 'Saved in this browser · will sync later' : 'Saved'; }
  else if (n.dirty) { st = 'busy'; t = 'Saving…'; }
  else { st = 'ok'; t = 'Saved to GitHub'; }
  el.dataset.state = st; txt.textContent = t; el.title = t;
}
export function renderMeta() {
  const n = active();
  if (!n) return;
  const words = (n.body.match(/\S+/g) || []).length;
  $('counts').textContent = fmtNum.format(words) + (words === 1 ? ' word' : ' words') + ' · ' + fmtNum.format(n.body.length) + ' chars';
  $('dates').textContent = 'Created ' + fmtDayYear.format(n.createdAt) + ' · Edited ' + rel(n.updatedAt);
}
let metaTimer = 0;
function renderMetaSoon() { clearTimeout(metaTimer); metaTimer = setTimeout(renderMeta, 200); }
export function renderPos() {
  const v = editor.value, p = editor.selectionStart;
  let ln = 1, last = -1;
  for (let i = v.indexOf('\n'); i !== -1 && i < p; i = v.indexOf('\n', i + 1)) { ln++; last = i; }
  $('pos').textContent = 'Ln ' + ln + ', Col ' + (p - last);
}
function renderPreview() {
  if (effectiveView() === 'write') return;
  const n = active();
  renderMarkdown(preview, n ? n.body : '');
}
let previewTimer = 0;
function renderPreviewSoon() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 90); }
function renderBar() {
  const n = active();
  const pin = $('pinBtn');
  pin.setAttribute('aria-pressed', String(!!(n && n.pinned)));
  pin.title = n && n.pinned ? 'Unpin' : 'Pin to top';
  const hist = $('historyBtn');
  hist.hidden = !(gh.token && n && n.sha);
  if (!hist.hidden) hist.href = noteHistoryUrl(n.id);
}
function renderStage() {
  const has = !!active();
  $('panes').hidden = !has;
  $('statusbar').hidden = !has;
  $('empty').hidden = has;
  $('emptySync').hidden = !!gh.token;
  for (const el of document.querySelectorAll('[data-needs-note]')) el.hidden = !has;
}
export function renderAll() {
  if (!active() && state.notes.size) { state.activeId = firstId(); applyActiveToEditor(false); }
  renderStage(); renderList(); renderStore(); renderSaveState(); renderBar();
  if (active()) { applyView(); renderMeta(); renderPos(); }
}

/* ---------- opening, creating, deleting ---------- */
export function applyActiveToEditor(keepCaret) {
  const n = active();
  const body = n ? n.body : '';
  if (editor.value === body) return;
  if (keepCaret && document.activeElement === editor) {
    const s = editor.selectionStart, e = editor.selectionEnd;
    editor.value = body;
    editor.setSelectionRange(Math.min(s, body.length), Math.min(e, body.length));
  } else {
    editor.value = body;
  }
}
function selectNote(id) {
  const prev = active();
  if (prev && prev.id !== id && !prev.body.trim() && !prev.pinned) removeNote(prev.id);   // drop empty notes you leave behind
  state.activeId = id;
  savePrefs();
  applyActiveToEditor(false);
}
export function openNote(id, { focus = false } = {}) {
  selectNote(id);
  editor.scrollTop = 0; previewPane.scrollTop = 0;
  closeDrawer();
  renderAll();
  if (focus) { if (effectiveView() === 'read') setView(narrowMq.matches ? 'write' : 'split'); editor.focus(); }
}
export function newNote(body = '') { const n = createNote(body); openNote(n.id, { focus: !body }); return n; }
export function deleteActiveNote() {
  const n = active(); if (!n) return;
  const title = metaOf(n).title || 'Empty note';
  const gone = removeNote(n.id);
  state.activeId = firstId(); savePrefs();
  applyActiveToEditor(false);
  renderAll();
  if (gone && gone.body.trim()) {
    toast('Deleted “' + (title.length > 40 ? title.slice(0, 40) + '…' : title) + '”', { action: 'Undo', onAction: () => openNote(restoreNote(gone).id), ms: 8000 });
  }
}
export function togglePin() {
  const n = active(); if (!n) return;
  n.pinned = !n.pinned; n.changedAt = Date.now();
  markDirty(n, 1500);
  renderList(); renderBar(); renderSaveState();
}
export function handleEditorInput() {
  let n = active();
  if (!n) { n = createNote(''); state.activeId = n.id; savePrefs(); }
  n.body = editor.value;
  touch(n);
  renderSaveState(); renderPreviewSoon(); renderListSoon(); renderMetaSoon(); renderPos();
}

/** Labels that depend on the keyboard, and reactions to data and sync events. */
export function initUI() {
  $('searchKbd').textContent = MOD + 'K';
  $('pasteKbd').textContent = MOD + (IS_MAC ? 'V' : '+V');
  $('newBtn').title = 'New note (' + (IS_MAC ? '⌥N' : 'Alt+N') + ')';

  on('status', () => { renderStore(); renderSaveState(); renderBar(); });
  on('list', renderListSoon);
  on('notes', () => { if (ensureActive()) applyActiveToEditor(false); renderAll(); });
  on('active-replaced', () => applyActiveToEditor(true));
  on('storage', () => { renderStore(); renderSaveState(); });
  on('toast', toast);
  narrowMq.addEventListener('change', applyView);
}
