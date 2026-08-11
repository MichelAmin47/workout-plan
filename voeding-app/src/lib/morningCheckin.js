import { supabase } from '../supabase.js'
import { activeDate } from './threadStorage.js'
import { isLateEvening } from '../data/seedMessages.js'

const CHECKIN_SHOWN_KEY = 'coach_checkin_shown_v1'
const CHECKIN_TIMEOUT_MS = 8000

// Same formula as _shared/today.ts's currentCalWeek (Deno, the Edge
// Function runtime) and workout-app's original currentWeekIndex() — a third
// copy, not moved into a shared module. See bouwplan-voeding-app.md "Blok
// 5" point 2 for why: deploy_edge_function embeds file contents literally
// per deploy call, so a shared/ location wouldn't remove the Edge-Function
// side's copy anyway, only the client's — a real but partial win judged not
// worth a new cross-app-boundary import for a ~5-line, block-7-stable
// formula. If this ever needs to change, it needs to change in all three
// places.
function currentCalWeek(d) {
  const dow = d.getDay() || 7
  const shifted = new Date(d)
  shifted.setDate(shifted.getDate() + 4 - dow)
  const jan1 = new Date(shifted.getFullYear(), 0, 1)
  return Math.ceil(((shifted.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
}

async function resolveSchemaForWeek(calWeek) {
  const { data } = await supabase.from('schemas').select('id, start_week, eind_week')
  return (data ?? []).find((s) => calWeek >= s.start_week && calWeek <= s.eind_week) ?? null
}

// Deliberate narrow duplicate of _shared/today.ts's pickDayPlan — different
// runtime (browser vs. Deno), can't literally share the module. Scoped down
// to just dayType: the trigger decision doesn't need muscle group or
// completion status, only the server-side card content does (and that's
// resolved authoritatively server-side in morning-checkin's own index.ts,
// not trusted from here). One call per day, not batched — this only ever
// resolves two days (today, yesterday), so the extra round trips don't
// matter.
async function resolveDayType(calWeek, weekday) {
  const schema = await resolveSchemaForWeek(calWeek)
  if (!schema) return null

  const { data: overrides } = await supabase
    .from('week_overrides')
    .select('dag_nummer, dag_van_week')
    .eq('schema_id', schema.id)
    .eq('week_nummer', calWeek)
    .eq('dag_nummer', weekday)
    .limit(1)
  if (overrides && overrides.length > 0) return overrides[0].dag_van_week

  const { data: schemaDays } = await supabase
    .from('schema_days')
    .select('type')
    .eq('schema_id', schema.id)
    .eq('dag_volgorde', weekday)
    .limit(1)
  return schemaDays && schemaDays.length > 0 ? schemaDays[0].type : null
}

// Client-side cost gate — no Edge Function call is made just to decide
// whether to make the (expensive) Edge Function call, only direct table
// reads. Cross-week correctness for "yesterday" (bouwplan-voeding-app.md
// "Blok 5" point 1): this deliberately does NOT port
// resolveYesterdayIfOutsideWeek's Monday-only special case from
// _shared/today.ts. The server needed that patch because it first builds a
// whole Mon-Sun grid for the week and then has to backfill the one day that
// grid structurally can't hold. This function never builds a grid — it
// only ever resolves two individual days, so deriving yesterday's OWN
// calWeek from yesterday's OWN Date (rather than assuming it equals today's
// calWeek) is simply the general case, correct on every day of the week
// including Monday, not a special case bolted on afterward.
export async function shouldShowCheckin() {
  if (isLateEvening()) return { show: false }

  const today = activeDate()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const todayWeekday = today.getDay() || 7
  const todayCalWeek = currentCalWeek(today)
  const yesterdayWeekday = yesterday.getDay() || 7
  const yesterdayCalWeek = currentCalWeek(yesterday)

  const [todayType, yesterdayType] = await Promise.all([
    resolveDayType(todayCalWeek, todayWeekday),
    resolveDayType(yesterdayCalWeek, yesterdayWeekday),
  ])

  const isThursday = todayWeekday === 4
  const show = todayType === 'training' || yesterdayType === 'training' || isThursday
  return { show }
}

export function hasShownCheckinToday(today) {
  try {
    return localStorage.getItem(CHECKIN_SHOWN_KEY) === today
  } catch {
    return false
  }
}

// Only ever called after a genuinely successful card render (see
// fetchMorningCheckin's contract and Coach.jsx's buildDailyOpening) — a
// failed or timed-out attempt does not consume the day's one shot, so a
// transient failure can still succeed on a later reopen the same morning
// instead of being silently denied for the rest of the day.
export function markCheckinShown(today) {
  try {
    localStorage.setItem(CHECKIN_SHOWN_KEY, today)
  } catch {
    // localStorage unavailable/full — non-fatal, worst case the check-in
    // can just show again on a later reopen the same day
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('morning-checkin call timed out')), ms)),
  ])
}

// Best-effort, same pattern as dayProgress.js's fetchProteinProgress — a
// greeting is not worth a spinner or an error state. Any failure or
// slowness (8s budget, longer than dayProgress's 3s since this is an LLM
// call, not a DB query) falls back to {ok:false}, letting the caller use
// the point-7 template instead.
export async function fetchMorningCheckin() {
  try {
    const { data, error } = await withTimeout(supabase.functions.invoke('morning-checkin'), CHECKIN_TIMEOUT_MS)
    if (error || !data) throw error ?? new Error('No response from morning-checkin')
    return { ok: true, card: data.card ?? null }
  } catch (err) {
    console.error('fetchMorningCheckin failed, falling back to template opening', err)
    return { ok: false }
  }
}
