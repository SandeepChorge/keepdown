// GitHub sync: each note is a Markdown file at notes/<id>.md in a private repository.
// Changes upload a few seconds after typing stops, one commit each; other devices' changes
// are fetched when the tab regains focus and every couple of minutes.

import { state, sync, normalize, blankNote, metaOf, saveLocalSoon, saveLocalNow } from './notes.js';
import { ls, fmtFull } from './util.js';
import { on, emit } from './events.js';

export const DEFAULT_REPO = 'SandeepChorge/keepdown-notes';
const LS_GH = 'keepdown.github.v1';

export const gh = {
  token: '', owner: '', repo: '', branch: '',
  status: 'off',            // off | syncing | on | offline | error | auth
  error: '', busy: false, lastSync: 0, flushing: false,
};

export function loadGhCfg() {
  try {
    const c = JSON.parse(ls.get(LS_GH) || 'null');
    if (c && c.token && c.owner && c.repo) Object.assign(gh, { token: c.token, owner: c.owner, repo: c.repo, branch: c.branch || 'main', status: 'syncing' });
  } catch {}
}
function saveGhCfg() { ls.set(LS_GH, JSON.stringify({ token: gh.token, owner: gh.owner, repo: gh.repo, branch: gh.branch })); }

/* ---------- GitHub API ---------- */
const enc = encodeURIComponent;
const repoPath = () => '/repos/' + enc(gh.owner) + '/' + enc(gh.repo);
const notePath = id => repoPath() + '/contents/notes/' + enc(id) + '.md';
export const fullRepo = () => gh.owner + '/' + gh.repo;
const repoUrl = path => 'https://github.com/' + enc(gh.owner) + '/' + enc(gh.repo) + path;
export const noteHistoryUrl = id => repoUrl('/commits/' + enc(gh.branch) + '/notes/' + enc(id) + '.md');
export const notesFolderUrl = () => repoUrl('/tree/' + enc(gh.branch) + '/notes');

async function api(method, path, body, { keepalive = false } = {}) {
  const headers = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + gh.token, 'X-GitHub-Api-Version': '2022-11-28' };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch('https://api.github.com' + path, { method, headers, cache: 'no-store', keepalive, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  if (res.status !== 204) { try { data = await res.json(); } catch {} }
  if (!res.ok) {
    const err = new Error((data && data.message) || 'HTTP ' + res.status);
    err.status = res.status;
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') err.rateLimited = true;
    throw err;
  }
  return data;
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
/** The file format: a short header with created/updated/pinned, then the note's Markdown. */
function serialize(n) {
  return '---\ncreated: ' + new Date(n.createdAt).toISOString()
    + '\nupdated: ' + new Date(n.updatedAt).toISOString()
    + (n.pinned ? '\npinned: true' : '') + '\n---\n' + n.body;
}
function parseFile(text) {
  text = text.replace(/\r\n/g, '\n');
  const m = text.match(/^---\n((?:[A-Za-z]+:[^\n]*\n)+)---\n/);
  if (!m) return { body: text, created: 0, updated: 0, pinned: false };
  const meta = {};
  for (const line of m[1].trim().split('\n')) { const i = line.indexOf(':'); meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  if (!('created' in meta) && !('updated' in meta)) return { body: text, created: 0, updated: 0, pinned: false };
  return { body: text.slice(m[0].length), created: Date.parse(meta.created) || 0, updated: Date.parse(meta.updated) || 0, pinned: meta.pinned === 'true' };
}
async function getBlob(sha) { const b = await api('GET', repoPath() + '/git/blobs/' + sha); return b64decode(b.content || ''); }
async function getRemoteFile(id) {
  try {
    const f = await api('GET', notePath(id) + '?ref=' + enc(gh.branch));
    return { sha: f.sha, text: f.content ? b64decode(f.content) : await getBlob(f.sha) };
  } catch (e) { if (e.status === 404) return null; throw e; }
}
async function listRemote() {
  let tree;
  try { tree = await api('GET', repoPath() + '/git/trees/' + enc(gh.branch) + '?recursive=1'); }
  catch (e) { if (e.status === 409) return new Map(); throw e; }   // empty repository
  const m = new Map();
  for (const t of tree.tree || []) {
    const hit = t.type === 'blob' && /^notes\/([^/]+)\.md$/.exec(t.path);
    if (hit) m.set(hit[1], t.sha);
  }
  return m;
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/* one GitHub operation sequence at a time: parallel commits to one branch conflict */
let lock = Promise.resolve();
function exclusive(fn) { const run = lock.then(fn); lock = run.catch(() => {}); return run; }

function rememberOld(n, sha) { if (sha && !n.oldShas.includes(sha)) { n.oldShas.push(sha); if (n.oldShas.length > 10) n.oldShas.shift(); } }
function addConflictCopy(p) {
  const c = blankNote();
  const notice = '> Conflict copy: this version was saved on another device on ' + fmtFull.format(p.updated || Date.now()) + '.\n\n';
  const head = /^(\s*#{1,6} [^\n]*\n+)/.exec(p.body);   // keep the note's own heading first so its title stays the same
  c.body = head ? head[1] + notice + p.body.slice(head[1].length) : notice + p.body;
  c.pinned = false; c.dirty = true;
  state.notes.set(c.id, c);
  emit('toast', 'A note was changed on two devices. Both versions are kept.', { ms: 6000 });
}

/* ---------- pulling changes ---------- */
async function reconcile(remote) {
  const need = [];
  for (const [id, sha] of remote) {
    const t = sync.tomb.get(id);
    if (t) { if (!t.sha) t.sha = sha; continue; }
    if (sync.deletedShas.has(sha)) continue;
    const n = state.notes.get(id);
    if (n && (n.sha === sha || n.oldShas.includes(sha))) continue;
    need.push([id, sha]);
  }
  const got = await mapLimit(need, 6, async ([id, sha]) => [id, sha, parseFile(await getBlob(sha))]);
  let activeChanged = false;
  for (const [id, sha, p] of got) {
    const n = state.notes.get(id);
    const now = Date.now();
    const r = normalize({ id, body: p.body, createdAt: p.created || now, updatedAt: p.updated || now, pinned: p.pinned, sha });
    if (!n) { state.notes.set(id, r); continue; }
    if (!n.dirty) {
      r.oldShas = n.oldShas.slice(); rememberOld(r, n.sha);
      state.notes.set(id, r);
      if (id === state.activeId) activeChanged = true;
      continue;
    }
    if (p.body !== n.body) addConflictCopy(p);
    rememberOld(n, n.sha);
    n.sha = sha;
    if (p.body === n.body && p.pinned === n.pinned) n.dirty = false;
  }
  const now = Date.now();
  for (const [id, n] of [...state.notes]) {
    if (remote.has(id) || !n.sha) continue;
    if (now - n.pushedAt < 90000) continue;     // our own recent write may not be listed yet
    if (n.dirty) { n.sha = null; continue; }     // deleted elsewhere but edited here: upload again
    state.notes.delete(id);                      // deleted on another device
  }
  for (const [id, t] of [...sync.tomb]) if (!remote.has(id) && now - t.at > 90000) sync.tomb.delete(id);
  if (activeChanged) emit('active-replaced');
}

let syncPending = null, retryTimer = 0;
function retrySync(ms) { clearTimeout(retryTimer); retryTimer = setTimeout(() => syncNow(), ms); }
export function syncNow() {
  if (!gh.token || gh.status === 'auth') return Promise.resolve();
  if (syncPending) return syncPending;
  syncPending = exclusive(async () => {
    gh.busy = true; emit('status');
    try {
      const remote = await listRemote();
      await reconcile(remote);
      gh.status = 'on'; gh.error = ''; gh.lastSync = Date.now();
    } catch (e) { handleGhError(e); }
    finally {
      gh.busy = false; syncPending = null;
      saveLocalSoon();
      emit('notes');
    }
  }).then(() => { if (gh.status === 'on') pump(); });
  return syncPending;
}

/* ---------- pushing changes ---------- */
const pushable = n => n.dirty && (n.sha || n.body.trim());
function nextJob(force) {
  for (const id of sync.tomb.keys()) return { del: id };
  const now = Date.now();
  for (const n of state.notes.values()) if (pushable(n) && (force || n.dueAt <= now)) return { n };
  return null;
}
function nextDueIn() {
  let min = null;
  for (const n of state.notes.values()) if (pushable(n)) min = min == null ? n.dueAt : Math.min(min, n.dueAt);
  return min == null ? null : Math.max(0, min - Date.now()) + 50;
}
let pumpTimer = 0, pumpQueued = false, forceNext = false;
function schedulePump(ms) { clearTimeout(pumpTimer); pumpTimer = setTimeout(() => pump(), Math.max(0, ms)); }
on('dirty', schedulePump);

/** Uploads every pending change, one at a time. `force` skips the typing delay. */
export function pump(force = false) {
  if (!gh.token || gh.status === 'auth') return Promise.resolve();
  if (force) forceNext = true;
  if (pumpQueued) return lock;
  pumpQueued = true;
  return exclusive(async () => {
    pumpQueued = false;
    const forceAll = forceNext; forceNext = false;
    gh.busy = true; emit('status');
    try {
      for (let guard = 0; guard < 500; guard++) {
        const job = nextJob(forceAll);
        if (!job) break;
        if (job.del) await deleteRemote(job.del); else await putNote(job.n);
        emit('status');
      }
      if (gh.status !== 'on') { gh.status = 'on'; gh.error = ''; }
    } catch (e) { handleGhError(e); }
    finally {
      gh.busy = false;
      saveLocalSoon(); emit('status'); emit('list');
      const w = nextDueIn();
      if (w != null && gh.status === 'on') schedulePump(w);
    }
  });
}
async function putNote(n) {
  const sent = n.changedAt;
  const text = serialize(n);
  const title = (metaOf(n).title || 'Empty note').slice(0, 60);
  try {
    const res = await api('PUT', notePath(n.id), {
      message: (n.sha ? 'Update' : 'Add') + ' "' + title + '"',
      content: b64encode(text), branch: gh.branch, ...(n.sha ? { sha: n.sha } : {}),
    }, { keepalive: gh.flushing && text.length < 30000 });
    rememberOld(n, n.sha);
    n.sha = res.content.sha; n.pushedAt = Date.now(); n.tries = 0;
    if (state.notes.get(n.id) === n && n.changedAt === sent) n.dirty = false;
  } catch (e) {
    if (e.status !== 409 && e.status !== 422) throw e;
    if (++n.tries > 3) { n.tries = 0; throw e; }
    const cur = await getRemoteFile(n.id);   // changed on another device since we last saw it
    if (!cur) { n.sha = null; return; }
    const p = parseFile(cur.text);
    rememberOld(n, n.sha);
    n.sha = cur.sha;
    if (p.body !== n.body) addConflictCopy(p);
    else if (p.pinned === n.pinned) n.dirty = false;
  }
}
async function deleteRemote(id) {
  const t = sync.tomb.get(id);
  try {
    if (!t.sha) { const cur = await getRemoteFile(id); if (!cur) { sync.tomb.delete(id); return; } t.sha = cur.sha; }
    await api('DELETE', notePath(id), { message: 'Delete "' + (t.title || id).slice(0, 60) + '"', sha: t.sha, branch: gh.branch }, { keepalive: gh.flushing });
  } catch (e) {
    if (e.status === 409 || e.status === 422) { t.sha = null; if (++t.tries > 3) { sync.tomb.delete(id); throw e; } return; }
    if (e.status !== 404) throw e;
  }
  if (t.sha) sync.deletedShas.add(t.sha);
  sync.tomb.delete(id);
}
function handleGhError(e) {
  const s = e && e.status;
  if (s === 401) { gh.status = 'auth'; gh.error = 'GitHub no longer accepts the saved token. It may have expired.'; }
  else if (e && e.rateLimited || s === 429) { gh.status = 'error'; gh.error = 'GitHub rate limit reached. Retrying in a minute.'; retrySync(60000); }
  else if (s === 403 || s === 404) { gh.status = 'auth'; gh.error = 'The saved token cannot write to ' + fullRepo() + '. It needs Contents: Read and write.'; }
  else if (!s) { gh.status = 'offline'; gh.error = 'Offline. Notes are kept in this browser until GitHub is reachable.'; retrySync(20000); }
  else { gh.status = 'error'; gh.error = 'GitHub returned an error (' + s + '). Retrying shortly.'; retrySync(30000); }
  emit('status');
}

/* ---------- connecting ---------- */
function rebind(full) {
  for (const n of state.notes.values()) { n.sha = null; n.oldShas = []; n.pushedAt = 0; n.dirty = !!n.body.trim(); n.dueAt = 0; }
  sync.tomb.clear(); sync.deletedShas.clear();
  sync.boundRepo = full;
}
export async function connect(repoInput, tokenInput) {
  const m = repoInput.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new Error('Enter the repository as owner/name, for example ' + DEFAULT_REPO + '.');
  const token = tokenInput.trim();
  if (!token) throw new Error('Paste the token you created on GitHub.');
  const prev = { token: gh.token, owner: gh.owner, repo: gh.repo, branch: gh.branch, status: gh.status };
  Object.assign(gh, { token, owner: m[1], repo: m[2] });
  let info;
  try { info = await api('GET', repoPath()); }
  catch (e) {
    Object.assign(gh, prev);
    if (e.status === 401) throw new Error('GitHub did not accept that token. Check that you copied all of it.');
    if (e.status === 403 || e.status === 404) throw new Error('That token cannot see ' + m[1] + '/' + m[2] + '. Give it access to this repository.');
    if (!e.status) throw new Error('Could not reach GitHub. Check your connection and try again.');
    throw new Error('GitHub returned an error: ' + e.message);
  }
  if (!info.private) {
    Object.assign(gh, prev);
    throw new Error(m[1] + '/' + m[2] + ' is public, so anyone could read your notes. Make it private on GitHub first.');
  }
  gh.owner = info.owner.login; gh.repo = info.name; gh.branch = info.default_branch || 'main';
  if (sync.boundRepo.toLowerCase() !== fullRepo().toLowerCase()) rebind(fullRepo());
  gh.status = 'syncing'; gh.error = '';
  saveGhCfg(); saveLocalNow();
  await syncNow();
  if (gh.status === 'auth') throw new Error(gh.error);
}
export function disconnect() {
  ls.del(LS_GH);
  clearTimeout(retryTimer); clearTimeout(pumpTimer);
  Object.assign(gh, { token: '', status: 'off', error: '', busy: false });
  emit('notes');
}
function flushOnHide() {
  saveLocalNow();
  if (!gh.token || gh.status === 'auth') return;
  gh.flushing = true;
  pump(true).finally(() => { gh.flushing = false; });
}

/** Starts syncing (if connected) and keeps it going: on leaving the tab, coming back, going online, and every couple of minutes. */
export function initSync() {
  window.addEventListener('pagehide', flushOnHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide();
    else if (gh.token && Date.now() - gh.lastSync > 20000) syncNow();
  });
  window.addEventListener('online', () => { if (gh.token) { if (gh.status === 'offline') gh.status = 'syncing'; syncNow(); } });
  setInterval(() => {
    if (gh.token && document.visibilityState === 'visible' && Date.now() - gh.lastSync > 110000) syncNow();
  }, 60000);
  if (gh.token) syncNow();
}
