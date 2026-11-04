import test from 'node:test';
import assert from 'node:assert/strict';
import { itemLook, dishEmoji, dishHue } from '../js/emoji.js';
import { spinTo, sliceAt, wheelSvg } from '../js/wheel.js';
import { CATALOG, RECIPES } from '../js/data.js';

test('items get a food emoji, in English and local names', () => {
  assert.equal(itemLook('Milk').e, '🥛');
  assert.equal(itemLook('paal').e, '🥛');
  assert.equal(itemLook('2 kg tomatoes').e, '🍅');
  assert.equal(itemLook('Something new').e, '🛒');
});

test('every catalog item has an emoji and a colour', () => {
  for (const c of CATALOG) {
    const l = itemLook(c.name);
    assert.ok(l.e && Number.isFinite(l.h), c.name);
  }
});

test('dishes get an emoji from their main ingredient', () => {
  assert.equal(dishEmoji('Rice + fish curry'), '🐟');
  assert.equal(dishEmoji('Chapati + chicken curry'), '🍗');
  assert.equal(dishEmoji('Dosa + sambar'), '🥞');
  assert.equal(dishEmoji('Chapati + chana'), '🫓');
  assert.equal(dishEmoji('Mystery dish'), '🍛');
  for (const r of RECIPES) assert.ok(dishEmoji(r.name));
  assert.equal(dishHue('Upma'), dishHue('Upma'));
});

test('a spin stops on the chosen slice', () => {
  for (const n of [2, 3, 5, 8]) {
    let rot = 0;
    for (let i = 0; i < n; i++) {
      for (const jitter of [-0.5, 0, 0.5]) {
        const next = spinTo(rot, i, n, { jitter });
        assert.ok(next > rot + 360 * 4, 'turns forwards a few times');
        assert.equal(sliceAt(next, n), i, `n=${n} i=${i} jitter=${jitter}`);
        rot = next;
      }
    }
  }
});

test('the wheel drawing escapes dish names', () => {
  const svg = wheelSvg([{ name: '<b>Dal</b>', emoji: '🍲' }, { name: 'Upma', emoji: '🥣' }]);
  assert.ok(svg.includes('&lt;b&gt;Dal'));
  assert.ok(!svg.includes('<b>'));
});
