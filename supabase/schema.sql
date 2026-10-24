-- Homzy feedback table. Run once in Supabase → SQL Editor → New query.
-- The app never talks to Supabase directly: /api/feedback (Vercel) inserts rows
-- with the secret key, so no public access policies are needed.

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
