// Nutrition for meals and the week: what the family ate, at home and outside.
// Values are per 100 g edible portion, rounded from the Indian Food Composition
// Tables (ICMR-NIN, 2017), with USDA values where IFCT has no entry. Meat and fish
// are "as bought" (bones and skin taken off), so recipe weights can be used directly.
// These are estimates for a household, not medical advice.
import { matchCatalog } from './parse.js';
import { key, mealAt, recipe, scaled, addDays, today } from './model.js';

// name: [kcal, protein g, carbs g, fat g, fibre g, grams per piece, grams per packet, g per ml]
const T = {
  // Grains & flours (dry weight)
  'rice': [356, 7.5, 78, 0.6, 1.5],
  'matta rice': [350, 7.6, 77, 1.0, 3.0],
  'basmati rice': [350, 8.0, 77, 0.6, 1.2],
  'raw rice': [356, 7.5, 78, 0.6, 1.5],
  'wheat flour': [340, 12, 69, 1.7, 11],
  'maida': [350, 10.5, 74, 1.0, 2.7],
  'rava': [360, 12, 73, 1.0, 3.9],
  'puttu podi': [360, 6.5, 80, 0.8, 2.0],
  'appam podi': [360, 6.5, 80, 0.8, 2.0],
  'idiyappam podi': [360, 6.5, 80, 0.8, 2.0],
  'dosa batter': [135, 4.0, 28, 0.5, 1.5, null, 1000],
  'poha': [346, 6.6, 77, 1.2, 3.5],
  'oats': [389, 13.6, 66, 7.6, 10, null, 500],
  'ragi': [328, 7.2, 72, 1.9, 11],
  'vermicelli': [350, 10, 76, 1.0, 2.5, null, 200],
  'besan': [387, 22, 58, 6.7, 11],
  'noodles': [450, 9.0, 60, 18, 2.5, null, 70],
  'bread': [265, 9.0, 49, 3.2, 2.7, 25, 400],
  // Pulses (dry)
  'toor dal': [343, 22, 58, 1.7, 9],
  'moong dal': [348, 24, 59, 1.2, 8],
  'green gram': [334, 23, 56, 1.3, 16],
  'urad dal': [341, 24, 57, 1.6, 12],
  'masoor dal': [343, 24, 59, 1.1, 10],
  'black chana': [360, 19, 60, 5.0, 17],
  'chickpeas': [364, 19, 61, 6.0, 17],
  'rajma': [333, 22.5, 60, 1.5, 15],
  'cowpea': [336, 23, 57, 1.3, 11],
  // Dairy & eggs (ml for liquids)
  'milk': [60, 3.2, 4.7, 3.1, 0, null, 500, 1.03],
  'curd': [60, 3.1, 3.4, 4.0, 0, null, 400],
  'buttermilk': [20, 1.0, 2.0, 0.8, 0, null, 500, 1.0],
  'butter': [717, 0.9, 0.1, 81, 0, null, 100],
  'ghee': [900, 0, 0, 100, 0, null, 500, 0.91],
  'paneer': [265, 18, 1.2, 21, 0, null, 200],
  'cheese': [350, 21, 2.0, 28, 0, 20, 200],
  'eggs': [143, 12.6, 0.7, 9.5, 0, 50],
  // Meat & fish (as bought)
  'chicken': [115, 18, 0, 4.5, 0],
  'fish': [85, 15, 0, 2.5, 0],
  'sardine': [100, 13, 0, 5.0, 0],
  'mackerel': [110, 13, 0, 6.0, 0],
  'prawns': [85, 18, 0.9, 1.0, 0],
  'beef': [200, 20, 0, 13, 0],
  'mutton': [190, 17, 0, 13, 0],
  // Vegetables
  'onion': [40, 1.1, 9.3, 0.1, 1.7, 110],
  'small onion': [72, 2.5, 16.8, 0.1, 3.2, 10],
  'tomato': [18, 0.9, 3.9, 0.2, 1.2, 100],
  'potato': [77, 2.0, 17, 0.1, 2.2, 150],
  'carrot': [41, 0.9, 9.6, 0.2, 2.8, 80],
  'beans': [31, 1.8, 7.0, 0.2, 2.7],
  'long beans': [47, 2.8, 8.4, 0.4, 3.6],
  'cabbage': [25, 1.3, 5.8, 0.1, 2.5, 900],
  'cauliflower': [25, 1.9, 5.0, 0.3, 2.0, 600],
  'peas': [81, 5.4, 14.5, 0.4, 5.1],
  'drumstick': [37, 2.1, 8.5, 0.2, 3.2, 60],
  'raw banana': [110, 1.3, 27, 0.3, 2.3, 150],
  'yam': [118, 1.5, 28, 0.2, 4.0],
  'tapioca': [160, 1.4, 38, 0.3, 1.8],
  'sweet potato': [86, 1.6, 20, 0.1, 3.0, 150],
  'capsicum': [26, 1.0, 6.0, 0.3, 2.0, 120],
  'brinjal': [25, 1.0, 6.0, 0.2, 3.0, 100],
  'ladies finger': [33, 1.9, 7.5, 0.2, 3.2],
  'cucumber': [15, 0.7, 3.6, 0.1, 0.5, 200],
  'pumpkin': [26, 1.0, 6.5, 0.1, 0.5],
  'ash gourd': [13, 0.4, 3.0, 0.1, 0.8],
  'bitter gourd': [17, 1.0, 3.7, 0.2, 2.8, 100],
  'snake gourd': [18, 0.5, 3.3, 0.3, 0.8],
  'beetroot': [43, 1.6, 9.6, 0.2, 2.8, 120],
  'spinach': [23, 2.9, 3.6, 0.4, 2.2, null, 250],
  'mushroom': [22, 3.1, 3.3, 0.3, 1.0, null, 200],
  'colocasia': [112, 1.5, 26, 0.2, 4.1],
  'green chilli': [40, 2.0, 9.0, 0.2, 1.5, 5],
  'ginger': [80, 1.8, 18, 0.8, 2.0],
  'garlic': [149, 6.4, 33, 0.5, 2.1],
  'curry leaves': [108, 6.0, 18, 1.0, 6.0, null, 10],
  'coriander leaves': [23, 2.1, 3.7, 0.5, 2.8, null, 50],
  'mint': [44, 3.3, 8.4, 0.7, 6.8, null, 30],
  'lemon': [29, 1.1, 9.0, 0.3, 2.8, 50],
  // Fruits
  'banana': [89, 1.1, 23, 0.3, 2.6, 100],
  'nendran banana': [116, 1.2, 28, 0.3, 2.5, 180],
  'apple': [52, 0.3, 14, 0.2, 2.4, 180],
  'orange': [47, 0.9, 12, 0.1, 2.4, 150],
  'mango': [60, 0.8, 15, 0.4, 1.6, 250],
  'papaya': [43, 0.5, 11, 0.3, 1.7, 1000],
  'grapes': [69, 0.7, 18, 0.2, 0.9],
  'guava': [68, 2.6, 14, 1.0, 5.4, 120],
  // Oils, coconut & essentials
  'coconut': [354, 3.3, 15.2, 33.5, 9.0, 250],
  'coconut oil': [884, 0, 0, 100, 0, null, null, 0.92],
  'sunflower oil': [884, 0, 0, 100, 0, null, null, 0.92],
  'gingelly oil': [884, 0, 0, 100, 0, null, null, 0.92],
  'mustard oil': [884, 0, 0, 100, 0, null, null, 0.92],
  'oil': [884, 0, 0, 100, 0, null, null, 0.92],
  'sugar': [387, 0, 100, 0, 0],
  'jaggery': [383, 0.4, 98, 0.1, 0],
  'honey': [304, 0.3, 82, 0, 0],
  'pappadam': [450, 18, 45, 22, 8, 8, 100],
  'tamarind': [239, 2.8, 62, 0.6, 5.0],
  // Spices (small amounts, still counted)
  'sambar powder': [330, 12, 50, 8, 18],
  'rasam powder': [330, 12, 50, 8, 18],
  'chilli powder': [280, 12, 50, 10, 30],
  'kashmiri chilli powder': [280, 12, 50, 10, 30],
  'turmeric powder': [312, 9.7, 67, 3.3, 22],
  'coriander powder': [298, 12, 55, 18, 42],
  'garam masala': [380, 14, 50, 15, 25],
  'chicken masala': [380, 14, 50, 15, 25],
  'fish masala': [380, 14, 50, 15, 25],
  'pepper': [251, 10, 64, 3.3, 25],
  'salt': [0, 0, 0, 0, 0],
};

export const NUTRIENTS = [
  { k: 'kcal', label: 'Energy', unit: 'kcal' },
  { k: 'protein', label: 'Protein', unit: 'g' },
  { k: 'carbs', label: 'Carbs', unit: 'g' },
  { k: 'fat', label: 'Fat', unit: 'g' },
  { k: 'fibre', label: 'Fibre', unit: 'g' },
];

// A typical adult's day (ICMR-NIN 2020, moderately active). Used as a rough yardstick.
export const DAILY_GUIDE = { kcal: 2000, protein: 55, carbs: 270, fat: 60, fibre: 30 };
// Share of the day's food each meal usually carries.
export const SLOT_SHARE = { b: 0.25, l: 0.35, d: 0.3, s: 0.1 };

// Outside food: rough per-person estimates by how heavy the meal was.
export const OUTSIDE_KINDS = {
  restaurant: 'Restaurant',
  delivery: 'Delivery',
  snacks: 'Snacks & tea',
  canteen: 'Canteen / mess',
};
export const OUTSIDE_WEIGHT = { light: 'Light', regular: 'Regular', heavy: 'Heavy' };
const OUTSIDE_KCAL = { light: 450, regular: 750, heavy: 1100 };
const OUTSIDE_FAT_SHARE = { light: 0.3, regular: 0.35, heavy: 0.42 };

// Cooking oil most recipes leave out. Added only when a recipe lists no fat at all.
const COOKING_OIL_ML_PER_PERSON = 10;
const FATS = new Set(['oil', 'coconut oil', 'sunflower oil', 'gingelly oil', 'mustard oil', 'ghee', 'butter']);

const zero = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 });
const addInto = (a, b, f = 1) => { for (const n of NUTRIENTS) a[n.k] += (b[n.k] || 0) * f; return a; };

/** Nutrition row for an ingredient name, or null if unknown. */
export function lookup(name) {
  const k = key(name).replace(/\s+/g, ' ');
  if (T[k]) return { name: k, v: T[k] };
  const singular = k.replace(/(es|s)$/, '');
  if (T[singular]) return { name: singular, v: T[singular] };
  const cat = matchCatalog(name);
  const ck = cat && key(cat.name);
  return ck && T[ck] ? { name: ck, v: T[ck] } : null;
}

/** Edible grams for a quantity, or null when the unit can't be turned into weight. */
export function grams(row, qty, unit) {
  if (qty == null || !(qty > 0)) return null;
  const [, , , , , perPiece, perPacket, density = 1] = row.v;
  switch (String(unit || '').toLowerCase()) {
    case 'g': return qty;
    case 'kg': return qty * 1000;
    case 'ml': return qty * density;
    case 'l': return qty * 1000 * density;
    case 'pcs': case '': return perPiece ? qty * perPiece : null;
    case 'dozen': return perPiece ? qty * 12 * perPiece : null;
    case 'pkt': return perPacket ? qty * perPacket : null;
    default: return null;
  }
}

/** Nutrition of one ingredient amount. */
export function ingredientNutrition({ name, qty, unit }) {
  const row = lookup(name);
  if (!row) return null;
  const g = grams(row, qty, unit);
  if (g == null) return null;
  const [kcal, protein, carbs, fat, fibre] = row.v;
  const f = g / 100;
  return { kcal: kcal * f, protein: protein * f, carbs: carbs * f, fat: fat * f, fibre: fibre * f };
}

/**
 * Nutrition for a recipe cooked for `people`.
 * Returns { total, perPerson, counted, missing: [names], oilAdded }.
 */
export function recipeNutrition(r, people) {
  const total = zero();
  const missing = [];
  let counted = 0, hasFat = false;
  for (const ing of scaled(r, people)) {
    const n = ingredientNutrition(ing);
    if (lookup(ing.name) && FATS.has(lookup(ing.name).name)) hasFat = true;
    if (n) { addInto(total, n); counted++; } else missing.push(ing.name);
  }
  const oilAdded = counted > 0 && !hasFat;
  if (oilAdded) addInto(total, ingredientNutrition({ name: 'oil', qty: COOKING_OIL_ML_PER_PERSON * people, unit: 'ml' }));
  const perPerson = addInto(zero(), total, 1 / Math.max(1, people));
  return { total, perPerson, counted, missing, oilAdded };
}

/** Estimated nutrition for food eaten outside. */
export function outsideNutrition(o) {
  const per = OUTSIDE_KCAL[o.weight] || OUTSIDE_KCAL.regular;
  const kcal = per * (o.slot === 's' ? 0.45 : 1) * Math.max(1, o.people || 1);
  const fatShare = OUTSIDE_FAT_SHARE[o.weight] || 0.35;
  return {
    kcal,
    protein: (kcal * 0.13) / 4,
    fat: (kcal * fatShare) / 9,
    carbs: (kcal * (1 - 0.13 - fatShare)) / 4,
    fibre: (kcal / 1000) * 6,
  };
}

// ---------- Weeks ----------
/** Monday of the week containing `date`. */
export function weekStart(date = today()) {
  const d = new Date(date + 'T12:00');
  const back = (d.getDay() + 6) % 7;
  return addDays(date, -back);
}

const inRange = (date, from, to) => date >= from && date <= to;
const isoOfMs = (ms) => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/** Grocery spend between two dates: bills, plus priced purchases not on any bill. */
export function grocerySpend(s, from, to) {
  const bills = s.bills.filter((b) => inRange(b.date, from, to)).reduce((a, b) => a + (+b.total || 0), 0);
  const loose = s.bought.filter((b) => b.bill === null && b.price > 0 && inRange(isoOfMs(b.at), from, to)).reduce((a, b) => a + b.price, 0);
  return bills + loose;
}

export function outsideSpend(s, from, to) {
  return (s.outside || []).filter((o) => inRange(o.date, from, to)).reduce((a, o) => a + (+o.amount || 0), 0);
}

/**
 * Everything the Week screen shows for the 7 days from `from` (a Monday).
 * Only days up to today count as eaten.
 */
export function weekSummary(s, from) {
  const to = addDays(from, 6);
  const last = to < today() ? to : today();
  const home = zero(), out = zero(), guide = zero();
  const days = [];
  let homeMeals = 0, outMeals = 0, unknownMeals = 0, emptySlots = 0, oilAdded = false;
  const missing = new Set();
  const outside = (s.outside || []).filter((o) => inRange(o.date, from, to));

  for (let i = 0; i < 7; i++) {
    const date = addDays(from, i);
    const day = { date, home: 0, out: 0, future: date > last };
    if (!day.future) {
      for (const slot of ['b', 'l', 'd']) {
        const ate = outside.filter((o) => o.date === date && o.slot === slot);
        const m = mealAt(s, date, slot);
        if (ate.length) {
          for (const o of ate) {
            const n = outsideNutrition(o);
            addInto(out, n); day.out += n.kcal;
            addInto(guide, DAILY_GUIDE, SLOT_SHARE[slot] * Math.max(1, o.people || 1));
          }
          outMeals++;
          continue;
        }
        const r = m && recipe(s, m.rid);
        if (!r) { emptySlots++; continue; }
        const n = recipeNutrition(r, m.people);
        if (!n.counted) { unknownMeals++; continue; }
        n.missing.forEach((x) => missing.add(x));
        oilAdded ||= n.oilAdded;
        addInto(home, n.total); day.home += n.total.kcal;
        addInto(guide, DAILY_GUIDE, SLOT_SHARE[slot] * m.people);
        homeMeals++;
      }
      for (const o of outside.filter((x) => x.date === date && x.slot === 's')) {
        const n = outsideNutrition(o);
        addInto(out, n); day.out += n.kcal;
        addInto(guide, DAILY_GUIDE, SLOT_SHARE.s * Math.max(1, o.people || 1));
      }
    }
    days.push(day);
  }

  const total = addInto(addInto(zero(), home), out);
  const groceries = grocerySpend(s, from, to);
  const outsideAmt = outsideSpend(s, from, to);
  const byKind = {};
  for (const o of outside) {
    const k = byKind[o.kind] ||= { amount: 0, count: 0 };
    k.amount += +o.amount || 0; k.count++;
  }
  const eatenDays = days.filter((d) => !d.future).length;
  return {
    from, to, days, total, home, out, guide,
    homeMeals, outMeals, unknownMeals, emptySlots,
    slots: eatenDays * 3,
    missing: [...missing], oilAdded,
    spend: { groceries, outside: outsideAmt, total: groceries + outsideAmt, byKind },
    outside: [...outside].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at),
  };
}

/** How a nutrient compares to the guide for the meals recorded. */
export function status(k, value, guide) {
  if (!guide) return { pct: 0, label: '—', tone: 'none' };
  const pct = Math.round((value / guide) * 100);
  const limit = k === 'kcal' || k === 'fat' || k === 'carbs'; // too much is a concern
  if (pct < 75) return { pct, label: 'Low', tone: 'low' };
  if (limit && pct > 120) return { pct, label: 'High', tone: 'high' };
  return { pct, label: 'On track', tone: 'ok' };
}

/** One plain tip for the week, or null. */
export function weekTip(sum) {
  if (!sum.homeMeals && !sum.outMeals) return null;
  const st = (k) => status(k, sum.total[k], sum.guide[k]);
  const share = sum.spend.total ? sum.spend.outside / sum.spend.total : 0;
  if (st('protein').tone === 'low') return 'Protein is low. Add dal, eggs, chana, fish or paneer to two or three more meals.';
  if (st('fibre').tone === 'low') return 'Fibre is low. Add a thoran, whole gram, or more vegetables to the week.';
  if (st('fat').tone === 'high') return 'Fat is high this week. Fewer fried dishes or less oil would balance it.';
  if (share > 0.4) return `${Math.round(share * 100)}% of food money went outside home this week.`;
  return null;
}

export const round = (n) => Math.round(n || 0);
