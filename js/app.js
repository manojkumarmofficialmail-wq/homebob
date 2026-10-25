import * as M from './model.js';
import { SETUP_DINNERS, QUICK_ADD } from './data.js';
import { parseSpeech } from './parse.js';
import { canListen, listen, speechError } from './speech.js';
import * as N from './nutrition.js';
import { sendFeedback, flushOutbox } from './feedback.js';
import * as C from './cloud.js';
import * as S from './sync.js';
import {
  $, $$, esc, rupees, plural, I, avatar, dayName, weekday, dayNum, longDate, timeAgo, fmtTime, isoOf,
  openSheet, closeSheet, toast, hideToast, runToastAction,
} from './ui.js';

const { today, addDays } = M;
const SLOTS = { b: 'Breakfast', l: 'Lunch', d: 'Dinner' };
const EAT_SLOTS = { b: 'Breakfast', l: 'Lunch', s: 'Snack', d: 'Dinner' };
const FEEDBACK_KINDS = { idea: 'An idea', problem: 'Something’s wrong', praise: 'I like it', other: 'Other' };
const FACES = ['😞', '🙁', '😐', '🙂', '😍'];
const FACE_LABELS = ['Very bad', 'Bad', 'Okay', 'Good', 'Love it'];
const num0 = (n) => Math.round(n || 0).toLocaleString('en-IN');
const LANGS = { 'en-IN': 'English', 'ml-IN': 'മലയാളം', 'hi-IN': 'हिंदी', 'ta-IN': 'தமிழ்' };
const REPEAT = { none: 'Once', daily: 'Every day', weekly: 'Every week' };
const THEMES = { system: 'Like my phone', light: 'Light', dark: 'Dark' };
const TASK_IDEAS = ['Cook dinner', 'Clean up after dinner', 'Buy groceries', 'Wash clothes', 'Pay electricity bill', 'Water the plants'];

// ---------- State ----------
let s = M.load();
const pref = (k, d) => { try { return localStorage.getItem('homzy:' + k) || d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('homzy:' + k, v); } catch { /* private mode */ } };
let tab = pref('tab', 'home');
let planSlot = pref('slot', 'd');
let listMode = 'active';
let weekOffset = 0; // 0 = this week, -1 = last week…
let setupStep = 1;
let setupDraft = { home: 'Our home', name: '', people: 4, dinners: SETUP_DINNERS.slice(0, 3), others: [] };

const me = () => M.member(s, s.me);
const who = (id) => (id === s.me ? 'you' : M.firstName(s, id));
const Who = (id) => (id === s.me ? 'You' : M.firstName(s, id));
const viewOnly = () => !S.canEdit();

/** Light or dark, or follow the phone (the default). */
function applyTheme() {
  const t = pref('theme', 'system');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0f1613' : '#f6f3ec'));
}

function persist() {
  if (!M.save(s)) toast('Couldn’t save. Phone storage may be full.');
  render();
}

/** Make a change, save, and offer Undo. */
function commit(message, change, extra) {
  const before = JSON.stringify(s);
  const result = change();
  persist();
  if (message) toast(typeof message === 'function' ? message(result) : message, { label: 'Undo', run: () => { s = JSON.parse(before); persist(); } });
  extra?.(result);
  return result;
}

/**
 * Delete one thing (list item, task, bill…) with a "Removed · Undo" toast.
 * Undo puts back just that thing, so it still works after a family sync.
 */
function removeWithUndo(kind, id, extra) {
  const removed = kind === 'meal' ? M.clearMeal(s, id.date, id.slot) : M.removeFrom(s, kind, id);
  if (!removed) return;
  persist();
  const label = kind === 'meal' ? M.recipe(s, removed.value.rid)?.name || 'Meal' : removed.label;
  toast(`Removed ${label}`, {
    label: 'Undo',
    safe: true,
    run: () => {
      const ok = kind === 'meal' ? M.putBackMeal(s, removed) : M.putBack(s, removed);
      if (ok) { persist(); toast(`${label} is back`); extra?.(removed); }
    },
  });
  extra?.(removed);
}

// ---------- Render ----------
const view = $('#view');

function render() {
  const ready = s.setup && s.members.length;
  document.body.classList.toggle('setup-mode', !ready);
  if (!ready) { view.innerHTML = setupView(); return; }
  if (!me()) s.me = s.members[0].id;
  document.body.classList.toggle('readonly', viewOnly());
  if (!VIEWS[tab]) tab = 'home';
  view.innerHTML = VIEWS[tab]();
  hideEdits(view);
  $$('.tabs button').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  document.body.dataset.tab = tab;
  const active = s.items.length;
  const badge = $('#list-badge');
  badge.textContent = active; badge.hidden = !active;
  const mine = M.forMe(s);
  const n = mine.items.length + mine.tasks.length;
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch { /* unsupported */ }
}

const head = (title, sub, extra = '') => `
  <header class="page-head">
    <div class="ph-text"><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
    ${extra}
    <button class="me-btn" data-action="switch" aria-label="Using as ${esc(me()?.name)}. Switch person">${avatar(me())}</button>
  </header>`;

const section = (title, right = '') => `<div class="sec-head"><h2 class="sec">${title}</h2>${right}</div>`;

/** A friendly empty screen: icon, what's missing, and what to do next. */
const emptyState = (icon, title, text, action = '') => `
  <div class="empty">
    <span class="empty-icon" aria-hidden="true">${icon}</span>
    <p class="empty-title">${title}</p>
    <p class="empty-text">${text}</p>
    ${action}
  </div>`;

// ----- Setup -----
function setupView() {
  const d = setupDraft;
  if (setupStep === 1) {
    return `
      <div class="setup">
        <p class="brand-mark">${I.home}<span>Homzy</span></p>
        <h1 class="display">Set up your home</h1>
        <p class="sub">Step 1 of 2 · takes a minute</p>
        <form data-form="setup1" class="stack">
          <label class="field">Home name<input name="home" value="${esc(d.home)}" maxlength="30"></label>
          <label class="field">Your name<input name="name" value="${esc(d.name)}" placeholder="e.g. Meera" maxlength="24" required autofocus></label>
          <div class="field">People usually eating
            <div class="stepper" data-stepper>
              <button type="button" data-action="step" data-d="-1" aria-label="Fewer people">${I.minus}</button>
              <output name="peopleOut">${d.people} people</output>
              <input type="hidden" name="people" value="${d.people}">
              <button type="button" data-action="step" data-d="1" aria-label="More people">${I.plus}</button>
            </div>
          </div>
          <div class="field">Your usual dinners
            <div class="chips">
              ${SETUP_DINNERS.map((n) => `<label class="chip toggle"><input type="checkbox" name="dinner" value="${esc(n)}" ${d.dinners.includes(n) ? 'checked' : ''}>${esc(n)}</label>`).join('')}
            </div>
          </div>
          <p class="note">You can plan now and add family later.</p>
          <button class="btn coral wide">Continue</button>
        </form>
        ${C.configured() ? `<div class="card info">
          <b>Family already uses Homzy?</b>
          <p>Ask them for your QR code (Family → Connect next to your name) and scan it with this phone’s camera.</p>
          <button class="btn ghost wide" data-action="sync-join-start">${I.qr} I have a QR code</button>
        </div>` : ''}
      </div>`;
  }
  return `
    <div class="setup">
      <button class="link back" data-action="setup-back">${I.back} Back</button>
      <h1 class="display">Who helps at home?</h1>
      <p class="sub">Step 2 of 2 · optional</p>
      <div class="card">
        <div class="member-row">${avatar({ name: d.name, hue: 14 })}<b>${esc(d.name)}</b><span class="tag">You</span></div>
        ${d.others.map((n, i) => `<div class="member-row">${avatar({ name: n, hue: [160, 210, 280, 35][i % 4] })}<b>${esc(n)}</b>
          <button class="icon-btn quiet" data-action="setup-remove" data-i="${i}" aria-label="Remove ${esc(n)}">${I.x}</button></div>`).join('')}
        <form data-form="setup-add" class="inline-add">
          <input name="name" placeholder="Add a name… e.g. Arun, Amma" maxlength="24" autocomplete="off" autofocus aria-label="Family member name">
          <button class="add-btn" aria-label="Add">${I.plus}</button>
        </form>
      </div>
      <p class="note">Everyone can tap their name on this phone to claim shopping and accept tasks.${C.configured() ? ' To put Homzy on everyone’s own phone, tap Connect next to their name in the Family tab.' : ''}</p>
      <button class="btn coral wide" data-action="setup-finish">Create our home</button>
    </div>`;
}

// ----- Home -----
function homeView() {
  const t = today();
  const meal = M.mealAt(s, t, 'd');
  const r = meal && M.recipe(s, meal.rid);
  const rows = r ? M.ingredientRows(s, [{ date: t, slot: 'd' }]) : [];
  const unchecked = rows.filter((x) => x.state === 'check' && !x.onList).length;
  const mine = M.forMe(s);
  const favs = s.favs.map((id) => M.recipe(s, id)).filter(Boolean).slice(0, 4);
  const shopping = sortItems(s.items).slice(0, 4);
  const tasks = s.tasks.filter((x) => x.status !== 'done' && x.due <= t).sort(byTaskOrder);
  const ym = t.slice(0, 7);
  const spend = M.monthSpend(s, ym);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return `
    ${head(`<span class="brand-title">Homzy</span>`, `${esc(s.home.name)} · ${S.linked() ? (viewOnly() ? 'View only' : 'Shared with family') : 'Private'}`, '<button class="install-btn" data-action="install">Install</button>')}
    <p class="greet">${hello}, ${esc(me().name)}.</p>

    ${mine.items.length || mine.tasks.length ? `
      <section class="card attention">
        <p class="eyebrow">${I.bell} Waiting for you</p>
        <ul class="rows">
          ${mine.items.map((i) => `<li class="row">
            <button class="row-main" data-action="item" data-id="${i.id}"><b>Buy ${esc(i.name)}</b><span class="meta">${esc([M.fmtQty(i.qty, i.unit), 'Asked by ' + who(i.addedBy)].filter(Boolean).join(' · '))}</span></button>
            <div class="pair"><button class="pill ghost" data-action="item-decline" data-id="${i.id}">Can’t today</button><button class="pill coral" data-action="item-accept" data-id="${i.id}">Accept</button></div>
          </li>`).join('')}
          ${mine.tasks.map((x) => `<li class="row">
            <button class="row-main" data-action="task" data-id="${x.id}"><b>${esc(x.title)}</b><span class="meta">${esc([dayName(x.due), fmtTime(x.time), 'Asked by ' + who(x.by)].filter(Boolean).join(' · '))}</span></button>
            <div class="pair"><button class="pill ghost" data-action="task-decline" data-id="${x.id}">Can’t today</button><button class="pill coral" data-action="task-accept" data-id="${x.id}">Accept</button></div>
          </li>`).join('')}
        </ul>
      </section>` : ''}

    <section class="card tonight">
      <p class="eyebrow">Tonight · ${longDate(t)}</p>
      ${r ? `
        <h2 class="meal-title">${esc(r.name)}</h2>
        <div class="meta-line">
          <span>${plural(meal.people, 'person', 'people')}${r.mins ? ` · ${r.mins} min` : ''}</span>
          ${!r.ing.length ? '<span class="pill sage">Planned</span>'
            : unchecked ? `<span class="pill sun">${unchecked} to check</span>`
            : '<span class="pill sage">Ready</span>'}
        </div>
        <button class="btn coral wide" data-action="meal" data-date="${t}" data-slot="d">${unchecked ? 'Check ingredients' : 'View dinner plan'}</button>`
      : `
        <h2 class="meal-title muted-title">What’s for dinner?</h2>
        ${favs.length ? `<div class="chips">${favs.map((f) => `<button class="chip" data-action="quick-meal" data-rid="${f.id}">${esc(f.name)}</button>`).join('')}</div>` : ''}
        <button class="btn coral wide" data-action="pick" data-date="${t}" data-slot="d">Choose dinner</button>`}
    </section>

    ${section('Shopping', s.items.length ? `<button class="link" data-action="tab" data-tab="list">See all ${s.items.length} ${I.chev}</button>` : '')}
    ${shopping.length ? `<ul class="card rows">${shopping.map(itemRow).join('')}</ul>`
      : `<div class="card empty-card"><p class="empty-line">${I.cart}<span>Nothing to buy right now. Tap one to add it:</span></p>${quickChips(5)}</div>`}

    ${section('Today’s responsibilities', `<button class="link" data-action="task-new">${I.plus} Ask for a hand</button>`)}
    ${tasks.length ? `<ul class="card rows">${tasks.map(taskRow).join('')}</ul>`
      : `<div class="card empty-card"><p class="empty-line">${I.check}<span>Nothing due today.</span></p><div class="chips">${TASK_IDEAS.slice(0, 3).map((x) => `<button class="chip" data-action="task-new" data-title="${esc(x)}">${I.plus}${esc(x)}</button>`).join('')}</div></div>`}

    ${section('This week', `<button class="link" data-action="outside-new">${I.plus} Ate outside</button>`)}
    ${weekCard(spend, M.monthOutside(s, ym))}
    ${feedbackPrompt()}`;
}

function weekCard(monthGroceries, monthOut) {
  const w = N.weekSummary(s, N.weekStart());
  const protein = N.status('protein', w.total.protein, w.guide.protein);
  const recorded = w.homeMeals + w.outMeals;
  const month = new Date().toLocaleDateString('en-IN', { month: 'long' });
  return `
    <button class="card week-card" data-action="tab" data-tab="week">
      <span class="wk-col">
        <span class="eyebrow plain">Family ate</span>
        <b class="big">${recorded ? num0(w.total.kcal) : '—'}<small> kcal</small></b>
        <span class="meta">${recorded ? `Protein ${protein.label.toLowerCase()} · ${plural(recorded, 'meal')}` : 'Plan meals to see nutrition'}</span>
      </span>
      <span class="wk-col">
        <span class="eyebrow plain">Food spend</span>
        <b class="big">${rupees(w.spend.total)}</b>
        <span class="meta">${w.spend.outside ? `${rupees(w.spend.outside)} outside` : 'Nothing outside yet'}</span>
      </span>
      <span class="wk-chev">${I.chev}</span>
    </button>
    <p class="note plain small">${month}: groceries ${rupees(monthGroceries)} · outside ${rupees(monthOut)}</p>`;
}

// Ask for feedback once the family has used Homzy for a couple of days.
function feedbackPrompt() {
  const first = +pref('first-seen', 0);
  const snooze = +pref('fb-snooze', 0);
  if (!first || Date.now() - first < 2 * 864e5 || pref('fb-done', '') || Date.now() < snooze) return '';
  return `
    <section class="card fb-card">
      <p class="eyebrow">${I.chat} Help us improve</p>
      <b class="fb-q">How is Homzy working for your family?</b>
      <div class="faces">${FACES.map((f, i) => `<button class="face" data-action="feedback" data-rating="${i + 1}" aria-label="${FACE_LABELS[i]}">${f}</button>`).join('')}</div>
      <button class="link muted" data-action="fb-snooze">Not now</button>
    </section>`;
}

function sortItems(items) {
  const rank = (i) => (i.status === 'awaiting' && i.by === s.me ? 0 : i.status === 'needed' ? 1 : i.status === 'awaiting' ? 2 : 3);
  return [...items].sort((a, b) => rank(a) - rank(b) || a.addedAt - b.addedAt);
}

function itemMeta(i) {
  const parts = [i.note];
  if (i.status === 'claimed') parts.push(i.by === s.me ? 'You’re buying' : `${Who(i.by)} is buying`);
  else if (i.status === 'awaiting') parts.push(i.by === s.me ? 'Asked you' : `Waiting for ${who(i.by)}`);
  else parts.push(i.addedBy === s.me ? 'Added by you' : `Added by ${who(i.addedBy)}`);
  return parts.filter(Boolean).join(' · ');
}

function itemPill(i) {
  if (i.status === 'needed') return `<button class="pill coral" data-action="claim" data-id="${i.id}">I’ll buy</button>`;
  if (i.status === 'awaiting') return i.by === s.me
    ? `<button class="pill coral" data-action="item-accept" data-id="${i.id}">Accept</button>`
    : `<span class="pill sand">Asked</span>`;
  return i.by === s.me
    ? `<button class="pill green" data-action="quick-buy" data-id="${i.id}">${I.check} Bought</button>`
    : `<span class="pill sage">Claimed</span>`;
}

const qtyBadge = (qty, unit) => { const q = M.fmtQty(qty, unit); return q ? `<span class="qty">${esc(unit === 'pcs' ? `${q} pcs` : q)}</span>` : ''; };

// A row you can delete: a visible trash button, and on phones a swipe to the left.
const delBtn = (action, id, name) => `<button class="icon-btn del" data-action="${action}" data-id="${id}" aria-label="Delete ${esc(name)}" title="Delete">${I.trash}</button>`;

const itemRow = (i) => `
  <li class="row swipe" data-swipe="item-del" data-id="${i.id}">
    <button class="row-main" data-action="item" data-id="${i.id}">
      <span class="row-title"><b>${esc(i.name)}</b>${qtyBadge(i.qty, i.unit)}</span><span class="meta">${esc(itemMeta(i))}</span>
    </button>
    ${itemPill(i)}
    ${delBtn('item-del', i.id, i.name)}
  </li>`;

function byTaskOrder(a, b) {
  const rank = (x) => (x.status === 'awaiting' && x.assignee === s.me ? 0 : x.status === 'open' ? 1 : 2);
  return rank(a) - rank(b) || (a.time || '99').localeCompare(b.time || '99') || a.due.localeCompare(b.due);
}

function taskMeta(x) {
  const parts = [];
  if (x.due < today()) parts.push(`From ${dayName(x.due)}`);
  else if (x.due > today()) parts.push(dayName(x.due));
  if (x.status === 'accepted') parts.push(`${Who(x.assignee)} · Accepted`);
  else if (x.status === 'awaiting') parts.push(x.assignee === s.me ? 'Asked you' : `Request sent to ${who(x.assignee)}`);
  else parts.push(x.declined ? `${Who(x.declined)} can’t today · Open` : 'Open for anyone');
  if (x.repeat !== 'none') parts.push(REPEAT[x.repeat]);
  return parts.join(' · ');
}

function taskPill(x) {
  if (x.status === 'open') return `<button class="pill coral" data-action="task-take" data-id="${x.id}">I’ll do it</button>`;
  if (x.status === 'awaiting') return x.assignee === s.me
    ? `<button class="pill coral" data-action="task-accept" data-id="${x.id}">Accept</button>`
    : `<span class="pill sand">Waiting</span>`;
  return `<span class="pill sage">${x.time ? fmtTime(x.time) : 'Accepted'}</span>`;
}

const taskRow = (x) => `
  <li class="row swipe" data-swipe="task-del" data-id="${x.id}">
    <button class="tick" data-action="task-done" data-id="${x.id}" aria-label="Mark done: ${esc(x.title)}">${I.check}</button>
    <button class="row-main" data-action="task" data-id="${x.id}">
      <b>${esc(x.title)}</b><span class="meta ${x.due < today() ? 'late' : ''}">${esc(taskMeta(x))}</span>
    </button>
    ${taskPill(x)}
    ${delBtn('task-del', x.id, x.title)}
  </li>`;

function quickChips(n = 8) {
  const sug = M.suggestions(s, QUICK_ADD, n);
  return sug.length ? `<div class="chips">${sug.map((x) => `<button class="chip sage-chip" data-action="quick-add" data-name="${esc(x)}">${esc(x)} ${I.plus}</button>`).join('')}</div>` : '';
}

// ----- Plan -----
function planView() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i));
  const first = new Date(days[0] + 'T12:00'), last = new Date(days[6] + 'T12:00');
  const range = first.getMonth() === last.getMonth()
    ? `${first.getDate()}–${last.getDate()} ${last.toLocaleDateString('en-IN', { month: 'long' })}`
    : `${first.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  const planned = days.filter((d) => M.mealAt(s, d, planSlot));
  const lastWeekHas = days.some((d) => M.mealAt(s, addDays(d, -7), planSlot));
  return `
    ${head('Meal plan', `${range} · ${plural(s.home.people, 'person', 'people')}`)}
    <div class="seg-tabs" role="tablist">
      ${Object.entries(SLOTS).map(([k, v]) => `<button class="${planSlot === k ? 'on' : ''}" data-action="slot" data-slot="${k}" role="tab" aria-selected="${planSlot === k}">${v}</button>`).join('')}
    </div>
    <ul class="card rows days">
      ${days.map((d) => {
        const m = M.mealAt(s, d, planSlot);
        const r = m && M.recipe(s, m.rid);
        const out = M.outsideAt(s, d, planSlot);
        const outText = out.length ? `Ate outside · ${rupees(out.reduce((a, o) => a + o.amount, 0))}` : '';
        return `<li class="day-li ${d === today() ? 'is-today' : ''}">
          <button class="day-row" data-action="${r ? 'meal' : 'pick'}" data-date="${d}" data-slot="${planSlot}">
            <span class="date-col"><small>${d === today() ? 'TODAY' : weekday(d)}</small><b>${dayNum(d)}</b></span>
            <span class="day-main">
              ${r ? `<b class="day-meal">${esc(r.name)}</b><span class="meta">${outText ? `<span class="out-tag">${outText} instead</span>` : [r.mins && `${r.mins} min`, plural(m.people, 'person', 'people'), 'Edit'].filter(Boolean).join(' · ')}</span>`
                : out.length ? `<b class="day-meal">Ate outside</b><span class="meta"><span class="out-tag">${outText.replace('Ate outside · ', '')}</span>${out[0].place ? ' · ' + esc(out[0].place) : ''}</span>`
                : `<b class="day-meal blank">Choose a meal</b><span class="meta">Tap a saved favourite</span>`}
            </span>
          </button>
          ${r ? `<button class="icon-btn del" data-action="meal-clear" data-date="${d}" data-slot="${planSlot}" aria-label="Clear ${esc(r.name)} on ${esc(dayName(d))}" title="Clear">${I.trash}</button>` : ''}
        </li>`;
      }).join('')}
    </ul>
    <button class="btn coral wide" data-action="check-week" ${planned.length ? '' : 'disabled'}>Check ingredients${planned.length ? ` · ${plural(planned.length, 'meal')}` : ''}</button>
    ${lastWeekHas ? `<button class="btn sage wide" data-action="copy-week">${I.copy} Copy last week</button>` : ''}
    <p class="note plain">Start with tonight. Fill the week when useful.</p>`;
}

// ----- List -----
function listView() {
  const needed = sortItems(s.items.filter((i) => i.status !== 'claimed'));
  const claimed = s.items.filter((i) => i.status === 'claimed');
  return `
    ${head('Shopping list', 'Everyone at home sees the same list')}
    <div class="seg-tabs" role="tablist">
      <button class="${listMode === 'active' ? 'on' : ''}" data-action="list-mode" data-mode="active" role="tab">Active · ${s.items.length}</button>
      <button class="${listMode === 'bought' ? 'on' : ''}" data-action="list-mode" data-mode="bought" role="tab">Bought</button>
    </div>
    ${listMode === 'active' ? `
      <form class="inline-add big" data-form="list-add">
        <label class="sr-only" for="list-add-text">Add items</label>
        <input id="list-add-text" name="text" placeholder="Add items… e.g. 2 kg rice, milk, eggs" autocomplete="off" enterkeyhint="done">
        <button class="add-btn" aria-label="Add">${I.plus}</button>
      </form>
      <div class="add-preview" id="add-preview" hidden></div>
      ${quickChips(6)}
      ${needed.length ? `${section('To buy', `<span class="count">${needed.length}</span>`)}<ul class="card rows">${needed.map(itemRow).join('')}</ul>` : ''}
      ${claimed.length ? `${section('Claimed', `<span class="count">${claimed.length}</span>`)}<ul class="card rows">${claimed.map(itemRow).join('')}</ul>
        <p class="note plain">Claimed items stay visible until someone marks them bought.</p>` : ''}
      ${!s.items.length ? emptyState(I.cart, 'Nothing to buy', viewOnly() ? 'When your family adds items, they appear here.' : 'Type above, tap <b>Speak</b> and say a few things at once, or tap a suggestion.')
        : `${viewOnly() ? '' : '<p class="note plain small">Tap “I’ll buy” to take it on. Tap the bin, or swipe left, to delete.</p>'}
           <button class="btn ghost wide" data-action="share-list">${I.share} Share list on WhatsApp</button>`}
    ` : boughtView()}`;
}

function boughtView() {
  const ym = today().slice(0, 7);
  const groups = new Map();
  for (const b of s.bought.slice(0, 120)) {
    const d = new Date(b.at); const k = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  return `
    <button class="card spend-row" data-action="bills">
      <span><span class="eyebrow plain">This month’s bills</span><b class="big">${rupees(M.monthSpend(s, ym))}</b></span>
      <span class="muted small">Add or view ${I.chev}</span>
    </button>
    ${groups.size ? [...groups.entries()].map(([d, list]) => `
      ${section(dayName(d, 'long'))}
      <ul class="card rows">${list.map((b) => `
        <li class="row">
          <span class="row-main static"><b>${esc(b.name)}${b.qty != null ? ` · ${esc(M.fmtQty(b.qty, b.unit))}` : ''}</b>
            <span class="meta">Bought by ${esc(who(b.by))} · ${new Date(b.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}${b.price ? ' · ' + rupees(b.price) : ''}</span></span>
          <button class="icon-btn quiet" data-action="restore" data-id="${b.id}" aria-label="Put ${esc(b.name)} back on the list" title="Put back on list">${I.restore}</button>
          ${delBtn('bought-del', b.id, b.name + ' from history')}
        </li>`).join('')}
      </ul>`).join('') + '<p class="note plain">Bought something by mistake? Tap ↩ to put it back on the list, or the bin to delete it from history.</p>'
    : emptyState(I.history, 'No purchases yet', 'Items marked bought appear here with who bought them and when.')}`;
}

// ----- Family -----
function familyView() {
  const recipes = s.favs.map((id) => M.recipe(s, id)).filter(Boolean);
  return `
    ${head('Family', `${esc(s.home.name)} · ${plural(s.members.length, 'member')}`)}
    ${section('Using this phone as')}
    <div class="card">
      <div class="who-grid">
        ${s.members.map((m) => `<button class="who ${m.id === s.me ? 'on' : ''}" data-action="be" data-id="${m.id}" aria-pressed="${m.id === s.me}">${avatar(m, 'lg')}<span>${esc(m.name)}</span></button>`).join('')}
      </div>
      <p class="note plain">Tap your name before you claim shopping or accept a task.</p>
    </div>

    ${section('Members')}
    <ul class="card rows">
      ${s.members.map((m) => {
        const buying = s.items.filter((i) => i.status === 'claimed' && i.by === m.id).length;
        const doing = s.tasks.filter((t) => t.status === 'accepted' && t.assignee === m.id).length;
        return `<li class="row">
          ${avatar(m)}
          <span class="row-main static"><b>${esc(m.name)}${m.id === s.me ? ' <span class="tag">You</span>' : ''}</b>
            <span class="meta">${[memberPhoneMeta(m), buying && `Buying ${buying}`, doing && plural(doing, 'task')].filter(Boolean).join(' · ') || 'Nothing taken on'}</span></span>
          ${memberConnect(m)}
          ${m.id !== s.me ? `<button class="icon-btn quiet" data-action="member-remove" data-id="${m.id}" aria-label="Remove ${esc(m.name)}">${I.x}</button>` : ''}
        </li>`;
      }).join('')}
      <li><form data-form="member-add" class="inline-add pad">
        <input name="name" placeholder="Add a family member" maxlength="24" autocomplete="off" aria-label="Family member name">
        <button class="add-btn" aria-label="Add">${I.plus}</button>
      </form></li>
    </ul>
    ${syncCard()}

    ${section('Our meals', `<button class="link" data-action="recipe-new">${I.plus} Add a recipe</button>`)}
    <ul class="card rows">
      ${recipes.length ? recipes.map((r) => `<li class="row">
        <button class="row-main" data-action="recipe" data-id="${r.id}"><b>${esc(r.name)}</b>
          <span class="meta">${[r.mins && `${r.mins} min`, r.ing.length ? plural(r.ing.length, 'ingredient') : 'No ingredients yet'].filter(Boolean).join(' · ')}</span></button>
        <button class="icon-btn quiet on" data-action="fav" data-id="${r.id}" aria-label="Remove from favourites">${I.star}</button>
      </li>`).join('') : '<li class="row"><span class="meta">Meals you plan are saved here as favourites.</span></li>'}
    </ul>

    ${s.log.length ? `${section('Recent activity')}
    <ul class="card rows activity">${s.log.slice(0, 8).map((l) => `<li class="row">${avatar(M.member(s, l.by), 'sm')}<span class="row-main static"><span>${esc(M.firstName(s, l.by))} ${esc(l.text)}</span><span class="meta">${timeAgo(l.at)}</span></span></li>`).join('')}</ul>` : ''}

    ${section('Home settings')}
    <div class="card stack-sm">
      <button class="menu-row" data-action="settings">Home name, portions & voice ${I.chev}</button>
      <button class="menu-row" data-action="backup">Download a backup ${I.chev}</button>
      ${viewOnly() ? '' : `<button class="menu-row" data-action="restore-file">Restore from backup ${I.chev}</button>`}
      ${S.linked() ? '' : `<button class="menu-row danger" data-action="reset">Delete this home’s data ${I.chev}</button>`}
    </div>

    ${section('Help us improve')}
    <div class="card stack-sm">
      <button class="menu-row" data-action="feedback">Send feedback or report a problem ${I.chev}</button>
    </div>
    <p class="note plain center">${S.linked()
      ? 'Your home is saved online so your family can see it on their phones. Only phones that scanned your QR codes can open it.'
      : 'Your lists, meals and bills stay on this phone. Only feedback you choose to send is uploaded.'}</p>`;
}

// ----- Week: nutrition and food spend -----
function weekRange(from) {
  const a = new Date(from + 'T12:00'), b = new Date(addDays(from, 6) + 'T12:00');
  const m = (d) => d.toLocaleDateString('en-IN', { month: 'short' });
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${m(b)}` : `${a.getDate()} ${m(a)} – ${b.getDate()} ${m(b)}`;
}

const TONE_ICON = { low: '↓', high: '↑', ok: '✓', none: '' };

function weekView() {
  const from = addDays(N.weekStart(), weekOffset * 7);
  const w = N.weekSummary(s, from);
  const recorded = w.homeMeals + w.outMeals;
  const title = weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : weekRange(from);
  const tip = N.weekTip(w);
  const maxDay = Math.max(1, ...w.days.map((d) => d.home + d.out));
  const outShare = w.spend.total ? Math.round((w.spend.outside / w.spend.total) * 100) : 0;
  const ym = from.slice(0, 7);

  const nutrientRows = N.NUTRIENTS.map((n) => {
    const st = N.status(n.k, w.total[n.k], w.guide[n.k]);
    const width = Math.min(150, st.pct) / 1.5;
    return `<li class="nut-row">
      <span class="nut-name">${n.label}</span>
      <span class="nut-val">${num0(w.total[n.k])} ${n.unit}</span>
      <span class="meter" role="img" aria-label="${n.label}: ${st.pct}% of guide, ${st.label}"><i style="width:${width}%"></i><b class="guide-tick"></b></span>
      <span class="nut-st tone-${st.tone}">${TONE_ICON[st.tone]} ${st.label}<small> · ${st.pct}%</small></span>
    </li>`;
  }).join('');

  const bars = w.days.map((d) => {
    const total = d.home + d.out;
    const h = (v) => (v / maxDay) * 100;
    const label = `${dayName(d.date)}: ${d.future ? 'not yet' : `${num0(total)} kcal (home ${num0(d.home)}, outside ${num0(d.out)})`}`;
    return `<button class="day-bar ${d.future ? 'future' : ''} ${d.date === today() ? 'is-today' : ''}" data-tip="${esc(label)}" aria-label="${esc(label)}">
      <span class="stack-col">${d.out ? `<i class="seg out" style="height:${h(d.out)}%"></i>` : ''}${d.home ? `<i class="seg home" style="height:${h(d.home)}%"></i>` : ''}</span>
      <small>${weekday(d.date).slice(0, 2)}</small>
    </button>`;
  }).join('');

  return `
    ${head(title, `${weekRange(from)} · Nutrition & food spend`)}
    <div class="week-nav">
      <button class="icon-btn" data-action="week-prev" aria-label="Previous week">${I.back}</button>
      <span>${weekOffset === 0 ? 'Mon–Sun, so far' : weekRange(from)}</span>
      <button class="icon-btn" data-action="week-next" aria-label="Next week" ${weekOffset >= 0 ? 'disabled' : ''}>${I.chev}</button>
    </div>

    <section class="card">
      <p class="eyebrow">What the family ate</p>
      ${recorded ? `
        <b class="big-num">${num0(w.total.kcal)}<small> kcal</small></b>
        <p class="meta">${plural(w.homeMeals, 'home meal')} · ${plural(w.outMeals, 'meal')} outside${w.emptySlots ? ` · ${w.emptySlots} not recorded` : ''}</p>
        <ul class="nut-list">${nutrientRows}</ul>
        <p class="hint">Bars compare with what these meals should give an adult (ICMR-NIN guide). The line marks 100%.</p>
        <div class="chart" aria-label="Calories by day">
          <div class="legend"><span><i class="sw home"></i>Home</span><span><i class="sw out"></i>Outside</span></div>
          <div class="day-bars">${bars}</div>
          <p class="chart-read" id="chart-read">Tap a day to see its calories.</p>
          <details class="table-view"><summary>Show as table</summary>
            <table><thead><tr><th>Day</th><th>Home</th><th>Outside</th></tr></thead><tbody>
            ${w.days.filter((d) => !d.future).map((d) => `<tr><td>${dayName(d.date)}</td><td>${num0(d.home)} kcal</td><td>${num0(d.out)} kcal</td></tr>`).join('')}
            </tbody></table>
          </details>
        </div>`
      : `<p class="empty-title">Nothing recorded yet</p>
         <p class="meta">Plan meals in the Plan tab, or log food from outside. Homzy works out the nutrition from the ingredients.</p>
         <button class="btn sage wide" data-action="tab" data-tab="plan">Plan meals</button>`}
      ${w.unknownMeals ? `<p class="note">${plural(w.unknownMeals, 'meal has', 'meals have')} no ingredients yet, so ${w.unknownMeals === 1 ? 'it isn’t' : 'they aren’t'} counted. Add ingredients in Family → Our meals.</p>` : ''}
      ${w.missing.length ? `<p class="hint">No nutrition data for: ${esc(w.missing.slice(0, 5).join(', '))}${w.missing.length > 5 ? '…' : ''}</p>` : ''}
    </section>

    ${tip ? `<div class="card info"><b>This week’s tip</b><p>${esc(tip)}</p></div>` : ''}

    <section class="card">
      <p class="eyebrow">Food spend</p>
      <b class="big-num">${rupees(w.spend.total)}</b>
      ${w.spend.total ? `
        <div class="split" role="img" aria-label="Groceries ${rupees(w.spend.groceries)}, outside ${rupees(w.spend.outside)}">
          ${w.spend.groceries ? `<i class="seg home" style="flex:${w.spend.groceries}"></i>` : ''}${w.spend.outside ? `<i class="seg out" style="flex:${w.spend.outside}"></i>` : ''}
        </div>
        <div class="split-legend">
          <span><i class="sw home"></i>Groceries <b>${rupees(w.spend.groceries)}</b></span>
          <span><i class="sw out"></i>Outside <b>${rupees(w.spend.outside)}</b> <small>${outShare}%</small></span>
        </div>` : '<p class="meta">Scan a grocery bill or log food from outside to see where food money goes.</p>'}
      ${Object.keys(w.spend.byKind).length ? `<ul class="rows">${Object.entries(w.spend.byKind).sort((a, b) => b[1].amount - a[1].amount).map(([k, v]) => `
        <li class="row slim"><span class="row-main static"><b>${esc(N.OUTSIDE_KINDS[k] || k)}</b><span class="meta">${plural(v.count, 'time')}</span></span><b>${rupees(v.amount)}</b></li>`).join('')}</ul>` : ''}
      <p class="meta">${new Date(from + 'T12:00').toLocaleDateString('en-IN', { month: 'long' })}: groceries ${rupees(M.monthSpend(s, ym))} · outside ${rupees(M.monthOutside(s, ym))}</p>
      <div class="btn-row">
        <button class="btn ghost" data-action="bills">Grocery bills</button>
        <button class="btn coral" data-action="outside-new">${I.plus} Ate outside</button>
      </div>
    </section>

    ${w.outside.length ? `${section('Outside this week')}
    <ul class="card rows">${w.outside.map((o) => `<li class="row">
      <span class="row-main static"><b>${esc(o.place || N.OUTSIDE_KINDS[o.kind] || 'Outside')}</b>
        <span class="meta">${dayName(o.date)} · ${EAT_SLOTS[o.slot]} · ${plural(o.people, 'person', 'people')} · ${N.OUTSIDE_WEIGHT[o.weight] || ''}</span></span>
      <b class="amount">${rupees(o.amount)}</b>
      ${delBtn('outside-remove', o.id, `${rupees(o.amount)} at ${o.place || N.OUTSIDE_KINDS[o.kind] || 'outside'}`)}
    </li>`).join('')}</ul>` : ''}
    <p class="note plain">Nutrition is an estimate from recipe ingredients and typical values for Indian foods. Outside meals use rough averages. It is a guide for the family, not medical advice.</p>`;
}

const VIEWS = { home: homeView, plan: planView, list: listView, week: weekView, family: familyView };

// ---------- Sheets ----------
function switchSheet() {
  openSheet(`
    <h2 class="sheet-title">Who’s using Homzy?</h2>
    <div class="who-grid">
      ${s.members.map((m) => `<button class="who ${m.id === s.me ? 'on' : ''}" data-action="be" data-id="${m.id}" data-close="1">${avatar(m, 'lg')}<span>${esc(m.name)}</span></button>`).join('')}
    </div>
    <form data-form="member-add" class="inline-add">
      <input name="name" placeholder="Add a family member" maxlength="24" autocomplete="off" aria-label="Family member name">
      <button class="add-btn" aria-label="Add">${I.plus}</button>
    </form>`);
}

const kcalPer = (r) => { const n = N.recipeNutrition(r, 4); return n.counted ? `${num0(n.perPerson.kcal)} kcal` : ''; };

// ----- Pick a meal -----
function pickSheet(date, slot) {
  const current = M.mealAt(s, date, slot)?.rid;
  const all = M.allRecipes(s);
  const draw = (q) => {
    const k = M.key(q);
    const match = (r) => !k || M.key(r.name).includes(k) || r.ing.some((i) => M.key(i.name).includes(k));
    const favs = s.favs.map((id) => M.recipe(s, id)).filter((r) => r && match(r));
    const rest = all.filter((r) => !s.favs.includes(r.id) && match(r))
      .sort((a, b) => (b.slots.includes(slot) - a.slots.includes(slot)) || a.name.localeCompare(b.name));
    const btn = (r) => `<li><button class="pick ${r.id === current ? 'on' : ''}" data-action="set-meal" data-rid="${r.id}">
      <span><b>${esc(r.name)}</b><span class="meta">${[r.mins && `${r.mins} min`, r.veg === false ? 'Non-veg' : 'Veg', kcalPer(r)].filter(Boolean).join(' · ')}</span></span>${r.id === current ? I.check : ''}</button></li>`;
    return `
      ${favs.length ? `<li class="pick-head">Favourites</li>${favs.map(btn).join('')}` : ''}
      ${rest.length ? `<li class="pick-head">${k ? 'Matches' : SLOTS[slot] + ' ideas'}</li>${rest.slice(0, 40).map(btn).join('')}` : ''}
      ${k && !all.some((r) => M.key(r.name) === k) ? `<li><button class="pick add" data-action="new-meal" data-name="${esc(q.trim())}">${I.plus} Add “${esc(q.trim())}” as a family meal</button></li>` : ''}`;
  };
  openSheet(`
    <h2 class="sheet-title">${SLOTS[slot]} · ${dayName(date, 'long')}</h2>
    <input class="search" id="pick-q" placeholder="Search appam, dal, fish…" autocomplete="off" aria-label="Search meals">
    <ul class="picks" id="pick-list" data-date="${date}" data-slot="${slot}">${draw('')}</ul>
    ${current ? `<button class="btn ghost wide danger" data-action="clear-meal">Clear ${SLOTS[slot].toLowerCase()}</button>` : ''}`, {
    tall: true,
    onMount: (sh) => {
      const q = $('#pick-q', sh);
      q.addEventListener('input', () => { $('#pick-list').innerHTML = draw(q.value); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#pick-list .pick')?.click(); } });
    },
  });
}

// ----- Meal detail with Have / Need / Check -----
let checkCtx = null; // { meals: [{date, slot}], title, sub }

function mealSheet(date, slot) {
  const m = M.mealAt(s, date, slot);
  const r = m && M.recipe(s, m.rid);
  if (!r) return pickSheet(date, slot);
  checkCtx = { meals: [{ date, slot }], date, slot, single: true };
  drawCheckSheet();
}

function checkWeekSheet() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i));
  const meals = days.filter((d) => M.mealAt(s, d, planSlot)).map((date) => ({ date, slot: planSlot }));
  if (!meals.length) return;
  checkCtx = { meals, single: false };
  drawCheckSheet();
}

function drawCheckSheet(keepOpen) {
  const ctx = checkCtx;
  const rows = M.ingredientRows(s, ctx.meals);
  const need = rows.filter((x) => x.state === 'need' && !x.onList);
  const unchecked = rows.filter((x) => x.state === 'check' && !x.onList);
  let top;
  if (ctx.single) {
    const m = M.mealAt(s, ctx.date, ctx.slot);
    const r = M.recipe(s, m.rid);
    top = `
      <p class="eyebrow">${SLOTS[ctx.slot]} · ${dayName(ctx.date, 'long')}</p>
      <h2 class="sheet-title big">${esc(r.name)}</h2>
      <div class="meta-line">
        <div class="stepper sm">
          <button data-action="meal-people" data-d="-1" aria-label="Fewer people">${I.minus}</button>
          <output>${plural(m.people, 'person', 'people')}</output>
          <button data-action="meal-people" data-d="1" aria-label="More people">${I.plus}</button>
        </div>
        ${r.mins ? `<span class="muted">${I.clock} ${r.mins} min</span>` : ''}
      </div>
      ${nutritionChips(r, m.people)}`;
  } else {
    top = `<h2 class="sheet-title big">Check ingredients</h2>
      <p class="sub">${ctx.meals.map((x) => esc(M.recipe(s, M.mealAt(s, x.date, x.slot).rid).name)).join(' · ')}</p>`;
  }
  const html = `
    ${top}
    ${rows.length ? `
      <p class="note">Confirm kitchen stock. Quantities are editable estimates.</p>
      <div class="check-tools"><button class="link" data-action="all-have">Mark everything Have</button></div>
      <ul class="checks">
        ${rows.map((x, idx) => `<li class="check-item ${x.onList ? 'is-listed' : ''}">
          <div class="ci-name"><b>${esc(x.name)}${x.qty ? ` · ${esc(M.fmtQty(x.qty, x.unit))}` : ''}</b>
            ${x.onList ? '<span class="tag">On the list</span>' : x.recent ? `<span class="hint">Bought ${dayName(isoOf(new Date(x.recent.at))).toLowerCase()}</span>` : ''}
            ${!ctx.single && x.meals.length > 1 ? `<span class="hint">${plural(x.meals.length, 'meal')}</span>` : ''}</div>
          ${x.onList ? '' : `<div class="hnc" role="radiogroup" aria-label="${esc(x.name)}">
            ${['have', 'need', 'check'].map((st) => `<button class="hnc-${st} ${x.state === st ? 'on' : ''}" data-action="hnc" data-i="${idx}" data-st="${st}" role="radio" aria-checked="${x.state === st}">${st[0].toUpperCase() + st.slice(1)}</button>`).join('')}
          </div>`}
        </li>`).join('')}
      </ul>
      <button class="btn coral wide" data-action="add-needs" ${need.length ? '' : 'disabled'}>
        ${need.length ? (need.length === 1 ? `Add ${esc(need[0].name.toLowerCase())} to list` : `Add ${need.length} items to list`) : 'Mark what you need'}</button>
      <p class="note">${unchecked.length ? `Only confirmed shortages enter the list. ${esc(unchecked.slice(0, 3).map((x) => x.name).join(', '))}${unchecked.length > 3 ? ` and ${unchecked.length - 3} more` : ''} still ${unchecked.length === 1 ? 'needs' : 'need'} checking.` : 'Everything is checked.'}</p>`
    : `<p class="note">This meal has no ingredients yet. Add them once and Homzy remembers.</p>`}
    ${ctx.single ? `<div class="btn-row">
      <button class="btn ghost" data-action="pick" data-date="${ctx.date}" data-slot="${ctx.slot}">Change meal</button>
      <button class="btn ghost" data-action="recipe" data-id="${M.mealAt(s, ctx.date, ctx.slot).rid}">Edit recipe</button>
    </div>` : ''}`;
  if (keepOpen && $('.sheet')) {
    const sh = $('.sheet'); const y = sh.scrollTop;
    sh.innerHTML = `<div class="grip"></div>${html}`;
    sh.scrollTop = y;
  } else openSheet(html, { tall: true });
  checkCtx.rows = rows;
}

function nutritionChips(r, people) {
  const n = N.recipeNutrition(r, people);
  if (!n.counted) return '';
  const p = n.perPerson;
  return `<div class="nut-chips" aria-label="Nutrition per person">
      <span><b>${num0(p.kcal)}</b> kcal</span><span><b>${num0(p.protein)} g</b> protein</span>
      <span><b>${num0(p.carbs)} g</b> carbs</span><span><b>${num0(p.fat)} g</b> fat</span><span><b>${num0(p.fibre)} g</b> fibre</span>
    </div>
    <p class="hint">Per person, estimated${n.missing.length ? ` · not counted: ${esc(n.missing.join(', '))}` : ''}${n.oilAdded ? ' · includes 2 tsp cooking oil' : ''}</p>`;
}

// Nutrition for one item while adding it: a compact chip row that opens into a table.
const nf = (v) => (v >= 100 ? num0(v) : v >= 10 ? String(Math.round(v)) : String(+v.toFixed(1)));
function nutriChips(item, { open = false } = {}) {
  const n = N.itemNutrition(item);
  if (!n) return `<p class="nutri none">${I.leaf} No nutrition data${M.catOf(item.name) === 'Other' || ['Household', 'Personal care'].includes(M.catOf(item.name)) ? ' (not a food we know)' : ''}</p>`;
  const show = n.amount || n.per100;
  const basis = n.amount ? `for ${M.fmtQty(item.qty, item.unit)}${item.unit === 'pcs' || !item.unit ? ' pcs' : ''}` : 'per 100 g';
  const chip = (k, unit, label) => `<span class="nchip ${k}"><b>${nf(show[k])}${unit}</b> ${label}</span>`;
  return `<details class="nutri" ${open ? 'open' : ''}>
    <summary aria-label="Nutrition ${basis}: ${nf(show.kcal)} kilocalories, ${nf(show.protein)} grams protein, ${nf(show.carbs)} grams carbs, ${nf(show.fat)} grams fat, ${nf(show.fibre)} grams fibre. Show details">
      ${chip('kcal', '', 'kcal')}${chip('protein', ' g', 'protein')}${chip('carbs', ' g', 'carbs')}${chip('fat', ' g', 'fat')}${chip('fibre', ' g', 'fibre')}
      <span class="nbasis">${esc(basis)}</span>
    </summary>
    <table class="ntable">
      <thead><tr><th scope="col"><span class="sr-only">Nutrient</span></th><th scope="col">Per 100 g</th>${n.amount ? `<th scope="col">${esc(basis.replace('for ', 'For '))}</th>` : ''}</tr></thead>
      <tbody>${N.NUTRIENTS.map((x) => `<tr><th scope="row">${x.label}</th><td>${nf(n.per100[x.k])} ${x.unit}</td>${n.amount ? `<td>${nf(n.amount[x.k])} ${x.unit}</td>` : ''}</tr>`).join('')}</tbody>
    </table>
    <p class="hint">${n.amount ? `About ${num0(n.grams)} g edible. ` : 'Add a quantity to see totals. '}Values from the Indian Food Composition Tables (IFCT 2017). Estimates only.</p>
  </details>`;
}

// ----- Item detail -----
function itemSheet(id) {
  const i = s.items.find((x) => x.id === id);
  if (!i) return closeSheet();
  const mine = i.by === s.me;
  let status;
  if (i.status === 'needed') status = `
    <div class="status-box"><b>No one is buying yet</b><span>Take it on, or ask someone.</span></div>
    <button class="btn coral wide" data-action="claim" data-id="${id}" data-keep="1">I’ll buy</button>
    <p class="field-label">Ask someone</p>
    <div class="chips">${s.members.filter((m) => m.id !== s.me).map((m) => `<button class="chip" data-action="assign" data-id="${id}" data-m="${m.id}">${avatar(m, 'sm')} ${esc(m.name)}</button>`).join('') || '<span class="muted small">Add family members in the Family tab.</span>'}</div>`;
  else if (i.status === 'awaiting') status = mine ? `
    <div class="status-box warm"><b>${esc(Who(i.addedBy))} asked you to buy this</b><span>Accept to show everyone you’re on it.</span></div>
    <div class="btn-row"><button class="btn ghost" data-action="item-decline" data-id="${id}" data-keep="1">Can’t today</button><button class="btn coral" data-action="item-accept" data-id="${id}" data-keep="1">Accept</button></div>`
    : `<div class="status-box warm"><b>Waiting for ${esc(who(i.by))}</b><span>Asking alone doesn’t mean accepted.</span></div>
    <button class="btn ghost wide" data-action="release" data-id="${id}" data-keep="1">Cancel the request</button>`;
  else status = mine ? `
    <div class="status-box"><div class="sb-line"><span class="pill sage">You are buying</span><button class="link coral-text" data-action="release" data-id="${id}" data-keep="1">Release</button></div>
      <span>Everyone sees “${esc(me().name)} is buying”. It stays on the list until bought.</span></div>`
    : `<div class="status-box"><b>${esc(Who(i.by))} is buying</b><span>${esc(i.name)} stays on the active list.</span></div>`;

  const buyForm = i.status === 'claimed' || i.status === 'needed' ? `
    <form data-form="buy" data-id="${id}" class="stack">
      <div class="${i.qty == null ? 'stack' : 'two'}">
        ${i.qty == null ? '' : `<label class="field">Quantity bought<input name="qty" inputmode="decimal" value="${i.qty}">
          ${i.unit ? `<span class="unit">${esc(i.unit)}</span>` : ''}</label>`}
        <label class="field"><span>Price ₹ <span class="opt">optional</span></span><input name="price" inputmode="decimal" placeholder="—"></label>
      </div>
      <button class="btn ${i.status === 'claimed' && mine ? 'coral' : 'sage'} wide" id="buy-btn">${i.status === 'claimed' && !mine ? `I bought it instead` : 'Mark bought'}</button>
    </form>
    <p class="note plain">Price and receipt are optional. Buying less leaves the rest on the list.</p>` : '';

  openSheet(`
    <h2 class="sheet-title big">${esc(i.name)}${i.qty != null ? ` · ${esc(M.fmtQty(i.qty, i.unit))}` : ''}</h2>
    <p class="sub">Added by ${esc(who(i.addedBy))} · ${timeAgo(i.addedAt)}${i.meal ? ` · for ${esc(i.meal)}` : ''}</p>
    ${nutriChips(i)}
    ${status}
    ${buyForm}
    <details class="more">
      <summary>Edit item</summary>
      <form data-form="item-edit" data-id="${id}" class="stack">
        <label class="field">Name<input name="name" value="${esc(i.name)}" maxlength="40" required></label>
        <div class="two">
          <label class="field">Quantity<input name="qty" inputmode="decimal" value="${i.qty ?? ''}" placeholder="optional"></label>
          <label class="field">Unit<select name="unit">${['', 'kg', 'g', 'L', 'ml', 'pcs', 'pkt', 'dozen', 'bottle'].map((u) => `<option value="${u}" ${u === (i.unit || '') ? 'selected' : ''}>${u || '—'}</option>`).join('')}</select></label>
        </div>
        <label class="field">Brand or note<input name="note" value="${esc(i.note)}" placeholder="Any brand is fine" maxlength="40"></label>
        <button class="btn sage wide">Save changes</button>
      </form>
    </details>
    <button type="button" class="btn ghost wide danger" data-action="item-remove" data-id="${id}">${I.trash} Delete from list</button>`, {
    onMount: (sh) => {
      const q = sh.querySelector('[data-form="buy"] [name="qty"]');
      const btn = sh.querySelector('#buy-btn');
      if (q && btn && i.qty != null) q.addEventListener('input', () => {
        const v = parseFloat(q.value);
        const base = i.status === 'claimed' && !mine ? 'I bought it instead' : 'Mark bought';
        btn.textContent = v > 0 && v < i.qty ? `Record part · ${M.fmtQty(+(i.qty - v).toFixed(2), i.unit)} left` : base;
      });
    },
  });
}

// ----- Tasks -----
function taskSheet(id, preset = {}) {
  const x = id ? s.tasks.find((t) => t.id === id) : null;
  if (id && !x) return closeSheet();
  const t = x || { title: preset.title || '', due: today(), time: '', assignee: null, repeat: 'none' };
  let status = '';
  if (x) {
    if (x.status === 'awaiting' && x.assignee === s.me) status = `
      <div class="status-box warm"><b>${esc(Who(x.by))} asked you</b><span>Accept, or say you can’t today.</span></div>
      <div class="btn-row"><button class="btn ghost" data-action="task-decline" data-id="${x.id}" data-close="1">Can’t today</button><button class="btn coral" data-action="task-accept" data-id="${x.id}" data-close="1">Accept</button></div>`;
    else if (x.status === 'awaiting') status = `<div class="status-box warm"><b>Waiting for ${esc(who(x.assignee))}</b><span>Assigning alone never means accepted.</span></div>`;
    else if (x.status === 'open') status = `<div class="status-box"><b>Open for anyone</b><span>${x.declined ? esc(Who(x.declined)) + ' can’t today.' : 'Anyone at home can take this.'}</span></div>
      <button class="btn coral wide" data-action="task-take" data-id="${x.id}" data-close="1">I’ll do it</button>`;
    else status = `<div class="status-box"><b>${esc(Who(x.assignee))} · Accepted</b><span>${x.time ? 'At ' + fmtTime(x.time) : 'Today'}</span></div>
      <div class="btn-row">${x.assignee === s.me ? `<button class="btn ghost" data-action="task-release" data-id="${x.id}" data-close="1">Release</button>` : ''}<button class="btn coral" data-action="task-done" data-id="${x.id}" data-close="1">${I.check} Mark done</button></div>`;
  }
  openSheet(`
    <h2 class="sheet-title big">${x ? esc(x.title) : 'Ask for a hand'}</h2>
    ${status}
    <form data-form="task" ${x ? `data-id="${x.id}"` : ''} class="stack">
      ${x ? '' : `<div class="chips">${TASK_IDEAS.map((n) => `<button type="button" class="chip" data-action="task-idea" data-title="${esc(n)}">${esc(n)}</button>`).join('')}</div>`}
      <label class="field">What needs doing?<input name="title" value="${esc(t.title)}" placeholder="Cook dinner, clear up, water plants…" maxlength="80" required ${x ? '' : 'autofocus'}></label>
      <div class="field">Who could help?
        <div class="chips">
          <label class="chip toggle"><input type="radio" name="assignee" value="" ${!t.assignee ? 'checked' : ''}>Anyone</label>
          ${s.members.map((m) => `<label class="chip toggle"><input type="radio" name="assignee" value="${m.id}" ${t.assignee === m.id ? 'checked' : ''}>${m.id === s.me ? 'Me' : esc(m.name)}</label>`).join('')}
        </div>
      </div>
      <div class="two">
        <label class="field">When?<input type="date" name="due" value="${t.due}"></label>
        <label class="field"><span>Time <span class="opt">optional</span></span><input type="time" name="time" value="${t.time}"></label>
      </div>
      <div class="chips">${Object.entries(REPEAT).map(([k, v]) => `<label class="chip toggle"><input type="radio" name="repeat" value="${k}" ${t.repeat === k ? 'checked' : ''}>${v}</label>`).join('')}</div>
      <button class="btn ${x ? 'sage' : 'coral'} wide">${x ? 'Save changes' : 'Send request'}</button>
    </form>
    ${x ? `<button class="btn ghost wide danger" data-action="task-remove" data-id="${x.id}">${I.trash} Delete task</button>` : ''}`, { tall: true });
}

// ----- Recipe editor -----
function recipeSheet(id, preset = {}) {
  const r = id ? M.recipe(s, id) : { name: preset.name || '', mins: '', slots: preset.slot || 'd', veg: true, ing: [] };
  if (!r) return;
  const pick = preset.date ? `data-date="${preset.date}" data-slot="${preset.slot}"` : '';
  openSheet(`
    <h2 class="sheet-title big">${id ? 'Edit recipe' : 'Save a family recipe'}</h2>
    <form data-form="recipe" ${id ? `data-id="${id}"` : ''} ${pick} class="stack">
      <label class="field">Meal name<input name="name" value="${esc(r.name)}" placeholder="Amma’s avial + rice" maxlength="60" required ${id ? '' : 'autofocus'}></label>
      <div class="two">
        <label class="field">Cooking time<input name="mins" inputmode="numeric" value="${r.mins || ''}" placeholder="min"></label>
        <div class="field">Type<div class="chips">
          <label class="chip toggle"><input type="radio" name="veg" value="1" ${r.veg !== false ? 'checked' : ''}>Veg</label>
          <label class="chip toggle"><input type="radio" name="veg" value="0" ${r.veg === false ? 'checked' : ''}>Non-veg</label>
        </div></div>
      </div>
      <div class="field">Good for<div class="chips">${Object.entries(SLOTS).map(([k, v]) => `<label class="chip toggle"><input type="checkbox" name="slots" value="${k}" ${r.slots.includes(k) ? 'checked' : ''}>${v}</label>`).join('')}</div></div>
      <label class="field"><span>Ingredients for 4 people <span class="opt">one per line</span></span>
        <textarea name="ing" rows="6" placeholder="Rice 500 g&#10;Toor dal 200 g&#10;Tomato 2 pcs">${esc(r.ing.map((x) => [x.name, x.qty, x.unit].filter((v) => v != null && v !== '').join(' ')).join('\n'))}</textarea></label>
      <button class="btn coral wide">${id ? 'Save recipe' : preset.date ? 'Save and plan it' : 'Save recipe'}</button>
    </form>
    ${id ? `<button class="btn ghost wide" data-action="fav" data-id="${id}" data-close="1">${s.favs.includes(id) ? 'Remove from favourites' : 'Add to favourites'}</button>` : ''}
    ${id && !M.isBuiltIn(id) ? `<button class="btn ghost wide danger" data-action="recipe-del" data-id="${id}">${I.trash} Delete this recipe</button>` : ''}`, { tall: true });
}

// ----- Bills -----
function billsSheet() {
  const bills = [...s.bills].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  openSheet(`
    <h2 class="sheet-title big">Bills</h2>
    ${bills.length ? `<ul class="rows">${bills.map((b) => `<li class="row">
      <span class="row-main static"><b>${esc(b.shop || 'Bill')}</b><span class="meta">${dayName(b.date)}${b.count ? ' · ' + plural(b.count, 'item') : ''} · ${esc(who(b.by))}</span></span>
      <b class="amount">${rupees(b.total)}</b>
      ${delBtn('bill-remove', b.id, `${rupees(b.total)} bill${b.shop ? ' from ' + b.shop : ''}`)}</li>`).join('')}</ul>`
      : '<p class="note">No bills yet. Scan one, or add the total below.</p>'}
    <form data-form="bill" class="two add-bill">
      <input name="shop" placeholder="Shop (optional)" maxlength="40" aria-label="Shop">
      <input name="total" inputmode="decimal" placeholder="₹ Amount" required aria-label="Amount">
      <button class="btn sage">Add bill</button>
    </form>`);
}

// ----- Food from outside -----
function outsideSheet(preset = {}) {
  const slot = preset.slot || M.slotNow();
  const people = preset.people || s.home.people;
  openSheet(`
    <h2 class="sheet-title big">Food from outside</h2>
    <p class="sub">Restaurants, delivery, tea and snacks. It counts towards the week’s spend and nutrition.</p>
    <form data-form="outside" class="stack">
      <div class="chips">${Object.entries(N.OUTSIDE_KINDS).map(([k, v]) => `<label class="chip toggle"><input type="radio" name="kind" value="${k}" ${(preset.kind || 'restaurant') === k ? 'checked' : ''}>${v}</label>`).join('')}</div>
      <label class="field">Amount ₹<input name="amount" inputmode="decimal" value="${preset.amount ?? ''}" placeholder="e.g. 640" required autofocus></label>
      <div class="field">Which meal?<div class="chips">${Object.entries(EAT_SLOTS).map(([k, v]) => `<label class="chip toggle"><input type="radio" name="slot" value="${k}" ${slot === k ? 'checked' : ''}>${v}</label>`).join('')}</div></div>
      <div class="two">
        <label class="field">When?<input type="date" name="date" value="${preset.date || today()}" max="${today()}"></label>
        <div class="field">People
          <div class="stepper sm" data-stepper>
            <button type="button" data-action="step" data-d="-1" aria-label="Fewer people">${I.minus}</button>
            <output>${plural(people, 'person', 'people')}</output>
            <input type="hidden" name="people" value="${people}">
            <button type="button" data-action="step" data-d="1" aria-label="More people">${I.plus}</button>
          </div>
        </div>
      </div>
      <div class="field">How heavy was it?
        <div class="chips">${Object.entries(N.OUTSIDE_WEIGHT).map(([k, v]) => `<label class="chip toggle"><input type="radio" name="weight" value="${k}" ${k === 'regular' ? 'checked' : ''}>${v}</label>`).join('')}</div>
        <span class="hint">Light: idli, salad, soup. Heavy: biryani, fried food, pizza.</span>
      </div>
      <label class="field"><span>Place <span class="opt">optional</span></span><input name="place" value="${esc(preset.place || '')}" placeholder="Swiggy, Paragon, office canteen" maxlength="40"></label>
      <p class="note plain">If a home meal was planned for the same meal, Homzy counts this one instead.</p>
      <button class="btn coral wide">Save</button>
    </form>`, { tall: true });
}

// ----- Feedback -----
function feedbackSheet(rating) {
  openSheet(`
    <h2 class="sheet-title big">Send feedback</h2>
    <p class="sub">It goes straight to the Homzy team. We read every message.</p>
    <form data-form="feedback" class="stack">
      <div class="field">How is it going?
        <div class="faces" role="radiogroup" aria-label="Rating">
          ${FACES.map((f, i) => `<label class="face"><input type="radio" name="rating" value="${i + 1}" ${rating === i + 1 ? 'checked' : ''} aria-label="${FACE_LABELS[i]}"><span>${f}</span></label>`).join('')}
        </div>
      </div>
      <div class="field">What is it about?
        <div class="chips">${Object.entries(FEEDBACK_KINDS).map(([k, v]) => `<label class="chip toggle"><input type="radio" name="kind" value="${k}" ${k === (rating && rating >= 4 ? 'praise' : 'idea') ? 'checked' : ''}>${v}</label>`).join('')}</div>
      </div>
      <label class="field">Your message<textarea name="message" rows="5" maxlength="2000" required placeholder="What would make Homzy better for your home?" ${rating ? 'autofocus' : ''}></textarea></label>
      <label class="field"><span>Email or phone <span class="opt">optional, only if you want a reply</span></span><input name="contact" maxlength="120" autocomplete="email"></label>
      <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="note plain">We receive your message, rating, app version and household size. Never your lists, meals or bills.</p>
      <button class="btn coral wide" id="fb-send">Send feedback</button>
    </form>`, { tall: true });
}

function settingsSheet() {
  openSheet(`
    <h2 class="sheet-title big">Home settings</h2>
    <form data-form="settings" class="stack">
      <label class="field">Home name<input name="home" value="${esc(s.home.name)}" maxlength="30"></label>
      <div class="field">People usually eating
        <div class="stepper" data-stepper>
          <button type="button" data-action="step" data-d="-1" aria-label="Fewer">${I.minus}</button>
          <output>${plural(s.home.people, 'person', 'people')}</output>
          <input type="hidden" name="people" value="${s.home.people}">
          <button type="button" data-action="step" data-d="1" aria-label="More">${I.plus}</button>
        </div>
      </div>
      <div class="field">Voice language<div class="chips">${Object.entries(LANGS).map(([k, v]) => `<label class="chip toggle"><input type="radio" name="lang" value="${k}" ${s.lang === k ? 'checked' : ''}>${v}</label>`).join('')}</div></div>
      <div class="field">Appearance<div class="chips">${Object.entries(THEMES).map(([k, v]) => `<label class="chip toggle"><input type="radio" name="theme" value="${k}" ${pref('theme', 'system') === k ? 'checked' : ''}>${v}</label>`).join('')}</div></div>
      <button class="btn coral wide">Save</button>
    </form>`);
}

// ---------- Speak, then check before adding ----------
let stopListening = null;
let ignoreEnd = false;   // stopped to change language: don't open the review
let draft = [];          // items waiting in the review sheet: { k, name, qty, unit }
let draftCarry = false;  // "Say more" from the review sheet adds to the same draft
const UNITS = ['', 'kg', 'g', 'L', 'ml', 'pcs', 'pkt', 'dozen', 'bottle'];
const EXAMPLES = ['“2 kg rice, 1 litre milk and 6 eggs”', '“do kilo chawal aur ek litre doodh”', '“randu kilo ari, oru litre paal”'];

function speakSheet(more = false) {
  draftCarry = more;
  openSheet(`
    <h2 class="sheet-title big center">${more ? 'Say more items' : 'What do we need?'}</h2>
    ${canListen ? `
      <div class="mic-wrap">
        <button class="mic" id="mic" aria-pressed="false" aria-label="Start listening">${I.mic}</button>
        <p class="mic-state" id="mic-state" aria-live="polite">Tap the mic and speak</p>
      </div>
      <p class="heard" id="heard">Say several things at once, the way you would at home.</p>
      <div class="chips center heard-items" id="heard-items" aria-label="Items heard so far"></div>
      <ul class="examples">${EXAMPLES.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="chips center" role="group" aria-label="Voice language">${Object.entries(LANGS).map(([k, v]) => `<button class="chip ${s.lang === k ? 'on' : ''}" data-action="lang" data-lang="${k}" aria-pressed="${s.lang === k}">${v}</button>`).join('')}</div>`
    : `<p class="note">Voice isn’t available in this browser. Type below, or use your keyboard’s mic. You can type several items at once.</p>`}
    <form class="inline-add" data-form="speak-type">
      <label class="sr-only" for="speak-text">Type items</label>
      <input id="speak-text" name="text" placeholder="Or type: milk, 2 kg rice, eggs" autocomplete="off" enterkeyhint="go" ${canListen ? '' : 'autofocus'}>
      <button class="add-btn" aria-label="Check these items">${I.chev}</button>
    </form>`, {
    onMount: () => { if (canListen) startListening(); },
    onClose: () => { ignoreEnd = true; stopListening?.(); stopListening = null; },
  });
}

function micState(on, text) {
  const mic = $('#mic'), st = $('#mic-state');
  if (!mic) return;
  mic.classList.toggle('on', on);
  mic.innerHTML = on ? I.stop : I.mic;
  mic.setAttribute('aria-pressed', String(on));
  mic.setAttribute('aria-label', on ? 'Stop listening' : 'Start listening');
  st.textContent = text || (on ? 'Listening… tap to stop' : 'Tap the mic and speak');
  st.classList.toggle('live', on);
}

function startListening() {
  const heard = $('#heard'), chips = $('#heard-items');
  if (!$('#mic')) return;
  if (stopListening) { stopListening(); return; } // second tap: stop and review
  ignoreEnd = false;
  micState(true);
  heard.textContent = '…';
  chips.innerHTML = '';
  stopListening = listen(s.lang, {
    onText: (text) => {
      if (!$('#heard')) return;
      heard.textContent = text || '…';
      // Show what Homzy understood so far, while they keep talking.
      chips.innerHTML = parseSpeech(text).map((x) => `<span class="chip sm">${esc(x.name)}${x.qty != null ? ` · ${esc(M.fmtQty(x.qty, x.unit))}` : ''}</span>`).join('');
    },
    onEnd: (text, error) => {
      stopListening = null;
      if (ignoreEnd || !$('#mic')) { ignoreEnd = false; micState(false); return; }
      micState(false);
      if (text) return reviewItems(text);
      heard.textContent = speechError(error || 'no-speech');
    },
  });
}

/** Turn spoken or typed text into items and show them for a quick check. */
function reviewItems(text) {
  const parsed = parseSpeech(text);
  if (!parsed.length) {
    const h = $('#heard');
    if (h) h.textContent = 'Couldn’t catch any items. Try again?'; else toast('Couldn’t find any items in that.');
    return;
  }
  const found = parsed.map((x) => ({ k: M.uid(), name: x.name, qty: x.qty, unit: x.unit }));
  draft = draftCarry ? [...draft, ...found] : found;
  draftCarry = false;
  draftSheet();
}

function draftSheet() {
  openSheet(`
    <h2 class="sheet-title big">Check before adding</h2>
    <p class="sub" id="draft-sub"></p>
    <ul class="draft" id="draft-list"></ul>
    <div class="draft-tools">
      <button type="button" class="link" data-action="draft-new">${I.plus} Add another</button>
      ${canListen ? `<button type="button" class="link" data-action="draft-speak">${I.mic} Say more</button>` : ''}
    </div>
    <button type="button" class="btn coral wide" data-action="draft-add" id="draft-add"></button>`, {
    tall: true,
    onMount: (sh) => {
      drawDraft();
      sh.addEventListener('input', onDraftInput);
      sh.addEventListener('change', onDraftInput);
      sh.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.draft input')) { e.preventDefault(); $('#draft-add')?.click(); } });
    },
  });
}

function draftRow(x) {
  const dupe = x.name.trim() && M.activeItem(s, x.name);
  return `<li class="draft-row" data-k="${x.k}">
    <div class="draft-line">
      <label class="sr-only" for="dn-${x.k}">Item name</label>
      <input class="dn" id="dn-${x.k}" data-f="name" value="${esc(x.name)}" maxlength="40" autocomplete="off" placeholder="Item name">
      <button type="button" class="icon-btn del" data-action="draft-del" data-k="${x.k}" aria-label="Don’t add ${esc(x.name || 'this item')}">${I.trash}</button>
    </div>
    <div class="draft-line">
      <label class="draft-qty"><span class="sr-only">Quantity</span><input data-f="qty" inputmode="decimal" value="${x.qty ?? ''}" placeholder="Qty" autocomplete="off"></label>
      <label class="draft-unit"><span class="sr-only">Unit</span><select data-f="unit">${UNITS.map((u) => `<option value="${u}" ${u === (x.unit || '') ? 'selected' : ''}>${u || 'Unit'}</option>`).join('')}</select></label>
      ${dupe ? '<span class="tag warn">On the list</span>' : ''}
    </div>
    <div data-nutri>${x.name.trim() ? nutriChips(x) : ''}</div>
  </li>`;
}

function drawDraft() {
  const list = $('#draft-list');
  if (!list) return;
  list.innerHTML = draft.length ? draft.map(draftRow).join('') : '<li class="empty-text">Nothing left to add. Add another, or close this.</li>';
  updateDraftButton();
}

function updateDraftButton() {
  const ready = draft.filter((x) => x.name.trim());
  const b = $('#draft-add');
  if (b) {
    b.disabled = !ready.length;
    b.textContent = !ready.length ? 'Nothing to add' : ready.length === 1 ? `Add ${ready[0].name.trim()}` : `Add all ${ready.length}`;
  }
  const sub = $('#draft-sub');
  if (sub) sub.textContent = ready.length ? `${plural(ready.length, 'item')} found. Fix or remove any before adding.` : '';
}

function onDraftInput(e) {
  const row = e.target.closest('.draft-row');
  const f = e.target.dataset.f;
  const x = row && f && draft.find((d) => d.k === row.dataset.k);
  if (!x) return;
  if (f === 'name') x.name = e.target.value;
  if (f === 'qty') { const q = num(e.target.value); x.qty = q > 0 ? q : null; }
  if (f === 'unit') x.unit = e.target.value || null;
  // Redraw only the nutrition, so the cursor stays where it is.
  const open = row.querySelector('details.nutri')?.open;
  row.querySelector('[data-nutri]').innerHTML = x.name.trim() ? nutriChips(x, { open }) : '';
  updateDraftButton();
}

function addDraft() {
  const items = draft.filter((x) => x.name.trim()).map(({ name, qty, unit }) => ({ name: name.trim(), qty, unit }));
  if (!items.length) return;
  closeSheet();
  draft = [];
  addParsed(items);
}

/** Add free text ("milk, 2 kg rice") straight to the list. */
function addTyped(text) {
  addParsed(parseSpeech(text));
}

/** Add items to the list, warning about duplicates. */
function addParsed(parsed) {
  if (!parsed.length) return;
  let res;
  commit((r) => r.added.length ? `Added ${r.added.map((i) => i.name + (i.qty != null ? ' ' + M.fmtQty(i.qty, i.unit) : '')).join(', ')}` : null,
    () => (res = M.addItems(s, parsed)));
  if (res.dupes.length) {
    const d = res.dupes;
    const msg = `${d.map((x) => x.name).join(', ')} ${d.length === 1 ? 'is' : 'are'} already on the list${d[0].status === 'claimed' ? ` · ${Who(d[0].by)} is buying` : ''}`;
    setTimeout(() => toast(msg, { label: 'Add anyway', run: () => commit('Added as a separate item', () => M.addItems(s, parsed.filter((p) => d.some((x) => M.key(x.name) === M.key(p.name))), { force: true })) }), res.added.length ? 1600 : 0);
  }
  if (tab !== 'list' && tab !== 'home') { tab = 'list'; listMode = 'active'; render(); }
}

// Typing in "Add items": show what will be added, with nutrition, before pressing Add.
let previewTimer = null;
function showAddPreview(text) {
  const box = $('#add-preview');
  if (!box) return;
  const items = text.trim() ? parseSpeech(text) : [];
  box.hidden = !items.length;
  box.innerHTML = items.length ? `
    <p class="preview-head">${items.length > 1 ? `${items.length} items · you can check them before adding` : 'Will add'}</p>
    <ul class="preview-list">${items.map((x) => `<li><span class="row-title"><b>${esc(x.name)}</b>${qtyBadge(x.qty, x.unit)}</span>${nutriChips(x)}</li>`).join('')}</ul>` : '';
}
document.addEventListener('input', (e) => {
  if (e.target.id !== 'list-add-text') return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => showAddPreview(e.target.value), 180);
});

// ---------- Scan ----------
const photo = $('#photo');
photo.addEventListener('change', async () => {
  const file = photo.files[0];
  photo.value = '';
  if (!file) return;
  openSheet(`
    <h2 class="sheet-title big">Reading your bill</h2>
    <div class="progress"><i id="bar"></i></div>
    <p class="note plain center" id="scan-label">Getting the bill reader ready…</p>
    <p class="note plain center">The first scan downloads the reader once (about 10 MB). Your photo stays on this phone.</p>`);
  try {
    const { scanBill } = await import('./scan.js');
    const result = await scanBill(file, (p, label) => {
      const bar = $('#bar'); if (bar) bar.style.width = Math.round(p * 100) + '%';
      const l = $('#scan-label'); if (l) l.textContent = label;
    });
    if ($('#sheet-root').hidden) return;
    reviewSheet(result);
  } catch (err) {
    openSheet(`<h2 class="sheet-title big">Couldn’t read the bill</h2><p class="note">${esc(err.message || 'Something went wrong.')}</p>
      <button class="btn coral wide" data-action="scan">Try another photo</button>
      <button class="btn ghost wide" data-action="bills">Enter the total by hand</button>`);
  }
});

let review = null;
function reviewSheet({ items, total, shop }) {
  review = items.map((x) => ({ ...x, id: M.uid(), listed: !!M.listMatch(s, x.name) }));
  review.forEach((x) => { x.on = x.listed || x.known; });
  const listed = review.filter((x) => x.listed).length;
  openSheet(`
    <h2 class="sheet-title big">Check your bill</h2>
    <p class="sub">${listed ? `${plural(listed, 'item')} from your list will be marked bought by you.` : 'Ticked items are saved to your bought history.'}</p>
    <form data-form="review" class="stack">
      <div class="seg-tabs" role="radiogroup" aria-label="Bill type">
        <label class="chip toggle"><input type="radio" name="type" value="grocery" checked>Groceries</label>
        <label class="chip toggle"><input type="radio" name="type" value="outside">Eating out</label>
      </div>
      <div class="two">
        <label class="field">Shop<input name="shop" value="${esc(shop)}" placeholder="Shop name" maxlength="40"></label>
        <label class="field">Total ₹<input name="total" inputmode="decimal" value="${total ?? ''}" placeholder="0"></label>
      </div>
      ${review.length ? `<ul class="rows bill-lines">${review.map((x) => `<li><label class="row check-row">
        <input type="checkbox" data-review="${x.id}" ${x.on ? 'checked' : ''}>
        <span class="row-main static"><b>${esc(x.name)}</b>${x.listed ? '<span class="meta on-list">On your list</span>' : ''}</span>
        <span class="amount">${x.price != null ? rupees(x.price) : ''}</span></label>
        ${x.known ? nutriChips({ name: x.name }) : ''}</li>`).join('')}</ul>`
      : '<p class="note">No items could be read clearly. You can still save the total.</p>'}
      <button class="btn coral wide">${listed ? 'Mark bought & save bill' : 'Save bill'}</button>
    </form>`, { tall: true });
}

// ---------- Family sync: connect phones with a QR code ----------
// No email or password. The first phone shares the home; each family member's phone
// joins by scanning a QR code made for them on the Family tab.
const VIEW_OK = new Set(['tab', 'close-sheet', 'toast-action', 'switch', 'be', 'lang', 'step', 'list-mode', 'item', 'task', 'meal',
  'check-week', 'recipe', 'bills', 'week-prev', 'week-next', 'feedback', 'fb-snooze', 'settings', 'backup', 'install']);
const VIEW_FORMS = new Set(['feedback', 'settings']);
const viewOnlyToast = () => toast('You can view this home but not change it. Ask the owner for edit access.');
const ROLE = { owner: 'Owner', editor: 'Can edit', viewer: 'View only' };
const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const joinLink = (code) => `${location.origin}/#join=${code}`;
let share = { text: '', link: '' };
let renderLater = false;
let phones = { at: 0, list: [], loading: false }; // which members have a connected phone (owner only)

/** View-only: hide buttons and forms that would change the home. */
function hideEdits(root) {
  if (!viewOnly()) return;
  for (const el of root.querySelectorAll('[data-action]')) {
    const a = el.dataset.action;
    if (!VIEW_OK.has(a) && !a.startsWith('sync-')) el.hidden = true;
  }
  for (const f of root.querySelectorAll('form[data-form]')) {
    const n = f.dataset.form;
    if (!VIEW_FORMS.has(n) && !n.startsWith('sync-')) f.hidden = true;
  }
}
new MutationObserver(() => hideEdits($('#sheet-root'))).observe($('#sheet-root'), { childList: true });

function startSync() {
  M.onSave(() => S.changed());
  S.start({
    getState: () => s,
    setState: (doc) => {
      const L = S.linked();
      s = M.adopt(doc, { me: s.me || L?.memberId, lang: s.lang });
      M.save(s, { quiet: true });
      dropUndo();
      softRender();
    },
    onStatus: showSyncStatus,
    onRoleChange: (role) => {
      softRender();
      toast(role === 'viewer' ? 'You can now view this home, but not change it.' : 'You can now make changes to this home.');
    },
    onRemoved: () => {
      s = M.wipe(); setupStep = 1; render();
      openSheet(`<h2 class="sheet-title big">This phone was disconnected</h2>
        <p class="note">The owner disconnected this phone or stopped sharing the home, so it has been removed from this phone. Ask them for a new QR code to connect again.</p>
        <button class="btn coral wide" data-action="close-sheet">OK</button>`);
    },
  });
  C.config().then((cfg) => { if (cfg) softRender(); handleLinks(); });
}

// A change from another phone shouldn't wipe out what you're typing.
const typing = () => {
  const a = document.activeElement;
  return !!a && view.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.value.trim() !== '';
};
function softRender() {
  if (typing()) { renderLater = true; return; }
  renderLater = false;
  // Keep focus in an empty box (e.g. "Add an item") across the redraw.
  const a = document.activeElement;
  const form = view.contains(a) && a.name ? a.closest('[data-form]')?.dataset.form : null;
  render();
  if (form) view.querySelector(`[data-form="${form}"] [name="${a.name}"]`)?.focus({ preventScroll: true });
}
view.addEventListener('focusout', () => setTimeout(() => { if (renderLater && !typing()) softRender(); }, 400));

// Undo would bring back the other phone's old data, so drop it once their change arrives.
function dropUndo() {
  const el = $('#toast');
  if (el?._fn && !el._safe) hideToast();
}

function syncLine() {
  const st = S.getStatus();
  const text = st.state === 'syncing' ? 'Syncing…'
    : st.state === 'offline' ? 'Offline. Changes will sync when you’re back online.'
    : st.state === 'error' ? st.error || 'Couldn’t sync. Trying again soon.'
    : st.at ? `Synced · ${timeAgo(st.at)}` : 'Synced';
  return `<i class="dot ${st.state}" aria-hidden="true"></i><span>${esc(text)}</span>`;
}
function showSyncStatus() {
  const el = $('#sync-status');
  if (el) el.innerHTML = syncLine();
}

// ----- Which members have their own phone connected (owner's Family tab) -----
const canConnect = () => C.configured() && (!S.linked() || S.isOwner());
const phoneOf = (memberId) => phones.list.find((p) => p.member_id === memberId && p.role !== 'owner');

function refreshPhones(force) {
  const L = S.linked();
  if (!L || !S.isOwner() || phones.loading || (!force && Date.now() - phones.at < 10_000)) return;
  phones.loading = true;
  C.listMembers(L.hid)
    .then((list) => { phones = { at: Date.now(), list, loading: false }; if (tab === 'family') softRender(); })
    .catch(() => { phones.loading = false; phones.at = Date.now(); });
}

/** Buttons at the end of a member row on the Family tab. */
function memberConnect(m) {
  if (m.id === s.me || !canConnect()) return '';
  const p = phoneOf(m.id);
  return p
    ? `<button class="pill ghost" data-action="sync-qr" data-id="${m.id}" aria-label="${esc(m.name)}’s phone: ${ROLE[p.role]}">${I.check} ${p.role === 'viewer' ? 'Viewing' : 'Connected'}</button>`
    : `<button class="pill sage" data-action="sync-qr" data-id="${m.id}" aria-label="Show a QR code to connect ${esc(m.name)}’s phone">${I.qr} Connect</button>`;
}
const memberPhoneMeta = (m) => {
  if (m.id === s.me && S.linked()) return 'This phone';
  const p = S.isOwner() && phoneOf(m.id);
  return p ? ROLE[p.role] : '';
};

function syncCard() {
  if (!C.configured()) {
    return `<div class="card info"><b>Use Homzy on every phone</b>
      <p>Family sync isn’t switched on for this site yet. Until then, share the list on WhatsApp or use this phone together.</p></div>`;
  }
  const L = S.linked();
  if (!L) {
    return `<div class="card info">
      <b>Use Homzy on everyone’s phone</b>
      <p>${s.members.length > 1
        ? 'Tap <b>Connect</b> next to a family member to show their QR code. They scan it with their phone camera and Homzy opens with your home. No email or password.'
        : 'Add a family member above, then tap <b>Connect</b> next to their name to show a QR code for their phone.'}</p>
    </div>`;
  }
  refreshPhones();
  const lost = !C.signedIn();
  return `<div class="card sync-card">
    <p class="sync-status" id="sync-status" role="status">${syncLine()}</p>
    <p class="meta">${lost ? 'This phone lost its connection. Ask the owner for a new QR code.' : `This phone · ${ROLE[L.role] || ''}`}</p>
    <div class="stack-sm">
      <button class="menu-row" data-action="sync-access">Connected phones ${I.chev}</button>
      ${S.isOwner() ? '' : `<button class="menu-row" data-action="sync-leave">Disconnect this phone ${I.chev}</button>`}
    </div>
  </div>`;
}

function errorSheet(msg) {
  openSheet(`<h2 class="sheet-title big">That didn’t work</h2><p class="note">${esc(msg)}</p>
    <button class="btn coral wide" data-action="close-sheet">OK</button>`);
}
const workingSheet = (title) => openSheet(`<h2 class="sheet-title big">${title}</h2><div class="progress"><i style="width:60%"></i></div>`);

/** Disable a button and change its label while `fn` runs. */
async function busy(id, label, fn) {
  const b = $('#' + id);
  const old = b?.innerHTML;
  if (b) { b.disabled = true; b.textContent = label; }
  try { return await fn(); } finally { if (b?.isConnected) { b.disabled = false; b.innerHTML = old; } }
}
function formError(msg) {
  const el = $('#form-err');
  if (el) { el.textContent = msg; el.hidden = false; } else toast(msg);
}

// ----- Owner: put the home online and make QR codes -----
async function goOnline() {
  await C.ensureAccount();
  const info = await C.rpc('my_household');
  if (info) { // this phone already shares a home (e.g. after a reinstall that kept storage)
    const row = await C.getHousehold(info.household_id);
    S.link({ hid: info.household_id, role: info.role, rev: row.rev, base: row.data, memberId: info.member_id });
    S.run();
    return;
  }
  const doc = S.docOf(s);
  const r = await C.rpc('create_household', { p_name: s.home.name, p_data: doc, p_member_id: s.me });
  S.link({ hid: r.household_id, role: 'owner', rev: r.rev, base: doc, memberId: s.me });
}

/** Tap "Connect" next to a member. */
function connectSheet(memberId) {
  const m = M.member(s, memberId);
  if (!m) return;
  const p = phoneOf(memberId);
  if (p) {
    return openSheet(`
      <h2 class="sheet-title big">${esc(m.name)}’s phone is connected</h2>
      <p class="sub">${ROLE[p.role]} · since ${new Date(p.joined_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
      <button class="btn ghost wide" data-action="sync-role" data-user="${p.user_id}" data-role="${p.role === 'viewer' ? 'editor' : 'viewer'}">${p.role === 'viewer' ? 'Allow them to make changes' : 'Make it view only'}</button>
      <button class="btn ghost wide" data-action="sync-qr-new" data-id="${m.id}">${I.qr} New QR code for another phone</button>
      <button class="btn danger wide" data-action="sync-remove" data-user="${p.user_id}" data-name="${esc(m.name)}">Disconnect ${esc(m.name)}’s phone</button>`);
  }
  roleSheet(memberId);
}

function roleSheet(memberId) {
  const m = M.member(s, memberId);
  openSheet(`
    <h2 class="sheet-title big">Connect ${esc(m.name)}’s phone</h2>
    <form data-form="sync-qr" data-id="${m.id}" class="stack">
      <div class="field">What can ${esc(m.name)} do?
        <div class="chips">
          <label class="chip toggle"><input type="radio" name="role" value="editor" checked>Can edit</label>
          <label class="chip toggle"><input type="radio" name="role" value="viewer">View only</label>
        </div>
        <span class="hint role-hint">Can edit: add to the list, plan meals, log bills and food from outside. View only: see everything, change nothing.</span>
      </div>
      ${S.linked() ? '' : '<p class="note">This puts your home online so family phones can sync with it. Only phones that scan your QR codes can see it.</p>'}
      <p class="note error" id="form-err" role="alert" hidden></p>
      <button class="btn coral wide" id="qr-btn">${I.qr} Show QR code</button>
    </form>`);
}

async function qrSvg(text) {
  const { default: qrcode } = await import('./vendor/qrcode.js');
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
}

async function showQr(code, name, role) {
  const link = joinLink(code);
  share = {
    link,
    text: `${me()?.name || 'Your family'} added you to “${s.home.name}” on Homzy (${role === 'viewer' ? 'view only' : 'can edit'}).\n`
      + `Open this link on your phone:\n${link}\n\nCode: ${code}. It works once, for 7 days.`,
  };
  openSheet(`
    <h2 class="sheet-title big">Scan to connect ${esc(name)}</h2>
    <p class="sub">${ROLE[role]} · works once, for 7 days</p>
    <div class="qr-box" role="img" aria-label="QR code for ${esc(name)}">${await qrSvg(link)}</div>
    <p class="code-box small" aria-label="Code ${code.split('').join(' ')}">${code.slice(0, 4)} ${code.slice(4)}</p>
    <p class="note plain">On ${esc(name)}’s phone, open the camera and point it at this code, then tap the link. Or open Homzy there and type the code.</p>
    <button class="btn ghost wide" data-action="sync-share">${I.share} Send as a link instead</button>`,
  { tall: true, onClose: () => setTimeout(() => refreshPhones(true), 300) });
}

// ----- Family member: join by QR link or typed code -----
function joinSheet() {
  openSheet(`
    <h2 class="sheet-title big">Join your family’s home</h2>
    <p class="sub">Ask whoever set up Homzy to open Family → Connect next to your name.</p>
    ${'BarcodeDetector' in window ? `<button class="btn coral wide" data-action="sync-scan">${I.camera} Scan the QR code</button>` : ''}
    <form data-form="sync-join" class="stack">
      <label class="field">Or type the code<input name="code" class="code-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="K7MP 3QXA" required></label>
      <p class="note error" id="form-err" role="alert" hidden></p>
      <button class="btn ${'BarcodeDetector' in window ? 'ghost' : 'coral'} wide" id="join-btn">Join</button>
    </form>`);
}

/** Join with a code from a QR link or typed in. Asks first if this phone has its own home. */
function joinHome(code) {
  if (S.linked()) return errorSheet('This phone is already connected to a home. Disconnect it in the Family tab first.');
  if (s.setup) {
    return confirmSheet('Join your family’s home?',
      `This phone already has its own Homzy home. Joining replaces it with your family’s home. <button type="button" class="link" data-action="backup">Download a backup first</button>`,
      'Join', 'sync-join-yes', false, code);
  }
  doJoin(code);
}

async function doJoin(code) {
  workingSheet('Joining your family’s home…');
  try {
    await C.ensureAccount();
    const info = await C.rpc('join_household', { p_code: code });
    await loadHome(info);
  } catch (e) {
    errorSheet(e.message);
  }
}

async function loadHome(info) {
  const row = await C.getHousehold(info.household_id);
  if (!row) throw new C.CloudError('Couldn’t open that home. Please try again.');
  s = M.adopt(row.data, { me: info.member_id, lang: s.lang });
  S.link({ hid: info.household_id, role: info.role, rev: row.rev, base: row.data, memberId: info.member_id });
  M.save(s, { quiet: true });
  const known = !!s.me;
  tab = 'home'; setPref('tab', tab);
  closeSheet();
  render();
  if (!known) whoAmISheet();
  else toast(`Welcome to ${s.home.name}, ${me().name}`);
}

function whoAmISheet() {
  openSheet(`
    <h2 class="sheet-title big">Which one are you?</h2>
    <p class="sub">So your family can see who bought what and who’s doing which task.</p>
    <div class="who-grid">${s.members.map((m) => `<button class="who" data-action="sync-iam" data-id="${m.id}">${avatar(m, 'lg')}<span>${esc(m.name)}</span></button>`).join('')}</div>`);
}

function iAm(id) {
  s.me = id;
  M.save(s, { quiet: true });
  C.rpc('set_my_member', { p_member_id: id }).catch(() => { /* it is also kept on this phone */ });
  closeSheet();
  render();
  toast(`Welcome, ${me().name}`);
}

/** Read a QR code from a photo (Chrome on Android has a built-in reader). */
async function scanQrPhoto(file) {
  try {
    const img = await createImageBitmap(file);
    const found = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(img);
    const text = found[0]?.rawValue || '';
    const code = cleanCode(text.match(/join=([A-Za-z0-9]+)/)?.[1] || text);
    if (code.length !== 8) return formError('Couldn’t find a Homzy QR code in that photo. Try again, closer and in good light.');
    joinHome(code);
  } catch {
    formError('Couldn’t read that photo. Type the code instead.');
  }
}

// ----- Everyone: who is connected -----
let accessSeq = 0;
async function accessSheet() {
  const L = S.linked();
  if (!L) return;
  const seq = ++accessSeq;
  const owner = S.isOwner();
  openSheet('<h2 class="sheet-title big">Connected phones</h2><p class="note plain center">Loading…</p>', { tall: true });
  try {
    const [people, invites] = await Promise.all([C.listMembers(L.hid), owner ? C.listInvites(L.hid) : []]);
    if ($('#sheet-root').hidden || seq !== accessSeq) return; // closed, or a newer refresh is on its way
    phones = { at: Date.now(), list: people, loading: false };
    const short = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    openSheet(`
      <h2 class="sheet-title big">Connected phones</h2>
      <ul class="rows">${people.map((p) => {
        const m = M.member(s, p.member_id);
        const label = m?.name || 'A family phone';
        return `<li class="row">${avatar(m || { name: '?', hue: 200 })}
          <span class="row-main static"><b>${esc(label)}${p.user_id === C.user()?.id ? ' <span class="tag">This phone</span>' : ''}</b>
            <span class="meta">${ROLE[p.role]} · since ${short(p.joined_at)}</span></span>
          ${owner && p.role !== 'owner' ? `
            <button class="pill ghost" data-action="sync-role" data-user="${p.user_id}" data-role="${p.role === 'viewer' ? 'editor' : 'viewer'}">${p.role === 'viewer' ? 'Allow edits' : 'Make view only'}</button>
            <button class="icon-btn quiet" data-action="sync-remove" data-user="${p.user_id}" data-name="${esc(label)}" aria-label="Disconnect ${esc(label)}’s phone">${I.x}</button>` : ''}
        </li>`;
      }).join('')}</ul>
      ${invites.length ? `<h3 class="sec">QR codes not scanned yet</h3>
      <ul class="rows">${invites.map((i) => {
        const name = i.member_id ? M.firstName(s, i.member_id) : 'someone';
        return `<li class="row"><span class="row-main static"><b class="mono">${esc(i.code.slice(0, 4))} ${esc(i.code.slice(4))}</b>
          <span class="meta">For ${esc(name)} · ${ROLE[i.role]} · until ${short(i.expires_at)}</span></span>
          <button class="pill ghost" data-action="sync-reshow" data-code="${esc(i.code)}" data-name="${esc(name)}" data-role="${i.role}">${I.qr} Show</button>
          <button class="icon-btn quiet" data-action="sync-revoke" data-code="${esc(i.code)}" aria-label="Cancel this QR code">${I.x}</button></li>`;
      }).join('')}</ul>` : ''}
      ${owner ? `<p class="note plain">To connect someone, tap <b>Connect</b> next to their name in the Members list.</p>
        <button class="menu-row danger" data-action="sync-delete">Stop sharing and delete the online copy ${I.chev}</button>`
      : '<p class="note plain">Only the person who set up this home can connect or disconnect phones.</p>'}`, { tall: true });
  } catch (e) {
    if (seq === accessSeq) errorSheet(e.message);
  }
}

let confirmArg = null;
function confirmSheet(title, body, yesLabel, yesAction, danger = true, arg = null) {
  confirmArg = arg;
  openSheet(`<h2 class="sheet-title big">${title}</h2><p class="note">${body}</p>
    <div class="btn-row"><button class="btn ghost" data-action="close-sheet">Cancel</button>
    <button class="btn ${danger ? 'danger-fill' : 'coral'}" data-action="${yesAction}">${yesLabel}</button></div>`);
}

/** Forget the home and this phone's account (after leaving or disconnecting). */
async function forgetHere(message) {
  await C.signOut();
  S.unlink();
  s = M.wipe();
  setupStep = 1; tab = 'home'; setPref('tab', tab);
  closeSheet();
  render();
  toast(message);
}

function handleLinks() {
  const h = location.hash;
  if (!h || h.length < 2) return;
  const code = cleanCode(new URLSearchParams(h.slice(1)).get('join'));
  if (!code) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (!C.configured()) return toast('Family sync isn’t switched on for this site yet.');
  joinHome(code);
}

const SYNC_ACTIONS = {
  'sync-qr': (el) => connectSheet(el.dataset.id),
  'sync-qr-new': (el) => roleSheet(el.dataset.id),
  'sync-reshow': (el) => showQr(el.dataset.code, el.dataset.name, el.dataset.role),
  'sync-share': () => {
    if (navigator.share) navigator.share({ text: share.text }).catch(() => {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(share.text), '_blank', 'noopener');
  },
  'sync-join-start': () => joinSheet(),
  'sync-join-yes': () => doJoin(confirmArg),
  'sync-scan': () => $('#qr-photo').click(),
  'sync-iam': (el) => iAm(el.dataset.id),
  'sync-access': () => accessSheet(),
  'sync-role': async (el) => {
    try {
      await C.rpc('set_member_role', { p_user: el.dataset.user, p_role: el.dataset.role });
      toast(el.dataset.role === 'viewer' ? 'Changed to view only' : 'They can make changes now');
      refreshPhones(true);
      if (el.closest('.sheet')?.querySelector('[data-action="sync-qr-new"]')) closeSheet(); else accessSheet();
    } catch (e) { toast(e.message); }
  },
  'sync-remove': async (el) => {
    try {
      await C.rpc('remove_member', { p_user: el.dataset.user });
      toast(`${el.dataset.name}’s phone is disconnected`);
      refreshPhones(true);
      if (el.closest('.sheet')?.querySelector('[data-action="sync-qr-new"]')) closeSheet(); else accessSheet();
    } catch (e) { toast(e.message); }
  },
  'sync-revoke': async (el) => {
    try { await C.rpc('revoke_invite', { p_code: el.dataset.code }); toast('QR code cancelled'); accessSheet(); } catch (e) { toast(e.message); }
  },
  'sync-delete': () => confirmSheet('Stop sharing this home?',
    'Every connected phone is disconnected and the online copy is deleted. This phone keeps its own copy, so nothing is lost here.',
    'Stop sharing', 'sync-delete-yes'),
  'sync-delete-yes': async () => {
    try {
      await C.rpc('delete_household');
      S.unlink();
      phones = { at: 0, list: [], loading: false };
      closeSheet(); render();
      toast('Stopped sharing. This phone still has everything.');
    } catch (e) { errorSheet(e.message); }
  },
  'sync-leave': async () => {
    await S.run().catch(() => {});
    const unsent = S.pending();
    confirmSheet('Disconnect this phone?',
      `${unsent ? '<b>Some changes haven’t uploaded yet and will be lost.</b> Connect to the internet first if you can. ' : ''}`
      + `“${esc(s.home.name)}” is removed from this phone. It stays on everyone else’s. To connect again you’ll need a new QR code.`,
      'Disconnect', 'sync-leave-yes');
  },
  'sync-leave-yes': async () => {
    try { await C.rpc('leave_household'); } catch (e) { if (e.code !== 'signed_out') return errorSheet(e.message); }
    await forgetHere('This phone is disconnected.');
  },
};

const SYNC_FORMS = {
  'sync-qr': async (f, d) => {
    const m = M.member(s, f.dataset.id);
    const role = d.role === 'viewer' ? 'viewer' : 'editor';
    if (!m) return closeSheet();
    try {
      const code = await busy('qr-btn', 'Making the code…', async () => {
        if (!S.linked()) await goOnline();
        await S.run(); // make sure their name is online before they scan
        return C.rpc('create_invite', { p_role: role, p_member_id: m.id });
      });
      render();
      await showQr(code, m.name, role);
    } catch (e) { formError(e.message); }
  },
  'sync-join': (f, d) => {
    const code = cleanCode(d.code);
    if (code.length !== 8) return formError('The code has 8 letters and numbers.');
    joinHome(code);
  },
};

$('#qr-photo').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) scanQrPhoto(file);
});

// ---------- Actions ----------
const byId = (arr, id) => arr.find((x) => x.id === id);
const after = (el, fn) => { if (el.dataset.keep) fn?.(); else if (el.dataset.close) closeSheet(); };

const ACTIONS = {
  tab: (el) => { tab = el.dataset.tab; setPref('tab', tab); closeSheet(); render(); scrollTo(0, 0); if (tab === 'family') refreshPhones(true); },
  'close-sheet': () => closeSheet(),
  'toast-action': () => runToastAction(),
  scan: () => { closeSheet(); photo.click(); },
  speak: () => speakSheet(),
  switch: () => switchSheet(),
  be: (el) => {
    s.me = el.dataset.id; persist();
    toast(`Using Homzy as ${me().name}`);
    if (el.dataset.close) closeSheet();
  },
  lang: (el) => {
    s.lang = el.dataset.lang; M.save(s, { quiet: true });
    $$('[data-action="lang"]').forEach((b) => { b.classList.toggle('on', b === el); b.setAttribute('aria-pressed', String(b === el)); });
    if (stopListening) { ignoreEnd = true; stopListening(); }
    micState(false, `${LANGS[s.lang]} · tap the mic and speak`);
  },
  'draft-del': (el) => {
    const i = draft.findIndex((x) => x.k === el.dataset.k);
    if (i < 0) return;
    draft.splice(i, 1);
    drawDraft();
    ($$('.draft .dn')[Math.min(i, draft.length - 1)] || $('#draft-add'))?.focus();
  },
  'draft-new': () => {
    draft.push({ k: M.uid(), name: '', qty: null, unit: null });
    drawDraft();
    $$('.draft .dn').pop()?.focus();
  },
  'draft-speak': () => speakSheet(true),
  'draft-add': () => addDraft(),

  // setup
  step: (el) => {
    const box = el.closest('[data-stepper]');
    const input = box.querySelector('input');
    const v = Math.max(1, Math.min(20, (+input.value || 4) + +el.dataset.d));
    input.value = v; box.querySelector('output').textContent = plural(v, 'person', 'people');
  },
  'setup-back': () => { setupStep = 1; render(); },
  'setup-remove': (el) => { setupDraft.others.splice(+el.dataset.i, 1); render(); },
  'setup-finish': () => {
    const d = setupDraft;
    s = M.fresh();
    s.home = { name: d.home.trim() || 'Our home', people: d.people };
    const self = M.addMember(s, d.name);
    s.me = self.id;
    d.others.forEach((n) => M.addMember(s, n));
    const all = M.allRecipes(s);
    s.favs = d.dinners.map((n) => all.find((r) => r.name === n)?.id).filter(Boolean);
    s.setup = true;
    tab = 'home'; setPref('tab', tab);
    persist();
    toast(`Welcome home, ${self.name}`);
  },

  // meals
  slot: (el) => { planSlot = el.dataset.slot; setPref('slot', planSlot); render(); },
  pick: (el) => pickSheet(el.dataset.date, el.dataset.slot),
  meal: (el) => mealSheet(el.dataset.date, el.dataset.slot),
  'quick-meal': (el) => { commit(null, () => M.setMeal(s, today(), 'd', el.dataset.rid)); mealSheet(today(), 'd'); },
  'set-meal': (el) => {
    const { date, slot } = $('#pick-list').dataset;
    const prev = M.mealAt(s, date, slot);
    const fromMeal = prev && s.items.some((i) => i.meal && i.meal === M.recipe(s, prev.rid)?.name);
    commit(fromMeal ? 'Meal changed. Items already on the list were kept.' : null, () => M.setMeal(s, date, slot, el.dataset.rid));
    mealSheet(date, slot);
  },
  'new-meal': (el) => { const { date, slot } = $('#pick-list').dataset; recipeSheet(null, { name: el.dataset.name, date, slot }); },
  'clear-meal': () => {
    const { date, slot } = $('#pick-list').dataset;
    closeSheet();
    removeWithUndo('meal', { date, slot });
  },
  'meal-clear': (el) => removeWithUndo('meal', { date: el.dataset.date, slot: el.dataset.slot }),
  'meal-people': (el) => {
    const m = M.mealAt(s, checkCtx.date, checkCtx.slot);
    M.setPeople(s, checkCtx.date, checkCtx.slot, m.people + +el.dataset.d);
    M.save(s); render(); drawCheckSheet(true);
  },
  'check-week': () => checkWeekSheet(),
  'copy-week': () => {
    commit((n) => n ? `Copied ${plural(n, 'meal')} from last week` : 'This week is already planned', () => M.copyLastWeek(s, today()));
  },
  hnc: (el) => {
    const row = checkCtx.rows[+el.dataset.i];
    M.setCheck(s, row.sources, row.name, el.dataset.st);
    M.save(s); drawCheckSheet(true); render();
  },
  'all-have': () => {
    for (const row of checkCtx.rows) if (!row.onList && row.state !== 'need') M.setCheck(s, row.sources, row.name, 'have');
    M.save(s); drawCheckSheet(true); render();
  },
  'add-needs': () => {
    const need = checkCtx.rows.filter((x) => x.state === 'need' && !x.onList);
    const mealName = checkCtx.single ? M.recipe(s, M.mealAt(s, checkCtx.date, checkCtx.slot).rid).name : null;
    commit((r) => `Added ${r.added.map((i) => i.name).join(', ')} to the list`,
      () => M.addItems(s, need.map((x) => ({ name: x.name, qty: x.qty, unit: x.unit })), { meal: mealName }));
    drawCheckSheet(true);
  },

  // list
  'list-mode': (el) => { listMode = el.dataset.mode; render(); },
  'quick-add': (el) => addTyped(el.dataset.name),
  item: (el) => itemSheet(el.dataset.id),
  claim: (el) => { const i = byId(s.items, el.dataset.id); commit(`You’re buying ${i.name}`, () => M.claim(s, i.id)); after(el, () => itemSheet(i.id)); },
  release: (el) => { const i = byId(s.items, el.dataset.id); commit(`${i.name} is open for anyone again`, () => M.release(s, i.id)); after(el, () => itemSheet(i.id)); },
  assign: (el) => { const i = byId(s.items, el.dataset.id); commit(`Asked ${M.firstName(s, el.dataset.m)} to buy ${i.name}`, () => M.assign(s, i.id, el.dataset.m)); itemSheet(i.id); },
  'item-accept': (el) => { const i = byId(s.items, el.dataset.id); commit(`You’re buying ${i.name}`, () => M.acceptItem(s, i.id)); after(el, () => itemSheet(i.id)); },
  'item-decline': (el) => { const i = byId(s.items, el.dataset.id); commit(`${i.name} is open for anyone`, () => M.declineItem(s, i.id)); after(el, () => itemSheet(i.id)); },
  'quick-buy': (el) => { const i = byId(s.items, el.dataset.id); commit(`${i.name} marked bought`, () => M.buy(s, i.id)); },
  'item-remove': (el) => { closeSheet(); removeWithUndo('item', el.dataset.id); },
  'item-del': (el) => removeWithUndo('item', el.dataset.id),
  'bought-del': (el) => removeWithUndo('bought', el.dataset.id),
  restore: (el) => { const b = byId(s.bought, el.dataset.id); commit(`${b.name} is back on the list`, () => M.restore(s, b.id)); },
  'share-list': () => {
    const text = `🛒 ${s.home.name} – shopping list\n` + sortItems(s.items).map((i) => `• ${i.name}${i.qty != null ? ' – ' + M.fmtQty(i.qty, i.unit) : ''}${i.status === 'claimed' ? ` (${M.firstName(s, i.by)} is buying)` : ''}`).join('\n');
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  },

  // tasks
  'task-new': (el) => taskSheet(null, { title: el.dataset.title }),
  'task-idea': (el) => { const f = el.closest('form'); f.title.value = el.dataset.title; f.title.focus(); },
  task: (el) => taskSheet(el.dataset.id),
  'task-take': (el) => { const t = byId(s.tasks, el.dataset.id); commit(`You’ll ${t.title.toLowerCase()}`, () => M.takeTask(s, t.id)); after(el); },
  'task-accept': (el) => { const t = byId(s.tasks, el.dataset.id); commit(`Accepted: ${t.title}`, () => M.acceptTask(s, t.id)); after(el); },
  'task-decline': (el) => { const t = byId(s.tasks, el.dataset.id); commit('Okay. It’s open for anyone now.', () => M.declineTask(s, t.id)); after(el); },
  'task-release': (el) => { const t = byId(s.tasks, el.dataset.id); commit('Released for anyone', () => M.releaseTask(s, t.id)); after(el); },
  'task-done': (el) => { const t = byId(s.tasks, el.dataset.id); commit(`Done: ${t.title}`, () => M.finishTask(s, t.id)); after(el); },
  'task-remove': (el) => { closeSheet(); removeWithUndo('task', el.dataset.id); },
  'task-del': (el) => removeWithUndo('task', el.dataset.id),

  // family & recipes
  'member-remove': (el) => {
    const m = M.member(s, el.dataset.id);
    const p = S.isOwner() && phoneOf(m.id);
    if (p) C.rpc('remove_member', { p_user: p.user_id }).then(() => refreshPhones(true)).catch(() => {}); // their phone goes too
    commit(`Removed ${m.name}. Their claims are open again.`, () => M.removeMember(s, m.id));
  },
  recipe: (el) => recipeSheet(el.dataset.id),
  'recipe-del': (el) => { closeSheet(); removeWithUndo('recipe', el.dataset.id); },
  'recipe-new': () => recipeSheet(null),
  fav: (el) => { const r = M.recipe(s, el.dataset.id); commit(s.favs.includes(r.id) ? `Removed ${r.name} from favourites` : `Saved ${r.name}`, () => M.toggleFav(s, r.id)); after(el); },
  settings: () => settingsSheet(),
  bills: () => billsSheet(),

  // week, outside food, feedback
  'week-prev': () => { weekOffset--; render(); },
  'week-next': () => { weekOffset = Math.min(0, weekOffset + 1); render(); },
  'outside-new': () => outsideSheet(),
  'outside-remove': (el) => removeWithUndo('outside', el.dataset.id),
  feedback: (el) => feedbackSheet(+el.dataset.rating || 0),
  'fb-snooze': () => { setPref('fb-snooze', String(Date.now() + 14 * 864e5)); render(); },
  'bill-remove': (el) => removeWithUndo('bill', el.dataset.id, () => { if (!$('#sheet-root').hidden) billsSheet(); }),
  backup: () => {
    const blob = new Blob([JSON.stringify(s, null, 1)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `homzy-backup-${today()}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded. Keep it private: it has your household data.');
  },
  'restore-file': () => $('#restore').click(),
  reset: () => {
    openSheet(`<h2 class="sheet-title big">Delete this home?</h2>
      <p class="note">This removes all lists, plans, tasks and bills from this phone. Download a backup first if you might need them.</p>
      <div class="btn-row"><button class="btn ghost" data-action="close-sheet">Keep it</button><button class="btn danger-fill" data-action="reset-yes">Delete</button></div>`);
  },
  ...SYNC_ACTIONS,
  'reset-yes': () => { closeSheet(); s = M.fresh(); setupStep = 1; setupDraft = { home: 'Our home', name: '', people: 4, dinners: SETUP_DINNERS.slice(0, 3), others: [] }; persist(); },
};

// ---------- Swipe left to delete (touch only; the bin button does the same) ----------
let swipe = null;
let suppressClick = false;
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || viewOnly()) return;
  const row = e.target.closest('.row.swipe');
  if (!row || e.target.closest('input, select, textarea')) return;
  swipe = { row, x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId };
});
document.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // scrolling
    if (dx > -14 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    swipe.active = true;
    swipe.row.classList.add('swiping');
  }
  swipe.dx = Math.min(0, dx);
  swipe.row.style.transform = `translateX(${swipe.dx}px)`;
  swipe.row.classList.toggle('will-delete', swipe.dx < -swipe.row.offsetWidth * 0.35);
});
function endSwipe(e) {
  if (!swipe) return;
  const { row, dx, active } = swipe;
  swipe = null;
  if (!active) return;
  row.classList.remove('swiping');
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 350);
  if (e.type === 'pointerup' && dx < -row.offsetWidth * 0.35) {
    row.classList.add('swiped');
    setTimeout(() => ACTIONS[row.dataset.swipe]?.(row), 160);
  } else {
    row.style.transform = '';
    row.classList.remove('will-delete');
  }
}
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);
document.addEventListener('click', (e) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); } }, true);

document.addEventListener('click', (e) => {
  if (e.target.closest('#mic')) return viewOnly() ? viewOnlyToast() : startListening();
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn && viewOnly() && !VIEW_OK.has(el.dataset.action) && !el.dataset.action.startsWith('sync-')) { e.preventDefault(); return viewOnlyToast(); }
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('change', (e) => {
  const id = e.target.dataset?.review;
  if (id && review) { const r = review.find((x) => x.id === id); if (r) r.on = e.target.checked; }
});

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : null; };

const FORMS = {
  setup1: (f, d) => {
    setupDraft = { ...setupDraft, home: d.home, name: d.name.trim(), people: +d.people || 4, dinners: new FormData(f).getAll('dinner') };
    if (!setupDraft.name) return;
    setupStep = 2; render();
    setTimeout(() => $('[data-form="setup-add"] input')?.focus(), 50);
  },
  'setup-add': (f, d) => {
    const n = d.name.trim();
    if (n && !setupDraft.others.includes(n)) setupDraft.others.push(n);
    render();
    setTimeout(() => $('[data-form="setup-add"] input')?.focus(), 30);
  },
  'member-add': (f, d) => {
    const n = d.name.trim();
    if (!n) return;
    commit(`Added ${n}`, () => M.addMember(s, n));
    if ($('.sheet')) switchSheet();
  },
  'list-add': (f, d) => {
    if (!d.text.trim()) return;
    const parsed = parseSpeech(d.text);
    // Several items in one go: check them first. One item: add it straight away.
    if (parsed.length > 1) { f.text.value = ''; showAddPreview(''); return reviewItems(d.text); }
    addParsed(parsed);
    setTimeout(() => $('[data-form="list-add"] input')?.focus(), 30);
  },
  'speak-type': (f, d) => { if (d.text.trim()) reviewItems(d.text); },
  buy: (f, d) => {
    const i = byId(s.items, f.dataset.id);
    if (!i) return;
    const qty = num(d.qty), price = num(d.price);
    closeSheet();
    commit((r) => r.partial ? `Recorded part. ${M.fmtQty(r.left, i.unit)} of ${i.name} is still on the list.` : `${i.name} marked bought`,
      () => M.buy(s, i.id, { qty: qty ?? undefined, price }));
  },
  'item-edit': (f, d) => {
    const i = byId(s.items, f.dataset.id);
    const q = num(d.qty);
    closeSheet();
    commit('Item updated', () => M.updateItem(s, i.id, { name: d.name.trim() || i.name, qty: q > 0 ? q : null, unit: d.unit || null, note: d.note.trim() }));
  },
  task: (f, d) => {
    const data = { title: d.title.trim(), due: d.due || today(), time: d.time || '', assignee: d.assignee || null, repeat: d.repeat || 'none' };
    if (!data.title) return;
    closeSheet();
    if (f.dataset.id) commit('Task updated', () => M.updateTask(s, f.dataset.id, data));
    else commit(!data.assignee ? 'Shared with everyone' : data.assignee === s.me ? 'Added to your day' : `Request sent to ${M.firstName(s, data.assignee)}`, () => M.addTask(s, data));
  },
  recipe: (f, d) => {
    const ing = String(d.ing || '').split('\n').map((l) => l.trim()).filter(Boolean).map(M.parseIng);
    const slots = new FormData(f).getAll('slots').join('') || 'd';
    const data = { name: d.name.trim(), mins: num(d.mins), veg: d.veg !== '0', slots, ing };
    if (!data.name) return;
    const { date, slot } = f.dataset;
    let r;
    commit(f.dataset.id ? 'Recipe saved' : 'Your family recipe is saved', () => {
      r = M.saveRecipe(s, data, f.dataset.id);
      if (date) M.setMeal(s, date, slot, r.id);
    });
    if (date) mealSheet(date, slot); else closeSheet();
  },
  outside: (f, d) => {
    const amount = num(d.amount);
    if (!(amount > 0)) { f.amount.focus(); return; }
    closeSheet();
    commit(`Saved ${rupees(amount)} on food outside`, () => M.addOutside(s, { ...d, amount, people: +d.people }));
  },
  feedback: async (f, d) => {
    if (!d.message.trim()) return;
    const btn = $('#fb-send');
    btn.disabled = true; btn.textContent = 'Sending…';
    const result = await sendFeedback({
      rating: +d.rating || null, kind: d.kind || 'other', message: d.message.trim(), contact: d.contact.trim() || null,
      website: d.website, screen: tab, household_size: s.home.people, members: s.members.length,
    });
    closeSheet();
    if (result === 'rejected') return toast('Couldn’t send that. Please shorten it and try again.');
    setPref('fb-done', '1');
    render();
    toast(result === 'sent' ? 'Thank you! Your feedback reached us.' : 'Saved. It will send when you’re online.');
  },
  review: (f, d) => {
    const lines = (review || []).filter((x) => x.on).map(({ name, cat, price }) => ({ name, cat, price }));
    const total = num(d.total);
    if (d.type === 'outside') {
      if (!(total > 0)) { f.total.focus(); return; }
      review = null; // openSheet replaces this sheet in place
      return outsideSheet({ amount: total, place: d.shop.trim() });
    }
    closeSheet();
    commit((n) => `${n ? `${plural(n, 'item')} marked bought · ` : ''}${total ? rupees(total) + ' bill saved' : 'Saved'}`,
      () => M.saveBill(s, { shop: d.shop.trim(), total, lines }));
    review = null;
  },
  bill: (f, d) => {
    const total = num(d.total);
    if (!(total > 0)) return;
    closeSheet();
    commit(`Saved ${rupees(total)} bill`, () => M.saveBill(s, { shop: d.shop.trim(), total, lines: [] }));
  },
  ...SYNC_FORMS,
  settings: (f, d) => {
    closeSheet();
    setPref('theme', d.theme || 'system');
    applyTheme();
    if (viewOnly()) { s.lang = d.lang || s.lang; M.save(s, { quiet: true }); return toast('Voice language saved'); }
    commit('Settings saved', () => {
      s.home.name = d.home.trim() || 'Our home';
      s.home.people = +d.people || s.home.people;
      s.lang = d.lang || s.lang;
    });
  },
};

document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  if (viewOnly() && !VIEW_FORMS.has(f.dataset.form) && !f.dataset.form.startsWith('sync-')) return viewOnlyToast();
  FORMS[f.dataset.form]?.(f, Object.fromEntries(new FormData(f)));
});

$('#restore').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('too big');
    const next = M.fromBackup(await file.text());
    commit('Backup restored', () => { s = next; });
  } catch {
    toast('That file isn’t a Homzy backup.');
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// Week chart: hovering, tapping or focusing a day shows its numbers.
const readDay = (e) => {
  const bar = e.target.closest?.('.day-bar');
  const out = $('#chart-read');
  if (bar && out) out.textContent = bar.dataset.tip;
};
document.addEventListener('pointerover', readDay);
document.addEventListener('focusin', readDay);

// ---------- Install & offline ----------
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; document.body.classList.add('can-install'); });
ACTIONS.install = async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null;
  document.body.classList.remove('can-install');
};
window.addEventListener('appinstalled', () => { document.body.classList.remove('can-install'); toast('Homzy is on your home screen'); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); flushOutbox(); } });

applyTheme();
if (!pref('first-seen', '')) setPref('first-seen', String(Date.now()));
render();
flushOutbox();
startSync();

// Home-screen shortcuts: ?do=speak / ?do=scan
const shortcut = new URLSearchParams(location.search).get('do');
if (shortcut && s.setup) {
  history.replaceState(null, '', location.pathname);
  if (shortcut === 'speak') speakSheet();
  if (shortcut === 'scan') openSheet(`<h2 class="sheet-title big">Scan a bill</h2><button class="btn coral wide" data-action="scan">${I.camera} Take or choose a photo</button>`);
}
