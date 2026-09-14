alter table public.genesis_auth_nonces add column if not exists challenge_message text;
comment on column public.genesis_auth_nonces.challenge_message is 'Exact UTF-8 challenge text emitted to the wallet; used verbatim for signature verification.';
