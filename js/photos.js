// Plate photos for dishes: six stock photos, plus a family's own photo of any dish.
// Own photos stay on this phone (localStorage), shrunk to a 480px square so they stay small.

const STOCK = 'img/dishes/';
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
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** The family's own photo of this dish, if they took one. */
export function ownPhoto(rid) {
  try { return (rid && store()?.getItem(KEY(rid))) || ''; } catch { return ''; }
}

/** The photo to show for a recipe: theirs first, then stock. */
export function dishPhoto(r) {
  return r ? ownPhoto(r.id) || stockPhoto(r.name) : '';
}

/** Shrink a picked image to a 480px square (centre crop) and keep it for this dish. */
export async function saveOwnPhoto(rid, file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = 480;
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 480, 480);
    let data = c.toDataURL('image/webp', 0.8);
    if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.8); // Safari can't write webp
    store()?.setItem(KEY(rid), data);
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function removeOwnPhoto(rid) {
  try { store()?.removeItem(KEY(rid)); } catch { /* private mode */ }
}
