-- Photo-based protein estimation (voeding-app, 2026-11-17).
--
-- herkomst: how a nutrition_log row came about, at row level. Deliberately a
-- separate column, not a component-level bron value (bron already exists per
-- component: product | geschat | gebruiker) and not a marker in omschrijving
-- (model-written text, not reliably queryable).
--
-- 'foto' = logged from a confirmed photo proposal in coach-chat. NULL for
-- everything else in this build (text logs, quick logs, every row before
-- 2026-11-17). Other values (e.g. quick log, external entry) may be added
-- later by widening the check — not now.
--
-- Why it exists: photo estimates must stay distinguishable from other
-- estimates, so their accuracy can be audited afterwards and analyses can
-- filter them. There was no calibration measurement before this build.
--
-- Who sets it: only coach-chat (tools.ts addLog), and only when the
-- conversation contains a photo marker ("📷 foto" line) — see
-- supabase/functions/coach-chat/foto.ts. Additive and nullable: the code
-- deployed before this column ignores it.

alter table public.nutrition_log
  add column herkomst text
  constraint nutrition_log_herkomst_check check (herkomst is null or herkomst = 'foto');

comment on column public.nutrition_log.herkomst is
  'Row-level origin. ''foto'' = logged from a confirmed photo proposal (coach-chat, 2026-11-17+); NULL = everything else. Not the same as componenten[].bron.';
