-- Homzy database. Run in Supabase → SQL Editor → New query. Safe to run again
-- after an update: it only adds or replaces things, it never deletes data.
--
-- Part 1: feedback. The app never talks to this table directly: /api/feedback
-- (Vercel) inserts rows with the secret key, so no public access policies are needed.

create table if not exists public.feedback (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  kind           text not null default 'other' check (kind in ('idea', 'problem', 'praise', 'other')),
  rating         smallint check (rating between 1 and 5),
  message        text not null check (char_length(message) between 2 and 2000),
  contact        text check (char_length(contact) <= 120),
  app_version    text check (char_length(app_version) <= 20),
  screen         text check (char_length(screen) <= 20),
  locale         text check (char_length(locale) <= 20),
  platform       text check (char_length(platform) <= 20),
  install_id     text check (char_length(install_id) <= 64),
  household_size smallint check (household_size between 1 and 30),
  members        smallint check (members between 1 and 30),
  user_agent     text check (char_length(user_agent) <= 300),
  status         text not null default 'new' check (status in ('new', 'read', 'planned', 'done', 'ignored')),
  notes          text
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_status_idx on public.feedback (status);

-- Lock the table: with RLS on and no policies, the public anon key can't read or write.
-- The server's secret key bypasses RLS.
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- Weekly summary to read in the dashboard (Table Editor → feedback_weekly).
create or replace view public.feedback_weekly
with (security_invoker = true) as
select
  date_trunc('week', created_at)::date            as week,
  count(*)                                         as messages,
  round(avg(rating)::numeric, 2)                   as avg_rating,
  count(*) filter (where kind = 'problem')         as problems,
  count(*) filter (where kind = 'idea')            as ideas,
  count(*) filter (where kind = 'praise')          as praise,
  count(distinct install_id)                       as households
from public.feedback
group by 1
order by 1 desc;

revoke all on public.feedback_weekly from anon, authenticated;

-- =====================================================================
-- Part 2: family sync. Each home is one row in `households`. Family members
-- sign in with an email code and join with a private invite code.
-- Row-level security lets people see only the home they belong to, and only
-- owners and editors can change it.
-- =====================================================================

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Our home' check (char_length(name) between 1 and 60),
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 2000000),
  rev         bigint not null default 1,
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null unique references auth.users (id) on delete cascade, -- one home per account
  role         text not null check (role in ('owner', 'editor', 'viewer')),
  member_id    text check (char_length(member_id) <= 40), -- which person in the app this account is
  email        text check (char_length(email) <= 320),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists household_members_household_idx on public.household_members (household_id);

create table if not exists public.household_invites (
  code         text primary key check (code ~ '^[A-Z0-9]{8}$'),
  household_id uuid not null references public.households (id) on delete cascade,
  role         text not null check (role in ('editor', 'viewer')),
  member_id    text check (char_length(member_id) <= 40),
  created_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  used_by      uuid references auth.users (id) on delete set null,
  used_at      timestamptz
);
create index if not exists household_invites_household_idx on public.household_invites (household_id);

-- Your role in a home, or null. Used by the policies below.
create or replace function public.my_role(hid uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.household_members where household_id = hid and user_id = auth.uid()
$$;

-- Every save bumps `rev`, so two phones can't silently overwrite each other.
create or replace function public.households_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.rev := old.rev + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists households_touch on public.households;
create trigger households_touch before update on public.households
  for each row execute function public.households_touch();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

revoke all on public.households, public.household_members, public.household_invites from anon, authenticated;
grant select on public.households, public.household_members, public.household_invites to authenticated;
grant update (name, data) on public.households to authenticated;

drop policy if exists households_read on public.households;
create policy households_read on public.households for select to authenticated
  using (public.my_role(id) is not null);
drop policy if exists households_write on public.households;
create policy households_write on public.households for update to authenticated
  using (public.my_role(id) in ('owner', 'editor'))
  with check (public.my_role(id) in ('owner', 'editor'));
drop policy if exists members_read on public.household_members;
create policy members_read on public.household_members for select to authenticated
  using (public.my_role(household_id) is not null);
drop policy if exists invites_read on public.household_invites;
create policy invites_read on public.household_invites for select to authenticated
  using (public.my_role(household_id) = 'owner');

-- ---------- Actions the app calls (each checks who is asking) ----------

-- The home you belong to, or null.
create or replace function public.my_household() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('household_id', h.id, 'name', h.name, 'rev', h.rev, 'role', m.role, 'member_id', m.member_id)
  from public.household_members m join public.households h on h.id = m.household_id
  where m.user_id = auth.uid()
$$;

-- Put this phone's home online. You become its owner.
create or replace function public.create_household(p_name text, p_data jsonb, p_member_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_rev bigint;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.household_members where user_id = v_uid) then raise exception 'already_in_household'; end if;
  insert into public.households (name, data, created_by)
  values (left(coalesce(nullif(trim(p_name), ''), 'Our home'), 60), coalesce(p_data, '{}'::jsonb), v_uid)
  returning id, rev into v_id, v_rev;
  insert into public.household_members (household_id, user_id, role, member_id, email)
  values (v_id, v_uid, 'owner', left(p_member_id, 40), auth.jwt() ->> 'email');
  return jsonb_build_object('household_id', v_id, 'rev', v_rev, 'role', 'owner', 'member_id', left(p_member_id, 40));
end $$;

-- Owner only: a single-use code that lets one person join, valid for 7 days.
create or replace function public.create_invite(p_role text, p_member_id text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_hid uuid;
  v_code text;
  v_bytes bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O or 1/I
  v_i int;
begin
  select household_id into v_hid from public.household_members where user_id = v_uid and role = 'owner';
  if v_hid is null then raise exception 'not_owner'; end if;
  if p_role is null or p_role not in ('editor', 'viewer') then raise exception 'bad_role'; end if;
  if (select count(*) from public.household_invites
      where household_id = v_hid and used_at is null and expires_at > now()) >= 20 then
    raise exception 'too_many_invites';
  end if;
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    foreach v_i in array array[0, 1, 2, 3, 4, 5, 7, 9] loop -- random bytes of a v4 uuid
      v_code := v_code || substr(v_alphabet, get_byte(v_bytes, v_i) % 32 + 1, 1);
    end loop;
    exit when not exists (select 1 from public.household_invites where code = v_code);
  end loop;
  insert into public.household_invites (code, household_id, role, member_id, created_by)
  values (v_code, v_hid, p_role, left(p_member_id, 40), v_uid);
  return v_code;
end $$;

create or replace function public.join_household(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.household_invites;
  v_mine public.household_members;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select * into v_inv from public.household_invites where code = upper(trim(p_code)) for update;
  if not found then raise exception 'invite_not_found'; end if;
  select * into v_mine from public.household_members where user_id = v_uid;
  if found then
    if v_mine.household_id = v_inv.household_id then
      return jsonb_build_object('household_id', v_mine.household_id, 'role', v_mine.role, 'member_id', v_mine.member_id);
    end if;
    raise exception 'already_in_household';
  end if;
  if v_inv.used_at is not null then raise exception 'invite_used'; end if;
  if v_inv.expires_at < now() then raise exception 'invite_expired'; end if;
  insert into public.household_members (household_id, user_id, role, member_id, email)
  values (v_inv.household_id, v_uid, v_inv.role, v_inv.member_id, auth.jwt() ->> 'email');
  update public.household_invites set used_by = v_uid, used_at = now() where code = v_inv.code;
  return jsonb_build_object('household_id', v_inv.household_id, 'role', v_inv.role, 'member_id', v_inv.member_id);
end $$;

-- Link your account to a person in the app ("I'm Arun").
create or replace function public.set_my_member(p_member_id text) returns void
language sql security definer set search_path = public as $$
  update public.household_members set member_id = left(p_member_id, 40) where user_id = auth.uid()
$$;

-- Owner only: change someone to 'editor' or 'viewer'.
create or replace function public.set_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_hid uuid;
begin
  select household_id into v_hid from public.household_members where user_id = auth.uid() and role = 'owner';
  if v_hid is null then raise exception 'not_owner'; end if;
  if p_role is null or p_role not in ('editor', 'viewer') then raise exception 'bad_role'; end if;
  update public.household_members set role = p_role where household_id = v_hid and user_id = p_user and role <> 'owner';
  if not found then raise exception 'not_found'; end if;
end $$;

-- Owner only: take away someone's access.
create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_hid uuid;
begin
  select household_id into v_hid from public.household_members where user_id = auth.uid() and role = 'owner';
  if v_hid is null then raise exception 'not_owner'; end if;
  delete from public.household_members where household_id = v_hid and user_id = p_user and role <> 'owner';
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_hid uuid;
begin
  select household_id into v_hid from public.household_members where user_id = auth.uid() and role = 'owner';
  if v_hid is null then raise exception 'not_owner'; end if;
  delete from public.household_invites where household_id = v_hid and code = p_code;
end $$;

-- Editors and viewers can leave. The owner deletes the home instead.
create or replace function public.leave_household() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.household_members where user_id = auth.uid() and role <> 'owner';
  if not found then raise exception 'owner_cannot_leave'; end if;
end $$;

-- Owner only: delete the online copy and everyone's access. Phones keep their own copy.
create or replace function public.delete_household() returns void
language plpgsql security definer set search_path = public as $$
declare v_hid uuid;
begin
  select household_id into v_hid from public.household_members where user_id = auth.uid() and role = 'owner';
  if v_hid is null then raise exception 'not_owner'; end if;
  delete from public.households where id = v_hid;
end $$;

revoke execute on function
  public.my_role(uuid), public.my_household(), public.create_household(text, jsonb, text),
  public.create_invite(text, text), public.join_household(text), public.set_my_member(text),
  public.set_member_role(uuid, text), public.remove_member(uuid), public.revoke_invite(text),
  public.leave_household(), public.delete_household()
from public, anon;
grant execute on function
  public.my_role(uuid), public.my_household(), public.create_household(text, jsonb, text),
  public.create_invite(text, text), public.join_household(text), public.set_my_member(text),
  public.set_member_role(uuid, text), public.remove_member(uuid), public.revoke_invite(text),
  public.leave_household(), public.delete_household()
to authenticated;
