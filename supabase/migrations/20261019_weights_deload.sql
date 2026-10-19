-- workout-app: deload flag on weight logs (backlog item 3).
-- Applied manually 2026-10-19; all existing rows are false (week 37, the
-- only earlier deload week, has no weight rows).
alter table public.weights
  add column deload boolean not null default false;

comment on column public.weights.deload is
  'true when logged in a week whose schema_weeks.phase = ''Deload''. Set by the workout app on save; such rows are never used as a reference (Laatste keer, PR, chart, day summary).';
