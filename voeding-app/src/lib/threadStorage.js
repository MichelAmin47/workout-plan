// Caches the current day's chat thread client-side, same pattern as
// cached_schema_v2 in the workout app. Keyed by a single fixed storage key;
// the date lives inside the stored value (stamped once when a fresh thread
// starts, not recomputed per save) so a conversation crossing midnight
// doesn't silently get reassigned to the next day mid-conversation.
//
// summaryIdAtStart: the coach_sessions row id (or null) that already existed
// for this thread's date at the moment the thread was stamped fresh. On the
// next app open, comparing this against what currently exists for that date
// is how the client tells "the cron closed this day while I was away, the
// thread is stale" apart from "I already closed once today and started a
// brand-new thread afterward, which is still perfectly valid to resume" —
// both cases have a coach_sessions row present, but only the first one
// appeared *after* this thread started.

const STORAGE_KEY = 'coach_thread_v1'

// Mirrors the server's _shared/today.ts resolveActiveDate — must stay in
// sync (same 04:00 cutoff, same reasoning: before it, still finishing the
// day that just ended, not starting a new one early). Every call site in
// this app uses this to mean "which day is active right now" — thread
// dates, rollover detection, whether today's already closed — never the
// literal raw calendar date, so this is a direct behavior change rather
// than a parallel function callers would have to remember to pick between.
const ACTIVE_DAY_CUTOFF_HOUR = 4

export function todayDateString() {
  const d = new Date()
  if (d.getHours() < ACTIVE_DAY_CUTOFF_HOUR) {
    d.setDate(d.getDate() - 1)
  }
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function loadStoredThread() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.date || !Array.isArray(parsed.messages)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveThread(date, messages, summaryIdAtStart) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date, messages, summaryIdAtStart: summaryIdAtStart ?? null }))
  } catch {
    // localStorage unavailable/full — non-fatal, thread just won't persist
  }
}

export function clearThread() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
