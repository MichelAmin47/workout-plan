import { supabase } from './supabaseClient.ts'
import { isoWeekOf, type IsoWeek } from './isoWeek.ts'

export { isoWeekOf, type IsoWeek }

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

export const ACTIVE_DAY_CUTOFF_HOUR = 4

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

// Sorts a day's meals into the order they actually happened, not raw
// tijdstip order. A meal logged after midnight but before the cutoff keeps
// *yesterday's* datum (by resolveActiveDate's own design above) but a small
// tijdstip that would otherwise sort first. Treat any tijdstip before the
// cutoff as occurring after 24:00 of the same logical day for ordering
// purposes only — never rewrites tijdstip or datum.
function sortKey(tijdstip: string): number {
  const [h, m] = tijdstip.split(':').map(Number)
  return h < ACTIVE_DAY_CUTOFF_HOUR ? h * 60 + m + 24 * 60 : h * 60 + m
}

export function sortMealsByActiveDayOrder<T extends { tijdstip: string | null }>(meals: T[]): T[] {
  return [...meals].sort((a, b) => {
    const ka = a.tijdstip == null ? Infinity : sortKey(a.tijdstip)
    const kb = b.tijdstip == null ? Infinity : sortKey(b.tijdstip)
    return ka - kb
  })
}

interface SchemaRef {
  id: string
}

// A schema lies within one ISO year (schemas.jaar); start_week/eind_week
// are ISO weeks of that year. Same ISO week + year as the workout app
// (isoWeek.ts has its twin in workout-app/src/isoWeek.js). week_overrides /
// rest_day_goals carry no year of their own: their schema_id scopes them.
async function resolveSchemaForWeek(week: IsoWeek): Promise<SchemaRef | null> {
  const { data: schemas } = await supabase.from('schemas').select('id, jaar, start_week, eind_week').eq('jaar', week.isoYear)
  return schemas?.find((s) => week.isoWeek >= s.start_week && week.isoWeek <= s.eind_week) ?? null
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

export async function resolveTodayWorkout(week: IsoWeek, weekday: number): Promise<string> {
  const schema = await resolveSchemaForWeek(week)
  if (!schema) return 'Er is geen actief trainingsschema gevonden voor deze week.'

  const [{ data: overrides }, { data: schemaDays }] = await Promise.all([
    supabase.from('week_overrides').select('dag_nummer, dag_van_week, naam').eq('schema_id', schema.id).eq('week_nummer', week.isoWeek),
    supabase.from('schema_days').select('dag_volgorde, type, dag_nummer, spiergroep_naam').eq('schema_id', schema.id),
  ])
  const { dayType, dagNummer, spiergroepNaam } = pickDayPlan(weekday, overrides ?? [], schemaDays ?? [])

  if (dayType !== 'training' || dagNummer == null) {
    if (dayType === 'rust') return 'Vandaag is een rustdag.'
    if (dayType === 'power_hour')
      return 'Vandaag staat Power Hour gepland — een trainer-geleide HIIT-les met kracht- én cardio-elementen.'
    if (dayType === 'boksen') return 'Vandaag staat Boksen gepland — overwegend cardio, hoge intensiteit.'
    return 'Vandaag is geen trainingsdag.'
  }

  const [{ data: completedDay }, { data: completedExercises }] = await Promise.all([
    supabase.from('completed_days').select('day').eq('jaar', week.isoYear).eq('week', week.isoWeek).eq('day', dagNummer).limit(1),
    supabase.from('completed_exercises').select('exercise').eq('jaar', week.isoYear).eq('week', week.isoWeek).eq('day', dagNummer),
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
export async function resolveWeekPlan(week: IsoWeek, activeWeekday: number): Promise<WeekDayInfo[]> {
  const schema = await resolveSchemaForWeek(week)
  if (!schema) return []

  const [{ data: overrides }, { data: schemaDays }, { data: completedDays }] = await Promise.all([
    supabase.from('week_overrides').select('dag_nummer, dag_van_week, naam').eq('schema_id', schema.id).eq('week_nummer', week.isoWeek),
    supabase.from('schema_days').select('dag_volgorde, type, dag_nummer, spiergroep_naam').eq('schema_id', schema.id),
    supabase.from('completed_days').select('day').eq('jaar', week.isoYear).eq('week', week.isoWeek),
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
  // On Monday 2027-01-04 this is 2026-W53 (Sunday 2027-01-03).
  const yesterdayWeek = isoWeekOf(yesterday)
  const yesterdayWeekday = yesterday.getDay() || 7

  const schema = await resolveSchemaForWeek(yesterdayWeek)
  if (!schema) return null

  const [{ data: overrides }, { data: schemaDays }] = await Promise.all([
    supabase.from('week_overrides').select('dag_nummer, dag_van_week, naam').eq('schema_id', schema.id).eq('week_nummer', yesterdayWeek.isoWeek),
    supabase.from('schema_days').select('dag_volgorde, type, dag_nummer, spiergroep_naam').eq('schema_id', schema.id),
  ])
  const { dayType, dagNummer, spiergroepNaam } = pickDayPlan(yesterdayWeekday, overrides ?? [], schemaDays ?? [])

  let completed: boolean | null = null
  if (dayType === 'training' && dagNummer != null) {
    const { data: completedDay } = await supabase.from('completed_days').select('day').eq('jaar', yesterdayWeek.isoYear).eq('week', yesterdayWeek.isoWeek).eq('day', dagNummer).limit(1)
    completed = Boolean(completedDay && completedDay.length > 0)
  }

  return { weekday: yesterdayWeekday, label: 'Gisteren', isToday: false, dayType, naam: spiergroepNaam, completed }
}
