// Behavioural test for the two copies of the ISO-week helper:
//   workout-app/src/isoWeek.js            (Vite frontend)
//   supabase/functions/_shared/isoWeek.ts (Deno Edge Functions)
// Every day 2020-01-01 .. 2035-12-31 at 00:00, 00:01, 12:00 and 23:59
// Europe/Amsterdam (DST included) against date-fns getISOWeek /
// getISOWeekYear. Run it in several process time zones; it must report 0
// mismatches in every one:
//   TZ=UTC node scripts/test-iso-week.mjs
//   TZ=Europe/Amsterdam node scripts/test-iso-week.mjs
//   TZ=America/Los_Angeles node scripts/test-iso-week.mjs
// (Node 22.18+ strips the .ts copy's types natively.)
import { getISOWeek, getISOWeekYear, getISODay } from "date-fns";
import * as js from "../src/isoWeek.js";
import * as ts from "../../supabase/functions/_shared/isoWeek.ts";

const TIMES = [[0, 0], [0, 1], [12, 0], [23, 59]];
const ams = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Amsterdam", hourCycle: "h23",
  year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
});
const partsOf = (instant) => {
  const p = Object.fromEntries(ams.formatToParts(instant).map((x) => [x.type, x.value]));
  return [+p.year, +p.month, +p.day, +p.hour, +p.minute];
};
// The real instant at which Amsterdam's wall clock shows y-m-d hh:mm
// (offset is +1h in winter, +2h in summer). None of the four times falls in
// a DST gap (transitions are at 02:00/03:00).
function amsterdamInstant(y, m, d, hh, mm) {
  for (const off of [1, 2]) {
    const t = new Date(Date.UTC(y, m - 1, d, hh, mm) - off * 3600000);
    const [Y, M, D, H, MI] = partsOf(t);
    if (Y === y && M === m && D === d && H === hh && MI === mm) return t;
  }
  throw new Error(`no instant for ${y}-${m}-${d} ${hh}:${mm}`);
}

// The pre-fix formula (currentWeekIndex / currentCalWeek), as a negative
// control: proves this test catches the bug it exists for.
function oldFormula(dt) {
  const dow = dt.getDay() || 7;
  const s = new Date(dt);
  s.setDate(s.getDate() + 4 - dow);
  const jan1 = new Date(s.getFullYear(), 0, 1);
  return Math.ceil(((s.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
}

const pad = (n) => String(n).padStart(2, "0");
let checks = 0;
const mismatches = { js: 0, ts: 0, tsIsoWeekOf: 0, isoWeekDate: 0, weekday: 0, serial: 0, old: 0 };
const samples = [];
const note = (kind, msg) => { mismatches[kind]++; if (samples.length < 20) samples.push(`${kind}: ${msg}`); };
const oldHits = {};

let prevSerial = null, prevRefWeekKey = null;
for (let day = Date.UTC(2020, 0, 1); day <= Date.UTC(2035, 11, 31); day += 86400000) {
  const u = new Date(day);
  const y = u.getUTCFullYear(), m = u.getUTCMonth() + 1, d = u.getUTCDate();
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  // Reference: date-fns on the calendar date (local noon in this process).
  const refDate = new Date(y, m - 1, d, 12);
  const ref = { isoYear: getISOWeekYear(refDate), isoWeek: getISOWeek(refDate) };
  const refWd = getISODay(refDate);

  for (const [hh, mm] of TIMES) {
    const instant = amsterdamInstant(y, m, d, hh, mm);
    const label = `${iso} ${pad(hh)}:${pad(mm)}`;
    for (const [kind, mod] of [["js", js], ["ts", ts]]) {
      const got = mod.currentIsoWeek(instant);
      checks++;
      if (got.isoYear !== ref.isoYear || got.isoWeek !== ref.isoWeek) note(kind, `${label} got ${got.isoYear}-W${got.isoWeek} want ${ref.isoYear}-W${ref.isoWeek}`);
      if (got.weekday !== refWd) note("weekday", `${kind} ${label} got ${got.weekday} want ${refWd}`);
    }
    // Edge Function convention: a Date whose local getters hold the
    // Amsterdam wall clock (what amsterdamNow() returns).
    const wall = new Date(y, m - 1, d, hh, mm);
    const w = ts.isoWeekOf(wall);
    checks++;
    if (w.isoYear !== ref.isoYear || w.isoWeek !== ref.isoWeek) note("tsIsoWeekOf", `${label} got ${w.isoYear}-W${w.isoWeek}`);
    const old = oldFormula(wall);
    if (old !== ref.isoWeek) {
      mismatches.old++;
      if (["2027-01-04 00:01", "2028-01-01 00:01", "2027-01-04 00:00"].includes(label)) oldHits[label] = old;
    } else if (["2027-01-04 00:00"].includes(label)) oldHits[label] = old;
  }
  for (const [kind, mod] of [["js", js], ["ts", ts]]) {
    if (mod.isoWeekDate(ref.isoYear, ref.isoWeek, refWd) !== iso) note("isoWeekDate", `${kind} ${iso}`);
  }
  // isoWeekSerial: +0 within an ISO week, +1 from one week to the next.
  const serial = js.isoWeekSerial(ref.isoYear, ref.isoWeek);
  if (serial !== ts.isoWeekSerial(ref.isoYear, ref.isoWeek)) note("serial", `js/ts differ ${iso}`);
  const key = `${ref.isoYear}-${ref.isoWeek}`;
  if (prevSerial != null) {
    const want = key === prevRefWeekKey ? prevSerial : prevSerial + 1;
    if (serial !== want) note("serial", `${iso} got ${serial} want ${want}`);
  }
  prevSerial = serial; prevRefWeekKey = key;
}

const ok = ["js", "ts", "tsIsoWeekOf", "isoWeekDate", "weekday", "serial"].every((k) => mismatches[k] === 0);
console.log(JSON.stringify({
  tz: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  checks,
  mismatches,
  oldFormulaSamples: oldHits,
  spotChecks: {
    "2027-01-01": js.isoWeekFromYmd(2027, 1, 1),
    "2027-01-03": js.isoWeekFromYmd(2027, 1, 3),
    "2027-01-04": js.isoWeekFromYmd(2027, 1, 4),
    "2028-01-01": js.isoWeekFromYmd(2028, 1, 1),
    "2026-W53": [1, 2, 3, 4, 5, 6, 7].map((wd) => js.isoWeekDate(2026, 53, wd)),
    "2027-W1": [1, 2, 3, 4, 5, 6, 7].map((wd) => js.isoWeekDate(2027, 1, wd)),
  },
  samples,
  result: ok ? "PASS" : "FAIL",
}, null, 1));
process.exit(ok ? 0 : 1);
