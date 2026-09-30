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
  currentCalWeek,
  isoDateString,
  resolveActiveDate,
  resolveWeekPlan,
  resolveYesterdayIfOutsideWeek,
  sortMealsByActiveDayOrder,
  type WeekDayInfo,
} from '../_shared/today.ts'
import { callClaude } from '../_shared/anthropic.ts'
import { supabase } from '../_shared/supabaseClient.ts'

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
function allowedVraagBron(excludeStemming: boolean): VraagBron[] {
  return excludeStemming ? ALL_VRAAG_BRON.filter((b) => b !== 'stemming') : ALL_VRAAG_BRON
}

// Built as a function, not a static const, because its vraag_bron enum
// varies per request: when yesterday's card already used vraag_bron
// 'stemming', 'stemming' is removed from today's enum entirely so the
// model literally cannot select it twice running — the same
// structural-not-prompt-only treatment already applied to removing "geen".
function buildRenderCheckinTool(excludeStemming: boolean) {
  return {
    name: 'render_checkin_card',
    description: 'Render the morning check-in card.',
    input_schema: {
      type: 'object',
      properties: {
        boodschap: { type: 'string', description: 'The main reasoning/advice for the card, 1-2 sentences, Dutch.' },
        context_label: { type: 'string', description: 'Short label for the supporting context line, e.g. "Vandaag:"' },
        context_tekst: { type: 'string', description: 'The supporting context line itself, e.g. "Rustdag — mooi moment voor herstel."' },
        vraag_type: {
          type: 'string',
          enum: ['stemming', 'anders'],
          description:
            'What kind of question boodschap poses — every card asks something now, there is no "no question" option. "stemming": a mood/wellbeing question the user could answer with a general feeling (e.g. how did you sleep, how are you feeling) — reserved for vraag_bron "stemming" below, the client shows fixed mood-reply buttons for this case. "anders": any other kind of question (a specific time, a yes/no, something concrete about yesterday) — used for vraag_bron "afsluiter"/"maaltijden", where the question is concrete enough to have a specific answer, not a general mood check; the client shows free text input (or antwoord_opties pills) instead.',
        },
        vraag_bron: {
          type: 'string',
          enum: allowedVraagBron(excludeStemming),
          description:
            'Which source the question actually came from — report this honestly, it drives diagnostics and the no-repeat/no-two-stemming-days-running checks. "afsluiter": based on the vraag_voor_morgen klaargezet in de feiten hieronder (only when present AND still consistent with today\'s day-type). "maaltijden": based on de maaltijden van gisteren of het rooster van vandaag/gisteren — used whenever vraag_voor_morgen is absent or no longer consistent.' +
            (excludeStemming
              ? ' "stemming" is NIET beschikbaar vandaag — gisteren was de vraag al een stemmingsvraag, dus kies hier altijd "afsluiter" of "maaltijden", ook als er weinig materiaal is.'
              : ' "stemming": only when neither of the above yields anything usable.'),
        },
        antwoord_opties: {
          type: 'array',
          items: { type: 'string' },
          description: `Alleen invullen als vraag_type "anders" is en de vraag 2 of 3 natuurlijke, korte antwoorden heeft waarmee de gebruiker met één tik kan reageren (bijv. een keuze tussen twee tijdstippen, of een simpele ja/nee-variant). Elk label max ${ANTWOORD_OPTIE_MAX_LENGTH} tekens (dit is een bovengrens, geen doel — hou elk label zo kort als nog natuurlijk klinkt). Heeft de vraag geen natuurlijke korte antwoorden, laat dit veld dan gewoon weg — de gebruiker typt dan vrij.`,
        },
      },
      required: ['boodschap', 'context_label', 'context_tekst', 'vraag_type', 'vraag_bron'],
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

  return `Je schrijft een korte ochtend check-in kaart voor de voedingscoach-app "Coach" — het eerste wat de gebruiker ziet bij het openen van de app, in plaats van een generieke groet. Vier velden: een boodschap (1-2 zinnen, de kern van het advies), een context-regel (label + tekst, een korte ondersteunende regel), en vraag_type (welke vraag de boodschap stelt).

Feiten om op te baseren (gebruik alleen wat hier staat, verzin niets):
- Gisteren was een ${dayLabel(yesterday)}.
- Vandaag is een ${dayLabel(today)}.
${todayPowerHour ? '- Op een Power Hour-dag: geen nuchtere training, een normale eetdag met een snack rond 17:30 en de hoofdmaaltijd na de training.\n' : ''}- Zondag is de vaste beendag, altijd nuchter — de norm, niet de uitzondering.
${(yesterdayTraining || todayTraining) ? '- Spiereiwitsynthese blijft 24-48 uur verhoogd na een zware trainingssessie — de dag ná een trainingsdag mag ook eiwitrijk zijn.\n' : ''}${aandachtspunt ? `- Meegenomen aandachtspunt uit een eerdere dagafsluiting, wat de coach moet onthouden: "${aandachtspunt}" — dit kan over gisteren gaan, maar ook over een eerdere dag; gebruik alleen een dagaanduiding die letterlijk in deze tekst zelf staat, verzin er zelf geen bij.` : '- Geen aandachtspunt beschikbaar.'}
${vraagVoorMorgen ? `- Gisteren is deze vraag voor vandaag klaargezet: "${vraagVoorMorgen}".\n` : ''}- Maaltijden van gisteren (${eiwitTotaalGisteren}g eiwit totaal gelogd, doel ${EIWIT_DOEL_G}g):
${gisterenMealsText}
${recentTopics.length > 0 ? `- Onderwerp(en) van je laatste vraag/vragen (niet herhalen): ${recentTopics.map((t) => `"${t}"`).join(', ')}\n` : ''}${excludeStemming ? '- Gisteren was de vraag al een stemmingsvraag (vraag_bron "stemming") — dat kan vandaag niet nog een keer, zie de tool-opties.\n' : ''}${memoryBlock}

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
- Elke kaart stelt een vraag — er is geen "geen vraag"-optie meer. Kies de bron in deze volgorde en rapporteer die eerlijk in vraag_bron:
  a. ${vraagVoorMorgen ? `Er staat een vraag klaar (zie de feiten hierboven). Vergelijk hem met de "Vandaag is..."-feiten — verwijst hij naar iets dat nog moet gebeuren en klopt het veronderstelde dagtype nog, gebruik hem dan (natuurlijk verwoord, geen letterlijk citaat) met vraag_bron "afsluiter". Is hij duidelijk achterhaald (de genoemde actie is al gebeurd, of het dagtype klopt niet meer), val terug op optie b.` : 'Er staat geen vraag klaar vanuit gisteren — ga direct naar optie b.'}
  b. Baseer een vraag op iets concreets uit de maaltijden van gisteren hierboven (bv. een tijdstip, wat er gegeten werd) of op het rooster van vandaag/gisteren, met vraag_bron "maaltijden".
  ${excludeStemming ? '' : 'c. Alleen als zowel a als b niets bruikbaars opleveren: een stemmingsvraag, vraag_type "stemming", vraag_bron "stemming".\n  '}
- vraag_type "stemming" hoort uitsluitend bij vraag_bron "stemming" (optie c) — een vraag over hoe iemand zich voelt of geslapen heeft, waar een algemeen gevoel een passend antwoord op is. vraag_bron "afsluiter" of "maaltijden" hoort altijd bij vraag_type "anders": die vragen zijn concreet genoeg om een specifiek antwoord te hebben, ook als het onderwerp toevallig gevoel-gerelateerd aandoet.
- Als vraag_type "anders" is en de vraag 2 of 3 natuurlijke, korte antwoorden heeft waarmee de gebruiker met één tik kan reageren, geef die dan mee in antwoord_opties (2 of 3 korte labels, elk max ${ANTWOORD_OPTIE_MAX_LENGTH} tekens — dit is een bovengrens, geen doel; hou elk label zo kort als nog natuurlijk klinkt). Heeft de vraag geen natuurlijke korte antwoorden, of twijfel je, laat antwoord_opties dan gewoon weg — vrij typen is een prima uitkomst. Verzin geen opties die de vraag versimpelen of een keuze suggereren die er niet is.
${recentTopics.length > 0 ? '- Herhaal niet het onderwerp van een van je laatste vragen hierboven — kies iets anders, ook al is optie a of b daardoor minder voor de hand liggend.\n' : ''}- Gebruik het render_checkin_card tool om dit vast te leggen.`
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
interface CheckinDiagPayload {
  v: 5
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
  vraag_type: string | null
  // The literal question text the model asked — `boodschap` doubles as the
  // question (there's no separate "question" field in the model's own
  // output, see buildRenderCheckinTool). Always populated on the success
  // path since v5 (vraag_type is never 'geen' anymore); null only on the
  // early-exit paths where no model output exists at all, or on v3/v4 rows
  // where vraag_type was 'geen'.
  vraagTekst: string | null
  // Which priority tier (see buildSystemPrompt) the model self-reported
  // using — 'afsluiter' | 'maaltijden' | 'stemming' | null. null on every
  // early-exit path (no model output) and on all v1-v4 rows (field didn't
  // exist yet). This is the single source both the no-repeat check and the
  // never-two-stemming-days-running rule read back the next day, via
  // coach_checkin_card rather than this diagnostics table — see that
  // table's own write below for why.
  vraagBron: VraagBron | null
  // The full check-in card as returned to the client, mirrored field-for-
  // field from the same variables the `card:` response object below is
  // built from — never re-derived separately, so the two can't drift.
  // null wherever no card was built (every early-exit path).
  kaart: {
    eyebrow: string
    boodschap: string
    contextLabel: string
    contextTekst: string
    vraagType: string
    antwoordOpties: string[] | null
  } | null
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
function logCheckinCard(datum: string, vraagTekst: string, vraagType: string, vraagBron: VraagBron, antwoordOpties: string[] | null) {
  const insert = supabase
    .from('coach_checkin_card')
    .upsert(
      { datum, vraag_tekst: vraagTekst, vraag_type: vraagType, vraag_bron: vraagBron, antwoord_opties: antwoordOpties },
      { onConflict: 'datum', ignoreDuplicates: true },
    )
    .then(({ error }) => {
      if (error) console.error('coach_checkin_card upsert failed', error)
    })
    .catch((err) => console.error('coach_checkin_card upsert threw', err))
  EdgeRuntime.waitUntil(insert)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
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
    const todayCalWeek = currentCalWeek(activeDate)
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
    const [weekPlan, yesterdayOutside, sessionRes, memoryRes, mealsRes, recentCardsRes] = await Promise.all([
      resolveWeekPlan(todayCalWeek, todayWeekday),
      // Only ever resolves something on a Monday (see _shared/today.ts) —
      // every other day, yesterday is already inside this week's own
      // Mon-Sun grid at weekday-1.
      resolveYesterdayIfOutsideWeek(activeDate, todayWeekday),
      // Same select shape as Coach.jsx's fetchTodaySummary, now also
      // reading vraag_voor_morgen (see _shared/summary.ts) for priority (a)
      // of the question ladder in buildSystemPrompt.
      supabase.from('coach_sessions').select('aandachtspunt, vraag_voor_morgen').eq('datum', yesterdayDateStr).limit(1),
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
    ])

    const todayInfo: DayFact = weekPlan.find((d) => d.isToday) ?? { dayType: null, naam: null }
    const yesterdayInfo: DayFact = yesterdayOutside ?? weekPlan.find((d) => d.weekday === todayWeekday - 1) ?? { dayType: null, naam: null }

    const yesterdaySession = sessionRes.data
    const aandachtspunt: string | null = yesterdaySession && yesterdaySession.length > 0 ? yesterdaySession[0].aandachtspunt ?? null : null
    const vraagVoorMorgen: string | null = yesterdaySession && yesterdaySession.length > 0 ? yesterdaySession[0].vraag_voor_morgen ?? null : null

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
      v: 5 as const,
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

    // No model output exists yet at any of these four early exits, so
    // there is genuinely nothing to count/show — 0/null/[] here isn't a
    // hardcoded shortcut, it's simply true.
    const NO_ANTWOORD_OPTIES = { aangeboden: 0, getoond: 0, validatie: 'nvt' as const, afkeurReden: null, labels: [] }
    const NO_KAART = null

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY secret is not set')
      logCheckinDiag({ ...diagBasePayload, ts_utc: new Date().toISOString(), vraag_type: null, vraagTekst: null, vraagBron: null, kaart: NO_KAART, antwoordOpties: NO_ANTWOORD_OPTIES, modelOk: false })
      return jsonResponse({ card: null })
    }

    const result = await callClaude(apiKey, {
      model: 'claude-sonnet-5',
      system: buildSystemPrompt(yesterdayInfo, todayInfo, isThursday, aandachtspunt, memoryFacts, vraagVoorMorgen, gisterenMeals, recentTopics, gisterenWasStemming),
      messages: [{ role: 'user', content: 'Genereer de ochtend check-in kaart voor vandaag.' }],
      tools: [buildRenderCheckinTool(gisterenWasStemming)],
      toolChoice: { type: 'tool', name: 'render_checkin_card' },
      maxTokens: 400,
    })

    if (!result.ok) {
      console.error('morning-checkin: Claude call failed', result.status, result.errorText)
      logCheckinDiag({ ...diagBasePayload, ts_utc: new Date().toISOString(), vraag_type: null, vraagTekst: null, vraagBron: null, kaart: NO_KAART, antwoordOpties: NO_ANTWOORD_OPTIES, modelOk: false })
      return jsonResponse({ card: null })
    }

    const toolUse = result.data?.content.find((b) => b.type === 'tool_use')
    if (!toolUse || !toolUse.input) {
      logCheckinDiag({ ...diagBasePayload, ts_utc: new Date().toISOString(), vraag_type: null, vraagTekst: null, vraagBron: null, kaart: NO_KAART, antwoordOpties: NO_ANTWOORD_OPTIES, modelOk: false })
      return jsonResponse({ card: null })
    }

    const { boodschap, context_label, context_tekst, vraag_type, vraag_bron, antwoord_opties } = toolUse.input as {
      boodschap?: string
      context_label?: string
      context_tekst?: string
      vraag_type?: 'stemming' | 'anders'
      vraag_bron?: VraagBron
      antwoord_opties?: unknown
    }
    if (
      !boodschap ||
      !context_label ||
      !context_tekst ||
      !vraag_type ||
      !['stemming', 'anders'].includes(vraag_type) ||
      !vraag_bron ||
      !allowedVraagBron(gisterenWasStemming).includes(vraag_bron)
    ) {
      logCheckinDiag({
        ...diagBasePayload,
        ts_utc: new Date().toISOString(),
        vraag_type: vraag_type ?? null,
        vraagTekst: null,
        vraagBron: vraag_bron ?? null,
        kaart: NO_KAART,
        antwoordOpties: (() => {
          const labels = diagnoseAntwoordOptieLabels(antwoord_opties)
          return {
            aangeboden: ongevalideerdeAantal(antwoord_opties),
            getoond: labels.filter((l) => 'behouden' in l && l.behouden).length,
            validatie: 'nvt' as const,
            afkeurReden: null,
            labels,
          }
        })(),
        modelOk: false,
      })
      return jsonResponse({ card: null })
    }

    // 'mood' gets the client's fixed mood-reply buttons; anything else is a
    // real question but not one those buttons make sense as answers to —
    // free text (or antwoord_opties pills) instead. vraag_type is never
    // 'geen' anymore (see buildRenderCheckinTool), so this is no longer a
    // three-way branch. See Coach.jsx's showQuickReplies for the one place
    // this is consumed.
    const questionType = vraag_type === 'stemming' ? 'mood' : 'other'

    // antwoord_opties is only ever validated for 'anders' — 'stemming'
    // keeps its proven, model-independent behavior untouched (fixed mood
    // buttons, client-side). The model may still have put something in
    // antwoord_opties on 'stemming' (or the field could be malformed in
    // some other way) — that's recorded via ongevalideerdeAantal (count
    // only, no validation), not silently discarded as a hardcoded 0.
    const antwoordOptiesResultaat: AntwoordOptiesResultaat =
      vraag_type === 'anders'
        ? validateAntwoordOpties(antwoord_opties)
        : { opties: null, aangeboden: ongevalideerdeAantal(antwoord_opties), validatie: 'nvt', afkeurReden: null }

    // boodschap always doubles as the question now — vraag_type is never
    // 'geen' anymore, so there's no case where a card has no question to
    // record. See CheckinDiagPayload's field comment.
    logCheckinDiag({
      ...diagBasePayload,
      ts_utc: new Date().toISOString(),
      vraag_type,
      vraagTekst: boodschap,
      vraagBron: vraag_bron,
      // Mirrors the `card:` response object below field-for-field, from the
      // same variables — never re-derived separately, so this can't drift
      // from what the client actually receives.
      kaart: {
        eyebrow: 'Ochtend check-in',
        boodschap,
        contextLabel: context_label,
        contextTekst: context_tekst,
        vraagType: vraag_type,
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
        labels: diagnoseAntwoordOptieLabels(antwoord_opties),
      },
      modelOk: true,
    })

    // Durable record of what this card actually asked — separate from
    // checkin_diag (a diagnostics table documented as temporary, see the
    // plan's investigation notes) so the no-repeat check and the
    // never-two-stemming-days-running rule aren't built on top of a table
    // flagged for deletion. See logCheckinCard's own comment for the
    // first-write-wins reasoning.
    logCheckinCard(todayDateStr, boodschap, vraag_type, vraag_bron, antwoordOptiesResultaat.opties)

    return jsonResponse({
      card: {
        eyebrow: 'Ochtend check-in',
        question: boodschap,
        contextLabel: context_label,
        contextText: context_tekst,
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
