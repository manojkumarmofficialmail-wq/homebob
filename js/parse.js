// Turns spoken / typed text and bill lines into items.
import { CATALOG } from './data.js';

const NUMBER_WORDS = {
  // English
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50,
  hundred: 100, half: 0.5, quarter: 0.25,
  // Hindi (roman + script)
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chhe: 6, saat: 7, aath: 8, das: 10,
  aadha: 0.5, adha: 0.5, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6,
  'सात': 7, 'आठ': 8, 'दस': 10, 'आधा': 0.5,
  // Malayalam (roman + script)
  onnu: 1, oru: 1, randu: 2, moonnu: 3, naalu: 4, anchu: 5, aaru: 6, ezhu: 7, ettu: 8, pathu: 10, ara: 0.5,
  'ഒന്ന്': 1, 'ഒരു': 1, 'രണ്ട്': 2, 'രണ്ടു': 2, 'മൂന്ന്': 3, 'നാല്': 4, 'അഞ്ച്': 5, 'ആറ്': 6,
  'ഏഴ്': 7, 'എട്ട്': 8, 'ഒമ്പത്': 9, 'പത്ത്': 10, 'അര': 0.5,
};

const UNIT_WORDS = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg', 'കിലോ': 'kg', 'किलो': 'kg',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', gramme: 'g', 'ഗ്രാം': 'g', 'ग्राम': 'g',
  l: 'L', ltr: 'L', ltrs: 'L', litre: 'L', litres: 'L', liter: 'L', liters: 'L', 'ലിറ്റർ': 'L', 'लीटर': 'L',
  ml: 'ml', 'മില്ലി': 'ml',
  packet: 'pkt', packets: 'pkt', pack: 'pkt', packs: 'pkt', pkt: 'pkt', pkts: 'pkt', 'പാക്കറ്റ്': 'pkt', 'पैकेट': 'pkt',
  dozen: 'dozen', 'ഡസൻ': 'dozen', 'दर्जन': 'dozen',
  piece: 'pcs', pieces: 'pcs', pc: 'pcs', pcs: 'pcs', nos: 'pcs', no: 'pcs', 'എണ്ണം': 'pcs',
  bottle: 'bottle', bottles: 'bottle', 'കുപ്പി': 'bottle', 'बोतल': 'bottle',
  bunch: 'pkt', bunches: 'pkt', box: 'pkt', boxes: 'pkt', tin: 'pcs',
};

const FILLER = new Set(['of', 'the', 'some', 'please', 'also', 'buy', 'get', 'need', 'want', 'more',
  'and', 'aur', 'और', 'um', 'uh', 'then', 'we', 'i', 'to', 'add', 'list', 'വേണം']);

// Malayalam chillu letters → base consonant, so "പാൽ" and "പാലും" both match.
const CHILLU = { 'ൽ': 'ല', 'ൾ': 'ള', 'ൻ': 'ന', 'ർ': 'ര', 'ൺ': 'ണ', 'ൿ': 'ക' };

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ൽൾൻർൺൿ]/g, (c) => CHILLU[c])
    .replace(/്(?=\s|$)/g, '') // trailing virama
    .replace(/[^\p{L}\p{M}\p{N}.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Lookup tables keyed by norm() so Malayalam spellings line up ("രണ്ട്" → "രണ്ട").
const NUM = Object.fromEntries(Object.entries(NUMBER_WORDS).map(([k, v]) => [norm(k), v]));
const UNIT = Object.fromEntries(Object.entries(UNIT_WORDS).map(([k, v]) => [norm(k), v]));
const FILL = new Set([...FILLER].map(norm));

// Alias index, longest first so "coconut oil" wins over "coconut".
const INDEX = CATALOG.flatMap((item) =>
  [item.name, ...item.aliases].map((a) => ({ alias: norm(a), item }))
).sort((a, b) => b.alias.length - a.alias.length);

const isAscii = (s) => /^[\x00-\x7f]*$/.test(s);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const REGEX_CACHE = new Map();
function aliasRegex(alias) {
  if (!REGEX_CACHE.has(alias)) {
    // English: whole word with optional plural. Indic: word start (suffixes like -ും are common).
    const re = isAscii(alias)
      ? new RegExp(`(^|\\s)${esc(alias)}(s|es)?(?=\\s|$)`)
      : new RegExp(`(^|\\s)${esc(alias)}`);
    REGEX_CACHE.set(alias, re);
  }
  return REGEX_CACHE.get(alias);
}

/** Find the best catalog match inside a piece of text. */
export function matchCatalog(text) {
  const t = norm(text);
  if (!t) return null;
  for (const { alias, item } of INDEX) {
    if (alias.length < 2) continue;
    if (aliasRegex(alias).test(t)) return item;
  }
  return null;
}

const titleCase = (s) => s.replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());

function toNumber(tok) {
  if (/^\d+(\.\d+)?$/.test(tok)) return parseFloat(tok);
  if (/^\d+\/\d+$/.test(tok)) { const [a, b] = tok.split('/'); return +a / +b; }
  return tok in NUM ? NUM[tok] : null;
}

const isArticle = (tok) => tok === 'a' || tok === 'an';

/**
 * Parse one phrase like "2 litres milk" into items. A phrase without a number
 * can hold several items ("tomato onion coconut oil"), so this returns an array.
 */
export function parseItem(phrase) {
  const toks = norm(phrase).split(' ').filter(Boolean);
  let qty = null, unit = null;
  const rest = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    // "a"/"an" only counts as 1 before a unit: "a kilo rice", not "an apple".
    const n = isArticle(tok) && !UNIT[toks[i + 1]] ? null : toNumber(tok);
    if (n != null && qty == null) { qty = n; continue; }
    if (n != null && n < 1) { qty += n; continue; }
    if (unit == null && UNIT[tok]) { unit = UNIT[tok]; continue; }
    if (!FILL.has(tok) && !isArticle(tok)) rest.push(tok);
  }
  const names = splitNames(rest.join(' '));
  if (!names.length) return [];
  return names.map((n, i) => ({
    name: n.hit ? n.hit.name : titleCase(n.text),
    cat: n.hit ? n.hit.cat : 'Other',
    // The quantity belongs to the first item only.
    qty: i ? null : qty ?? (unit ? 1 : null),
    unit: i ? null : unit ?? (qty != null && n.hit ? guessUnit(n.hit, qty) : null),
  }));
}

// Pull every catalog item out of a run of words, keeping leftovers as their own item.
function splitNames(text) {
  let left = ` ${text} `;
  const found = [];
  for (const { alias, item } of INDEX) {
    if (alias.length < 2 || found.some((f) => f.hit === item)) continue;
    const m = left.match(aliasRegex(alias));
    if (!m) continue;
    // Extend Indic matches to the end of the word ("അരിയ" from "അരിയും").
    const endIdx = left.indexOf(' ', m.index + m[0].length);
    found.push({ hit: item, at: m.index });
    left = left.slice(0, m.index) + ' '.repeat(endIdx - m.index) + left.slice(endIdx);
  }
  const extra = left.trim().replace(/\s+/g, ' ');
  if (extra && (!found.length || extra.length > 2)) found.push({ hit: null, text: extra, at: left.indexOf(extra.split(' ')[0]) });
  return found.sort((a, b) => a.at - b.at);
}

// "2 milk" → 2 L feels wrong for eggs, so only borrow the catalog unit for counted things.
function guessUnit(item, qty) {
  if (['pcs', 'pkt', 'bottle', 'dozen'].includes(item.unit)) return item.unit;
  return qty >= 1 && Number.isInteger(qty) ? 'pcs' : item.unit;
}

/** Split free speech into item phrases and parse each one. */
export function parseSpeech(text) {
  let s = ` ${String(text || '')} `
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')           // "2kg" → "2 kg"
    // "one and a half" → "1.5", before "and" becomes a separator
    .replace(/(\S+)\s+and\s+(?:a\s+)?half\b/gi, (m, w) => {
      const n = toNumber(norm(w));
      return n == null ? m : ` ${n + 0.5} `;
    })
    .replace(/ും(?=\s|[,.]|$)/g, ' , ')            // Malayalam "-um" means "and"
    .replace(/\s(and|aur|और|then|plus|also)\s/gi, ' , ')
    .replace(/[;\n]/g, ',');

  const chunks = [];
  for (const part of s.split(/[,.](?!\d)/)) {
    // Also split "two litres milk one kilo rice" at each new number.
    const toks = norm(part).split(' ').filter(Boolean);
    let cur = [], hasWord = false;
    for (const tok of toks) {
      const isNum = toNumber(tok) != null && !isArticle(tok);
      if (isNum && hasWord) { chunks.push(cur.join(' ')); cur = []; hasWord = false; }
      cur.push(tok);
      if (!isNum && !UNIT[tok] && !FILL.has(tok)) hasWord = true;
    }
    if (cur.length) chunks.push(cur.join(' '));
  }
  return chunks.flatMap(parseItem);
}

// ---------- Bills ----------

const SKIP_LINE = /(gst|gstin|invoice|bill\s*no|phone|ph\b|mob|tel|date|time|cashier|thank|visit|tax|cgst|sgst|igst|discount|saving|round|change|tender|cash|card|upi|balance|qty\s*total|total\s*qty|items?\s*:|hsn|fssai|address|road|kerala|pin)/i;
const TOTAL_LINE = /(grand\s*total|net\s*(amt|amount|payable|total)|amount\s*payable|total\s*amount|bill\s*amount|\btotal\b)/i;
const STRONG_TOTAL = /(grand|net|payable|bill\s*amount)/i;

const moneyIn = (line) =>
  (line.replace(/,(?=\d{3})/g, '').match(/\d+(?:\.\d{1,2})?/g) || []).map(Number);

/** Read OCR text from a bill: returns { items, total, shop }. */
export function parseBill(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let total = null, totalStrength = -1;
  const items = [];
  const seen = new Set();

  lines.forEach((line, i) => {
    if (TOTAL_LINE.test(line) && !/qty|items/i.test(line)) {
      const nums = moneyIn(line);
      const strength = STRONG_TOTAL.test(line) ? 2 : 1;
      // Some bills print the amount on the next line.
      const val = nums.length ? nums[nums.length - 1] : moneyIn(lines[i + 1] || '').pop();
      if (val != null && strength >= totalStrength) { total = val; totalStrength = strength; }
      return;
    }
    if (SKIP_LINE.test(line)) return;
    const letters = line.replace(/[^\p{L}]/gu, '');
    if (letters.length < 3) return;
    const nums = moneyIn(line);
    if (!nums.length) return;
    const name = line.replace(/\bx\b|[\d.,₹@*/%:-]+/gi, ' ').replace(/\s+/g, ' ').trim();
    const hit = matchCatalog(name);
    const key = hit ? hit.name : name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      name: hit ? hit.name : titleCase(name.toLowerCase()).slice(0, 40),
      cat: hit ? hit.cat : 'Other',
      price: nums[nums.length - 1],
      known: !!hit,
    });
  });

  if (total == null) {
    const all = lines.flatMap(moneyIn).filter((n) => n < 100000);
    total = all.length ? Math.max(...all) : null;
  }
  const shop = lines.find((l) => /\p{L}{3,}/u.test(l) && !SKIP_LINE.test(l) && !moneyIn(l).length) || '';
  return { items, total, shop: titleCase(shop.toLowerCase()).slice(0, 40) };
}
