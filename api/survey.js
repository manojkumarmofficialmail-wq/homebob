// POST /api/survey — checks one family's survey answers and stores them in Supabase
// (table survey_responses in supabase/schema.sql). Env vars: see api/_lib.js.
import { text, int, oneOf, someOf, rateLimiter, readPost, insertRow } from './_lib.js';
import { FEATURES, RATING, USED, SIZES, PLANNER, LANGS, TODAY, PRICE } from '../js/survey-data.js';

const MAX_BODY = 12_000; // bytes
const limited = rateLimiter({ windowMs: 60 * 60_000, max: 5 }); // per IP per hour, per warm instance
const keys = (o) => Object.keys(o);
const FEATURE_IDS = FEATURES.map((f) => f.id);

/** Returns { row } or { error } or { spam }. Exported for tests. */
export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
  if (body.website) return { spam: true }; // honeypot field, hidden from people
  const ratings = {};
  if (body.ratings && typeof body.ratings === 'object') {
    for (const id of FEATURE_IDS) {
      const r = oneOf(body.ratings[id], keys(RATING));
      if (r) ratings[id] = r;
    }
  }
  const row = {
    used_app: oneOf(body.used_app, keys(USED)),
    household_size: oneOf(body.household_size, SIZES),
    planner: oneOf(body.planner, keys(PLANNER)),
    languages: someOf(body.languages, keys(LANGS)),
    city: text(body.city, 60),
    ratings,
    favourite: oneOf(body.favourite, FEATURE_IDS),
    today_methods: someOf(body.today_methods, keys(TODAY)),
    missing: text(body.missing, 1500),
    confusing: text(body.confusing, 1500),
    price: oneOf(body.price, keys(PRICE)),
    recommend: int(body.recommend, 0, 10),
    contact: text(body.contact, 120),
    app_version: text(body.app_version, 20),
    install_id: text(body.install_id, 64),
    locale: text(body.locale, 20),
  };
  const answered = Object.keys(ratings).length + (row.recommend != null) + !!row.missing + !!row.favourite + !!row.used_app;
  if (!answered) return { error: 'Please answer at least one question' };
  return { row };
}

export default async function handler(req, res) {
  const body = readPost(req, res, { maxBytes: MAX_BODY, limited });
  if (!body) return;
  const result = validate(body);
  if (result.spam) return res.status(201).json({ ok: true }); // look normal to bots
  if (result.error) return res.status(400).json({ error: result.error });
  return insertRow(res, 'survey_responses', { ...result.row, user_agent: text(req.headers['user-agent'], 300) }, 'survey');
}
