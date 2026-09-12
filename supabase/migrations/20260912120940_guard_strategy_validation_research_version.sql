create or replace function public.guard_strategy_validation_research_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  profile_key text;
  research_version text;
begin
  profile_key := case
    when new.strategy_version_id like 'futures_breakout_short_micro:%' then 'short_micro'
    when new.strategy_version_id like 'futures_breakout_short_core:%' then 'short_core'
    when new.strategy_version_id like 'futures_breakout_short_alt:%' then 'short_alt'
    when new.strategy_version_id like 'futures_breakout_long_probe:%' then 'long_probe'
    else null
  end;

  if profile_key is null then
    return new;
  end if;

  select (nullif(value, '')::jsonb #>> array['profiles', profile_key, 'strategyVersionId'])
    into research_version
  from public.org_state
  where key = 'quant_research_evidence_v1'
  limit 1;

  if (new.walk_forward is not null or new.oos_evidence is not null)
     and research_version is distinct from new.strategy_version_id then
    new.walk_forward := null;
    new.oos_evidence := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_strategy_validation_research_version on public.strategy_validation_snapshots;
create trigger trg_guard_strategy_validation_research_version
before insert or update of strategy_version_id, walk_forward, oos_evidence
on public.strategy_validation_snapshots
for each row
execute function public.guard_strategy_validation_research_version();

with state as (
  select nullif(value, '')::jsonb as payload
  from public.org_state
  where key = 'quant_research_evidence_v1'
  limit 1
), research_versions as (
  select 'short_micro'::text as profile_id, payload #>> '{profiles,short_micro,strategyVersionId}' as research_version from state
  union all
  select 'short_core', payload #>> '{profiles,short_core,strategyVersionId}' from state
  union all
  select 'short_alt', payload #>> '{profiles,short_alt,strategyVersionId}' from state
  union all
  select 'long_probe', payload #>> '{profiles,long_probe,strategyVersionId}' from state
), tagged as (
  select s.id,
    case
      when s.strategy_version_id like 'futures_breakout_short_micro:%' then 'short_micro'
      when s.strategy_version_id like 'futures_breakout_short_core:%' then 'short_core'
      when s.strategy_version_id like 'futures_breakout_short_alt:%' then 'short_alt'
      when s.strategy_version_id like 'futures_breakout_long_probe:%' then 'long_probe'
      else null
    end as profile_id,
    s.strategy_version_id
  from public.strategy_validation_snapshots s
  where s.walk_forward is not null or s.oos_evidence is not null
)
update public.strategy_validation_snapshots s
set walk_forward = null,
    oos_evidence = null
from tagged t
join research_versions r on r.profile_id = t.profile_id
where s.id = t.id
  and r.research_version is distinct from t.strategy_version_id;
