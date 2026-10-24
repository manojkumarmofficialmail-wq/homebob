import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import * as N from '../js/nutrition.js';
import { RECIPES } from '../js/data.js';
import { validate } from '../api/feedback.js';

const home = () => {
  const s = M.fresh();
  s.setup = true;
  s.home.people = 4;
  s.me = M.addMember(s, 'Meera').id;
  return s;
};

test('every built-in recipe ingredient has nutrition data', () => {
  const s = M.fresh();
  const missing = new Set();
  for (const r of M.allRecipes(s)) for (const n of N.recipeNutrition(r, 4).missing) missing.add(`${r.name}: ${n}`);
  assert.deepEqual([...missing], []);
  assert.equal(M.allRecipes(s).length, RECIPES.length);
});

test('recipe nutrition is in a sensible range per person', () => {
  const s = M.fresh();
  for (const r of M.allRecipes(s)) {
    const p = N.recipeNutrition(r, 4).perPerson;
    assert.ok(p.kcal > 150 && p.kcal < 1600, `${r.name}: ${Math.round(p.kcal)} kcal`);
    assert.ok(p.protein > 2 && p.protein < 90, `${r.name}: ${Math.round(p.protein)} g protein`);
  }
});

test('nutrition scales with people', () => {
  const r = M.allRecipes(M.fresh()).find((x) => x.name === 'Rice + dal');
  const four = N.recipeNutrition(r, 4).total.kcal;
  const eight = N.recipeNutrition(r, 8).total.kcal;
  assert.ok(Math.abs(eight / four - 2) < 0.1);
});

test('units: kg, ml, pieces and packets turn into grams', () => {
  const rice = N.lookup('Rice');
  assert.equal(N.grams(rice, 1, 'kg'), 1000);
  assert.equal(N.grams(N.lookup('Eggs'), 6, 'pcs'), 300);
  assert.equal(N.grams(N.lookup('Bread'), 1, 'pkt'), 400);
  assert.ok(Math.abs(N.grams(N.lookup('Coconut oil'), 100, 'ml') - 92) < 0.01);
  assert.equal(N.grams(rice, 2, 'pcs'), null); // rice has no piece weight
  assert.equal(N.lookup('Kozhi').name, 'chicken'); // Malayalam alias from the catalog
  assert.equal(N.lookup('Zzyzx'), null); // unknown word
  assert.equal(N.lookup('tomatoes').name, 'tomato'); // plural
});

test('week summary counts home and outside meals and replaces a planned meal', () => {
  const s = home();
  const mon = N.weekStart(M.today());
  M.setMeal(s, mon, 'd', 'rice-dal');
  M.setMeal(s, mon, 'l', 'rice-sambar');
  M.addOutside(s, { date: mon, slot: 'l', kind: 'restaurant', weight: 'heavy', amount: 900, people: 4 });
  M.addOutside(s, { date: mon, slot: 's', kind: 'snacks', amount: 120, people: 2 });
  const w = N.weekSummary(s, mon);
  assert.equal(w.homeMeals, 1);
  assert.equal(w.outMeals, 1); // lunch outside replaced the planned lunch
  assert.equal(w.spend.outside, 1020);
  assert.equal(Math.round(w.out.kcal), 4 * 1100 + Math.round(2 * 750 * 0.45)); // heavy lunch + regular snack
  assert.ok(w.home.kcal > 0);
  assert.equal(w.days[0].out, w.out.kcal);
});

test('future days are not counted as eaten', () => {
  const s = home();
  const next = N.weekStart(M.addDays(M.today(), 7));
  M.setMeal(s, next, 'd', 'rice-dal');
  const w = N.weekSummary(s, next);
  assert.equal(w.homeMeals, 0);
  assert.ok(w.days.every((d) => d.future));
});

test('grocery spend counts a bill once, plus loose priced purchases', () => {
  const s = home();
  M.addItems(s, [{ name: 'Milk' }, { name: 'Rice' }, { name: 'Eggs' }]);
  M.saveBill(s, { shop: 'Supermart', total: 500, lines: [{ name: 'Milk', price: 60 }, { name: 'Rice', price: 300 }] });
  const eggs = s.items.find((i) => i.name === 'Eggs');
  M.buy(s, eggs.id, { price: 84 });
  const mon = N.weekStart();
  assert.equal(N.grocerySpend(s, mon, M.addDays(mon, 6)), 584);
  assert.equal(M.monthSpend(s, M.today().slice(0, 7)), 584);
});

test('status flags low protein and high fat', () => {
  assert.equal(N.status('protein', 30, 55).tone, 'low');
  assert.equal(N.status('fat', 90, 60).tone, 'high');
  assert.equal(N.status('protein', 90, 55).tone, 'ok'); // more protein is fine
});

test('old backups without outside data still load', () => {
  const old = M.fresh();
  delete old.outside;
  const s = M.fromBackup(JSON.stringify(old));
  assert.deepEqual(s.outside, []);
});

test('feedback validation', () => {
  assert.ok(validate({ message: 'Love the list', rating: 5, kind: 'praise' }).row);
  assert.equal(validate({ message: '' }).error, 'Message is required');
  assert.equal(validate(null).error, 'Invalid body');
  assert.equal(validate({ message: 'hi there', website: 'spam.com' }).spam, true);
  const r = validate({ message: 'x'.repeat(5000), rating: 9, kind: 'hack', household_size: 4 }).row;
  assert.equal(r.message.length, 2000);
  assert.equal(r.rating, null);
  assert.equal(r.kind, 'other');
  assert.equal(r.household_size, 4);
});
