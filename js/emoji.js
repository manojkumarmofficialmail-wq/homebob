// Food emoji for shopping items and dishes, and a colour per shopping category.
// Kept to emoji that older Android phones can show (Emoji 13 and earlier).
import { matchCatalog } from './parse.js';

const ITEM = {
  Onion: '🧅', 'Small onion': '🧅', Tomato: '🍅', Potato: '🥔', 'Sweet potato': '🍠', Tapioca: '🍠', Yam: '🍠', Colocasia: '🍠',
  'Green chilli': '🌶️', Capsicum: '🫑', Ginger: '🌿', Garlic: '🧄', 'Curry leaves': '🌿', 'Coriander leaves': '🌿', Mint: '🌿',
  Carrot: '🥕', Beans: '🥒', 'Long beans': '🥒', Cabbage: '🥬', Spinach: '🥬', Cauliflower: '🥦', Brinjal: '🍆',
  'Ladies finger': '🥒', Cucumber: '🥒', 'Snake gourd': '🥒', 'Bitter gourd': '🥒', 'Ash gourd': '🍈', Pumpkin: '🎃',
  Mushroom: '🍄', Peas: '🌱', Lemon: '🍋', Beetroot: '🍠', 'Raw banana': '🍌', Drumstick: '🥢',
  Banana: '🍌', 'Nendran banana': '🍌', Apple: '🍎', Orange: '🍊', Mango: '🥭', Grapes: '🍇', Papaya: '🍈', Pineapple: '🍍',
  Watermelon: '🍉', Pomegranate: '🍎', Guava: '🍐',
  Milk: '🥛', Curd: '🥛', Buttermilk: '🥛', Eggs: '🥚', Butter: '🧈', Ghee: '🧈', Paneer: '🧀', Cheese: '🧀',
  Rice: '🍚', 'Matta rice': '🍚', 'Basmati rice': '🍚', 'Raw rice': '🍚', Bread: '🍞', Coconut: '🥥', 'Coconut oil': '🥥',
  Fish: '🐟', Sardine: '🐟', Prawns: '🦐', Chicken: '🍗', Mutton: '🍖', Beef: '🥩',
  'Tea powder': '🍵', 'Coffee powder': '☕', Sugar: '🍬', Salt: '🧂', Honey: '🍯', Noodles: '🍜', Biscuits: '🍪',
  'Dosa batter': '🥞', Pappadam: '🍘',
};

const CAT = {
  Vegetables: ['🥬', 120], Fruits: ['🍎', 350], 'Dairy & eggs': ['🥛', 205], 'Grains & flour': ['🌾', 40],
  Pulses: ['🥜', 25], 'Spices & masala': ['🌶️', 8], 'Oil & essentials': ['🧂', 48], 'Meat & fish': ['🍗', 0],
  'Bakery & snacks': ['🍪', 30], Drinks: ['🧃', 190], Household: ['🧽', 260], 'Personal care': ['🧴', 300], Other: ['🛒', 220],
};

/** { e: emoji, h: hue } for a shopping item name, in any language the list understands. */
export function itemLook(name) {
  const hit = matchCatalog(name);
  const [catEmoji, h] = CAT[hit?.cat] || CAT.Other;
  return { e: (hit && ITEM[hit.name]) || catEmoji, h };
}

// First match wins: the main protein, then the bread or staple.
const DISH = [
  [/fish|meen|sardine|mathi/, '🐟'], [/prawn|chemmeen/, '🦐'], [/chicken/, '🍗'], [/beef|mutton/, '🍖'],
  [/omelette|egg/, '🍳'], [/noodle/, '🍜'], [/biryani|ghee rice/, '🍛'], [/fried rice/, '🍚'],
  [/dosa|appam/, '🥞'], [/idli|idiyappam|puttu/, '🍙'], [/chapati|paratha|porotta|roti|naan/, '🫓'],
  [/bread|toast|sandwich/, '🍞'], [/oats|porridge|kanji|khichdi|upma|poha/, '🥣'], [/paneer/, '🧀'],
  [/kappa|tapioca/, '🍠'], [/salad/, '🥗'], [/dal|sambar|rasam|parippu|rajma|chana|kurma|stew|curry/, '🍲'],
  [/rice/, '🍚'],
];
const DISH_HUES = [14, 35, 330, 160, 205, 270, 48, 190];

/** Emoji for a dish name, e.g. "Rice + fish curry" → 🐟. */
export function dishEmoji(name) {
  const n = String(name || '').toLowerCase();
  return DISH.find(([re]) => re.test(n))?.[1] || '🍛';
}
/** A steady colour per dish, so the same dish always looks the same. */
export function dishHue(name) {
  let x = 0;
  for (const c of String(name || '')) x = (x * 31 + c.codePointAt(0)) >>> 0;
  return DISH_HUES[x % DISH_HUES.length];
}
