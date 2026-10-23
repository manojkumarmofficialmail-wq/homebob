// Homzy data and every change to it. No DOM code here, so a cloud sync layer
// can later replace load()/save() without touching the screens.
import { RECIPES, CATALOG } from './data.js';
import { matchCatalog } from './parse.js';

const KEY = 'homzy:v1';
const VERSION = 2;
const BASE_PEOPLE = 4; // recipe quantities are written for 4 people

export const uid = () => Math.random().toString(36).slice(2, 10);
export const iso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const today = () => iso();
export const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
export const key = (s) => String(s || '').trim().toLowerCase();
const slug = (s) => key(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const HUES = [14, 160, 210, 280, 35, 330, 100, 190];

export const fresh = () => ({
  v: VERSION,
  setup: false,
  home: { name: 'Our home', people: 4 },
  lang: 'en-IN',
  members: [],   // { id, name, hue }
  me: null,      // member using this phone
  favs: [],      // recipe ids
  recipes: [],   // custom or edited recipes: { id, name, mins, slots, veg, ing: [{name, qty, unit}] }
  plan: {},      // { date: { b|l|d: { rid, people } } }
  checks: {},    // { 'date|slot': { ingredientName: 'have' | 'need' } }
  items: [],     // active list: { id, name, cat, qty, unit, note, addedBy, addedAt, status, by, meal }
  bought: [],    // history: { id, name, cat, qty, unit, by, at, price }
  tasks: [],     // { id, title, due, time, assignee, status, by, repeat, declined, doneBy, doneAt }
  bills: [],     // { id, date, shop, total, count, by }
  log: [],       // { at, by, text }
});

// ---------- Load / save ----------
function migrate(d) {
  if (!d || typeof d !== 'object') return fresh();
  if (d.v === VERSION) return { ...fresh(), ...d };
  // v1 (first Homzy) → v2: keep list, tasks, bills, home name and meal names.
  const s = fresh();
  const me = { id: uid(), name: 'Me', hue: HUES[0] };
  s.setup = true;
  s.members = [me];
  s.me = me.id;
  s.home.name = d.home || s.home.name;
  s.lang = d.lang || s.lang;
  s.items = (d.list || []).map((i) => ({ id: i.id || uid(), name: i.name, cat: i.cat, qty: i.qty, unit: i.unit, note: '', addedBy: me.id, addedAt: i.at || Date.now(), status: 'needed', by: null }));
  s.tasks = (d.tasks || []).filter((t) => !t.done).map((t) => ({ id: t.id || uid(), title: t.title, due: t.due || today(), time: '', assignee: null, status: 'open', by: me.id, repeat: t.repeat || 'none' }));
  s.bills = (d.bills || []).map((b) => ({ ...b, by: me.id }));
  for (const [date, meals] of Object.entries(d.meals || {})) {
    for (const [slot, name] of Object.entries(meals || {})) {
      const r = findRecipeByName(name, s) || addRecipeTo(s, { name, mins: null, slots: slot, ing: [] });
      (s.plan[date] ||= {})[slot] = { rid: r.id, people: s.home.people };
    }
  }
  return s;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : fresh();
  } catch {
    return fresh();
  }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

export function fromBackup(text) {
  const d = JSON.parse(text);
  if (!d || typeof d !== 'object' || !('v' in d)) throw new Error('Not a Homzy backup');
  return migrate(d);
}

// ---------- Members ----------
export function addMember(s, name) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) return null;
  const m = { id: uid(), name: clean, hue: HUES[s.members.length % HUES.length] };
  s.members.push(m);
  if (!s.me) s.me = m.id;
  return m;
}
export const member = (s, id) => s.members.find((m) => m.id === id);
export const nameOf = (s, id) => (id === s.me ? 'You' : member(s, id)?.name || 'Someone');
export const firstName = (s, id) => member(s, id)?.name || 'Someone';

export function removeMember(s, id) {
  if (s.members.length < 2 || id === s.me) return false;
  s.members = s.members.filter((m) => m.id !== id);
  // Anything waiting on them goes back to everyone.
  for (const i of s.items) if (i.by === id) { i.status = 'needed'; i.by = null; }
  for (const t of s.tasks) if (t.assignee === id && t.status !== 'done') { t.assignee = null; t.status = 'open'; }
  return true;
}

function log(s, text) {
  s.log.unshift({ at: Date.now(), by: s.me, text });
  if (s.log.length > 300) s.log.length = 300;
}

// ---------- Recipes ----------
export function parseIng(line) {
  const m = String(line).trim().match(/^(.*?)\s+([\d.]+)\s*([a-zA-Z]+)?$/);
  if (!m) return { name: String(line).trim(), qty: null, unit: null };
  return { name: m[1].trim(), qty: parseFloat(m[2]), unit: m[3] || null };
}

const BUILT_IN = RECIPES.map((r) => ({
  id: slug(r.name), name: r.name, mins: r.mins, slots: r.slots, veg: r.veg, builtIn: true,
  ing: r.ing.split(';').map(parseIng),
}));

export function allRecipes(s) {
  const own = new Map(s.recipes.map((r) => [r.id, r]));
  return [...BUILT_IN.map((r) => own.get(r.id) || r), ...s.recipes.filter((r) => !BUILT_IN.some((b) => b.id === r.id))];
}
export const recipe = (s, id) => allRecipes(s).find((r) => r.id === id);
// "Rice & sambar" and "Rice + sambar" are the same meal.
const mealKey = (n) => key(n).replace(/\s*[&+]\s*|\s+and\s+/g, ' + ');
function findRecipeByName(name, s) { return allRecipes(s).find((r) => mealKey(r.name) === mealKey(name)); }

function addRecipeTo(s, { name, mins, slots, ing, veg = true }) {
  let id = slug(name) || uid();
  if (allRecipes(s).some((r) => r.id === id)) id += '-' + uid().slice(0, 4);
  const r = { id, name: name.trim().slice(0, 60), mins: mins || null, slots: slots || 'bld', veg, ing: ing || [] };
  s.recipes.push(r);
  return r;
}

export function saveRecipe(s, data, id) {
  if (id) {
    const existing = recipe(s, id);
    if (!existing) return null;
    const updated = { ...existing, ...data, id, builtIn: false };
    s.recipes = s.recipes.filter((r) => r.id !== id);
    s.recipes.push(updated);
    return updated;
  }
  const r = addRecipeTo(s, data);
  if (!s.favs.includes(r.id)) s.favs.push(r.id);
  return r;
}

export function toggleFav(s, id) {
  s.favs = s.favs.includes(id) ? s.favs.filter((f) => f !== id) : [...s.favs, id];
}

/** Ingredient amounts scaled to the number of people. */
export function scaled(r, people) {
  const f = (people || BASE_PEOPLE) / BASE_PEOPLE;
  return r.ing.map((i) => ({ ...i, qty: i.qty == null ? null : nice(i.qty * f, i.unit) }));
}

function nice(q, unit) {
  if (unit === 'g' || unit === 'ml') return q >= 200 ? Math.round(q / 50) * 50 : Math.max(5, Math.round(q / 5) * 5);
  if (unit === 'pcs' || unit === 'pkt' || unit === 'bottle') return q < 1 ? 0.5 : Math.round(q);
  return Math.round(q * 100) / 100;
}

export function fmtQty(qty, unit) {
  if (qty == null || qty === '') return '';
  let q = +qty, u = unit || '';
  if (u === 'g' && q >= 1000) { q /= 1000; u = 'kg'; }
  if (u === 'ml' && q >= 1000) { q /= 1000; u = 'L'; }
  const n = +q.toFixed(2);
  if (u === 'pcs') return String(n);
  return u ? `${n} ${u}` : String(n);
}

// ---------- Meal plan ----------
export const mealAt = (s, date, slot) => s.plan[date]?.[slot] || null;

export function setMeal(s, date, slot, rid, people) {
  const day = (s.plan[date] ||= {});
  if (!rid) { delete day[slot]; delete s.checks[`${date}|${slot}`]; return; }
  const prev = day[slot];
  day[slot] = { rid, people: people || prev?.people || s.home.people };
  if (prev && prev.rid !== rid) delete s.checks[`${date}|${slot}`];
  if (!s.favs.includes(rid)) s.favs.push(rid);
}

export function setPeople(s, date, slot, people) {
  const m = mealAt(s, date, slot);
  if (m) m.people = Math.max(1, Math.min(30, people));
}

/** Copy the 7 days before `from` onto the 7 days from `from` (only empty slots). */
export function copyLastWeek(s, from) {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const src = s.plan[addDays(from, i - 7)] || {};
    const dst = (s.plan[addDays(from, i)] ||= {});
    for (const [slot, m] of Object.entries(src)) {
      if (!dst[slot]) { dst[slot] = { ...m }; n++; }
    }
  }
  return n;
}

/** Ingredients across the chosen meals, merged by name, with Have / Need / Check state. */
export function ingredientRows(s, meals) {
  const rows = new Map();
  for (const { date, slot } of meals) {
    const m = mealAt(s, date, slot);
    const r = m && recipe(s, m.rid);
    if (!r) continue;
    const answers = s.checks[`${date}|${slot}`] || {};
    for (const ing of scaled(r, m.people)) {
      const k = key(ing.name);
      const row = rows.get(k) || { name: ing.name, qty: 0, unit: ing.unit, answers: [], meals: [], sources: [] };
      if (ing.qty != null && (row.unit === ing.unit || row.qty === 0)) { row.qty += ing.qty; row.unit = ing.unit; }
      row.meals.push(r.name);
      row.sources.push(`${date}|${slot}`);
      row.answers.push(answers[ing.name] || 'check');
      rows.set(k, row);
    }
  }
  return [...rows.values()].map(({ answers, ...r }) => {
    // Need wins; Have only when every meal said Have; otherwise it still needs checking.
    const state = answers.includes('need') ? 'need' : answers.every((a) => a === 'have') ? 'have' : 'check';
    return { ...r, qty: r.qty || null, state, onList: !!activeItem(s, r.name), recent: lastBought(s, r.name, 4) };
  });
}

export function setCheck(s, sources, name, state) {
  for (const src of sources) {
    const c = (s.checks[src] ||= {});
    if (state === 'check') delete c[name]; else c[name] = state;
  }
}

// ---------- Shopping list ----------
export const activeItem = (s, name) => s.items.find((i) => key(i.name) === key(name));
export const catOf = (name) => matchCatalog(name)?.cat || CATALOG.find((c) => key(c.name) === key(name))?.cat || 'Other';

export function lastBought(s, name, withinDays) {
  const b = s.bought.find((x) => key(x.name) === key(name));
  if (!b) return null;
  if (withinDays != null && Date.now() - b.at > withinDays * 864e5) return null;
  return b;
}

/** Add items; existing active matches are reported, not duplicated. */
export function addItems(s, list, { meal = null, force = false } = {}) {
  const added = [], dupes = [];
  for (const it of list) {
    const name = String(it.name || '').trim().slice(0, 40);
    if (!name) continue;
    const existing = activeItem(s, name);
    if (existing && !force) { dupes.push(existing); continue; }
    const item = {
      id: uid(), name, cat: it.cat || catOf(name), qty: it.qty ?? null, unit: it.unit ?? null, note: it.note || '',
      addedBy: s.me, addedAt: Date.now(), status: 'needed', by: null, meal,
    };
    s.items.push(item);
    added.push(item);
  }
  if (added.length) log(s, `added ${added.map((i) => i.name).join(', ')}`);
  return { added, dupes };
}

const item = (s, id) => s.items.find((i) => i.id === id);

export function claim(s, id) {
  const i = item(s, id);
  if (!i || i.status === 'claimed') return false;
  i.status = 'claimed'; i.by = s.me; i.claimedAt = Date.now();
  log(s, `is buying ${i.name}`);
  return true;
}
export function release(s, id) {
  const i = item(s, id);
  if (!i) return;
  i.status = 'needed'; i.by = null;
  log(s, `released ${i.name}`);
}
/** Ask a member to buy. Asking yourself is the same as claiming. */
export function assign(s, id, memberId) {
  const i = item(s, id);
  if (!i) return;
  if (memberId === s.me) return claim(s, id);
  i.status = 'awaiting'; i.by = memberId;
  log(s, `asked ${firstName(s, memberId)} to buy ${i.name}`);
}
export function acceptItem(s, id) {
  const i = item(s, id);
  if (!i) return;
  i.status = 'claimed'; i.by = s.me;
  log(s, `will buy ${i.name}`);
}
export function declineItem(s, id) {
  const i = item(s, id);
  if (!i) return;
  i.status = 'needed'; i.by = null;
  log(s, `can't buy ${i.name} today`);
}

/** Record a purchase. Buying less than needed keeps the rest on the list. */
export function buy(s, id, { qty, price } = {}) {
  const i = item(s, id);
  if (!i) return null;
  const boughtQty = qty != null && i.qty != null ? Math.min(qty, i.qty) : i.qty;
  const partial = i.qty != null && boughtQty != null && boughtQty < i.qty;
  s.bought.unshift({
    id: uid(), itemId: i.id, name: i.name, cat: i.cat, qty: boughtQty, unit: i.unit, note: i.note,
    by: s.me, at: Date.now(), price: price > 0 ? price : null,
  });
  if (partial) {
    i.qty = +(i.qty - boughtQty).toFixed(2);
    log(s, `bought part of ${i.name}`);
  } else {
    s.items = s.items.filter((x) => x !== i);
    log(s, `bought ${i.name}`);
  }
  return { partial, left: partial ? i.qty : 0 };
}

/** Put a bought item back on the active list. */
export function restore(s, boughtId) {
  const b = s.bought.find((x) => x.id === boughtId);
  if (!b) return;
  s.bought = s.bought.filter((x) => x !== b);
  const existing = activeItem(s, b.name);
  if (existing) {
    if (existing.qty != null && b.qty != null && existing.unit === b.unit) existing.qty = +(existing.qty + b.qty).toFixed(2);
  } else {
    s.items.push({ id: b.itemId || uid(), name: b.name, cat: b.cat, qty: b.qty, unit: b.unit, note: b.note || '', addedBy: s.me, addedAt: Date.now(), status: 'needed', by: null });
  }
  log(s, `put ${b.name} back on the list`);
}

export function updateItem(s, id, fields) {
  const i = item(s, id);
  if (!i) return;
  Object.assign(i, fields);
  if (fields.name) i.cat = catOf(i.name);
}
export function removeItem(s, id) {
  const i = item(s, id);
  s.items = s.items.filter((x) => x.id !== id);
  if (i) log(s, `removed ${i.name}`);
}

/** Things you'll often need again: past purchases not on the list now. */
export function suggestions(s, fallback, n = 8) {
  const count = new Map();
  for (const b of s.bought) count.set(b.name, (count.get(b.name) || 0) + 1);
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return [...new Set([...ranked, ...fallback])].filter((nm) => !activeItem(s, nm)).slice(0, n);
}

// ---------- Responsibilities ----------
export function addTask(s, { title, due, time, assignee, repeat }) {
  const t = {
    id: uid(), title: String(title).trim().slice(0, 80), due: due || today(), time: time || '',
    assignee: assignee || null, by: s.me, repeat: repeat || 'none',
    status: !assignee ? 'open' : assignee === s.me ? 'accepted' : 'awaiting',
  };
  s.tasks.push(t);
  log(s, assignee && assignee !== s.me ? `asked ${firstName(s, assignee)}: ${t.title}` : `added ${t.title}`);
  return t;
}
const task = (s, id) => s.tasks.find((t) => t.id === id);
export function takeTask(s, id) { const t = task(s, id); if (t) { t.assignee = s.me; t.status = 'accepted'; t.declined = null; log(s, `will ${t.title.toLowerCase()}`); } }
export function acceptTask(s, id) { takeTask(s, id); }
export function declineTask(s, id) {
  const t = task(s, id);
  if (!t) return;
  t.declined = s.me; t.assignee = null; t.status = 'open';
  log(s, `can't do “${t.title}” today`);
}
export function releaseTask(s, id) { const t = task(s, id); if (t) { t.assignee = null; t.status = 'open'; } }
export function finishTask(s, id) {
  const t = task(s, id);
  if (!t) return;
  log(s, `finished ${t.title}`);
  if (t.repeat === 'daily' || t.repeat === 'weekly') {
    t.due = addDays(t.due > today() ? t.due : today(), t.repeat === 'daily' ? 1 : 7);
    t.declined = null;
    if (t.status === 'open') t.assignee = null;
  } else {
    t.status = 'done'; t.doneBy = s.me; t.doneAt = Date.now();
  }
}
export function updateTask(s, id, fields) {
  const t = task(s, id);
  if (!t) return;
  const reassigned = 'assignee' in fields && fields.assignee !== t.assignee;
  Object.assign(t, fields);
  if (reassigned) t.status = !t.assignee ? 'open' : t.assignee === s.me ? 'accepted' : 'awaiting';
}
export function removeTask(s, id) { s.tasks = s.tasks.filter((t) => t.id !== id); }

// ---------- Bills ----------
/** Active list item for a bill line: exact name, or one name inside the other ("Matta rice" ↔ "Rice"). */
export function listMatch(s, name) {
  const exact = activeItem(s, name);
  if (exact) return exact;
  const words = (x) => ` ${key(x)} `;
  const n = words(name);
  return s.items.find((i) => n.includes(words(i.name)) || words(i.name).includes(n)) || null;
}

/** Save a scanned bill; matching list items are marked bought by you. */
export function saveBill(s, { shop, total, lines }) {
  let matched = 0;
  for (const l of lines) {
    const active = listMatch(s, l.name);
    if (active) { buy(s, active.id, { price: l.price }); matched++; }
    else s.bought.unshift({ id: uid(), name: l.name, cat: l.cat || catOf(l.name), qty: null, unit: null, by: s.me, at: Date.now(), price: l.price || null });
  }
  if (total > 0) s.bills.push({ id: uid(), date: today(), shop: shop || '', total, count: lines.length, by: s.me });
  log(s, `saved a bill${shop ? ' from ' + shop : ''}`);
  return matched;
}

export function monthSpend(s, ym) {
  return s.bills.filter((b) => b.date.startsWith(ym)).reduce((a, b) => a + (+b.total || 0), 0);
}

// ---------- What needs me ----------
export function forMe(s) {
  const t = today();
  return {
    items: s.items.filter((i) => i.status === 'awaiting' && i.by === s.me),
    tasks: s.tasks.filter((x) => x.status === 'awaiting' && x.assignee === s.me && x.due <= addDays(t, 1)),
  };
}
