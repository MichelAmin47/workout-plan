-- workout-app: ISO year on every week-keyed table — step B of 2.
-- NOT applied by the change that added it; run manually, only after
-- 20261020_iso_jaar_a.sql AND after the phone is confirmed to run the new
-- app bundle (Supabase API logs show on_conflict=exercise,jaar,week,person
-- and no old-style on_conflict=exercise,week,person). Hard deadline: before
-- Mon 4 Jan 2027 (ISO 2027-W1), when DEFAULT 2026 would start mislabelling.
--
-- End state: no DEFAULT on any jaar. A code path that forgets the year now
-- fails loudly (NOT NULL violation; an old-style onConflict target fails
-- with 42P10) instead of writing a row labelled with the wrong year.

begin;

alter table public.weights             drop constraint weights_exercise_week_person_key;
alter table public.completed_exercises drop constraint completed_exercises_exercise_week_day_key;
alter table public.completed_days      drop constraint completed_days_week_day_key;
alter table public.exercise_swaps      drop constraint exercise_swaps_original_exercise_week_day_key;

alter table public.weights             alter column jaar drop default;
alter table public.completed_exercises alter column jaar drop default;
alter table public.completed_days      alter column jaar drop default;
alter table public.exercise_swaps      alter column jaar drop default;
alter table public.schemas             alter column jaar drop default;

commit;

-- Verification (read-only), expected right after applying:
--   select table_name, column_name, column_default, is_nullable from information_schema.columns
--   where table_schema = 'public' and column_name = 'jaar' order by 1;
--   -- five rows, column_default null, is_nullable NO
--   select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
--   where contype = 'u' and conrelid::regclass::text in ('weights','completed_exercises','completed_days','exercise_swaps')
--   order by 1;
--   -- only the four *_jaar_* unique constraints remain
