// The dinner spinner: draws the wheel and works out where a spin stops.
// The pointer is at the top. Slice i runs clockwise from i*slice to (i+1)*slice degrees.

const COLORS = ['#e8572e', '#f4a12b', '#d63f6f', '#2f9e6b', '#3c7fd6', '#8a5cd6', '#e2732f', '#1f9aa8'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s, n = 12) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** SVG for the wheel. dishes: [{ name, emoji }], 2 to 8 of them. */
export function wheelSvg(dishes) {
  const n = dishes.length, a = 360 / n, R = 150, rad = (d) => ((d - 90) * Math.PI) / 180;
  const pt = (r, d) => `${(R + r * Math.cos(rad(d))).toFixed(2)} ${(R + r * Math.sin(rad(d))).toFixed(2)}`;
  const slices = dishes.map((d, i) => {
    const from = i * a, to = from + a, mid = from + a / 2;
    const path = n === 1 ? `<circle cx="${R}" cy="${R}" r="${R}" fill="${COLORS[0]}"/>`
      : `<path d="M${R} ${R} L${pt(R, from)} A${R} ${R} 0 ${a > 180 ? 1 : 0} 1 ${pt(R, to)} Z" fill="${COLORS[i % COLORS.length]}"/>`;
    // Text runs along the slice's middle line, from the rim towards the centre.
    return `${path}
      <g transform="rotate(${mid} ${R} ${R})">
        <text x="${R}" y="30" text-anchor="middle" font-size="22">${d.emoji}</text>
        <text x="${R}" y="46" text-anchor="start" dominant-baseline="middle" transform="rotate(90 ${R} 46)" class="wheel-label">${esc(short(d.name))}</text>
      </g>`;
  }).join('');
  return `<svg viewBox="0 0 300 300" role="img" aria-label="Wheel with ${n} dinners">${slices}
    <circle cx="${R}" cy="${R}" r="${R - 2}" fill="none" stroke="rgb(255 255 255 / 55%)" stroke-width="4"/></svg>`;
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
