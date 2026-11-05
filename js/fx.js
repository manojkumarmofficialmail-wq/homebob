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

// ---------- Touch layer ----------
// Every tap on a button, link or form control: a ripple right where the finger landed
// and a short buzz. Buttons also press in (CSS, in css/homzy-motion.css).
const TAPPABLE = 'button, a, label, input, select, summary, [role="switch"]';
let taps = [];
document.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || !e.target.closest?.(TAPPABLE) || e.target.closest('[disabled]')) return;
  haptic('tap');
  const layer = document.getElementById('taps');
  if (!layer || reduced()) return;
  const spot = document.createElement('span');
  spot.className = 'tap-spot';
  spot.style.left = `${e.clientX}px`;
  spot.style.top = `${e.clientY}px`;
  spot.innerHTML = '<span class="hz-tapring"></span><span class="hz-tapdot"></span>';
  layer.append(spot);
  taps.push(spot);
  if (taps.length > 3) taps.shift().remove();
  setTimeout(() => { spot.remove(); taps = taps.filter((x) => x !== spot); }, 650);
}, { passive: true });

/** A number that counts up to its value (the money total, the week's calories). */
export function countUp(el, to, { ms = 1100, format = (n) => Math.round(n).toLocaleString('en-IN') } = {}) {
  if (!el) return;
  if (reduced() || !(to > 0)) { el.textContent = format(to || 0); return; }
  const start = performance.now();
  const step = (now) => {
    if (!el.isConnected) return;
    const k = Math.min(1, (now - start) / ms);
    el.textContent = format(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = format(0);
  requestAnimationFrame(step);
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
  enterTimer = setTimeout(() => main.classList.remove('entering'), 1600); // the slowest entrance (Week bars) is ~1.5s
}
/** Stop an entrance that is still running (another redraw came in). */
export function stopEnter(main) {
  clearTimeout(enterTimer);
  main.classList.remove('entering');
}

// ---------- Rows ----------
/** Ids of the rows on screen now, to spot new ones after the next redraw. */
export const rowIds = (root) => new Set([...root.querySelectorAll('.row[data-id], .tile[data-id]')].map((r) => r.dataset.id));

/** After a redraw, rows that weren't there before slide in with a soft highlight. */
export function markNew(root, before) {
  if (reduced()) return;
  for (const row of root.querySelectorAll('.row[data-id], .tile[data-id]')) {
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
    // The tick fills and the name is struck through, then the row slides off to the right.
    row.classList.add('is-done');
    await wait(260);
    await run(row, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(115%) rotate(4deg)' }], { duration: 420, easing: 'cubic-bezier(.6,0,.4,1)' });
  } else if (!row.classList.contains('swiped')) {
    const from = getComputedStyle(row).transform; // part-way through a swipe, start from there
    await run(row, [{ opacity: 1, transform: from === 'none' ? 'none' : from }, { opacity: 0, transform: 'translateX(-60%)' }], { duration: 180, easing: 'ease-in' });
  }
  if (!row.isConnected) return;
  const h = row.offsetHeight;
  row.style.overflow = 'hidden';
  await run(row, [{ height: h + 'px', minHeight: 0 }, { height: '0px', minHeight: 0, paddingTop: 0, paddingBottom: 0, borderBottomWidth: 0 }], { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

// ---------- Celebrations ----------
const COLORS = ['#8aa765', '#557330', '#c9dba8', '#111111', '#7b6cf6', '#4aa3df', '#a78bfa'];

/** A short burst of confetti from the top of the screen. Skipped for reduced motion. */
export function confetti({ count = 90, duration = 1600 } = {}) {
  if (reduced() || document.hidden) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  document.body.append(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const bits = Array.from({ length: count }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.5, y: H * 0.3 + (Math.random() - 0.5) * 60,
    vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 11 - 4,
    w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35,
    color: COLORS[(Math.random() * COLORS.length) | 0], round: Math.random() < 0.3,
  }));
  const start = performance.now();
  let last = start;
  const frame = (now) => {
    const dt = Math.min(2, (now - last) / 16.7); last = now;
    const left = 1 - (now - start) / duration;
    if (left <= 0) return c.remove();
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.min(1, left * 2.5);
    for (const b of bits) {
      b.vy += 0.32 * dt; b.vx *= 0.99; b.x += b.vx * dt; b.y += b.vy * dt; b.r += b.vr * dt;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.color;
      if (b.round) { ctx.beginPath(); ctx.arc(0, 0, b.h / 1.6, 0, 7); ctx.fill(); } else ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setTimeout(() => c.remove(), duration + 500); // if frames stop (phone locked)
}

let cheerTimer;
/** A big friendly message near the top ("Shopping done!"), with confetti and a buzz. */
export function cheer(emoji, text, sub = '') {
  document.querySelector('.cheer')?.remove();
  clearTimeout(cheerTimer);
  const el = document.createElement('div');
  el.className = 'cheer';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="cheer-emoji" aria-hidden="true">${emoji}</span><span><b></b><small></small></span>`;
  el.querySelector('b').textContent = text;
  el.querySelector('small').textContent = sub;
  if (!sub) el.querySelector('small').remove();
  document.body.append(el);
  confetti();
  haptic('success');
  cheerTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 2600);
}
