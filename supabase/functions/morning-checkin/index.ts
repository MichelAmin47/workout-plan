// Supabase Edge Function: morning-checkin
//
// One-shot, forced-tool-call generation of the morning check-in card shown
// on the first app open of the day (bouwplan-voeding-app.md "Blok 5"). No
// conversation loop, no other tools — structurally a sibling of
// closeDayWithSummary in _shared/summary.ts, just its own function since it
// only has one caller (the client, on app open).
//
// The client makes its own cheap, DB-only trigger decision before ever
// calling this (voeding-app/src/lib/morningCheckin.js) so the LLM cost only
// happens when something's worth saying — but this function re-checks the
// same conditions independently against real data before spending a Claude
// call, rather than trusting the client called it for a good reason.

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

const RENDER_CHECKIN_TOOL = {
  name: 'render_checkin_card',
  description: 'Render the morning check-in card.',
  input_schema: {
    type: 'object',
    properties: {
      boodschap: { type: 'string', description: 'The main reasoning/advice for the card, 1-2 sentences, Dutch.' },
      context_label: { type: 'string', description: 'Short label for the supporting context line, e.g. "Vandaag:"' },
      context_tekst: { type: 'string', description: 'The supporting context line itself, e.g. "Rustdag — mooi moment voor herstel."' },
      heeft_vraag: {
        type: 'boolean',
        description: 'True if boodschap is phrased as a question inviting a reply from the user, false if it is a statement.',
      },
    },
    required: ['boodschap', 'context_label', 'context_tekst', 'heeft_vraag'],
  },
}

type DayFact = Pick<WeekDayInfo, 'dayType' | 'naam'>

function dayLabel(info: DayFact): string {
  if (info.dayType === 'training') return `trainingsdag${info.naam ? ` (${info.naam})` : ''}`
  if (info.dayType === 'rust') return `rustdag${info.naam ? ` (${info.naam})` : ''}`
  if (info.dayType === 'cardio_fitness') return `cardio/fitness${info.naam ? ` (${info.naam})` : ''}`
  return 'onbekend'
}

// Cheap pre-call heuristic for "does yesterday's aandachtspunt contain
// something worth asking about" — used to decide whether the aandachtspunt
// alone should trigger a card (see the trigger check below). Duplicated
// client-side in voeding-app/src/lib/morningCheckin.js's shouldShowCheckin
// (that copy has a comment pointing back here) — same runtime-duplication
// precedent as currentCalWeek in that file, not moved to a shared module
// for the same reasons.
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

// Own short prompt, not the full PERSONA_PROMPT — same reasoning
// _shared/summary.ts already uses its own narrower prompts for the
// day-summary rather than the persona block. This task is much smaller
// than a full conversation: a few facts in, three-to-four fields out.
function buildSystemPrompt(yesterday: DayFact, today: DayFact, isThursday: boolean, aandachtspunt: string | null): string {
  return `Je schrijft een korte ochtend check-in kaart voor de voedingscoach-app "Coach" — het eerste wat de gebruiker ziet bij het openen van de app, in plaats van een generieke groet. Drie velden: een boodschap (1-2 zinnen, de kern van het advies), een context-regel (label + tekst, een korte ondersteunende regel), en heeft_vraag (of de boodschap een vraag stelt die om een antwoord vraagt).

Feiten om op te baseren (gebruik alleen wat hier staat, verzin niets):
- Gisteren was een ${dayLabel(yesterday)}.
- Vandaag is een ${dayLabel(today)}.
${isThursday ? '- Vandaag is donderdag: Power Hour bokstraining om 19:00, dus niet nuchter trainen die dag — een normale eetdag met een snack rond 17:30 en de hoofdmaaltijd na de training.\n' : ''}- Zondag is de vaste beendag, altijd nuchter — de norm, niet de uitzondering.
- Spiereiwitsynthese blijft 24-48 uur verhoogd na een zware trainingssessie — de dag ná een trainingsdag mag ook eiwitrijk zijn.
${aandachtspunt ? `- Aandachtspunt van gisteren, wat de coach vandaag moet onthouden: "${aandachtspunt}"` : '- Geen aandachtspunt van gisteren beschikbaar.'}

Hoe je het aandachtspunt weegt tegenover de trainingsfeiten:
${
  aandachtspunt
    ? `- Bevat het aandachtspunt hierboven iets om te vragen of een concrete actie voor vandaag → leid de boodschap daarmee in (natuurlijk geformuleerd, geen letterlijke kopie), en gebruik de trainingsfeiten als ondersteunende context-regel. Zet heeft_vraag op true.
- Bevat het alleen achtergrond, voorkeuren of constateringen zonder iets te vragen → negeer het voor deze kaart en val terug op de gewone trainingsgerichte boodschap hieronder. Niet alles uit het aandachtspunt proppen — één kaart, één focus, niet een opsomming.`
    : '- Geen aandachtspunt beschikbaar, gebruik de trainingsfeiten hierboven zoals gebruikelijk.'
}

Regels:
- Focus op eiwitten. Noem GEEN calorieën en GEEN dagtotaal.
- Noem NOOIT gewicht, een gewichtstrend of onderhoudsniveau — ook niet als dit in het aandachtspunt hierboven voorkomt. Dit wordt bewust nergens teruggegeven, ook niet hier.
- Geen schuldgevoel-taal, geen "je zat ver onder/boven je doel" — dit gaat over training en herstel, niet over hoe gisteren scoorde tegenover een doel.
- Motiverende, warme toon, kort en concreet — geen algemeenheid die net zo goed op elke willekeurige dag zou passen.
- heeft_vraag: alleen true als de boodschap daadwerkelijk iets vraagt waar de gebruiker kort op kan reageren — niet bij een statement of constatering.
- Gebruik het render_checkin_card tool om dit vast te leggen.`
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
    const yesterdayTraining = yesterdayInfo.dayType === 'training'
    const todayTraining = todayInfo.dayType === 'training'
    const hasHandoverQuestion = aandachtspuntHasQuestion(aandachtspunt)

    if (!yesterdayTraining && !todayTraining && !isThursday && !hasHandoverQuestion) {
      return jsonResponse({ card: null })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY secret is not set')
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
      return jsonResponse({ card: null })
    }

    const toolUse = result.data?.content.find((b) => b.type === 'tool_use')
    if (!toolUse || !toolUse.input) {
      return jsonResponse({ card: null })
    }

    const { boodschap, context_label, context_tekst, heeft_vraag } = toolUse.input as {
      boodschap?: string
      context_label?: string
      context_tekst?: string
      heeft_vraag?: boolean
    }
    if (!boodschap || !context_label || !context_tekst || typeof heeft_vraag !== 'boolean') {
      return jsonResponse({ card: null })
    }

    return jsonResponse({
      card: { eyebrow: 'Ochtend check-in', question: boodschap, contextLabel: context_label, contextText: context_tekst, isQuestion: heeft_vraag },
    })
  } catch (err) {
    console.error('morning-checkin error', err)
    return jsonResponse({ card: null })
  }
})
