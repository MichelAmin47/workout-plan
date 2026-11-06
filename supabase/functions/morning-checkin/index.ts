// Supabase Edge Function: morning-checkin
//
// One-shot, forced-tool-call generation of the morning check-in card shown
// on the first app open of the day (bouwplan-voeding-app.md "Blok 5"). No
// conversation loop, no other tools — structurally a sibling of
// closeDayWithSummary in _shared/summary.ts, just its own function since it
// only has one caller (the client, on app open).
//
// Called unconditionally now, once per day (voeding-app/src/lib/
// morningCheckin.js calls it on every genuine first open) — this used to be
// a two-tier trigger gate (client decided cheaply whether to call at all;
// this function re-checked the same four conditions against real data
// before spending a Claude call, "rather than trusting the client called it
// for a good reason"). That gate silently failed twice on the same
// "yesterday was a training day" path (2026-08-18, 2026-08-21) and was
// removed on both sides rather than debugged further. An unnecessary call
// on a plain day is a minor cost; a missing check-in on a day it mattered
// was the actual problem. Originally handled by an explicit "nothing
// notable → write a plain opening, vraag_type 'geen'" branch in
// buildSystemPrompt — removed entirely (2026-10-01, see the checkin_diag
// v5 comment below): a day with nothing obviously notable still gets a
// real question now, via buildSystemPrompt's priority ladder, not a
// no-question fallback.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  amsterdamNow,
  isoDateString,
  isoWeekOf,
  resolveActiveDate,
  resolveWeekPlan,
  resolveYesterdayIfOutsideWeek,
  sortMealsByActiveDayOrder,
  type WeekDayInfo,
} from '../_shared/today.ts'
import { callClaude, type ClaudeCallResult, type ClaudeMessage } from '../_shared/anthropic.ts'
import { supabase } from '../_shared/supabaseClient.ts'
import {
  bepaalOnderwerp,
  bevatMorgenWoord,
  capVenster,
  contextVoorKaart,
  gecaptFeitRegel,
  gecapteOnderwerpen,
  onderwerpenBeschrijving,
  splitsContext,
  toegestaneOnderwerpen,
  verschuifMorgen,
  type VraagOnderwerp,
} from '../_shared/vraagOnderwerp.ts'

// Diagnostic-only client, separate from the shared `supabase` (anon-key)
// client above. checkin_diag has RLS enabled with zero policies — only a
// service-role-authenticated client (BYPASSRLS) can read/write it, by
// design (see logCheckinDiag below). Kept local to this file rather than
// added to _shared/supabaseClient.ts, since nothing else needs it.
const diagServiceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Was 20 (calibrated on the longest hand-written mood label, "Niet zo
// goed" at 12 chars, never on real model output). Raised to 40 after real
// September output showed 20 was too tight for natural Dutch phrasing:
// 13-09 "Ja, top"/"Gaat wel" (7/8, fine either way), 15-09 "Goed, veel
// gedronken"/"Nog niet echt op gelet" (20/22 — the second REJECTED the
// whole pair under the old limit), 16-09 "Ja, hou ik vast"/"Nog niet echt"
// (13/15, fine either way). 40 clears all four with headroom. Coach.css's
// .quick-reply no longer assumes a non-wrapping single line at this length
// — see that file's own comment — so this number isn't chosen to fit a
// fixed-width pill anymore, just to keep labels reasonably tap-sized.
// Referenced from both RENDER_CHECKIN_TOOL's schema description and
// buildSystemPrompt's prompt text below, so the model-facing number and the
// validator's enforced number can never drift apart.
const ANTWOORD_OPTIE_MAX_LENGTH = 40

// Duplicated from coach-chat/prompt.ts's DEFAULT_EIWIT_DOEL_G and
// voeding-app/src/lib/dayProgress.js's own copy — no shared location for a
// single constant exists in this codebase; same duplication precedent as
// currentCalWeek. Used only to show yesterday's meals against the target
// in the facts block below, not to gate or judge anything.
const EIWIT_DOEL_G = 165

// Caps how long the literal question (vraag) may be. Real single-topic
// questions in production output run 80-100 chars; the two-topic failure
// that prompted this field (01-10 — sleep AND shoulders in one question)
// was 97 chars, so a single-topic cap of 140 has real headroom without
// inviting rambling. Referenced from both buildRenderCheckinTool's schema
// description and the handler's own validation, so the model-facing number
// and the enforced number can never drift apart — same principle as
// ANTWOORD_OPTIE_MAX_LENGTH.
const VRAAG_MAX_LENGTH = 140

// The client's own hard timeout (voeding-app/src/lib/morningCheckin.js) —
// it does not retry on timeout, so a response that arrives after this is
// never seen (the documented 16-09 failure). Duplicated here rather than
// shared, same cross-file duplication precedent as EIWIT_DOEL_G/
// currentCalWeek — no shared location for a single constant exists in this
// codebase.
const CLIENT_TIMEOUT_MS = 20_000
// Reserved off the end of attempt 1's own deadline so a timed-out attempt 1
// still leaves enough room for the fast, model-free hardcoded fallback to
// be assembled and reach the client.
const ATTEMPT_MARGIN_MS = 2_000
// Minimum remaining budget required to even START a retry after attempt 1
// completes (within its own deadline) but fails validation — rounds the
// measured 9.3s p90 single-call latency up with a small safety margin. A
// tighter floor risks starting a retry that itself blows the budget; a
// looser one abandons a retry more often than necessary.
const RETRY_BUDGET_FLOOR_MS = 10_000
// Reserved off the end of the retry's own deadline — smaller than
// ATTEMPT_MARGIN_MS since nothing follows a failed retry but the fallback
// path, which is faster to assemble than a fresh decision.
const RETRY_SAFETY_MARGIN_MS = 1_000

// §30 phase 2 (2026-11-06): claude-sonnet-5 → claude-sonnet-5-5. Forced
// tool_choice returns a 400 on this model, so both calls use tool_choice
// auto + a strict schema, and a response without a tool call is handled
// like any other invalid card (corrective retry if the budget allows, then
// the hardcoded fallback). Effort 'low': this is a short, latency-bound
// task. Thinking is adaptive (on) and counts toward max_tokens; the card
// itself is ~150-250 output tokens, so 2048 leaves room for thinking
// without risking stop_reason=max_tokens before the tool call (the C3
// failure coach-chat hit at 1024). Latency stays bounded by the time
// deadlines above, not by this number.
const CHECKIN_MODEL = 'claude-sonnet-5-5'
const CHECKIN_MAX_TOKENS = 2048

// vraag_type "geen" no longer exists — every card asks something now (see
// file header / buildSystemPrompt's priority ladder). vraag_bron is new:
// the model self-reports which priority tier it actually used, which is
// what feeds the no-repeat check, the checkin_diag diagnostic, and
// tomorrow's stemming-avoidance decision — one auditable signal instead of
// inferring the source from text after the fact.
//
export type VraagBron = 'afsluiter' | 'maaltijden' | 'stemming'
const ALL_VRAAG_BRON: VraagBron[] = ['afsluiter', 'maaltijden', 'stemming']

// Shared by buildRenderCheckinTool's schema (below) and the handler's own
// validation, so the allowed set can never drift between what the model is
// told it may send and what the handler actually accepts — same principle
// as ANTWOORD_OPTIE_MAX_LENGTH.
//
// excludeAfsluiter (2026-11-06): true when yesterday's closer question is
// not offered to the model at all — absent, or blocked because its topic hit
// the cap (see _shared/vraagOnderwerp.ts). Then 'afsluiter' is not a valid
// source either, so the card falls back to 'maaltijden'.
function allowedVraagBron(excludeStemming: boolean, excludeAfsluiter: boolean): VraagBron[] {
  return ALL_VRAAG_BRON.filter((b) => !(excludeStemming && b === 'stemming') && !(excludeAfsluiter && b === 'afsluiter'))
}

// Built as a function, not a static const, because its contents vary per
// request on two independent axes: when yesterday's card already used
// vraag_bron 'stemming', 'stemming' is removed from today's vraag_bron enum
// entirely so the model literally cannot select it twice running (the same
// structural-not-prompt-only treatment already applied to removing "geen");
// and when a vraag_voor_morgen is actually available, the model gains one
// extra optional field to explain itself if it chooses NOT to use it — a
// field that would make no sense to offer on a day with no vraag_voor_morgen
// to begin with.
//
// Third axis (2026-11-06): vraag_onderwerp's enum is built from the topics
// still allowed today — a topic that occurred 3× on the cards of the last
// 6 days is left out, so the model cannot pick it (the cap; a prompt rule
// "don't repeat" did not hold). strict + additionalProperties:false give
// the schema-valid-input guarantee that forced tool use used to give.
function buildRenderCheckinTool(excludeStemming: boolean, vraagVoorMorgenBeschikbaar: boolean, toegestaan: VraagOnderwerp[]) {
  return {
    name: 'render_checkin_card',
    description: 'Render the morning check-in card.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        // The 01-10 bug in one sentence: there was no field for this. The
        // model's free-text `boodschap` doubled as "the question," so
        // nothing forced an actual question to exist in the text the user
        // reads, and nothing stopped it from narrating its own source
        // handling instead. `vraag` is now the one thing the card is built
        // around; `boodschap` below is demoted to optional framing.
        vraag: {
          type: 'string',
          description: `De letterlijke vraag aan de gebruiker — dit komt prominent op de kaart te staan. Exact één zin, over exact één onderwerp: voeg nooit twee dingen samen met "en" (bv. nooit "heb je goed geslapen en hoe voelen je schouders aan" — kies er dan één). Moet eindigen op een vraagteken. Max ${VRAAG_MAX_LENGTH} tekens. Spreek de gebruiker rechtstreeks aan: noem of verwijs NOOIT naar hoe deze vraag tot stand kwam (geen "de klaargezette vraag", "het aandachtspunt", "de afsluiter", "het geheugen"), en leg nooit uit waarom je iets wel of niet gebruikt hebt — dat hoort hooguit in vraag_voor_morgen_niet_gebruikt_reden hieronder, nooit in wat de gebruiker te lezen krijgt.`,
        },
        boodschap: {
          type: 'string',
          description:
            'Optioneel, kort (max ~100 tekens): een aanvullende framing- of overgangszin naast de vraag. De meeste dagen kun je dit gewoon weglaten — vraag draagt de kaart nu. Spreekt de gebruiker rechtstreeks aan, net als vraag: nooit verwijzen naar hoe de kaart of de vraag tot stand kwam.',
        },
        context_label: { type: 'string', description: 'Short label for the supporting context line, e.g. "Vandaag:"' },
        context_tekst: { type: 'string', description: 'The supporting context line itself, e.g. "Rustdag — mooi moment voor herstel."' },
        vraag_type: {
          type: 'string',
          enum: ['stemming', 'anders'],
          description:
            'What kind of question `vraag` poses — every card asks something now, there is no "no question" option. "stemming": a mood/wellbeing question the user could answer with a general feeling (e.g. how did you sleep, how are you feeling) — reserved for vraag_bron "stemming" below, the client shows fixed mood-reply buttons for this case. "anders": any other kind of question (a specific time, a yes/no, something concrete about yesterday) — used for vraag_bron "afsluiter"/"maaltijden", where the question is concrete enough to have a specific answer, not a general mood check; the client shows free text input (or antwoord_opties pills) instead.',
        },
        vraag_onderwerp: {
          type: 'string',
          enum: toegestaan,
          description: `Het onderwerp waar vraag echt over gaat — een vraag over ontbijt, eiwit eerder op de dag of de verdeling over de dag is altijd "eiwit_timing", ook als hij over een maaltijd lijkt te gaan. Beschikbaar vandaag: ${onderwerpenBeschrijving(toegestaan)}. Een onderwerp dat hier ontbreekt is vandaag niet beschikbaar (zie de feiten in de systeemprompt).`,
        },
        vraag_bron: {
          type: 'string',
          enum: allowedVraagBron(excludeStemming, !vraagVoorMorgenBeschikbaar),
          description:
            'Which source the question actually came from — report this honestly, it drives diagnostics and the no-repeat/no-two-stemming-days-running checks. ' +
            (vraagVoorMorgenBeschikbaar
              ? '"afsluiter": gebaseerd op de klaargezette vraag in de feiten hieronder — dit is het DEFAULT, gebruik hem tenzij hij iets veronderstelt dat de feiten hieronder rechtstreeks tegenspreken (een training noemt die niet heeft plaatsgevonden, of een dagtype aanneemt dat is verplaatst). '
              : '"afsluiter" is vandaag NIET beschikbaar — er staat geen bruikbare vraag klaar. ') +
            '"maaltijden": gebaseerd op de maaltijden van gisteren of het rooster van vandaag/gisteren — gebruikt wanneer er geen vraag klaarstaat, of die rechtstreeks wordt tegengesproken door de feiten.' +
            (excludeStemming
              ? ' "stemming" is NIET beschikbaar vandaag — gisteren was de vraag al een stemmingsvraag, dus kies hier altijd "afsluiter" of "maaltijden", ook als er weinig materiaal is.'
              : ' "stemming": only when neither of the above yields anything usable.'),
        },
        // Required since 2026-11-06: 6 of the cards 17 Oct - 5 Nov had no
        // buttons because the model simply sent none (aangeboden 0, the
        // field was optional). The count (2-3) and the per-label limit stay
        // enforced in validateAntwoordOpties — strict mode supports neither
        // maxLength nor array-length constraints. For vraag_type "stemming"
        // the client shows its own fixed mood buttons and this is ignored.
        antwoord_opties: {
          type: 'array',
          items: { type: 'string' },
          description: `Altijd invullen: precies 2 of 3 korte antwoorden op vraag waarmee de gebruiker met één tik kan reageren (bijv. een keuze tussen twee tijdstippen, een ja/nee-variant, of "Goed"/"Gaat wel"/"Nog stijf") — dit zijn ALTIJD antwoorden op vraag, nooit op iets anders. Elk label max ${ANTWOORD_OPTIE_MAX_LENGTH} tekens (dit is een bovengrens, geen doel — hou elk label zo kort als nog natuurlijk klinkt). De gebruiker kan daarnaast altijd vrij typen, dus de opties hoeven niet alles af te dekken. Bij vraag_type "stemming" toont de app eigen stemmingsknoppen en worden deze genegeerd.`,
        },
        ...(vraagVoorMorgenBeschikbaar
          ? {
              vraag_voor_morgen_niet_gebruikt_reden: {
                type: 'string',
                description:
                  'Alleen invullen als je vraag_bron NIET "afsluiter" hebt gekozen, terwijl er wel een vraag_voor_morgen klaarstond (zie de feiten hieronder): één korte zin over waarom die vraag niet meer bruikbaar was (bv. "de training waar de vraag over ging heeft al plaatsgevonden", "het dagtype klopte niet meer"). Laat dit veld weg als vraag_bron wel "afsluiter" is.',
              },
            }
          : {}),
      },
      required: ['vraag', 'context_label', 'context_tekst', 'vraag_type', 'vraag_bron', 'vraag_onderwerp', 'antwoord_opties'],
    },
  }
}

type DayFact = Pick<WeekDayInfo, 'dayType' | 'naam'>

function dayLabel(info: DayFact): string {
  if (info.dayType === 'training') return `trainingsdag${info.naam ? ` (${info.naam})` : ''}`
  if (info.dayType === 'rust') return `rustdag${info.naam ? ` (${info.naam})` : ''}`
  if (info.dayType === 'power_hour') return `Power Hour${info.naam ? ` (${info.naam})` : ''}`
  if (info.dayType === 'boksen') return `Boksen${info.naam ? ` (${info.naam})` : ''}`
  return 'onbekend'
}

interface CheckinCardFields {
  vraag: string
  boodschap: string | null
  context_label: string
  context_tekst: string
  vraag_type: 'stemming' | 'anders'
  vraag_bron: VraagBron
  vraag_onderwerp: VraagOnderwerp | null
}

// The absolute last resort — reached only when no model call produced a
// usable card in time (attempt 1 and, if there was budget, a retry). Not
// another model call: this must never itself fail, and must stay fast, so
// it's built entirely from data already resolved earlier in the handler.
// vraag_bron 'stemming' bypasses excludeStemming deliberately — this isn't
// a normal tier-c pick subject to the no-two-days-running rule, it's a
// fixed escape hatch, and the client's mood buttons always work regardless
// of what was asked yesterday. Capitalizes dayLabel's output since that
// helper is written for mid-sentence use ("Vandaag is een trainingsdag")
// but this needs a standalone context line ("Trainingsdag (Schouders).").
function buildHardcodedFallbackCard(todayInfo: DayFact): CheckinCardFields {
  const label = dayLabel(todayInfo)
  return {
    vraag: 'Hoe voel je je vanochtend?',
    boodschap: null,
    context_label: 'Vandaag:',
    context_tekst: `${label.charAt(0).toUpperCase()}${label.slice(1)}.`,
    vraag_type: 'stemming',
    vraag_bron: 'stemming',
    // Not counted toward the topic cap: like its stemming bypass, this is
    // the fixed escape hatch, not a topic choice.
    vraag_onderwerp: null,
  }
}

// Cheap heuristic for "does the aandachtspunt contain something worth
// asking about." Originally fed the old client+server trigger gate
// (removed — see the file header), then repurposed inside buildSystemPrompt
// to help decide hasNotableSignal, the "is there anything to hook the card
// on today" question — that internal use is gone too now (2026-10-01,
// vraag_type "geen" removed, buildSystemPrompt no longer computes
// hasNotableSignal at all). This function now feeds only the handler's own
// checkin_diag diagnostic (aandachtspuntGeeftSignaal, kept per the v5
// comment's explicit "keep logging hasNotableSignal for comparison"
// instruction) — deliberately NOT improved further as part of this change:
// investigation found real missed cases this month, but on every one of
// them the model still asked the question anyway (it reads the raw
// aandachtspunt text itself, this heuristic was never the bottleneck). The
// client-side copy in voeding-app/src/lib/morningCheckin.js is genuinely
// dead now (that file no longer computes any signal at all, unconditional
// there) — kept, unused, in a comment noting why, same runtime-duplication
// precedent as currentCalWeek in that file.
//
// Not exhaustive by design: catches the actual reproduction case ("vraag
// hoe hij geslapen heeft" has no "?" but contains "vraag"), misses other
// phrasings (e.g. "polsen hoe het ging"). Accepted — the same "good enough"
// tolerance as the weight-trend week-averaging heuristic, not a permanent
// design.
function aandachtspuntHasQuestion(text: string | null): boolean {
  if (!text) return false
  return /\?/.test(text) || /\bvraag\b/i.test(text)
}

// Real bug (17 augustus): a carried-over aandachtspunt written after a
// training day ("vraag hoe laat hij vandaag traint") surfaced unchanged on
// a morning where today turned out to be a rest day — the card's own
// context line said "Rustdag" right next to a question about training
// time, a contradiction visible on the card itself. This used to be
// handled by a pre-model keyword regex (aandachtspuntDropReason) that
// dropped the note entirely on a detected mismatch — removed (2026-09-02)
// after two real false positives: a note describing a boxing class outside
// the formal schema (no actual contradiction, just the word "sessie") and
// a note that explicitly said "ZONDER TRAINING" in the same sentence the
// regex matched "boksles" in — a negation a keyword match can't see. The
// model already receives today's actual resolved day type in the facts
// above and is better equipped to judge this than a pre-model heuristic;
// see the reconciliation bullet in buildSystemPrompt below, added at the
// point the aandachtspunt is actually weighed rather than as a persona-wide
// rule. aandachtspunt now always reaches the model unfiltered — nothing
// upstream of buildSystemPrompt drops it anymore.

// leeg_label/label_te_lang/duplicaat_label stay here for historical rows
// (pre-this-change checkin_diag payloads can carry them as a whole-set
// rejection reason) but validateAntwoordOpties below no longer *produces*
// them as a top-level reason — a content problem on one label no longer
// fails the whole set, so there's no longer a single label-level cause to
// name at that level. te_weinig_geldige_labels is the new top-level reason
// for "2-3 labels came in, but fewer than 2 survived per-label filtering"
// — deliberately not reusing one of the three retired values, since a
// shortfall can now come from a mix of causes and per-label specificity
// lives in AntwoordOptieLabelDiag.dropReden instead (see below).
export type AntwoordOptieAfkeurReden =
  | 'geen_array'
  | 'te_weinig_opties'
  | 'te_veel_opties'
  | 'leeg_label'
  | 'label_te_lang'
  | 'duplicaat_label'
  | 'te_weinig_geldige_labels'
  | null

export interface AntwoordOptiesResultaat {
  // The KEPT labels when validatie is 'geaccepteerd' or 'deels_geaccepteerd'
  // (i.e. whatever survived per-label filtering) — never the raw list.
  opties: string[] | null
  aangeboden: number // 0 when absent, empty array, or not an array
  // 'deels_geaccepteerd': 2+ labels came in, all of the structural/count
  // checks passed, but one or more were dropped by per-label filtering
  // (empty, too long, or a duplicate) — opties is the surviving subset.
  validatie: 'nvt' | 'geaccepteerd' | 'deels_geaccepteerd' | 'afgekeurd'
  afkeurReden: AntwoordOptieAfkeurReden
}

export type AntwoordOptieLabelDropReden = 'leeg' | 'te_lang' | 'duplicaat'

interface AntwoordOptieLabelClassificatie {
  waarde: string
  behouden: boolean
  dropReden?: AntwoordOptieLabelDropReden
}

// Classifies already-trimmed labels one at a time, in order: dropped if
// empty, over ANTWOORD_OPTIE_MAX_LENGTH code points, or an exact-match
// repeat of an earlier-kept label (first occurrence wins, same identity
// rule the old whole-array Set check used, now applied per label instead
// of failing the whole array). Shared by validateAntwoordOpties and
// diagnoseAntwoordOptieLabels so the two can never disagree about which
// labels were dropped or why — same principle as sharing
// ANTWOORD_OPTIE_MAX_LENGTH and the [...s].length code-point count.
function classifyAntwoordOptieLabels(trimmedLabels: string[]): AntwoordOptieLabelClassificatie[] {
  const seen = new Set<string>()
  return trimmedLabels.map((waarde) => {
    if (waarde.length === 0) return { waarde, behouden: false, dropReden: 'leeg' as const }
    if ([...waarde].length > ANTWOORD_OPTIE_MAX_LENGTH) return { waarde, behouden: false, dropReden: 'te_lang' as const }
    if (seen.has(waarde)) return { waarde, behouden: false, dropReden: 'duplicaat' as const }
    seen.add(waarde)
    return { waarde, behouden: true }
  })
}

// Validates the model's optional antwoord_opties field (see
// buildRenderCheckinTool's schema above) — only ever called when
// vraag_type === 'anders' (see the Deno.serve handler below); 'stemming'
// never touches this, by design.
//
// Structural problems (not an array, wrong count, a non-string element)
// still fail the whole field closed — opties: null, same as before. Content
// problems on an individual label no longer do: each label is classified on
// its own (see classifyAntwoordOptieLabels), and the surviving ones are
// shown as long as at least 2 remain. Only when fewer than 2 survive does
// the whole set get rejected (te_weinig_geldige_labels) — a longer, wrapping
// pill beats no pill at all, but 1 pill or 0 pills isn't a usable choice.
//
// Absent/empty ('nvt'), "the model supplied something but it didn't pass"
// ('afgekeurd'), and "supplied enough, but not everything survived"
// ('deels_geaccepteerd') are three deliberately distinct validatie values —
// that distinction is the whole point of recording this in checkin_diag:
// otherwise "the model supplied nothing," "validation rejected everything,"
// and "validation kept most of it" are indistinguishable after the fact.
export function validateAntwoordOpties(raw: unknown): AntwoordOptiesResultaat {
  if (raw == null) return { opties: null, aangeboden: 0, validatie: 'nvt', afkeurReden: null }
  if (!Array.isArray(raw)) return { opties: null, aangeboden: 0, validatie: 'afgekeurd', afkeurReden: 'geen_array' }
  if (raw.length === 0) return { opties: null, aangeboden: 0, validatie: 'nvt', afkeurReden: null }

  const aangeboden = raw.length
  if (!raw.every((item): item is string => typeof item === 'string')) {
    return { opties: null, aangeboden, validatie: 'afgekeurd', afkeurReden: 'geen_array' }
  }
  if (aangeboden < 2) return { opties: null, aangeboden, validatie: 'afgekeurd', afkeurReden: 'te_weinig_opties' }
  if (aangeboden > 3) return { opties: null, aangeboden, validatie: 'afgekeurd', afkeurReden: 'te_veel_opties' }

  // Trim before classifying — otherwise " Ja " passes the empty check and
  // is kept with its padding, and worse, "Ja" vs "Ja " pass the duplicate
  // check (distinct by Set identity) while rendering as two pills the user
  // can't tell apart. Trimming is the only normalization applied.
  const trimmed = raw.map((label) => label.trim())
  const classified = classifyAntwoordOptieLabels(trimmed)
  const kept = classified.filter((c) => c.behouden).map((c) => c.waarde)

  if (kept.length < 2) {
    return { opties: null, aangeboden, validatie: 'afgekeurd', afkeurReden: 'te_weinig_geldige_labels' }
  }
  return {
    opties: kept,
    aangeboden,
    validatie: kept.length === aangeboden ? 'geaccepteerd' : 'deels_geaccepteerd',
    afkeurReden: null,
  }
}

// Counts what the model supplied without validating it — used on paths
// where antwoord_opties is known to be irrelevant (vraag_type isn't
// 'anders') or the response is otherwise malformed, so the diagnostic can
// still record "the model supplied N options here" instead of collapsing
// that fact into a hardcoded 0. No validation, no behavior change.
function ongevalideerdeAantal(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0
}

export type AntwoordOptieLabelDiag =
  | { waarde: string; lengte: number; behouden: boolean; dropReden?: AntwoordOptieLabelDropReden }
  | { waarde: null; ruwType: string }

// Per-option diagnostic view of whatever the model supplied in
// antwoord_opties, independent of validateAntwoordOpties's pass/fail
// verdict — logged on BOTH the accepted and rejected path (a limit tuned
// only on rejections is tuned on half the distribution). `behouden`/
// `dropReden` come from the exact same classifyAntwoordOptieLabels call
// validateAntwoordOpties itself uses, so this can never disagree with what
// was actually kept/shown for the same input — including on a
// 'deels_geaccepteerd' result, where this is the only place that records
// which specific label(s) got dropped and why. `lengte` reuses the same
// [...label].length code-point count (not .length), so the logged number
// and the enforced number can never disagree either. `waarde` is post-trim,
// the only normalisation performed, so it's what was actually measured.
//
// Two different malformed shapes both fail validateAntwoordOpties with
// 'geen_array' and must stay distinguishable here, not collapse into the
// same logged output: raw not being an array at all, vs. an array
// containing a non-string item. The non-array case logs the fixed marker
// ruwType: 'geen_array' — not typeof raw — precisely so it can never read
// the same as an array holding one non-string item (which logs its own
// typeof, e.g. 'object'/'number'). Using typeof for both would make
// `{foo: 1}` and `[{foo: 1}]` produce an identical entry.
//
// Classification runs only across the string entries, in their original
// relative order, skipping non-string entries entirely (they can't be
// classified — they only ever get a ruwType marker here) — this matches
// validateAntwoordOpties exactly for the common case (every element a
// string, since that function bails out before classifying otherwise), and
// gives sensible duplicate-detection among just the comparable string
// values on the looser diagnostic-only paths where the array is mixed.
export function diagnoseAntwoordOptieLabels(raw: unknown): AntwoordOptieLabelDiag[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) return [{ waarde: null, ruwType: 'geen_array' }]

  const stringIndices: number[] = []
  const trimmedStrings: string[] = []
  raw.forEach((item, i) => {
    if (typeof item === 'string') {
      stringIndices.push(i)
      trimmedStrings.push(item.trim())
    }
  })
  const classified = classifyAntwoordOptieLabels(trimmedStrings)
  const classifiedByIndex = new Map(stringIndices.map((i, j) => [i, classified[j]]))

  return raw.map((item, i): AntwoordOptieLabelDiag => {
    if (typeof item !== 'string') return { waarde: null, ruwType: typeof item }
    const c = classifiedByIndex.get(i)!
    return { waarde: c.waarde, lengte: [...c.waarde].length, behouden: c.behouden, ...(c.dropReden ? { dropReden: c.dropReden } : {}) }
  })
}

// Own short prompt, not the full PERSONA_PROMPT — same reasoning
// _shared/summary.ts already uses its own narrower prompts for the
// day-summary rather than the persona block. This task is much smaller
// than a full conversation: a few facts in, three-to-four fields out.
//
// excludeStemming must be the exact same boolean passed to
// buildRenderCheckinTool for this same request — it drives both the tool
// schema (which options exist at all) and this prompt text (why one is
// missing); passing them out of sync would tell the model something the
// schema itself contradicts.
function buildSystemPrompt(
  yesterday: DayFact,
  today: DayFact,
  isThursday: boolean,
  aandachtspunt: string | null,
  memoryFacts: { feit: string; categorie: string | null }[],
  vraagVoorMorgen: string | null,
  gisterenMeals: { omschrijving: string; tijdstip: string | null; eiwitten_g: number }[],
  recentTopics: string[],
  excludeStemming: boolean,
  gecaptRegel: string,
): string {
  const yesterdayTraining = yesterday.dayType === 'training'
  const todayTraining = today.dayType === 'training'
  // Schema-derived, not calendar-derived (unlike isThursday below) — used
  // only to gate the Power Hour eating-advice line further down, so a
  // session moved off Thursday via week_overrides is still caught. Kept
  // deliberately separate from isThursday itself, which stays calendar-
  // based for the checkin_diag diagnostic in the Deno.serve handler below
  // (see that assignment's own comment) — narrowing only this one block's
  // gate, not that other consumer.
  const todayPowerHour = today.dayType === 'power_hour'
  // Background facts about the user's week (office days, work-free days,
  // recurring habits) — same unfiltered coach_memory read coach-chat/
  // prompt.ts does. Framed below as facts to check assumptions against,
  // never as a menu: this card is 1-2 sentences, and a habit like "banaan
  // of noten vooraf" would turn into a fixed suggestion if the model
  // treated the list as things to propose rather than things to not
  // contradict. `categorie` deliberately left out of the rendered text —
  // it's a database-organisation aid (how a fact groups for memory_update/
  // memory_deactivate), not a statement about how firm the fact is, and
  // showing it here would suggest otherwise (the two facts that caused the
  // 2026-09-11 kantoordag bug are 'gewoonte'; a soft, optional habit like
  // "na training vaak eerst een shake" is 'vaste_gewoonte' — backwards from
  // what those labels would imply about bindingness).
  const memoryBlock = memoryFacts.length > 0
    ? `\n- Achtergrondkennis over de gebruiker (langetermijngeheugen) — gebruik dit om aannames te toetsen en tegenspraken te voorkomen (bijv. welke dagen kantoordag zijn, vaste gewoontes), NIET als een lijst om suggesties uit te putten: noem een van deze feiten alleen als de dag van vandaag daar zelf om vraagt.\n${memoryFacts.map((f) => `  - ${f.feit}`).join('\n')}`
    : ''

  // Same rendering shape as _shared/summary.ts's own mealsText, minus
  // calorieën — this card may ask ABOUT yesterday's meals (point b of the
  // priority ladder below), never judge them, so calories (which invite
  // judgment, protein doesn't) are deliberately excluded from what the
  // model even sees here.
  const eiwitTotaalGisteren = gisterenMeals.reduce((sum, m) => sum + (Number(m.eiwitten_g) || 0), 0)
  const gisterenMealsText =
    gisterenMeals.length > 0
      ? gisterenMeals.map((m) => `- ${m.tijdstip ?? '?'} ${m.omschrijving}: ${m.eiwitten_g}g eiwit`).join('\n')
      : 'Geen maaltijden gelogd.'

  return `Je schrijft een korte ochtend check-in kaart voor de voedingscoach-app "Coach" — het eerste wat de gebruiker ziet bij het openen van de app, in plaats van een generieke groet. Velden: vraag (de letterlijke vraag, komt prominent op de kaart), optioneel een korte boodschap, een context-regel (label + tekst, een korte ondersteunende regel), vraag_type/vraag_bron (welke soort vraag, via welke route), vraag_onderwerp en antwoord_opties.

De gebruiker heet Mies; de achtergrondfeiten hieronder noemen hem zo. Op de kaart spreek je hem altijd rechtstreeks aan met je/jij — gebruik zijn naam niet.

Feiten om op te baseren (gebruik alleen wat hier staat, verzin niets):
- Gisteren was een ${dayLabel(yesterday)}.
- Vandaag is een ${dayLabel(today)}.
${todayPowerHour ? '- Op een Power Hour-dag: geen nuchtere training, een normale eetdag met een snack rond 17:30 en de hoofdmaaltijd na de training.\n' : ''}- Zondag is de vaste beendag, altijd nuchter — de norm, niet de uitzondering.
${(yesterdayTraining || todayTraining) ? '- Spiereiwitsynthese blijft 24-48 uur verhoogd na een zware trainingssessie — de dag ná een trainingsdag mag ook eiwitrijk zijn.\n' : ''}${aandachtspunt ? `- Meegenomen aandachtspunt uit een eerdere dagafsluiting, wat de coach moet onthouden: "${aandachtspunt}" — dit kan over gisteren gaan, maar ook over een eerdere dag; gebruik alleen een dagaanduiding die letterlijk in deze tekst zelf staat, verzin er zelf geen bij.` : '- Geen aandachtspunt beschikbaar.'}
${vraagVoorMorgen ? `- Gisteren is deze vraag voor vandaag klaargezet (de dagwoorden zijn al omgezet naar vandaag): "${vraagVoorMorgen}".\n` : ''}- Maaltijden van gisteren (${eiwitTotaalGisteren}g eiwit totaal gelogd, doel ${EIWIT_DOEL_G}g):
${gisterenMealsText}
${recentTopics.length > 0 ? `- Onderwerp(en) van je laatste vraag/vragen (niet herhalen): ${recentTopics.map((t) => `"${t}"`).join(', ')}\n` : ''}${gecaptRegel ? `${gecaptRegel}\n` : ''}${excludeStemming ? '- Gisteren was de vraag al een stemmingsvraag (vraag_bron "stemming") — dat kan vandaag niet nog een keer, zie de tool-opties.\n' : ''}${memoryBlock}

Hoe je het aandachtspunt weegt tegenover de trainingsfeiten:
${
  aandachtspunt
    ? `- Het aandachtspunt is op een eerder moment geschreven en kan een dagtype aannemen dat niet meer klopt — vergelijk het eerst zelf met de "Vandaag is..."-feiten hierboven. Bevat de tekst zelf al een ontkenning die aansluit bij vandaag (bv. "zonder training", "geen training", "rustdag"), gebruik hem dan gewoon — dat is geen tegenspraak. Is de tekst écht in tegenspraak met vandaag (bv. hij veronderstelt een training terwijl vandaag geen trainingsdag is, zonder zo'n ontkenning), gebruik dan alleen het deel dat nog wel klopt, of val terug op de trainingsfeiten hieronder als er niets bruikbaars overblijft — verzin nooit een training of rustdag die niet in de feiten hierboven staat.
- Bevat het aandachtspunt hierboven iets om te vragen of een concrete actie voor vandaag → leid de boodschap daarmee in (natuurlijk geformuleerd, geen letterlijke kopie), en gebruik de trainingsfeiten als ondersteunende context-regel.
- Bevat het alleen achtergrond, voorkeuren of constateringen zonder iets te vragen → negeer het voor deze kaart en val terug op de gewone trainingsgerichte boodschap hieronder. Niet alles uit het aandachtspunt proppen — één kaart, één focus, niet een opsomming.`
    : '- Geen aandachtspunt beschikbaar, gebruik de trainingsfeiten hierboven zoals gebruikelijk.'
}

Regels:
- Focus op eiwitten. Noem GEEN calorieën en GEEN dagtotaal.
- Noem NOOIT gewicht, een gewichtstrend of onderhoudsniveau — ook niet als dit in het aandachtspunt, de klaargezette vraag, of de maaltijdgegevens van gisteren hierboven voorkomt. Dit wordt bewust nergens teruggegeven, ook niet hier.
- Geen schuldgevoel-taal, geen "je zat ver onder/boven je doel" — dit gaat over training en herstel, niet over hoe gisteren scoorde tegenover een doel. Dit geldt ook voor de maaltijdtijden hierboven: die mag je BEVRAGEN (bv. "at je expres zo laat?"), nooit BEOORDELEN — sommige dagen worden achteraf met geschatte tijden ingevoerd, dus de gebruiker moet die aanname in zijn antwoord kunnen corrigeren.
- Gebruik een dagwoord als "gisteren" of "vandaag" alleen als dat rechtstreeks klopt met de "Gisteren was..."/"Vandaag is..."-feiten hierboven, of met een dagaanduiding die letterlijk in het aandachtspunt zelf staat. Verwijs je naar iets uit het aandachtspunt waarvan de dag niet met zekerheid vaststaat, gebruik dan gewoon geen dagwoord ("na de boksles" in plaats van "gisteren na de boksles") — verzin er nooit een bij.
- Schrijf natuurlijk Nederlands: vorm nooit een bezitsvorm door 's of se aan een dagnaam of bijwoord te plakken (fout: "gisteren se rustdag", "gisteren's sessie") — gebruik in plaats daarvan "de rustdag van gisteren" of "gisteren was een rustdag".
- De boodschap en de context-regel mogen elkaar nooit tegenspreken over welke dag iets was.
- Motiverende, warme toon, kort en concreet — geen algemeenheid die net zo goed op elke willekeurige dag zou passen.
- vraag is precies één vraag over precies één onderwerp — voeg nooit twee dingen samen met "en" (kies er dan één).
- vraag en boodschap spreken de gebruiker rechtstreeks aan — noem nooit hoe de kaart of de vraag tot stand kwam (geen "de klaargezette vraag", "het aandachtspunt", "de afsluiter", "het geheugen"), en leg nooit uit waarom je iets gekozen of weggelaten hebt.
- Elke kaart stelt een vraag — er is geen "geen vraag"-optie meer. Kies de bron in deze volgorde en rapporteer die eerlijk in vraag_bron:
  a. ${vraagVoorMorgen ? `Er staat een vraag klaar (zie de feiten hierboven) — dit is het DEFAULT, gebruik hem (natuurlijk verwoord, geen letterlijk citaat) met vraag_bron "afsluiter". Begint de klaargezette tekst met een context-deel vóór " — " (bv. "Je bent vandaag vrij met de kids — …"), neem die context dan mee in boodschap en zet alleen de vraag zelf in vraag — laat de context niet weg. Vragen over slaap, energie, hoe het lichaam aanvoelt, of hoe iets gisteren ging zijn ALTIJD bruikbaar, ongeacht het dagtype van vandaag — dat soort vraag hoeft nooit te "passen" bij vandaag. Gebruik hem alleen NIET als hij rechtstreeks wordt tegengesproken door de "Vandaag is..."-feiten hierboven (hij veronderstelt een training die niet heeft plaatsgevonden, of een dagtype dat is verplaatst) — val dan terug op optie b, en vul vraag_voor_morgen_niet_gebruikt_reden in met één korte zin waarom.` : 'Er staat geen vraag klaar vanuit gisteren — ga direct naar optie b.'}
  b. Baseer een vraag op iets concreets uit de maaltijden van gisteren hierboven (bv. een tijdstip, wat er gegeten werd) of op het rooster van vandaag/gisteren, met vraag_bron "maaltijden".
  ${excludeStemming ? '' : 'c. Alleen als zowel a als b niets bruikbaars opleveren: een stemmingsvraag, vraag_type "stemming", vraag_bron "stemming".\n  '}
- vraag_type "stemming" hoort uitsluitend bij vraag_bron "stemming" (optie c) — een vraag over hoe iemand zich voelt of geslapen heeft, waar een algemeen gevoel een passend antwoord op is. vraag_bron "afsluiter" of "maaltijden" hoort altijd bij vraag_type "anders": die vragen zijn concreet genoeg om een specifiek antwoord te hebben, ook als het onderwerp toevallig gevoel-gerelateerd aandoet.
- Geef altijd 2 of 3 korte antwoord_opties mee (elk max ${ANTWOORD_OPTIE_MAX_LENGTH} tekens — dit is een bovengrens, geen doel; hou elk label zo kort als nog natuurlijk klinkt). Kies een vraag waar zulke korte antwoorden natuurlijk bij passen; de gebruiker kan daarnaast altijd vrij typen. Verzin geen opties die een keuze suggereren die er niet is.
- Gebruik geen "morgen" (of morgenochtend/morgenavond) — de kaart wordt vandaag gelezen.
${recentTopics.length > 0 ? '- Herhaal niet het onderwerp van een van je laatste vragen hierboven — kies iets anders, ook al is optie a of b daardoor minder voor de hand liggend.\n' : ''}- Leg de kaart ALTIJD vast met één aanroep van het render_checkin_card tool — schrijf geen losse tekst.`
}

// v3 (2026-09-02): added vraagTekst and kaart. Before this, checkin_diag
// stored the CLASSIFICATION of a checkin (vraag_type, antwoordOpties'
// counts/validation) but never its CONTENT — so e.g. antwoordOpties.
// aangeboden === 0 on a vraag_type "anders" row was ambiguous (a closed
// question with no options offered, a missed opportunity, vs. an open
// question with none needed, correct behaviour) with no way to tell them
// apart after the fact, and "the advice got generic" had no way to be
// checked at all. v1/v2 rows are untouched and coexist — readers filter on
// payload->>'v'.
//
// v4 (2026-09-30): antwoordOpties.validatie gained a fourth value,
// 'deels_geaccepteerd' (see validateAntwoordOpties) — this bump is about
// that, specifically. Adding labels[].behouden/dropReden and the getoond
// count below is purely additive and, on its own, would NOT have forced a
// bump (same precedent as labels[] itself, added under v3 without one) —
// but 'validatie' is an EXISTING field, and its value set changing meaning
// is different from a new sibling key appearing: before this, "the model
// tried and it didn't fully go through" was entirely captured by
// 'afgekeurd'; after this, that population splits into 'afgekeurd' (fewer
// than 2 usable labels) and 'deels_geaccepteerd' (2+ usable, something
// trimmed). Anyone aggregating validatie values across this date needs to
// know 'afgekeurd' narrowed at this exact version. v1/v2/v3 rows are
// untouched and coexist, as always — readers filter on payload->>'v'.
//
// v5 (2026-10-01): vraag_type's 'geen' value is gone — every card asks a
// question now, sourced via the priority ladder in buildSystemPrompt. This
// is again an existing-field-reinterpretation bump, not an additive one:
// before this, hasNotableSignal (still computed and logged below,
// unchanged, for comparison with earlier rows) decided whether vraag_type
// could even be 'geen'; after this it decides nothing — vraag_type is
// never 'geen' regardless of hasNotableSignal's value. New field vraagBron
// records which priority tier (afsluiter/maaltijden/stemming) the model
// actually used, self-reported — this is what feeds the no-repeat check
// and the never-two-stemming-days-running rule. v1-v4 rows are untouched
// and coexist, as always — readers filter on payload->>'v'.
//
// v6 (2026-10-01, same day as v5 — the first real v5 card exposed a second,
// deeper bug within hours): `vraagTekst` now holds the model's dedicated
// `vraag` field instead of `boodschap` — before this bump, `boodschap`
// doubled as "the question" with nothing forcing it to actually be one
// (the 01-10 card showed a statement, not a question, while the pills
// silently answered a question that was never asked in the text). This is
// again an existing-field-reinterpretation, not an additive change — the
// same precedent that earned v5 its own bump. New: `vraagVoorMorgen` makes
// the reconciliation rule in buildSystemPrompt's priority-ladder item (a)
// checkable against real data instead of anecdotes (the 01-10 card wrongly
// discarded a perfectly good vraag_voor_morgen; this is the gap that let
// that ship unnoticed) — `beschikbaar` is known before the model is even
// called, `gebruikt`/`nietGebruiktReden` are null until a card exists.
// `cardBron` distinguishes a model-produced card from the hardcoded
// last-resort fallback (see buildHardcodedFallbackCard) — should stay rare
// in production. `timing` records how many model calls were made and how
// long each took against the client's 20s budget (voeding-app/src/lib/
// morningCheckin.js does not retry on timeout) — see the handler's deadline
// logic. `kaart.vraag` is added and `kaart.boodschap` becomes nullable,
// mirroring the response object exactly as this field has always done.
// v1-v5 rows are untouched and coexist, as always — readers filter on
// payload->>'v'.
//
// v7 (2026-11-06): topic cap, required answer options, closer day-word
// shift, claude-sonnet-5-5. Bumped because existing fields change meaning:
// `vraagVoorMorgen.beschikbaar` still means "the closer left a question",
// but the model may now never see it (`geblokkeerdWegensCap`), and
// `antwoordOpties.aangeboden === 0` now means the model ignored a REQUIRED
// field instead of skipping an optional one. New: `onderwerp` (the topic
// the card was counted under, after the code's keyword check —
// `herlabeld` says the code overruled the model's label), `gecapteOnderwerpen`
// (topics removed from today's enum), `vraagVoorMorgen.onderwerp`/
// `geblokkeerdWegensCap`/`dagwoordConversie` (closer text before/after the
// "morgen" shift)/`contextAangevuld`/`contextOvergelatenAanModel`, and per
// attempt `stopReason`/`outTokens` in `timing`. v1-v6 rows are untouched
// and coexist, as always — readers filter on payload->>'v'.
interface CheckinDiagPayload {
  v: 7
  ts_utc: string
  datum_lokaal: string
  vandaag: { type: string | null; naam: string | null }
  gisteren: { datum: string; type: string | null; naam: string | null }
  cond: {
    gisterenGetraind: boolean
    vandaagTrainingsdag: boolean
    vandaagPowerHour: boolean
    aandachtspuntGeeftSignaal: boolean
  }
  hasNotableSignal: boolean
  aandachtspunt: {
    ruwAanwezig: boolean
    // Kept alongside ruwAanwezig for schema stability with historical rows
    // (was: "did the note survive the day-type-mismatch filter"). That
    // filter is gone (2026-09-02, see aandachtspuntHasQuestion's neighbouring
    // comment) — nothing is filtered anymore, so this is now always equal
    // to ruwAanwezig. Not removed since v1/v2 rows use it and the schema
    // stays stable across versions.
    effectiefAanwezig: boolean
    // Stops being populated for the day-type-mismatch reason (2026-09-02)
    // — always null on new rows now. Field/type kept as-is; historical rows
    // still carry the old enum values.
    gedroptReden: 'dagtype_mismatch_verwacht_training' | 'dagtype_mismatch_verwacht_rust' | null
  }
  // Whether/how yesterday's vraag_voor_morgen was used today — see
  // buildSystemPrompt's priority-ladder item (a) and VRAAG_MAX_LENGTH's
  // neighbouring comment on why this exists. `beschikbaar` is independent
  // of modelOk (known before any model call); `gebruikt`/`nietGebruiktReden`
  // are null until a card exists (model or fallback) and are set to
  // false/null specifically (not left null) once cardBron is
  // 'hardcoded_fallback', since no real reconciliation decision happened.
  vraagVoorMorgen: {
    beschikbaar: boolean
    gebruikt: boolean | null
    nietGebruiktReden: string | null
    onderwerp: string | null
    geblokkeerdWegensCap: boolean
    dagwoordConversie: { voor: string; na: string } | null
    contextAangevuld: boolean
    contextOvergelatenAanModel: boolean
  }
  onderwerp: { waarde: string | null; herlabeld: boolean }
  gecapteOnderwerpen: string[]
  vraag_type: string | null
  // The literal question text — the model's dedicated `vraag` field as of
  // v6 (was `boodschap`, see this bump's own comment above for why that was
  // wrong), or the hardcoded fallback's fixed question when cardBron is
  // 'hardcoded_fallback'. Always populated now (a card always exists, see
  // buildHardcodedFallbackCard); null only on v1-v4 rows where vraag_type
  // was 'geen'.
  vraagTekst: string | null
  // Which priority tier (see buildSystemPrompt) the model self-reported
  // using — 'afsluiter' | 'maaltijden' | 'stemming' | null. 'stemming' when
  // cardBron is 'hardcoded_fallback' (the fallback's fixed vraag_bron); null
  // on all v1-v4 rows (field didn't exist yet). This is the single source
  // both the no-repeat check and the never-two-stemming-days-running rule
  // read back the next day, via coach_checkin_card rather than this
  // diagnostics table — see that table's own write below for why.
  vraagBron: VraagBron | null
  // Which path actually produced the card. 'model' is the normal case;
  // 'hardcoded_fallback' means neither attempt 1 nor a (possibly skipped)
  // retry produced a valid card within the client's time budget — see the
  // handler's deadline logic. Lets the fallback rate be monitored in
  // production; it should stay rare. null only on v1-v5 rows (field didn't
  // exist yet — there was no fallback path before v6, a failure meant
  // {card: null} instead).
  cardBron: 'model' | 'hardcoded_fallback' | null
  // How many model calls were actually made and how long each took, against
  // CLIENT_TIMEOUT_MS. null only on v1-v5 rows. `pogingen` is 0 when no
  // model call was attempted at all (e.g. ANTHROPIC_API_KEY unset).
  timing: {
    pogingen: 0 | 1 | 2
    eersteAanroepMs: number
    eersteAanroepAfgebroken: boolean
    tweedeAanroepMs: number | null
    tweedeAanroepAfgebroken: boolean
    retryOvergeslagenWegensBudget: boolean
    eersteStopReason: string | null
    eersteOutTokens: number | null
    tweedeStopReason: string | null
    tweedeOutTokens: number | null
    model: string
  } | null
  // The full check-in card as returned to the client, mirrored field-for-
  // field from the same variables the `card:` response object below is
  // built from — never re-derived separately, so the two can't drift. A
  // card always exists as of v6 (model or hardcoded fallback), so this is
  // no longer ever null on a new row.
  kaart: {
    eyebrow: string
    vraag: string
    boodschap: string | null
    contextLabel: string
    contextTekst: string
    vraagType: string
    antwoordOpties: string[] | null
  }
  antwoordOpties: {
    aangeboden: number
    // How many labels actually survived to be shown — labels.filter(l =>
    // 'behouden' in l && l.behouden).length, saves unnesting the array for
    // a simple count query. Added alongside the v4 bump (see above); on its
    // own this wouldn't have forced one.
    getoond: number
    validatie: 'nvt' | 'geaccepteerd' | 'deels_geaccepteerd' | 'afgekeurd'
    afkeurReden: AntwoordOptieAfkeurReden
    // Per-option content (label + measured length), logged on both the
    // accepted and rejected path — see diagnoseAntwoordOptieLabels. Added
    // 2026-09-08 after the first real rejection (06-09, label_te_lang)
    // proved unanswerable from `afkeurReden` alone: it names which rule
    // failed first, never what the label actually said or how long it was.
    // No version bump at the time — a sibling key on an existing object,
    // absent (not misleading) on every row before it shipped. Gained
    // `behouden`/`dropReden` per entry as part of the v4 bump above — that
    // addition alone wouldn't have forced the bump either; `validatie`
    // gaining a new value is what did.
    labels: AntwoordOptieLabelDiag[]
  }
  modelOk: boolean
}

// Diagnostic-only: distinguishes "the model returned a well-formed card"
// from "the model returned something that failed to render" (missing
// field, invalid vraag_type/vraag_bron) — currently indistinguishable from
// the client's perspective, which only ever sees {card: null} either way.
// console.log line is the
// same-day debugging copy; the checkin_diag row (diagServiceClient, RLS
// locked to service-role) is the durable copy, since the edge log window
// this feeds queries in 24h slices, one at a time (measured during a
// 2026-09-16 investigation: retention itself actually reaches back
// several weeks, more than the "Free plan, 1 day" this comment used to
// claim — that number was never verified before now). Two independent
// failure boundaries rather than one shared try/catch, so an insert
// failure can never suppress the console line or vice versa. The insert
// is not awaited — EdgeRuntime.waitUntil is Supabase's documented
// mechanism for background work that must not add latency to the response
// but must still reliably complete.
//
// A row here does NOT mean the user saw a card. This function never
// checks req.signal, so it runs to completion — Claude call, validation,
// this insert — regardless of what the client decided to do while
// waiting. Confirmed 2026-09-16: a client-side timeout with no request
// cancellation retried after the original call was already this far along
// server-side, producing two rows (both modelOk: true) for a card the
// user never saw either version of — the client had already given up and
// fallen back to its own generic template before either response arrived.
// The retry no longer fires on a timeout specifically (see
// voeding-app/src/lib/morningCheckin.js's isTimeoutError), but this
// function still has no idempotency of its own — a second POST for a day
// already logged (from any cause, including a genuine transport-failure
// retry) writes a second, independent row. Any count of vraag_type or
// antwoordOpties distributions read from this table must de-duplicate by
// `datum` first, or a day that produced two rows silently counts twice.
function logCheckinDiag(payload: CheckinDiagPayload) {
  try {
    console.log('[checkin-diag] ' + JSON.stringify(payload))
  } catch (err) {
    console.error('checkin-diag console logging failed', err)
  }
  const insert = diagServiceClient
    .from('checkin_diag')
    .insert({ datum: payload.datum_lokaal, ts_utc: payload.ts_utc, payload })
    .then(({ error }) => {
      if (error) console.error('checkin-diag insert failed', error)
    })
    .catch((err) => console.error('checkin-diag insert threw', err))
  EdgeRuntime.waitUntil(insert)
}

// Durable one-row-per-day record of what the card actually asked — real
// application state (like coach_sessions), not a diagnostics instrument,
// so it's written via the shared anon-key `supabase` client, not
// `diagServiceClient`. Two consumers read it back: this function's own
// next invocation (last-3 topics, yesterday's vraag_bron for the
// stemming-avoidance check) and coach-chat/prompt.ts (today's row, so a
// bare reply to the card can be recognized as an answer to it).
//
// `on conflict (datum) do nothing` — first write wins, not last. Deliberate,
// not an implicit upsert side effect: checkin_diag's own history shows
// genuine same-day duplicate invocations (including a sub-2-second pair).
// A last-write-wins upsert would let a second, possibly-never-rendered
// response silently overwrite the record of what the user actually saw —
// the client renders whatever response arrives and completes first, and
// the first successful write here is the best available proxy for that,
// since nothing in this architecture tracks "was this response the one
// actually displayed." Residual risk, stated plainly: if the first call
// degrades badly but the client actually renders a better second response
// (because the first was slow past the point of display), this table
// durably records the unseen first question instead of the seen second
// one — an accepted gap, not a hidden one; the alternative failure mode
// (overwriting a genuinely-seen first response with a redundant retry) is
// the more common one on current evidence.
// vraag_onderwerp (2026-11-06) is what the topic cap counts: the closer and
// the next cards read it back for their 6-day window.
function logCheckinCard(datum: string, vraagTekst: string, vraagType: string, vraagBron: VraagBron, antwoordOpties: string[] | null, vraagOnderwerp: VraagOnderwerp | null) {
  const insert = supabase
    .from('coach_checkin_card')
    .upsert(
      { datum, vraag_tekst: vraagTekst, vraag_type: vraagType, vraag_bron: vraagBron, antwoord_opties: antwoordOpties, vraag_onderwerp: vraagOnderwerp },
      { onConflict: 'datum', ignoreDuplicates: true },
    )
    .then(({ error }) => {
      if (error) console.error('coach_checkin_card upsert failed', error)
    })
    .catch((err) => console.error('coach_checkin_card upsert threw', err))
  EdgeRuntime.waitUntil(insert)
}

// Result of trying to extract a usable card from one callClaude response —
// shared by attempt 1 and the retry so the two can never disagree about
// what counts as valid. `problem` is a short Dutch sentence naming the
// FIRST validation failure found (vraag checked before the older required
// fields, since it's the new, most failure-prone field) — used both to log
// why a response was rejected and as the retry's corrective tool_result
// text. `toolUseId` is carried separately from the parsed fields so the
// retry can reference it even when the fields themselves are invalid.
interface ParsedCheckinCard {
  valid: boolean
  problem: string | null
  toolUseId: string | null
  vraag?: string
  boodschap: string | null
  context_label?: string
  context_tekst?: string
  vraag_type?: 'stemming' | 'anders'
  vraag_bron?: VraagBron
  antwoord_opties?: unknown
  vraagVoorMorgenNietGebruiktReden: string | null
  onderwerp: VraagOnderwerp | null
  onderwerpHerlabeld: boolean
}

// Everything parseCheckinToolUse needs to judge a card beyond its own
// fields — fixed per request, shared by attempt 1 and the retry.
interface CheckinValidatieContext {
  excludeStemming: boolean
  excludeAfsluiter: boolean
  gecapt: VraagOnderwerp[]
  // Topic of the closer question that was offered (null when none was, or
  // when a legacy row has no topic and the keyword check found none).
  afsluiterOnderwerp: VraagOnderwerp | null
  // The closer question as offered to the model (after the "morgen" shift).
  vraagVoorMorgenOmgezet: string | null
}

function parseCheckinToolUse(result: ClaudeCallResult, ctx: CheckinValidatieContext): ParsedCheckinCard {
  const empty = { boodschap: null, vraagVoorMorgenNietGebruiktReden: null, onderwerp: null, onderwerpHerlabeld: false }
  const toolUse = result.data?.content.find((b) => b.type === 'tool_use' && b.name === 'render_checkin_card')
  if (!toolUse || !toolUse.input) {
    return { valid: false, problem: 'geen render_checkin_card tool-aanroep in de respons', toolUseId: toolUse?.id ?? null, ...empty }
  }

  const input = toolUse.input as {
    vraag?: string
    boodschap?: string
    context_label?: string
    context_tekst?: string
    vraag_type?: 'stemming' | 'anders'
    vraag_bron?: VraagBron
    antwoord_opties?: unknown
    vraag_voor_morgen_niet_gebruikt_reden?: string
    vraag_onderwerp?: string
  }

  const vraagTrimmed = input.vraag?.trim()
  const boodschapTrimmed = input.boodschap?.trim() || null
  // The topic the card is counted under: for an "afsluiter" card the
  // closer's own topic (the model's label for it is not trusted — 05 Nov),
  // otherwise the model's label; either way overruled by the eiwit_timing
  // keyword check on the actual question text.
  const { onderwerp, herlabeld } = bepaalOnderwerp(
    input.vraag_bron === 'afsluiter' && ctx.afsluiterOnderwerp ? ctx.afsluiterOnderwerp : input.vraag_onderwerp,
    vraagTrimmed,
  )
  // Output guard for the closer's day words: the offered closer text has its
  // "morgen" already shifted to "vandaag", so a "morgen" on the card is
  // either carried over or the model's own — rejected (retry), never
  // rewritten, so a genuine future reference is never mangled.
  const morgenOpKaart = (bevatMorgenWoord(vraagTrimmed) || bevatMorgenWoord(boodschapTrimmed)) && !bevatMorgenWoord(ctx.vraagVoorMorgenOmgezet)
  const problem = !vraagTrimmed
    ? 'vraag ontbreekt of is leeg'
    : !vraagTrimmed.endsWith('?')
      ? 'vraag eindigt niet op een vraagteken'
      : [...vraagTrimmed].length > VRAAG_MAX_LENGTH
        ? `vraag is langer dan ${VRAAG_MAX_LENGTH} tekens`
        : !input.context_label
          ? 'context_label ontbreekt'
          : !input.context_tekst
            ? 'context_tekst ontbreekt'
            : !input.vraag_type || !['stemming', 'anders'].includes(input.vraag_type)
              ? 'vraag_type ontbreekt of is ongeldig'
              : !input.vraag_bron || !allowedVraagBron(ctx.excludeStemming, ctx.excludeAfsluiter).includes(input.vraag_bron)
                ? 'vraag_bron ontbreekt of is ongeldig'
                : !onderwerp
                  ? 'vraag_onderwerp ontbreekt of is ongeldig'
                  : ctx.gecapt.includes(onderwerp)
                    ? `onderwerp "${onderwerp}" is vandaag niet beschikbaar (al 3× in de afgelopen 7 dagen) — stel een vraag over een ander onderwerp`
                    : morgenOpKaart
                      ? 'de kaart wordt vandaag gelezen — gebruik geen "morgen", "morgenochtend" of "morgenavond"'
                      : null

  return {
    valid: problem === null,
    problem,
    toolUseId: toolUse.id ?? null,
    vraag: vraagTrimmed,
    boodschap: boodschapTrimmed,
    context_label: input.context_label,
    context_tekst: input.context_tekst,
    vraag_type: input.vraag_type,
    vraag_bron: input.vraag_bron,
    antwoord_opties: input.antwoord_opties,
    vraagVoorMorgenNietGebruiktReden: input.vraag_voor_morgen_niet_gebruikt_reden?.trim() || null,
    onderwerp,
    onderwerpHerlabeld: herlabeld,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    // Tracked from literally the first line — the client's 20s timeout
    // (voeding-app/src/lib/morningCheckin.js) covers the whole request, not
    // just the model call(s) below. Everything the attempt-1/retry deadline
    // logic computes is measured against this, not against when the model
    // call itself starts.
    const requestStartedAt = Date.now()
    const now = amsterdamNow()
    // Same threshold the closing question owns the other end of — the
    // evening already has its own check-in, this one is morning/daytime
    // only. Checked against the raw clock, not the active-day cutoff below
    // (that's about which calendar day is "in play," this is about the
    // literal hour).
    if (now.getHours() >= 22) {
      return jsonResponse({ card: null })
    }

    // Same active-day resolution as coach-chat's own context building —
    // matters only in the 00:00-03:59 sliver, but keeps this function
    // consistent with the rest of the codebase rather than a raw-clock
    // exception nobody decided on.
    const activeDate = resolveActiveDate(now)
    const todayWeekday = activeDate.getDay() || 7
    const todayCalWeek = isoWeekOf(activeDate)
    const todayDateStr = isoDateString(activeDate)

    // Plain date arithmetic, not the calendar-week machinery below (that's
    // for mapping to schema_days/week_overrides, irrelevant to the literal
    // coach_sessions/nutrition_log/coach_checkin_card lookups this feeds).
    const yesterdayDate = new Date(activeDate)
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)
    const yesterdayDateStr = isoDateString(yesterdayDate)

    // All six of these are independent of each other — none needs another's
    // result, only todayCalWeek/todayWeekday/yesterdayDateStr/todayDateStr,
    // all computed synchronously above. Previously five of these six ran
    // sequentially with zero Promise.all in this file; against a measured
    // p90 of 9.3s and a 20s hard timeout with no retry-on-timeout (see
    // voeding-app/src/lib/morningCheckin.js), adding two more sequential
    // reads for this feature would have made a real latency risk worse
    // rather than better — parallelizing was required, not optional.
    const venster = capVenster(todayDateStr)
    const [weekPlan, yesterdayOutside, sessionRes, memoryRes, mealsRes, recentCardsRes, vensterCardsRes] = await Promise.all([
      resolveWeekPlan(todayCalWeek, todayWeekday),
      // Only ever resolves something on a Monday (see _shared/today.ts) —
      // every other day, yesterday is already inside this week's own
      // Mon-Sun grid at weekday-1.
      resolveYesterdayIfOutsideWeek(activeDate, todayWeekday),
      // Same select shape as Coach.jsx's fetchTodaySummary, now also
      // reading vraag_voor_morgen (see _shared/summary.ts) for priority (a)
      // of the question ladder in buildSystemPrompt.
      supabase.from('coach_sessions').select('aandachtspunt, vraag_voor_morgen, vraag_onderwerp').eq('datum', yesterdayDateStr).limit(1),
      // Same unfiltered read as coach-chat/prompt.ts's buildDynamicContext —
      // no categorie/keyword filter, active facts only. This is what lets
      // the card know things like which days are office days, that
      // coach-chat already had and this function didn't (2026-09-11
      // kantoordag bug). categorie still selected (harmless) even though
      // buildSystemPrompt doesn't render it — see that function's own
      // comment on why.
      supabase.from('coach_memory').select('feit, categorie').eq('actief', true).order('created_at', { ascending: true }),
      // Yesterday's logged meals for priority (b) of the question ladder —
      // calorieen deliberately NOT selected (this card may ask about
      // meals, never judge them; see buildSystemPrompt's own comment).
      supabase.from('nutrition_log').select('omschrijving, tijdstip, eiwitten_g').eq('datum', yesterdayDateStr).order('tijdstip', { ascending: true }),
      // Last 3 recorded cards before today, most recent first — feeds both
      // the no-repeat instruction and (from the most recent entry, if it's
      // literally yesterday) the never-two-stemming-days-running check.
      supabase.from('coach_checkin_card').select('datum, vraag_tekst, vraag_bron').lt('datum', todayDateStr).order('datum', { ascending: false }).limit(3),
      // The topic-cap window (X-6 .. X-1, see _shared/vraagOnderwerp.ts):
      // what the user actually saw, not what the closer proposed.
      supabase.from('coach_checkin_card').select('datum, vraag_onderwerp').gte('datum', venster.van).lte('datum', venster.totEnMet),
    ])

    const todayInfo: DayFact = weekPlan.find((d) => d.isToday) ?? { dayType: null, naam: null }
    const yesterdayInfo: DayFact = yesterdayOutside ?? weekPlan.find((d) => d.weekday === todayWeekday - 1) ?? { dayType: null, naam: null }

    const yesterdaySession = sessionRes.data
    const aandachtspunt: string | null = yesterdaySession && yesterdaySession.length > 0 ? yesterdaySession[0].aandachtspunt ?? null : null
    const vraagVoorMorgen: string | null = yesterdaySession && yesterdaySession.length > 0 ? yesterdaySession[0].vraag_voor_morgen ?? null : null
    const vraagVoorMorgenOnderwerpOpgeslagen: string | null = yesterdaySession && yesterdaySession.length > 0 ? yesterdaySession[0].vraag_onderwerp ?? null : null

    // Topic cap for today. If the window can't be read, every topic stays
    // allowed (the card must still render) but the closer question is not
    // offered — the one structural path to the runaway topic is closed.
    if (vensterCardsRes.error) console.error('morning-checkin: cap window query failed', vensterCardsRes.error.message)
    const gecapt = vensterCardsRes.error ? [] : gecapteOnderwerpen(vensterCardsRes.data ?? [], todayDateStr)
    const toegestaan = toegestaneOnderwerpen(gecapt)

    // The closer's question, judged at this end too: its stored topic (or,
    // for a legacy row without one, the keyword check) may have hit the cap
    // after it was written — the closer ran before today's window was known,
    // or a row was written by hand/test. Then it is not offered at all and
    // the card falls back to the maaltijden source.
    const afsluiterOnderwerp = vraagVoorMorgen ? bepaalOnderwerp(vraagVoorMorgenOnderwerpOpgeslagen, vraagVoorMorgen).onderwerp : null
    const geblokkeerdWegensCap = Boolean(vraagVoorMorgen) && (vensterCardsRes.error != null || (afsluiterOnderwerp !== null && gecapt.includes(afsluiterOnderwerp)))
    // The closer wrote on D for this card on D+1: its "morgen" is today. The
    // shift is done here in code, never left to the model (16 Oct card said
    // "morgen" copied from the 15 Oct closer text).
    const vraagVoorMorgenOmgezet = vraagVoorMorgen ? verschuifMorgen(vraagVoorMorgen) : null
    const vraagVoorMorgenAangeboden: string | null = geblokkeerdWegensCap ? null : vraagVoorMorgenOmgezet

    const memoryFacts = memoryRes.data ?? []

    const gisterenMeals = sortMealsByActiveDayOrder(mealsRes.data ?? [])

    const recentCards = recentCardsRes.data ?? []
    const recentTopics = recentCards.map((c) => c.vraag_tekst).filter((t): t is string => Boolean(t))
    // Only true if the single most recent recorded card is literally
    // yesterday AND used vraag_bron 'stemming' — a gap (app not opened
    // yesterday) means there's no "two days running" to guard against, so
    // stemming becomes available again after any gap, not just after a
    // non-stemming day.
    const gisterenWasStemming = recentCards.length > 0 && recentCards[0].datum === yesterdayDateStr && recentCards[0].vraag_bron === 'stemming'

    const isThursday = todayWeekday === 4

    // checkin-diag: computed once here from data this handler already has,
    // deliberately duplicating (not reusing) buildSystemPrompt's identical
    // internal booleans — same precedent as aandachtspuntHasQuestion/
    // currentCalWeek elsewhere in this codebase, so buildSystemPrompt's own
    // signature and behavior stay completely untouched by this diagnostic.
    const gisterenGetraind = yesterdayInfo.dayType === 'training'
    const vandaagTrainingsdag = todayInfo.dayType === 'training'
    // Stays keyed to the calendar (isThursday), not todayInfo.dayType —
    // unlike the schema-based gate buildSystemPrompt now uses for its own
    // Power Hour eating-advice block. A moved Power Hour session (via
    // week_overrides) would desync this diagnostic flag from the card's
    // actual content; left as-is, out of scope for this task.
    const vandaagPowerHour = isThursday
    // Raw aandachtspunt, straight from the coach_sessions query above —
    // never a filtered/presentation-adjusted variant. See buildSystemPrompt's
    // matching comment on its own hasNotableSignal line: a signal input must
    // never be silently suppressed by a display decision.
    const aandachtspuntGeeftSignaal = aandachtspuntHasQuestion(aandachtspunt)
    const diagBasePayload = {
      v: 7 as const,
      datum_lokaal: todayDateStr,
      vandaag: { type: todayInfo.dayType, naam: todayInfo.naam },
      gisteren: { datum: yesterdayDateStr, type: yesterdayInfo.dayType, naam: yesterdayInfo.naam },
      cond: { gisterenGetraind, vandaagTrainingsdag, vandaagPowerHour, aandachtspuntGeeftSignaal },
      hasNotableSignal: gisterenGetraind || vandaagTrainingsdag || vandaagPowerHour || aandachtspuntGeeftSignaal,
      aandachtspunt: {
        ruwAanwezig: Boolean(aandachtspunt),
        effectiefAanwezig: Boolean(aandachtspunt),
        gedroptReden: null,
      },
    }

    // Known before any model call — whether yesterday's close left a
    // question ready for today. Feeds both buildSystemPrompt/
    // buildRenderCheckinTool (whether to even offer the niet_gebruikt_reden
    // field) and the diagnostics below (vraagVoorMorgen.beschikbaar).
    const vraagVoorMorgenBeschikbaar = vraagVoorMorgen !== null

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

    // Filled by either the model path or the hardcoded-fallback path below
    // — every branch assigns all of these, so a card always exists by the
    // time this block ends. See buildHardcodedFallbackCard's own comment
    // for why the fallback never itself fails.
    let cardBron: 'model' | 'hardcoded_fallback'
    let finalCard: CheckinCardFields
    let finalAntwoordOptiesRaw: unknown
    let vraagVoorMorgenNietGebruiktReden: string | null = null
    let timing: NonNullable<CheckinDiagPayload['timing']>
    let onderwerpHerlabeld = false
    let contextAangevuld = false
    let contextOvergelatenAanModel = false

    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY secret is not set')
      cardBron = 'hardcoded_fallback'
      finalCard = buildHardcodedFallbackCard(todayInfo)
      finalAntwoordOptiesRaw = undefined
      timing = { pogingen: 0, eersteAanroepMs: 0, eersteAanroepAfgebroken: false, tweedeAanroepMs: null, tweedeAanroepAfgebroken: false, retryOvergeslagenWegensBudget: false, eersteStopReason: null, eersteOutTokens: null, tweedeStopReason: null, tweedeOutTokens: null, model: CHECKIN_MODEL }
    } else {
      const tool = buildRenderCheckinTool(gisterenWasStemming, vraagVoorMorgenAangeboden !== null, toegestaan)
      const systemPrompt = buildSystemPrompt(yesterdayInfo, todayInfo, isThursday, aandachtspunt, memoryFacts, vraagVoorMorgenAangeboden, gisterenMeals, recentTopics, gisterenWasStemming, gecaptFeitRegel(gecapt, 'vandaag'))
      const validatieCtx: CheckinValidatieContext = {
        excludeStemming: gisterenWasStemming,
        excludeAfsluiter: vraagVoorMorgenAangeboden === null,
        gecapt,
        afsluiterOnderwerp: vraagVoorMorgenAangeboden !== null ? afsluiterOnderwerp : null,
        vraagVoorMorgenOmgezet: vraagVoorMorgenAangeboden,
      }
      const userMessage: ClaudeMessage = { role: 'user', content: 'Genereer de ochtend check-in kaart voor vandaag.' }

      // Attempt 1 gets its own deadline, computed from whatever budget the
      // Promise.all reads above already consumed — the client's 20s timeout
      // covers the whole request, not just this call. If this times out,
      // there is by construction no budget left for a retry (see
      // ATTEMPT_MARGIN_MS/RETRY_BUDGET_FLOOR_MS's own comments).
      const elapsedBeforeAttempt1 = Date.now() - requestStartedAt
      const attempt1TimeoutMs = CLIENT_TIMEOUT_MS - elapsedBeforeAttempt1 - ATTEMPT_MARGIN_MS
      const attempt1StartedAt = Date.now()
      const attempt1 = await callClaude(apiKey, {
        model: CHECKIN_MODEL,
        system: systemPrompt,
        messages: [userMessage],
        tools: [tool],
        toolChoice: { type: 'auto' },
        effort: 'low',
        maxTokens: CHECKIN_MAX_TOKENS,
        timeoutMs: attempt1TimeoutMs,
      })
      const eersteAanroepMs = Date.now() - attempt1StartedAt
      const eersteAanroepAfgebroken = Boolean(attempt1.timedOut)

      let parsed: ParsedCheckinCard | null = null
      if (attempt1.timedOut) {
        // No budget left for a retry by construction — falls through to
        // the fallback below.
      } else if (!attempt1.ok) {
        console.error('morning-checkin: Claude call failed (attempt 1)', attempt1.status, attempt1.errorText)
      } else {
        parsed = parseCheckinToolUse(attempt1, validatieCtx)
      }
      const eersteStopReason = attempt1.data?.stop_reason ?? null
      const eersteOutTokens = attempt1.data?.usage?.output_tokens ?? null
      let tweedeStopReason: string | null = null
      let tweedeOutTokens: number | null = null

      let tweedeAanroepMs: number | null = null
      let tweedeAanroepAfgebroken = false
      let retryOvergeslagenWegensBudget = false

      // Only even consider a retry when attempt 1 itself completed (wasn't
      // aborted) but came back invalid — a corrective nudge can fix a
      // malformed field, it can't do anything about a request that already
      // ran out the clock.
      // A refusal, or a turn with no content, can't be corrected by a nudge
      // (and an empty assistant turn can't be appended) — straight to the
      // fallback.
      const retryZinvol = eersteStopReason !== 'refusal' && (attempt1.data?.content?.length ?? 0) > 0
      if (!eersteAanroepAfgebroken && attempt1.ok && retryZinvol && (!parsed || !parsed.valid)) {
        const elapsedAfterAttempt1 = Date.now() - requestStartedAt
        if (CLIENT_TIMEOUT_MS - elapsedAfterAttempt1 < RETRY_BUDGET_FLOOR_MS) {
          retryOvergeslagenWegensBudget = true
        } else {
          const retryTimeoutMs = CLIENT_TIMEOUT_MS - elapsedAfterAttempt1 - RETRY_SAFETY_MARGIN_MS
          // Append attempt 1's own turn unchanged (thinking blocks included —
          // the history stays append-only), then the correction. With a
          // tool call: a tool_result explaining what was wrong. Without one
          // (tool_choice auto lets the model answer in text): a plain user
          // nudge — a tool_result needs a real tool_use_id to refer to.
          const correctionMessage: ClaudeMessage = parsed?.toolUseId
            ? {
                role: 'user',
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: parsed.toolUseId,
                    is_error: true,
                    content: JSON.stringify({ error: `Ongeldige kaart: ${parsed.problem ?? 'onbekende fout'}. Roep render_checkin_card opnieuw aan.` }),
                  },
                ],
              }
            : { role: 'user', content: 'Je hebt het render_checkin_card tool niet aangeroepen. Leg de kaart nu vast met één aanroep van render_checkin_card.' }
          const retryStartedAt = Date.now()
          const retryResult = await callClaude(apiKey, {
            model: CHECKIN_MODEL,
            system: systemPrompt,
            messages: [userMessage, { role: 'assistant', content: attempt1.data!.content }, correctionMessage],
            tools: [tool],
            toolChoice: { type: 'auto' },
            effort: 'low',
            maxTokens: CHECKIN_MAX_TOKENS,
            timeoutMs: retryTimeoutMs,
          })
          tweedeAanroepMs = Date.now() - retryStartedAt
          if (retryResult.timedOut) {
            tweedeAanroepAfgebroken = true
          } else if (!retryResult.ok) {
            console.error('morning-checkin: Claude call failed (retry)', retryResult.status, retryResult.errorText)
          } else {
            parsed = parseCheckinToolUse(retryResult, validatieCtx)
          }
          tweedeStopReason = retryResult.data?.stop_reason ?? null
          tweedeOutTokens = retryResult.data?.usage?.output_tokens ?? null
        }
      }

      timing = {
        pogingen: tweedeAanroepMs !== null || tweedeAanroepAfgebroken ? 2 : 1,
        eersteAanroepMs,
        eersteAanroepAfgebroken,
        tweedeAanroepMs,
        tweedeAanroepAfgebroken,
        retryOvergeslagenWegensBudget,
        eersteStopReason,
        eersteOutTokens,
        tweedeStopReason,
        tweedeOutTokens,
        model: CHECKIN_MODEL,
      }
      if (parsed && !parsed.valid) {
        console.warn('morning-checkin: no valid card from the model', JSON.stringify({ problem: parsed.problem, eersteStopReason, tweedeStopReason }))
      }

      if (parsed && parsed.valid) {
        cardBron = 'model'
        finalCard = {
          vraag: parsed.vraag!,
          boodschap: parsed.boodschap,
          context_label: parsed.context_label!,
          context_tekst: parsed.context_tekst!,
          vraag_type: parsed.vraag_type!,
          vraag_bron: parsed.vraag_bron!,
          vraag_onderwerp: parsed.onderwerp,
        }
        onderwerpHerlabeld = parsed.onderwerpHerlabeld
        // The closer's context clause ("Je bent morgen vrij met de kids —")
        // used to get dropped when the card rephrased the question. If the
        // model didn't keep it in boodschap, the code adds it — converted,
        // and only when it holds no other relative day word (a clause
        // written from the closer's own day would name the wrong day here).
        if (finalCard.vraag_bron === 'afsluiter' && !finalCard.boodschap && vraagVoorMorgen) {
          const context = contextVoorKaart(vraagVoorMorgen)
          if (context) {
            finalCard.boodschap = context
            contextAangevuld = true
          } else if (splitsContext(vraagVoorMorgen).context) {
            contextOvergelatenAanModel = true
          }
        }
        finalAntwoordOptiesRaw = parsed.antwoord_opties
        vraagVoorMorgenNietGebruiktReden = parsed.vraagVoorMorgenNietGebruiktReden
      } else {
        // Neither attempt 1 nor (if there was budget) a retry produced a
        // valid card — go straight to the hardcoded fallback. This now
        // covers every failure shape uniformly (timeout, API error,
        // malformed/invalid response): the guarantee is that the user
        // always gets a card with a real question, never nothing.
        cardBron = 'hardcoded_fallback'
        finalCard = buildHardcodedFallbackCard(todayInfo)
        finalAntwoordOptiesRaw = undefined
      }
    }

    // From here on, regardless of cardBron, finalCard is a complete, valid
    // card — the rest of this handler no longer branches on success/failure.
    //
    // 'mood' gets the client's fixed mood-reply buttons; anything else is a
    // real question but not one those buttons make sense as answers to —
    // free text (or antwoord_opties pills) instead. See Coach.jsx's
    // showQuickReplies for the one place this is consumed.
    const questionType = finalCard.vraag_type === 'stemming' ? 'mood' : 'other'

    // antwoord_opties is only ever validated for 'anders' — 'stemming'
    // (model-chosen or the hardcoded fallback, both share vraag_type
    // 'stemming') keeps its proven, model-independent behavior untouched
    // (fixed mood buttons, client-side).
    const antwoordOptiesResultaat: AntwoordOptiesResultaat =
      finalCard.vraag_type === 'anders'
        ? validateAntwoordOpties(finalAntwoordOptiesRaw)
        : { opties: null, aangeboden: ongevalideerdeAantal(finalAntwoordOptiesRaw), validatie: 'nvt', afkeurReden: null }

    logCheckinDiag({
      ...diagBasePayload,
      ts_utc: new Date().toISOString(),
      vraagVoorMorgen: {
        beschikbaar: vraagVoorMorgenBeschikbaar,
        // No real reconciliation decision happened on the fallback path —
        // false/null rather than left null, so a reader doesn't mistake
        // "no data" for "the model considered it and declined."
        gebruikt: cardBron === 'model' ? finalCard.vraag_bron === 'afsluiter' : false,
        nietGebruiktReden: cardBron === 'model' ? vraagVoorMorgenNietGebruiktReden : null,
        onderwerp: afsluiterOnderwerp,
        geblokkeerdWegensCap,
        dagwoordConversie: vraagVoorMorgen && vraagVoorMorgenOmgezet ? { voor: vraagVoorMorgen, na: vraagVoorMorgenOmgezet } : null,
        contextAangevuld,
        contextOvergelatenAanModel,
      },
      onderwerp: { waarde: finalCard.vraag_onderwerp, herlabeld: onderwerpHerlabeld },
      gecapteOnderwerpen: gecapt,
      vraag_type: finalCard.vraag_type,
      vraagTekst: finalCard.vraag,
      vraagBron: finalCard.vraag_bron,
      cardBron,
      timing,
      // Mirrors the `card:` response object below field-for-field, from the
      // same variables — never re-derived separately, so this can't drift
      // from what the client actually receives.
      kaart: {
        eyebrow: 'Ochtend check-in',
        vraag: finalCard.vraag,
        boodschap: finalCard.boodschap,
        contextLabel: finalCard.context_label,
        contextTekst: finalCard.context_tekst,
        vraagType: finalCard.vraag_type,
        // opties is non-null exactly when validatie is 'geaccepteerd' or
        // 'deels_geaccepteerd' (validateAntwoordOpties always sets it to
        // the kept list on both, null on 'nvt'/'afgekeurd') — checking the
        // field directly instead of enumerating both validatie strings
        // means this can't fall out of sync if another accepted-ish state
        // is ever added.
        antwoordOpties: antwoordOptiesResultaat.opties,
      },
      antwoordOpties: {
        aangeboden: antwoordOptiesResultaat.aangeboden,
        getoond: antwoordOptiesResultaat.opties?.length ?? 0,
        validatie: antwoordOptiesResultaat.validatie,
        afkeurReden: antwoordOptiesResultaat.afkeurReden,
        labels: diagnoseAntwoordOptieLabels(finalAntwoordOptiesRaw),
      },
      modelOk: cardBron === 'model',
    })

    // Durable record of what this card actually asked — separate from
    // checkin_diag (a diagnostics table documented as temporary, see the
    // plan's investigation notes) so the no-repeat check and the
    // never-two-stemming-days-running rule aren't built on top of a table
    // flagged for deletion. See logCheckinCard's own comment for the
    // first-write-wins reasoning. vraagTekst is now finalCard.vraag — the
    // model's dedicated question field (or the fallback's fixed one), never
    // boodschap (see CheckinDiagPayload's v6 comment for why that changed).
    logCheckinCard(todayDateStr, finalCard.vraag, finalCard.vraag_type, finalCard.vraag_bron, antwoordOptiesResultaat.opties, finalCard.vraag_onderwerp)

    return jsonResponse({
      card: {
        eyebrow: 'Ochtend check-in',
        question: finalCard.vraag,
        // Optional now — most cards omit it (see buildRenderCheckinTool's
        // vraag/boodschap field descriptions). Absent entirely rather than
        // sent as null/empty, consistent with answerOptions' own
        // sometimes-absent convention below.
        ...(finalCard.boodschap ? { boodschap: finalCard.boodschap } : {}),
        contextLabel: finalCard.context_label,
        contextText: finalCard.context_tekst,
        questionType,
        // Same opties != null check as kaart.antwoordOpties above — must
        // stay in sync with it (both come from the same
        // antwoordOptiesResultaat), or the checkin_diag row would say pills
        // were shown while the client never actually received them.
        ...(antwoordOptiesResultaat.opties != null ? { answerOptions: antwoordOptiesResultaat.opties } : {}),
      },
    })
  } catch (err) {
    console.error('morning-checkin error', err)
    return jsonResponse({ card: null })
  }
})
