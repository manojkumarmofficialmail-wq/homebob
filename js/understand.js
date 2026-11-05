// Understanding what was said, and finding nutrition for new ingredients.
// Homzy's own parser (parse.js) always goes first: it is free and works offline.
// The AI helper (/api/understand) is only asked when the parser isn't sure, or for an
// ingredient Homzy has no nutrition for. If it isn't set up or reachable, nothing breaks.
import { understandLocal } from './parse.js';
import { unknown, foodKey, cleanRow } from './nutrition.js';

let aiOff = false;          // the server said the helper isn't set up: stop asking this session
const tried = new Set();    // ingredient names already asked about this session

async function ask(body) {
  if (aiOff || !navigator.onLine || location.protocol === 'file:') return null;
  try {
    const r = await fetch('/api/understand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (r.status === 503 || r.status === 404) { aiOff = true; return null; }
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * What a sentence is about: { kind: 'items'|'dish'|'stock', name?, items: [{ name, qty, unit }], ai }.
 * `hint` ('dish' | 'stock') is where the person started from, used when the sentence doesn't say.
 */
export async function understand(text, lang, hint = null) {
  const local = understandLocal(text);
  if (hint && local.kind === 'items') local.kind = hint;
  if (local.sure) return { ...local, ai: false };
  const out = await ask({ task: 'speech', text, lang });
  if (!out || !Array.isArray(out.items) || (!out.items.length && !out.name)) return { ...local, ai: false };
  const kind = out.kind === 'items' && hint ? hint : out.kind;
  return { kind, name: out.name || local.name || '', items: out.items, ai: true };
}

/**
 * Look up nutrition for ingredient names Homzy doesn't know and save the estimates into
 * `foods` (the home's s.foods). Returns how many were added. Each name is asked once per session.
 */
export async function fillNutrition(foods, names) {
  const want = unknown(names).filter((n) => !tried.has(foodKey(n))).slice(0, 12);
  if (!want.length) return 0;
  want.forEach((n) => tried.add(foodKey(n)));
  const out = await ask({ task: 'nutrition', names: want });
  if (!out || !Array.isArray(out.foods)) {
    if (aiOff || !navigator.onLine) want.forEach((n) => tried.delete(foodKey(n))); // try again when it can work
    return 0;
  }
  let n = 0;
  out.foods.forEach((f, i) => {
    const row = cleanRow(f?.v);
    if (!row) return;
    // Match the answer to what we asked by name, else by position.
    const asked = want.find((w) => foodKey(w) === foodKey(f.name)) || want[i];
    if (!asked || foods[foodKey(asked)]) return;
    foods[foodKey(asked)] = { v: row, est: true };
    n++;
  });
  return n;
}

/** Is the AI helper switched off for this session (not set up)? */
export const aiAvailable = () => !aiOff;
