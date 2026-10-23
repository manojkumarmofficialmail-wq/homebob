// All data lives in one JSON object in localStorage, on this device only.
const KEY = 'homzy:v1';
const VERSION = 1;

export const fresh = () => ({
  v: VERSION,
  home: 'Our home',
  lang: 'en-IN',
  list: [],    // { id, name, cat, qty, unit, at }
  stock: [],   // { id, name, cat, level: 'full' | 'low' | 'out', at }
  meals: {},   // { 'YYYY-MM-DD': { b, l, d } }
  tasks: [],   // { id, title, who, repeat: 'none' | 'daily' | 'weekly', due, done }
  bills: [],   // { id, date, shop, total, count }
  dishes: [],  // dish names the family typed in
});

function migrate(data) {
  // Future schema changes go here, keyed on data.v.
  return { ...fresh(), ...data, v: VERSION };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : fresh();
  } catch {
    return fresh();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function fromBackup(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.list) || !Array.isArray(data.stock)) {
    throw new Error('Not a Homzy backup');
  }
  return migrate(data);
}
