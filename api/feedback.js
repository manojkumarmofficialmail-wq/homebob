// POST /api/feedback — checks a feedback message and stores it in Supabase.
// The Supabase secret key lives only in Vercel env vars; the browser never sees it.
//
// Env vars (Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL          https://<project>.supabase.co
//   SUPABASE_SECRET_KEY   secret key (sb_secret_…) or legacy service_role key
//   ALLOWED_ORIGINS       optional, comma-separated extra origins (e.g. a custom domain)

const KINDS = new Set(['idea', 'problem', 'praise', 'other']);
const MAX_BODY = 8_000; // bytes
const LIMIT = { windowMs: 10 * 60_000, max: 8 }; // per IP, per warm instance

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < LIMIT.windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return list.length > LIMIT.max;
}

const text = (v, max) => {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return s ? s.slice(0, max) : null;
};
const int = (v, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** Returns { row } or { error }. Exported for tests. */
export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
  if (body.website) return { spam: true }; // honeypot field, hidden from people
  const message = text(body.message, 2000);
  if (!message || message.length < 2) return { error: 'Message is required' };
  const kind = KINDS.has(body.kind) ? body.kind : 'other';
  return {
    row: {
      message,
      kind,
      rating: int(body.rating, 1, 5),
      contact: text(body.contact, 120),
      app_version: text(body.app_version, 20),
      screen: text(body.screen, 20),
      locale: text(body.locale, 20),
      platform: text(body.platform, 20),
      install_id: text(body.install_id, 64),
      household_size: int(body.household_size, 1, 30),
      members: int(body.members, 1, 30),
    },
  };
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin requests from some browsers, or server tools
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  if (host === req.headers.host) return true;
  if (process.env.VERCEL_URL && host === process.env.VERCEL_URL) return true;
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return extra.includes(origin);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!originAllowed(req)) return res.status(403).json({ error: 'Forbidden' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    return res.status(415).json({ error: 'Send JSON' });
  }
  if (+req.headers['content-length'] > MAX_BODY) return res.status(413).json({ error: 'Too large' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many messages. Try again later.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const result = validate(body);
  if (result.spam) return res.status(201).json({ ok: true }); // look normal to bots
  if (result.error) return res.status(400).json({ error: result.error });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('feedback: SUPABASE_URL or SUPABASE_SECRET_KEY is not set');
    return res.status(503).json({ error: 'Feedback is not set up yet' });
  }

  const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  // Legacy service_role keys are JWTs and also go in Authorization. New sb_secret_ keys don't.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...result.row, user_agent: text(req.headers['user-agent'], 300) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.error('feedback: Supabase insert failed', r.status, (await r.text()).slice(0, 300));
      return res.status(502).json({ error: 'Could not save feedback' });
    }
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('feedback: Supabase unreachable', err?.message);
    return res.status(502).json({ error: 'Could not save feedback' });
  }
}
