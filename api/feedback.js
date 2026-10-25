// POST /api/feedback — checks a feedback message and stores it in Supabase.
// The Supabase secret key lives only in Vercel env vars; the browser never sees it.
// Env vars: see api/_lib.js.
import { text, int, rateLimiter, readPost, insertRow } from './_lib.js';

const KINDS = new Set(['idea', 'problem', 'praise', 'other']);
const MAX_BODY = 8_000; // bytes
const limited = rateLimiter({ windowMs: 10 * 60_000, max: 8 }); // per IP, per warm instance

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

export default async function handler(req, res) {
  const body = readPost(req, res, { maxBytes: MAX_BODY, limited });
  if (!body) return;
  const result = validate(body);
  if (result.spam) return res.status(201).json({ ok: true }); // look normal to bots
  if (result.error) return res.status(400).json({ error: result.error });
  return insertRow(res, 'feedback', { ...result.row, user_agent: text(req.headers['user-agent'], 300) }, 'feedback');
}
