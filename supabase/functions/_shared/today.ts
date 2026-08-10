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

interface SchemaRef {
  id: string
}

async function resolveSchemaForWeek(calWeek: number): Promise<SchemaRef | null> {
  const { data: schemas } = await supabase.from('schemas').select('id, start_week, eind_week')
  return schemas?.find((s) => calWeek >= s.start_week && calWeek <= s.eind_week) ?? null
}

interface OverrideRow {
  dag_nummer: number
  dag_van_week: string
  naam: string | null
}

interface SchemaDayRow {
  dag_volgorde: number
  type: string
  dag_nummer: number | null
  spiergroep_naam: string | null
}

interface DayPlan {
  dayType: string | null
  dagNummer: number | null
  spiergroepNaam: string | null
}

// Shared by resolveTodayWorkout and resolveWeekPlan — one place for the
// override-vs-base-schedule decision, so the two views of the same week
// can't quietly diverge. week_overrides.naam is a display label (e.g.
// "Borst & Triceps"), not the muscle-group id completed_days/
// completed_exercises expect, so a training override needs translating back
// to dag_nummer via schema_days (spiergroep_naam -> dag_nummer) before
// completion data can be queried — otherwise the wrong training day (or
// none) gets looked up. Assumes at most one override row per (schema, week,
// weekday) and one schema_days row per dag_volgorde, true of the real data.
function pickDayPlan(weekday: number, overrides: OverrideRow[], schemaDays: SchemaDayRow[]): DayPlan {
  const override = overrides.find((o) => o.dag_nummer === weekday)
  if (override) {
    let dagNummer: number | null = null
    if (override.dag_van_week === 'training' && override.naam) {
      dagNummer = schemaDays.find((d) => d.spiergroep_naam === override.naam)?.dag_nummer ?? null
    }
    return { dayType: override.dag_van_week, dagNummer, spiergroepNaam: override.naam }
  }

  const base = schemaDays.find((d) => d.dag_volgorde === weekday)
  if (base) return { dayType: base.type, dagNummer: base.dag_nummer, spiergroepNaam: base.spiergroep_naam }

  return { dayType: null, dagNummer: null, spiergroepNaam: null }
}

export async function resolveTodayWorkout(calWeek: number, weekday: number): Promise<string> {
  const schema = await resolveSchemaForWeek(calWeek)
  if (!schema) return 'Er is geen actief trainingsschema gevonden voor deze week.'

  const [{ data: overrides }, { data: schemaDays }] = await Promise.all([
    supabase.from('week_overrides').select('dag_nummer, dag_van_week, naam').eq('schema_id', schema.id).eq('week_nummer', calWeek),
    supabase.from('schema_days').select('dag_volgorde, type, dag_nummer, spiergroep_naam').eq('schema_id', schema.id),
  ])
  const { dayType, dagNummer, spiergroepNaam } = pickDayPlan(weekday, overrides ?? [], schemaDays ?? [])

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

export interface WeekDayInfo {
  weekday: number // 1=Ma..7=Zo
  label: string
  isToday: boolean
  dayType: string | null
  naam: string | null
  // null = not applicable (rest/cardio day, or a day still ahead of today) —
  // never a false "skipped", since a future day simply has no completion
  // status yet.
  completed: boolean | null
}

const WEEKDAY_LABELS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

// Block 7: the full current week (Mon-Sun), not just today — same
// schema_days/week_overrides resolution as resolveTodayWorkout, reused via
// pickDayPlan rather than re-implemented, batched into 3 queries total
// instead of one round-trip per weekday.
export async function resolveWeekPlan(calWeek: number, activeWeekday: number): Promise<WeekDayInfo[]> {
  const schema = await resolveSchemaForWeek(calWeek)
  if (!schema) return []

  const [{ data: overrides }, { data: schemaDays }, { data: completedDays }] = await Promise.all([
    supabase.from('week_overrides').select('dag_nummer, dag_van_week, naam').eq('schema_id', schema.id).eq('week_nummer', calWeek),
    supabase.from('schema_days').select('dag_volgorde, type, dag_nummer, spiergroep_naam').eq('schema_id', schema.id),
    supabase.from('completed_days').select('day').eq('week', calWeek),
  ])
  const completedDagNummers = new Set((completedDays ?? []).map((d) => d.day))

  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const { dayType, dagNummer, spiergroepNaam } = pickDayPlan(weekday, overrides ?? [], schemaDays ?? [])
    const completed =
      dayType === 'training' && dagNummer != null && weekday <= activeWeekday ? completedDagNummers.has(dagNummer) : null
    return { weekday, label: WEEKDAY_LABELS[weekday - 1], isToday: weekday === activeWeekday, dayType, naam: spiergroepNaam, completed }
  })
}

// Block 7 addendum: the Mon-Sun grid above includes yesterday for every day
// except Monday, where yesterday (Sunday) belongs to the *previous*
// calendar week and would otherwise disappear from context entirely —
// losing exactly the "day after a training day" recovery-window case the
// backward-looking half of block 7 exists for (Sunday is the fixed leg day,
// per PERSONA_PROMPT). Only resolves anything on a Monday; every other day
// already has yesterday inside its own week grid. label is 'Gisteren'
// rather than a weekday abbreviation so formatWeekPlan can render it
// unchanged.
export async function resolveYesterdayIfOutsideWeek(activeDate: Date, activeWeekday: number): Promise<WeekDayInfo | null> {
  if (activeWeekday !== 1) return null

  const yesterday = new Date(activeDate)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayCalWeek = currentCalWeek(yesterday)
  const yesterdayWeekday = yesterday.getDay() || 7

  const schema = await resolveSchemaForWeek(yesterdayCalWeek)
  if (!schema) return null

  const [{ data: overrides }, { data: schemaDays }] = await Promise.all([
    supabase.from('week_overrides').select('dag_nummer, dag_van_week, naam').eq('schema_id', schema.id).eq('week_nummer', yesterdayCalWeek),
    supabase.from('schema_days').select('dag_volgorde, type, dag_nummer, spiergroep_naam').eq('schema_id', schema.id),
  ])
  const { dayType, dagNummer, spiergroepNaam } = pickDayPlan(yesterdayWeekday, overrides ?? [], schemaDays ?? [])

  let completed: boolean | null = null
  if (dayType === 'training' && dagNummer != null) {
    const { data: completedDay } = await supabase.from('completed_days').select('day').eq('week', yesterdayCalWeek).eq('day', dagNummer).limit(1)
    completed = Boolean(completedDay && completedDay.length > 0)
  }

  return { weekday: yesterdayWeekday, label: 'Gisteren', isToday: false, dayType, naam: spiergroepNaam, completed }
}
