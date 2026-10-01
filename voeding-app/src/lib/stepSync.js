import { Capacitor } from '@capacitor/core'
import { Health } from '@capgo/capacitor-health'
import { supabase } from '../supabase.js'

const PERMISSION_DECIDED_KEY = 'step_permission_decided_v1'
// Per-date readSamples() limit, raised from the plugin's own default of
// 100 — see the build plan's "Native call strategy" section. The plugin's
// QueryOptions exposes no cursor/offset at all, so this isn't true
// pagination, just a generously-sized ceiling per single day (far more
// bounded than a whole date range would be). A date that still exceeds this
// loses some of its `bronnen` provenance, never its `stappen` count (that
// comes from the independent queryAggregated() call) — a reported, accepted
// residual risk, not a solved one.
const SAMPLES_LIMIT_PER_DAY = 500
const BACKFILL_DAYS = 29 // + today = 30, Health Connect's own default cap
const CATCHUP_DAYS = 6 // + the re-synced last-stored date = 7

// Plain Europe/Amsterdam calendar day — NOT threadStorage.js's activeDate(),
// which shifts by a 04:00 cutoff for the nutrition day. Steps deliberately
// do not follow that shift (stated explicitly in the build plan). Like the
// rest of this client's date code, this trusts the device's own local clock
// (assumed to already be set to Amsterdam) rather than doing explicit Intl
// timezone math — consistent with todayDateString()'s own approach, just
// without the cutoff shift.
function stepDayString(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Noon-anchored before formatting back to YYYY-MM-DD, to avoid any
// DST-transition skew in day-increment arithmetic — this is pure date-list
// bookkeeping, never used to construct an instant boundary (see
// dayInstantBounds below for that).
function addDaysNoonAnchored(dateStr, n) {
  const [y, m, day] = dateStr.split('-').map(Number)
  const noon = new Date(y, m - 1, day, 12, 0, 0)
  noon.setDate(noon.getDate() + n)
  return stepDayString(noon)
}

function enumerateDates(startStr, endStr) {
  const dates = []
  let cur = startStr
  while (cur <= endStr) {
    dates.push(cur)
    cur = addDaysNoonAnchored(cur, 1)
  }
  return dates
}

// Exact local-midnight instant boundaries for one calendar date — startDate
// inclusive, endDate exclusive (per the plugin's own QueryOptions/
// QueryAggregatedOptions docs). Built from local year/month/day components;
// .toISOString() already produces the correct UTC-equivalent instant via the
// JS engine's own (OS) timezone database, so no manual DST handling is
// needed here either.
function dayInstantBounds(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0)
  const end = new Date(y, m - 1, d + 1, 0, 0, 0)
  return { startDate: start.toISOString(), endDate: end.toISOString() }
}

function laterOf(a, b) {
  return a > b ? a : b
}

async function ensureAuthorized() {
  let decided
  try {
    decided = localStorage.getItem(PERMISSION_DECIDED_KEY)
  } catch {
    decided = null
  }
  if (decided === 'granted') return true
  if (decided === 'denied') return false

  const status = await Health.checkAuthorization({ read: ['steps'] })
  if (status?.read?.includes?.('steps')) {
    try {
      localStorage.setItem(PERMISSION_DECIDED_KEY, 'granted')
    } catch {
      // non-fatal
    }
    return true
  }

  const result = await Health.requestAuthorization({ read: ['steps'], write: [] })
  const granted = !!result?.read?.includes?.('steps')
  try {
    localStorage.setItem(PERMISSION_DECIDED_KEY, granted ? 'granted' : 'denied')
  } catch {
    // non-fatal
  }
  return granted
}

// Per date, not one multi-day bucketed call — when the requested range
// already IS the bucket, there's nothing left to bucket, sidestepping
// whether the plugin buckets by local period or by fixed UTC duration
// across a multi-day range. Empty `samples` is treated as "no data," not
// "zero steps" — skip rather than risk stomping a real value with an
// assumed 0 (documented assumption, not yet device-verified).
async function readAggregatedStepsForDay(dateStr) {
  const { startDate, endDate } = dayInstantBounds(dateStr)
  const { samples } = await Health.queryAggregated({
    dataType: 'steps',
    startDate,
    endDate,
    bucket: 'day',
    aggregation: 'sum',
  })
  if (!samples || samples.length === 0) return null
  return Math.round(samples[0].value)
}

// Also per date — readSamples() has no cursor/offset at all (confirmed from
// the plugin's own QueryOptions: `limit` defaults to 100, `ascending`
// defaults to false/newest-first, ReadSamplesResult carries no truncation
// flag), so a single multi-day call across a 30-day backfill risks silently
// missing sources for the oldest days. `bronnen` means "apps that wrote at
// least one raw step record that day," not "the app whose value the
// aggregate actually used" — the two calls are independent.
async function harvestSourcesForDay(dateStr) {
  const { startDate, endDate } = dayInstantBounds(dateStr)
  const { samples } = await Health.readSamples({
    dataType: 'steps',
    startDate,
    endDate,
    limit: SAMPLES_LIMIT_PER_DAY,
  })
  const names = new Set()
  for (const s of samples ?? []) {
    if (s.sourceName) names.add(s.sourceName)
  }
  return Array.from(names)
}

// Best-effort, silent-degradation sync — same shape as dayProgress.js's
// fetchProteinProgress / morningCheckin.js's fetchMorningCheckin: one
// exported async function, never throws, returns null on any failure, no
// retry loop (if it fails, the next app open/resume just tries again).
export async function syncSteps() {
  if (!Capacitor.isNativePlatform()) return null
  // Deterministic guard for "old APK running new web code" (the plugin
  // simply isn't registered) — used alongside, not instead of, the
  // try/catch below, which also covers "plugin present but Health Connect
  // itself unavailable" or "permission denied".
  if (!Capacitor.isPluginAvailable('Health')) return null

  try {
    const available = await Health.isAvailable()
    if (!available?.available) return null

    const authorized = await ensureAuthorized()
    if (!authorized) return null

    const { data: lastRows } = await supabase
      .from('step_log')
      .select('datum')
      .order('datum', { ascending: false })
      .limit(1)

    const todayStr = stepDayString()
    const startStr =
      !lastRows || lastRows.length === 0
        ? addDaysNoonAnchored(todayStr, -BACKFILL_DAYS)
        : laterOf(lastRows[0].datum, addDaysNoonAnchored(todayStr, -CATCHUP_DAYS))

    const dates = enumerateDates(startStr, todayStr)
    const rows = []
    for (const d of dates) {
      const total = await readAggregatedStepsForDay(d)
      if (total === null) continue
      const bronnen = await harvestSourcesForDay(d)
      rows.push({ datum: d, stappen: total, bronnen, bijgewerkt_op: new Date().toISOString() })
    }
    if (rows.length === 0) return null

    const { data } = await supabase.from('step_log').upsert(rows, { onConflict: 'datum' }).select()
    return data?.find((r) => r.datum === todayStr) ?? null
  } catch (err) {
    console.error('syncSteps failed, will retry on next open/resume', err)
    return null
  }
}
