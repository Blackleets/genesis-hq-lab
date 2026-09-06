create table if not exists public.quant_economic_feasibility_checks (
  check_id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.quant_research_hypothesis_proposals(proposal_id) on delete restrict,
  hypothesis_fingerprint text not null,
  family text not null,
  engine_version text not null default 'efg_v1',
  mode text not null,
  source_state_key text,
  source_evidence_hash text,
  observed_at timestamptz,
  gross_edge_bps numeric,
  modeled_cost_bps numeric,
  safety_buffer_bps numeric,
  required_gross_bps numeric,
  edge_cost_ratio numeric,
  margin_bps numeric,
  verdict text not null check (verdict in ('PASS_PREFILTER','FAIL_ECONOMICS','DATA_BLOCKED')),
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  execution_authority boolean not null default false check (execution_authority = false),
  capital_eligible boolean not null default false check (capital_eligible = false),
  live_orders boolean not null default false check (live_orders = false),
  created_at timestamptz not null default now()
);
create index if not exists quant_efg_fingerprint_created_idx on public.quant_economic_feasibility_checks(hypothesis_fingerprint, created_at desc);
create index if not exists quant_efg_family_created_idx on public.quant_economic_feasibility_checks(family, created_at desc);
create or replace function public.prevent_quant_efg_mutation() returns trigger language plpgsql as $$ begin raise exception 'quant_economic_feasibility_checks is append-only'; end $$;
drop trigger if exists trg_quant_efg_no_update on public.quant_economic_feasibility_checks;
create trigger trg_quant_efg_no_update before update or delete on public.quant_economic_feasibility_checks for each row execute function public.prevent_quant_efg_mutation();
