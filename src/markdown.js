// Markdown → safe HTML for the preview: GitHub-flavored Markdown, cleaned by DOMPurify,
// with highlighted code blocks and a Copy button on each one.

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

marked.use({ gfm: true, breaks: false });
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const hlCache = new Map();

export function renderMarkdown(el, src) {
  if (!src.trim()) { el.innerHTML = '<p class="md-empty">Nothing to preview yet.</p>'; return; }
  el.innerHTML = DOMPurify.sanitize(marked.parse(src), { ADD_ATTR: ['target'] });
  for (const t of el.querySelectorAll('table')) {
    const w = document.createElement('div'); w.className = 'table-wrap';
    t.replaceWith(w); w.append(t);
  }
  for (const c of el.querySelectorAll('pre code')) {
    const lang = (c.className.match(/language-([\w+#.-]+)/) || [])[1];
    if (lang && hljs.getLanguage(lang)) {
      const key = lang + '\u0000' + c.textContent;
      let h = hlCache.get(key);
      if (h === undefined) {
        try { h = hljs.highlight(c.textContent, { language: lang, ignoreIllegals: true }).value; } catch { h = null; }
        hlCache.set(key, h);
        if (hlCache.size > 300) hlCache.delete(hlCache.keys().next().value);
      }
      if (h != null) c.innerHTML = h;
    }
    c.parentElement.insertAdjacentHTML('beforeend', '<button class="copy-code" type="button">Copy</button>');
  }
}
