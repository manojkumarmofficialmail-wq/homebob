// Shared helpers for the API functions. Vercel doesn't publish files starting with "_".
//
// Env vars (Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL          https://<project>.supabase.co
//   SUPABASE_SECRET_KEY   secret key (sb_secret_…) or legacy service_role key
//   ALLOWED_ORIGINS       optional, comma-separated extra origins (e.g. a custom domain)

/** Trimmed text without control characters, cut to `max`, or null. */
export const text = (v, max) => {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return s ? s.slice(0, max) : null;
};

/** Whole number in [min, max], or null. */
export const int = (v, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** One value from an allowed list, or `fallback`. */
export const oneOf = (v, allowed, fallback = null) => (allowed.includes(v) ? v : fallback);

/** The allowed values in `v` (an array), without repeats. */
export const someOf = (v, allowed) => (Array.isArray(v) ? [...new Set(v.filter((x) => allowed.includes(x)))] : []);

/** Per-IP limiter for one warm instance: `limited(ip)` is true once `max` hits fall in the window. */
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(ip, list);
    if (hits.size > 5000) hits.clear(); // keep memory bounded
    return list.length > max;
  };
}

export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin requests from some browsers, or server tools
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  if (host === req.headers.host) return true;
  if (process.env.VERCEL_URL && host === process.env.VERCEL_URL) return true;
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return extra.includes(origin);
}

/**
 * The checks every JSON POST endpoint shares. Returns the parsed body, or null after
 * it has already sent an error response.
 */
export function readPost(req, res, { maxBytes, limited }) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return null;
  }
  if (!originAllowed(req)) { res.status(403).json({ error: 'Forbidden' }); return null; }
  if (!String(req.headers['content-type'] || '').includes('application/json')) { res.status(415).json({ error: 'Send JSON' }); return null; }
  if (+req.headers['content-length'] > maxBytes) { res.status(413).json({ error: 'Too large' }); return null; }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) { res.status(429).json({ error: 'Too many tries. Please try again later.' }); return null; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  return body ?? {};
}

/** Insert one row with the server's secret key. Sends the response itself. */
export async function insertRow(res, table, row, label) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`${label}: SUPABASE_URL or SUPABASE_SECRET_KEY is not set`);
    return res.status(503).json({ error: 'Not set up yet' });
  }
  const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  // Legacy service_role keys are JWTs and also go in Authorization. New sb_secret_ keys don't.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${table}`, {
      method: 'POST', headers, body: JSON.stringify(row), signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.error(`${label}: Supabase insert failed`, r.status, (await r.text()).slice(0, 300));
      return res.status(502).json({ error: 'Could not save' });
    }
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error(`${label}: Supabase unreachable`, err?.message);
    return res.status(502).json({ error: 'Could not save' });
  }
}
