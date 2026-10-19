// The "Sync notes with GitHub" dialog: connect with a token, or see sync status and disconnect.

import { $, fmtFull, fmtNum } from './util.js';
import { state, sync } from './notes.js';
import { gh, DEFAULT_REPO, fullRepo, notesFolderUrl, connect, disconnect, pump, syncNow } from './github.js';
import { toast, closeDrawer } from './ui.js';

const dlg = $('ghDialog');
export const isDialogOpen = () => dlg.open;

export function openGhDialog() {
  const connected = !!gh.token && gh.status !== 'auth';
  $('ghSetup').hidden = connected;
  $('ghInfo').hidden = !connected;
  const err = $('ghErr');
  if (connected) {
    const a = $('ghRepoLink');
    a.textContent = fullRepo();
    a.href = notesFolderUrl();
    $('ghLast').textContent = gh.lastSync ? fmtFull.format(gh.lastSync) + (gh.error ? ' · ' + gh.error : '') : (gh.error || 'Not yet');
    $('ghCount').textContent = fmtNum.format(state.notes.size);
  } else {
    $('ghRepo').value = gh.token ? fullRepo() : (sync.boundRepo || DEFAULT_REPO);
    $('ghToken').value = '';
    err.hidden = !(gh.status === 'auth' && gh.error);
    err.textContent = gh.status === 'auth' ? gh.error + ' Paste a new token to reconnect.' : '';
    updateTokenHints();
  }
  closeDrawer();
  try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
  if (!connected) setTimeout(() => $('ghToken').focus(), 30);
}

/** Points "Create a fine-grained token" at GitHub's form, pre-filled for the repository typed in. */
function updateTokenHints() {
  const parts = $('ghRepo').value.trim().split('/');
  const owner = parts[0] || 'SandeepChorge', repo = parts[1] || 'keepdown-notes';
  $('repoHint').textContent = repo;
  const q = new URLSearchParams({ name: 'Keepdown sync', description: 'Lets Keepdown save notes to ' + owner + '/' + repo, target_name: owner, expires_in: '366', contents: 'write' });
  $('tokenLink').href = 'https://github.com/settings/personal-access-tokens/new?' + q;
}

export function initDialog() {
  $('ghRepo').addEventListener('input', updateTokenHints);
  dlg.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === dlg) dlg.close(); });
  $('ghSetup').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('ghConnect'), err = $('ghErr');
    btn.disabled = true; btn.textContent = 'Connecting…'; err.hidden = true;
    try {
      await connect($('ghRepo').value, $('ghToken').value);
      $('ghToken').value = '';
      dlg.close();
      toast('Connected. Notes now sync to ' + fullRepo() + '.');
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Connect';
    }
  });
  $('ghSyncNow').addEventListener('click', async () => {
    const b = $('ghSyncNow'); b.disabled = true; b.textContent = 'Syncing…';
    await pump(true); await syncNow();
    b.disabled = false; b.textContent = 'Sync now';
    openGhDialog();
  });
  $('ghDisconnect').addEventListener('click', () => {
    dlg.close();
    disconnect();
    toast('This device is disconnected. Your notes stay on GitHub and in this browser.', { ms: 5000 });
  });
}
