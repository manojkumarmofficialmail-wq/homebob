import * as M from './model.js';
import { SETUP_DINNERS, QUICK_ADD } from './data.js';
import { parseSpeech, understandLocal } from './parse.js';
import { understand, fillNutrition } from './understand.js';
import { canListen, listen, speechError } from './speech.js';
import * as N from './nutrition.js';
import { sendFeedback, flushOutbox } from './feedback.js';
import * as C from './cloud.js';
import * as S from './sync.js';
import * as fx from './fx.js';
import { itemLook, dishEmoji, dishHue } from './emoji.js';
import { wheelSvg, spinTo } from './wheel.js';
import { dishPhoto, ownPhoto, hasOwnPhoto, preparePhoto, keepPhoto, removeOwnPhoto, dataToBlob, syncPhotos } from './photos.js';
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
let setupStep = 0; // 0 = the welcome screen, then two setup steps
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
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0d0d0d' : '#efefed'));
}

function persist() {
  if (!M.save(s)) toast('Couldn’t save. Phone storage may be full.');
  render();
}

/** Make a change, save, and offer Undo. */
function commit(message, change, extra) {
  const before = JSON.stringify(s);
  const was = progress();
  const result = change();
  persist();
  if (message) toast(typeof message === 'function' ? message(result) : message, { label: 'Undo', run: () => { s = JSON.parse(before); persist(); } });
  celebrate(was, progress());
  extra?.(result);
  return result;
}

// ---------- Celebrations ----------
// Only for changes made on this phone (sync and Undo don't go through commit).
function progress() {
  const t = today();
  return {
    items: s.items.length,
    bought: s.bought.length,
    due: s.tasks.filter((x) => x.status !== 'done' && x.due <= t).length,
    finishedAt: s.log.find((l) => l.text.startsWith('finished '))?.at || 0,
    week: Array.from({ length: 7 }, (_, i) => addDays(t, i)).every((d) => M.mealAt(s, d, 'd')),
  };
}
function celebrate(a, b) {
  if (a.items > 0 && b.items === 0 && b.bought > a.bought) fx.cheer('🛒', 'Shopping done!', 'Everything on the list is bought');
  else if (a.due > 0 && b.due === 0 && b.finishedAt > a.finishedAt) fx.cheer('✨', 'All done for today!', 'Every chore is finished. Great teamwork');
  else if (!a.week && b.week) fx.cheer('🗓️', 'Whole week planned!', 'Seven dinners ready to go');
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
let shown = null;        // the screen on view now, to know when it changes
let enterNext = false;   // play the entrance on the next redraw (Active / Bought, another week…)

function render() {
  N.useFoods(s.foods);
  const ready = s.setup && s.members.length;
  document.body.classList.toggle('setup-mode', !ready);
  document.body.classList.toggle('splash', !ready && setupStep === 0);
  if (!ready) {
    const step = 'setup' + setupStep;
    view.innerHTML = setupView();
    if (shown !== step) fx.enter(view);
    shown = step;
    return;
  }
  if (!me()) s.me = s.members[0].id;
  document.body.classList.toggle('readonly', viewOnly());
  if (!VIEWS[tab]) tab = 'home';
  // Animate only what changed: a new screen rises in, new rows slide in.
  // Plain redraws (a tap, a family sync) don't replay anything.
  const before = fx.rowIds(view);
  view.innerHTML = VIEWS[tab]();
  if (tab !== shown || enterNext) fx.enter(view);
  else { fx.stopEnter(view); fx.markNew(view, before); }
  shown = tab; enterNext = false;
  hideEdits(view);
  $$('.tabs [data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  document.body.dataset.tab = tab;
  const active = s.items.length;
  const badge = $('#list-badge');
  const was = badge.textContent;
  badge.textContent = active; badge.hidden = !active;
  if (was && active && String(active) !== was) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
  const mine = M.forMe(s);
  const n = mine.items.length + mine.tasks.length;
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch { /* unsupported */ }
}

const head = (title, sub, extra = '') => `
  <header class="page-head">
    <div class="ph-text"><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
    ${extra}
    <button class="me-btn ${tab === 'family' ? 'on' : ''}" data-action="tab" data-tab="family" aria-label="Family and settings (using Homzy as ${esc(me()?.name)})">${avatar(me())}</button>
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

// Food emoji in a soft coloured bubble, for items and dishes.
const food = (name, size = '') => { const l = itemLook(name); return `<span class="food ${size}" style="--h:${l.h}" aria-hidden="true">${l.e}</span>`; };
/** A dish in a small round frame: its plate photo, or its emoji on a plate. */
const dish = (r, size = '') => {
  const src = dishPhoto(r);
  return src ? `<span class="food photo ${size}" aria-hidden="true"><img src="${esc(src)}" alt="" loading="lazy" decoding="async"></span>`
    : `<span class="food ${size}" style="--h:${dishHue(r.name)}" aria-hidden="true">${dishEmoji(r.name)}</span>`;
};
/** A dish as a big plate: the photo, or its emoji on a cream plate. */
const plate = (r, cls = '') => {
  const src = dishPhoto(r);
  return src ? `<img class="plate-img ${cls}" src="${esc(src)}" alt="" decoding="async">`
    : `<span class="plate-img plate-emoji ${cls}" aria-hidden="true">${dishEmoji(r?.name)}</span>`;
};
/** Part of the day, for the greeting and the colours of the Tonight card. */
function dayPart() {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 16 ? 'afternoon' : h >= 16 && h < 20 ? 'evening' : 'night';
}
const HELLO = { morning: ['Good morning', '☀️'], afternoon: ['Good afternoon', '🌤️'], evening: ['Good evening', '🌇'], night: ['Good evening', '🌙'] };

// ----- Setup -----
function setupView() {
  const d = setupDraft;
  if (setupStep === 0) {
    return `
      <div class="welcome">
        <p class="brand-word">Homzy<span>.</span></p>
        <div class="welcome-plate" aria-hidden="true">
          <i class="steam"></i><i class="steam"></i><i class="steam"></i>
          <span class="bob"><img class="plate-img spin-in" src="img/dishes/chapati.webp" alt="" decoding="async"></span>
        </div>
        <h1 class="display rise" style="--d:.35s">Dinner, sorted<br>together.</h1>
        <p class="welcome-text rise" style="--d:.5s">Plan meals, share one shopping list and split the chores. English, Malayalam, Hindi and Tamil.</p>
        <button class="btn coral wide rise" style="--d:.65s" data-action="setup-start">Plan tonight ${I.arrow}</button>
      </div>`;
  }
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
      <p class="note">Everyone can tap their name on this phone to claim shopping and accept tasks.${C.configured() ? ' To put Homzy on everyone’s own phone, tap your picture at the top, then Connect next to their name.' : ''}</p>
      <button class="btn coral wide" data-action="setup-finish">Create our home</button>
    </div>`;
}

// ----- Home: the dinner wheel -----
// Dishes sit on plates round a black half-disc. The arrows or a tap on a plate turn it one
// dish at a time; Spin turns it a couple of times and lands on a random dish.
const WHEEL_MAX = 8;
const WHEEL_STEP_MS = 650;
const WHEEL_SPIN_MS = 2600;
let wheel = null; // { ids, rot, spun, spinning, timer }

/** Tonight's dish first, then favourites, then dinners that have a plate photo, then the rest. */
function wheelDishes() {
  const planned = M.mealAt(s, today(), 'd')?.rid;
  if (wheel && wheel.ids.every((id) => M.recipe(s, id)) && (!planned || wheel.ids.includes(planned))) {
    return wheel.ids.map((id) => M.recipe(s, id));
  }
  const fits = (r) => (r.slots || 'bld').includes('d');
  const all = M.allRecipes(s).filter(fits);
  const first = [planned && M.recipe(s, planned), ...s.favs.map((id) => M.recipe(s, id)).filter((r) => r && fits(r))].filter(Boolean);
  // The family's own plate photos first: their food looks best on the wheel.
  const own = all.filter(hasOwnPhoto);
  first.splice(planned ? 1 : 0, 0, ...own);
  // Then one dinner per photo we haven't shown yet, so neighbouring plates look different
  const seen = new Set(first.map(dishPhoto));
  const fresh = all.filter((r) => { const p = dishPhoto(r); if (!p || seen.has(p)) return false; seen.add(p); return true; });
  let dishes = [...new Map([...first, ...fresh].map((r) => [r.id, r])).values()];
  if (dishes.length < 6) dishes = [...new Map([...dishes, ...all].map((r) => [r.id, r])).values()];
  dishes = dishes.slice(0, WHEEL_MAX);
  wheel = { ids: dishes.map((r) => r.id), rot: 0, spun: false, spinning: false, timer: null };
  return dishes;
}

const wheelStep = () => 360 / wheel.ids.length;
const wheelSel = () => { const n = wheel.ids.length; return ((Math.round(-wheel.rot / wheelStep()) % n) + n) % n; };

/** The words beside the wheel, for the dish under the pointer. */
function wheelInfo() {
  if (wheel.spinning) return '<p class="dw-label dw-spinning">Spinning…</p>';
  const r = M.recipe(s, wheel.ids[wheelSel()]);
  const isPlanned = M.mealAt(s, today(), 'd')?.rid === r.id;
  return `
    <div class="dw-pick">
      <p class="dw-label">${isPlanned ? 'Tonight · planned' : wheel.spun ? 'The wheel says…' : 'Tonight’s pick'}</p>
      <h2 class="dw-name">${esc(r.name)}</h2>
      <p class="dw-meta">${[r.mins && `${r.mins} min`, r.veg === false ? 'Non-veg' : 'Veg', kcalPer(r)].filter(Boolean).join(' · ')}</p>
    </div>`;
}
function wheelButtons() {
  const r = M.recipe(s, wheel.ids[wheelSel()]);
  const isPlanned = M.mealAt(s, today(), 'd')?.rid === r.id;
  const busy = wheel.spinning ? 'disabled' : '';
  return `
    ${isPlanned ? `<button class="btn coral" data-action="meal" data-date="${today()}" data-slot="d" ${busy}>View plan</button>`
      : `<button class="btn coral" data-action="wheel-plan" data-rid="${r.id}" ${busy}>Plan it</button>`}
    <button class="btn outline" data-action="wheel-spin" ${busy}>${I.spin} Spin</button>`;
}

function wheelHtml() {
  const dishes = wheelDishes();
  if (dishes.length < 2) {
    return `<section class="card empty-card"><p class="empty-line">${I.plan}<span>Add a couple of family meals to fill the dinner wheel.</span></p>
      <button class="btn coral wide" data-action="pick" data-date="${today()}" data-slot="d">Choose dinner</button></section>`;
  }
  const step = wheelStep(), sel = wheelSel();
  return `
    <section class="dw" aria-label="Pick tonight’s dinner" style="--rot:${wheel.rot}deg;--dur:0ms">
      <div class="dw-disc">
        <div class="dw-hub">
          ${dishes.map((r, i) => `<div class="dw-arm" style="--a:${i * step}deg">
            <button class="dw-plate ${i === sel ? 'on' : ''}" data-action="wheel-to" data-i="${i}" tabindex="-1" aria-label="${esc(r.name)}">${plate(r)}</button>
          </div>`).join('')}
        </div>
      </div>
      <span class="dw-ring" aria-hidden="true"></span>
      <span class="dw-tag" aria-hidden="true">Pick dinner</span>
      <div class="dw-info" aria-live="polite">${wheelInfo()}</div>
      <div class="dw-arrows">
        <button data-action="wheel-step" data-d="-1" aria-label="Previous dish">${I.up}</button>
        <button data-action="wheel-step" data-d="1" aria-label="Next dish">${I.down}</button>
      </div>
      <div class="dw-btns">${wheelButtons()}</div>
    </section>`;
}

/** Turn the wheel on screen (no redraw, so it animates) and refresh the words beside it. */
function wheelTurn(rot, ms) {
  const box = $('.dw');
  wheel.rot = rot;
  if (!box) return;
  box.style.setProperty('--dur', `${fx.reduced() ? 0 : ms}ms`);
  box.style.setProperty('--rot', `${rot}deg`);
  const sel = wheelSel();
  $$('.dw-plate', box).forEach((p, i) => p.classList.toggle('on', i === sel));
  $('.dw-info', box).innerHTML = wheelInfo();
  $('.dw-btns', box).innerHTML = wheelButtons();
}

function wheelSpin() {
  if (!wheel || wheel.spinning || wheel.ids.length < 2) return;
  const n = wheel.ids.length;
  const k = 1 + Math.floor(Math.random() * (n - 1)); // always lands on a different dish
  wheel.spinning = true;
  wheel.spun = true;
  wheelTurn(wheel.rot - 720 - k * wheelStep(), WHEEL_SPIN_MS);
  fx.haptic('tap');
  clearTimeout(wheel.timer);
  wheel.timer = setTimeout(() => {
    wheel.spinning = false;
    wheelTurn(wheel.rot, WHEEL_STEP_MS);
    fx.haptic('success');
  }, fx.reduced() ? 0 : WHEEL_SPIN_MS);
}

function homeView() {
  const t = today();
  const mine = M.forMe(s);
  const tasks = s.tasks.filter((x) => x.status !== 'done' && x.due <= t).sort(byTaskOrder);
  const ym = t.slice(0, 7);
  const spend = M.monthSpend(s, ym);
  const [hello] = HELLO[dayPart()];
  const toBuy = s.items.length;

  return `
    ${head(`<span class="brand-title">Homzy</span>`, `${esc(s.home.name)} · ${S.linked() ? (viewOnly() ? 'View only' : 'Shared with family') : 'Private'}`, '<button class="install-btn" data-action="install">Install</button>')}
    <div class="greet-block">
      <p class="greet">${hello}, ${esc(me().name)}</p>
      <p class="eyebrow">Tonight · ${longDate(t)}</p>
    </div>

    ${wheelHtml()}

    <button class="shop-card" data-action="tab" data-tab="list">
      <span class="shop-ico">${I.cart}</span>
      <span class="shop-text"><b>Shopping · ${toBuy ? `${toBuy} to buy` : 'nothing to buy'}</b><span>${toBuy ? 'Everyone sees the same list' : 'Tap to add a few items'}</span></span>
      ${I.chev}
    </button>

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

    ${section('Today’s responsibilities', `<button class="link" data-action="task-new">${I.plus} Ask for a hand</button>`)}
    ${tasks.length ? `<ul class="card rows">${tasks.map(taskRow).join('')}</ul>`
      : `<div class="card empty-card"><p class="empty-line">${I.check}<span>Nothing due today.</span></p><div class="chips">${TASK_IDEAS.slice(0, 3).map((x) => `<button class="chip" data-action="task-new" data-title="${esc(x)}">${I.plus}${esc(x)}</button>`).join('')}</div></div>`}

    ${section('This week', `<button class="link" data-action="outside-new">${I.plus} Ate outside</button>`)}
    ${weekCard(spend, M.monthOutside(s, ym))}`;
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
  if (i.status === 'claimed') return i.by === s.me ? 'You are buying this' : `${Who(i.by)} is buying this`;
  if (i.status === 'awaiting') return i.by === s.me ? 'Asked you' : `Waiting for ${who(i.by)}`;
  const parts = [i.note];
  if (i.meal) parts.push(M.mealAt(s, today(), 'd') && M.recipe(s, M.mealAt(s, today(), 'd').rid)?.name === i.meal ? 'From tonight’s plan' : `For ${i.meal}`);
  else parts.push(i.addedBy === s.me ? 'Added by you' : `Added by ${who(i.addedBy)}`);
  return parts.filter(Boolean).join(' · ');
}
// Green when it's about you or tonight's plan
const itemMetaTone = (i) => ((i.status === 'claimed' && i.by === s.me) || (i.status === 'awaiting' && i.by === s.me) || (i.status === 'needed' && i.meal) ? 'good' : '');

function itemPill(i) {
  if (i.status === 'needed') return `<button class="pill coral" data-action="claim" data-id="${i.id}">I’ll buy</button>`;
  if (i.status === 'awaiting') return i.by === s.me
    ? `<button class="pill coral" data-action="item-accept" data-id="${i.id}">Accept</button>`
    : `<span class="pill sand">Asked</span>`;
  return i.by === s.me
    ? `<button class="pill green" data-action="release" data-id="${i.id}" aria-label="${esc(i.name)}: you are buying it. Tap to let someone else.">Yours</button>`
    : `<span class="pill sage">${esc(M.firstName(s, i.by))}’s</span>`;
}

const qtyBadge = (qty, unit) => { const q = M.fmtQty(qty, unit); return q ? `<span class="qty">${esc(unit === 'pcs' ? `${q} pcs` : q)}</span>` : ''; };

// A row you can delete: a visible trash button, and on phones a swipe to the left.
const delBtn = (action, id, name) => `<button class="icon-btn del" data-action="${action}" data-id="${id}" aria-label="Delete ${esc(name)}" title="Delete">${I.trash}</button>`;

// On the list, each item is its own card: food, name, who's buying, and a round tick for "bought".
// Swipe left (or open the item) to delete.
const itemRow = (i) => `
  <li class="row swipe" data-swipe="item-del" data-id="${i.id}">
    ${food(i.name)}
    <button class="row-main" data-action="item" data-id="${i.id}">
      <span class="row-title"><b>${esc(i.name)}</b>${qtyBadge(i.qty, i.unit)}</span><span class="meta ${itemMetaTone(i)}">${esc(itemMeta(i))}</span>
    </button>
    ${itemPill(i)}
    <button class="tick" data-action="quick-buy" data-id="${i.id}" aria-label="Mark ${esc(i.name)} bought">${I.check}</button>
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
  return sug.length ? `<div class="chips">${sug.map((x, i) => `<button class="chip sage-chip" data-action="quick-add" data-name="${esc(x)}" style="--i:${i}">${esc(x)} ${I.plus}</button>`).join('')}</div>` : '';
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
            ${r ? dish(r) : out.length ? '<span class="food" style="--h:30" aria-hidden="true">🥡</span>' : '<span class="food blank" aria-hidden="true">+</span>'}
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
const boughtToday = () => s.bought.filter((b) => isoOf(new Date(b.at)) === today()).length;

function listView() {
  const needed = sortItems(s.items.filter((i) => i.status !== 'claimed'));
  const claimed = s.items.filter((i) => i.status === 'claimed');
  const bt = boughtToday();
  return `
    ${head('Shopping list', 'Everyone at home sees the same list')}
    <div class="seg-tabs two" role="tablist" data-on="${listMode}">
      <button class="${listMode === 'active' ? 'on' : ''}" data-action="list-mode" data-mode="active" role="tab" aria-selected="${listMode === 'active'}">To buy · ${s.items.length}</button>
      <button class="${listMode === 'bought' ? 'on' : ''}" data-action="list-mode" data-mode="bought" role="tab" aria-selected="${listMode === 'bought'}">Bought${bt ? ` · ${bt}` : ''}</button>
    </div>
    ${listMode === 'active' ? `
      <form class="inline-add big" data-form="list-add">
        <label class="sr-only" for="list-add-text">Add items</label>
        <input id="list-add-text" name="text" placeholder="Add items… e.g. 2 kg rice, milk, eggs" autocomplete="off" enterkeyhint="done">
        <button class="add-btn" aria-label="Add">${I.plus}</button>
      </form>
      <div class="add-preview" id="add-preview" hidden></div>
      ${quickChips(6)}
      ${needed.length ? `<ul class="rows cards" aria-label="To buy">${needed.map(itemRow).join('')}</ul>` : ''}
      ${claimed.length ? `${section('Someone’s buying', `<span class="count">${claimed.length}</span>`)}<ul class="rows cards" aria-label="Someone’s buying">${claimed.map(itemRow).join('')}</ul>` : ''}
      ${!s.items.length ? emptyState(I.cart, 'Nothing to buy', viewOnly() ? 'When your family adds items, they appear here.' : 'Tap a suggestion, type above, or press + and speak a few items at once.')
        : `${viewOnly() ? '' : '<p class="note plain small">Tap “I’ll buy” to take it on and the tick when it’s bought. Swipe left to delete.</p>'}
           <button class="btn ghost wide" data-action="share-list">${I.share} Share list on WhatsApp</button>`}
    ` : boughtView()}`;
}

function boughtView() {
  const ym = today().slice(0, 7);
  const groups = new Map();
  for (const b of s.bought.slice(0, 120)) {
    const k = isoOf(new Date(b.at));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  return `
    <button class="card spend-row dark" data-action="bills">
      <span><span class="eyebrow plain">This month’s bills</span><b class="big">${rupees(M.monthSpend(s, ym))}</b></span>
      <span class="small">Add or view ${I.chev}</span>
    </button>
    ${groups.size ? [...groups.entries()].map(([d, list]) => `
      ${section(dayName(d, 'long'))}
      <ul class="rows cards">${list.map((b) => `
        <li class="row">
          <span class="food done" aria-hidden="true">${I.check}</span>
          <span class="row-main static"><span class="row-title"><b>${esc(b.name)}</b>${qtyBadge(b.qty, b.unit)}</span>
            <span class="meta">Bought by ${esc(who(b.by))} · ${new Date(b.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}${b.price ? ' · ' + rupees(b.price) : ''}</span></span>
          <button class="icon-btn soft" data-action="restore" data-id="${b.id}" aria-label="Put ${esc(b.name)} back on the list" title="Put back on list">${I.restore}</button>
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
        ${dish(r)}
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
    ${feedbackPrompt()}
    <div class="card stack-sm">
      <a class="menu-row" href="/survey">Take the 3-minute family survey ${I.chev}</a>
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

  const nutrientRows = N.NUTRIENTS.map((n, idx) => {
    const st = N.status(n.k, w.total[n.k], w.guide[n.k]);
    const width = Math.min(150, st.pct) / 1.5;
    return `<li class="nut-row">
      <span class="nut-name">${n.label}</span>
      <span class="nut-val">${num0(w.total[n.k])} ${n.unit}</span>
      <span class="meter" role="img" aria-label="${n.label}: ${st.pct}% of guide, ${st.label}"><i class="tone-${st.tone}" style="width:${width}%;--i:${idx}"></i><b class="guide-tick"></b></span>
      <span class="nut-st tone-${st.tone}">${TONE_ICON[st.tone]} ${st.label}<small> · ${st.pct}%</small></span>
    </li>`;
  }).join('');

  const bars = w.days.map((d, idx) => {
    const total = d.home + d.out;
    const h = (v) => (v / maxDay) * 100;
    const label = `${dayName(d.date)}: ${d.future ? 'not yet' : `${num0(total)} kcal (home ${num0(d.home)}, outside ${num0(d.out)})`}`;
    return `<button class="day-bar ${d.future ? 'future' : ''} ${d.date === today() ? 'is-today' : ''}" data-tip="${esc(label)}" aria-label="${esc(label)}">
      <span class="stack-col" style="--i:${idx}">${d.out ? `<i class="seg out" style="height:${h(d.out)}%"></i>` : ''}${d.home ? `<i class="seg home" style="height:${h(d.home)}%"></i>` : ''}</span>
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
        <p class="hint">The line marks 100% of what these meals should give an adult (ICMR-NIN guide).</p>`
      : `<p class="empty-title">Nothing recorded yet</p>
         <p class="meta">Plan meals in the Plan tab, or log food from outside. Homzy works out the nutrition from the ingredients.</p>
         <button class="btn sage wide" data-action="tab" data-tab="plan">Plan meals</button>`}
      ${w.unknownMeals ? `<p class="note">${plural(w.unknownMeals, 'meal has', 'meals have')} no ingredients yet, so ${w.unknownMeals === 1 ? 'it isn’t' : 'they aren’t'} counted. Add ingredients in Family → Our meals.</p>` : ''}
      ${w.missing.length ? `<p class="hint">No nutrition data for: ${esc(w.missing.slice(0, 5).join(', '))}${w.missing.length > 5 ? '…' : ''}</p>` : ''}
    </section>

    ${recorded ? `<section class="card chart dark" aria-label="Calories by day">
      <div class="chart-head"><p class="eyebrow">Calories by day</p>
        <div class="legend"><span><i class="sw home"></i>Home</span><span><i class="sw out"></i>Outside</span></div></div>
      <div class="day-bars">${bars}</div>
      <p class="chart-read" id="chart-read">Tap a day to see its calories.</p>
      <details class="table-view"><summary>Show as table</summary>
        <table><thead><tr><th>Day</th><th>Home</th><th>Outside</th></tr></thead><tbody>
        ${w.days.filter((d) => !d.future).map((d) => `<tr><td>${dayName(d.date)}</td><td>${num0(d.home)} kcal</td><td>${num0(d.out)} kcal</td></tr>`).join('')}
        </tbody></table>
      </details>
    </section>` : ''}

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

// ----- Kitchen: speak, add home dishes, keep stock -----
const KITCHEN_SAY = ['“2 kg rice and a litre of milk”', '“Made avial with 2 carrots, 1 coconut…”', '“Add 5 kg atta to stock”'];
function kitchenView() {
  const low = M.stockLow(s);
  const ym = today().slice(0, 7);
  const ours = M.allRecipes(s).filter((r) => !M.isBuiltIn(r.id) || s.favs.includes(r.id))
    .sort((a, b) => hasOwnPhoto(b) - hasOwnPhoto(a));
  return `
    ${head('Kitchen', 'Speak, add dishes, keep stock')}
    <button class="k-mic" data-action="speak-any">
      <span class="k-mic-btn" aria-hidden="true">${I.mic}</span>
      <span class="k-mic-text"><b>Tell Homzy</b><span>${KITCHEN_SAY.map(esc).join(' · ')}</span></span>
    </button>
    <div class="k-grid">
      <button class="k-tile" data-action="recipe-new"><span class="k-ico">${I.camera}</span><b>Add a home dish</b><span>Photo, ingredients and nutrition</span></button>
      <button class="k-tile" data-action="scan-stock"><span class="k-ico">${I.receipt}</span><b>Scan a bill</b><span>Fills stock and this month’s spend</span></button>
    </div>

    ${section('Stock', s.stock.length ? `<button class="link" data-action="stock">See all ${I.chev}</button>` : '')}
    ${s.stock.length ? `
      <button class="card stock-card" data-action="stock">
        <span class="sc-ico">${I.jar}</span>
        <span class="sc-text"><b>${plural(s.stock.length, 'item')} in the kitchen</b>
          <span class="meta">${low.length ? `${low.length} running low` : 'Nothing running low'} · groceries ${rupees(M.monthSpend(s, ym))} this month</span></span>
        ${I.chev}
      </button>
      ${low.length ? `<ul class="card rows low-rows">${low.slice(0, 5).map(lowRow).join('')}</ul>` : ''}`
    : `<div class="card empty-card">
        <p class="empty-line">${I.jar}<span>Scan this month’s grocery bill or say what you have. Homzy takes out what you cook and tells you what’s running low.</span></p>
        <div class="chips"><button class="chip" data-action="scan-stock">${I.receipt} Scan a bill</button><button class="chip" data-action="speak-stock">${I.mic} Say it</button><button class="chip" data-action="stock">${I.plus} Type it</button></div>
      </div>`}

    ${section('Our dishes', `<button class="link" data-action="recipe-new">${I.plus} Add</button>`)}
    ${ours.length ? `<div class="dish-strip">${ours.map((r) => `<button class="ds-dish" data-action="recipe" data-id="${r.id}">
        ${plate(r)}${hasOwnPhoto(r) ? '' : `<span class="ds-add">${I.camera}</span>`}<b>${esc(r.name)}</b></button>`).join('')}</div>
      <p class="note plain small">Tap a dish to add your own photo. Your photos show on the dinner wheel.</p>`
    : `<div class="card empty-card"><p class="empty-line">${I.camera}<span>Add the dishes your family cooks, with a photo. They join the dinner wheel.</span></p></div>`}

    ${section('More')}
    <div class="card stack-sm">
      <button class="menu-row" data-action="hub-type"><span class="mr-l">${I.keyboard}<span>Type shopping items</span></span>${I.chev}</button>
      <button class="menu-row" data-action="spin"><span class="mr-l">${I.spin}<span>Spin for dinner</span></span>${I.chev}</button>
      <button class="menu-row" data-action="task-new"><span class="mr-l">${I.hand}<span>Ask for a hand</span></span>${I.chev}</button>
      <button class="menu-row" data-action="outside-new"><span class="mr-l">${I.bowl}<span>Ate outside</span></span>${I.chev}</button>
      <button class="menu-row" data-action="bills"><span class="mr-l">${I.receipt}<span>Bills</span></span>${I.chev}</button>
    </div>`;
}

/** A stock row that is running low, with "Add to list". */
function lowRow(x) {
  const listed = !!M.activeItem(s, x.name);
  return `<li class="row">${food(x.name)}
    <span class="row-main static"><b>${esc(x.name)}</b><span class="meta ${x.qty ? '' : 'warn'}">${x.qty ? `${esc(M.fmtQty(x.qty, x.unit))} left` : 'Used up'}</span></span>
    ${listed ? '<span class="tag">On the list</span>' : `<button class="pill coral" data-action="stock-to-list" data-id="${x.id}">Add to list</button>`}
  </li>`;
}

const VIEWS = { home: homeView, plan: planView, kitchen: kitchenView, list: listView, week: weekView, family: familyView };
const TABS = Object.keys(VIEWS);

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
      <span class="pick-l">${dish(r)}<span class="pick-t"><b>${esc(r.name)}</b><span class="meta">${[r.mins && `${r.mins} min`, r.veg === false ? 'Non-veg' : 'Veg', kcalPer(r)].filter(Boolean).join(' · ')}</span></span></span>${r.id === current ? I.check : ''}</button></li>`;
    return `
      ${favs.length ? `<li class="pick-head">Favourites</li>${favs.map(btn).join('')}` : ''}
      ${rest.length ? `<li class="pick-head">${k ? 'Matches' : SLOTS[slot] + ' ideas'}</li>${rest.slice(0, 40).map(btn).join('')}` : ''}
      ${k && !all.some((r) => M.key(r.name) === k) ? `<li><button class="pick add" data-action="new-meal" data-name="${esc(q.trim())}">${I.plus} Add “${esc(q.trim())}” as a family meal</button></li>` : ''}`;
  };
  openSheet(`
    <h2 class="sheet-title">${SLOTS[slot]} · ${dayName(date, 'long')}</h2>
    <input class="search" id="pick-q" placeholder="Search appam, dal, fish…" autocomplete="off" aria-label="Search meals">
    ${viewOnly() ? '' : `<button class="spin-strip" data-action="spin" data-date="${date}" data-slot="${slot}"><span aria-hidden="true">🎡</span><span><b>Can’t decide?</b> Spin the wheel</span>${I.chev}</button>`}
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

let lastSwitch = null; // { name, st }: the Have / Need switch that just moved, to slide its thumb

/** Have / Need switch. "check" (not looked yet) shows neither side picked. */
function haveNeed(x, idx) {
  const moved = lastSwitch && lastSwitch.name === x.name ? `slid-${lastSwitch.st}` : '';
  return `<div class="hn ${moved}" data-state="${x.state}" role="radiogroup" aria-label="${esc(x.name)}">
    <span class="hn-thumb" aria-hidden="true"></span>
    ${['have', 'need'].map((st) => `<button data-action="hnc" data-i="${idx}" data-st="${st}" role="radio" aria-checked="${x.state === st}">${st === 'have' ? 'Have' : 'Need'}</button>`).join('')}
  </div>`;
}

function drawCheckSheet(keepOpen) {
  const ctx = checkCtx;
  const rows = M.ingredientRows(s, ctx.meals);
  const need = rows.filter((x) => x.state === 'need' && !x.onList);
  const unchecked = rows.filter((x) => x.state === 'check' && !x.onList);
  let top, cta;
  if (ctx.single) {
    const m = M.mealAt(s, ctx.date, ctx.slot);
    const r = M.recipe(s, m.rid);
    const when = ctx.date === today() ? (ctx.slot === 'd' ? 'tonight' : 'today') : dayName(ctx.date).toLowerCase();
    const mine = ownPhoto(r.id);
    top = `
      <header class="dish-hero">
        <button class="dh-back" data-action="close-sheet" aria-label="Close">${I.back}</button>
        <div class="dh-text">
          <p class="eyebrow">${SLOTS[ctx.slot]} · ${esc(dayName(ctx.date))}</p>
          <h2 class="sheet-title big">${esc(r.name)}</h2>
          <p class="dh-meta">${r.mins ? `${I.clock} ${r.mins} min · ` : ''}${r.veg === false ? 'Non-veg' : 'Veg'}</p>
        </div>
        <div class="stepper dark">
          <button data-action="meal-people" data-d="-1" aria-label="Fewer people">${I.minus}</button>
          <output>${plural(m.people, 'person', 'people')}</output>
          <button data-action="meal-people" data-d="1" aria-label="More people">${I.plus}</button>
        </div>
        <div class="dh-plate" aria-hidden="true"><i class="steam"></i><i class="steam"></i>${plate(r, 'slow-spin')}</div>
        <label class="dh-photo">${I.camera}<span>${mine ? 'Your photo' : 'Add your photo'}</span>
          <input type="file" accept="image/*" capture="environment" data-photo-for="${r.id}" class="sr-only">
        </label>
      </header>
      ${nutritionChips(r, m.people)}`;
    cta = rows.length || !r.ing.length
      ? `<button class="btn coral wide sticky-cta" data-action="plan-done">Plan for ${when}${need.length ? ` · add ${need.length} to list` : ''}</button>` : '';
  } else {
    top = `<header class="sheet-hero">
        <span class="plate" aria-hidden="true">🧺</span>
        <p class="eyebrow">This week</p>
        <h2 class="sheet-title big">Check ingredients</h2>
        <p class="sub">${ctx.meals.map((x) => esc(M.recipe(s, M.mealAt(s, x.date, x.slot).rid).name)).join(' · ')}</p>
      </header>`;
    cta = `<button class="btn coral wide sticky-cta" data-action="add-needs" ${need.length ? '' : 'disabled'}>
        ${need.length ? (need.length === 1 ? `Add ${esc(need[0].name.toLowerCase())} to list` : `Add ${need.length} items to list`) : 'Mark what you need'}</button>`;
  }
  const html = `
    ${top}
    ${rows.length ? `
      <div class="sec-head"><h3 class="sec">Kitchen check</h3>${rows.some((x) => !x.onList && x.state !== 'have') ? '<button class="link underline" data-action="all-have">Mark all have</button>' : ''}</div>
      <ul class="checks">
        ${rows.map((x, idx) => `<li class="check-item ${x.onList ? 'is-listed' : ''}" style="--i:${idx}">
          <div class="ci-name"><b>${esc(x.name)}</b>
            <span class="ci-sub">${[x.qty ? esc(M.fmtQty(x.qty, x.unit)) : '',
              x.onList ? '<span class="on-list">On the list</span>' : x.recent ? `Bought ${dayName(isoOf(new Date(x.recent.at))).toLowerCase()}` : '',
              !ctx.single && x.meals.length > 1 ? plural(x.meals.length, 'meal') : ''].filter(Boolean).join(' · ')}</span></div>
          ${x.onList ? `<span class="ci-done" aria-hidden="true">${I.check}</span>` : haveNeed(x, idx)}
        </li>`).join('')}
      </ul>
      ${unchecked.length ? `<p class="hint">Only items marked Need go on the list. ${unchecked.length === 1 ? '1 item isn’t' : `${unchecked.length} items aren’t`} checked yet.</p>` : ''}`
    : `<p class="note">This meal has no ingredients yet. Add them once and Homzy remembers.</p>`}
    ${ctx.single ? `<div class="btn-row">
      <button class="btn ghost" data-action="pick" data-date="${ctx.date}" data-slot="${ctx.slot}">Change meal</button>
      <button class="btn ghost" data-action="recipe" data-id="${M.mealAt(s, ctx.date, ctx.slot).rid}">Edit recipe</button>
    </div>
    ${s.stock.length && ctx.date <= today() ? (M.mealAt(s, ctx.date, ctx.slot).used
      ? `<p class="note plain center">${I.check} Cooked · taken out of stock</p>`
      : `<button class="btn outline wide" data-action="cooked">${I.jar} Cooked it · update stock</button>`) : ''}` : ''}
    ${cta}`;
  lastSwitch = null;
  if (keepOpen && $('.sheet')) {
    const sh = $('.sheet'); const y = sh.scrollTop;
    sh.innerHTML = `<div class="grip"></div>${html}`;
    sh.scrollTop = y;
    sh.classList.add('redraw'); // don't replay the entrance on every tap
  } else openSheet(html, { tall: true });
  $('.sheet')?.classList.toggle('dish-sheet', !!ctx.single);
  checkCtx.rows = rows;
}

// ----- "Dinner's planned": a moment to say it's done -----
const CONFETTI = ['#111111', '#f7f3e8', '#557330', '#f2c14e', '#e66a2c'];
function plannedScreen(r, { people, added, date, slot }) {
  closePlanned();
  const when = date === today() ? (slot === 'd' ? 'tonight' : 'today') : `on ${dayName(date, 'long')}`;
  const pieces = Array.from({ length: 18 }, (_, k) => {
    const round = k % 3 === 0;
    return `<i style="--a:${k * 20 + (k % 2) * 8}deg;--c:${CONFETTI[k % CONFETTI.length]};--w:${round ? 10 : 8}px;--h:${round ? 10 : 16}px;--r:${round ? '50%' : '3px'};--d:${200 + (k % 4) * 60}ms"></i>`;
  }).join('');
  const box = document.createElement('div');
  box.className = 'planned';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'planned-title');
  box.innerHTML = `
    <div class="planned-art" aria-hidden="true">
      <span class="planned-ring"></span>
      <span class="planned-burst">${pieces}</span>
      ${plate(r, 'spin-in')}
      <span class="planned-tick"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    </div>
    <h2 id="planned-title" class="rise" style="--d:.5s">${SLOTS[slot]}’s planned</h2>
    <p class="rise" style="--d:.65s">${esc(r.name)} for ${plural(people, 'person', 'people')} ${esc(when)}. ${added ? `${added === 1 ? '1 item' : `${added} items`} went onto the shopping list.` : 'Your kitchen has everything.'}</p>
    <div class="planned-btns">
      <button class="btn coral wide rise" style="--d:.8s" data-action="planned-list">See shopping list</button>
      <button class="btn outline wide rise" style="--d:.9s" data-action="planned-home">Back home</button>
    </div>`;
  document.body.appendChild(box);
  document.body.classList.add('locked');
  fx.haptic('success');
  setTimeout(() => $('[data-action="planned-list"]', box)?.focus({ preventScroll: true }), 80);
}
function closePlanned() {
  const box = $('.planned');
  if (!box) return false;
  box.remove();
  if ($('#sheet-root').hidden) document.body.classList.remove('locked');
  return true;
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
    <div class="chips">${s.members.filter((m) => m.id !== s.me).map((m) => `<button class="chip" data-action="assign" data-id="${id}" data-m="${m.id}">${avatar(m, 'sm')} ${esc(m.name)}</button>`).join('') || '<span class="muted small">Add family members under Family (your picture at the top).</span>'}</div>`;
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
let recipePhoto = null; // a photo picked in the recipe sheet, saved with the recipe
function recipeSheet(id, preset = {}) {
  const r = id ? M.recipe(s, id) : { name: preset.name || '', mins: '', slots: preset.slot || 'd', veg: true, ing: preset.ing || [] };
  if (!r) return;
  recipePhoto = null;
  const src = id ? ownPhoto(id) || dishPhoto(r) : '';
  const pick = preset.date ? `data-date="${preset.date}" data-slot="${preset.slot}"` : '';
  openSheet(`
    <h2 class="sheet-title big">${id ? 'Edit recipe' : 'Add a home dish'}</h2>
    <form data-form="recipe" ${id ? `data-id="${id}"` : ''} ${pick} class="stack">
      <label class="rp-photo ${src ? 'has' : ''}">
        <span class="rp-img" id="rp-img">${src ? `<img src="${esc(src)}" alt="">` : ''}</span>
        <span class="rp-cta">${I.camera}<b>${id && ownPhoto(id) ? 'Change photo' : 'Add a photo'}</b><span>Take one or pick from your gallery. It shows on the dinner wheel.</span></span>
        <input type="file" accept="image/*" class="sr-only" data-recipe-photo>
      </label>
      <label class="field">Dish name<input name="name" value="${esc(r.name)}" placeholder="Amma’s avial + rice" maxlength="60" required ${id || r.name ? '' : 'autofocus'}></label>
      <div class="two">
        <label class="field">Cooking time<input name="mins" inputmode="numeric" value="${r.mins || ''}" placeholder="min"></label>
        <div class="field">Type<div class="chips">
          <label class="chip toggle"><input type="radio" name="veg" value="1" ${r.veg !== false ? 'checked' : ''}>Veg</label>
          <label class="chip toggle"><input type="radio" name="veg" value="0" ${r.veg === false ? 'checked' : ''}>Non-veg</label>
        </div></div>
      </div>
      <div class="field">Good for<div class="chips">${Object.entries(SLOTS).map(([k, v]) => `<label class="chip toggle"><input type="checkbox" name="slots" value="${k}" ${r.slots.includes(k) ? 'checked' : ''}>${v}</label>`).join('')}</div></div>
      <div class="field">
        <div class="field-head"><label for="rp-ing">Ingredients for 4 people <span class="opt">one per line</span></label>
          ${canListen ? `<button type="button" class="pill ghost ing-mic" id="ing-mic" data-action="ing-mic" aria-pressed="false">${I.mic} Speak</button>` : ''}</div>
        <textarea name="ing" id="rp-ing" rows="6" placeholder="Rice 500 g&#10;Toor dal 200 g&#10;Tomato 2 pcs">${esc(ingText(r.ing))}</textarea>
        <p class="hint" id="ing-heard" hidden></p>
      </div>
      <div id="rp-nutri" aria-live="polite"></div>
      <button class="btn coral wide">${id ? 'Save recipe' : preset.date ? 'Save and plan it' : 'Save recipe'}</button>
    </form>
    ${id ? `<button class="btn ghost wide" data-action="fav" data-id="${id}" data-close="1">${s.favs.includes(id) ? 'Remove from favourites' : 'Add to favourites'}</button>` : ''}
    ${id && ownPhoto(id) ? `<button class="btn ghost wide" data-action="photo-del" data-id="${id}">Remove our photo</button>` : ''}
    ${id && !M.isBuiltIn(id) ? `<button class="btn ghost wide danger" data-action="recipe-del" data-id="${id}">${I.trash} Delete this recipe</button>` : ''}`, {
    tall: true,
    onMount: (sh) => {
      recipeNutri();
      sh.addEventListener('input', (e) => { if (e.target.id === 'rp-ing') { clearTimeout(nutriTimer); nutriTimer = setTimeout(recipeNutri, 350); } });
    },
    onClose: () => { stopIngMic(); },
  });
}

const ingText = (ing) => ing.map((x) => [x.name, x.qty, x.unit].filter((v) => v != null && v !== '').join(' ')).join('\n');
const ingLines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map(M.parseIng);

// Nutrition while typing a recipe: per person, with lookups for new ingredients.
let nutriTimer = null;
function recipeNutri() {
  const box = $('#rp-nutri'), ta = $('#rp-ing');
  if (!box || !ta) return;
  const ing = ingLines(ta.value);
  if (!ing.length) { box.innerHTML = ''; return; }
  const n = N.recipeNutrition({ ing }, 4);
  const est = ing.filter((x) => N.lookup(x.name)?.est).map((x) => x.name);
  const missing = N.unknown(n.missing);
  const p = n.perPerson;
  box.innerHTML = `${n.counted ? `<div class="nut-chips" aria-label="Nutrition per person">
      <span><b>${num0(p.kcal)}</b> kcal</span><span><b>${num0(p.protein)} g</b> protein</span>
      <span><b>${num0(p.carbs)} g</b> carbs</span><span><b>${num0(p.fat)} g</b> fat</span><span><b>${num0(p.fibre)} g</b> fibre</span>
    </div>` : ''}
    <p class="hint">${n.counted ? 'Per person, estimated' : 'Add amounts (like “Rice 500 g”) to see nutrition'}${est.length ? ` · ${esc(est.join(', '))} estimated by AI` : ''}${n.missing.length ? ` · not counted: ${esc(n.missing.join(', '))}` : ''}</p>`;
  if (missing.length && !viewOnly()) lookUpNutrition(missing).then((added) => { if (added) recipeNutri(); });
}

/** Ask the AI helper for nutrition of new ingredients and keep it for the whole home. */
async function lookUpNutrition(names) {
  const added = await fillNutrition(s.foods, names);
  if (added) { M.save(s); N.useFoods(s.foods); }
  return added;
}

// Speaking ingredients straight into the recipe sheet.
let ingStop = null;
function stopIngMic() { ingStop?.(); ingStop = null; }
function ingMic() {
  const btn = $('#ing-mic'), ta = $('#rp-ing'), heard = $('#ing-heard');
  if (!btn || !ta) return;
  if (ingStop) return stopIngMic();
  const before = ta.value.trim();
  btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); btn.innerHTML = `${I.stop} Stop`;
  heard.hidden = false; heard.textContent = 'Listening… say the ingredients, like “half kilo fish, 2 tomatoes, 1 coconut”';
  ingStop = listen(s.lang, {
    onText: (text) => { if ($('#ing-heard')) heard.textContent = text || '…'; },
    onEnd: (text, error) => {
      ingStop = null;
      if (!$('#ing-mic')) return;
      btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); btn.innerHTML = `${I.mic} Speak`;
      if (!text) { heard.textContent = speechError(error || 'no-speech'); return; }
      const said = understandLocal(text);
      const name = $('[data-form="recipe"] [name="name"]');
      if (said.kind === 'dish' && said.name && name && !name.value.trim()) name.value = said.name;
      if (!said.items.length) { heard.textContent = 'Couldn’t catch any ingredients. Try again?'; return; }
      ta.value = [before, ingText(said.items)].filter(Boolean).join('\n');
      heard.textContent = `Added ${plural(said.items.length, 'ingredient')}. Check the amounts.`;
      recipeNutri();
    },
  });
}

// ----- Bills -----
function billsSheet() {
  const bills = [...s.bills].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  openSheet(`
    <h2 class="sheet-title big">Bills</h2>
    ${bills.length ? `<ul class="card rows">${bills.map((b) => `<li class="row">
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
      ${'vibrate' in navigator ? `<div class="field">Vibrate on taps<div class="chips">${Object.entries({ on: 'On', off: 'Off' }).map(([k, v]) => `<label class="chip toggle"><input type="radio" name="haptics" value="${k}" ${pref('haptics', 'on') === k ? 'checked' : ''}>${v}</label>`).join('')}</div></div>` : ''}
      <button class="btn coral wide">Save</button>
    </form>`);
}

// ---------- Kitchen stock ----------
function stockHtml() {
  const lowIds = new Set(M.stockLow(s).map((x) => x.id));
  const groups = new Map();
  for (const x of [...s.stock].sort((a, b) => a.name.localeCompare(b.name))) {
    const g = groups.get(x.cat || 'Other') || [];
    g.push(x); groups.set(x.cat || 'Other', g);
  }
  const low = s.stock.filter((x) => lowIds.has(x.id));
  const toList = low.filter((x) => !M.activeItem(s, x.name));
  return `
    <h2 class="sheet-title big">Kitchen stock</h2>
    <p class="sub">${s.stock.length ? `${plural(s.stock.length, 'item')} · ${low.length ? `${low.length} running low` : 'nothing running low'} · groceries ${rupees(M.monthSpend(s, today().slice(0, 7)))} this month` : 'Nothing yet. Scan a bill, say it, or type below.'}</p>
    <div class="btn-row">
      <button class="btn coral" data-action="scan-stock">${I.receipt} Scan a bill</button>
      ${canListen ? `<button class="btn ghost" data-action="speak-stock">${I.mic} Say it</button>` : ''}
    </div>
    <form data-form="stock-add" class="inline-add">
      <label class="sr-only" for="stock-text">Add to stock</label>
      <input id="stock-text" name="text" placeholder="Add: 5 kg rice, 2 L oil, 12 eggs" autocomplete="off" enterkeyhint="done">
      <button class="add-btn" aria-label="Add to stock">${I.plus}</button>
    </form>
    ${low.length ? `<div class="sec-head"><h3 class="sec">Running low</h3>${toList.length > 1 ? `<button class="link underline" data-action="stock-low-all">Add all ${toList.length} to list</button>` : ''}</div>
      <ul class="card rows low-rows">${low.map(lowRow).join('')}</ul>` : ''}
    ${[...groups].map(([cat, list]) => `<h3 class="sec stock-cat">${esc(cat)}</h3>
      <ul class="card rows">${list.map((x) => `<li class="row stock-row">
        ${food(x.name)}
        <span class="row-main static"><b>${esc(x.name)}</b><span class="meta ${lowIds.has(x.id) ? 'warn' : ''}">${x.qty == null ? 'In stock' : x.qty ? esc(M.fmtQty(x.qty, x.unit)) + (x.unit === 'pcs' ? ' pcs' : '') : 'Used up'}</span></span>
        <div class="stepper sm">
          <button type="button" data-action="stock-step" data-id="${x.id}" data-d="-1" aria-label="Less ${esc(x.name)}">${I.minus}</button>
          <button type="button" data-action="stock-step" data-id="${x.id}" data-d="1" aria-label="More ${esc(x.name)}">${I.plus}</button>
        </div>
        ${delBtn('stock-remove', x.id, x.name)}
      </li>`).join('')}</ul>`).join('')}
    <p class="note plain small">Cooked meals from the plan come out of stock on their own. You can also tap “Cooked” on a dish.</p>`;
}
function stockSheet(keepOpen) {
  const sh = $('.sheet.stock-sheet');
  if (keepOpen && sh) {
    const y = sh.scrollTop;
    sh.innerHTML = `<div class="grip"></div>${stockHtml()}`;
    sh.scrollTop = y;
    sh.classList.add('redraw');
    return;
  }
  openSheet(stockHtml(), { tall: true });
  $('.sheet')?.classList.add('stock-sheet');
}
const stockOpen = () => !!$('.sheet.stock-sheet');

/** Put stock items on the shopping list. */
function stockToList(list) {
  const items = list.filter((x) => !M.activeItem(s, x.name)).map((x) => ({ name: x.name }));
  if (!items.length) return;
  commit(`Added ${items.map((i) => i.name).join(', ')} to the list`, () => M.addItems(s, items));
  if (stockOpen()) stockSheet(true);
}

/** Add to stock, look up nutrition for new things, and show the stock. */
function addToStock(lines, { open = true } = {}) {
  if (!lines.length) return;
  commit((n) => `Added ${plural(n, 'item')} to stock`, () => M.stockAdd(s, lines));
  lookUpNutrition(lines.map((l) => l.name));
  if (open) stockSheet(stockOpen());
}


// ---------- Dinner spinner ----------
let spin = null; // { dishes, rot, busy, pick, date, slot }

/** Up to 8 dishes for the wheel: favourites first, then family dishes for that meal, mixed up. */
function spinDishes(slot) {
  const fits = (r) => (r.slots || 'bld').includes(slot);
  const own = M.allRecipes(s).filter((r) => fits(r) && hasOwnPhoto(r));
  const favs = [...own, ...s.favs.map((id) => M.recipe(s, id)).filter((r) => r && fits(r))];
  const rest = M.allRecipes(s).filter(fits).sort(() => Math.random() - 0.5);
  return [...new Map([...favs, ...rest].map((r) => [r.id, r])).values()].slice(0, 8);
}

function spinSheet(date = today(), slot = 'd') {
  const dishes = spinDishes(slot);
  if (dishes.length < 2) return pickSheet(date, slot);
  spin = { dishes, rot: 0, busy: false, pick: null, date, slot };
  openSheet(`
    <h2 class="sheet-title big">Can’t decide? Spin it!</h2>
    <p class="sub">${SLOTS[slot]} for ${dayName(date).toLowerCase()} · ${s.favs.length ? 'your favourites and family dishes' : 'popular family dishes'}</p>
    <div class="wheel-wrap">
      <span class="wheel-pointer" aria-hidden="true"></span>
      <div class="wheel" id="wheel">${wheelSvg(dishes.map((r) => ({ name: r.name, emoji: dishEmoji(r.name), photo: dishPhoto(r) })))}</div>
      <button class="wheel-hub" data-action="spin-go" aria-label="Spin the wheel">Spin</button>
    </div>
    <div id="spin-result" class="spin-result" aria-live="polite"></div>
    <button class="btn coral wide" data-action="spin-go" id="spin-btn">🎡 Spin the wheel</button>`, { onClose: () => { spin = null; } });
}

function spinGo() {
  if (!spin || spin.busy) return;
  const n = spin.dishes.length;
  const i = Math.floor(Math.random() * n);
  spin.rot = spinTo(spin.rot, i, n, { jitter: Math.random() - 0.5, turns: 5 + Math.floor(Math.random() * 2) });
  spin.busy = true;
  const pick = spin.pick = spin.dishes[i];
  $('#spin-result').innerHTML = '';
  $('#spin-btn').disabled = true;
  const wheel = $('#wheel');
  wheel.classList.add('spinning');
  wheel.style.transform = `rotate(${spin.rot}deg)`;
  let done = false;
  const land = () => {
    if (done || !spin || spin.pick !== pick) return;
    done = true;
    spin.busy = false;
    wheel.classList.remove('spinning');
    spinResult();
  };
  if (fx.reduced()) return land();
  wheel.addEventListener('transitionend', land, { once: true });
  setTimeout(land, 4300); // in case the animation is paused (phone locked, tab hidden)
}

function spinResult() {
  const r = spin.pick;
  const has = M.mealAt(s, spin.date, spin.slot);
  const when = `${dayName(spin.date).toLowerCase()}’s ${SLOTS[spin.slot].toLowerCase()}`;
  $('#spin-result').innerHTML = `
    <div class="spin-card">
      ${dish(r, 'lg')}
      <span><small>The wheel says…</small><b>${esc(r.name)}</b>
        <span class="meta">${[r.mins && `${r.mins} min`, r.veg === false ? 'Non-veg' : 'Veg', kcalPer(r)].filter(Boolean).join(' · ')}</span></span>
    </div>
    <button class="btn coral wide" data-action="spin-plan" data-rid="${r.id}">${has ? 'Make it' : 'Plan it for'} ${when}</button>`;
  const again = $('#spin-btn');
  again.disabled = false;
  again.textContent = 'Spin again';
  again.className = 'btn ghost wide';
  fx.haptic('success');
}

// ---------- Speak, then check before adding ----------
let stopListening = null;
let ignoreEnd = false;   // stopped to change language: don't open the review
let draft = [];          // items waiting in the review sheet: { k, name, qty, unit }
let draftCarry = false;  // "Say more" from the review sheet adds to the same draft
let draftMode = 'list';  // where the checked items go: 'list' or 'stock'
let speakMode = 'list';  // what the speak sheet listens for: 'list', 'any' (Kitchen) or 'stock'
const SPEAK_TITLE = { list: 'What do we need?', any: 'Tell Homzy', stock: 'What’s in the kitchen?' };
const SPEAK_EXAMPLES = {
  list: null,
  any: ['“2 kg rice, 1 litre milk and 6 eggs”', '“Made fish curry with half kilo fish, 2 tomatoes”', '“Add 5 kg atta and 2 litre oil to stock”'],
  stock: ['“5 kg rice, 2 litre coconut oil, 12 eggs”', '“anchu kilo ari, randu litre enna”', '“paanch kilo aata, do litre tel”'],
};
const UNITS = ['', 'kg', 'g', 'L', 'ml', 'pcs', 'pkt', 'dozen', 'bottle'];
const EXAMPLES = ['“2 kg rice, 1 litre milk and 6 eggs”', '“do kilo chawal aur ek litre doodh”', '“randu kilo ari, oru litre paal”'];

function speakSheet(more = false, mode = 'list') {
  draftCarry = more;
  speakMode = mode;
  openSheet(`
    <h2 class="sheet-title big center">${more ? 'Say more items' : SPEAK_TITLE[mode]}</h2>
    ${canListen ? `
      <div class="mic-wrap">
        <button class="mic" id="mic" aria-pressed="false" aria-label="Start listening">${I.mic}</button>
        <span class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
        <p class="mic-state" id="mic-state" aria-live="polite">Tap the mic and speak</p>
      </div>
      <p class="heard" id="heard">Say several things at once, the way you would at home.</p>
      <div class="chips center heard-items" id="heard-items" aria-label="Items heard so far"></div>
      <ul class="examples">${(SPEAK_EXAMPLES[mode] || EXAMPLES).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="chips center" role="group" aria-label="Voice language">${Object.entries(LANGS).map(([k, v]) => `<button class="chip ${s.lang === k ? 'on' : ''}" data-action="lang" data-lang="${k}" aria-pressed="${s.lang === k}">${v}</button>`).join('')}</div>`
    : `<p class="note">Voice isn’t available in this browser. Type below, or use your keyboard’s mic. You can type several items at once.</p>`}
    <form class="inline-add" data-form="speak-type">
      <label class="sr-only" for="speak-text">Type items</label>
      <input id="speak-text" name="text" placeholder="${mode === 'any' ? 'Or type it here' : 'Or type: milk, 2 kg rice, eggs'}" autocomplete="off" enterkeyhint="go" ${canListen ? '' : 'autofocus'}>
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
      if (text) return handleSaid(text);
      heard.textContent = speechError(error || 'no-speech');
    },
  });
}

/** What was said in the speak sheet: shopping items, a new dish, or stock. */
async function handleSaid(text) {
  const mode = speakMode;
  if (mode === 'list') return reviewItems(text);
  const h = $('#heard');
  if (h) h.textContent = 'Understanding…';
  const said = await understand(text, s.lang, mode === 'stock' ? 'stock' : null);
  if (said.kind === 'dish') return recipeSheet(null, { name: said.name, ing: said.items });
  if (!said.items.length) {
    if ($('#heard')) $('#heard').textContent = 'Couldn’t catch that. Try again?'; else toast('Couldn’t understand that. Try again?');
    return;
  }
  reviewItems(null, said.items, said.kind === 'stock' ? 'stock' : 'list');
}

/** Turn spoken or typed text (or already-understood items) into a list to check before adding. */
function reviewItems(text, parsedItems = null, mode = 'list') {
  if (!draftCarry) draftMode = mode;
  if (parsedItems) {
    const found = parsedItems.map((x) => ({ k: M.uid(), name: x.name, qty: x.qty ?? null, unit: x.unit ?? null }));
    draft = draftCarry ? [...draft, ...found] : found;
    draftCarry = false;
    return draftSheet();
  }
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
    <h2 class="sheet-title big">${draftMode === 'stock' ? 'Check before adding to stock' : 'Check before adding'}</h2>
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
    b.textContent = !ready.length ? 'Nothing to add' : ready.length === 1 ? `Add ${ready[0].name.trim()}${draftMode === 'stock' ? ' to stock' : ''}` : `Add all ${ready.length}${draftMode === 'stock' ? ' to stock' : ''}`;
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
  if (draftMode === 'stock') return addToStock(items);
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
      <label class="switch-row"><input type="checkbox" name="stock" value="1" checked><span><b>Add to kitchen stock</b><span class="meta">Ticked groceries go into stock${review.some((x) => x.qty) ? ', with pack sizes' : ''}</span></span></label>
      ${review.length ? `<ul class="rows bill-lines">${review.map((x) => `<li><label class="row check-row">
        <input type="checkbox" data-review="${x.id}" ${x.on ? 'checked' : ''}>
        <span class="row-main static"><b>${esc(x.name)}</b>${[x.qty ? `<span class="meta">${esc(M.fmtQty(x.qty, x.unit))}</span>` : '', x.listed ? '<span class="meta on-list">On your list</span>' : ''].join('')}</span>
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
  'check-week', 'recipe', 'bills', 'week-prev', 'week-next', 'feedback', 'fb-snooze', 'settings', 'backup', 'install',
  'wheel-step', 'wheel-to', 'wheel-spin', 'planned-list', 'planned-home', 'stock', 'hub']);
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
      syncDishPhotos();
    },
    onStatus: showSyncStatus,
    onRoleChange: (role) => {
      softRender();
      toast(role === 'viewer' ? 'You can now view this home, but not change it.' : 'You can now make changes to this home.');
    },
    onRemoved: () => {
      s = M.wipe(); setupStep = 0; render();
      openSheet(`<h2 class="sheet-title big">This phone was disconnected</h2>
        <p class="note">The owner disconnected this phone or stopped sharing the home, so it has been removed from this phone. Ask them for a new QR code to connect again.</p>
        <button class="btn coral wide" data-action="close-sheet">OK</button>`);
    },
  });
  C.config().then((cfg) => { if (cfg) { softRender(); syncDishPhotos(); } handleLinks(); });
  window.addEventListener('online', () => syncDishPhotos());
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
  if (S.linked()) return errorSheet('This phone is already connected to a home. Disconnect it under Family (your picture at the top) first.');
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
  syncDishPhotos();
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
  setupStep = 0; tab = 'home'; setPref('tab', tab);
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

/**
 * Let a row on the page play its exit (bought, done, deleted), then make the change.
 * Buttons inside a sheet change straight away. A second tap on a leaving row is ignored.
 */
const leaving = new WeakSet();
function leave(el, kind, change) {
  const row = el.classList.contains('row') ? el : el.closest('.row');
  if (!row || !view.contains(row)) return change();
  if (leaving.has(row)) return;
  leaving.add(row);
  fx.animateOut(row, kind).then(change);
}

// A short buzz for taps that change something.
const BUZZ = {
  'quick-add': 'tap', claim: 'tap', 'item-accept': 'tap', 'task-accept': 'tap', 'task-take': 'tap', 'quick-meal': 'tap',
  'quick-buy': 'success', 'task-done': 'success', 'spin-plan': 'success', hub: 'tap', 'wheel-step': 'tap', 'wheel-to': 'tap', 'wheel-plan': 'tap',
  'item-del': 'warn', 'task-del': 'warn', 'bought-del': 'warn', 'outside-remove': 'warn',
};
const after = (el, fn) => { if (el.dataset.keep) fn?.(); else if (el.dataset.close) closeSheet(); };

const ACTIONS = {
  tab: (el) => {
    const from = TABS.indexOf(tab), to = TABS.indexOf(el.dataset.tab);
    tab = el.dataset.tab; setPref('tab', tab); closeSheet();
    const go = () => { render(); scrollTo(0, 0); };
    // Slide the page towards the tab that was tapped (the tab bar stays still).
    if (from !== to && document.startViewTransition && !fx.reduced()) {
      document.documentElement.dataset.dir = to > from ? 'fwd' : 'back';
      document.startViewTransition(go);
    } else go();
    if (tab === 'family') refreshPhones(true);
  },
  'close-sheet': () => closeSheet(),
  'toast-action': () => runToastAction(),
  scan: () => { closeSheet(); photo.click(); },
  speak: () => speakSheet(),
  hub: () => ACTIONS.tab({ dataset: { tab: 'kitchen' } }),
  'speak-any': () => speakSheet(false, 'any'),
  'speak-stock': () => speakSheet(false, 'stock'),
  'scan-stock': () => { closeSheet(); photo.click(); },
  stock: () => stockSheet(),
  'stock-step': (el) => { M.stockStep(s, el.dataset.id, +el.dataset.d); persist(); stockSheet(true); },
  'stock-remove': (el) => removeWithUndo('stock', el.dataset.id, () => { if (stockOpen()) stockSheet(true); }),
  'stock-to-list': (el) => { const x = s.stock.find((y) => y.id === el.dataset.id); if (x) stockToList([x]); },
  'stock-low-all': () => stockToList(M.stockLow(s)),
  'ing-mic': () => ingMic(),
  'photo-del': (el) => { closeSheet(); clearDishPhoto(el.dataset.id); toast('Photo removed'); },
  cooked: () => {
    const { date, slot } = checkCtx;
    commit((used) => used?.length ? `Took ${used.join(', ')} out of stock` : 'Marked cooked', () => M.cookMeal(s, date, slot));
    drawCheckSheet(true);
  },
  'hub-type': () => {
    closeSheet();
    listMode = 'active';
    if (tab !== 'list') ACTIONS.tab({ dataset: { tab: 'list' } });
    setTimeout(() => $('#list-add-text')?.focus(), 350);
  },
  spin: (el) => {
    const date = el.dataset.date || today(), slot = el.dataset.slot || 'd';
    if (date !== today() || slot !== 'd') return spinSheet(date, slot);
    // Tonight's dinner: spin the wheel on Home
    closeSheet();
    if (tab !== 'home') ACTIONS.tab({ dataset: { tab: 'home' } });
    setTimeout(wheelSpin, 380);
  },
  'wheel-step': (el) => {
    if (!wheel || wheel.spinning) return;
    wheel.spun = false;
    wheelTurn(wheel.rot - +el.dataset.d * wheelStep(), WHEEL_STEP_MS);
  },
  'wheel-to': (el) => {
    if (!wheel || wheel.spinning) return;
    const n = wheel.ids.length;
    let diff = (((+el.dataset.i - wheelSel()) % n) + n) % n;
    if (diff > n / 2) diff -= n; // the short way round
    if (!diff) return;
    wheel.spun = false;
    wheelTurn(wheel.rot - diff * wheelStep(), WHEEL_STEP_MS);
  },
  'wheel-spin': () => wheelSpin(),
  'wheel-plan': (el) => {
    const r = M.recipe(s, el.dataset.rid);
    if (!r) return;
    const prev = M.mealAt(s, today(), 'd');
    commit(prev ? `Tonight’s dinner is now ${r.name}` : null, () => M.setMeal(s, today(), 'd', r.id));
    mealSheet(today(), 'd');
  },
  'spin-go': () => spinGo(),
  'spin-plan': (el) => {
    if (!spin) return;
    const { date, slot } = spin;
    const r = M.recipe(s, el.dataset.rid);
    commit(`${r.name} it is! 🎉`, () => M.setMeal(s, date, slot, r.id));
    mealSheet(date, slot);
  },
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
  'setup-start': () => { setupStep = 1; render(); scrollTo(0, 0); },
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
    fx.cheer('🏡', `Welcome home, ${self.name}!`, 'Your home is ready');
  },

  // meals
  slot: (el) => { planSlot = el.dataset.slot; setPref('slot', planSlot); enterNext = true; render(); },
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
    if (row.state === el.dataset.st) return;
    lastSwitch = row.state === 'check' ? null : { name: row.name, st: el.dataset.st };
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
  'plan-done': () => {
    const { date, slot } = checkCtx;
    const m = M.mealAt(s, date, slot);
    const r = m && M.recipe(s, m.rid);
    if (!r) return closeSheet();
    const need = checkCtx.rows.filter((x) => x.state === 'need' && !x.onList);
    let added = 0;
    if (need.length) {
      commit(null, () => { added = M.addItems(s, need.map((x) => ({ name: x.name, qty: x.qty, unit: x.unit })), { meal: r.name }).added.length; });
    }
    closeSheet();
    plannedScreen(r, { people: m.people, added, date, slot });
  },
  'planned-list': () => { closePlanned(); listMode = 'active'; ACTIONS.tab({ dataset: { tab: 'list' } }); },
  'planned-home': () => { closePlanned(); ACTIONS.tab({ dataset: { tab: 'home' } }); },

  // list
  'list-mode': (el) => {
    if (listMode === el.dataset.mode) return;
    listMode = el.dataset.mode;
    // Slide the black thumb across first, then show the other list
    const seg = el.closest('.seg-tabs');
    if (seg) seg.dataset.on = listMode;
    setTimeout(() => { enterNext = true; render(); }, fx.reduced() ? 0 : 220);
  },
  'quick-add': (el) => addTyped(el.dataset.name),
  item: (el) => itemSheet(el.dataset.id),
  claim: (el) => { const i = byId(s.items, el.dataset.id); commit(`You’re buying ${i.name}`, () => M.claim(s, i.id)); after(el, () => itemSheet(i.id)); },
  release: (el) => { const i = byId(s.items, el.dataset.id); commit(`${i.name} is open for anyone again`, () => M.release(s, i.id)); after(el, () => itemSheet(i.id)); },
  assign: (el) => { const i = byId(s.items, el.dataset.id); commit(`Asked ${M.firstName(s, el.dataset.m)} to buy ${i.name}`, () => M.assign(s, i.id, el.dataset.m)); itemSheet(i.id); },
  'item-accept': (el) => { const i = byId(s.items, el.dataset.id); commit(`You’re buying ${i.name}`, () => M.acceptItem(s, i.id)); after(el, () => itemSheet(i.id)); },
  'item-decline': (el) => { const i = byId(s.items, el.dataset.id); commit(`${i.name} is open for anyone`, () => M.declineItem(s, i.id)); after(el, () => itemSheet(i.id)); },
  'quick-buy': (el) => leave(el, 'done', () => { const i = byId(s.items, el.dataset.id); if (i) commit(`${i.name} marked bought`, () => M.buy(s, i.id)); }),
  'item-remove': (el) => { closeSheet(); removeWithUndo('item', el.dataset.id); },
  'item-del': (el) => leave(el, 'delete', () => removeWithUndo('item', el.dataset.id)),
  'bought-del': (el) => leave(el, 'delete', () => removeWithUndo('bought', el.dataset.id)),
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
  'task-done': (el) => leave(el, 'done', () => { const t = byId(s.tasks, el.dataset.id); if (t) commit(`Done: ${t.title}`, () => M.finishTask(s, t.id)); after(el); }),
  'task-remove': (el) => { closeSheet(); removeWithUndo('task', el.dataset.id); },
  'task-del': (el) => leave(el, 'delete', () => removeWithUndo('task', el.dataset.id)),

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
  'week-prev': () => { weekOffset--; enterNext = true; render(); },
  'week-next': () => { weekOffset = Math.min(0, weekOffset + 1); enterNext = true; render(); },
  'outside-new': () => outsideSheet(),
  'outside-remove': (el) => leave(el, 'delete', () => removeWithUndo('outside', el.dataset.id)),
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
  'reset-yes': () => { closeSheet(); s = M.fresh(); setupStep = 0; setupDraft = { home: 'Our home', name: '', people: 4, dinners: SETUP_DINNERS.slice(0, 3), others: [] }; persist(); },
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
  const will = swipe.dx < -swipe.row.offsetWidth * 0.35;
  if (will !== swipe.row.classList.contains('will-delete')) fx.haptic('tap');
  swipe.row.classList.toggle('will-delete', will);
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
  if (fn) {
    e.preventDefault();
    if (BUZZ[el.dataset.action]) fx.haptic(BUZZ[el.dataset.action]);
    fn(el);
  }
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
  'speak-type': (f, d) => { if (d.text.trim()) handleSaid(d.text); },
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
  'stock-add': (f, d) => {
    const items = parseSpeech(d.text || '');
    if (!items.length) return;
    f.text.value = '';
    addToStock(items.map(({ name, qty, unit, cat }) => ({ name, qty, unit, cat })));
    setTimeout(() => $('#stock-text')?.focus(), 60);
  },
  recipe: (f, d) => {
    stopIngMic();
    const ing = ingLines(d.ing);
    const slots = new FormData(f).getAll('slots').join('') || 'd';
    const data = { name: d.name.trim(), mins: num(d.mins), veg: d.veg !== '0', slots, ing };
    if (!data.name) return;
    const { date, slot } = f.dataset;
    let r;
    commit(f.dataset.id ? 'Recipe saved' : 'Your family recipe is saved', () => {
      r = M.saveRecipe(s, data, f.dataset.id);
      if (date) M.setMeal(s, date, slot, r.id);
    });
    const photoData = recipePhoto;
    recipePhoto = null;
    if (photoData && r) setDishPhoto(r.id, photoData);
    lookUpNutrition(ing.map((x) => x.name));
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
    const lines = (review || []).filter((x) => x.on).map(({ name, cat, price, qty, unit }) => ({ name, cat, price, qty, unit }));
    const toStock = d.stock === '1';
    const total = num(d.total);
    if (d.type === 'outside') {
      if (!(total > 0)) { f.total.focus(); return; }
      review = null; // openSheet replaces this sheet in place
      return outsideSheet({ amount: total, place: d.shop.trim() });
    }
    closeSheet();
    commit((n) => `${n ? `${plural(n, 'item')} marked bought · ` : ''}${total ? rupees(total) + ' bill saved' : 'Saved'}${toStock && lines.length ? ' · stock updated' : ''}`,
      () => M.saveBill(s, { shop: d.shop.trim(), total, lines, toStock }));
    review = null;
    if (toStock && lines.length) { lookUpNutrition(lines.map((l) => l.name)); stockSheet(); }
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
    if (d.haptics) setPref('haptics', d.haptics);
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

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !closePlanned()) closeSheet(); });

// ---------- Dish photos ----------
// A family's own plate replaces the stock photo. In a shared home it is uploaded so
// every phone shows it; otherwise it stays on this phone.
const PENDING = 'photo-pending'; // dishes whose photo still has to be uploaded
const pendingPhotos = () => pref(PENDING, '').split(',').filter(Boolean);
const setPending = (ids) => setPref(PENDING, [...new Set(ids)].join(','));

async function setDishPhoto(rid, data, { retry = false } = {}) {
  if (!retry) {
    keepPhoto(rid, data);
    wheel = null; // rebuild the dinner wheel so the new photo is on it
    render();
  }
  const L = S.linked();
  if (!L || viewOnly()) return;
  try {
    await C.uploadPhoto(L.hid, rid, dataToBlob(data));
    const v = Date.now();
    keepPhoto(rid, data, v);
    setPending(pendingPhotos().filter((x) => x !== rid));
    if (M.recipe(s, rid)) { M.saveRecipe(s, { photo: { v } }, rid); persist(); }
  } catch {
    setPending([...pendingPhotos(), rid]);
    if (!retry) toast('Photo saved on this phone. It will be shared with your family when you’re online.');
  }
}

function clearDishPhoto(rid) {
  removeOwnPhoto(rid);
  wheel = null;
  setPending(pendingPhotos().filter((x) => x !== rid));
  const r = M.recipe(s, rid);
  const L = S.linked();
  if (r?.photo && L && !viewOnly()) {
    M.saveRecipe(s, { photo: null }, rid);
    C.deletePhoto(L.hid, rid).catch(() => {});
  }
  persist();
  if (checkCtx?.single && $('.dish-sheet')) drawCheckSheet(true);
}

/** Upload photos that couldn't be shared earlier, and fetch the family's new ones. */
let photoSyncing = false;
async function syncDishPhotos() {
  const L = S.linked();
  if (!L || photoSyncing || !navigator.onLine) return;
  photoSyncing = true;
  try {
    if (!viewOnly()) for (const rid of pendingPhotos()) { const d = ownPhoto(rid); if (d) await setDishPhoto(rid, d, { retry: true }); else setPending(pendingPhotos().filter((x) => x !== rid)); }
    if (await syncPhotos(M.allRecipes(s), (rid) => C.downloadPhoto(L.hid, rid))) softRender();
  } finally {
    photoSyncing = false;
  }
}

document.addEventListener('change', async (e) => {
  const rid = e.target.dataset?.photoFor;
  const inRecipe = e.target.matches?.('[data-recipe-photo]');
  const file = e.target.files?.[0];
  if ((!rid && !inRecipe) || !file) return;
  e.target.value = '';
  let data;
  try {
    data = await preparePhoto(file);
  } catch {
    return toast('Couldn’t use that photo. Try another one.');
  }
  if (inRecipe) {
    // Shown now, saved with the recipe.
    recipePhoto = data;
    const box = $('#rp-img');
    if (box) { box.innerHTML = `<img src="${data}" alt="">`; const lab = box.closest('.rp-photo'); lab?.classList.add('has'); const b = lab?.querySelector('.rp-cta b'); if (b) b.textContent = 'Change photo'; }
    return;
  }
  await setDishPhoto(rid, data);
  toast('Photo saved for this dish', { label: 'Undo', run: () => clearDishPhoto(rid) });
  if (checkCtx?.single && $('.dish-sheet')) drawCheckSheet(true);
});

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
/** Planned meals that have happened come out of stock (on phones that can edit). */
function useCooked() {
  if (s.setup && !viewOnly() && M.useCookedMeals(s)) M.save(s);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { useCooked(); render(); flushOutbox(); syncDishPhotos(); } });

applyTheme();
if (!pref('first-seen', '')) setPref('first-seen', String(Date.now()));
useCooked();
render();
flushOutbox();
startSync();

// Home-screen shortcuts: ?do=speak / ?do=scan
const shortcut = new URLSearchParams(location.search).get('do');
if (shortcut && s.setup) {
  history.replaceState(null, '', location.pathname);
  tab = 'kitchen'; setPref('tab', tab); render();
  if (shortcut === 'speak') speakSheet(false, 'any');
  if (shortcut === 'scan') openSheet(`<h2 class="sheet-title big">Scan a bill</h2><button class="btn coral wide" data-action="scan-stock">${I.camera} Take or choose a photo</button>`);
}
