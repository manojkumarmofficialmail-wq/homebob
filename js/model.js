// Homzy data and every change to it. No DOM code here. Family sync (sync.js)
// listens to save() and merges in changes from other phones.
import { RECIPES, CATALOG } from './data.js';
import { matchCatalog } from './parse.js';
import * as $ from './money.js';

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
  outside: [],   // food from outside: { id, date, slot, kind, weight, place, amount, people, by, at }
  stock: [],     // kitchen stock: { id, name, cat, qty, unit, low, at, by } (qty in g, ml, pcs, pkt or bottle)
  stockSince: null, // first day stock was kept: meals before it are never taken out of stock
  foods: {},     // nutrition for ingredients Homzy didn't know: { key: { v: [kcal, protein, carbs, fat, fibre], est } }
  services: [],  // daily help & deliveries: { id, name, kind, per, qty, unit, rate, days, upi, phone, since, active }
  svcLog: {},    // { serviceId: { date: qty } }: only days that differ from usual (0 = didn't come)
  dues: [],      // bills & renewals: { id, name, kind, amount, every, due, day, remind, upi, account, booked, history, active }
  payments: [],  // { id, kind: 'service'|'bill', ref, name, period, amount, date, via, by }
  shops: [],     // shops the family orders from: { id, name, phone }
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

let afterSave = null;
/** Run fn after every save (family sync uses this to upload changes). */
export const onSave = (fn) => { afterSave = fn; };

export function save(s, { quiet = false } = {}) {
  let ok = true;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { ok = false; }
  if (!quiet) afterSave?.(s);
  return ok;
}

/** A home from the online copy, keeping this phone's own settings (who's using it, voice language). */
export function adopt(doc, device = {}) {
  // A deep copy, so later edits never change the synced copy held by sync.js.
  const s = migrate({ ...JSON.parse(JSON.stringify(doc || {})), v: doc?.v || VERSION });
  if (device.lang) s.lang = device.lang;
  s.me = device.me && s.members.some((m) => m.id === device.me) ? device.me : null;
  return s;
}

/** Forget everything on this phone (used when signing out of a synced home). */
export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* blocked */ }
  return fresh();
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
export function buy(s, id, { qty, price, bill = null } = {}) {
  const i = item(s, id);
  if (!i) return null;
  const boughtQty = qty != null && i.qty != null ? Math.min(qty, i.qty) : i.qty;
  const partial = i.qty != null && boughtQty != null && boughtQty < i.qty;
  s.bought.unshift({
    id: uid(), itemId: i.id, name: i.name, cat: i.cat, qty: boughtQty, unit: i.unit, note: i.note,
    by: s.me, at: Date.now(), price: price > 0 ? price : null, bill,
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
  return removeFrom(s, 'item', id);
}

// ---------- Deleting anything, with Undo ----------
// Family sync needs no tombstones: each phone keeps the last copy it agreed with the
// server, so merge3() sees "was there, now gone" as a delete and keeps it deleted,
// even when another phone edited the same thing meanwhile (see tests/sync.test.js).
const LISTS = { item: 'items', task: 'tasks', outside: 'outside', bill: 'bills', recipe: 'recipes', bought: 'bought', stock: 'stock', service: 'services', due: 'dues', payment: 'payments', shop: 'shops' };
const LABEL = {
  item: (x) => x.name, task: (x) => x.title, outside: (x) => `₹${Math.round(x.amount)} outside`,
  bill: (x) => `₹${Math.round(x.total)} bill`, recipe: (x) => x.name, bought: (x) => x.name, stock: (x) => `${x.name} from stock`,
  service: (x) => x.name, due: (x) => x.name, payment: (x) => `₹${Math.round(x.amount)} payment to ${x.name}`, shop: (x) => x.name,
};

/** Delete one thing by id. Returns what's needed to put it back, or null. */
export function removeFrom(s, kind, id) {
  const list = s[LISTS[kind]];
  const index = list ? list.findIndex((x) => x.id === id) : -1;
  if (index < 0) return null;
  const [value] = list.splice(index, 1);
  const removed = { kind, index, value, label: LABEL[kind](value) };
  if (kind === 'recipe') {
    removed.fav = s.favs.includes(id);
    s.favs = s.favs.filter((f) => f !== id);
  }
  if (kind !== 'bought') log(s, `removed ${removed.label}`);
  return removed;
}

/** Undo removeFrom(). Safe to call after a sync: does nothing if it's back already. */
export function putBack(s, removed) {
  if (!removed) return false;
  const list = s[LISTS[removed.kind]];
  if (!list || list.some((x) => x.id === removed.value.id)) return false;
  list.splice(Math.min(removed.index, list.length), 0, removed.value);
  if (removed.kind === 'recipe' && removed.fav && !s.favs.includes(removed.value.id)) s.favs.push(removed.value.id);
  // Drop the "removed …" line if nothing else happened since.
  if (s.log[0]?.text === `removed ${removed.label}`) s.log.shift();
  return true;
}

/** Clear a planned meal. Returns what's needed to put it back. */
export function clearMeal(s, date, slot) {
  const m = mealAt(s, date, slot);
  if (!m) return null;
  const removed = { kind: 'meal', date, slot, value: { ...m }, checks: s.checks[`${date}|${slot}`] };
  setMeal(s, date, slot, null);
  return removed;
}
export function putBackMeal(s, removed) {
  if (!removed || mealAt(s, removed.date, removed.slot)) return false;
  (s.plan[removed.date] ||= {})[removed.slot] = removed.value;
  if (removed.checks) s.checks[`${removed.date}|${removed.slot}`] = removed.checks;
  return true;
}

/** Custom recipes can be deleted; built-in ones can only be taken out of favourites. */
export const isBuiltIn = (id) => BUILT_IN.some((r) => r.id === id);

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

/** Save a scanned bill; matching list items are marked bought by you. With toStock, the lines also go into stock. */
export function saveBill(s, { shop, total, lines, toStock = false }) {
  if (toStock) stockAdd(s, lines);
  let matched = 0;
  // Line prices belong to the bill, so spend counts the bill total once.
  const billId = total > 0 ? uid() : null;
  for (const l of lines) {
    const active = listMatch(s, l.name);
    if (active) { buy(s, active.id, { price: l.price, bill: billId }); matched++; }
    else s.bought.unshift({ id: uid(), name: l.name, cat: l.cat || catOf(l.name), qty: null, unit: null, by: s.me, at: Date.now(), price: l.price || null, bill: billId });
  }
  if (total > 0) s.bills.push({ id: billId, date: today(), shop: shop || '', total, count: lines.length, by: s.me });
  log(s, `saved a bill${shop ? ' from ' + shop : ''}`);
  return matched;
}

/** Grocery spend for a month: bills, plus priced purchases that weren't on a bill. */
export function monthSpend(s, ym) {
  const bills = s.bills.filter((b) => b.date.startsWith(ym)).reduce((a, b) => a + (+b.total || 0), 0);
  const loose = s.bought.filter((b) => b.bill === null && b.price > 0 && iso(new Date(b.at)).startsWith(ym)).reduce((a, b) => a + b.price, 0);
  return bills + loose;
}

// ---------- Kitchen stock ----------
// Amounts are kept in a base unit so they add up: kg → g, L → ml, dozen → pcs.
const BASE = { kg: ['g', 1000], g: ['g', 1], l: ['ml', 1000], ml: ['ml', 1], dozen: ['pcs', 12], pcs: ['pcs', 1], pkt: ['pkt', 1], bottle: ['bottle', 1] };
/** { qty, unit } in the base unit, or { qty: null, unit: null } when there is no amount. */
export function toBase(qty, unit) {
  if (qty == null || !(+qty > 0)) return { qty: null, unit: null };
  const [u, f] = BASE[String(unit || 'pcs').toLowerCase()] || ['pcs', 1];
  return { qty: +(+qty * f).toFixed(2), unit: u };
}
// "Running low" at or below this, unless the family set their own level.
const LOW = { g: 250, ml: 250, pcs: 2, pkt: 1, bottle: 1 };
export const lowLevel = (x) => (x.low != null ? x.low : LOW[x.unit] ?? 1);

/** The stock entry for a name: exact, or one name inside the other ("Matta rice" ↔ "Rice"). */
export function stockMatch(s, name) {
  const k = key(name);
  const exact = s.stock.find((x) => key(x.name) === k);
  if (exact) return exact;
  const words = (x) => ` ${key(x)} `;
  const n = words(name);
  return s.stock.find((x) => n.includes(words(x.name)) || words(x.name).includes(n)) || null;
}

/** Add bought things to stock. lines: [{ name, qty, unit, cat }]. Returns how many were added or topped up. */
export function stockAdd(s, lines) {
  let n = 0;
  for (const l of lines) {
    const name = String(l.name || '').trim().slice(0, 40);
    if (!name) continue;
    const add = toBase(l.qty, l.unit);
    const x = stockMatch(s, name);
    if (x) {
      if (add.qty == null) { if (!(x.qty > 0)) { x.qty = null; x.unit = null; } }
      else if (x.unit === add.unit && x.qty != null) x.qty = +(x.qty + add.qty).toFixed(2);
      // A different kind of amount (packets vs grams): trust the newest one.
      else { x.qty = add.qty; x.unit = add.unit; }
      x.at = Date.now(); x.by = s.me;
    } else {
      s.stock.push({ id: uid(), name, cat: l.cat || catOf(name), qty: add.qty, unit: add.unit, low: null, at: Date.now(), by: s.me });
    }
    n++;
  }
  if (n) {
    s.stockSince ||= today();
    log(s, `added ${n === 1 ? lines.find((l) => l.name).name : n + ' things'} to stock`);
  }
  return n;
}

/** Step one stock entry up or down by a sensible amount for its unit. Never below zero. */
export function stockStep(s, id, d) {
  const x = s.stock.find((y) => y.id === id);
  if (!x) return null;
  if (!x.unit) { x.unit = 'pcs'; x.qty = 0; }
  const big = (x.qty || 0) >= 1000;
  const step = x.unit === 'g' || x.unit === 'ml' ? (big ? 500 : 100) : 1;
  x.qty = Math.max(0, +((x.qty || 0) + d * step).toFixed(2));
  x.at = Date.now(); x.by = s.me;
  return x;
}

/** Set an amount (in any unit) or a name. */
export function stockSet(s, id, { qty, unit, name } = {}) {
  const x = s.stock.find((y) => y.id === id);
  if (!x) return null;
  if (qty !== undefined) {
    const b = toBase(qty, unit || x.unit);
    x.qty = b.qty ?? 0; x.unit = b.unit || x.unit || 'pcs';
  }
  if (name) { x.name = String(name).trim().slice(0, 40); x.cat = catOf(x.name); }
  x.at = Date.now(); x.by = s.me;
  return x;
}

/** Stock that is running low or used up (only entries with an amount). */
export const stockLow = (s) => s.stock.filter((x) => x.qty != null && x.qty <= lowLevel(x));

/** Take a cooked meal's ingredients out of stock. Returns the names that went down. */
export function stockUse(s, r, people) {
  const used = [];
  for (const ing of scaled(r, people)) {
    const x = stockMatch(s, ing.name);
    const take = toBase(ing.qty, ing.unit);
    if (!x || x.qty == null || take.qty == null || take.unit !== x.unit) continue;
    x.qty = Math.max(0, +(x.qty - take.qty).toFixed(2));
    x.at = Date.now();
    used.push(x.name);
  }
  return used;
}

/** Mark a planned meal as cooked: its ingredients come out of stock, only once. */
export function cookMeal(s, date, slot) {
  const m = mealAt(s, date, slot);
  const r = m && recipe(s, m.rid);
  if (!r || m.used) return null;
  m.used = true;
  const used = stockUse(s, r, m.people);
  log(s, `cooked ${r.name}`);
  return used;
}

const SLOT_DONE = { b: 11, l: 16, d: 22 }; // after this hour a planned meal counts as cooked
/** Take meals that have already happened out of stock (only since stock began, last 3 days). */
export function useCookedMeals(s, now = new Date()) {
  if (!s.stockSince || !s.stock.length) return 0;
  const t = iso(now);
  let n = 0;
  for (let i = 3; i >= 0; i--) {
    const date = addDays(t, -i);
    if (date < s.stockSince) continue;
    for (const slot of ['b', 'l', 'd']) {
      const m = mealAt(s, date, slot);
      if (!m || m.used) continue;
      if (date === t && now.getHours() < SLOT_DONE[slot]) continue;
      // Eaten outside instead: nothing was cooked.
      if (s.outside.some((o) => o.date === date && o.slot === slot)) { m.used = true; continue; }
      if (cookMeal(s, date, slot)) n++;
    }
  }
  return n;
}

// ---------- Daily help & deliveries ----------
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const money = (v) => { const n = +String(v ?? '').replace(/[^\d.]/g, ''); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

/** Add or update a service (milk, maid…). Fields not given keep their kind's usual values. */
export function saveService(s, data, id) {
  const kind = $.SERVICE_KINDS[data.kind] ? data.kind : 'other';
  const base = $.SERVICE_KINDS[kind];
  const x = id ? s.services.find((v) => v.id === id) : null;
  const svc = {
    // New help usually came all month already: count from the 1st unless told otherwise.
    ...(x || { id: uid(), since: today().slice(0, 8) + '01', active: true }),
    name: clip(data.name, 30) || base.label, kind,
    per: ['unit', 'day', 'month'].includes(data.per) ? data.per : x?.per || base.per,
    qty: money(data.qty) || x?.qty || base.qty,
    unit: clip(data.unit ?? x?.unit ?? base.unit, 8),
    rate: data.rate != null && data.rate !== '' ? money(data.rate) : x?.rate ?? base.rate,
    days: /^(daily|[0-6]{1,7})$/.test(data.days || '') ? data.days : x?.days || 'daily',
    upi: clip(data.upi ?? x?.upi, 60), phone: clip(data.phone ?? x?.phone, 15),
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(data.since || '')) svc.since = data.since;
  if (x) Object.assign(x, svc); else { s.services.push(svc); log(s, `added ${svc.name}`); }
  return x || svc;
}

/** Note what came on a day. qty null = the usual (forget the note), 0 = didn't come. */
export function markService(s, id, date, qty) {
  const day = (s.svcLog[id] ||= {});
  if (qty == null) delete day[date]; else day[date] = Math.max(0, +qty);
  if (!Object.keys(day).length) delete s.svcLog[id];
}

export const serviceMonth = (s, svc, ym, upto = today()) => $.serviceMonth(svc, s.svcLog, s.payments, ym, upto);

/** Services due to come today that nobody has ticked yet. */
export const unansweredToday = (s, date = today()) =>
  s.services.filter((v) => $.scheduled(v, date) && s.svcLog[v.id]?.[date] == null);

// ---------- Payments ----------
export function recordPayment(s, { kind, ref, name, period, amount, via = 'upi', date = today() }) {
  const p = { id: uid(), kind, ref, name: clip(name, 40), period, amount: money(amount), date, via, by: s.me };
  if (!p.amount) return null;
  s.payments.push(p);
  log(s, `paid ₹${Math.round(p.amount)} to ${p.name}`);
  return p;
}

// ---------- Bills & renewals ----------
export function saveDue(s, data, id) {
  const kind = $.DUE_KINDS[data.kind] ? data.kind : 'other';
  const x = id ? s.dues.find((v) => v.id === id) : null;
  const every = $.EVERY[data.every] ? data.every : x?.every || $.DUE_KINDS[kind].every;
  const due = /^\d{4}-\d{2}-\d{2}$/.test(data.due || '') ? data.due : x?.due || today();
  const b = {
    ...(x || { id: uid(), active: true, history: [], booked: null }),
    name: clip(data.name, 30) || $.DUE_KINDS[kind].label, kind, every,
    amount: data.amount != null && data.amount !== '' ? money(data.amount) : x?.amount || 0,
    due, day: +due.slice(8, 10),
    remind: Math.max(0, Math.min(15, Math.round(+(data.remind ?? x?.remind ?? 3)) || 0)),
    upi: clip(data.upi ?? x?.upi, 60), account: clip(data.account ?? x?.account, 40),
  };
  if (x) Object.assign(x, b); else { s.dues.push(b); log(s, `added ${b.name}`); }
  return x || b;
}

/** Pay a bill: the payment is recorded and the bill moves to its next date (or ends, if it was once). */
export function payDue(s, id, { amount, via = 'upi', date = today() } = {}) {
  const b = s.dues.find((v) => v.id === id);
  if (!b) return null;
  const p = recordPayment(s, { kind: 'bill', ref: b.id, name: b.name, period: b.due, amount: amount ?? b.amount, via, date });
  if (b.every === 'gas') { gasDelivered(s, id, { date }); return p; }
  let next = $.nextDue(b.due, b.every, b.day);
  if (!next) { b.active = false; return p; }
  // Paid very late: skip to the first date after today.
  while (next <= date) next = $.nextDue(next, b.every, b.day);
  b.due = next;
  return p;
}

/** Gas: booked (it stops asking), then delivered (the next booking date is worked out from the gaps). */
export function gasBooked(s, id, date = today()) {
  const b = s.dues.find((v) => v.id === id);
  if (b) { b.booked = date; log(s, 'booked a gas cylinder'); }
  return b;
}
export function gasDelivered(s, id, { date = today() } = {}) {
  const b = s.dues.find((v) => v.id === id);
  if (!b) return null;
  b.history = [...(b.history || []), date].sort().slice(-8);
  b.booked = null;
  b.due = $.gasBookBy(b.history) || b.due;
  return b;
}

// ---------- Shops ----------
export function saveShop(s, { name, phone }, id) {
  const x = id ? s.shops.find((v) => v.id === id) : null;
  const shop = { ...(x || { id: uid() }), name: clip(name, 30) || 'Shop', phone: String(phone || '').replace(/[^\d+]/g, '').slice(0, 15) };
  if (x) Object.assign(x, shop); else s.shops.push(shop);
  return x || shop;
}

// ---------- The month in money ----------
/** What the home spent (or owes) in a month, by kind. Daily help counts what has been earned so far. */
export function monthMoney(s, ym) {
  const groceries = monthSpend(s, ym);
  const outside = monthOutside(s, ym);
  const help = s.services.reduce((a, v) => a + serviceMonth(s, v, ym).amount, 0);
  const bills = s.payments.filter((p) => p.kind === 'bill' && p.date.startsWith(ym)).reduce((a, p) => a + p.amount, 0);
  const helpPaid = s.payments.filter((p) => p.kind === 'service' && p.period === ym).reduce((a, p) => a + p.amount, 0);
  return { groceries, outside, help, bills, helpPaid, total: groceries + outside + help + bills };
}

// ---------- Food from outside ----------
export const SLOT_KEYS = ['b', 'l', 'd', 's'];

/** Slot that fits the time of day: breakfast, lunch, snack or dinner. */
export function slotNow(d = new Date()) {
  const h = d.getHours();
  return h < 11 ? 'b' : h < 16 ? 'l' : h < 19 ? 's' : 'd';
}

export function addOutside(s, { date, slot, kind, weight, place, amount, people }) {
  const o = {
    id: uid(), date: date || today(), slot: SLOT_KEYS.includes(slot) ? slot : 'd',
    kind: kind || 'restaurant', weight: weight || 'regular', place: String(place || '').trim().slice(0, 40),
    amount: Math.max(0, +amount || 0), people: Math.max(1, Math.min(30, Math.round(+people) || 1)), by: s.me, at: Date.now(),
  };
  s.outside.push(o);
  log(s, `logged ₹${Math.round(o.amount)} on food outside${o.place ? ' at ' + o.place : ''}`);
  return o;
}

export function removeOutside(s, id) { s.outside = s.outside.filter((o) => o.id !== id); }

export const outsideAt = (s, date, slot) => s.outside.filter((o) => o.date === date && o.slot === slot);

export function monthOutside(s, ym) {
  return s.outside.filter((o) => o.date.startsWith(ym)).reduce((a, o) => a + (+o.amount || 0), 0);
}

// ---------- What needs me ----------
export function forMe(s) {
  const t = today();
  return {
    items: s.items.filter((i) => i.status === 'awaiting' && i.by === s.me),
    tasks: s.tasks.filter((x) => x.status === 'awaiting' && x.assignee === s.me && x.due <= addDays(t, 1)),
  };
}
