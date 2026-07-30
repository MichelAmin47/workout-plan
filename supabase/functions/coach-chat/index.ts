// Supabase Edge Function: coach-chat
//
// Proxies chat messages from voeding-app to the Claude API. Builds a system
// prompt from a fixed persona/preferences block plus dynamic context pulled
// from Supabase (today's workout, recent daily summaries, today's protein
// target). Chat + system prompt only — no tool use, no writes.

import { createClient } from 'npm:@supabase/supabase-js@2'

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

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
)

// ── "Today" resolution (Europe/Amsterdam wall-clock, not raw UTC) ──

function amsterdamNow(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

// Same algorithm as currentWeekIndex() in workout-app/fitness_schema.jsx,
// so "today's" calendar week always matches what the app itself shows.
function currentCalWeek(d: Date): number {
  const dow = d.getDay() || 7
  const shifted = new Date(d)
  shifted.setDate(shifted.getDate() + 4 - dow)
  const jan1 = new Date(shifted.getFullYear(), 0, 1)
  return Math.ceil(((shifted.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
}

function isoDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function resolveTodayWorkout(calWeek: number, weekday: number): Promise<string> {
  const { data: schemas } = await supabase.from('schemas').select('id, start_week, eind_week')
  const schema = schemas?.find((s) => calWeek >= s.start_week && calWeek <= s.eind_week)
  if (!schema) return 'Er is geen actief trainingsschema gevonden voor deze week.'

  const { data: overrides } = await supabase
    .from('week_overrides')
    .select('dag_van_week')
    .eq('schema_id', schema.id)
    .eq('week_nummer', calWeek)
    .eq('dag_nummer', weekday)
    .limit(1)

  let dayType: string | null = null
  let dagNummer: number | null = null
  let spiergroepNaam: string | null = null

  if (overrides && overrides.length > 0) {
    dayType = overrides[0].dag_van_week
  } else {
    const { data: schemaDays } = await supabase
      .from('schema_days')
      .select('type, dag_nummer, spiergroep_naam')
      .eq('schema_id', schema.id)
      .eq('dag_volgorde', weekday)
      .limit(1)
    if (schemaDays && schemaDays.length > 0) {
      dayType = schemaDays[0].type
      dagNummer = schemaDays[0].dag_nummer
      spiergroepNaam = schemaDays[0].spiergroep_naam
    }
  }

  if (dayType !== 'training' || dagNummer == null) {
    if (dayType === 'rust') return 'Vandaag is een rustdag.'
    if (dayType === 'cardio_fitness') return 'Vandaag staat cardio/fitness gepland (geen krachttraining).'
    return 'Vandaag is geen trainingsdag.'
  }

  const [{ data: completedDay }, { data: completedExercises }] = await Promise.all([
    supabase.from('completed_days').select('day').eq('week', calWeek).eq('day', dagNummer).limit(1),
    supabase.from('completed_exercises').select('exercise').eq('week', calWeek).eq('day', dagNummer),
  ])

  const label = spiergroepNaam ? `Vandaag is een trainingsdag: ${spiergroepNaam}.` : 'Vandaag is een trainingsdag.'

  if (!completedExercises || completedExercises.length === 0) {
    return `${label} Nog geen oefeningen als voltooid gemarkeerd vandaag.`
  }

  const names = completedExercises.map((e) => e.exercise).join(', ')
  const dayDoneNote = completedDay && completedDay.length > 0 ? ' De hele dag is als voltooid gemarkeerd.' : ''
  return `${label} Voltooide oefeningen vandaag: ${names}.${dayDoneNote}`
}

async function buildDynamicContext(): Promise<string> {
  const now = amsterdamNow()
  const calWeek = currentCalWeek(now)
  const weekday = now.getDay() || 7
  const todayStr = isoDateString(now)

  const [workoutSummary, sessionsRes, targetRes] = await Promise.all([
    resolveTodayWorkout(calWeek, weekday),
    supabase.from('coach_sessions').select('datum, samenvatting, aandachtspunt').order('datum', { ascending: false }).limit(5),
    supabase.from('daily_targets').select('eiwit_doel_g, eiwit_actueel_g').eq('datum', todayStr).limit(1),
  ])

  const sessions = sessionsRes.data ?? []
  const recentSessionsText =
    sessions.length > 0
      ? sessions
          .map((s) => `- ${s.datum}: ${s.samenvatting ?? ''}${s.aandachtspunt ? ` (aandachtspunt: ${s.aandachtspunt})` : ''}`)
          .join('\n')
      : 'Nog geen eerdere dagafsluitingen beschikbaar.'

  const target = targetRes.data?.[0]
  const targetText = target
    ? `Eiwitdoel vandaag: ${target.eiwit_doel_g}g, tot nu toe: ${target.eiwit_actueel_g}g.`
    : 'Nog geen eiwitdoel ingesteld voor vandaag.'

  return [
    `Vandaag is ${todayStr}.`,
    workoutSummary,
    'Recente dagafsluitingen (nieuwste eerst):',
    recentSessionsText,
    targetText,
  ].join('\n')
}

const PERSONA_PROMPT = `Je bent Coach, een Nederlandse voedingscoach in een chat-app. Je toon is motiverend, warm en bemoedigend — nooit streng of veroordelend. Je antwoordt altijd in het Nederlands.

Belangrijke voorkeuren van de gebruiker om altijd in acht te nemen:
- Focus op eiwitten, niet op calorieën. Noem calorieën alleen als de gebruiker er expliciet naar vraagt.
- Noem of suggereer nooit alcohol — de gebruiker drinkt niet.
- Plantaardige alternatieven zijn relevant voor deze gebruiker; Alpro-producten mag je gerust voorstellen.
- Ontbijt wordt vaak onderweg in de auto gegeten — houd ontbijtsuggesties praktisch en makkelijk mee te nemen voor die context.
- Er is vaak een energiedip rond 15:00 op kantoordagen — je mag dit proactief benoemen, bijvoorbeeld tijdens de ochtend check-in.
- Bij een vage maaltijdbeschrijving (bijvoorbeeld "ergens gegeten in een restaurant" of een onduidelijke hoeveelheid): schat nooit zomaar een aantal gram eiwit. Stel eerst een verduidelijkende vraag over hoeveelheid en ingrediënten voordat je een inschatting geeft.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json().catch(() => null)
    const messages = body?.messages

    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: 'messages array is required' }, 400)
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY secret is not set')
      return jsonResponse({ error: 'Coach is niet geconfigureerd.' }, 500)
    }

    const dynamicContext = await buildDynamicContext()
    const systemPrompt = `${PERSONA_PROMPT}\n\n${dynamicContext}`

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      console.error('Anthropic API error', anthropicRes.status, errText)
      return jsonResponse({ error: 'Coach is momenteel niet bereikbaar.' }, 502)
    }

    const data = await anthropicRes.json()
    const reply = (data.content ?? [])
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('\n')
      .trim()

    if (!reply) {
      return jsonResponse({ error: 'Geen antwoord ontvangen.' }, 502)
    }

    return jsonResponse({ reply })
  } catch (err) {
    console.error('coach-chat error', err)
    return jsonResponse({ error: 'Er ging iets mis.' }, 500)
  }
})
