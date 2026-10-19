// Getting text in and out: copy to clipboard, download a note, import files, back up everything.

import { MOD, IS_MAC, slug } from './util.js';
import { state, sync, active, normalize, newId, createNote, markDirty, sortedNotes, metaOf, saveLocalSoon } from './notes.js';
import { toast, openNote, renderAll } from './ui.js';

export async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); return; } catch {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  toast(ok ? msg : 'Copy was blocked. Select the text and press ' + MOD + (IS_MAC ? 'C' : '+C') + '.');
}
export function copyActive() { const n = active(); if (n) copyText(n.body, 'Copied Markdown'); }

function offerFile(filename, data) {
  const type = filename.endsWith('.json') ? 'application/json' : 'text/markdown';
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Downloaded ' + filename);
}
export function downloadActive() { const n = active(); if (n) offerFile(slug(metaOf(n).title) + '.md', n.body || '\n'); }

export function exportAll() {
  if (!state.notes.size) { toast('No notes to back up yet.'); return; }
  const notes = sortedNotes().map(({ id, body, createdAt, updatedAt, changedAt, pinned }) => ({ id, body, createdAt, updatedAt, changedAt, pinned }));
  const day = new Date().toISOString().slice(0, 10);
  offerFile('keepdown-backup-' + day + '.json', JSON.stringify({ app: 'keepdown', version: 1, exportedAt: new Date().toISOString(), notes }, null, 2));
}

const isMdFile = f => /\.(md|markdown|mdown|txt)$/i.test(f.name) || /^text\//.test(f.type);
/** Adds .md / .txt files as notes; a Keepdown backup (.json) restores its notes, keeping whichever copy is newer. */
export async function importFiles(files) {
  let added = 0, skipped = 0, lastId = null;
  for (const f of files) {
    const isJson = /\.json$/i.test(f.name) || f.type === 'application/json';
    if (f.size > 5 * 1024 * 1024 || (!isJson && !isMdFile(f))) { skipped++; continue; }
    let text = '';
    try { text = await f.text(); } catch { skipped++; continue; }
    if (isJson) {
      let arr = null;
      try { const d = JSON.parse(text); arr = Array.isArray(d) ? d : d && d.notes; } catch {}
      if (!Array.isArray(arr)) { skipped++; continue; }
      for (const raw of arr) {
        if (!raw || typeof raw.body !== 'string') continue;
        const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : newId();
        const ex = state.notes.get(id);
        const inc = normalize({ ...raw, id, sha: ex ? ex.sha : null, oldShas: ex ? ex.oldShas : [] });
        if (ex && ex.changedAt >= inc.changedAt) continue;
        sync.tomb.delete(id);
        state.notes.set(id, inc);
        markDirty(inc, 0);
        added++; lastId = id;
      }
    } else {
      if (!text.trim()) { skipped++; continue; }
      const n = createNote(text.replace(/\r\n/g, '\n'));
      if (f.lastModified) n.createdAt = Math.min(n.createdAt, f.lastModified);
      added++; lastId = n.id;
    }
  }
  saveLocalSoon();
  if (lastId) openNote(lastId); else renderAll();
  toast(added ? 'Added ' + added + (added === 1 ? ' note' : ' notes') + (skipped ? ', skipped ' + skipped + ' file' + (skipped === 1 ? '' : 's') : '')
              : 'Nothing to import. Use .md, .txt or a Keepdown backup file.');
}
