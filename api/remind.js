// GET /api/remind — the morning reminder. Vercel Cron calls it once a day (see vercel.json).
// For every home with phones that turned reminders on, it works out what needs doing today
// (bills due, gas to book, daily help to pay: digest() in js/money.js, the same maths the app uses)
// and sends each of those phones one notification.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SECRET_KEY   read homes and subscriptions (see api/_lib.js)
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  from `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT                        mailto: address push services can contact, e.g. mailto:you@example.com
//   CRON_SECRET                          any long random text; Vercel sends it with each cron call
import webpush from 'web-push';
import { digest } from '../js/money.js';

/** Today's date in India (YYYY-MM-DD), whatever time zone the server runs in. */
export const todayIST = (now = Date.now()) => new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);

function db(url, key) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // legacy service_role key
  const base = url.replace(/\/+$/, '') + '/rest/v1/';
  return async (path, opts = {}) => {
    const r = await fetch(base + path, { ...opts, headers: { ...headers, ...opts.headers }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
}

/**
 * Send today's reminders. `send(subscription, payload)` delivers one notification
 * (web-push in production, a fake in tests). Returns { homes, sent, removed, failed }.
 */
export async function sendReminders({ url, key, send, today = todayIST() }) {
  const q = db(url, key);
  const subs = (await q('push_subscriptions?select=endpoint,p256dh,auth,household_id,member_id')) || [];
  const byHome = new Map();
  for (const sub of subs) byHome.set(sub.household_id, [...(byHome.get(sub.household_id) || []), sub]);
  const out = { homes: 0, sent: 0, removed: 0, failed: 0 };
  if (!byHome.size) return out;
  const ids = [...byHome.keys()].map(encodeURIComponent).join(',');
  const homes = (await q(`households?id=in.(${ids})&select=id,name,data`)) || [];
  for (const h of homes) {
    const d = digest(h.data || {}, today);
    if (!d) continue;
    out.homes++;
    const payload = JSON.stringify({ title: d.title, body: d.body, url: '/?do=today', tag: `homzy-${today}` });
    for (const sub of byHome.get(h.id) || []) {
      try {
        await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        out.sent++;
      } catch (err) {
        // The phone uninstalled the app or turned notifications off: forget it.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await q(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }).catch(() => {});
          out.removed++;
        } else {
          out.failed++;
          console.error('remind: send failed', err?.statusCode, String(err?.body || err?.message).slice(0, 200));
        }
      }
    }
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET is not set' });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const { SUPABASE_URL: url, VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv } = process.env;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !pub || !priv) return res.status(503).json({ error: 'Reminders are not set up' });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@homzy.app', pub, priv);
  try {
    const out = await sendReminders({ url, key, send: (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 12 * 3600, urgency: 'normal' }) });
    console.log('remind:', JSON.stringify(out));
    return res.status(200).json(out);
  } catch (err) {
    console.error('remind: failed', err?.message);
    return res.status(502).json({ error: 'Could not send reminders' });
  }
}
