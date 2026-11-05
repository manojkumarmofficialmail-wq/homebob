import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { t, setLang, tables, langOfVoice } from '../js/i18n.js';

// Every literal t('…') / tr('…') the screens use.
const src = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const used = [...new Set([...src.matchAll(/\btr?\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]))]
  .filter((k) => !/\{n\} of 7 $/.test(k)); // built from parts (see SLOT_WORDS)
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every screen text has a Malayalam, Hindi and Tamil translation', () => {
  for (const [code, table] of Object.entries(tables())) {
    const missing = used.filter((k) => !(k in table));
    assert.deepEqual(missing, [], `${code} is missing: ${missing.join(' | ')}`);
  }
});

test('translations keep the same {placeholders}', () => {
  for (const [code, table] of Object.entries(tables())) {
    for (const [k, v] of Object.entries(table)) assert.equal(holes(v), holes(k), `${code}: "${k}"`);
  }
});

test('t() fills placeholders and falls back to English', () => {
  setLang('hi');
  assert.equal(t('{n} min', { n: 5 }), '5 मिनट');
  assert.equal(t('Something new that is not translated'), 'Something new that is not translated');
  setLang('xx');
  assert.equal(t('{n} min', { n: 5 }), '5 min');
  assert.equal(langOfVoice('ml-IN'), 'ml');
  assert.equal(langOfVoice('fr-FR'), 'en');
});
