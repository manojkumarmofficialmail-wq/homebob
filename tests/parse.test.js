import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpeech } from '../js/parse.js';
import { itemNutrition } from '../js/nutrition.js';

const items = (text) => parseSpeech(text).map((x) => [x.name, x.qty, x.unit]);

test('one sentence with commas and "and" adds several items', () => {
  assert.deepEqual(items('2 kg rice, 1 litre milk and 6 eggs'), [['Rice', 2, 'kg'], ['Milk', 1, 'L'], ['Eggs', 6, 'pcs']]);
  assert.deepEqual(items('Two litres of milk, one kilo rice and six eggs.'), [['Milk', 2, 'L'], ['Rice', 1, 'kg'], ['Eggs', 6, 'pcs']]);
});

test('a run of known words without separators', () => {
  assert.deepEqual(items('rice milk eggs onion'), [['Rice', null, null], ['Milk', null, null], ['Eggs', null, null], ['Onion', null, null]]);
  assert.deepEqual(items('tomato onion coconut oil'), [['Tomato', null, null], ['Onion', null, null], ['Coconut oil', null, null]]);
});

test('splits at each new amount', () => {
  assert.deepEqual(items('two litres milk one kilo rice'), [['Milk', 2, 'L'], ['Rice', 1, 'kg']]);
  assert.deepEqual(items('1kg atta 500g toor dal'), [['Wheat flour', 1, 'kg'], ['Toor dal', 500, 'g']]);
});

test('an amount said after the name belongs to that name', () => {
  assert.deepEqual(items('rice 2 kg and milk 1 litre'), [['Rice', 2, 'kg'], ['Milk', 1, 'L']]);
  assert.deepEqual(items('eggs 6'), [['Eggs', 6, 'pcs']]);
});

test('Hindi: roman and Devanagari, joined with aur / और', () => {
  assert.deepEqual(items('do kilo chawal aur ek litre doodh'), [['Rice', 2, 'kg'], ['Milk', 1, 'L']]);
  assert.deepEqual(items('दो किलो चावल और एक लीटर दूध'), [['Rice', 2, 'kg'], ['Milk', 1, 'L']]);
  assert.deepEqual(items('ek kilo cheeni aur do packet doodh'), [['Sugar', 1, 'kg'], ['Milk', 2, 'pkt']]);
});

test('Malayalam: roman and script, with -um / ഉം as "and"', () => {
  assert.deepEqual(items('randu kilo ari, oru litre paal'), [['Rice', 2, 'kg'], ['Milk', 1, 'L']]);
  assert.deepEqual(items('രണ്ട് കിലോ അരി, ഒരു ലിറ്റർ പാൽ'), [['Rice', 2, 'kg'], ['Milk', 1, 'L']]);
  assert.deepEqual(items('അരിയും പാലും'), [['Rice', null, null], ['Milk', null, null]]);
  assert.deepEqual(items('ariyum paalum'), [['Rice', null, null], ['Milk', null, null]]);
  assert.deepEqual(items('randu kilo ariyum oru litre paalum'), [['Rice', 2, 'kg'], ['Milk', 1, 'L']]);
  assert.deepEqual(items('ari um paal'), [['Rice', null, null], ['Milk', null, null]]);
});

test('unknown words stay as their own items', () => {
  assert.deepEqual(items('rice chewing gum milk'), [['Rice', null, null], ['Chewing Gum', null, null], ['Milk', null, null]]);
  assert.deepEqual(items('dishwash liquid and bath soap'), [['Dishwash liquid', null, null], ['Bath soap', null, null]]);
  // Words ending in "um" that aren't Malayalam stay whole.
  assert.deepEqual(items('aluminium foil'), [['Aluminium foil', null, null]]);
  assert.deepEqual(items('vacuum bags'), [['Vacuum Bags', null, null]]);
});

test('fractions and "one and a half"', () => {
  assert.deepEqual(items('one and a half kg sugar'), [['Sugar', 1.5, 'kg']]);
  assert.deepEqual(items('half kg tomato'), [['Tomato', 0.5, 'kg']]);
});

test('nutrition while adding: per 100 g and for the amount', () => {
  const rice = itemNutrition({ name: 'Rice', qty: 2, unit: 'kg' });
  assert.equal(rice.per100.kcal, 356);
  assert.equal(rice.grams, 2000);
  assert.equal(Math.round(rice.amount.kcal), 7120);
  assert.equal(Math.round(rice.amount.protein), 150);
  const eggs = itemNutrition({ name: 'Eggs', qty: 6, unit: 'pcs' });
  assert.equal(eggs.grams, 300);
  assert.equal(Math.round(eggs.amount.protein), 38);
  // No amount yet: per 100 g only.
  const milk = itemNutrition({ name: 'Milk', qty: null, unit: null });
  assert.equal(milk.amount, null);
  assert.equal(milk.per100.protein, 3.2);
  // Spoken in Malayalam: the catalog alias finds the food.
  assert.equal(itemNutrition({ name: 'പാൽ' }).name, 'milk');
});

test('no nutrition for non-food or unknown items', () => {
  assert.equal(itemNutrition({ name: 'Dishwash liquid', qty: 1, unit: 'bottle' }), null);
  assert.equal(itemNutrition({ name: 'Chewing Gum' }), null);
});
