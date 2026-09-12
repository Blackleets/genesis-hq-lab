create table if not exists public.quant_research_hypothesis_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  hypothesis_fingerprint text not null,
  family text not null,
  signal_definition text not null,
  universe jsonb not null default '{}'::jsonb,
  params jsonb not null default '{}'::jsonb,
  cost_model jsonb not null default '{}'::jsonb,
  data_class text not null,
  mode text not null default 'HYPOTHESIS',
  novelty_basis text,
  supersedes_reason text,
  decision text not null,
  matched_experiment_keys text[] not null default '{}'::text[],
  matched_proposal_ids uuid[] not null default '{}'::uuid[],
  canonical_spec jsonb not null,
  requested_by text not null default 'ATLAS_FORGE',
  execution_authority boolean not null default false,
  capital_eligible boolean not null default false,
  live_orders boolean not null default false,
  created_at timestamptz not null default now(),
  constraint quant_hypothesis_mode_check check (mode in ('HYPOTHESIS','FORWARD_CONFIRMATION')),
  constraint quant_hypothesis_decision_check check (decision in ('ALLOW_NEW_HYPOTHESIS','ALLOW_RESEARCH_CHALLENGE','ALLOW_FORWARD_CONFIRMATION','REQUIRE_SUPERSEDES_REASON','REJECT_DUPLICATE_NO_GO','REJECT_DUPLICATE_PENDING')),
  constraint quant_hypothesis_no_execution check (execution_authority = false),
  constraint quant_hypothesis_no_capital check (capital_eligible = false),
  constraint quant_hypothesis_no_live check (live_orders = false)
);

comment on table public.quant_research_hypothesis_proposals is
  'Append-only deterministic novelty-gate decisions for quant research proposals. No execution authority.';

create index if not exists quant_hypothesis_fingerprint_idx
  on public.quant_research_hypothesis_proposals (hypothesis_fingerprint, created_at desc);
create index if not exists quant_hypothesis_family_idx
  on public.quant_research_hypothesis_proposals (family, created_at desc);
create index if not exists quant_hypothesis_decision_idx
  on public.quant_research_hypothesis_proposals (decision, created_at desc);

alter table public.quant_research_hypothesis_proposals enable row level security;
revoke all on table public.quant_research_hypothesis_proposals from anon, authenticated;

create or replace function public.prevent_quant_hypothesis_proposal_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'quant_research_hypothesis_proposals is append-only; UPDATE/DELETE are forbidden';
end;
$$;

drop trigger if exists quant_hypothesis_proposals_append_only on public.quant_research_hypothesis_proposals;
create trigger quant_hypothesis_proposals_append_only
before update or delete on public.quant_research_hypothesis_proposals
for each row execute function public.prevent_quant_hypothesis_proposal_mutation();
