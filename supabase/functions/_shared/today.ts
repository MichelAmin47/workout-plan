import { supabase } from './supabaseClient.ts'

// ── "Today" resolution (Europe/Amsterdam wall-clock, not raw UTC) ──

export function amsterdamNow(): Date {
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
export function currentCalWeek(d: Date): number {
  const dow = d.getDay() || 7
  const shifted = new Date(d)
  shifted.setDate(shifted.getDate() + 4 - dow)
  const jan1 = new Date(shifted.getFullYear(), 0, 1)
  return Math.ceil(((shifted.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
}

export function isoDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Fix 1: current time, not just the date — without it the coach can't tell
// 16:00 from 22:00, and can't fill nutrition_log's `tijdstip` on its own
// when the user says "just ate" without naming a time.
export function isoTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const ACTIVE_DAY_CUTOFF_HOUR = 4

// The calendar day currently "in play" for logging, closing, and dynamic
// context — mirrors the reasoning close-day-cron already applies (it only
// ever runs at ~02:00-03:00 Amsterdam time, always targeting "yesterday").
// Before the cutoff, someone acting now is still finishing the day that
// just ended, not starting a new one early: closing at 00:30 summarises
// yesterday; closing at 09:00 is today, unusual but real, and must not
// silently overwrite yesterday's summary. 04:00 sits comfortably between
// those two cases and lands safely after the cron's own run, so by the
// time this window closes the cron will already have swept up anything
// genuinely neglected.
export function resolveActiveDate(now: Date): Date {
  if (now.getHours() < ACTIVE_DAY_CUTOFF_HOUR) {
    const shifted = new Date(now)
    shifted.setDate(shifted.getDate() - 1)
    return shifted
  }
  return now
}

export async function resolveTodayWorkout(calWeek: number, weekday: number): Promise<string> {
  const { data: schemas } = await supabase.from('schemas').select('id, start_week, eind_week')
  const schema = schemas?.find((s) => calWeek >= s.start_week && calWeek <= s.eind_week)
  if (!schema) return 'Er is geen actief trainingsschema gevonden voor deze week.'

  const { data: overrides } = await supabase
    .from('week_overrides')
    .select('dag_van_week, naam')
    .eq('schema_id', schema.id)
    .eq('week_nummer', calWeek)
    .eq('dag_nummer', weekday)
    .limit(1)

  let dayType: string | null = null
  let dagNummer: number | null = null
  let spiergroepNaam: string | null = null

  if (overrides && overrides.length > 0) {
    dayType = overrides[0].dag_van_week
    spiergroepNaam = overrides[0].naam

    // Fix 2: week_overrides.naam is a display label (e.g. "Borst & Triceps"),
    // not the muscle-group id completed_days/completed_exercises expect.
    // When the override maps to a training day, translate naam back to
    // dag_nummer via schema_days (spiergroep_naam -> dag_nummer) before
    // querying completion data — otherwise the wrong training day (or none)
    // gets looked up.
    if (dayType === 'training' && spiergroepNaam) {
      const { data: matchingDay } = await supabase
        .from('schema_days')
        .select('dag_nummer')
        .eq('schema_id', schema.id)
        .eq('spiergroep_naam', spiergroepNaam)
        .limit(1)
      if (matchingDay && matchingDay.length > 0) {
        dagNummer = matchingDay[0].dag_nummer
      }
    }
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
