import { Capacitor } from '@capacitor/core'
import { Health } from '@capgo/capacitor-health'
import { supabase } from '../supabase.js'

// v1 stored a decision derived from a nonexistent `read` field on the
// plugin's AuthorizationStatus, so every real grant was saved as 'denied'.
// It is ignored and removed; v2 only ever records an explicit denial.
const LEGACY_PERMISSION_KEY = 'step_permission_decided_v1'
const PERMISSION_DENIED_KEY = 'step_permission_denied_v2'
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
// Every sync after the first re-reads this whole window, regardless of what
// is already stored: source apps (Samsung Health) often write a day to
// Health Connect late, so a date skipped as "no data" must get another
// chance on later syncs — a start date derived from the latest stored datum
// left such gaps permanently unfilled.
const CATCHUP_DAYS = 6 // + today = 7

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

// Dates one sync reads: the 30-day backfill on the very first sync (empty
// table), otherwise always today − 6 … today.
function syncDates(todayStr, tableEmpty) {
  const back = tableEmpty ? BACKFILL_DAYS : CATCHUP_DAYS
  return enumerateDates(addDaysNoonAnchored(todayStr, -back), todayStr)
}

// One console.warn per reason a sync stopped short — the only trace a
// silent-degradation sync leaves, visible via chrome://inspect or
// `adb logcat` (Capacitor/Console).
function logExit(reason, details) {
  console.warn(`[stepSync] ${reason}`, details ?? '')
}

function readsSteps(status) {
  return Array.isArray(status?.readAuthorized) && status.readAuthorized.includes('steps')
}

function storageGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // non-fatal
  }
}

// checkAuthorization() runs on every sync (cheap, no UI), so a grant or a
// revoke made in Health Connect's own settings is always picked up — a
// cached 'granted' could go stale. The stored flag only gates the prompt:
// after an explicit denial we don't re-prompt on every open.
async function ensureAuthorized() {
  storageSet(LEGACY_PERMISSION_KEY, null)

  const status = await Health.checkAuthorization({ read: ['steps'] })
  if (readsSteps(status)) {
    storageSet(PERMISSION_DENIED_KEY, null)
    return true
  }
  if (storageGet(PERMISSION_DENIED_KEY) === 'denied') {
    logExit('not authorized; previously denied, not re-prompting', status)
    return false
  }

  const result = await Health.requestAuthorization({ read: ['steps'], write: [] })
  if (readsSteps(result)) return true
  storageSet(PERMISSION_DENIED_KEY, 'denied')
  logExit('not authorized; permission request denied', result)
  return false
}

// Per date, not one multi-day bucketed call — when the requested range
// already IS the bucket, there's nothing left to bucket, sidestepping
// whether the plugin buckets by local period or by fixed UTC duration
// across a multi-day range. Empty `samples` is treated as "no data," not
// "zero steps" — skip rather than risk stomping a real value with an
// assumed 0 (the plugin only emits a bucket whose aggregate is non-null).
// All buckets are summed: the plugin's 'day' bucket is a fixed 24h
// Duration, so a 25h DST fall-back day comes back as two buckets.
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
  return Math.round(samples.reduce((sum, s) => sum + (s.value ?? 0), 0))
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

// Platform-independent display read, deliberately separate from syncSteps()
// below — the header must show whatever is already in step_log for today
// regardless of whether a native sync just ran, succeeded, or is even
// possible on this platform (plain web browser, old APK, no permission).
// Coupling the display to "did a sync happen this session" would mean a
// perfectly valid existing row for today renders as nothing whenever that
// session's own sync attempt failed or never ran — exactly what "render
// based on whether a row exists" is supposed to prevent. syncSteps() still
// separately pushes a fresher value into the display immediately after a
// successful write, via its own return value.
export async function fetchTodaySteps() {
  try {
    const { data } = await supabase.from('step_log').select('stappen').eq('datum', stepDayString()).limit(1)
    if (!data || data.length === 0) return { ok: false }
    return { ok: true, stappen: data[0].stappen }
  } catch (err) {
    console.error('fetchTodaySteps failed', err)
    return { ok: false }
  }
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
  if (!Capacitor.isPluginAvailable('Health')) {
    logExit('Health plugin not available')
    return null
  }

  try {
    const available = await Health.isAvailable()
    if (!available?.available) {
      logExit('Health Connect not available', available)
      return null
    }

    const authorized = await ensureAuthorized()
    if (!authorized) return null

    // Only "is the table empty?" — the window itself never depends on what
    // is stored. On error this falls back to the 30-day backfill, which is
    // safe: the upsert only ever writes Health Connect's own values.
    const { data: anyRows, error: anyRowsError } = await supabase.from('step_log').select('datum').limit(1)
    if (anyRowsError) logExit('table-empty query error', anyRowsError)

    const todayStr = stepDayString()
    const dates = syncDates(todayStr, !anyRows || anyRows.length === 0)
    const rows = []
    for (const d of dates) {
      const total = await readAggregatedStepsForDay(d)
      if (total === null) continue
      const bronnen = await harvestSourcesForDay(d)
      rows.push({ datum: d, stappen: total, bronnen, bijgewerkt_op: new Date().toISOString() })
    }
    if (rows.length === 0) {
      logExit('no step data for any date')
      return null
    }

    const { data, error: upsertError } = await supabase.from('step_log').upsert(rows, { onConflict: 'datum' }).select()
    if (upsertError) {
      logExit('upsert error', upsertError)
      return null
    }
    return data?.find((r) => r.datum === todayStr) ?? null
  } catch (err) {
    console.error('syncSteps failed, will retry on next open/resume', err)
    return null
  }
}
