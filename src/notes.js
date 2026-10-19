// Notes and everything kept in the browser: the note list, the open note, view settings,
// and the bookkeeping GitHub sync needs between visits.

import { ls, stripInline } from './util.js';
import { emit } from './events.js';

const LS_NOTES = 'keepdown.notes.v2', LS_PREFS = 'keepdown.prefs.v1';
const PUSH_DELAY = 4000;

export const state = { notes: new Map(), activeId: null, view: 'split', query: '', storageOk: true };

/** Saved with the notes so sync can resume correctly after a reload. */
export const sync = {
  boundRepo: '',            // repo the cached notes' file versions belong to
  tomb: new Map(),          // id -> {sha, title, at, tries}: deleted here, still to delete on GitHub
  deletedShas: new Set(),   // file versions this device deleted (ignore if a stale listing shows them)
};

/* ---------- local persistence ---------- */
export function normalize(n) {
  const now = Date.now();
  const updatedAt = +n.updatedAt || now;
  return {
    id: String(n.id), body: String(n.body ?? '').replace(/\r\n/g, '\n'),
    createdAt: +n.createdAt || updatedAt, updatedAt, changedAt: +n.changedAt || updatedAt,
    pinned: !!n.pinned,
    sha: typeof n.sha === 'string' ? n.sha : null,
    dirty: !!n.dirty, dueAt: 0,
    oldShas: Array.isArray(n.oldShas) ? n.oldShas.filter(s => typeof s === 'string').slice(-10) : [],
    pushedAt: +n.pushedAt || 0, tries: 0,
  };
}
export function loadLocal() {
  state.storageOk = ls.set('keepdown.probe', '1');
  const raw = ls.get(LS_NOTES);
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    sync.boundRepo = typeof d.repo === 'string' ? d.repo : '';
    for (const n of d.notes || []) if (n && typeof n.id === 'string' && typeof n.body === 'string') state.notes.set(n.id, normalize(n));
    for (const [id, t] of d.tomb || []) if (typeof id === 'string' && t) sync.tomb.set(id, { sha: t.sha || null, title: t.title || '', at: +t.at || 0, tries: 0 });
    for (const s of d.deletedShas || []) if (typeof s === 'string') sync.deletedShas.add(s);
  } catch {}
}
let localTimer = 0;
export function saveLocalSoon() { clearTimeout(localTimer); localTimer = setTimeout(saveLocalNow, 250); }
export function saveLocalNow() {
  clearTimeout(localTimer);
  const notes = [...state.notes.values()].map(({ dueAt, tries, ...n }) => n);
  const tomb = [...sync.tomb].map(([id, { sha, title, at }]) => [id, { sha, title, at }]);
  const ok = ls.set(LS_NOTES, JSON.stringify({ v: 2, repo: sync.boundRepo, notes, tomb, deletedShas: [...sync.deletedShas].slice(-300) }));
  if (ok !== state.storageOk) { state.storageOk = ok; emit('storage'); }
  return ok;
}
export function loadPrefs() {
  try { const p = JSON.parse(ls.get(LS_PREFS) || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
}
export function savePrefs() { ls.set(LS_PREFS, JSON.stringify({ activeId: state.activeId, view: state.view })); }

/* ---------- notes ---------- */
export function newId() {
  const d = new Date(), p = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + Math.random().toString(36).slice(2, 8);
}
export const active = () => state.notes.get(state.activeId) || null;
export function blankNote() { return normalize({ id: newId(), body: '' }); }
export function markDirty(n, delay) {
  n.dirty = true;
  n.dueAt = Date.now() + delay;
  saveLocalSoon();
  emit('dirty', delay);
}
export function createNote(body = '') {
  const n = blankNote();
  n.body = body;
  state.notes.set(n.id, n);
  if (body.trim()) markDirty(n, 0); else saveLocalSoon();
  return n;
}
export function touch(n) { n.updatedAt = n.changedAt = Date.now(); markDirty(n, PUSH_DELAY); }
export function removeNote(id) {
  const n = state.notes.get(id);
  if (!n) return null;
  state.notes.delete(id);
  if (n.sha) { sync.tomb.set(id, { sha: n.sha, title: metaOf(n).title, at: Date.now(), tries: 0 }); emit('dirty', 0); }
  saveLocalSoon();
  return n;
}
/** Puts a deleted note back (Undo) and returns it. */
export function restoreNote(n) {
  const r = { ...n, changedAt: Date.now(), dueAt: 0, tries: 0 };
  if (sync.tomb.has(n.id)) sync.tomb.delete(n.id);   // delete never reached GitHub
  else if (r.sha) { r.sha = null; r.dirty = true; }    // it did: upload again
  state.notes.set(r.id, r);
  saveLocalSoon();
  emit('dirty', 0);
  return r;
}
export function sortedNotes() { return [...state.notes.values()].sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt)); }
export function firstId() { const s = sortedNotes(); return s.length ? s[0].id : null; }
/** When the open note is gone, opens the one last opened here, else the newest. Returns true if it changed. */
export function ensureActive() {
  if (state.notes.has(state.activeId)) return false;
  const p = loadPrefs();
  state.activeId = state.notes.has(p.activeId) ? p.activeId : firstId();
  return true;
}

/* ---------- titles, snippets, search ---------- */
const metaCache = new Map();
export function metaOf(n) {
  const c = metaCache.get(n.id);
  if (c && c.body === n.body) return c;
  let title = '', snip = '', fence = false;
  for (const raw of n.body.split('\n', 60)) {
    const t = raw.trim();
    if (/^(```|~~~)/.test(t)) { fence = !fence; continue; }
    if (!t || (!fence && /^(-{3,}|\*{3,}|_{3,}|\|?[\s:-]+\|[\s|:-]*)$/.test(t))) continue;
    const l = fence ? t : stripInline(t.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '').replace(/^\d+[.)]\s+/, '').replace(/\|/g, ' '));
    if (!l) continue;
    if (!title) title = l.slice(0, 100);
    else { snip += (snip ? ' ' : '') + l; if (snip.length > 160) break; }
  }
  const m = { body: n.body, title, snip: snip.slice(0, 160) };
  metaCache.set(n.id, m);
  return m;
}
export function terms() { return state.query.toLowerCase().split(/\s+/).filter(Boolean); }
