// GET /api/config — tells the app where family sync lives.
// The publishable (anon) key is meant to be public: row-level security in
// supabase/schema.sql decides what each signed-in person can see.
//
// Env vars:
//   SUPABASE_URL               https://<project>.supabase.co
//   SUPABASE_PUBLISHABLE_KEY   publishable key (sb_publishable_…) or legacy anon key

/** Returns the key only if it is safe to show in a browser. Exported for tests. */
export function publicKey(key) {
  if (!key) return null;
  if (key.startsWith('sb_secret_')) return null;
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
      if (payload.role !== 'anon') return null; // a service_role key must never reach the browser
    } catch { return null; }
  }
  return key;
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const raw = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  const key = publicKey(raw);
  if (raw && !key) console.error('SUPABASE_PUBLISHABLE_KEY looks like a secret key. Family sync is off until it is replaced with the publishable key.');
  if (!url || !key) return res.status(200).json({ sync: false });
  return res.status(200).json({ sync: true, url, key });
}
