// A tiny in-memory stand-in for the parts of Supabase that Homzy uses, for local
// testing only (npm start with MOCK_SUPABASE=1). The sign-in code is always 123456.
// It mirrors the rules in supabase/schema.sql; the real rules are what protect data.
import crypto from 'node:crypto';

const users = new Map();     // email → { id, email }
const households = new Map(); // id → { id, name, data, rev }
const members = [];          // { household_id, user_id, role, member_id, email, joined_at }
const invites = new Map();   // code → { code, household_id, role, member_id, expires_at, used_at, created_at }
const CODE = '123456';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const mine = (uid) => members.find((m) => m.user_id === uid);
const roleIn = (uid, hid) => members.find((m) => m.user_id === uid && m.household_id === hid)?.role || null;
const ownerOf = (uid) => { const m = mine(uid); if (!m || m.role !== 'owner') throw fail('not_owner'); return m.household_id; };
const pick = (row, select) => (select ? Object.fromEntries(select.split(',').map((k) => [k, row[k]])) : row);
const session = (u) => ({
  access_token: 'mock.' + u.id, refresh_token: 'r.' + u.id + '.' + crypto.randomUUID(),
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: u,
});

const RPC = {
  my_household(uid) {
    const m = mine(uid);
    if (!m) return null;
    const h = households.get(m.household_id);
    return { household_id: h.id, name: h.name, rev: h.rev, role: m.role, member_id: m.member_id };
  },
  create_household(uid, { p_name, p_data, p_member_id }, email) {
    if (mine(uid)) throw fail('already_in_household');
    const h = { id: crypto.randomUUID(), name: p_name || 'Our home', data: p_data || {}, rev: 1 };
    households.set(h.id, h);
    members.push({ household_id: h.id, user_id: uid, role: 'owner', member_id: p_member_id, email, joined_at: new Date().toISOString() });
    return { household_id: h.id, rev: 1, role: 'owner', member_id: p_member_id };
  },
  create_invite(uid, { p_role, p_member_id }) {
    const hid = ownerOf(uid);
    if (!['editor', 'viewer'].includes(p_role)) throw fail('bad_role');
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = [...crypto.randomBytes(8)].map((b) => abc[b % 32]).join('');
    invites.set(code, { code, household_id: hid, role: p_role, member_id: p_member_id, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), used_at: null });
    return code;
  },
  join_household(uid, { p_code }, email) {
    const inv = invites.get(String(p_code || '').trim().toUpperCase());
    if (!inv) throw fail('invite_not_found');
    const m = mine(uid);
    if (m) {
      if (m.household_id === inv.household_id) return { household_id: m.household_id, role: m.role, member_id: m.member_id };
      throw fail('already_in_household');
    }
    if (inv.used_at) throw fail('invite_used');
    if (new Date(inv.expires_at) < new Date()) throw fail('invite_expired');
    members.push({ household_id: inv.household_id, user_id: uid, role: inv.role, member_id: inv.member_id, email, joined_at: new Date().toISOString() });
    inv.used_at = new Date().toISOString();
    return { household_id: inv.household_id, role: inv.role, member_id: inv.member_id };
  },
  set_my_member(uid, { p_member_id }) { const m = mine(uid); if (m) m.member_id = p_member_id; return null; },
  set_member_role(uid, { p_user, p_role }) {
    const hid = ownerOf(uid);
    const m = members.find((x) => x.household_id === hid && x.user_id === p_user && x.role !== 'owner');
    if (!m) throw fail('not_found');
    m.role = p_role;
    return null;
  },
  remove_member(uid, { p_user }) {
    const hid = ownerOf(uid);
    const i = members.findIndex((x) => x.household_id === hid && x.user_id === p_user && x.role !== 'owner');
    if (i < 0) throw fail('not_found');
    members.splice(i, 1);
    return null;
  },
  revoke_invite(uid, { p_code }) { const hid = ownerOf(uid); const inv = invites.get(p_code); if (inv?.household_id === hid) invites.delete(p_code); return null; },
  leave_household(uid) {
    const i = members.findIndex((x) => x.user_id === uid && x.role !== 'owner');
    if (i < 0) throw fail('owner_cannot_leave');
    members.splice(i, 1);
    return null;
  },
  delete_household(uid) {
    const hid = ownerOf(uid);
    households.delete(hid);
    for (let i = members.length - 1; i >= 0; i--) if (members[i].household_id === hid) members.splice(i, 1);
    for (const [c, inv] of invites) if (inv.household_id === hid) invites.delete(c);
    return null;
  },
};

/** Handles a request under /__mock_supabase. Returns true if it answered. */
export function mockSupabase(req, res, url, raw) {
  const path = url.pathname.replace(/^\/__mock_supabase/, '');
  const body = raw ? JSON.parse(raw) : {};
  const send = (status, obj) => {
    res.statusCode = status;
    if (obj === undefined) return res.end();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const me = [...users.values()].find((u) => 'mock.' + u.id === bearer) || null;
  const q = (k) => url.searchParams.get(k)?.replace(/^(eq|gt)\./, '');

  try {
    if (path === '/auth/v1/otp') { console.log(`[mock supabase] sign-in code for ${body.email}: ${CODE}`); return send(200, {}); }
    if (path === '/auth/v1/verify') {
      if (body.token !== CODE) return send(403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      const email = String(body.email).toLowerCase();
      if (!users.has(email)) users.set(email, { id: crypto.randomUUID(), email });
      return send(200, session(users.get(email)));
    }
    if (path === '/auth/v1/token') {
      const id = String(body.refresh_token || '').split('.')[1];
      const u = [...users.values()].find((x) => x.id === id);
      return u ? send(200, session(u)) : send(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    }
    if (path === '/auth/v1/logout') return send(204);
    if (!me) return send(401, { message: 'JWT expired', code: 'PGRST301' });
    if (path === '/auth/v1/user') return send(200, me);

    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = RPC[path.slice('/rest/v1/rpc/'.length)];
      if (!fn) return send(404, { message: 'no such function' });
      return send(200, fn(me.id, body, me.email));
    }
    if (path === '/rest/v1/households') {
      const h = households.get(q('id'));
      const role = h && roleIn(me.id, h.id);
      if (req.method === 'GET') return send(200, h && role ? [pick(h, q('select'))] : []);
      if (req.method === 'PATCH') {
        if (!h || !['owner', 'editor'].includes(role) || String(h.rev) !== q('rev')) return send(200, []);
        h.data = body.data ?? h.data;
        if (body.name) h.name = body.name;
        h.rev += 1;
        console.log(`[mock supabase] ${me.email} saved rev ${h.rev}`);
        return send(200, [pick(h, q('select'))]);
      }
    }
    if (path === '/rest/v1/household_members') {
      const hid = q('household_id');
      return send(200, roleIn(me.id, hid) ? members.filter((m) => m.household_id === hid).map((m) => pick(m, q('select'))) : []);
    }
    if (path === '/rest/v1/household_invites') {
      const hid = q('household_id');
      if (roleIn(me.id, hid) !== 'owner') return send(200, []);
      return send(200, [...invites.values()].filter((i) => i.household_id === hid && !i.used_at && new Date(i.expires_at) > new Date()).map((i) => pick(i, q('select'))));
    }
    return send(404, { message: 'not mocked: ' + path });
  } catch (e) {
    return send(e.status || 400, { code: 'P0001', message: e.message });
  }
}
