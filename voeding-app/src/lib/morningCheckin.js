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

// DEAD CODE, kept intentionally (not deleted) — see shouldShowCheckin below
// for why. resolveDayType/resolveSchemaForWeek/currentCalWeek and
// aandachtspuntHasQuestion below were the client-side half of a two-tier
// trigger gate (this file decided cheaply whether to call morning-checkin
// at all; the Edge Function re-checked the same conditions against real
// data before spending a Claude call). The trigger gate itself silently
// failed twice on the same "yesterday was a training day" path
// (2026-08-18, 2026-08-21) and was removed rather than debugged further —
// morning-checkin is now called unconditionally every day. Left in place,
// unused, in case the decision to gate is ever revisited; not repurposed
// for anything else since this file only ever decides whether to call the
// server, never what the card says (that's server-side, in
// morning-checkin/index.ts, which still needs — and keeps — its own
// day-type resolution for card content).
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

// DEAD CODE, kept intentionally — see the comment above resolveDayType.
function aandachtspuntHasQuestion(text) {
  if (!text) return false
  return /\?/.test(text) || /\bvraag\b/i.test(text)
}

// Unconditional now — this used to gate on yesterday/today being a
// training day, today being Thursday, or a carried-over aandachtspunt
// having a question. That gate silently failed twice on the same
// "yesterday was a training day" path (2026-08-18, 2026-08-21); a retry
// fix after the first miss didn't prevent the second. Rather than keep
// debugging an intermittent trigger-evaluation bug, the gate is removed
// entirely: morning-checkin is called every day. An unnecessary call on a
// plain day is a minor cost; a missing check-in on a day it mattered was
// the actual problem. isLateEvening() stays — that's a time-of-day
// suppression (no "goedemorgen" card at 23:00), not one of the four
// removed triggers. morning-checkin/index.ts had its own independent
// server-side re-check of the same four conditions and was updated
// alongside this file — a client-only change here would still have been
// silently gated server-side.
export async function shouldShowCheckin() {
  if (isLateEvening()) return { show: false }
  return { show: true }
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Real miss (18 augustus): confirmed via Supabase's edge-function logs that
// the client-side gate worked correctly (its own day-type queries
// succeeded, it decided to show a card, the browser sent the CORS
// preflight to morning-checkin) — but the actual POST never landed
// (OPTIONS 204 logged, no POST after it), a one-off network drop on the
// mobile connection, not a logic bug. Cost the entire day because
// Coach.jsx's restoreThread() only ever attempts a check-in on the first
// genuine open of a day — once that single attempt's fallback thread is
// saved, no later reopen the same day tries again (see restoreThread's
// resume branch, which just replays the stored thread). One retry here is
// contained, cheap insurance against exactly that kind of transient
// failure, without touching the once-per-day thread logic at all.
const CHECKIN_RETRY_DELAY_MS = 1500

async function invokeMorningCheckin() {
  const { data, error } = await withTimeout(supabase.functions.invoke('morning-checkin'), CHECKIN_TIMEOUT_MS)
  if (error || !data) throw error ?? new Error('No response from morning-checkin')
  return data
}

// Best-effort, same pattern as dayProgress.js's fetchProteinProgress — a
// greeting is not worth a spinner or an error state. Any failure or
// slowness (8s budget per attempt, longer than dayProgress's 3s since this
// is an LLM call, not a DB query) falls back to {ok:false} after one
// retry, letting the caller use the point-7 template instead.
export async function fetchMorningCheckin() {
  try {
    const data = await invokeMorningCheckin()
    return { ok: true, card: data.card ?? null }
  } catch (firstErr) {
    console.error('fetchMorningCheckin: first attempt failed, retrying once', firstErr)
    await delay(CHECKIN_RETRY_DELAY_MS)
    try {
      const data = await invokeMorningCheckin()
      return { ok: true, card: data.card ?? null }
    } catch (secondErr) {
      console.error('fetchMorningCheckin failed after retry, falling back to template opening', secondErr)
      return { ok: false }
    }
  }
}
