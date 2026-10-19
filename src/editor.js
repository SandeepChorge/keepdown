// Editing helpers for the plain textarea: Tab indents (Esc then Tab moves focus on),
// Enter continues lists and checklists, and the split view scrolls both sides together.

export function setupEditor(editor, previewPane, isSplitView) {
  function replaceSelection(text) {
    editor.focus();
    let ok = false;
    try { ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete'); } catch {}
    if (!ok) {
      editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function indent(outdent) {
    const v = editor.value, s = editor.selectionStart, e = editor.selectionEnd;
    if (!outdent && s === e) { replaceSelection('  '); return; }
    const start = v.lastIndexOf('\n', s - 1) + 1;
    let end = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e);
    if (end === -1) end = v.length;
    const block = v.slice(start, end);
    const out = block.split('\n').map(l => outdent ? l.replace(/^( {1,2}|\t)/, '') : '  ' + l).join('\n');
    if (out === block) return;
    editor.setSelectionRange(start, end);
    replaceSelection(out);
    editor.setSelectionRange(start, start + out.length);
  }
  function continueList(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false;
    const v = editor.value, s = editor.selectionStart;
    if (s !== editor.selectionEnd) return false;
    const ls0 = v.lastIndexOf('\n', s - 1) + 1;
    const line = v.slice(ls0, s);
    const m = line.match(/^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/);
    if (!m) return false;
    e.preventDefault();
    let lineEnd = v.indexOf('\n', s); if (lineEnd === -1) lineEnd = v.length;
    if (!line.slice(m[0].length).trim() && !v.slice(s, lineEnd).trim()) {
      editor.setSelectionRange(ls0, s);
      replaceSelection('');
      return true;
    }
    const marker = m[3] ? (parseInt(m[3], 10) + 1) + m[4] : m[2];
    replaceSelection('\n' + m[1] + marker + m[5] + (m[6] ? '[ ] ' : ''));
    return true;
  }

  let tabTrap = true;
  editor.addEventListener('focus', () => { tabTrap = true; });
  editor.addEventListener('keydown', e => {
    if (e.key === 'Escape') { tabTrap = false; return; }
    if (e.key === 'Tab' && tabTrap && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); indent(e.shiftKey); return; }
    if (e.key !== 'Tab') tabTrap = true;
    continueList(e);
  });

  let lockSrc = '', lockUntil = 0;
  function syncScroll(from, to, src) {
    if (!isSplitView()) return;
    if (lockSrc && lockSrc !== src && performance.now() < lockUntil) return;
    const r = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    lockSrc = src; lockUntil = performance.now() + 120;
    to.scrollTop = r * (to.scrollHeight - to.clientHeight);
  }
  editor.addEventListener('scroll', () => syncScroll(editor, previewPane, 'e'), { passive: true });
  previewPane.addEventListener('scroll', () => syncScroll(previewPane, editor, 'p'), { passive: true });
}
