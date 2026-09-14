create table if not exists public.bots (
  key text primary key,
  value jsonb not null
);
alter table public.bots enable row level security;
revoke all on table public.bots from anon, authenticated;
