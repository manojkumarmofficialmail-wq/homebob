// Talks to Supabase: a private account for this phone, and the household database.
// No email or password: each phone gets its own anonymous Supabase account the first
// time it joins or shares a home, and keeps it on the phone.
// Uses plain fetch against Supabase's REST endpoints, so the app needs no extra library.
// The project URL and public (publishable) key come from /api/config.

const CONFIG = 'homzy:cloud-config';
const SESSION = 'homzy:session';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

export class CloudError extends Error {
  constructor(message, { status = 0, code = '', offline = false } = {}) {
    super(message);
    this.status = status; this.code = code; this.offline = offline;
  }
}

// ---------- Config ----------
let cfg = read(CONFIG);
let cfgChecked = false;

/** { url, key } when family sync is set up on the server, else null. Cached for offline use. */
export async function config() {
  if (cfgChecked) return cfg;
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (res.ok) {
      const j = await res.json();
      cfg = j.sync && j.url && j.key ? { url: j.url, key: j.key } : null;
      write(CONFIG, cfg);
      cfgChecked = true;
    }
  } catch { /* offline: keep the cached config */ }
  return cfg;
}
export const configured = () => !!cfg;

// ---------- Session ----------
let session = read(SESSION); // { access_token, refresh_token, expires_at, user: { id, email } }
const listeners = new Set();
export const onSignOut = (fn) => listeners.add(fn);

export const user = () => session?.user || null;
export const signedIn = () => !!session?.refresh_token;

function keep(j) {
  session = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user?.id, email: j.user?.email },
  };
  write(SESSION, session);
}

export function forget() {
  const had = !!session;
  session = null;
  write(SESSION, null);
  if (had) listeners.forEach((fn) => fn());
}

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const c = cfg || (await config());
  if (!c) throw new CloudError('Family sync isn’t set up on this site yet.', { code: 'not_configured' });
  let res;
  try {
    res = await fetch(c.url + path, {
      method,
      headers: {
        apikey: c.key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CloudError('You’re offline. Try again when you have internet.', { offline: true });
  }
  const text = await res.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = text; }
  if (!res.ok) {
    const code = j?.message || j?.error_code || j?.code || j?.error || '';
    throw new CloudError(friendly(code, j?.msg || j?.error_description || j?.message), { status: res.status, code });
  }
  return j;
}

const MESSAGES = {
  already_in_household: 'This phone is already connected to another Homzy home. Disconnect it there first.',
  invite_not_found: 'That QR code isn’t right, or it was cancelled. Ask for a new one.',
  invite_used: 'That QR code was already used. Ask for a new one.',
  invite_expired: 'That QR code has expired. Ask for a new one.',
  anonymous_provider_disabled: 'Family sync needs “Anonymous sign-ins” turned on in Supabase (Authentication → Sign In / Providers).',
  not_owner: 'Only the person who set up the home can do that.',
  owner_cannot_leave: 'You set up this home, so you can’t leave it. You can delete the online copy instead.',
  not_found: 'That person was already removed. Close this and open it again.',
  too_many_invites: 'You have 20 unused invites. Cancel some first.',
  over_request_rate_limit: 'Too many tries from this network. Please wait a few minutes.',
};
function friendly(code, fallback) {
  if (MESSAGES[code]) return MESSAGES[code];
  if (/anonymous sign-ins are disabled/i.test(fallback || '')) return MESSAGES.anonymous_provider_disabled;
  if (/rate limit/i.test(fallback || '')) return MESSAGES.over_request_rate_limit;
  return fallback || 'Something went wrong. Please try again.';
}

let refreshing = null;
async function refresh() {
  if (!session?.refresh_token) throw new CloudError('This phone isn’t connected any more.', { status: 401, code: 'signed_out' });
  refreshing ||= call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })
    .then(keep)
    .catch((e) => {
      if (!e.offline && e.status >= 400 && e.status < 500) forget(); // the sign-in was revoked or ran out
      throw e;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function token() {
  if (!session) throw new CloudError('This phone isn’t connected any more.', { status: 401, code: 'signed_out' });
  if (session.expires_at - 60 < Date.now() / 1000) await refresh();
  return session.access_token;
}

/** A request to the database as the signed-in person. Retries once after a fresh token. */
async function authed(path, opts = {}) {
  try {
    return await call(path, { ...opts, token: await token() });
  } catch (e) {
    if (e.status !== 401 || !session) throw e;
    await refresh();
    return call(path, { ...opts, token: session.access_token });
  }
}

// ---------- This phone's account ----------
/** Make sure this phone has its own (anonymous) account. Safe to call again. */
export async function ensureAccount() {
  if (signedIn()) return user();
  keep(await call('/auth/v1/signup', { method: 'POST', body: { data: {} } }));
  return user();
}

/** Forget this phone's account. Only used after leaving a home, so nothing is lost. */
export async function signOut() {
  try { if (session) await call('/auth/v1/logout', { method: 'POST', token: session.access_token }); } catch { /* still forget locally */ }
  forget();
}

// ---------- Database ----------
export const rpc = (name, args = {}) => authed(`/rest/v1/rpc/${name}`, { method: 'POST', body: args });

export async function getHousehold(id, fields = 'id,name,rev,data') {
  const rows = await authed(`/rest/v1/households?id=eq.${encodeURIComponent(id)}&select=${fields}`);
  return rows?.[0] || null;
}

/** Save only if nobody else saved since `rev`. Returns the new rev, or null on a clash. */
export async function putHousehold(id, rev, data, name) {
  const rows = await authed(`/rest/v1/households?id=eq.${encodeURIComponent(id)}&rev=eq.${rev}&select=rev`, {
    method: 'PATCH',
    body: { data, ...(name ? { name: String(name).slice(0, 60) } : {}) },
    headers: { Prefer: 'return=representation' },
  });
  return rows?.[0]?.rev ?? null;
}

export const listMembers = (hid) =>
  authed(`/rest/v1/household_members?household_id=eq.${encodeURIComponent(hid)}&select=user_id,role,member_id,email,joined_at&order=joined_at`);

export const listInvites = (hid) =>
  authed(`/rest/v1/household_invites?household_id=eq.${encodeURIComponent(hid)}&used_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=code,role,member_id,expires_at&order=created_at.desc`);
