import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../api/survey.js';
import { FEATURES } from '../js/survey-data.js';

test('survey keeps only known answers', () => {
  const { row } = validate({
    used_app: 'regular', household_size: '3-4', planner: 'hacker', languages: ['ml', 'en', 'xx', 'ml'],
    ratings: { list: 'useful', scan: 'maybe', nope: 'useful', plan: 'love' },
    favourite: 'list', today_methods: ['whatsapp', 'carrier-pigeon'], missing: '  Festival menus  ',
    price: 'm49', recommend: '9', city: 'Kochi',
  });
  assert.equal(row.planner, null);
  assert.deepEqual(row.languages, ['ml', 'en']);
  assert.deepEqual(row.ratings, { list: 'useful', scan: 'maybe' });
  assert.deepEqual(row.today_methods, ['whatsapp']);
  assert.equal(row.missing, 'Festival menus');
  assert.equal(row.recommend, 9);
});

test('survey rejects empty answers and catches bots', () => {
  assert.equal(validate({}).error, 'Please answer at least one question');
  assert.equal(validate({ city: 'Kochi' }).error, 'Please answer at least one question');
  assert.equal(validate(null).error, 'Invalid body');
  assert.equal(validate({ recommend: 0 }).row.recommend, 0);
  assert.equal(validate({ recommend: 11 }).error, 'Please answer at least one question');
  assert.equal(validate({ used_app: 'tried', website: 'x.com' }).spam, true);
});

test('feature ids are short and unique (they are stored in the database)', () => {
  const ids = FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[a-z]{2,20}$/.test(id)));
});
