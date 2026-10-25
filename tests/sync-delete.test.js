// Deleting with family sync: runs the real sync loop (js/sync.js) for two phones
// against a small fake server, so a deleted item must stay deleted after merging.
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------- A browser-ish world for sync.js and cloud.js ----------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.document = { hidden: false, addEventListener() {} };
globalThis.window = { addEventListener() {} };
store.set('homzy:session', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: 4e9, user: { id: 'u' } }));

const server = { rev: 1, data: null, puts: 0 };
const json = (j, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(j), json: async () => j });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url, 'http://localhost');
  if (u.pathname === '/api/config') return json({ sync: true, url: 'https://fake.supabase.co', key: 'sb_publishable_test' });
  if (u.pathname === '/rest/v1/rpc/my_household') return json({ household_id: 'h1', rev: server.rev, role: 'editor', member_id: null });
  if (u.pathname === '/rest/v1/households' && (opts.method || 'GET') === 'GET') {
    return json([{ id: 'h1', name: 'Home', rev: server.rev, data: JSON.parse(JSON.stringify(server.data)) }]);
  }
  if (u.pathname === '/rest/v1/households' && opts.method === 'PATCH') {
    const want = +u.searchParams.get('rev').replace('eq.', '');
    if (want !== server.rev) return json([]); // someone saved first
    server.rev++; server.puts++;
    server.data = JSON.parse(opts.body).data;
    return json([{ rev: server.rev }]);
  }
  return json({ message: 'not found' }, 404);
};

const M = await import('../js/model.js');
const clone = (x) => JSON.parse(JSON.stringify(x));

// Each phone gets its own copy of sync.js (its own "last agreed" base and revision).
async function phone(name, doc) {
  const S = await import(`../js/sync.js?phone=${name}`);
  const p = { S, s: M.adopt(doc, {}) };
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0; // no background polling in tests
  S.start({ getState: () => p.s, setState: (d) => { p.s = M.adopt(d, { me: p.s.me }); } });
  globalThis.setInterval = realSetInterval;
  S.link({ hid: 'h1', role: 'editor', rev: server.rev, base: clone(doc), memberId: null });
  p.sync = () => S.run();
  return p;
}

function startHome() {
  const s = M.fresh();
  s.setup = true;
  s.me = M.addMember(s, 'Meera').id;
  M.addMember(s, 'Arun');
  M.addItems(s, [{ name: 'Milk' }, { name: 'Rice' }, { name: 'Eggs' }]);
  M.addTask(s, { title: 'Water the plants' });
  M.addOutside(s, { amount: 300, slot: 'l' });
  M.setMeal(s, M.today(), 'd', 'rice-dal');
  const doc = clone(s);
  delete doc.me; delete doc.lang; // this phone's own settings never go online
  server.rev = 1; server.data = doc; server.puts = 0;
  return clone(server.data);
}
const names = (s) => s.items.map((i) => i.name);
const tick = () => new Promise((r) => setTimeout(r, 5));

test('a deleted item stays deleted after both phones sync', async () => {
  const doc = startHome();
  const a = await phone('a1', doc), b = await phone('b1', doc);
  await tick();
  const milk = a.s.items.find((i) => i.name === 'Milk');
  M.removeItem(a.s, milk.id);
  await a.sync();
  await b.sync();
  await a.sync();
  assert.deepEqual(names(a.s), ['Rice', 'Eggs']);
  assert.deepEqual(names(b.s), ['Rice', 'Eggs']);
  assert.deepEqual(server.data.items.map((i) => i.name), ['Rice', 'Eggs']);
});

test('delete on one phone while the other claims it: the delete wins, in either order', async () => {
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const doc = startHome();
    const a = await phone('a2' + order.join(''), doc), b = await phone('b2' + order.join(''), doc);
    await tick();
    const milk = doc.items.find((i) => i.name === 'Milk');
    M.removeItem(a.s, milk.id);
    b.s.me = b.s.members[1].id;
    M.claim(b.s, milk.id);
    M.updateItem(b.s, milk.id, { note: 'Full cream' });
    const ph = { a, b };
    await ph[order[0]].sync();
    await ph[order[1]].sync();
    await ph[order[0]].sync();
    await ph[order[1]].sync();
    for (const p of [a, b]) assert.ok(!p.s.items.some((i) => i.id === milk.id), `milk came back (${order})`);
    assert.ok(!server.data.items.some((i) => i.id === milk.id));
  }
});

test('a delete and a new item from another phone at the same time: both stick', async () => {
  const doc = startHome();
  const a = await phone('a3', doc), b = await phone('b3', doc);
  await tick();
  const rice = doc.items.find((i) => i.name === 'Rice');
  M.removeItem(a.s, rice.id);
  M.addItems(b.s, [{ name: 'Curd' }]);
  await b.sync();
  await a.sync();
  await b.sync();
  assert.deepEqual(names(a.s), ['Milk', 'Eggs', 'Curd']);
  assert.deepEqual(names(b.s), ['Milk', 'Eggs', 'Curd']);
});

test('an offline phone with an old copy does not bring a deleted item back', async () => {
  const doc = startHome();
  const a = await phone('a4', doc), b = await phone('b4', doc);
  await tick();
  const eggs = doc.items.find((i) => i.name === 'Eggs');
  M.removeItem(a.s, eggs.id);
  await a.sync();
  // b was offline: it made several unrelated changes on its old copy.
  M.addTask(b.s, { title: 'Buy gas' });
  M.updateItem(b.s, doc.items[0].id, { qty: 2, unit: 'L' });
  await b.sync();
  await a.sync();
  for (const p of [a, b]) {
    assert.deepEqual(names(p.s), ['Milk', 'Rice']);
    assert.equal(p.s.items[0].qty, 2);
    assert.ok(p.s.tasks.some((t) => t.title === 'Buy gas'));
  }
});

test('tasks, food from outside and planned meals stay deleted too', async () => {
  const doc = startHome();
  const a = await phone('a5', doc), b = await phone('b5', doc);
  await tick();
  M.removeFrom(a.s, 'task', doc.tasks[0].id);
  M.removeFrom(a.s, 'outside', doc.outside[0].id);
  M.clearMeal(a.s, M.today(), 'd');
  // Meanwhile the other phone edits the same things.
  M.takeTask(b.s, doc.tasks[0].id);
  b.s.outside[0].amount = 350;
  M.setPeople(b.s, M.today(), 'd', 6);
  await b.sync();
  await a.sync();
  await b.sync();
  for (const p of [a, b]) {
    assert.equal(p.s.tasks.length, 0);
    assert.equal(p.s.outside.length, 0);
    assert.equal(M.mealAt(p.s, M.today(), 'd'), null);
  }
});

test('Undo after the delete has synced puts the item back for everyone', async () => {
  const doc = startHome();
  const a = await phone('a6', doc), b = await phone('b6', doc);
  await tick();
  const milk = doc.items.find((i) => i.name === 'Milk');
  const removed = M.removeItem(a.s, milk.id);
  await a.sync();
  await b.sync();
  assert.ok(!b.s.items.some((i) => i.id === milk.id));
  assert.ok(M.putBack(a.s, removed));
  assert.equal(M.putBack(a.s, removed), false, 'putting back twice does nothing');
  await a.sync();
  await b.sync();
  assert.deepEqual(names(b.s), ['Milk', 'Rice', 'Eggs']);
  assert.equal(b.s.items[0].id, milk.id);
});
