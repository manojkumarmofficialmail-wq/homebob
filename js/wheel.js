// The dinner spinner: draws the wheel and works out where a spin stops.
// The pointer is at the top. Slice i runs clockwise from i*slice to (i+1)*slice degrees.

// Each dish sits on a white plate around a black disc; slices alternate two near-blacks.
const SLICE = ['#121212', '#1c1c1c', '#171717']; // the third shade is for an odd last slice
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s, n = 12) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

let clipSeq = 0;
/** SVG for the wheel. dishes: [{ name, emoji, photo? }], 2 to 8 of them. A photo fills the plate; otherwise the emoji sits on it. */
export function wheelSvg(dishes) {
  const cid = `wp${++clipSeq}`;
  const n = dishes.length, a = 360 / n, R = 150, rad = (d) => ((d - 90) * Math.PI) / 180;
  const pt = (r, d) => `${(R + r * Math.cos(rad(d))).toFixed(2)} ${(R + r * Math.sin(rad(d))).toFixed(2)}`;
  const plate = n > 6 ? 25 : 29;       // plate radius: smaller when the wheel is crowded
  const cy = 18 + plate;               // plate centre, measured from the rim
  const labelLen = n > 6 ? 9 : n > 4 ? 11 : 14;
  const slices = dishes.map((d, i) => {
    const from = i * a, to = from + a, mid = from + a / 2;
    const fill = SLICE[n % 2 && i === n - 1 && n > 1 ? 2 : i % 2];
    const path = n === 1 ? `<circle cx="${R}" cy="${R}" r="${R}" fill="${SLICE[0]}"/>`
      : `<path d="M${R} ${R} L${pt(R, from)} A${R} ${R} 0 ${a > 180 ? 1 : 0} 1 ${pt(R, to)} Z" fill="${fill}"/>`;
    // A plate near the rim with the dish on it, and the name just below, reading upright at the pointer.
    return `${path}
      <g transform="rotate(${mid} ${R} ${R})">
        <circle cx="${R}" cy="${cy + 3}" r="${plate}" fill="rgb(0 0 0 / 45%)"/>
        <circle cx="${R}" cy="${cy}" r="${plate}" fill="#f1f1ee"/>
        ${d.photo ? `<clipPath id="${cid}-${i}"><circle cx="${R}" cy="${cy}" r="${plate * 0.9}"/></clipPath>
        <image href="${esc(d.photo)}" x="${R - plate * 0.9}" y="${cy - plate * 0.9}" width="${plate * 1.8}" height="${plate * 1.8}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid}-${i})"/>`
    : `<circle cx="${R}" cy="${cy}" r="${plate * 0.74}" fill="#ffffff"/>
        <text x="${R}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(plate * 0.95)}">${d.emoji}</text>`}
        <text x="${R}" y="${cy + plate + 13}" text-anchor="middle" class="wheel-label">${esc(short(d.name, labelLen))}</text>
      </g>`;
  }).join('');
  const lines = n > 1 ? dishes.map((_, i) => `<path d="M${R} ${R} L${pt(R, i * a)}" stroke="#2a2a2a" stroke-width="1"/>`).join('') : '';
  return `<svg viewBox="0 0 300 300" role="img" aria-label="Wheel with ${n} dinners">${slices}${lines}
    <circle cx="${R}" cy="${R}" r="${R - 1.5}" fill="none" stroke="#2c2c2c" stroke-width="3"/></svg>`;
}

/**
 * The wheel's next rotation (degrees, always more than now) so that slice `index` stops under
 * the pointer, after a few full turns. `jitter` (-0.5…0.5) moves the stop within the slice.
 */
export function spinTo(current, index, n, { turns = 5, jitter = 0 } = {}) {
  const a = 360 / n;
  const target = ((360 - (index * a + a / 2 + jitter * a * 0.7)) % 360 + 360) % 360;
  const now = ((current % 360) + 360) % 360;
  return current + turns * 360 + ((target - now + 360) % 360);
}

/** Which slice is under the pointer at this rotation. */
export function sliceAt(rotation, n) {
  const a = 360 / n;
  const under = ((360 - (rotation % 360)) % 360 + 360) % 360;
  return Math.floor(under / a) % n;
}
