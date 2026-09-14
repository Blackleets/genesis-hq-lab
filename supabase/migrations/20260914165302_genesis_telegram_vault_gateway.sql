create table if not exists public.genesis_telegram_configs (
  owner_hash text primary key check (owner_hash ~ '^[0-9a-f]{16}$'),
  secret_id uuid not null unique,
  verified_at timestamptz not null,
  chat_id_masked text,
  notifications jsonb not null default '{"important":true,"opportunities":true,"executions":true,"dailySummary":true,"debug":false}'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.genesis_telegram_configs enable row level security;
revoke all on table public.genesis_telegram_configs from anon, authenticated;

create table if not exists public.genesis_telegram_deliveries (
  owner_hash text not null references public.genesis_telegram_configs(owner_hash) on delete cascade,
  event_id text not null,
  sent_at timestamptz not null default now(),
  primary key (owner_hash, event_id)
);

alter table public.genesis_telegram_deliveries enable row level security;
revoke all on table public.genesis_telegram_deliveries from anon, authenticated;

create or replace function public.genesis_telegram_config_upsert(
  p_owner_hash text,
  p_secret_json text,
  p_chat_id_masked text,
  p_notifications jsonb,
  p_verified_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_name text;
begin
  if p_owner_hash !~ '^[0-9a-f]{16}$' then
    raise exception 'invalid_owner_hash';
  end if;
  if p_secret_json is null or length(p_secret_json) < 20 or length(p_secret_json) > 8192 then
    raise exception 'invalid_secret_payload';
  end if;
  v_name := 'genesis_telegram_config_' || p_owner_hash;
  select c.secret_id into v_secret_id
  from public.genesis_telegram_configs c
  where c.owner_hash = p_owner_hash;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_secret_json, v_name, 'Genesis HQ Telegram config');
    insert into public.genesis_telegram_configs(owner_hash, secret_id, verified_at, chat_id_masked, notifications, active, updated_at)
    values (p_owner_hash, v_secret_id, p_verified_at, p_chat_id_masked, coalesce(p_notifications, '{}'::jsonb), true, now());
  else
    perform vault.update_secret(v_secret_id, p_secret_json, v_name, 'Genesis HQ Telegram config');
    update public.genesis_telegram_configs
      set verified_at = p_verified_at,
          chat_id_masked = p_chat_id_masked,
          notifications = coalesce(p_notifications, '{}'::jsonb),
          active = true,
          updated_at = now()
      where owner_hash = p_owner_hash;
  end if;

  return jsonb_build_object(
    'configured', true,
    'connected', true,
    'verifiedAt', p_verified_at,
    'chatIdMasked', p_chat_id_masked,
    'notifications', coalesce(p_notifications, '{}'::jsonb)
  );
end;
$$;

create or replace function public.genesis_telegram_config_get(p_owner_hash text)
returns table (
  owner_hash text,
  config jsonb,
  verified_at timestamptz,
  chat_id_masked text,
  notifications jsonb,
  active boolean
)
language sql
security definer
set search_path = ''
as $$
  select c.owner_hash,
         d.decrypted_secret::jsonb as config,
         c.verified_at,
         c.chat_id_masked,
         c.notifications,
         c.active
  from public.genesis_telegram_configs c
  join vault.decrypted_secrets d on d.id = c.secret_id
  where c.owner_hash = p_owner_hash;
$$;

create or replace function public.genesis_telegram_configs_for_dispatch()
returns table (
  owner_hash text,
  config jsonb,
  notifications jsonb
)
language sql
security definer
set search_path = ''
as $$
  select c.owner_hash,
         d.decrypted_secret::jsonb as config,
         c.notifications
  from public.genesis_telegram_configs c
  join vault.decrypted_secrets d on d.id = c.secret_id
  where c.active = true;
$$;

create or replace function public.genesis_telegram_config_delete(p_owner_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select c.secret_id into v_secret_id
  from public.genesis_telegram_configs c
  where c.owner_hash = p_owner_hash;
  if v_secret_id is null then
    return false;
  end if;
  delete from public.genesis_telegram_configs where owner_hash = p_owner_hash;
  delete from vault.secrets where id = v_secret_id;
  return true;
end;
$$;

revoke all on function public.genesis_telegram_config_upsert(text,text,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.genesis_telegram_config_get(text) from public, anon, authenticated;
revoke all on function public.genesis_telegram_configs_for_dispatch() from public, anon, authenticated;
revoke all on function public.genesis_telegram_config_delete(text) from public, anon, authenticated;

grant execute on function public.genesis_telegram_config_upsert(text,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.genesis_telegram_config_get(text) to service_role;
grant execute on function public.genesis_telegram_configs_for_dispatch() to service_role;
grant execute on function public.genesis_telegram_config_delete(text) to service_role;

grant select, insert, update, delete on table public.genesis_telegram_configs to service_role;
grant select, insert, update, delete on table public.genesis_telegram_deliveries to service_role;
