import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { merge3, same, docOf } from '../js/sync.js';
import { publicKey } from '../api/config.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

function home() {
  const s = M.fresh();
  s.setup = true;
  s.me = M.addMember(s, 'Meera').id;
  M.addMember(s, 'Arun');
  M.addItems(s, [{ name: 'Milk' }, { name: 'Rice' }]);
  return s;
}

test('same() ignores key order and undefined keys', () => {
  assert.ok(same({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }));
  assert.ok(same({ a: 1, x: undefined }, { a: 1 }));
  assert.ok(!same([1, 2], [2, 1]));
  assert.ok(!same({ a: null }, {}));
});

test('both phones add list items: both are kept', () => {
  const base = home();
  const a = clone(base), b = clone(base);
  a.me = a.members[0].id; b.me = b.members[1].id;
  M.addItems(a, [{ name: 'Eggs' }]);
  M.addItems(b, [{ name: 'Curd' }]);
  const m = merge3(docOf(base), docOf(a), docOf(b));
  assert.deepEqual(m.items.map((i) => i.name), ['Milk', 'Rice', 'Eggs', 'Curd']);
  assert.equal(m.log.length, 3); // the first "added" line plus one from each phone
});

test('one phone buys, the other edits a different item', () => {
  const base = home();
  const a = clone(base), b = clone(base);
  const [milk, rice] = base.items;
  M.buy(a, milk.id, { price: 60 });
  M.updateItem(b, rice.id, { qty: 5, unit: 'kg' });
  const m = merge3(docOf(base), docOf(a), docOf(b));
  assert.deepEqual(m.items.map((i) => i.name), ['Rice']);
  assert.equal(m.items[0].qty, 5);
  assert.equal(m.bought[0].name, 'Milk');
});

test('a delete beats an edit of the same item', () => {
  const base = home();
  const a = clone(base), b = clone(base);
  const milk = base.items[0];
  M.removeItem(a, milk.id);
  M.updateItem(b, milk.id, { note: 'Full cream' });
  const m = merge3(docOf(base), docOf(a), docOf(b));
  assert.ok(!m.items.some((i) => i.id === milk.id));
});

test('same field changed on both phones: this phone wins, other fields merge', () => {
  const base = home();
  const a = clone(base), b = clone(base);
  const milk = base.items[0];
  M.updateItem(a, milk.id, { qty: 2, unit: 'L' });
  M.updateItem(b, milk.id, { qty: 3, unit: 'L', note: 'Toned' });
  const m = merge3(docOf(base), docOf(a), docOf(b));
  const out = m.items.find((i) => i.id === milk.id);
  assert.equal(out.qty, 2);
  assert.equal(out.note, 'Toned');
});

test('meal plan and nested objects merge per slot', () => {
  const base = home();
  const d = M.today();
  M.setMeal(base, d, 'd', 'rice-dal');
  const a = clone(base), b = clone(base);
  M.setMeal(a, d, 'l', 'rice-sambar');
  M.setMeal(b, d, 'd', null); // cleared dinner
  M.addOutside(b, { date: d, slot: 'd', amount: 800, people: 4 });
  const m = merge3(docOf(base), docOf(a), docOf(b));
  assert.equal(m.plan[d].l.rid, 'rice-sambar');
  assert.equal(m.plan[d].d, undefined);
  assert.equal(m.outside.length, 1);
});

test('favourites merge as a set', () => {
  const base = home();
  base.favs = ['a', 'b'];
  const a = clone(base), b = clone(base);
  a.favs = ['a', 'b', 'c'];
  b.favs = ['b'];
  assert.deepEqual(merge3(docOf(base), docOf(a), docOf(b)).favs, ['b', 'c']);
});

test('new items added at the front (history) stay at the front', () => {
  const base = { bought: [{ id: 1 }, { id: 2 }] };
  const a = { bought: [{ id: 'a' }, { id: 1 }, { id: 2 }] };
  const b = { bought: [{ id: 'b' }, { id: 1 }, { id: 2 }] };
  assert.deepEqual(merge3(base, a, b).bought.map((x) => x.id), ['a', 'b', 1, 2]);
});

test('this phone’s own settings are never uploaded', () => {
  const s = home();
  const doc = docOf(s);
  assert.equal('me' in doc, false);
  assert.equal('lang' in doc, false);
  const back = M.adopt(doc, { me: s.members[1].id, lang: 'ml-IN' });
  assert.equal(back.me, s.members[1].id);
  assert.equal(back.lang, 'ml-IN');
  assert.equal(M.adopt(doc, { me: 'gone' }).me, null);
});

test('config never hands a secret key to the browser', () => {
  const jwt = (role) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.sig';
  assert.equal(publicKey('sb_publishable_abc'), 'sb_publishable_abc');
  assert.equal(publicKey('sb_secret_abc'), null);
  assert.equal(publicKey(jwt('anon')), jwt('anon'));
  assert.equal(publicKey(jwt('service_role')), null);
  assert.equal(publicKey(''), null);
});

test('editing the home never changes the copy it was loaded from', () => {
  const doc = docOf(home());
  const before = clone(doc);
  const s = M.adopt(doc, {});
  M.addItems(s, [{ name: 'Eggs' }]);
  s.items[0].qty = 9;
  assert.deepEqual(doc, before);
});
