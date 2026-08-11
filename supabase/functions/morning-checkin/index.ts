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
// same three conditions independently against real data before spending a
// Claude call, rather than trusting the client called it for a good reason.

import { amsterdamNow, currentCalWeek, resolveActiveDate, resolveWeekPlan, resolveYesterdayIfOutsideWeek, type WeekDayInfo } from '../_shared/today.ts'
import { callClaude } from '../_shared/anthropic.ts'

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
    },
    required: ['boodschap', 'context_label', 'context_tekst'],
  },
}

type DayFact = Pick<WeekDayInfo, 'dayType' | 'naam'>

function dayLabel(info: DayFact): string {
  if (info.dayType === 'training') return `trainingsdag${info.naam ? ` (${info.naam})` : ''}`
  if (info.dayType === 'rust') return `rustdag${info.naam ? ` (${info.naam})` : ''}`
  if (info.dayType === 'cardio_fitness') return `cardio/fitness${info.naam ? ` (${info.naam})` : ''}`
  return 'onbekend'
}

// Own short prompt, not the full PERSONA_PROMPT — same reasoning
// _shared/summary.ts already uses its own narrower prompts for the
// day-summary rather than the persona block. This task is much smaller
// than a full conversation: two facts in, two fields out.
function buildSystemPrompt(yesterday: DayFact, today: DayFact, isThursday: boolean): string {
  return `Je schrijft een korte ochtend check-in kaart voor de voedingscoach-app "Coach" — het eerste wat de gebruiker ziet bij het openen van de app, in plaats van een generieke groet. Twee velden: een boodschap (1-2 zinnen, de kern van het advies) en een context-regel (label + tekst, een korte ondersteunende regel).

Feiten om op te baseren (gebruik alleen wat hier staat, verzin niets):
- Gisteren was een ${dayLabel(yesterday)}.
- Vandaag is een ${dayLabel(today)}.
${isThursday ? '- Vandaag is donderdag: Power Hour bokstraining om 19:00, dus niet nuchter trainen die dag — een normale eetdag met een snack rond 17:30 en de hoofdmaaltijd na de training.\n' : ''}- Zondag is de vaste beendag, altijd nuchter — de norm, niet de uitzondering.
- Spiereiwitsynthese blijft 24-48 uur verhoogd na een zware trainingssessie — de dag ná een trainingsdag mag ook eiwitrijk zijn.

Regels:
- Focus op eiwitten. Noem GEEN calorieën en GEEN dagtotaal.
- Geen schuldgevoel-taal, geen "je zat ver onder/boven je doel" — dit gaat over training en herstel, niet over hoe gisteren scoorde tegenover een doel.
- Motiverende, warme toon, kort en concreet — geen algemeenheid die net zo goed op elke willekeurige dag zou passen.
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

    const isThursday = todayWeekday === 4
    const yesterdayTraining = yesterdayInfo.dayType === 'training'
    const todayTraining = todayInfo.dayType === 'training'

    if (!yesterdayTraining && !todayTraining && !isThursday) {
      return jsonResponse({ card: null })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY secret is not set')
      return jsonResponse({ card: null })
    }

    const result = await callClaude(apiKey, {
      model: 'claude-sonnet-5',
      system: buildSystemPrompt(yesterdayInfo, todayInfo, isThursday),
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

    const { boodschap, context_label, context_tekst } = toolUse.input as {
      boodschap?: string
      context_label?: string
      context_tekst?: string
    }
    if (!boodschap || !context_label || !context_tekst) {
      return jsonResponse({ card: null })
    }

    return jsonResponse({
      card: { eyebrow: 'Ochtend check-in', question: boodschap, contextLabel: context_label, contextText: context_tekst },
    })
  } catch (err) {
    console.error('morning-checkin error', err)
    return jsonResponse({ card: null })
  }
})
