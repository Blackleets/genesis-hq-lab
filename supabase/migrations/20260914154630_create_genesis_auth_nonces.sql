create table if not exists public.genesis_auth_nonces (
  nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
  address text not null check (char_length(address) between 20 and 128),
  chain text not null check (chain in ('solana', 'evm')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > issued_at),
  check (expires_at <= issued_at + interval '6 minutes')
);

alter table public.genesis_auth_nonces enable row level security;

create index if not exists genesis_auth_nonces_expires_at_idx
  on public.genesis_auth_nonces (expires_at);

comment on table public.genesis_auth_nonces is
  'Server-only, one-time Genesis owner-auth challenges. Raw nonces are never stored; only SHA-256 hashes. No execution authority.';
