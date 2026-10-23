import { CATALOG, CATEGORIES, DISHES, STARTER } from './data.js';
import { parseSpeech, matchCatalog } from './parse.js';
import { load, save, fresh, fromBackup } from './store.js';
import { canListen, listen, speechError } from './speech.js';

// ---------- Text (one place, so Malayalam / Hindi can be added later) ----------
const STR = {
  tabs: { home: 'Home', list: 'List', kitchen: 'Kitchen', plan: 'Plan' },
  slots: { b: 'Breakfast', l: 'Lunch', d: 'Dinner' },
  levels: { full: 'Full', low: 'Low', out: 'Out' },
  repeat: { none: 'Once', daily: 'Every day', weekly: 'Every week' },
  langs: { 'en-IN': 'English', 'ml-IN': 'മലയാളം', 'hi-IN': 'हिंदी', 'ta-IN': 'தமிழ்' },
};

// ---------- Icons ----------
const ico = (d, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  home: ico('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  list: ico('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L22 7H6"/>'),
  kitchen: ico('<path d="M7 3h10v4H7z"/><path d="M5 7h14v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M9 12h6"/>'),
  plan: ico('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  camera: ico('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.5"/>'),
  mic: ico('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  stop: ico('<rect x="7" y="7" width="10" height="10" rx="2"/>'),
  gear: ico('<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/>'),
  check: ico('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  x: ico('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: ico('<path d="M12 5v14M5 12h14"/>'),
  share: ico('<path d="M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M12 3v12M7.5 7.5 12 3l4.5 4.5"/>'),
  chev: ico('<path d="m9 6 6 6-6 6"/>'),
  repeat: ico('<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>', 'sm'),
};

// ---------- Helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => iso();
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const dayLabel = (dateStr, long) => {
  if (dateStr === today()) return 'Today';
  if (dateStr === addDays(today(), 1)) return 'Tomorrow';
  const d = new Date(dateStr + 'T12:00');
  return d.toLocaleDateString('en-IN', long ? { weekday: 'long', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' });
};
const rupees = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const key = (name) => String(name).trim().toLowerCase();
const fmtQty = (it) => (it.qty == null ? '' : `${+(+it.qty).toFixed(2)}${it.unit ? ' ' + it.unit : ''}`);
const catOf = (name) => matchCatalog(name)?.cat || 'Other';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- State ----------
let state = load();
let tab = (() => { try { return localStorage.getItem('homzy:tab') || 'home'; } catch { return 'home'; } })();
let planDay = today();
let kitchenFilter = 'all';

function persist() {
  if (!save(state)) toast('Couldn’t save. Your phone storage may be full.');
  render();
}

/** Run a change, save it, and offer Undo. */
function act(message, change) {
  const before = JSON.stringify(state);
  change();
  persist();
  toast(message, () => { state = JSON.parse(before); persist(); });
}

const inList = (name) => state.list.find((i) => key(i.name) === key(name));
const inStock = (name) => state.stock.find((i) => key(i.name) === key(name));

function addToList(items) {
  let added = 0;
  for (const it of items) {
    const existing = inList(it.name);
    if (existing) {
      if (it.qty != null) { existing.qty = it.qty; existing.unit = it.unit; }
      continue;
    }
    state.list.push({ id: uid(), name: it.name, cat: it.cat || catOf(it.name), qty: it.qty ?? null, unit: it.unit ?? null, at: Date.now() });
    added++;
  }
  return added;
}

function setStock(name, level, cat) {
  const s = inStock(name);
  if (s) { s.level = level; s.at = Date.now(); }
  else state.stock.push({ id: uid(), name, cat: cat || catOf(name), level, at: Date.now() });
}

// ---------- Rendering ----------
const view = $('#view');

function render() {
  view.innerHTML = VIEWS[tab]();
  document.querySelectorAll('.tabs button').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const count = state.list.length;
  const badge = $('#list-badge');
  badge.textContent = count;
  badge.hidden = !count;
  $('#hello').textContent = tab === 'home' ? greeting() : state.home;
  $('#title').textContent = tab === 'home' ? state.home : STR.tabs[tab];
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const emptyBox = (title, text, extra = '') =>
  `<div class="empty"><p class="empty-title">${title}</p><p>${text}</p>${extra}</div>`;

// ----- Home -----
function homeView() {
  const t = today();
  const meals = state.meals[t] || {};
  const due = state.tasks.filter((x) => !x.done && x.due <= t).sort((a, b) => a.due.localeCompare(b.due));
  const low = state.stock.filter((s) => s.level !== 'full' && !inList(s.name));
  const isNew = !state.list.length && !state.stock.length && !state.bills.length && !state.tasks.length;

  const month = t.slice(0, 7);
  const lastMonth = iso(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)).slice(0, 7);
  const sum = (m) => state.bills.filter((b) => b.date.startsWith(m)).reduce((a, b) => a + (+b.total || 0), 0);
  const thisSpend = sum(month), lastSpend = sum(lastMonth);
  const billCount = state.bills.filter((b) => b.date.startsWith(month)).length;
  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });

  return `
    ${isNew ? `
    <section class="card hero">
      <p class="eyebrow">Welcome to Homzy</p>
      <h2>Less typing. More living.</h2>
      <ul class="steps">
        <li>${I.camera}<span><b>Scan</b> a shop bill and your kitchen fills itself.</span></li>
        <li>${I.mic}<span><b>Speak</b> “2 litre milk, 1 kg rice” to make a list.</span></li>
        <li>${I.kitchen}<span>Mark things <b>Low</b> or <b>Out</b>. They go on the list.</span></li>
      </ul>
      <button class="btn ghost" data-action="starter">Quick-fill my kitchen with ${STARTER.length} basics</button>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>Today’s meals</h2><button class="link" data-action="tab" data-tab="plan">Week ${I.chev}</button></div>
      <div class="slots">
        ${['b', 'l', 'd'].map((s) => `
          <button class="slot ${meals[s] ? '' : 'blank'}" data-action="pick-dish" data-date="${t}" data-slot="${s}">
            <span class="slot-label">${STR.slots[s]}</span>
            <span class="slot-dish">${meals[s] ? esc(meals[s]) : 'Choose'}</span>
          </button>`).join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>To do</h2>${due.length ? `<span class="count">${due.length}</span>` : ''}</div>
      ${due.length ? `<ul class="rows">${due.map(taskRow).join('')}</ul>` : '<p class="muted small">Nothing due. Nice.</p>'}
      ${taskForm()}
    </section>

    ${low.length ? `
    <section class="card">
      <div class="card-head"><h2>Running out</h2><button class="link" data-action="low-to-list">Add all to list</button></div>
      <div class="chips">
        ${low.map((s) => `<button class="chip lvl-${s.level}" data-action="low-one" data-id="${s.id}">${I.plus}${esc(s.name)}</button>`).join('')}
      </div>
    </section>` : ''}

    <button class="card spend" data-action="bills">
      <span>
        <span class="eyebrow">${monthName} spend</span>
        <span class="big">${rupees(thisSpend)}</span>
        <span class="muted small">${billCount ? plural(billCount, 'bill') : 'Scan a bill to start tracking'}${lastSpend ? ` · last month ${rupees(lastSpend)}` : ''}</span>
      </span>
      ${I.chev}
    </button>`;
}

function taskRow(x) {
  const late = x.due < today();
  const meta = [x.who && esc(x.who), x.repeat !== 'none' && STR.repeat[x.repeat], late && 'from ' + dayLabel(x.due), x.due > today() && dayLabel(x.due)].filter(Boolean).join(' · ');
  return `
    <li class="row">
      <button class="tick" data-action="task-done" data-id="${x.id}" aria-label="Done: ${esc(x.title)}">${I.check}</button>
      <button class="row-main" data-action="task-edit" data-id="${x.id}">
        <span class="row-name">${esc(x.title)}</span>
        ${meta ? `<span class="row-meta ${late ? 'late' : ''}">${meta}</span>` : ''}
      </button>
    </li>`;
}

const taskForm = () => `
  <form class="inline-add" data-form="task">
    <input name="title" placeholder="Add a task… e.g. Pay electricity bill" autocomplete="off" maxlength="80" aria-label="New task">
    <button class="add-btn" aria-label="Add task">${I.plus}</button>
  </form>`;

// ----- List -----
function listView() {
  const groups = groupBy(state.list, (i) => i.cat || 'Other');
  return `
    <form class="inline-add big" data-form="list-add">
      <input name="text" placeholder="Add items… e.g. milk, 2 kg rice" autocomplete="off" aria-label="Add items to the list" list="catalog">
      <button class="add-btn" aria-label="Add">${I.plus}</button>
    </form>
    ${state.list.length ? `
      <p class="hint">Tick an item when you buy it. It moves to your kitchen.</p>
      ${groups.map(([cat, items]) => `
        <section class="group">
          <h3>${esc(cat)}</h3>
          <ul class="rows card flat">${items.map((i) => `
            <li class="row">
              <button class="tick" data-action="bought" data-id="${i.id}" aria-label="Bought ${esc(i.name)}">${I.check}</button>
              <button class="row-main" data-action="edit-item" data-id="${i.id}">
                <span class="row-name">${esc(i.name)}</span>
                ${fmtQty(i) ? `<span class="row-qty">${esc(fmtQty(i))}</span>` : ''}
              </button>
              <button class="icon-btn quiet" data-action="remove-item" data-id="${i.id}" aria-label="Remove ${esc(i.name)}">${I.x}</button>
            </li>`).join('')}
          </ul>
        </section>`).join('')}
      <button class="btn ghost wide" data-action="share-list">${I.share} Share list on WhatsApp</button>
    ` : emptyBox('Nothing to buy', 'Tap <b>Speak</b> and say what you need, or type above.')}`;
}

// ----- Kitchen -----
function kitchenView() {
  const counts = { low: 0, out: 0 };
  state.stock.forEach((s) => { if (counts[s.level] != null) counts[s.level]++; });
  const shown = state.stock.filter((s) => kitchenFilter === 'all' || s.level === kitchenFilter);
  const groups = groupBy(shown, (s) => s.cat || 'Other');
  return `
    <form class="inline-add big" data-form="stock-add">
      <input name="text" placeholder="Add to kitchen… e.g. rice, dal" autocomplete="off" aria-label="Add to kitchen" list="catalog">
      <button class="add-btn" aria-label="Add">${I.plus}</button>
    </form>
    ${state.stock.length ? `
      <div class="filters" role="tablist">
        ${[['all', `All ${state.stock.length}`], ['low', `Low ${counts.low}`], ['out', `Out ${counts.out}`]].map(([f, label]) =>
          `<button class="filter ${kitchenFilter === f ? 'on' : ''} f-${f}" data-action="kfilter" data-f="${f}" role="tab" aria-selected="${kitchenFilter === f}">${label}</button>`).join('')}
      </div>
      <p class="hint">Mark <b>Out</b> and it goes on your shopping list.</p>
      ${groups.length ? groups.map(([cat, items]) => `
        <section class="group">
          <h3>${esc(cat)}</h3>
          <ul class="rows card flat">${items.map((s) => `
            <li class="row">
              <button class="row-main" data-action="stock-edit" data-id="${s.id}"><span class="row-name">${esc(s.name)}</span></button>
              <div class="seg" role="group" aria-label="${esc(s.name)} level">
                ${['full', 'low', 'out'].map((l) => `<button class="seg-${l} ${s.level === l ? 'on' : ''}" data-action="level" data-id="${s.id}" data-level="${l}" aria-pressed="${s.level === l}">${STR.levels[l]}</button>`).join('')}
              </div>
            </li>`).join('')}
          </ul>
        </section>`).join('') : `<p class="muted center">Nothing here.</p>`}
    ` : emptyBox('Your kitchen is empty', 'Scan a shop bill and items appear here.',
      `<button class="btn" data-action="starter">Quick-fill ${STARTER.length} basics</button>`)}`;
}

// ----- Plan -----
function planView() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i));
  if (!days.includes(planDay)) planDay = days[0];
  const meals = state.meals[planDay] || {};
  const open = state.tasks.filter((x) => !x.done).sort((a, b) => a.due.localeCompare(b.due));
  return `
    <div class="days" role="tablist">
      ${days.map((d) => {
        const m = state.meals[d] || {};
        const n = ['b', 'l', 'd'].filter((s) => m[s]).length;
        const dt = new Date(d + 'T12:00');
        return `<button class="day ${d === planDay ? 'on' : ''}" data-action="plan-day" data-date="${d}" role="tab" aria-selected="${d === planDay}">
          <span>${d === today() ? 'Today' : dt.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
          <b>${dt.getDate()}</b>
          <i class="dots">${'•'.repeat(n) || '&nbsp;'}</i>
        </button>`;
      }).join('')}
    </div>

    <section class="card">
      <div class="card-head"><h2>${dayLabel(planDay, true)}</h2></div>
      <div class="slots">
        ${['b', 'l', 'd'].map((s) => `
          <button class="slot ${meals[s] ? '' : 'blank'}" data-action="pick-dish" data-date="${planDay}" data-slot="${s}">
            <span class="slot-label">${STR.slots[s]}</span>
            <span class="slot-dish">${meals[s] ? esc(meals[s]) : 'Choose'}</span>
          </button>`).join('')}
      </div>
      <button class="btn ghost wide" data-action="missing">${I.list} Get missing ingredients for the week</button>
    </section>

    <section class="card">
      <div class="card-head"><h2>Tasks</h2>${open.length ? `<span class="count">${open.length}</span>` : ''}</div>
      ${open.length ? `<ul class="rows">${open.map(taskRow).join('')}</ul>` : '<p class="muted small">No tasks yet. Add chores, bills to pay, things to fix.</p>'}
      ${taskForm()}
    </section>`;
}

const VIEWS = { home: homeView, list: listView, kitchen: kitchenView, plan: planView };

function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  for (const items of m.values()) items.sort((a, b) => a.name.localeCompare(b.name));
  return [...m.entries()].sort((a, b) => CATEGORIES.indexOf(a[0]) - CATEGORIES.indexOf(b[0]));
}

// ---------- Sheets (bottom panels) ----------
const sheetRoot = $('#sheet-root');
let sheetCleanup = null;
let sheetHistory = false;

function openSheet(html, { onMount, onClose } = {}) {
  closeSheet(true);
  sheetRoot.innerHTML = `<div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="grip"></div>${html}</div>`;
  sheetRoot.hidden = false;
  document.body.classList.add('locked');
  sheetCleanup = onClose || null;
  if (!sheetHistory) { history.pushState({ sheet: true }, ''); sheetHistory = true; }
  onMount?.($('.sheet', sheetRoot));
}

function closeSheet(silent) {
  if (sheetRoot.hidden) return;
  sheetCleanup?.();
  sheetCleanup = null;
  sheetRoot.hidden = true;
  sheetRoot.innerHTML = '';
  document.body.classList.remove('locked');
  if (!silent && sheetHistory) { sheetHistory = false; history.back(); }
}

window.addEventListener('popstate', () => { sheetHistory = false; closeSheet(true); });

// ---------- Toast ----------
let toastTimer;
function toast(message, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button class="link" data-action="undo">Undo</button>' : ''}`;
  el.hidden = false;
  el._undo = undo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; el._undo = null; }, undo ? 6000 : 3500);
}

// ---------- Speak ----------
let stopListening = null;

function openSpeak() {
  const langs = Object.entries(STR.langs);
  openSheet(`
    <h2 class="sheet-title">What do you need?</h2>
    ${canListen ? `
      <button class="mic" id="mic" aria-label="Start listening">${I.mic}</button>
      <p class="heard" id="heard" aria-live="polite">Say it like you’d say it at home.</p>
      <p class="muted small center">“Two litre milk, one kilo rice and six eggs”</p>
      <div class="chips center" role="radiogroup" aria-label="Speaking language">
        ${langs.map(([code, label]) => `<button class="chip ${state.lang === code ? 'on' : ''}" data-action="lang" data-lang="${code}" role="radio" aria-checked="${state.lang === code}">${label}</button>`).join('')}
      </div>` : `<p class="muted">Voice isn’t supported in this browser. Type below, or use your keyboard’s mic button.</p>`}
    <form class="inline-add" data-form="speak-type">
      <input name="text" placeholder="Or type: milk, 2 kg rice, eggs" autocomplete="off" aria-label="Type items">
      <button class="add-btn" aria-label="Add">${I.plus}</button>
    </form>`, {
    onMount: () => { if (canListen) startListening(); else $('.sheet input').focus(); },
    onClose: () => { stopListening?.(); stopListening = null; },
  });
}

function startListening() {
  const mic = $('#mic'), heard = $('#heard');
  if (!mic) return;
  if (stopListening) { stopListening(); return; }
  mic.classList.add('on');
  mic.innerHTML = I.stop;
  mic.setAttribute('aria-label', 'Stop listening');
  heard.textContent = 'Listening…';
  stopListening = listen(state.lang, {
    onText: (text) => { heard.textContent = text || 'Listening…'; },
    onEnd: (text, error) => {
      stopListening = null;
      if (!$('#mic')) return; // sheet was closed
      mic.classList.remove('on');
      mic.innerHTML = I.mic;
      mic.setAttribute('aria-label', 'Start listening');
      if (text) return addSpoken(text);
      heard.textContent = speechError(error || 'no-speech');
    },
  });
}

function addSpoken(text) {
  const items = parseSpeech(text);
  if (!items.length) { const h = $('#heard'); if (h) h.textContent = 'Couldn’t catch any items. Try again?'; return; }
  closeSheet();
  act(`Added ${items.map((i) => i.name + (fmtQty(i) ? ' ' + fmtQty(i) : '')).join(', ')}`, () => addToList(items));
  if (tab !== 'list' && tab !== 'home') { tab = 'list'; render(); }
}

// ---------- Scan ----------
const photoInput = $('#photo');
photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  photoInput.value = '';
  if (!file) return;
  openSheet(`
    <h2 class="sheet-title">Reading your bill</h2>
    <div class="progress"><i id="bar"></i></div>
    <p class="muted small center" id="scan-label">Getting the bill reader ready…</p>
    <p class="muted small center">The first scan downloads the reader (about 10 MB) once. Your photo stays on this phone.</p>`);
  try {
    const { scanBill } = await import('./scan.js');
    const result = await scanBill(file, (p, label) => {
      const bar = $('#bar'); if (bar) bar.style.width = Math.round(p * 100) + '%';
      const l = $('#scan-label'); if (l) l.textContent = label;
    });
    if (sheetRoot.hidden) return; // closed while scanning
    openReview(result);
  } catch (err) {
    openSheet(`<h2 class="sheet-title">Couldn’t read the bill</h2>
      <p class="muted">${esc(err.message || 'Something went wrong.')}</p>
      <button class="btn wide" data-action="scan">Try another photo</button>
      <button class="btn ghost wide" data-action="bills">Enter the total by hand</button>`);
  }
});

let review = null;
function openReview({ items, total, shop }) {
  review = items.map((i) => ({ ...i, id: uid(), on: i.known }));
  openSheet(`
    <h2 class="sheet-title">Check your bill</h2>
    <form data-form="review">
      <div class="two">
        <label class="field">Shop<input name="shop" value="${esc(shop)}" placeholder="Shop name" maxlength="40"></label>
        <label class="field">Total ₹<input name="total" inputmode="decimal" value="${total ?? ''}" placeholder="0"></label>
      </div>
      ${review.length ? `
        <p class="hint">Untick anything that isn’t food or home stock.</p>
        <ul class="rows review">${review.map((i) => `
          <li><label class="row check-row">
            <input type="checkbox" data-review="${i.id}" ${i.on ? 'checked' : ''}>
            <span class="row-main"><span class="row-name">${esc(i.name)}</span></span>
            <span class="row-qty">${i.price != null ? rupees(i.price) : ''}</span>
          </label></li>`).join('')}
        </ul>` : '<p class="muted">No items could be read clearly. You can still save the total.</p>'}
      <button class="btn wide">${review.length ? 'Add to kitchen' : 'Save total'}</button>
    </form>`);
}

// ---------- Dish picker ----------
function openDishPicker(date, slot) {
  const current = (state.meals[date] || {})[slot];
  const names = [
    ...DISHES.filter((d) => d.slots.includes(slot)).map((d) => d.name),
    ...state.dishes,
    ...DISHES.filter((d) => !d.slots.includes(slot)).map((d) => d.name),
  ];
  const unique = [...new Set(names)];
  const draw = (q) => {
    const k = key(q);
    const hits = unique.filter((n) => !k || key(n).includes(k)).slice(0, 40);
    const exact = unique.some((n) => key(n) === k);
    // Matching dishes first; "Add …" for a new dish goes last.
    return `
      ${hits.map((n) => `<li><button class="pick ${n === current ? 'on' : ''}" data-action="set-dish" data-name="${esc(n)}">${esc(n)}</button></li>`).join('')}
      ${k && !exact ? `<li><button class="pick add" data-action="set-dish" data-name="${esc(q.trim())}">${I.plus} Add “${esc(q.trim())}” as a new dish</button></li>` : ''}`;
  };
  openSheet(`
    <h2 class="sheet-title">${STR.slots[slot]} · ${dayLabel(date)}</h2>
    <input class="search" id="dish-q" placeholder="Search or type a dish… e.g. appam" autocomplete="off" aria-label="Search dishes">
    <ul class="picks" id="dish-list" data-date="${date}" data-slot="${slot}">${draw('')}</ul>
    ${current ? `<button class="btn ghost wide" data-action="set-dish" data-name="">Clear ${STR.slots[slot].toLowerCase()}</button>` : ''}`, {
    onMount: (sheet) => {
      const q = $('#dish-q', sheet);
      q.addEventListener('input', () => { $('#dish-list').innerHTML = draw(q.value); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#dish-list .pick')?.click(); } });
    },
  });
}

function setDish(name) {
  const list = $('#dish-list');
  const { date, slot } = list.dataset;
  const dayMeals = state.meals[date] || (state.meals[date] = {});
  if (name) {
    dayMeals[slot] = name;
    if (!DISHES.some((d) => key(d.name) === key(name)) && !state.dishes.some((d) => key(d) === key(name))) state.dishes.push(name);
  } else {
    delete dayMeals[slot];
  }
  closeSheet();
  persist();
}

function missingIngredients() {
  const needed = new Set();
  for (let i = 0; i < 7; i++) {
    const m = state.meals[addDays(today(), i)] || {};
    for (const dish of Object.values(m)) {
      DISHES.find((d) => key(d.name) === key(dish))?.need.forEach((n) => needed.add(n));
    }
  }
  if (!needed.size) return toast('Plan a few meals first, then tap this again.');
  const missing = [...needed].filter((n) => { const s = inStock(n); return (!s || s.level === 'out') && !inList(n); });
  if (!missing.length) return toast('You have everything for this week’s meals.');
  act(`Added ${plural(missing.length, 'item')} to your list`, () => addToList(missing.map((name) => ({ name }))));
}

// ---------- Item / stock / task editors ----------
function openItemEdit(id) {
  const it = state.list.find((i) => i.id === id);
  if (!it) return;
  openSheet(`
    <h2 class="sheet-title">${esc(it.name)}</h2>
    <form data-form="item" data-id="${id}">
      <label class="field">Name<input name="name" value="${esc(it.name)}" maxlength="40" required></label>
      <div class="two">
        <label class="field">Quantity<input name="qty" inputmode="decimal" value="${it.qty ?? ''}" placeholder="optional"></label>
        <label class="field">Unit<select name="unit">
          ${['', 'kg', 'g', 'L', 'ml', 'pcs', 'pkt', 'dozen', 'bottle'].map((u) => `<option ${u === (it.unit || '') ? 'selected' : ''} value="${u}">${u || '—'}</option>`).join('')}
        </select></label>
      </div>
      <button class="btn wide">Save</button>
    </form>`);
}

function openStockEdit(id) {
  const s = state.stock.find((x) => x.id === id);
  if (!s) return;
  openSheet(`
    <h2 class="sheet-title">${esc(s.name)}</h2>
    <p class="muted small">Updated ${new Date(s.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
    ${inList(s.name) ? '' : `<button class="btn wide" data-action="stock-to-list" data-id="${id}">${I.list} Add to shopping list</button>`}
    <button class="btn ghost wide danger" data-action="stock-remove" data-id="${id}">Remove from kitchen</button>`);
}

function openTaskEdit(id) {
  const x = state.tasks.find((t) => t.id === id);
  if (!x) return;
  openSheet(`
    <h2 class="sheet-title">Task</h2>
    <form data-form="task-edit" data-id="${id}">
      <label class="field">What<input name="title" value="${esc(x.title)}" maxlength="80" required></label>
      <div class="two">
        <label class="field">Who <span class="muted">(optional)</span><input name="who" value="${esc(x.who)}" placeholder="Amma, Arun…" maxlength="24"></label>
        <label class="field">When<input name="due" type="date" value="${x.due}"></label>
      </div>
      <div class="chips" role="radiogroup" aria-label="Repeat">
        ${Object.entries(STR.repeat).map(([r, label]) => `<label class="chip radio"><input type="radio" name="repeat" value="${r}" ${x.repeat === r ? 'checked' : ''}>${label}</label>`).join('')}
      </div>
      <button class="btn wide">Save</button>
    </form>
    <button class="btn ghost wide danger" data-action="task-remove" data-id="${id}">Delete task</button>`);
}

// ---------- Bills & settings ----------
function openBills() {
  const bills = [...state.bills].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  openSheet(`
    <h2 class="sheet-title">Bills</h2>
    ${bills.length ? `<ul class="rows">${bills.map((b) => `
      <li class="row">
        <span class="row-main"><span class="row-name">${esc(b.shop || 'Bill')}</span>
          <span class="row-meta">${new Date(b.date + 'T12:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${b.count ? ' · ' + plural(b.count, 'item') : ''}</span></span>
        <span class="row-qty strong">${rupees(b.total)}</span>
        <button class="icon-btn quiet" data-action="bill-remove" data-id="${b.id}" aria-label="Delete bill">${I.x}</button>
      </li>`).join('')}</ul>` : '<p class="muted">No bills yet. Scan one, or add a total below.</p>'}
    <form data-form="bill-add" class="two add-bill">
      <input name="shop" placeholder="Shop (optional)" maxlength="40" aria-label="Shop">
      <input name="total" inputmode="decimal" placeholder="₹ Amount" required aria-label="Amount">
      <button class="btn">Add bill</button>
    </form>`);
}

function openSettings() {
  openSheet(`
    <h2 class="sheet-title">Settings</h2>
    <form data-form="settings">
      <label class="field">Home name<input name="home" value="${esc(state.home)}" maxlength="30"></label>
      <p class="field">Voice language</p>
      <div class="chips">
        ${Object.entries(STR.langs).map(([code, label]) => `<label class="chip radio"><input type="radio" name="lang" value="${code}" ${state.lang === code ? 'checked' : ''}>${label}</label>`).join('')}
      </div>
      <button class="btn wide">Save</button>
    </form>
    <div class="settings-list">
      <button class="btn ghost wide" data-action="backup">Download a backup</button>
      <button class="btn ghost wide" data-action="restore">Restore from backup</button>
      <button class="btn ghost wide danger" data-action="reset">Clear everything</button>
    </div>
    <p class="muted small center">Homzy keeps your data on this phone only.</p>`);
}

// ---------- Event handling ----------
const ACTIONS = {
  tab: (el) => { tab = el.dataset.tab; try { localStorage.setItem('homzy:tab', tab); } catch { /* ignore */ } render(); window.scrollTo(0, 0); },
  scan: () => { closeSheet(); photoInput.click(); },
  speak: () => openSpeak(),
  settings: () => openSettings(),
  'close-sheet': () => closeSheet(),
  undo: () => { const t = $('#toast'); const fn = t._undo; t.hidden = true; t._undo = null; fn?.(); },
  lang: (el) => {
    state.lang = el.dataset.lang; save(state);
    document.querySelectorAll('[data-action="lang"]').forEach((b) => { const on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    stopListening?.(); setTimeout(startListening, 250);
  },
  starter: () => act(`Added ${STARTER.length} basics to your kitchen`, () => STARTER.forEach((n) => { if (!inStock(n)) setStock(n, 'full'); })),

  bought: (el) => {
    const it = state.list.find((i) => i.id === el.dataset.id);
    if (!it) return;
    act(`Bought ${it.name}`, () => { state.list = state.list.filter((i) => i !== it); setStock(it.name, 'full', it.cat); });
  },
  'remove-item': (el) => {
    const it = state.list.find((i) => i.id === el.dataset.id);
    if (it) act(`Removed ${it.name}`, () => { state.list = state.list.filter((i) => i !== it); });
  },
  'edit-item': (el) => openItemEdit(el.dataset.id),
  'share-list': () => {
    const text = `🛒 ${state.home} shopping list\n` + state.list.map((i) => `• ${i.name}${fmtQty(i) ? ' – ' + fmtQty(i) : ''}`).join('\n');
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  },

  kfilter: (el) => { kitchenFilter = el.dataset.f; render(); },
  level: (el) => {
    const s = state.stock.find((x) => x.id === el.dataset.id);
    const level = el.dataset.level;
    if (!s || s.level === level) return;
    if (level === 'out' && !inList(s.name)) {
      act(`${s.name} added to your list`, () => { s.level = 'out'; s.at = Date.now(); addToList([{ name: s.name, cat: s.cat }]); });
    } else {
      s.level = level; s.at = Date.now(); persist();
    }
  },
  'stock-edit': (el) => openStockEdit(el.dataset.id),
  'stock-to-list': (el) => {
    const s = state.stock.find((x) => x.id === el.dataset.id);
    closeSheet();
    if (s) act(`${s.name} added to your list`, () => addToList([{ name: s.name, cat: s.cat }]));
  },
  'stock-remove': (el) => {
    const s = state.stock.find((x) => x.id === el.dataset.id);
    closeSheet();
    if (s) act(`Removed ${s.name}`, () => { state.stock = state.stock.filter((x) => x !== s); });
  },
  'low-one': (el) => {
    const s = state.stock.find((x) => x.id === el.dataset.id);
    if (s) act(`${s.name} added to your list`, () => addToList([{ name: s.name, cat: s.cat }]));
  },
  'low-to-list': () => {
    const low = state.stock.filter((s) => s.level !== 'full' && !inList(s.name));
    act(`Added ${plural(low.length, 'item')} to your list`, () => addToList(low.map((s) => ({ name: s.name, cat: s.cat }))));
  },

  'pick-dish': (el) => openDishPicker(el.dataset.date, el.dataset.slot),
  'set-dish': (el) => setDish(el.dataset.name),
  'plan-day': (el) => { planDay = el.dataset.date; render(); },
  missing: () => missingIngredients(),

  'task-done': (el) => {
    const x = state.tasks.find((t) => t.id === el.dataset.id);
    if (!x) return;
    act(`Done: ${x.title}`, () => {
      if (x.repeat === 'none') x.done = true;
      else x.due = addDays(x.due > today() ? x.due : today(), x.repeat === 'daily' ? 1 : 7);
    });
  },
  'task-edit': (el) => openTaskEdit(el.dataset.id),
  'task-remove': (el) => {
    const x = state.tasks.find((t) => t.id === el.dataset.id);
    closeSheet();
    if (x) act('Task deleted', () => { state.tasks = state.tasks.filter((t) => t !== x); });
  },

  bills: () => openBills(),
  'bill-remove': (el) => {
    const b = state.bills.find((x) => x.id === el.dataset.id);
    if (!b) return;
    closeSheet();
    act(`Deleted ${rupees(b.total)} bill`, () => { state.bills = state.bills.filter((x) => x !== b); });
  },
  backup: () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `homzy-backup-${today()}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded. Keep it private.');
  },
  restore: () => $('#restore').click(),
  reset: () => { closeSheet(); act('Everything cleared', () => { const { home, lang } = state; state = { ...fresh(), home, lang }; }); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});

// Mic button inside the speak sheet
document.addEventListener('click', (e) => { if (e.target.closest('#mic')) startListening(); });

// Review checkboxes
document.addEventListener('change', (e) => {
  const id = e.target.dataset?.review;
  if (id && review) { const r = review.find((x) => x.id === id); if (r) r.on = e.target.checked; }
});

const FORMS = {
  'list-add': (f, data) => {
    const items = parseSpeech(data.text);
    if (!items.length) return;
    act(`Added ${items.map((i) => i.name).join(', ')}`, () => addToList(items));
    setTimeout(() => $('[data-form="list-add"] input')?.focus(), 0);
  },
  'stock-add': (f, data) => {
    const items = parseSpeech(data.text);
    if (!items.length) return;
    act(`Added ${items.map((i) => i.name).join(', ')} to kitchen`, () => items.forEach((i) => setStock(i.name, 'full', i.cat)));
    setTimeout(() => $('[data-form="stock-add"] input')?.focus(), 0);
  },
  'speak-type': (f, data) => { if (data.text.trim()) addSpoken(data.text); },
  task: (f, data) => {
    const title = data.title.trim();
    if (!title) return;
    state.tasks.push({ id: uid(), title, who: '', repeat: 'none', due: tab === 'plan' ? planDay : today(), done: false });
    persist();
    setTimeout(() => $('[data-form="task"] input')?.focus(), 0);
  },
  'task-edit': (f, data) => {
    const x = state.tasks.find((t) => t.id === f.dataset.id);
    if (!x) return;
    Object.assign(x, { title: data.title.trim() || x.title, who: data.who.trim(), due: data.due || today(), repeat: data.repeat || 'none' });
    closeSheet(); persist();
  },
  item: (f, data) => {
    const it = state.list.find((i) => i.id === f.dataset.id);
    if (!it) return;
    const qty = parseFloat(data.qty);
    Object.assign(it, { name: data.name.trim() || it.name, qty: Number.isFinite(qty) && qty > 0 ? qty : null, unit: data.unit || null });
    it.cat = catOf(it.name);
    closeSheet(); persist();
  },
  review: (f, data) => {
    const picked = (review || []).filter((r) => r.on);
    const total = parseFloat(String(data.total).replace(/[^\d.]/g, ''));
    closeSheet();
    act(`${picked.length ? `Kitchen updated (${plural(picked.length, 'item')})` : 'Bill saved'}${total ? ' · ' + rupees(total) : ''}`, () => {
      for (const r of picked) {
        setStock(r.name, 'full', r.cat);
        state.list = state.list.filter((i) => key(i.name) !== key(r.name));
      }
      if (total > 0) state.bills.push({ id: uid(), date: today(), shop: data.shop.trim(), total, count: picked.length });
    });
    review = null;
  },
  'bill-add': (f, data) => {
    const total = parseFloat(String(data.total).replace(/[^\d.]/g, ''));
    if (!(total > 0)) return;
    closeSheet();
    act(`Saved ${rupees(total)} bill`, () => state.bills.push({ id: uid(), date: today(), shop: data.shop.trim(), total, count: 0 }));
  },
  settings: (f, data) => {
    state.home = data.home.trim() || 'Our home';
    state.lang = data.lang || state.lang;
    closeSheet(); persist(); toast('Settings saved');
  },
};

document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const fn = FORMS[f.dataset.form];
  if (fn) fn(f, Object.fromEntries(new FormData(f)));
});

$('#restore').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('too big');
    const next = fromBackup(await file.text());
    closeSheet();
    act('Backup restored', () => { state = next; });
  } catch {
    toast('That file isn’t a Homzy backup.');
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// Catalog suggestions for the add boxes
$('#catalog').innerHTML = CATALOG.map((c) => `<option value="${esc(c.name)}">`).join('');

// ---------- Install & offline ----------
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('#install').hidden = false; });
$('#install').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null;
  $('#install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#install').hidden = true; toast('Homzy is on your home screen'); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Refresh "today" if the app stays open past midnight or comes back from background.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

render();

// Home-screen shortcuts: ?do=speak / ?do=scan
const shortcut = new URLSearchParams(location.search).get('do');
if (shortcut) {
  history.replaceState(null, '', location.pathname);
  if (shortcut === 'speak') openSpeak();
  // Browsers only open the photo picker after a tap, so ask for one.
  if (shortcut === 'scan') openSheet(`<h2 class="sheet-title">Scan a bill</h2><button class="btn wide" data-action="scan">${I.camera} Take or choose a photo</button>`);
}
