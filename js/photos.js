// Plate photos for dishes: six stock photos, plus a family's own photo of any dish.
// Own photos are shrunk to a 600px square, gently brightened, and kept on this phone
// (localStorage). In a home shared with family, they are also uploaded so every phone
// shows them: the recipe carries photo: { v } and other phones fetch that version once.

const STOCK = 'img/dishes/';
const SIZE = 600;
// First match wins. Meat and egg dishes skip the rice and dal photo so a chicken curry
// never shows up as dal; they fall back to an emoji plate instead.
const MATCH = [
  [/biryani|fried rice/, 'biryani'],
  [/chicken|mutton|beef|prawn|egg|omelette/, null],
  [/fish|meen|sardine|mathi/, 'fish'],
  [/dosa|idli/, 'dosa'],
  [/idiyappam|appam/, 'appam'],
  [/chapati|paratha|porotta|roti/, 'chapati'],
  [/rice|dal|parippu|sambar|rasam|khichdi|kanji|chawal/, 'ricedal'],
];
export const STOCK_PHOTOS = ['appam', 'biryani', 'chapati', 'dosa', 'fish', 'ricedal'];

/** The stock photo for a dish name, or '' when none fits. */
export function stockPhoto(name) {
  const n = String(name || '').toLowerCase();
  const hit = MATCH.find(([re]) => re.test(n));
  return hit?.[1] ? `${STOCK}${hit[1]}.webp` : '';
}

const KEY = (rid) => `homzy:photo:${rid}`;
const VER = (rid) => `homzy:photo-v:${rid}`;
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const MEM = new Map(); // photos that didn't fit in storage: kept for this session only

/** The family's own photo of this dish, if they took one. */
export function ownPhoto(rid) {
  if (!rid) return '';
  if (MEM.has(rid)) return MEM.get(rid);
  try { return store()?.getItem(KEY(rid)) || ''; } catch { return ''; }
}

/** The photo to show for a recipe: theirs first, then stock. */
export function dishPhoto(r) {
  return r ? ownPhoto(r.id) || stockPhoto(r.name) : '';
}

/** Does this dish have the family's own photo? */
export const hasOwnPhoto = (r) => !!(r && ownPhoto(r.id));

const loadImage = (src) => new Promise((ok, fail) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = fail;
  i.src = src;
});

/** Square-crop, shrink and lightly brighten a picked image. Returns a data URL (webp, or jpeg on Safari). */
export async function preparePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.min(SIZE, side);
    const c = document.createElement('canvas');
    c.width = c.height = out;
    const ctx = c.getContext('2d');
    // Food looks better a little brighter and warmer. Browsers without canvas filters just skip this.
    ctx.filter = 'brightness(1.05) contrast(1.08) saturate(1.15)';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    let data = c.toDataURL('image/webp', 0.8);
    if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.82); // Safari can't write webp
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Keep a prepared photo for a dish on this phone. `v` is the shared version, if it came from or went to the family. */
export function keepPhoto(rid, data, v = null) {
  const st = store();
  try {
    st?.setItem(KEY(rid), data);
    if (v != null) st?.setItem(VER(rid), String(v)); else st?.removeItem(VER(rid));
    MEM.delete(rid);
  } catch {
    MEM.set(rid, data); // phone storage is full: still show it this session
  }
}

/** Shrink a picked image and keep it for this dish. Returns the data URL. */
export async function saveOwnPhoto(rid, file) {
  const data = await preparePhoto(file);
  keepPhoto(rid, data);
  return data;
}

export function removeOwnPhoto(rid) {
  MEM.delete(rid);
  try { store()?.removeItem(KEY(rid)); store()?.removeItem(VER(rid)); } catch { /* private mode */ }
}

/** The shared version of the photo this phone has for a dish, or null. */
export function photoVersion(rid) {
  try { const v = store()?.getItem(VER(rid)); return v ? +v : null; } catch { return null; }
}

export function dataToBlob(data) {
  const [head, b64] = data.split(',');
  const type = head.match(/data:([^;]+)/)?.[1] || 'image/webp';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const blobToData = (blob) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = fail;
  r.readAsDataURL(blob);
});

let fetching = new Set();
/**
 * Bring this phone's photos in step with the family's recipes. `download(rid)` returns a Blob.
 * Returns true when something changed (so the screen can redraw).
 */
export async function syncPhotos(recipes, download) {
  let changed = false;
  for (const r of recipes) {
    const v = r.photo?.v ?? null;
    const have = photoVersion(r.id);
    if (v == null) {
      // Someone removed the family photo: drop our copy of it (photos only on this phone stay).
      if (have != null) { removeOwnPhoto(r.id); changed = true; }
      continue;
    }
    if (have === v || fetching.has(r.id)) continue;
    fetching.add(r.id);
    try {
      const data = await blobToData(await download(r.id));
      if (String(data).startsWith('data:image/')) { keepPhoto(r.id, data, v); changed = true; }
    } catch { /* try again next time */ } finally {
      fetching.delete(r.id);
    }
  }
  return changed;
}
