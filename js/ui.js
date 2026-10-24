// Small UI helpers shared by the screens: icons, escaping, dates, sheets and toasts.
import { today, addDays } from './model.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rupees = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + 's'}`;

const ico = (d, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const I = {
  home: ico('<path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>'),
  plan: ico('<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 9h6M9 13h6M9 17h3"/>'),
  list: ico('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  family: ico('<circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.6c.6-.2 1.3-.3 2-.3 2.8 0 4.5 2.2 4.5 5"/>'),
  camera: ico('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.5"/>'),
  mic: ico('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  stop: ico('<rect x="7" y="7" width="10" height="10" rx="2"/>'),
  check: ico('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  x: ico('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: ico('<path d="M12 5v14M5 12h14"/>'),
  minus: ico('<path d="M5 12h14"/>'),
  chev: ico('<path d="m9 6 6 6-6 6"/>'),
  back: ico('<path d="m15 6-6 6 6 6"/>'),
  share: ico('<path d="M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M12 3v12M7.5 7.5 12 3l4.5 4.5"/>'),
  clock: ico('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 'sm'),
  people: ico('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.5-3 2.7-5 5.5-5s5 2 5.5 5"/><circle cx="17" cy="9.5" r="2.2"/><path d="M16 14.2c2.4 0 4 1.8 4.5 4.3"/>', 'sm'),
  star: ico('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  copy: ico('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  history: ico('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4"/><path d="M12 8v4l3 2"/>'),
  restore: ico('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  edit: ico('<path d="M4 20h4L19 9l-4-4L4 16z"/>', 'sm'),
  bell: ico('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  repeat: ico('<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>', 'sm'),
  chart: ico('<path d="M4 20h16"/><rect x="6" y="11" width="3" height="6" rx="1"/><rect x="11" y="6" width="3" height="11" rx="1"/><rect x="16" y="13" width="3" height="4" rx="1"/>'),
  chat: ico('<path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5z"/>'),
  cloud: ico('<path d="M7 18.5h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.6 4.5 4.5 0 0 0 7 18.5z"/>'),
  leaf: ico('<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l6-6"/>', 'sm'),
};

export function avatar(m, size = '') {
  if (!m) return '';
  const initial = esc((m.name || '?').trim()[0]?.toUpperCase() || '?');
  return `<span class="avatar ${size}" style="--h:${m.hue ?? 160}" aria-hidden="true">${initial}</span>`;
}

// ---------- Dates ----------
const dt = (d) => new Date(d + 'T12:00');
export function dayName(d, style = 'short') {
  if (d === today()) return 'Today';
  if (d === addDays(today(), 1)) return 'Tomorrow';
  if (d === addDays(today(), -1)) return 'Yesterday';
  return dt(d).toLocaleDateString('en-IN', style === 'long' ? { weekday: 'long', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' });
}
export const weekday = (d) => dt(d).toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();
export const dayNum = (d) => dt(d).getDate();
export const longDate = (d) => dt(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
export function timeAgo(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const day = iso2(d);
  return day === today() ? `Today, ${time}` : `${dayName(day)}, ${time}`;
}
const iso2 = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const isoOf = iso2;
export const fmtTime = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toUpperCase();
};

// ---------- Sheet (bottom panel) ----------
const sheetRoot = () => $('#sheet-root');
let cleanup = null;
let pushed = false;

export function openSheet(html, { onMount, onClose, tall } = {}) {
  closeSheet(true);
  const root = sheetRoot();
  root.innerHTML = `<div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-modal="true">
      <div class="grip"></div>${html}
    </div>`;
  root.hidden = false;
  document.body.classList.add('locked');
  cleanup = onClose || null;
  if (!pushed) { history.pushState({ sheet: true }, ''); pushed = true; }
  const sheet = $('.sheet', root);
  onMount?.(sheet);
  const first = sheet.querySelector('[autofocus]');
  if (first) setTimeout(() => first.focus(), 60);
}

export function closeSheet(silent) {
  const root = sheetRoot();
  if (!root || root.hidden) return;
  cleanup?.();
  cleanup = null;
  root.hidden = true;
  root.innerHTML = '';
  document.body.classList.remove('locked');
  if (!silent && pushed) { pushed = false; history.back(); }
}
export const sheetOpen = () => !sheetRoot().hidden;

window.addEventListener('popstate', () => { pushed = false; closeSheet(true); });

// ---------- Toast ----------
let timer;
/** Show a message with an optional action button (Undo, Add anyway…). */
export function toast(message, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="toast-btn" data-action="toast-action">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  el._fn = action?.run || null;
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; el._fn = null; }, action ? 6000 : 3200);
}
export function runToastAction() {
  const el = $('#toast');
  const fn = el._fn;
  el.hidden = true; el._fn = null;
  fn?.();
}
