-- Topic cap for the morning check-in question (2026-11-06).
--
-- vraag_onderwerp records the topic of a check-in question:
-- - coach_checkin_card.vraag_onderwerp: the topic of the card the user saw.
--   This is what the cap counts: a topic is allowed on card date X only if
--   it occurs fewer than 3 times in coach_checkin_card for X-6 .. X-1
--   (_shared/vraagOnderwerp.ts, used by morning-checkin and the closer).
-- - coach_sessions.vraag_onderwerp: the topic of the closer's
--   vraag_voor_morgen (NULL when there is no question).
--
-- Nullable; NULL counts as "no topic". Rows written before this migration
-- stay NULL, except the cards of 31 Oct - 6 Nov, which were backfilled by
-- hand after review (so the cap does not need a week to ramp up).
--
-- The value list must match VRAAG_ONDERWERPEN in _shared/vraagOnderwerp.ts.

alter table public.coach_checkin_card
  add column vraag_onderwerp text null,
  add constraint coach_checkin_card_vraag_onderwerp_check check (
    vraag_onderwerp is null
    or vraag_onderwerp in ('eiwit_timing', 'maaltijd', 'herstel', 'energie', 'slaap', 'gezondheid', 'logging', 'training', 'anders')
  );

alter table public.coach_sessions
  add column vraag_onderwerp text null,
  add constraint coach_sessions_vraag_onderwerp_check check (
    vraag_onderwerp is null
    or vraag_onderwerp in ('eiwit_timing', 'maaltijd', 'herstel', 'energie', 'slaap', 'gezondheid', 'logging', 'training', 'anders')
  );
