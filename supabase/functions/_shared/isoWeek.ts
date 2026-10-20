// ISO-8601 week + ISO week-year, computed in whole calendar days in
// Europe/Amsterdam. Second copy of workout-app/src/isoWeek.js — keep the
// two identical in behaviour; workout-app/scripts/test-iso-week.mjs runs both
// against date-fns for every day 2020-2035 in several process time zones.
//
// Whole days only: a date goes in as (year, month, day), never as a moment
// with a time of day, so the hour can never change the result (the old
// `Math.ceil(days / 7)` formula received amsterdamNow() and returned one
// week too many in years where Jan 1 is a Friday, e.g. 4 Jan 2027 -> 2).
// ISO week and ISO year always come together: 1-3 Jan 2027 is 2026-W53.

export interface IsoWeek {
  isoYear: number
  isoWeek: number
}

const DAY_MS = 86400000

// Days since 1970-01-01 for a calendar date. Date.UTC keeps it an integer
// with no time zone or DST involved.
function dayNumber(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / DAY_MS
}

// 1 = Monday .. 7 = Sunday (1970-01-01, day 0, was a Thursday).
function weekdayOfDay(day: number): number {
  return ((((day + 3) % 7) + 7) % 7) + 1
}

function formatDay(day: number): string {
  const dt = new Date(day * DAY_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function isoWeekFromYmd(y: number, m: number, d: number): IsoWeek {
  const day = dayNumber(y, m, d)
  // The ISO year is the calendar year of this week's Thursday.
  const thursday = day + 4 - weekdayOfDay(day)
  const isoYear = new Date(thursday * DAY_MS).getUTCFullYear()
  const isoWeek = Math.floor((thursday - dayNumber(isoYear, 1, 1)) / 7) + 1
  return { isoYear, isoWeek }
}

// The Europe/Amsterdam calendar date of an instant, whatever the process
// time zone is.
const AMSTERDAM_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
})

export function amsterdamYmd(instant: Date = new Date()): { y: number; m: number; d: number } {
  const parts = AMSTERDAM_DATE.formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

// Today's ISO week/year and ISO weekday (1 = Monday) in Amsterdam.
export function currentIsoWeek(instant: Date = new Date()): IsoWeek & { weekday: number } {
  const { y, m, d } = amsterdamYmd(instant)
  return { ...isoWeekFromYmd(y, m, d), weekday: weekdayOfDay(dayNumber(y, m, d)) }
}

// Edge Function convention: amsterdamNow() / resolveActiveDate() /
// dateFromIsoString() build Dates whose *local* getters hold the Amsterdam
// wall-clock date (constructed and read in the same process time zone), so
// this reads the local getters — the result never depends on the process
// time zone or the time of day.
export function isoWeekOf(d: Date): IsoWeek {
  return isoWeekFromYmd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

// The calendar date (YYYY-MM-DD) of ISO weekday `weekday` (1 = Monday) in
// ISO week `isoWeek` of ISO year `isoYear`. Week 1 is the week containing
// 4 January.
export function isoWeekDate(isoYear: number, isoWeek: number, weekday: number): string {
  const jan4 = dayNumber(isoYear, 1, 4)
  const week1Monday = jan4 - weekdayOfDay(jan4) + 1
  return formatDay(week1Monday + (isoWeek - 1) * 7 + (weekday - 1))
}

// A continuous week count (consecutive ISO weeks differ by exactly 1, also
// across New Year), for week arithmetic.
export function isoWeekSerial(isoYear: number, isoWeek: number): number {
  const jan4 = dayNumber(isoYear, 1, 4)
  const monday = jan4 - weekdayOfDay(jan4) + 1 + (isoWeek - 1) * 7
  return (monday - 4) / 7 // day 4 = Monday 1970-01-05
}
