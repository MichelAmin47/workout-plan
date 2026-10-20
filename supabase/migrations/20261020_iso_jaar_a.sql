-- workout-app: ISO year on every week-keyed table — step A of 2 (additive).
-- NOT applied by the change that added it; run manually, then
-- 20261020_iso_jaar_b.sql later. Order of operations: workout-app/CLAUDE.md
-- "ISO week + year".
--
-- Old app code (no `jaar` anywhere) keeps working against this schema:
--  * its upserts name the OLD unique constraints, which still exist here;
--  * its inserts get jaar = 2026 from the temporary DEFAULT, correct for
--    every write until Sun 3 Jan 2027 (the last day of ISO 2026-W53);
--  * its deletes without jaar only ever match 2026 rows (no other exist).
-- New code sends jaar explicitly and names the NEW constraints. The two
-- constraint sets cannot conflict before 2027-W23 (no 2026 rows exist for
-- weeks 1-22).
--
-- Step B drops the old constraints and the DEFAULTs; it must run before
-- Mon 4 Jan 2027, from which day DEFAULT 2026 would mislabel a write.
--
-- week_overrides / rest_day_goals get no jaar: their week_nummer is a
-- calendar week, but always scoped by schema_id, and a schema lies within
-- one ISO year (schemas.jaar). exercises / schema_weeks use relative weeks.

begin;

-- A constant DEFAULT fills every existing row with 2026: that is the
-- backfill (no rewrite needed, no row moved or deleted).
alter table public.weights             add column jaar smallint not null default 2026;
alter table public.completed_exercises add column jaar integer  not null default 2026;
alter table public.completed_days      add column jaar integer  not null default 2026;
alter table public.exercise_swaps      add column jaar integer  not null default 2026;
alter table public.schemas             add column jaar integer  not null default 2026;

-- New unique constraints with jaar, side by side with the old ones until
-- step B. Names/columns must match the app's onConflict targets exactly:
--   weights        onConflict "exercise,jaar,week,person"
--   exercise_swaps onConflict "original_exercise,jaar,week,day"
alter table public.weights
  add constraint weights_exercise_jaar_week_person_key unique (exercise, jaar, week, person);
alter table public.completed_exercises
  add constraint completed_exercises_exercise_jaar_week_day_key unique (exercise, jaar, week, day);
alter table public.completed_days
  add constraint completed_days_jaar_week_day_key unique (jaar, week, day);
alter table public.exercise_swaps
  add constraint exercise_swaps_original_exercise_jaar_week_day_key unique (original_exercise, jaar, week, day);

-- A schema lies within one ISO year: its weeks are ISO weeks 1..53 of jaar.
alter table public.schemas add constraint schemas_week_range_check
  check (start_week >= 1 and start_week <= eind_week and eind_week <= 53);

comment on column public.schemas.jaar is
  'ISO year (ISO-8601 week-year). A schema lies within one ISO year; start_week/eind_week are ISO weeks of this year. week_overrides/rest_day_goals rows get their year through schema_id.';
comment on column public.weights.jaar is
  'ISO year of week (ISO-8601 week-year; 2027-01-01..03 belong to 2026-W53). Always sent explicitly by the workout app.';
comment on column public.completed_exercises.jaar is
  'ISO year of week (ISO-8601 week-year). Always sent explicitly by the workout app.';
comment on column public.completed_days.jaar is
  'ISO year of week (ISO-8601 week-year). Always sent explicitly by the workout app.';
comment on column public.exercise_swaps.jaar is
  'ISO year of week (ISO-8601 week-year). Always sent explicitly by the workout app.';

commit;

-- Verification (read-only), expected right after applying:
--   select 'weights' t, count(*), count(*) filter (where jaar = 2026) from weights
--   union all select 'completed_exercises', count(*), count(*) filter (where jaar = 2026) from completed_exercises
--   union all select 'completed_days', count(*), count(*) filter (where jaar = 2026) from completed_days
--   union all select 'exercise_swaps', count(*), count(*) filter (where jaar = 2026) from exercise_swaps
--   union all select 'schemas', count(*), count(*) filter (where jaar = 2026) from schemas;
--   -- both counts equal per table (2026-10-20: 384, 448, 65, 44, 4 rows)
--   select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid::regclass::text in ('weights','completed_exercises','completed_days','exercise_swaps','schemas')
--   order by 1, 2;
--   -- old and new unique constraints both present, plus schemas_week_range_check
-- If PostgREST doesn't see the new column right away: notify pgrst, 'reload schema';
