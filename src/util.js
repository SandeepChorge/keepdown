// Small helpers shared by every module.

export const $ = id => document.getElementById(id);
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = IS_MAC ? '⌘' : 'Ctrl';
export const narrowMq = matchMedia('(max-width: 820px)');

/** localStorage that never throws: private windows and blocked storage give null / false instead. */
export const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const stripInline = s => s
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/[*_~`]+/g, '')
  .trim();

export const fmtNum = new Intl.NumberFormat();
export const fmtDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
export const fmtDayYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const fmtFull = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function rel(ts) {
  const now = new Date(), d = new Date(ts), diff = now - d;
  if (diff < 45e3) return 'just now';
  if (diff < 36e5) return Math.max(1, Math.round(diff / 6e4)) + ' min ago';
  if (d.toDateString() === now.toDateString()) return Math.round(diff / 36e5) + ' h ago';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.getFullYear() === now.getFullYear() ? fmtDay.format(d) : fmtDayYear.format(d);
}

export function slug(s) {
  return (s || 'note').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'note';
}
