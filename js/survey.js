// The family survey page (/survey). No login. Answers go to /api/survey.
// A draft is kept on this phone, so closing the page doesn't lose answers.
import { FEATURES, EXTRAS, RATING, USED, SIZES, PLANNER, LANGS, TODAY, PRICE } from './survey-data.js';
import { APP_VERSION, installId } from './feedback.js';
import { esc, I } from './ui.js';

const DRAFT = 'homzy:survey-draft';
const DONE = 'homzy:survey-done';
const root = document.getElementById('survey');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* blocked */ } },
};

const radios = (name, options, extraClass = '') => `<div class="chips ${extraClass}">${Object.entries(options).map(([v, label]) =>
  `<label class="chip toggle"><input type="radio" name="${name}" value="${esc(v)}">${esc(label)}</label>`).join('')}</div>`;
const checks = (name, options) => `<div class="chips">${Object.entries(options).map(([v, label]) =>
  `<label class="chip toggle"><input type="checkbox" name="${name}" value="${esc(v)}">${esc(label)}</label>`).join('')}</div>`;
const asObj = (arr) => Object.fromEntries(arr.map((x) => [x, x]));
const q = (n, title, body, hint = '') => `
  <section class="card q" role="group" aria-labelledby="q${n}">
    <h2 class="q-title" id="q${n}"><span class="q-num">${n}</span><span>${title}</span></h2>
    ${hint ? `<p class="hint">${hint}</p>` : ''}
    ${body}
  </section>`;

function tour() {
  return `
    <section class="card tour">
      <h2 class="sec">What Homzy does</h2>
      <ul class="feature-list">${FEATURES.map((f) => `<li><b>${esc(f.name)}</b><span>${esc(f.what)}</span></li>`).join('')}</ul>
      <p class="hint">Also: ${EXTRAS.map(esc).join(' · ')}.</p>
    </section>`;
}

function form() {
  let n = 0;
  return `
    <form id="survey-form" class="stack" novalidate>
      ${q(++n, 'Have you used Homzy?', radios('used_app', USED))}
      ${q(++n, 'How many people usually eat at home?', radios('household_size', asObj(SIZES)))}
      ${q(++n, 'Who mostly plans meals and shopping?', radios('planner', PLANNER))}
      ${q(++n, 'Languages spoken at home', checks('languages', LANGS), 'Pick all that apply.')}
      ${q(++n, 'How useful is each feature for your family?', `
        <ul class="rate-list">${FEATURES.map((f) => `
          <li class="rate-row">
            <div><b>${esc(f.name)}</b><span class="hint">${esc(f.what)}</span></div>
            ${radios('r-' + f.id, RATING, 'rate')}
          </li>`).join('')}
        </ul>`, 'Even if you haven’t tried it, tell us if it sounds useful.')}
      ${q(++n, 'Which one would your family use most?', radios('favourite', Object.fromEntries(FEATURES.map((f) => [f.id, f.name]))))}
      ${q(++n, 'How do you manage groceries and meals today?', checks('today_methods', TODAY), 'Pick all that apply.')}
      ${q(++n, 'What’s missing, or what would make Homzy a must-have?', `<label class="field"><span class="sr">What’s missing</span><textarea name="missing" maxlength="1500" placeholder="e.g. Reminders when milk runs out, a festival menu, …"></textarea></label>`)}
      ${q(++n, 'Was anything confusing or hard to use?', `<label class="field"><span class="sr">What was confusing</span><textarea name="confusing" maxlength="1500" placeholder="Optional"></textarea></label>`)}
      ${q(++n, 'Would your family pay for Homzy?', radios('price', PRICE))}
      ${q(++n, 'How likely are you to recommend Homzy to another family?', `
        ${radios('recommend', Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i), String(i)])), 'scale')}
        <div class="scale-ends"><span>Not likely</span><span>Very likely</span></div>`)}
      ${q(++n, 'About you', `
        <label class="field">City or town <span class="opt">optional</span><input name="city" maxlength="60" autocomplete="address-level2" placeholder="e.g. Kochi"></label>
        <label class="field">Phone or email <span class="opt">optional, only if we may call you to learn more</span><input name="contact" maxlength="120" autocomplete="email"></label>`)}
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <p class="note error" id="survey-err" role="alert" hidden></p>
      <button class="btn coral wide" id="send">Send my answers</button>
      <p class="note plain center">Your answers go only to the Homzy team. We never share them.</p>
    </form>`;
}

function page() {
  const done = store.get(DONE);
  root.innerHTML = `
    <header class="survey-head">
      <p class="brand-mark">${I.home}<span>Homzy</span></p>
      <h1 class="display">Help us make Homzy right for your family</h1>
      <p class="sub">About 3 minutes · no login · every question is optional</p>
    </header>
    ${done ? `<div class="card info"><b>You already sent your answers. Thank you!</b><p>Answering for another family? Go ahead below.</p></div>` : ''}
    ${tour()}
    ${form()}`;
  restoreDraft();
}

// ----- Draft -----
function collect() {
  const f = document.getElementById('survey-form');
  const d = new FormData(f);
  const ratings = {};
  for (const ft of FEATURES) { const v = d.get('r-' + ft.id); if (v) ratings[ft.id] = v; }
  const one = (k) => d.get(k) || null;
  return {
    used_app: one('used_app'), household_size: one('household_size'), planner: one('planner'),
    languages: d.getAll('languages'), city: one('city'), ratings, favourite: one('favourite'),
    today_methods: d.getAll('today_methods'), missing: one('missing'), confusing: one('confusing'),
    price: one('price'), recommend: d.get('recommend') != null ? +d.get('recommend') : null,
    contact: one('contact'), website: one('website'),
  };
}

function restoreDraft() {
  let draft;
  try { draft = JSON.parse(store.get(DRAFT) || 'null'); } catch { draft = null; }
  if (!draft) return;
  const f = document.getElementById('survey-form');
  const tick = (name, value) => {
    const el = f.querySelector(`input[name="${name}"][value="${CSS.escape(String(value))}"]`);
    if (el) el.checked = true;
  };
  for (const k of ['used_app', 'household_size', 'planner', 'favourite', 'price']) if (draft[k]) tick(k, draft[k]);
  if (draft.recommend != null) tick('recommend', draft.recommend);
  for (const k of ['languages', 'today_methods']) (draft[k] || []).forEach((v) => tick(k, v));
  for (const [id, v] of Object.entries(draft.ratings || {})) tick('r-' + id, v);
  for (const k of ['missing', 'confusing', 'city', 'contact']) if (draft[k]) f.elements[k].value = draft[k];
}

let saveTimer;
root.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { const { website, ...draft } = collect(); store.set(DRAFT, JSON.stringify(draft)); }, 400);
});
root.addEventListener('change', () => root.dispatchEvent(new Event('input')));

// ----- Send -----
root.addEventListener('submit', async (e) => {
  e.preventDefault();
  const answers = collect();
  const err = document.getElementById('survey-err');
  const btn = document.getElementById('send');
  const answered = Object.keys(answers.ratings).length || answers.used_app || answers.favourite || answers.missing || answers.recommend != null;
  if (!answered) { err.textContent = 'Please answer at least one question first.'; err.hidden = false; return; }
  err.hidden = true;
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...answers, app_version: APP_VERSION, install_id: installId(), locale: navigator.language || null }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Server error');
    store.set(DRAFT, null);
    store.set(DONE, String(Date.now()));
    thanks();
  } catch (x) {
    err.textContent = navigator.onLine
      ? `Couldn’t send just now (${x.message}). Your answers are saved on this phone. Please try again in a minute.`
      : 'You’re offline. Your answers are saved on this phone. Send them when you’re back online.';
    err.hidden = false;
    btn.disabled = false; btn.textContent = 'Send my answers';
  }
});

function thanks() {
  root.innerHTML = `
    <div class="setup thanks">
      <p class="brand-mark">${I.home}<span>Homzy</span></p>
      <h1 class="display">Thank you!</h1>
      <p class="sub">Your answers help us decide what to build next for families like yours.</p>
      <button class="btn coral wide" id="share-survey">${I.share} Share with another family</button>
      <a class="btn ghost wide" href="/">Open Homzy</a>
    </div>`;
  document.getElementById('share-survey').addEventListener('click', () => {
    const text = `Could your family help shape Homzy, a home app for meals, groceries and chores? 3-minute survey: ${location.origin}/survey`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  });
  scrollTo(0, 0);
}

page();
