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
// was the actual problem. See buildSystemPrompt's hasNotableSignal for how
// this function now handles a day where none of the old trigger conditions
// hold — it no longer means "don't call," it means "write a plain opening
// instead of manufacturing a hook."

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  amsterdamNow,
  currentCalWeek,
  isoDateString,
  resolveActiveDate,
  resolveWeekPlan,
  resolveYesterdayIfOutsideWeek,
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

// Longest existing fixed mood label ("Niet zo goed") is 12 characters
// (code-point length); this gives ~1.5-2x headroom for a model-supplied
// answer option while still guaranteeing a single-line, non-wrapping pill
// (.quick-reply in Coach.css is white-space: nowrap) at any supported phone
// width. Referenced from both RENDER_CHECKIN_TOOL's schema description and
// buildSystemPrompt's prompt text below, so the model-facing number and the
// validator's enforced number can never drift apart.
const ANTWOORD_OPTIE_MAX_LENGTH = 20

const RENDER_CHECKIN_TOOL = {
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
        enum: ['geen', 'stemming', 'anders'],
        description:
          'Whether boodschap poses a question, and what kind. "geen": a statement, nothing to reply to. "stemming": a mood/wellbeing question the user could answer with a general feeling (e.g. how did you sleep, how are you feeling) — the client shows fixed mood-reply buttons for this case. "anders": any other kind of question (e.g. asking for a specific time, a yes/no unrelated to mood) — mood buttons would not make sense as answers, so the client shows free text input only.',
      },
      antwoord_opties: {
        type: 'array',
        items: { type: 'string' },
        description: `Alleen invullen als vraag_type "anders" is en de vraag 2 of 3 natuurlijke, korte antwoorden heeft waarmee de gebruiker met één tik kan reageren (bijv. een keuze tussen twee tijdstippen, of een simpele ja/nee-variant). Elk label max ${ANTWOORD_OPTIE_MAX_LENGTH} tekens. Heeft de vraag geen natuurlijke korte antwoorden, laat dit veld dan gewoon weg — de gebruiker typt dan vrij.`,
      },
    },
    required: ['boodschap', 'context_label', 'context_tekst', 'vraag_type'],
  },
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
// (removed — see the file header); now repurposed inside buildSystemPrompt
// to help decide hasNotableSignal, i.e. whether there's anything to hook
// the card on today, since this function can no longer assume the old gate
// already guaranteed that. The client-side copy in voeding-app/src/lib/
// morningCheckin.js is genuinely dead now (that file no longer computes any
// signal at all, unconditional there) — kept, unused, in a comment noting
// why, same runtime-duplication precedent as currentCalWeek in that file.
//
// Not exhaustive by design: catches the actual reproduction case ("vraag
// hoe hij geslapen heeft" has no "?" but contains "vraag"), misses other
// phrasings (e.g. "polsen hoe het ging"). Accepted — the same "good enough"
// tolerance as the weight-trend week-averaging heuristic, not a permanent
// design. A structured flag set by the day-close model itself would be
// more reliable, but that means touching _shared/summary.ts's tool schema,
// which is the day-close flow — out of scope for this fix.
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

export type AntwoordOptieAfkeurReden =
  | 'geen_array'
  | 'te_weinig_opties'
  | 'te_veel_opties'
  | 'leeg_label'
  | 'label_te_lang'
  | 'duplicaat_label'
  | null

export interface AntwoordOptiesResultaat {
  opties: string[] | null
  aangeboden: number // 0 when absent, empty array, or not an array
  validatie: 'nvt' | 'geaccepteerd' | 'afgekeurd'
  afkeurReden: AntwoordOptieAfkeurReden
}

// Validates the model's optional antwoord_opties field (see
// RENDER_CHECKIN_TOOL's schema above) — only ever called when vraag_type ===
// 'anders' (see the Deno.serve handler below); 'stemming'/'geen' never touch
// this, by design. Fails closed: any check failing drops the whole field
// (opties: null), never a partial/truncated list — a malformed set must
// degrade to today's no-pills behavior, not a repaired or truncated row.
//
// Absent/empty ('nvt') and "the model supplied something but it didn't pass"
// ('afgekeurd') are deliberately different validatie values even though both
// end in "no pills" — that distinction is the whole point of recording this
// in checkin_diag: otherwise "the model supplied nothing" and "validation
// rejected what it supplied" are indistinguishable after the fact.
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

  // Trim before every check below, and store the trimmed values rather than
  // raw — otherwise " Ja " passes the empty check and is stored with its
  // padding, and worse, "Ja" vs "Ja " pass the duplicate check (distinct by
  // Set identity) while rendering as two pills the user can't tell apart.
  // Trimming is the only normalization applied — still fails closed, no
  // other repair.
  const trimmed = raw.map((label) => label.trim())
  if (trimmed.some((label) => label.length === 0)) {
    return { opties: null, aangeboden, validatie: 'afgekeurd', afkeurReden: 'leeg_label' }
  }
  if (trimmed.some((label) => [...label].length > ANTWOORD_OPTIE_MAX_LENGTH)) {
    return { opties: null, aangeboden, validatie: 'afgekeurd', afkeurReden: 'label_te_lang' }
  }
  if (new Set(trimmed).size !== aangeboden) {
    return { opties: null, aangeboden, validatie: 'afgekeurd', afkeurReden: 'duplicaat_label' }
  }
  return { opties: trimmed, aangeboden, validatie: 'geaccepteerd', afkeurReden: null }
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
  | { waarde: string; lengte: number }
  | { waarde: null; ruwType: string }

// Per-option diagnostic view of whatever the model supplied in
// antwoord_opties, independent of validateAntwoordOpties's pass/fail
// verdict — logged on BOTH the accepted and rejected path (a limit tuned
// only on rejections is tuned on half the distribution). `lengte` reuses
// validateAntwoordOpties's own [...label].length code-point count (not
// .length — see that function's comment), so the logged number and the
// enforced number can never disagree for the same input. `waarde` is
// post-trim, the only normalisation the validator performs, so it's what
// was actually measured against the limit.
//
// Two different malformed shapes both fail validateAntwoordOpties with
// 'geen_array' and must stay distinguishable here, not collapse into the
// same logged output: raw not being an array at all, vs. an array
// containing a non-string item. The non-array case logs the fixed marker
// ruwType: 'geen_array' — not typeof raw — precisely so it can never read
// the same as an array holding one non-string item (which logs its own
// typeof, e.g. 'object'/'number'). Using typeof for both would make
// `{foo: 1}` and `[{foo: 1}]` produce an identical entry.
export function diagnoseAntwoordOptieLabels(raw: unknown): AntwoordOptieLabelDiag[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) return [{ waarde: null, ruwType: 'geen_array' }]
  return raw.map((item): AntwoordOptieLabelDiag => {
    if (typeof item !== 'string') return { waarde: null, ruwType: typeof item }
    const trimmed = item.trim()
    return { waarde: trimmed, lengte: [...trimmed].length }
  })
}

// Own short prompt, not the full PERSONA_PROMPT — same reasoning
// _shared/summary.ts already uses its own narrower prompts for the
// day-summary rather than the persona block. This task is much smaller
// than a full conversation: a few facts in, three-to-four fields out.
function buildSystemPrompt(yesterday: DayFact, today: DayFact, isThursday: boolean, aandachtspunt: string | null): string {
  const yesterdayTraining = yesterday.dayType === 'training'
  const todayTraining = today.dayType === 'training'
  // Was only ever computed (as yesterdayTraining/todayTraining/
  // hasHandoverQuestion) to feed the old trigger gate in the Deno.serve
  // handler below — that gate is gone (see file header), and this function
  // now runs on days none of these hold. hasNotableSignal is the
  // replacement question: not "should I even call Claude" (always yes
  // now), but "is there something real to hook the card's content on, or
  // should it just be a plain opening." Computed here, from data this
  // function already receives, rather than threaded in as a handler-level
  // param — nothing outside this function needs it.
  //
  // `aandachtspunt` here must always be the raw value straight from
  // coach_sessions (see the Deno.serve handler's fetch below) — never a
  // filtered or presentation-adjusted variant. A signal input must never be
  // silently suppressed by a display decision; this held by accident once
  // (the now-removed drop filter fed its filtered text into this exact
  // calculation), so it's called out explicitly here rather than left to be
  // true only because nothing currently filters this parameter.
  const hasNotableSignal = yesterdayTraining || todayTraining || isThursday || aandachtspuntHasQuestion(aandachtspunt)

  return `Je schrijft een korte ochtend check-in kaart voor de voedingscoach-app "Coach" — het eerste wat de gebruiker ziet bij het openen van de app, in plaats van een generieke groet. Vier velden: een boodschap (1-2 zinnen, de kern van het advies), een context-regel (label + tekst, een korte ondersteunende regel), en vraag_type (of de boodschap een vraag stelt, en zo ja wat voor soort).

Feiten om op te baseren (gebruik alleen wat hier staat, verzin niets):
- Gisteren was een ${dayLabel(yesterday)}.
- Vandaag is een ${dayLabel(today)}.
${isThursday ? '- Vandaag is donderdag: Power Hour (trainer-geleide HIIT, kracht en cardio) om 19:00, dus niet nuchter trainen die dag — een normale eetdag met een snack rond 17:30 en de hoofdmaaltijd na de training.\n' : ''}- Zondag is de vaste beendag, altijd nuchter — de norm, niet de uitzondering.
${(yesterdayTraining || todayTraining) ? '- Spiereiwitsynthese blijft 24-48 uur verhoogd na een zware trainingssessie — de dag ná een trainingsdag mag ook eiwitrijk zijn.\n' : ''}${aandachtspunt ? `- Meegenomen aandachtspunt uit een eerdere dagafsluiting, wat de coach moet onthouden: "${aandachtspunt}" — dit kan over gisteren gaan, maar ook over een eerdere dag; gebruik alleen een dagaanduiding die letterlijk in deze tekst zelf staat, verzin er zelf geen bij.` : '- Geen aandachtspunt beschikbaar.'}

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
- Noem NOOIT gewicht, een gewichtstrend of onderhoudsniveau — ook niet als dit in het aandachtspunt hierboven voorkomt. Dit wordt bewust nergens teruggegeven, ook niet hier.
- Geen schuldgevoel-taal, geen "je zat ver onder/boven je doel" — dit gaat over training en herstel, niet over hoe gisteren scoorde tegenover een doel.
- Gebruik een dagwoord als "gisteren" of "vandaag" alleen als dat rechtstreeks klopt met de "Gisteren was..."/"Vandaag is..."-feiten hierboven, of met een dagaanduiding die letterlijk in het aandachtspunt zelf staat. Verwijs je naar iets uit het aandachtspunt waarvan de dag niet met zekerheid vaststaat, gebruik dan gewoon geen dagwoord ("na de boksles" in plaats van "gisteren na de boksles") — verzin er nooit een bij.
- Schrijf natuurlijk Nederlands: vorm nooit een bezitsvorm door 's of se aan een dagnaam of bijwoord te plakken (fout: "gisteren se rustdag", "gisteren's sessie") — gebruik in plaats daarvan "de rustdag van gisteren" of "gisteren was een rustdag".
- De boodschap en de context-regel mogen elkaar nooit tegenspreken over welke dag iets was.
${!hasNotableSignal ? '- Niets bijzonders vandaag: geen training gisteren of vandaag, geen donderdag, geen aandachtspunt met iets te vragen. Schrijf dan een gewone, rustige opening die simpelweg aansluit bij het dag-type van vandaag hierboven, zonder een kunstmatige vraag, haak of trainingsverwijzing te verzinnen die er niet is. vraag_type is in dit geval altijd "geen".\n' : ''}- Motiverende, warme toon, kort en concreet — geen algemeenheid die net zo goed op elke willekeurige dag zou passen.
- vraag_type: "geen" als de boodschap een statement of constatering is, zonder iets te vragen. Stelt de boodschap wél een vraag, kies dan tussen "stemming" (een vraag over hoe iemand zich voelt of geslapen heeft — iets waar een algemeen gevoel een passend antwoord op is) en "anders" (elke andere vraag, bijvoorbeeld naar een tijdstip, een keuze, of iets specifieks dat niets met stemming te maken heeft).
- Als vraag_type "anders" is en de vraag 2 of 3 natuurlijke, korte antwoorden heeft waarmee de gebruiker met één tik kan reageren, geef die dan mee in antwoord_opties (2 of 3 korte labels, elk max ${ANTWOORD_OPTIE_MAX_LENGTH} tekens). Heeft de vraag geen natuurlijke korte antwoorden, of twijfel je, laat antwoord_opties dan gewoon weg — vrij typen is een prima uitkomst. Verzin geen opties die de vraag versimpelen of een keuze suggereren die er niet is.
- Gebruik het render_checkin_card tool om dit vast te leggen.`
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
interface CheckinDiagPayload {
  v: 3
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
  // question when vraag_type !== 'geen' (there's no separate "question"
  // field in the model's own output, see RENDER_CHECKIN_TOOL). null when
  // vraag_type is 'geen', or on any early exit where no model output exists.
  vraagTekst: string | null
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
    validatie: 'nvt' | 'geaccepteerd' | 'afgekeurd'
    afkeurReden: AntwoordOptieAfkeurReden
    // Per-option content (label + measured length), logged on both the
    // accepted and rejected path — see diagnoseAntwoordOptieLabels. Added
    // 2026-09-08 after the first real rejection (06-09, label_te_lang)
    // proved unanswerable from `afkeurReden` alone: it names which rule
    // failed first, never what the label actually said or how long it was.
    // No version bump — a sibling key on an existing object, absent (not
    // misleading) on every row before this shipped.
    labels: AntwoordOptieLabelDiag[]
  }
  modelOk: boolean
}

// Diagnostic-only: distinguishes "the model returned vraag_type: 'geen'"
// from "the model returned a question that failed to render" — currently
// indistinguishable from the client's perspective. console.log line is the
// same-day debugging copy; the checkin_diag row (diagServiceClient, RLS
// locked to service-role) is the durable copy, since this project's log
// retention (Free plan, 1 day) can't support the open-ended observation
// window this feeds. Two independent failure boundaries rather than one
// shared try/catch, so an insert failure can never suppress the console
// line or vice versa. The insert is not awaited — EdgeRuntime.waitUntil is
// Supabase's documented mechanism for background work that must not add
// latency to the response but must still reliably complete.
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

    const weekPlan = await resolveWeekPlan(todayCalWeek, todayWeekday)
    const todayInfo: DayFact = weekPlan.find((d) => d.isToday) ?? { dayType: null, naam: null }

    // resolveYesterdayIfOutsideWeek only ever resolves something on a
    // Monday (see _shared/today.ts) — every other day, yesterday is already
    // inside this week's own Mon-Sun grid at weekday-1.
    const yesterdayOutside = await resolveYesterdayIfOutsideWeek(activeDate, todayWeekday)
    const yesterdayInfo: DayFact = yesterdayOutside ?? weekPlan.find((d) => d.weekday === todayWeekday - 1) ?? { dayType: null, naam: null }

    // Yesterday's coach_sessions.aandachtspunt — plain date arithmetic, not
    // the calendar-week machinery above (that's for mapping to
    // schema_days/week_overrides, irrelevant to a literal coach_sessions
    // row lookup). Same select shape as Coach.jsx's fetchTodaySummary.
    const yesterdayDate = new Date(activeDate)
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)
    const yesterdayDateStr = isoDateString(yesterdayDate)
    const { data: yesterdaySession } = await supabase.from('coach_sessions').select('aandachtspunt').eq('datum', yesterdayDateStr).limit(1)
    const aandachtspunt: string | null = yesterdaySession && yesterdaySession.length > 0 ? yesterdaySession[0].aandachtspunt ?? null : null

    const isThursday = todayWeekday === 4

    // checkin-diag: computed once here from data this handler already has,
    // deliberately duplicating (not reusing) buildSystemPrompt's identical
    // internal booleans — same precedent as aandachtspuntHasQuestion/
    // currentCalWeek elsewhere in this codebase, so buildSystemPrompt's own
    // signature and behavior stay completely untouched by this diagnostic.
    const gisterenGetraind = yesterdayInfo.dayType === 'training'
    const vandaagTrainingsdag = todayInfo.dayType === 'training'
    const vandaagPowerHour = isThursday
    // Raw aandachtspunt, straight from the coach_sessions query above —
    // never a filtered/presentation-adjusted variant. See buildSystemPrompt's
    // matching comment on its own hasNotableSignal line: a signal input must
    // never be silently suppressed by a display decision.
    const aandachtspuntGeeftSignaal = aandachtspuntHasQuestion(aandachtspunt)
    const diagBasePayload = {
      v: 3 as const,
      datum_lokaal: isoDateString(activeDate),
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
    const NO_ANTWOORD_OPTIES = { aangeboden: 0, validatie: 'nvt' as const, afkeurReden: null, labels: [] }
    const NO_KAART = null

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY secret is not set')
      logCheckinDiag({ ...diagBasePayload, ts_utc: new Date().toISOString(), vraag_type: null, vraagTekst: null, kaart: NO_KAART, antwoordOpties: NO_ANTWOORD_OPTIES, modelOk: false })
      return jsonResponse({ card: null })
    }

    const result = await callClaude(apiKey, {
      model: 'claude-sonnet-5',
      system: buildSystemPrompt(yesterdayInfo, todayInfo, isThursday, aandachtspunt),
      messages: [{ role: 'user', content: 'Genereer de ochtend check-in kaart voor vandaag.' }],
      tools: [RENDER_CHECKIN_TOOL],
      toolChoice: { type: 'tool', name: 'render_checkin_card' },
      maxTokens: 400,
    })

    if (!result.ok) {
      console.error('morning-checkin: Claude call failed', result.status, result.errorText)
      logCheckinDiag({ ...diagBasePayload, ts_utc: new Date().toISOString(), vraag_type: null, vraagTekst: null, kaart: NO_KAART, antwoordOpties: NO_ANTWOORD_OPTIES, modelOk: false })
      return jsonResponse({ card: null })
    }

    const toolUse = result.data?.content.find((b) => b.type === 'tool_use')
    if (!toolUse || !toolUse.input) {
      logCheckinDiag({ ...diagBasePayload, ts_utc: new Date().toISOString(), vraag_type: null, vraagTekst: null, kaart: NO_KAART, antwoordOpties: NO_ANTWOORD_OPTIES, modelOk: false })
      return jsonResponse({ card: null })
    }

    const { boodschap, context_label, context_tekst, vraag_type, antwoord_opties } = toolUse.input as {
      boodschap?: string
      context_label?: string
      context_tekst?: string
      vraag_type?: 'geen' | 'stemming' | 'anders'
      antwoord_opties?: unknown
    }
    if (!boodschap || !context_label || !context_tekst || !vraag_type || !['geen', 'stemming', 'anders'].includes(vraag_type)) {
      logCheckinDiag({
        ...diagBasePayload,
        ts_utc: new Date().toISOString(),
        vraag_type: vraag_type ?? null,
        vraagTekst: null,
        kaart: NO_KAART,
        antwoordOpties: {
          aangeboden: ongevalideerdeAantal(antwoord_opties),
          validatie: 'nvt',
          afkeurReden: null,
          labels: diagnoseAntwoordOptieLabels(antwoord_opties),
        },
        modelOk: false,
      })
      return jsonResponse({ card: null })
    }

    // 'mood' gets the client's fixed mood-reply buttons; 'other' is a real
    // question but not one those buttons make sense as answers to (e.g.
    // asking for a time) — free text only; 'none' is a plain statement.
    // See Coach.jsx's showQuickReplies for the one place this is consumed.
    const questionType = vraag_type === 'stemming' ? 'mood' : vraag_type === 'anders' ? 'other' : 'none'

    // antwoord_opties is only ever validated for 'anders' — 'stemming'/
    // 'geen' keep their proven, model-independent behavior untouched. The
    // model may still have put something in antwoord_opties on those two
    // (or the field could be malformed in some other way) — that's recorded
    // via ongevalideerdeAantal (count only, no validation), not silently
    // discarded as a hardcoded 0.
    const antwoordOptiesResultaat: AntwoordOptiesResultaat =
      vraag_type === 'anders'
        ? validateAntwoordOpties(antwoord_opties)
        : { opties: null, aangeboden: ongevalideerdeAantal(antwoord_opties), validatie: 'nvt', afkeurReden: null }

    logCheckinDiag({
      ...diagBasePayload,
      ts_utc: new Date().toISOString(),
      vraag_type,
      // boodschap doubles as the question when there is one — see the
      // CheckinDiagPayload field comment.
      vraagTekst: vraag_type === 'geen' ? null : boodschap,
      // Mirrors the `card:` response object below field-for-field, from the
      // same variables — never re-derived separately, so this can't drift
      // from what the client actually receives.
      kaart: {
        eyebrow: 'Ochtend check-in',
        boodschap,
        contextLabel: context_label,
        contextTekst: context_tekst,
        vraagType: vraag_type,
        antwoordOpties: antwoordOptiesResultaat.validatie === 'geaccepteerd' ? antwoordOptiesResultaat.opties : null,
      },
      antwoordOpties: {
        aangeboden: antwoordOptiesResultaat.aangeboden,
        validatie: antwoordOptiesResultaat.validatie,
        afkeurReden: antwoordOptiesResultaat.afkeurReden,
        labels: diagnoseAntwoordOptieLabels(antwoord_opties),
      },
      modelOk: true,
    })

    return jsonResponse({
      card: {
        eyebrow: 'Ochtend check-in',
        question: boodschap,
        contextLabel: context_label,
        contextText: context_tekst,
        questionType,
        ...(antwoordOptiesResultaat.validatie === 'geaccepteerd' ? { answerOptions: antwoordOptiesResultaat.opties } : {}),
      },
    })
  } catch (err) {
    console.error('morning-checkin error', err)
    return jsonResponse({ card: null })
  }
})
