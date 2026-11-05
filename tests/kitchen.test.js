// Kitchen tab: stock, understanding what was said, new-ingredient nutrition, and the AI helper's checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import * as N from '../js/nutrition.js';
import { parseDish, understandLocal, parseBill } from '../js/parse.js';
import { merge3 } from '../js/sync.js';
import { validate, clean } from '../api/understand.js';

const home = () => {
  const s = M.fresh();
  s.setup = true;
  s.me = M.addMember(s, 'Meera').id;
  return s;
};

// ---------- Stock ----------
test('stock adds up in one unit: kg and g, L and ml, dozen and pieces', () => {
  const s = home();
  M.stockAdd(s, [{ name: 'Rice', qty: 5, unit: 'kg' }, { name: 'Milk', qty: 1, unit: 'L' }, { name: 'Eggs', qty: 1, unit: 'dozen' }]);
  M.stockAdd(s, [{ name: 'rice', qty: 500, unit: 'g' }, { name: 'Milk', qty: 500, unit: 'ml' }, { name: 'Eggs', qty: 6, unit: 'pcs' }]);
  const get = (n) => M.stockMatch(s, n);
  assert.equal(s.stock.length, 3);
  assert.deepEqual([get('Rice').qty, get('Rice').unit], [5500, 'g']);
  assert.deepEqual([get('Milk').qty, get('Milk').unit], [1500, 'ml']);
  assert.deepEqual([get('Eggs').qty, get('Eggs').unit], [18, 'pcs']);
  assert.equal(M.fmtQty(get('Rice').qty, get('Rice').unit), '5.5 kg');
  assert.equal(s.stockSince, M.today());
});

test('a bill line without an amount is "in stock"; a pack size from the bill counts', () => {
  const s = home();
  M.stockAdd(s, [{ name: 'Turmeric' }]);
  assert.equal(M.stockMatch(s, 'Turmeric').qty, null);
  assert.deepEqual(M.stockLow(s), [], 'no amount, so it is never "running low"');
  const bill = parseBill('FRESH MART\nAashirvaad Atta 5kg 245.00\nMilk 500ml 26.00\nGRAND TOTAL 271.00');
  M.saveBill(s, { shop: 'Fresh Mart', total: bill.total, lines: bill.items, toStock: true });
  assert.equal(M.stockMatch(s, 'Wheat flour').qty, 5000);
  assert.equal(M.stockMatch(s, 'Milk').qty, 500);
  assert.equal(s.bills.length, 1, 'the bill is still saved for spend');
});

test('saving a bill without toStock leaves stock alone', () => {
  const s = home();
  M.saveBill(s, { shop: '', total: 100, lines: [{ name: 'Rice', price: 100 }] });
  assert.equal(s.stock.length, 0);
});

test('cooking a planned meal takes its ingredients out of stock, only once', () => {
  const s = home();
  const r = M.saveRecipe(s, { name: 'Test dal', ing: [{ name: 'Toor dal', qty: 200, unit: 'g' }, { name: 'Tomato', qty: 2, unit: 'pcs' }] });
  M.stockAdd(s, [{ name: 'Toor dal', qty: 1, unit: 'kg' }, { name: 'Tomato', qty: 6, unit: 'pcs' }]);
  M.setMeal(s, M.today(), 'd', r.id, 2); // half the recipe
  const used = M.cookMeal(s, M.today(), 'd');
  assert.deepEqual(used.sort(), ['Tomato', 'Toor dal']);
  assert.equal(M.stockMatch(s, 'Toor dal').qty, 900);
  assert.equal(M.stockMatch(s, 'Tomato').qty, 5);
  assert.equal(M.cookMeal(s, M.today(), 'd'), null, 'a second "cooked" does nothing');
  assert.equal(M.stockMatch(s, 'Toor dal').qty, 900);
});

test('stock never goes below zero and shows up as running low', () => {
  const s = home();
  M.stockAdd(s, [{ name: 'Oil', qty: 300, unit: 'ml' }, { name: 'Rice', qty: 5, unit: 'kg' }]);
  const r = M.saveRecipe(s, { name: 'Oily', ing: [{ name: 'Oil', qty: 500, unit: 'ml' }] });
  M.stockUse(s, r, 4);
  assert.equal(M.stockMatch(s, 'Oil').qty, 0);
  assert.deepEqual(M.stockLow(s).map((x) => x.name), ['Oil']);
});

test('meals that already happened come out of stock, but not before stock began or when eaten outside', () => {
  const s = home();
  const r = M.saveRecipe(s, { name: 'Rice meal', ing: [{ name: 'Rice', qty: 400, unit: 'g' }] });
  const t = M.today();
  M.setMeal(s, M.addDays(t, -5), 'l', r.id, 4); // before stock began
  M.setMeal(s, M.addDays(t, -1), 'l', r.id, 4);
  M.setMeal(s, M.addDays(t, -1), 'd', r.id, 4);
  M.addOutside(s, { date: M.addDays(t, -1), slot: 'd', amount: 500, people: 4 });
  M.stockAdd(s, [{ name: 'Rice', qty: 5, unit: 'kg' }]);
  s.stockSince = M.addDays(t, -2);
  const late = new Date(); late.setHours(23, 0, 0, 0);
  assert.equal(M.useCookedMeals(s, late), 1);
  assert.equal(M.stockMatch(s, 'Rice').qty, 4600);
  assert.equal(M.useCookedMeals(s, late), 0, 'running it again changes nothing');
  assert.equal(M.mealAt(s, M.addDays(t, -5), 'l').used, undefined);
});

test('stock steps change by a sensible amount and can be deleted with undo', () => {
  const s = home();
  M.stockAdd(s, [{ name: 'Rice', qty: 2, unit: 'kg' }, { name: 'Eggs', qty: 6, unit: 'pcs' }]);
  const rice = M.stockMatch(s, 'Rice'), eggs = M.stockMatch(s, 'Eggs');
  M.stockStep(s, rice.id, 1); M.stockStep(s, eggs.id, -1);
  assert.equal(rice.qty, 2500);
  assert.equal(eggs.qty, 5);
  const removed = M.removeFrom(s, 'stock', eggs.id);
  assert.equal(s.stock.length, 1);
  assert.ok(M.putBack(s, removed));
  assert.equal(s.stock.length, 2);
});

test('stock and new-food nutrition merge between two phones', () => {
  const base = home();
  M.stockAdd(base, [{ name: 'Rice', qty: 5, unit: 'kg' }]);
  const a = JSON.parse(JSON.stringify(base)), b = JSON.parse(JSON.stringify(base));
  M.stockAdd(a, [{ name: 'Oil', qty: 1, unit: 'L' }]);
  M.stockAdd(b, [{ name: 'Eggs', qty: 12, unit: 'pcs' }]);
  a.foods.kokum = { v: [60, 1, 14, 0.5, 2], est: true };
  b.foods.jaggery = { v: [380, 0.4, 95, 0.1, 0], est: true };
  const m = merge3(base, a, b);
  assert.deepEqual(m.stock.map((x) => x.name).sort(), ['Eggs', 'Oil', 'Rice']);
  assert.deepEqual(Object.keys(m.foods).sort(), ['jaggery', 'kokum']);
});

// ---------- Understanding what was said ----------
test('a dish sentence becomes a dish with its ingredients', () => {
  assert.deepEqual(parseDish('made fish curry with half kilo fish and 2 tomatoes'), {
    name: 'Fish Curry', ing: [{ name: 'Fish', qty: 0.5, unit: 'kg' }, { name: 'Tomato', qty: 2, unit: 'pcs' }],
  });
  assert.equal(parseDish('today I cooked chicken biryani using 1 kg chicken').name, 'Chicken Biryani');
  assert.equal(parseDish('new dish amma special avial').name, 'Amma Special Avial');
  assert.equal(parseDish('2 kg rice and milk'), null);
});

test('the Kitchen mic tells items, dishes and stock apart', () => {
  assert.equal(understandLocal('2 kg rice, 1 litre milk and 6 eggs').kind, 'items');
  assert.equal(understandLocal('paneer butter masala with 200 g paneer, 2 onion').kind, 'dish');
  const st = understandLocal('add 5 kg rice and 2 litre oil to stock');
  assert.equal(st.kind, 'stock');
  assert.deepEqual(st.items.map((x) => [x.name, x.qty, x.unit]), [['Rice', 5, 'kg'], ['Oil', 2, 'L']]);
  assert.equal(understandLocal('we have 12 eggs').kind, 'stock');
  assert.equal(understandLocal('').sure, false);
});

// ---------- Nutrition for new ingredients ----------
test('a home\'s own foods fill gaps in the nutrition table', () => {
  assert.equal(N.lookup('kokum'), null);
  N.useFoods({ kokum: { v: [60, 1, 14, 0.5, 2], est: true } });
  try {
    const row = N.lookup('Kokum');
    assert.equal(row.est, true);
    assert.equal(Math.round(N.ingredientNutrition({ name: 'Kokum', qty: 50, unit: 'g' }).kcal), 30);
    assert.deepEqual(N.unknown(['Kokum', 'Rice', 'Mystery thing', 'mystery thing']), ['Mystery thing']);
  } finally {
    N.useFoods({});
  }
});

test('nutrition rows from outside are checked before they are used', () => {
  assert.deepEqual(N.cleanRow([60, 1, 14, 0.5, 2]), [60, 1, 14, 0.5, 2]);
  assert.deepEqual(N.cleanRow([120, 10, 5, 8, 0, 50]), [120, 10, 5, 8, 0, 50]);
  assert.equal(N.cleanRow([5000, 1, 1, 1, 1]), null, 'too many kcal');
  assert.equal(N.cleanRow([100, 60, 60, 1, 1]), null, 'more than 100 g in 100 g');
  assert.equal(N.cleanRow([100, -1, 1, 1, 1]), null);
  assert.equal(N.cleanRow('nope'), null);
});

// ---------- The AI helper's input and output checks ----------
test('the AI helper only accepts short, known jobs', () => {
  assert.equal(validate({ task: 'speech', text: '' }).error, 'Nothing to understand');
  assert.equal(validate({ task: 'other' }).error, 'Unknown task');
  assert.ok(validate({ task: 'speech', text: 'x'.repeat(2000), lang: 'ml-IN' }).input.includes('Malayalam'));
  assert.ok(validate({ task: 'speech', text: 'x'.repeat(2000) }).input.length < 600, 'long text is cut');
  const n = validate({ task: 'nutrition', names: Array.from({ length: 30 }, (_, i) => `food ${i}`) });
  assert.equal(n.input.split('\n').length, 13, 'at most 12 names');
});

test('the AI helper\'s answers are cleaned before reaching the app', () => {
  assert.deepEqual(clean('speech', { kind: 'weird', items: [{ name: 'Rice', qty: 2, unit: 'KG' }, { name: '' }, { name: 'Milk', qty: -1, unit: 'cups' }] }),
    { kind: 'items', name: null, items: [{ name: 'Rice', qty: 2, unit: 'kg' }, { name: 'Milk', qty: null, unit: null }] });
  assert.deepEqual(clean('speech', { kind: 'dish', name: 'Avial', items: [] }), { kind: 'dish', name: 'Avial', items: [] });
  const f = clean('nutrition', { foods: [
    { name: 'Kokum', kcal: 60, protein: 1, carbs: 14, fat: 0.5, fibre: 2, g_piece: 0, g_packet: 100 },
    { name: 'Soap', kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 },
    { name: 'Bad', kcal: 'lots', protein: 1, carbs: 1, fat: 1, fibre: 1 },
  ] });
  assert.deepEqual(f, { foods: [{ name: 'Kokum', v: [60, 1, 14, 0.5, 2, null, 100] }] });
  assert.deepEqual(N.cleanRow(f.foods[0].v), [60, 1, 14, 0.5, 2, null, 100]);
});
