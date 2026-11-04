// Motion and touch feedback: screen entrances, rows that slide in and out, short vibrations.
// Only transform and opacity are animated (plus one quick height fold), so it stays smooth
// on low-cost phones. Everything is skipped when the phone asks for reduced motion.

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => motionQuery.matches;

const getPref = (k, d) => { try { return localStorage.getItem('homzy:' + k) || d; } catch { return d; } };

// ---------- Vibration ----------
const BUZZ = { tap: 8, success: [10, 40, 14], warn: 18 };
/** A short buzz on phones that support it (most Android phones; iPhones ignore it). */
export function haptic(kind = 'tap') {
  if (getPref('haptics', 'on') === 'off') return;
  try { navigator.vibrate?.(BUZZ[kind] ?? BUZZ.tap); } catch { /* not allowed here */ }
}

// ---------- Screen entrance ----------
let enterTimer;
/** Cards rise in one after another. Used on a tab change, not on every redraw. */
export function enter(main) {
  clearTimeout(enterTimer);
  main.classList.remove('entering');
  if (reduced()) return;
  [...main.children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 8)));
  void main.offsetWidth; // restart the animation
  main.classList.add('entering');
  enterTimer = setTimeout(() => main.classList.remove('entering'), 700);
}
/** Stop an entrance that is still running (another redraw came in). */
export function stopEnter(main) {
  clearTimeout(enterTimer);
  main.classList.remove('entering');
}

// ---------- Rows ----------
/** Ids of the rows on screen now, to spot new ones after the next redraw. */
export const rowIds = (root) => new Set([...root.querySelectorAll('.row[data-id]')].map((r) => r.dataset.id));

/** After a redraw, rows that weren't there before slide in with a soft highlight. */
export function markNew(root, before) {
  if (reduced()) return;
  for (const row of root.querySelectorAll('.row[data-id]')) {
    if (!before.has(row.dataset.id)) row.classList.add('is-new');
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Resolves when the animation ends, or shortly after it should have (hidden tabs pause
// animations, and the data change must still happen).
const run = (el, frames, opts) => {
  try {
    const a = el.animate(frames, { fill: 'forwards', ...opts });
    return Promise.race([a.finished.catch(() => {}), wait(opts.duration + 120)]);
  } catch { return Promise.resolve(); }
};

/**
 * Play a row's exit before the data changes.
 * kind 'done': the tick fills, the name is struck through, then the row slides right and folds.
 * kind 'delete': the row slides left and folds (if it was already swiped away, it just folds).
 */
export async function animateOut(row, kind = 'delete') {
  if (reduced() || !row.isConnected) return;
  row.classList.add('leaving');
  if (kind === 'done') {
    row.classList.add('is-done');
    await wait(200);
    await run(row, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px)' }], { duration: 160, easing: 'ease-in' });
  } else if (!row.classList.contains('swiped')) {
    const from = getComputedStyle(row).transform; // part-way through a swipe, start from there
    await run(row, [{ opacity: 1, transform: from === 'none' ? 'none' : from }, { opacity: 0, transform: 'translateX(-60%)' }], { duration: 180, easing: 'ease-in' });
  }
  if (!row.isConnected) return;
  const h = row.offsetHeight;
  row.style.overflow = 'hidden';
  await run(row, [{ height: h + 'px', minHeight: 0 }, { height: '0px', minHeight: 0, paddingTop: 0, paddingBottom: 0, borderBottomWidth: 0 }], { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
