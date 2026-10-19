// Starts Keepdown: loads saved notes, connects buttons and shortcuts, then begins syncing.

import './styles.css';
import { $ } from './util.js';
import { state, loadLocal, loadPrefs, firstId, saveLocalNow } from './notes.js';
import { gh, loadGhCfg, initSync, pump } from './github.js';
import { renderMarkdown } from './markdown.js';
import { setupEditor } from './editor.js';
import {
  app, editor, previewPane, initUI, toast, closeDrawer, toggleDrawer, effectiveView, setView,
  renderAll, renderList, renderMeta, renderPos, applyActiveToEditor, openNote, newNote,
  deleteActiveNote, togglePin, handleEditorInput,
} from './ui.js';
import { copyText, copyActive, downloadActive, exportAll, importFiles } from './files.js';
import { initDialog, openGhDialog, isDialogOpen } from './dialog.js';
import { initPrefs, toggleRail, focusSearch } from './prefs.js';

initUI();
initDialog();
initPrefs();

/* ---------- editor ---------- */
setupEditor(editor, previewPane, () => effectiveView() === 'split');
editor.addEventListener('input', handleEditorInput);
for (const ev of ['keyup', 'click', 'select', 'focus']) editor.addEventListener(ev, renderPos);

/* ---------- buttons ---------- */
$('menuBtn').addEventListener('click', toggleDrawer);
$('scrim').addEventListener('click', closeDrawer);
for (const id of ['newBtn', 'emptyNew', 'miniNew']) $(id).addEventListener('click', () => newNote());
for (const id of ['emptySync', 'store', 'miniStore']) $(id).addEventListener('click', openGhDialog);
$('miniSearch').addEventListener('click', focusSearch);

$('list').addEventListener('click', e => {
  const b = e.target.closest('.item');
  if (b && state.notes.has(b.dataset.id)) openNote(b.dataset.id);
});
$('search').addEventListener('input', e => { state.query = e.target.value; renderList(); });
$('search').addEventListener('keydown', e => {
  if (e.key === 'Enter') { const b = $('list').querySelector('.item'); if (b) openNote(b.dataset.id); }
  if (e.key === 'Escape' && state.query) { e.stopPropagation(); e.target.value = ''; state.query = ''; renderList(); }
});
$('viewSeg').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
$('pinBtn').addEventListener('click', togglePin);
$('copyBtn').addEventListener('click', copyActive);
$('dlBtn').addEventListener('click', downloadActive);
$('delBtn').addEventListener('click', deleteActiveNote);

const fileInput = $('fileInput');
const pickFiles = () => { fileInput.value = ''; fileInput.click(); };
$('importBtn').addEventListener('click', pickFiles);
$('miniImport').addEventListener('click', pickFiles);
fileInput.addEventListener('change', () => { if (fileInput.files.length) importFiles([...fileInput.files]); });
$('exportBtn').addEventListener('click', exportAll);
$('miniExport').addEventListener('click', exportAll);

document.addEventListener('click', e => {
  const b = e.target.closest('.copy-code');
  if (!b) return;
  const code = b.parentElement.querySelector('code');
  copyText(code ? code.textContent : '', 'Copied code');
});

/* paste anywhere outside a text field = new note */
document.addEventListener('paste', e => {
  const t = e.target;
  if (isDialogOpen() || (t && t.closest && t.closest('input, textarea, [contenteditable="true"]'))) return;
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (!text || !text.trim()) return;
  e.preventDefault();
  newNote(text.replace(/\r\n/g, '\n'));
  toast('Saved your paste as a new note');
});

/* drag and drop files */
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
document.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
document.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
  if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]);
});

/* keyboard */
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') {
    e.preventDefault(); saveLocalNow();
    if (gh.token && gh.status !== 'auth') pump(true).then(() => toast(gh.status === 'on' ? 'Saved to GitHub' : 'Saved in this browser. GitHub will catch up.'));
    else toast('Saved in this browser');
  }
  else if (mod && k === 'k') { e.preventDefault(); focusSearch(); }
  else if (mod && e.key === '\\') { e.preventDefault(); toggleRail(); }
  else if (e.altKey && !mod && e.code === 'KeyN') { e.preventDefault(); newNote(); }
  else if (e.key === 'Escape' && app.classList.contains('drawer-open')) closeDrawer();
});

/* keep "5 min ago" labels current */
setInterval(() => { renderList(); renderMeta(); }, 60000);

/* ---------- example for the empty state ---------- */
const EXAMPLE = [
  '# Release checklist · v2.4',
  '',
  'Pasted from the team thread so it is here next quarter.',
  '',
  '- [x] Bump `versionCode` to **241**',
  '- [x] Tag `release/2.4.0`',
  '- [ ] Upload the AAB to Play Console',
  '',
  '```bash',
  './gradlew bundleRelease',
  '```',
  '',
  '| Track | Rollout |',
  '|---|---|',
  '| Internal | 100% |',
  '| Production | 10% |',
].join('\n');
$('exampleSrc').textContent = EXAMPLE;
renderMarkdown($('exampleOut'), EXAMPLE);

/* ---------- boot ---------- */
loadLocal();
loadGhCfg();
const prefs = loadPrefs();
if (['write', 'split', 'read'].includes(prefs.view)) state.view = prefs.view;
state.activeId = state.notes.has(prefs.activeId) ? prefs.activeId : firstId();
applyActiveToEditor(false);
renderAll();
initSync();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
