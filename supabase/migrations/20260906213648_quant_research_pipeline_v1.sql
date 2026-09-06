create table if not exists public.quant_research_pipeline_events (
  event_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.quant_research_hypothesis_proposals(proposal_id) on delete restrict,
  hypothesis_fingerprint text not null,
  family text not null,
  stage text not null check (stage in ('PROPOSED','NOVELTY_BLOCKED','NOVELTY_ACCEPTED','ECONOMIC_WAITING','ECONOMIC_BLOCKED','BACKTEST_ALLOWED','LEDGER_SEALED')),
  novelty_decision text,
  economic_check_id uuid references public.quant_economic_feasibility_checks(check_id) on delete restrict,
  economic_verdict text,
  experiment_key text,
  research_compute_authority boolean not null default false,
  execution_authority boolean not null default false check (execution_authority = false),
  capital_eligible boolean not null default false check (capital_eligible = false),
  live_orders boolean not null default false check (live_orders = false),
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quant_pipeline_proposal_created_idx on public.quant_research_pipeline_events(proposal_id, created_at desc);
create index if not exists quant_pipeline_family_created_idx on public.quant_research_pipeline_events(family, created_at desc);

create or replace function public.prevent_quant_research_pipeline_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'quant_research_pipeline_events is append-only';
end $$;
drop trigger if exists trg_quant_pipeline_no_update on public.quant_research_pipeline_events;
create trigger trg_quant_pipeline_no_update before update or delete on public.quant_research_pipeline_events for each row execute function public.prevent_quant_research_pipeline_mutation();

create or replace function public.quant_research_backtest_allowed(p_proposal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select proposal_id, decision
    from public.quant_research_hypothesis_proposals
    where proposal_id = p_proposal_id
  ), latest_efg as (
    select verdict
    from public.quant_economic_feasibility_checks
    where proposal_id = p_proposal_id
    order by created_at desc
    limit 1
  )
  select coalesce(
    (select decision in ('ALLOW_NEW_HYPOTHESIS','ALLOW_RESEARCH_CHALLENGE','ALLOW_FORWARD_CONFIRMATION') from p), false
  ) and coalesce((select verdict = 'PASS_PREFILTER' from latest_efg), false);
$$;

create or replace view public.quant_research_pipeline_latest as
select distinct on (proposal_id)
  event_id, proposal_id, hypothesis_fingerprint, family, stage, novelty_decision,
  economic_check_id, economic_verdict, experiment_key, research_compute_authority,
  execution_authority, capital_eligible, live_orders, reason, details, created_at
from public.quant_research_pipeline_events
order by proposal_id, created_at desc;
