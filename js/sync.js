// Keeps this phone's home in step with the online copy.
//
// The whole home is one JSON document. Each phone remembers the last version it
// agreed with the server (the "base"). When both sides changed, merge3() combines
// them item by item (by id), so two people adding to the list at once both win.
// If the same field was changed on both phones, this phone's change wins.
import * as C from './cloud.js';

const META = 'homzy:sync'; // { hid, role, rev, base, memberId }
const DEVICE_FIELDS = ['me', 'lang']; // belong to this phone, never uploaded
const POLL_MS = 15_000;
const PUSH_DELAY = 1200;

// ---------- Pure helpers (tested in tests/sync.test.js) ----------
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const copy = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

/** Deep equality that ignores key order and keys set to undefined (JSON treats them as missing). */
export function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!same(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function stable(x) {
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
  if (isObj(x)) return '{' + Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
  return JSON.stringify(x);
}
const idOf = (x) => (isObj(x) && x.id != null ? 'id:' + x.id : 'v:' + stable(x));

/**
 * Three-way merge. `base` is the last agreed version, `local` and `remote` are the two
 * edited versions. `undefined` means "not there" (deleted or never added).
 */
export function merge3(base, local, remote) {
  if (same(local, remote)) return local;
  if (same(base, local)) return remote;
  if (same(base, remote)) return local;
  // Both sides changed it.
  if (local === undefined || remote === undefined) return undefined; // a delete beats an edit
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      const v = merge3(b[k], local[k], remote[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(local) && Array.isArray(remote)) return mergeList(Array.isArray(base) ? base : [], local, remote);
  return local;
}

function mergeList(base, local, remote) {
  const map = (arr) => { const m = new Map(); for (const x of arr) m.set(idOf(x), x); return m; };
  const bm = map(base), lm = map(local), rm = map(remote);
  // Remote order first; things added on this phone go in after their neighbour here.
  const order = [...rm.keys()];
  const inserts = [];
  let prev = null;
  for (const k of lm.keys()) {
    if (!rm.has(k) && !bm.has(k)) inserts.push([prev, k]);
    else if (rm.has(k)) prev = k;
  }
  if (inserts.length) {
    const after = new Map(); // neighbour → keys added after it
    for (const [p, k] of inserts) { const list = after.get(p) || []; list.push(k); after.set(p, list); }
    const merged = [...(after.get(null) || [])];
    for (const k of order) { merged.push(k); if (after.has(k)) merged.push(...after.get(k)); }
    order.length = 0; order.push(...merged);
  }
  const out = [];
  for (const k of order) {
    const v = merge3(bm.get(k), lm.get(k), rm.get(k));
    if (v !== undefined) out.push(v);
  }
  return out;
}

/** The part of the home that is shared: everything except this phone's own settings. */
export function docOf(s) {
  const doc = { ...s };
  for (const k of DEVICE_FIELDS) delete doc[k];
  return JSON.parse(JSON.stringify(doc));
}

// ---------- Sync state ----------
const readMeta = () => { try { return JSON.parse(localStorage.getItem(META) || 'null'); } catch { return null; } };
let meta = readMeta();
const saveMeta = () => {
  try { meta ? localStorage.setItem(META, JSON.stringify(meta)) : localStorage.removeItem(META); }
  catch { /* storage full: sync still works this session */ }
};

export const linked = () => meta;
export const role = () => meta?.role || null;
export const canEdit = () => !meta || meta.role !== 'viewer';
export const isOwner = () => meta?.role === 'owner';

let app = null; // { getState, setState, onStatus, onRemoved, onRoleChange }
let status = { state: 'off', at: 0, error: '' }; // off | syncing | ok | offline | error
const setStatus = (st, error = '') => { status = { state: st, at: st === 'ok' ? Date.now() : status.at, error }; app?.onStatus?.(status); };
export const getStatus = () => status;

/** Start (or stop) syncing for this household. */
export function link(m) {
  meta = m ? { ...m, base: copy(m.base) } : null;
  saveMeta();
  if (m) { setStatus('ok'); schedule(0); } else setStatus('off');
}

/** Stop syncing and forget the household on this phone (does not touch the server). */
export function unlink() { link(null); }

let pushTimer = null;
let running = null;
let again = false;

function schedule(ms = PUSH_DELAY) {
  if (!meta) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => run(), ms);
}

/** Call after every local save. */
export function changed() { if (meta && meta.role !== 'viewer') schedule(); }

/** Sync now. Safe to call often: calls made while one is running are folded into one more pass. */
export function run() {
  if (!meta || !app) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      await once();
    } while (again && meta);
  })().finally(() => { running = null; });
  return running;
}

async function once() {
  if (!meta) return;
  if (!navigator.onLine) return setStatus('offline');
  setStatus('syncing');
  try {
    const info = await C.rpc('my_household');
    if (!info || info.household_id !== meta.hid) return removed();
    if (info.role !== meta.role || info.member_id !== meta.memberId) {
      const roleChanged = info.role !== meta.role;
      meta.role = info.role; meta.memberId = info.member_id; saveMeta();
      if (roleChanged) app.onRoleChange?.(info.role);
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const local = docOf(app.getState());
      const dirty = meta.role !== 'viewer' && !same(local, meta.base);
      if (!dirty) {
        if (info.rev === meta.rev) break;
        const row = await C.getHousehold(meta.hid);
        if (!row) return removed();
        // Changed on this phone while we were fetching: go round again and merge.
        if (meta.role !== 'viewer' && !same(docOf(app.getState()), local)) { info.rev = row.rev; continue; }
        meta.base = copy(row.data); meta.rev = row.rev; saveMeta();
        if (!same(local, row.data)) app.setState(row.data);
        break;
      }
      const rev = await C.putHousehold(meta.hid, meta.rev, local, local.home?.name);
      if (rev != null) {
        meta.base = local; meta.rev = rev; saveMeta(); // local is already a fresh copy (docOf)
        info.rev = rev;
        break;
      }
      // Clash: someone saved first. Merge their version with ours and try again.
      const row = await C.getHousehold(meta.hid);
      if (!row) return removed();
      const merged = merge3(meta.base, docOf(app.getState()), row.data);
      if (merged.log?.length > 300) merged.log.length = 300;
      meta.base = copy(row.data); meta.rev = row.rev; saveMeta();
      app.setState(merged);
      info.rev = row.rev;
    }
    setStatus('ok');
  } catch (e) {
    if (e.code === 'signed_out' || (e.status === 401 && !C.signedIn())) { setStatus('error', 'Signed out. Sign in again to keep syncing.'); return; }
    setStatus(e.offline ? 'offline' : 'error', e.message);
  }
}

function removed() {
  const was = meta;
  meta = null; saveMeta();
  setStatus('off');
  app?.onRemoved?.(was);
}

/** Hook the app in and start polling while the app is open. */
export function start(handlers) {
  app = handlers;
  setInterval(() => { if (meta && !document.hidden) run(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  window.addEventListener('online', () => run());
  window.addEventListener('offline', () => meta && setStatus('offline'));
  if (meta) run();
}

/** Has this phone got changes the server hasn't seen? */
export const pending = () => !!meta && meta.role !== 'viewer' && !!app && !same(docOf(app.getState()), meta.base);
