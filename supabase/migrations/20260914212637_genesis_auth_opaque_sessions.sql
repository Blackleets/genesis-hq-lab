create table if not exists public.genesis_auth_sessions (
  token_hash text primary key,
  address text not null,
  chain text not null check (chain in ('solana','evm')),
  role text not null default 'user' check (role in ('user','operator')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists genesis_auth_sessions_expires_at_idx
  on public.genesis_auth_sessions(expires_at);

alter table public.genesis_auth_sessions enable row level security;
revoke all on public.genesis_auth_sessions from anon, authenticated;
