alter table public.quant_economic_feasibility_checks drop constraint if exists quant_economic_feasibility_checks_verdict_check;
alter table public.quant_economic_feasibility_checks add constraint quant_economic_feasibility_checks_verdict_check check (verdict in ('PASS_PREFILTER','FAIL_ECONOMICS','DATA_BLOCKED','NO_ACTIVE_SIGNAL'));
