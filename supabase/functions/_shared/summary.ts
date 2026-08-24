// Shared end-of-day summary generation, used by both triggers:
// - coach-chat's close_day_summary tool (rich: conversation + logged data)
// - close-day-cron (thin: logged data only, no conversation access)

import { supabase } from './supabaseClient.ts'
import { currentCalWeek, resolveTodayWorkout } from './today.ts'
import { callClaude } from './anthropic.ts'

const RECORD_SUMMARY_TOOL = {
  name: 'record_summary',
  description: 'Record the end-of-day summary for the user.',
  input_schema: {
    type: 'object',
    properties: {
      samenvatting: { type: 'string', description: 'Short reflective summary of the day, in Dutch, 1-2 sentences.' },
      aandachtspunt: { type: 'string', description: 'What to carry into tomorrow, in Dutch.' },
    },
    required: ['samenvatting', 'aandachtspunt'],
  },
}

function dateFromIsoString(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Full Dutch weekday names, indexed by getDay()||7 - 1 (Ma=0..Zo=6). No
// existing export to reuse: _shared/today.ts's WEEKDAY_LABELS is
// abbreviated ("Ma"/"Di") and module-private, needed here in full-word
// form so the day-anchor instruction below reads as natural prose.
const WEEKDAG_NAMEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']

function weekdagNaam(d: Date): string {
  return WEEKDAG_NAMEN[(d.getDay() || 7) - 1]
}

async function resolveWorkoutForDate(datum: string): Promise<string> {
  const d = dateFromIsoString(datum)
  const calWeek = currentCalWeek(d)
  const weekday = d.getDay() || 7
  return resolveTodayWorkout(calWeek, weekday)
}

// Real bug (2026-08-22): an aandachtspunt referencing a training session
// from two days earlier ("de boksles") got carried into morning-checkin's
// prompt with no day attached, which then invented "gisteren" for it — the
// event was actually Thursday, not literally the day before. Without an
// absolute anchor (a weekday name or date), "name the day" is
// unenforceable — the model closing this day has no other way to know
// what weekday it even is, only relative "vandaag"/"trainingsdag" framing.
// This single line is that anchor, shared by both prompt variants below.
function dagAnchorLine(datum: string): string {
  return `Dit is de samenvatting voor ${weekdagNaam(dateFromIsoString(datum))} ${datum}.`
}

// Shared by both prompt variants — the anchoring instruction itself, right
// next to where aandachtspunt is generated (point-of-use, same pattern as
// every other rule in this codebase). A relative day word ("gisteren")
// written into the note is only ever read correctly on the one day it was
// written; carried into a later day's context (which is the whole point of
// aandachtspunt) it silently means the wrong day. Naming the actual weekday
// survives that carry-over; "gisteren" doesn't.
const AANDACHTSPUNT_ANKER_REGEL =
  '- Verwijst het aandachtspunt naar een gebeurtenis op een specifieke dag (een training, maaltijd, klacht) → noem die dag erbij (bv. "de boksles van donderdag"), nooit de gebeurtenis kaal. Gebruik zelf GEEN relatief dagwoord als "gisteren" of "vandaag" in het aandachtspunt — dit wordt op een latere dag door een ander proces gelezen, waar zo\'n woord een andere dag zou betekenen.'

function buildRichSystemPrompt(datum: string, workoutSummary: string, mealsText: string): string {
  return `Je bent een samenvattingsmodel voor de voedingscoach-app "Coach". Je taak: comprimeer één dag naar twee korte velden voor coach_sessions — samenvatting en aandachtspunt. Dit vervangt het bewaren van de losse chatberichten; wat je hier niet vastlegt is morgen weg.

${dagAnchorLine(datum)}

Je krijgt hieronder het volledige gesprek van vandaag, plus de daadwerkelijk gelogde maaltijden en trainingsdata.

Regels:
- samenvatting: 1-2 zinnen, reflectief — wat ging er goed, hoe verliep de dag.
- aandachtspunt: wat de coach morgen moet onthouden — concreet, geen open zin.
${AANDACHTSPUNT_ANKER_REGEL}
- Zodra de gebruiker in het gesprek heeft aangegeven vol of klaar te zijn voor die dag: sluit af op wat goed ging. Noem GEEN manieren om het eiwitdoel alsnog te halen en geen "je had nog wat kunnen eten" — dat is precies het gedrag dat de coach zelf ook al vermijdt.
- De caloriewaarden hieronder staan erbij voor nauwkeurigheid, niet om standaard te noemen. Focus zoals gebruikelijk op eiwitten en hoe de dag verliep — noem calorieën alleen als dat al onderdeel was van het gesprek zelf.
- Noem NOOIT gewicht, een gewichtstrend of onderhoudsniveau in samenvatting of aandachtspunt — ook niet als dit in het gesprek zelf ter sprake kwam (bv. een weegmoment). Dit wordt bewust nergens teruggegeven, ook niet hier.
- Gebruik het record_summary tool om dit vast te leggen.

Trainingscontext van vandaag: ${workoutSummary}
Gelogde maaltijden vandaag:
${mealsText}`
}

function buildThinSystemPrompt(datum: string, workoutSummary: string, mealsText: string): string {
  return `Je bent een samenvattingsmodel voor de voedingscoach-app "Coach". Je taak: schrijf een korte dagsamenvatting voor coach_sessions voor een dag waarin GEEN gesprek beschikbaar is — dit is het automatische vangnet, de gebruiker heeft die dag niet zelf "sluit de dag af" gezegd.

${dagAnchorLine(datum)}

BELANGRIJK: je hebt het gesprek van die dag niet gezien. Verzin GEEN stemming, gevoel of iets dat alleen uit een gesprek af te leiden zou zijn. Blijf feitelijk: alleen wat er gegeten en getraind is.

Regels:
- samenvatting: 1-2 zinnen, feitelijk — gelogde maaltijden/eiwitten en trainingsdata van die dag.
- aandachtspunt: een feitelijke observatie op basis van de cijfers (bv. eiwitdoel wel/niet gehaald), geen gok over intentie of stemming.
${AANDACHTSPUNT_ANKER_REGEL}
- De caloriewaarden hieronder staan erbij voor nauwkeurigheid, niet om standaard te noemen — focus zoals gebruikelijk op eiwitten, niet op calorieën.
- Gebruik het record_summary tool om dit vast te leggen.

Trainingscontext van die dag: ${workoutSummary}
Gelogde maaltijden die dag:
${mealsText}`
}

export async function closeDayWithSummary(
  datum: string,
  conversationTranscript: string | null,
): Promise<{ ok: boolean; alreadyClosed?: boolean; error?: string }> {
  const { data: existing } = await supabase.from('coach_sessions').select('id').eq('datum', datum).limit(1)
  if (existing && existing.length > 0) {
    // Already closed (manual + cron race, or a retry) — nothing to do, but
    // say so honestly so the caller doesn't imply this action is what just
    // closed it (see coach-chat/tools.ts + PERSONA_PROMPT's "Dag afsluiten").
    return { ok: true, alreadyClosed: true }
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not set' }
  }

  const [mealsRes, workoutSummary] = await Promise.all([
    supabase.from('nutrition_log').select('tijdstip, omschrijving, eiwitten_g, calorieen').eq('datum', datum).order('tijdstip', { ascending: true }),
    resolveWorkoutForDate(datum),
  ])

  const meals = mealsRes.data ?? []
  const mealsText =
    meals.length > 0
      ? meals.map((m) => `- ${m.tijdstip ?? '?'} ${m.omschrijving}: ${m.eiwitten_g}g eiwit, ${m.calorieen}kcal`).join('\n')
      : 'Geen maaltijden gelogd.'

  // Plain SUM over the actual rows — never estimated by Opus, same
  // reasoning as block 3b's fix for today's own total: a re-estimate drifts
  // between asks, a stored sum doesn't.
  const eiwitTotaal = meals.reduce((sum, m) => sum + (Number(m.eiwitten_g) || 0), 0)
  const calorieTotaal = meals.reduce((sum, m) => sum + (Number(m.calorieen) || 0), 0)

  const systemPrompt = conversationTranscript
    ? buildRichSystemPrompt(datum, workoutSummary, mealsText)
    : buildThinSystemPrompt(datum, workoutSummary, mealsText)

  const userMessage = conversationTranscript
    ? `Gesprek van vandaag:\n\n${conversationTranscript}`
    : 'Genereer de samenvatting voor deze dag op basis van de context hierboven.'

  const result = await callClaude(apiKey, {
    model: 'claude-opus-5',
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    tools: [RECORD_SUMMARY_TOOL],
    toolChoice: { type: 'tool', name: 'record_summary' },
    maxTokens: 512,
  })

  if (!result.ok) {
    console.error('closeDayWithSummary: Claude call failed', result.status, result.errorText)
    return { ok: false, error: 'Claude API call failed' }
  }

  const toolUse = result.data?.content.find((b) => b.type === 'tool_use')
  if (!toolUse || !toolUse.input) {
    return { ok: false, error: 'No summary produced' }
  }

  const { samenvatting, aandachtspunt } = toolUse.input as { samenvatting?: string; aandachtspunt?: string }
  if (!samenvatting || !aandachtspunt) {
    return { ok: false, error: 'Incomplete summary' }
  }

  const { error: insertError } = await supabase
    .from('coach_sessions')
    .insert({ datum, samenvatting, aandachtspunt, eiwit_totaal: eiwitTotaal, calorieen_totaal: calorieTotaal })
  if (insertError) {
    return { ok: false, error: insertError.message }
  }

  return { ok: true, alreadyClosed: false }
}
