import { useState, useEffect, useRef } from "react";
import { supabase } from "./src/supabase.js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { registerPlugin } from "@capacitor/core";
import { currentIsoWeek, isoWeekDate } from "./src/isoWeek.js";
const BatteryOptimization = registerPlugin("BatteryOptimization");
const NativeTimer = registerPlugin("NativeTimer");


const dayColors = {
  1: { bg: "#fff1f2", accent: "#e63946", light: "#fecdd3" },
  2: { bg: "#eff6ff", accent: "#2563eb", light: "#bfdbfe" },
  3: { bg: "#f5f3ff", accent: "#7c3aed", light: "#ede9fe" },
  4: { bg: "#fefce8", accent: "#ca8a04", light: "#fef08a" },
};

const phaseColors = {
  "Deload": { bg: "#fef3c7", text: "#92400e", dot: "#f59e0b" },
  "Opbouw": { bg: "#dbeafe", text: "#1e40af", dot: "#3b82f6" },
  "Nieuwe Prikkel": { bg: "#ede9fe", text: "#6d28d9", dot: "#8b5cf6" },
};

// Any phase value that isn't in phaseColors (a future block's new label,
// stale cache) still needs a badge rather than a crash at render.
const phaseColorFallback = { bg: "#f1f5f9", text: "#475569", dot: "#94a3b8" };


function hexA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Every in-memory week key is a "yw" (ISO year * 100 + ISO week, e.g.
// 202653, 202701): sorting yw numerically is sorting by (jaar, week), so
// history ordering and "earlier week" comparisons work across New Year.
// week rows carry it as `w.yw`; Supabase rows are mapped with ywOf().
function ywOf(jaar, week) {
  return jaar * 100 + week;
}

function splitYw(yw) {
  return { jaar: Math.floor(yw / 100), week: yw % 100 };
}

function wKey(exercise, yw) {
  return `${exercise}__${yw}`;
}

// exercises.reps is free text: a single number ("8"), or — starting with
// the week 41 block — a range ("10-12") where the upper bound is the
// target to hit on every set before increasing weight, the lower bound a
// floor (guidance only; the stepper never clamps to either). Only the
// upper bound is ever prefilled. Absent/unparseable -> null, same as
// today's "no prefill" behavior — never NaN (the old inline
// `Number(e.reps)` produced a literal "NaN" in the stepper for a range,
// with both +/- buttons permanently stuck reproducing NaN and no text
// input to correct it — this replaces that call site).
function parsePrescribedReps(raw) {
  if (raw == null) return null;
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(String(raw).trim());
  if (range) return Number(range[2]);
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// "Usable" means present and a positive number — 0, "", null, and
// unparseable strings are all "no data" for 1RM purposes, matching the
// same two-part empty-string-or-null guard every other reps consumer in
// this file already uses (see the "Laatste keer" line).
function usableReps(raw) {
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Epley: weight * (1 + reps/30), rounded to 1 decimal. Used by the
// Progressie chart to plot an estimated 1RM alongside logged weight, so a
// weight/reps trade-off (e.g. lower weight, more reps) doesn't read as a
// plain decline.
function estimatedOneRepMax(weight, reps) {
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

function dKey(yw, dayId) {
  return `${yw}__${dayId}`;
}

// The calendar date (YYYY-MM-DD) of a day in a week object: ISO weekday
// dagVolgorde (1=Mon..7=Sun, same numbering as schema_days.dag_volgorde)
// of ISO week w.week of ISO year w.jaar. 2026-W53 runs 2026-12-28 ..
// 2027-01-03; the year comes from the week, never from today's date.
function dateForDay(w, dagVolgorde) {
  return isoWeekDate(w.jaar, w.week, dagVolgorde);
}

function eKey(exercise, yw, dayId) {
  return `${exercise}__${yw}__${dayId}`;
}

function sKey(original, yw, dayId) {
  return `${original}__${yw}__${dayId}`;
}

// The schema-1 block (2026 weeks 23-30) is the only one laid out as
// Barbell hoofdoefening + Spiergroep; every later block uses supersets.
// Was `week.yw >= 31`, which would have put 2027 weeks 1-30 back on the
// old layout. Data-driven detection doesn't work (schema 1 has two
// "Superset 1" notes of its own).
function usesSupersetLayout(w) {
  return !(w.jaar === 2026 && w.week < 31);
}

// The one "is this week a deload" check, used by the write path to set
// weights.deload. Exact match on schema_weeks.phase, never on weight_hint.
function isDeloadWeek(yw, weeks) {
  return weeks.find(w => w.yw === yw)?.phase === "Deload";
}

// The one "may this weights entry serve as a reference" check: a deload
// row is never "Laatste keer", a PR, a chart point or a summary baseline.
// A missing field counts as usable.
function isReferenceWeight(entry) {
  return entry?.deload !== true;
}

// The most recent earlier week (highest yw below currentYw, across years —
// in 2027-W1 that is the last real week of 2026) with a logged M or Z
// reference weight. The label names the year only when it differs from
// the current week's year.
function findPrevWeight(exerciseName, currentYw, weights) {
  let best = null;
  for (const [k, entry] of Object.entries(weights)) {
    const i = k.lastIndexOf("__");
    if (k.slice(0, i) !== exerciseName) continue;
    const yw = Number(k.slice(i + 2));
    if (yw >= currentYw || (best && yw <= best.yw)) continue;
    if (!isReferenceWeight(entry)) continue;
    if (entry && (entry.M !== "" && entry.M != null || entry.Z !== "" && entry.Z != null)) best = { yw, entry };
  }
  if (!best) return null;
  const { yw, entry } = best;
  const { jaar, week } = splitYw(yw);
  const yearSuffix = jaar !== splitYw(currentYw).jaar ? ` (${jaar})` : "";
  return { M: entry.M, Z: entry.Z, repsM: entry.repsM, repsZ: entry.repsZ, weekNum: yw, label: `Laatste keer — Week ${week}${yearSuffix}` };
}

// All-time highest logged M weight per exact exercise string, over every
// week in `weights` (including the current and later weeks). Reps are
// ignored. `value` is the raw stored value so it formats exactly like the
// "Laatste keer" line. Only M: Z is hidden everywhere in the UI. Deload
// rows never count.
function buildPersonalRecords(weights) {
  const prs = {};
  for (const [k, entry] of Object.entries(weights)) {
    if (!isReferenceWeight(entry)) continue;
    const n = Number(entry?.M);
    if (entry?.M === "" || entry?.M == null || !Number.isFinite(n) || n <= 0) continue;
    const exercise = k.slice(0, k.lastIndexOf("__"));
    if (!prs[exercise] || n > prs[exercise].num) prs[exercise] = { num: n, value: entry.M };
  }
  return prs;
}

// Dutch decimal comma. Without `decimals`: 45 -> "45", 13.5 -> "13,5";
// with: formatNl(57, 1) -> "57,0".
function formatNl(n, decimals) {
  const s = decimals != null ? n.toFixed(decimals) : String(Math.round(n * 100) / 100);
  return s.replace(".", ",");
}

// Every week with a numeric M weight for this exact exercise string,
// ascending by yw, i.e. by (jaar, week) — across years. Same key parsing as
// buildPersonalRecords. Only M. Deload rows are left out.
function measuredWeeksM(exercise, weights) {
  const out = [];
  for (const [k, entry] of Object.entries(weights)) {
    const i = k.lastIndexOf("__");
    if (k.slice(0, i) !== exercise) continue;
    if (!isReferenceWeight(entry)) continue;
    if (entry?.M === "" || entry?.M == null) continue;
    const kg = Number(entry.M);
    if (!Number.isFinite(kg)) continue;
    out.push({ yw: Number(k.slice(i + 2)), kg, reps: usableReps(entry.repsM) });
  }
  return out.sort((a, b) => a.yw - b.yw);
}

// Whether `name` took part in an exercise swap in week `yw` (as original or
// replacement). Swapped weeks have no reliable prescription for the name.
function swappedInWeek(name, yw, swaps) {
  return Object.entries(swaps).some(([k, v]) => {
    const [original, w] = k.split("__");
    return Number(w) === yw && (original === name || v === name);
  });
}

// Day summary row for one exercise in one week (person M). "Vorige keer"
// is findPrevWeight, the same lookup as the "Laatste keer" line. PRs are
// strictly greater than every earlier (lower yw, any year) week; ties and "no earlier
// week" are not a PR. PR 1RM needs usable reps today and only compares
// against earlier weeks that have usable reps.
//
// A different prescribed upper bound (prescribedReps, already
// parsePrescribedReps' upper bound) between today and the "vorige keer" week
// means a planned rep-range switch: a kg change then reads "nieuw
// repbereik" instead of a misleading kg delta. Unknown prescription in
// either week, or a swap, falls back to the normal delta.
//
// A deload row today gets the "deload" chip, no PRs and no e1RM delta.
// "Vorige keer", PRs and the sparkline never include deload rows (see
// findPrevWeight / measuredWeeksM).
function summarizeExercise(name, yw, weights, prescribedReps = {}, swaps = {}) {
  const entry = weights[wKey(name, yw)];
  const deload = !isReferenceWeight(entry);
  const kg = Number(entry?.M);
  const reps = usableReps(entry?.repsM);
  const e1rm = reps != null ? estimatedOneRepMax(kg, reps) : null;

  const prevResult = findPrevWeight(name, yw, weights);
  const prevKg = prevResult && prevResult.M !== "" && prevResult.M != null ? Number(prevResult.M) : null;
  const prevReps = prevResult ? usableReps(prevResult.repsM) : null;

  const presToday = prescribedReps[wKey(name, yw)];
  const presPrev = prevResult ? prescribedReps[wKey(name, prevResult.weekNum)] : undefined;
  const newRepRange = presToday != null && presPrev != null && presToday !== presPrev
    && !swappedInWeek(name, yw, swaps) && !swappedInWeek(name, prevResult.weekNum, swaps);

  let delta;
  if (deload) delta = { label: "deload", up: false };
  else if (prevKg == null) delta = { label: "eerste meting", up: false };
  else if (kg !== prevKg) {
    const d = Math.round((kg - prevKg) * 100) / 100;
    delta = newRepRange
      ? { label: "nieuw repbereik", up: false }
      : { label: `${d > 0 ? "+" : "−"}${formatNl(Math.abs(d))} kg`, up: d > 0 };
  } else if (reps != null && prevReps != null && reps !== prevReps) {
    const d = reps - prevReps;
    delta = { label: `${d > 0 ? "+" : "−"}${Math.abs(d)} ${Math.abs(d) === 1 ? "rep" : "reps"}`, up: d > 0 };
  } else delta = { label: newRepRange ? "nieuw repbereik" : "gelijk", up: false };

  // e1RM delta from the two displayed (one-decimal) values, in tenths, so
  // the shown numbers always add up.
  const prevE1rm = prevKg != null && prevReps != null ? estimatedOneRepMax(prevKg, prevReps) : null;
  let e1rmDelta = null;
  if (!deload && e1rm != null && prevE1rm != null) {
    const t = Math.round(e1rm * 10) - Math.round(prevE1rm * 10);
    e1rmDelta = t === 0 ? "gelijk" : `${t > 0 ? "+" : "−"}${formatNl(Math.abs(t) / 10, 1)}`;
  }

  const measured = measuredWeeksM(name, weights);
  const earlier = measured.filter(m => m.yw < yw);
  const prKg = !deload && earlier.length > 0 && kg > Math.max(...earlier.map(m => m.kg));
  const earlier1rm = earlier.filter(m => m.reps != null).map(m => estimatedOneRepMax(m.kg, m.reps));
  const pr1rm = !deload && e1rm != null && earlier1rm.length > 0 && e1rm > Math.max(...earlier1rm);
  const spark = measured.filter(m => m.yw <= yw).slice(-6)
    .map(m => ({ kg: m.kg, e1rm: m.reps != null ? estimatedOneRepMax(m.kg, m.reps) : null }));

  return { name, kg, reps, e1rm, e1rmDelta, prevKg, prevReps, delta, prKg, pr1rm, spark };
}

// Whether the selected day has anything to summarize: a score row, a
// completed_days row, or an M weights row for one of the day's exercises
// (by displayed name) in that week. Z never counts.
function dayHasSummary(day, w, { dayScores, completedDays, weights, swaps }) {
  if (day.type === "power_hour" || day.type === "boksen") {
    return Boolean(dayScores[dateForDay(w, day.dag_volgorde)]);
  }
  if (day.type !== "training") return false;
  if (dayScores[dateForDay(w, day.dag_volgorde)]) return true;
  if (day.dag_nummer != null && completedDays.has(dKey(w.yw, day.dag_nummer))) return true;
  return [day.barbell, ...day.spiergroep, ...day.kettlebell, ...day.core, ...day.mobility].some((ex) => {
    if (!ex?.name) return false;
    const name = swaps[sKey(ex.name, w.yw, day.dag_nummer)] ?? ex.name;
    const m = weights[wKey(name, w.yw)]?.M;
    return m !== "" && m != null;
  });
}

const NL_MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

// "2026-10-13", "Di" -> "Di 13 okt"
function formatSummaryDate(datum, dagLabel) {
  const [, m, d] = datum.split("-").map(Number);
  return `${dagLabel} ${d} ${NL_MONTHS[m - 1]}`;
}

// "· PR 32kg" suffix for the "Laatste keer" line. Green when the weight
// logged for the viewed week equals the PR (hit or set it this week).
function PrText({ pr, currentWeight, standalone }) {
  if (!pr) return null;
  const isCurrent = currentWeight !== "" && currentWeight != null && Number(currentWeight) === pr.num;
  return (
    <>
      {!standalone && " · "}
      <span style={{ whiteSpace: "nowrap" }}>
        PR <span style={{ color: isCurrent ? "#16a34a" : "#1a1a1a", fontWeight: isCurrent ? 700 : 400 }}>{pr.value}kg</span>
      </span>
    </>
  );
}

function inferExerciseType(name, categorie) {
  if (categorie === "barbell" || /^(Barbell |T-Bar )/.test(name) || name.includes("(barbell)")) return "barbell";
  if (/^(DB |Incline DB )/.test(name) || name.includes("Dumbbell") || name === "Hammer Curl") return "dumbbell";
  if (/Cable|Pulldown/.test(name)) return "cable";
  if (/Machine|Leg Press|Hack Squat|Pec Deck/.test(name)) return "machine";
  return null;
}

function playBoxingBell() {
  const audio = new Audio("/boxing-bell.mp3");
  audio.volume = 1.0;
  audio.play().catch(() => {});
}

function triggerVibration() {
  Haptics.vibrate({ duration: 1600 }).catch(() => {});
}

function triggerImpact() {
  Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
}

function useTimer(initialSeconds, { onComplete, onStop } = {}) {
  const [timeLeft, setTimeLeft] = useState(initialSeconds);
  const [running, setRunning] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  useEffect(() => {
    let tickHandle, completeHandle, stoppedHandle;
    NativeTimer.addListener("timerTick", ({ timeLeft: t }) => {
      setTimeLeft(t);
    }).then((h) => { tickHandle = h; });
    NativeTimer.addListener("timerComplete", () => {
      setRunning(false);
      setTimeLeft(0);
      onCompleteRef.current?.();
    }).then((h) => { completeHandle = h; });
    NativeTimer.addListener("timerStopped", () => {
      setRunning(false);
      setTimeLeft(0);
      onStopRef.current?.();
    }).then((h) => { stoppedHandle = h; });
    return () => {
      tickHandle?.remove();
      completeHandle?.remove();
      stoppedHandle?.remove();
    };
  }, []);

  const start = (seconds, title = "") => {
    setTimeLeft(seconds);
    setRunning(true);
    NativeTimer.start({ seconds, title }).catch(console.error);
  };
  const pause = () => {
    setRunning(false);
    NativeTimer.pause().catch(console.error);
  };
  const reset = (seconds) => {
    setRunning(false);
    setTimeLeft(seconds);
    NativeTimer.stop().catch(console.error);
  };
  const restart = (seconds, title = "") => {
    setTimeLeft(seconds);
    setRunning(true);
    NativeTimer.restart({ seconds, title }).catch(console.error);
  };

  return { timeLeft, running, start, pause, reset, restart };
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTimerLabel(seconds) {
  if (seconds % 60 === 0) return `${seconds / 60}min`;
  return `${seconds}sec`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "10px 14px", boxShadow: "0 4px 12px #0002" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#1a1a1a" }}>{label}</div>
      {payload.map((p, i) => {
        // Reps only ever annotate the weight line ("M") — the 1RM line's
        // own value already reflects reps, so repeating them there would
        // double-count the same fact in the same tooltip.
        const reps = p.dataKey === "M" ? p.payload.repsM : null;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
            <span style={{ color: "#666" }}>{p.name}:</span>
            <span style={{ fontWeight: 700, color: "#1a1a1a" }}>{p.value} kg{reps != null ? ` × ${reps}` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}


const KB_EXERCISES = [
  "KB Alternating March", "KB Around the World", "KB Bent Over Row",
  "KB Bottoms-Up Press", "KB Clean & Press", "KB Farmer's Carry",
  "KB Figure 8", "KB Floor Press", "KB Goblet Squat", "KB Good Morning",
  "KB Halo", "KB High Pull", "KB Jump Squat", "KB Lateral Lunge",
  "KB Overhead Carry", "KB Renegade Row", "KB Single Arm Push Press",
  "KB Single Arm Swing", "KB Single Leg Deadlift", "KB Snatch",
  "KB Step-Up", "KB Suitcase Carry", "KB Suitcase Deadlift",
  "KB Sumo Deadlift", "KB Swing", "KB Swing (één arm)",
  "KB Thruster", "KB Turkish Get-Up", "KB Windmill", "KB Wood Chop",
];

// Bumped from v6: v6's cached weeks have no `jaar`/`yw` (ISO year, year-
// week key), so a stale v6 cache would key every lookup on undefined until
// the fresh fetch lands. See the mount effect below for the matching v6
// cleanup (mirrors the v2-v5 ones).
const SCHEMA_CACHE_KEY = "cached_schema_v7";

// Fallback naam/emoji for a "special activity" day (Power Hour, Boksen) when
// an override doesn't supply its own — mirrors the isTraining/isRust
// fallback branches below.
function specialActivityDefaults(type) {
  if (type === "boksen") return { naam: "Boksen", emoji: "🥊" };
  return { naam: "Power Hour", emoji: "🕐" };
}

const PAGE_SIZE = 1000;

// PostgREST caps a single response at 1000 rows by default. The exercises
// table crossed that threshold today (two inserts: a 9-row mobility batch
// plus a full new 10-week/500-row block) — a single
// .select("*").order("volgorde") call started silently truncating at a
// global volgorde cutoff, dropping whichever categories a day's authoring
// convention puts at a higher volgorde (kettlebell/core, on every day)
// regardless of which day was being viewed. Paginate explicitly so this
// can't silently recur as more blocks get added.
//
// .order("volgorde") alone is NOT a stable sort for paging: volgorde is
// per-day, not globally unique (every day has its own 1, 2, 3...), and
// Postgres gives no guaranteed tie-break order between separate requests —
// without a unique tiebreaker, rows with equal volgorde could silently
// overlap across pages (duplicated) or fall in the gap between pages
// (skipped), depending on how Postgres happens to order ties each time.
// `.order("id")` as a second sort key makes the ordering total and
// deterministic across all page requests.
//
// weights and completed_exercises (fetchUserData, below) are paged the
// same way — they reach 1000 rows around summer 2027. Their order ends in a
// unique tail too: weights (jaar, week, id); completed_exercises has no id,
// so its whole unique key (jaar, week, day, exercise).
async function fetchAllRows(table, orderColumns) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = supabase.from(table).select("*");
    for (const column of orderColumns) query = query.order(column);
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function buildWeeks(schemas, schemaDays, exercises, weekOverrides = [], schemaWeeks = []) {
  const allWeeks = [];
  for (const s of schemas) {
    // "calWeek__dagVolgorde" -> full override row for this schema
    const overrideMap = {};
    for (const o of weekOverrides) {
      if (o.schema_id === s.id) overrideMap[`${o.week_nummer}__${o.dag_nummer}`] = o;
    }
    const numWeeks = s.eind_week - s.start_week + 1;
    const schDays = schemaDays
      .filter(sd => sd.schema_id === s.id)
      .sort((a, b) => a.dag_volgorde - b.dag_volgorde);
    for (let relWeek = 1; relWeek <= numWeeks; relWeek++) {
      const calWeek = s.start_week + relWeek - 1;
      // Phase label comes from the schema_weeks table (one row per relative
      // week per schema). Fallback to the old hardcoded rule for any week
      // with no row — a future block before schema entry adds its rows, or a
      // data gap — so an unpopulated schema renders exactly as it does today.
      const phaseRow = schemaWeeks.find(sw => sw.schema_id === s.id && sw.week_nummer === relWeek);
      const phase = phaseRow?.phase ?? (relWeek <= 3 ? "Opbouw" : "Nieuwe Prikkel");
      const days = schDays.map(sd => {
        const ov = overrideMap[`${calWeek}__${sd.dag_volgorde}`];
        const effectiveType = ov?.dag_van_week || sd.type || "training";
        const isTraining = effectiveType === "training";
        const isSpecialActivity = effectiveType === "power_hour" || effectiveType === "boksen";
        // For training overrides with a naam, source exercises/colours from the matching schema_day
        const sourceSd = (ov && isTraining && ov.naam)
          ? (schDays.find(d => d.spiergroep_naam === ov.naam && d.type === "training") || sd)
          : sd;
        const base = {
          dayId: sd.id,
          dag_nummer: isTraining ? sourceSd.dag_nummer : null,
          type: effectiveType,
          dag_label: sd.dag_label,
          dag_volgorde: sd.dag_volgorde,
          emoji: ov ? (ov.emoji || (isSpecialActivity ? specialActivityDefaults(effectiveType).emoji : isTraining ? (sourceSd.type === "training" ? sourceSd.emoji : "🏋️") : "🏖️")) : sd.emoji,
          naam: ov ? (ov.naam || (isSpecialActivity ? specialActivityDefaults(effectiveType).naam : isTraining ? (sourceSd.type === "training" ? sourceSd.spiergroep_naam : "Training") : "Vrije dag")) : sd.spiergroep_naam,
          kleur: isTraining ? sourceSd.kleur : null,
        };
        if (!isTraining) return base;
        const dayExs = exercises.filter(e => e.schema_day_id === sourceSd.id && e.week_nummer === relWeek);
        const toEx = (e) => ({
          name: e.naam,
          sets: e.sets || "",
          note: e.note || "",
          // Separate from `note`: note is superset grouping ("Superset 1"/
          // "Superset 2") or empty for schema 2, while weight_hint carries
          // the "+gewicht" / "+gewicht piek" text — these used to be the
          // same overloaded `note` column, split into two columns so
          // grouping and hint display don't collide.
          weight_hint: e.weight_hint || "",
          // Prescribed rep count, backfilled from `sets` (e.g. "3x8") for
          // clean rep-based exercises only — null for HIIT/time/distance
          // rows, where a reps prefill wouldn't mean anything. Used only
          // to prefill the reps control; the logged reps value itself
          // lives on `weights.reps`, fetched separately. See
          // parsePrescribedReps for the "N-M" range case (week 41+).
          reps: parsePrescribedReps(e.reps),
          ...(e.optioneel ? { optional: true } : {}),
          ...(e.hiit_work != null ? { hiitInterval: { work: e.hiit_work, rest: e.hiit_rest } } : {}),
        });
        const barEx = dayExs.find(e => e.categorie === "barbell");
        return {
          ...base,
          barbell: barEx ? toEx(barEx) : { name: "", sets: "", note: "", weight_hint: "", reps: null },
          spiergroep: dayExs.filter(e => e.categorie === "spiergroep").map(toEx),
          kettlebell: dayExs.filter(e => e.categorie === "kettlebell").map(toEx),
          core: dayExs.filter(e => e.categorie === "core").map(toEx),
          mobility: dayExs.filter(e => e.categorie === "mobility").map(toEx),
        };
      });
      allWeeks.push({ week: calWeek, jaar: s.jaar, yw: ywOf(s.jaar, calWeek), label: `Week ${calWeek}`, phase, schemaId: s.id, startWeek: s.start_week, eindWeek: s.eind_week, days });
    }
  }
  // (jaar, week) order across schemas and years; a schema lies within one
  // ISO year, so yw order is the calendar order.
  return allWeeks.sort((a, b) => a.yw - b.yw);
}

// Where the app opens: today's ISO week of today's ISO year (Amsterdam
// days, from the helper — on 1-3 Jan 2027 that is still 2026-W53). A gap
// week with no schema opens the nearest earlier week of the same year,
// else that year's first week. A year with no schema at all opens the
// latest year that has one, on its last week — viewYear then differs from
// the current ISO year, so it is shown read-only as archive.
function initialView(allWeeks, today = currentIsoWeek()) {
  const indexed = allWeeks.map((w, index) => ({ w, index }));
  const thisYear = indexed.filter(({ w }) => w.jaar === today.isoYear);
  if (thisYear.length === 0) {
    if (indexed.length === 0) return { index: 0, viewYear: today.isoYear };
    const latest = Math.max(...allWeeks.map(w => w.jaar));
    return { index: indexed.filter(({ w }) => w.jaar === latest).at(-1).index, viewYear: latest };
  }
  const exact = thisYear.find(({ w }) => w.week === today.isoWeek);
  const earlier = thisYear.filter(({ w }) => w.week < today.isoWeek);
  const pick = exact ?? earlier.at(-1) ?? thisYear[0];
  return { index: pick.index, viewYear: today.isoYear };
}

export default function FitnessSchema() {
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => {
    const saved = localStorage.getItem("selectedDay");
    if (saved !== null) { const n = Number(saved); if (n >= 0 && n <= 6) return n; }
    return currentIsoWeek().weekday - 1; // Mon=0, Sun=6 (Amsterdam)
  });
  // The ISO year whose weeks the selector shows. Set at mount by
  // initialView (the current ISO year, or the latest year with schemas when
  // the current one has none) and by the year sheet. Never persisted: the
  // app always reopens in the current ISO year. Any other year is the
  // read-only archive.
  const [viewYear, setViewYear] = useState(() => currentIsoWeek().isoYear);
  const [yearSheetOpen, setYearSheetOpen] = useState(false);
  const [schemaGen, setSchemaGen] = useState(0);
  const [weights, setWeights] = useState({});
  const [savedIndicators, setSavedIndicators] = useState({});
  const saveTimers = useRef({});
  const [activeTimer, setActiveTimer] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [timerLocked, setTimerLocked] = useState(false);
  const bbTimerRef = useRef(null);
  const bbLongPressed = useRef(false);
  const bbStartPos = useRef({ x: 0, y: 0 });
  const weekButtonRefs = useRef([]);

  const onTimerStop = () => {
    setActiveTimer(null);
    setActiveSection(null);
    setTimerLocked(false);
  };

  const { timeLeft, running, start, pause, reset, restart } = useTimer(120, { onComplete: () => {}, onStop: onTimerStop });
  const [expandedExercise, setExpandedExercise] = useState(null);
  const [completedDays, setCompletedDays] = useState(new Set());
  const [completedExercises, setCompletedExercises] = useState(new Set());
  const [swaps, setSwaps] = useState({});
  const [swapModal, setSwapModal] = useState(null);
  const [dayScores, setDayScores] = useState({});
  const [scorePrompt, setScorePrompt] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [progressieOpen, setProgressieOpen] = useState(false);
  const [progressieExercise, setProgressieExercise] = useState(null);
  const [schema, setSchema] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [schemaOffline, setSchemaOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullY, setPullY] = useState(0);
  const pullStartY = useRef(null);
  const rawPullDist = useRef(0);

  const fetchSchemaData = async () => {
    const [{ data: schemas }, { data: schemaDays }, exercises, { data: weekOverrides }, { data: restDayGoals }, { data: schemaWeeks }] = await Promise.all([
      supabase.from("schemas").select("*").order("jaar").order("start_week"),
      supabase.from("schema_days").select("*"),
      fetchAllRows("exercises", ["volgorde", "id"]),
      supabase.from("week_overrides").select("*"),
      supabase.from("rest_day_goals").select("*"),
      supabase.from("schema_weeks").select("*"),
    ]);
    if (!schemas || !schemaDays || !exercises) throw new Error("empty");
    // schemaWeeks deliberately absent from the guard above: a missing or
    // empty schema_weeks must not brick the app — buildWeeks falls back to
    // the old rule per week when a row is absent.
    return {
      weeks: buildWeeks(schemas, schemaDays, exercises, weekOverrides || [], schemaWeeks || []),
      restDayGoals: restDayGoals || [],
    };
  };

  const fetchUserData = async () => {
    // Paged fetches resolve to the same { data } shape as a single request,
    // so one failing table still leaves the others' state untouched.
    const paged = (table, order) => fetchAllRows(table, order).then(data => ({ data }), error => ({ data: null, error }));
    const [wRes, cdRes, ceRes, swRes, dsRes] = await Promise.all([
      paged("weights", ["jaar", "week", "id"]),
      supabase.from("completed_days").select("*"),
      paged("completed_exercises", ["jaar", "week", "day", "exercise"]),
      supabase.from("exercise_swaps").select("*"),
      supabase.from("day_scores").select("*"),
    ]);
    if (wRes.data) {
      const map = {};
      for (const row of wRes.data) {
        const k = wKey(row.exercise, ywOf(row.jaar, row.week));
        if (!map[k]) map[k] = { M: "", Z: "" };
        map[k][row.person] = row.weight ?? "";
        map[k][`reps${row.person}`] = row.reps ?? "";
        // A week property, so M and Z rows agree. No field = not deload.
        map[k].deload ||= row.deload === true;
      }
      setWeights(map);
    }
    if (cdRes.data) setCompletedDays(new Set(cdRes.data.map(r => dKey(ywOf(r.jaar, r.week), r.day))));
    if (ceRes.data) setCompletedExercises(new Set(ceRes.data.map(r => eKey(r.exercise, ywOf(r.jaar, r.week), r.day))));
    if (swRes.data) {
      const map = {};
      for (const row of swRes.data) map[sKey(row.original_exercise, ywOf(row.jaar, row.week), row.day)] = row.new_exercise;
      setSwaps(map);
    }
    if (dsRes.data) {
      const map = {};
      for (const row of dsRes.data) map[row.datum] = { training: row.score_training, motivatie: row.score_motivatie };
      setDayScores(map);
    }
  };

  const refreshAll = async () => {
    try {
      const { weeks: allWeeks, restDayGoals } = await fetchSchemaData();
      localStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify({ weeks: allWeeks, restDayGoals }));
      setSchema({ weeks: allWeeks, restDayGoals });
      setSchemaGen(g => g + 1);
      setSchemaOffline(false);
    } catch {
      setSchemaOffline(true);
    }
    try { await fetchUserData(); } catch {}
  };

  useEffect(() => {
    // v2 -> v3: v2's cached JSON predates the exercises.weight_hint column,
    // so a stale v2 cache would keep serving schema data with no hints even
    // after the fresh fetch below lands. Removing it (rather than just
    // moving on to a new key) also stops it lingering in localStorage
    // forever for users who never hit a cache-miss code path again.
    try { localStorage.removeItem("cached_schema_v2"); } catch {}
    // v3 -> v4: v3's cached JSON still carries "Cardio Fitness" naam/emoji/
    // type from before the Power Hour rename + Boksen addition — same
    // stale-cache reasoning as the v2 cleanup above.
    try { localStorage.removeItem("cached_schema_v3"); } catch {}
    // v4 -> v5: v4's cached JSON carries `phase` from the old hardcoded
    // relWeek rule (deload week baked in as "Opbouw"); phase now comes from
    // the schema_weeks table — same stale-cache reasoning.
    try { localStorage.removeItem("cached_schema_v4"); } catch {}
    // v5 -> v6: v5's cached JSON has no `mobility` field on training-day
    // objects — same stale-cache reasoning as every bump above.
    try { localStorage.removeItem("cached_schema_v5"); } catch { /* localStorage unavailable */ }
    // v6 -> v7: v6's cached weeks have no `jaar`/`yw` — same stale-cache
    // reasoning as every bump above.
    try { localStorage.removeItem("cached_schema_v6"); } catch { /* localStorage unavailable */ }

    let hasCache = false;
    // True when the cache opened the "no schema this ISO year" archive
    // fallback: the fresh fetch may carry the new year's schema, so the
    // view is chosen again then.
    let cacheFellBack = false;
    try {
      const raw = localStorage.getItem(SCHEMA_CACHE_KEY);
      if (raw) {
        const { weeks, restDayGoals } = JSON.parse(raw);
        if (weeks?.length) {
          setSchema({ weeks, restDayGoals: restDayGoals || [] });
          const view = initialView(weeks);
          setSelectedWeek(view.index);
          setViewYear(view.viewYear);
          cacheFellBack = view.viewYear !== currentIsoWeek().isoYear;
          setSchemaLoading(false);
          hasCache = true;
        }
      }
    } catch {}

    fetchSchemaData()
      .then(({ weeks: allWeeks, restDayGoals }) => {
        localStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify({ weeks: allWeeks, restDayGoals }));
        setSchema({ weeks: allWeeks, restDayGoals });
        if (!hasCache || cacheFellBack) {
          const view = initialView(allWeeks);
          setSelectedWeek(view.index);
          setViewYear(view.viewYear);
        }
        setSchemaOffline(false);
        setSchemaLoading(false);
      })
      .catch(() => {
        if (!hasCache) setSchemaLoading(false);
        else setSchemaOffline(true);
      });

    fetchUserData().catch(() => {});
  }, []);

  useEffect(() => {
    weekButtonRefs.current[selectedWeek]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedWeek]);

  const handlePullStart = (e) => {
    if (window.scrollY === 0 && !refreshing && e.touches?.length) {
      pullStartY.current = e.touches[0].clientY;
      rawPullDist.current = 0;
    }
  };

  const handlePullMove = (e) => {
    if (pullStartY.current === null) return;
    const dy = e.touches[0].clientY - pullStartY.current;
    if (dy <= 0) { pullStartY.current = null; setPullY(0); return; }
    rawPullDist.current = dy;
    setPullY(dy);
  };

  const handlePullEnd = async () => {
    if (pullStartY.current === null) return;
    const dist = rawPullDist.current;
    pullStartY.current = null;
    rawPullDist.current = 0;
    setPullY(0);
    if (dist < 260) return;
    setRefreshing(true);
    // If a new SW is waiting (new Vercel deployment), activate it then reload to get fresh JS.
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
          reg.update(); // non-blocking; if new SW installs + skipWaiting fires, controllerchange → reload
        }
      } catch (_) {}
    }
    await refreshAll();
    setRefreshing(false);
  };

  useEffect(() => { localStorage.setItem("selectedDay", selectedDay); }, [selectedDay]);

  if (schemaLoading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f7f4", fontFamily: "sans-serif", color: "#888", fontSize: 16 }}>
      Schema laden…
    </div>
  );

  const today = currentIsoWeek();
  // Viewing any year other than today's ISO year (on 1-3 Jan 2027 that is
  // still 2026) is the archive: grey header, every write path a no-op.
  const readOnly = viewYear !== today.isoYear;
  const brandColor = readOnly ? "#64748b" : "#f37121";
  const todayDayIdx = today.weekday - 1;
  const week = schema.weeks[selectedWeek];
  const schemaYears = [...new Set(schema.weeks.map(w => w.jaar))].sort((a, b) => b - a);
  const currentYearHasSchema = schemaYears.includes(today.isoYear);
  // Switches the selector to another year: today's week (or initialView's
  // fallback) for the current year, the year's last week for an archive year.
  const switchYear = (jaar) => {
    closeAndSave();
    setSummaryOpen(false);
    setYearSheetOpen(false);
    const idx = jaar === today.isoYear
      ? initialView(schema.weeks, today).index
      : schema.weeks.findLastIndex(w => w.jaar === jaar);
    if (idx >= 0) setSelectedWeek(idx);
    setViewYear(jaar);
  };
  const day = week.days[selectedDay] ?? week.days.find(d => d.type === "training") ?? week.days[0];
  const colors = day.dag_nummer
    ? {
        ...dayColors[day.dag_nummer],
        accent: day.kleur || dayColors[day.dag_nummer].accent,
        light:  dayColors[day.dag_nummer].light,
      }
    : { bg: "#f1f5f9", accent: "#94a3b8", light: "#e2e8f0" };
  const phase = phaseColors[week.phase] || phaseColorFallback;

  // Swap alternatives for core exercises — derived from every core exercise
  // programmed across the schemas (same flatMap the Progressie chart uses),
  // not a hand-curated list like KB_EXERCISES. Core has no single-equipment
  // constraint: anything ever programmed is doable at the gym, so there is
  // nothing to curate out. Zero-maintenance: a new block's core exercises
  // join the swap options automatically.
  const CORE_EXERCISES = [...new Set(
    (schema.weeks || []).flatMap(w => w.days.filter(d => d.type === "training").flatMap(d => d.core.map(e => e.name)))
  )].sort();

  // Prescribed reps per (exercise, week), parsed from `exercises.sets` at
  // backfill time and carried through toEx() as `reps` — null wherever
  // `sets` isn't a clean rep count (HIIT/time/distance). Keyed the same
  // way as `weights` so a lookup is a single wKey() away. Plain const, not
  // memoized — recomputed every render same as CORE_EXERCISES above; this
  // is after the schemaLoading early return, so a hook here would run
  // conditionally.
  const personalRecords = buildPersonalRecords(weights);
  const prescribedReps = {};
  for (const w of schema.weeks) {
    for (const d of w.days) {
      if (d.type !== "training") continue;
      for (const ex of [d.barbell, ...d.spiergroep, ...d.kettlebell, ...d.core]) {
        if (ex?.name && ex.reps != null) prescribedReps[wKey(ex.name, w.yw)] = ex.reps;
      }
    }
  }

  // The reps value a save (or the panel's own display) should use: what
  // was actually logged this week, falling back to the schema's
  // prescribed number when nothing has been touched yet. This is what
  // makes "hit exactly what's prescribed" require no extra action — the
  // prefill rides along into the save the moment a weight is entered,
  // even if the reps control itself was never tapped. Once ± is tapped
  // once, `weights[k].reps<person>` becomes a real value and this stops
  // falling back, the same "touched vs untouched" signal weight already
  // uses.
  const effectiveReps = (exercise, yw, person) => {
    const val = weights[wKey(exercise, yw)]?.[`reps${person}`];
    if (val !== "" && val != null) return val;
    const prescribed = prescribedReps[wKey(exercise, yw)];
    return prescribed != null ? prescribed : "";
  };

  // An empty weight means "clear this measurement" — deletes the row
  // outright, rather than the old silent no-op (which only ever cleared
  // local state, never the database; see CLAUDE.md "Reps logging" for the
  // history). No saved-indicator flash for a delete: that checkmark means
  // "your number was saved," and there's no number to confirm here.
  //
  // Every write in this file sends `jaar` explicitly (the column has no
  // DEFAULT), and every upsert's onConflict names the jaar-including unique
  // constraint exactly — PostgREST needs that match. Every write is also a
  // no-op in the read-only archive (readOnly).
  const saveMeasurement = (exercise, yw, person, weightValue, repsValue) => {
    if (readOnly) return;
    const { jaar, week: weekNr } = splitYw(yw);
    if (weightValue === "" || weightValue === null || weightValue === undefined) {
      supabase.from("weights")
        .delete()
        .eq("exercise", exercise)
        .eq("jaar", jaar)
        .eq("week", weekNr)
        .eq("person", person)
        .then(({ error }) => { if (error) console.error("[saveMeasurement delete error]", error); });
      return;
    }
    const reps = (repsValue === "" || repsValue === null || repsValue === undefined) ? null : Number(repsValue);
    supabase.from("weights").upsert(
      { exercise, jaar, week: weekNr, person, weight: Number(weightValue), reps, deload: isDeloadWeek(yw, schema.weeks) },
      { onConflict: "exercise,jaar,week,person" }
    ).then(({ error }) => {
      if (error) { console.error("[saveMeasurement error]", error); return; }
      const indicatorKey = `${exercise}__${yw}__${person}`;
      setSavedIndicators((prev) => ({ ...prev, [indicatorKey]: true }));
      setTimeout(() => setSavedIndicators((prev) => {
        const next = { ...prev }; delete next[indicatorKey]; return next;
      }), 1500);
    });
  };

  // Only acts on a person whose debounce timer is still pending (not yet
  // fired) — i.e. an edit actually happened since the last save and hasn't
  // reached the database yet. Without this gate, every close of a panel
  // that was merely viewed (never edited) would re-send its already-saved
  // value, and — once empty weight meant delete — would fire a needless
  // delete for every exercise that simply happens to be unlogged. The
  // timer's presence is the one signal that distinguishes "just edited"
  // from "already matches the database, nothing to do."
  const flushSave = (exerciseName, yw) => {
    const k = wKey(exerciseName, yw);
    const w = weights[k] || {};
    const pending = {};
    ["M", "Z"].forEach((person) => {
      const timerKey = `${exerciseName}__${yw}__${person}`;
      if (saveTimers.current[timerKey]) {
        pending[person] = true;
        clearTimeout(saveTimers.current[timerKey]);
        delete saveTimers.current[timerKey];
      }
    });
    if (!pending.M && !pending.Z) return;
    const stateUpdate = {};
    ["M", "Z"].forEach((person) => {
      if (!pending[person]) return;
      const value = person === "M" ? w.M : w.Z;
      const isClearing = value === "" || value === null || value === undefined;
      // Clearing deletes the whole row, so its reps go with it — falling
      // back to effectiveReps here (as the save path does) would leave a
      // stale reps number mirrored for a row that no longer exists.
      const reps = isClearing ? "" : effectiveReps(exerciseName, yw, person);
      stateUpdate[`reps${person}`] = reps;
      saveMeasurement(exerciseName, yw, person, value, reps);
    });
    setWeights((prev) => ({
      ...prev,
      [k]: { ...(prev[k] || { M: "", Z: "" }), ...stateUpdate },
    }));
  };

  const handleExerciseClick = (name) => {
    const yw = week.yw;
    if (expandedExercise && expandedExercise !== name) {
      flushSave(expandedExercise, yw);
    }
    setExpandedExercise((prev) => (prev === name ? null : name));
  };

  const handleWeightChange = (exercise, yw, person, value) => {
    if (readOnly) return;
    const k = wKey(exercise, yw);
    const isClearing = value === "" || value === null || value === undefined;
    // Computed once, used for both the local mirror and the save below, so
    // the two can never disagree — this is what was missing: the save used
    // to include the effective (possibly prefilled) reps value while the
    // local state update didn't, leaving weights[k].reps<person> stale
    // until the next full refetch. Clearing is its own case: the row is
    // about to be deleted entirely, so reps resets to empty rather than
    // falling back to the prescribed number — there is no row left for
    // that number to describe.
    const reps = isClearing ? "" : effectiveReps(exercise, yw, person);
    // Mirrors the deload flag saveMeasurement sends, so findPrevWeight
    // (which reads this state) skips a deload row without a restart.
    setWeights((prev) => ({
      ...prev,
      [k]: { ...(prev[k] || { M: "", Z: "" }), [person]: value, [`reps${person}`]: reps, deload: isDeloadWeek(yw, schema.weeks) },
    }));
    const timerKey = `${exercise}__${yw}__${person}`;
    clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = setTimeout(() => {
      delete saveTimers.current[timerKey];
      saveMeasurement(exercise, yw, person, value, reps);
    }, 500);
  };

  // Reps-only edit (± buttons). Gated on weight already being present —
  // same rule as weight itself: no weight yet means nothing to save, the
  // tap just updates the local display. Once a weight exists, this reuses
  // the same debounce timer key as handleWeightChange, so whichever call
  // (weight or reps) fires last wins — correct, since it always captures
  // the freshest value of both at the moment it's scheduled.
  const handleRepsChange = (exercise, yw, person, value) => {
    if (readOnly) return;
    const k = wKey(exercise, yw);
    const field = `reps${person}`;
    setWeights((prev) => ({
      ...prev,
      [k]: { ...(prev[k] || { M: "", Z: "" }), [field]: value },
    }));
    const weightValue = weights[k]?.[person];
    if (weightValue === "" || weightValue == null) return;
    const timerKey = `${exercise}__${yw}__${person}`;
    clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = setTimeout(() => {
      delete saveTimers.current[timerKey];
      saveMeasurement(exercise, yw, person, weightValue, value);
    }, 500);
  };

  const closeAndSave = () => {
    if (expandedExercise) {
      flushSave(expandedExercise, week.yw);
      setExpandedExercise(null);
    }
  };

  const saveSwap = (original, newExercise, yw, dayId) => {
    if (readOnly) return;
    const k = sKey(original, yw, dayId);
    const { jaar, week: weekNr } = splitYw(yw);
    setSwaps((prev) => ({ ...prev, [k]: newExercise }));
    supabase.from("exercise_swaps").upsert(
      { original_exercise: original, new_exercise: newExercise, jaar, week: weekNr, day: dayId },
      { onConflict: "original_exercise,jaar,week,day" }
    ).then(({ error }) => { if (error) console.error("[saveSwap error]", error); });
    setSwapModal(null);
  };

  const revertSwap = (original, yw, dayId) => {
    if (readOnly) return;
    const k = sKey(original, yw, dayId);
    const { jaar, week: weekNr } = splitYw(yw);
    setSwaps((prev) => { const next = { ...prev }; delete next[k]; return next; });
    supabase.from("exercise_swaps")
      .delete()
      .eq("original_exercise", original)
      .eq("jaar", jaar)
      .eq("week", weekNr)
      .eq("day", dayId)
      .then(({ error }) => { if (error) console.error("[revertSwap error]", error); });
  };

  const saveScore = (datum, training, motivatie) => {
    if (readOnly) return;
    setDayScores((prev) => ({ ...prev, [datum]: { training, motivatie } }));
    supabase.from("day_scores").upsert(
      { datum, score_training: training, score_motivatie: motivatie },
      { onConflict: "datum" }
    ).then(({ error }) => { if (error) console.error("[saveScore error]", error); });
    setScorePrompt(null);
  };

  const handleTimerClick = (key, label, icon, seconds, accent) => {
    if (activeTimer === key) {
      setActiveTimer(null);
      setActiveSection(null);
      setTimerLocked(false);
      NativeTimer.stop().catch(console.error);
    } else {
      BatteryOptimization.checkAndRequest().then((res) => {
        console.log("[Battery] isIgnoring:", res.isIgnoring, "prompted:", res.prompted, "error:", res.error);
      }).catch((err) => {
        console.log("[Battery] plugin not available:", err);
      });
      const section = { key, label, icon, seconds, accent };
      setActiveTimer(key);
      setActiveSection(section);
      setTimerLocked(true);
      start(seconds, label);
    }
  };

  const bbStartPress = (e) => {
    bbLongPressed.current = false;
    if (readOnly) return;
    const t = e.touches?.[0];
    if (t) bbStartPos.current = { x: t.clientX, y: t.clientY };
    bbTimerRef.current = setTimeout(() => {
      bbLongPressed.current = true;
      triggerImpact();
      toggleExerciseCompletion(day.barbell.name, week.yw, day.dag_nummer);
    }, 1000);
  };
  const bbCancelPress = () => clearTimeout(bbTimerRef.current);
  const bbHandleTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - bbStartPos.current.x) > 10 || Math.abs(t.clientY - bbStartPos.current.y) > 10) bbCancelPress();
  };

  const toggleDayCompletion = (yw, dayId) => {
    if (readOnly) return;
    const k = dKey(yw, dayId);
    const { jaar, week: weekNr } = splitYw(yw);
    if (completedDays.has(k)) {
      setCompletedDays((prev) => { const s = new Set(prev); s.delete(k); return s; });
      supabase.from("completed_days").delete().eq("jaar", jaar).eq("week", weekNr).eq("day", dayId).then();
    } else {
      setCompletedDays((prev) => new Set([...prev, k]));
      supabase.from("completed_days").insert({ jaar, week: weekNr, day: dayId }).then();
    }
  };

  const toggleExerciseCompletion = (exercise, yw, dayId) => {
    if (readOnly) return;
    const k = eKey(exercise, yw, dayId);
    const { jaar, week: weekNr } = splitYw(yw);
    if (completedExercises.has(k)) {
      setCompletedExercises((prev) => { const s = new Set(prev); s.delete(k); return s; });
      supabase.from("completed_exercises").delete().eq("exercise", exercise).eq("jaar", jaar).eq("week", weekNr).eq("day", dayId).then();
    } else {
      setCompletedExercises((prev) => new Set([...prev, k]));
      supabase.from("completed_exercises").insert({ exercise, jaar, week: weekNr, day: dayId }).then();
    }
  };

  return (
    <div
      onTouchStart={handlePullStart}
      onTouchMove={handlePullMove}
      onTouchEnd={handlePullEnd}
      style={{ fontFamily: "'Georgia', serif", minHeight: "100vh", background: "#f8f7f4", color: "#1a1a1a", userSelect: "none", WebkitUserSelect: "none", paddingBottom: activeTimer ? 100 : 0, overscrollBehaviorY: "contain" }}
    >
      {/* Pull-to-refresh indicator */}
      {(() => {
        const SHOW_AT = 150;
        const TRIGGER = 260;
        const r = 15;
        const circ = 2 * Math.PI * r;
        const progress = Math.max(0, Math.min(1, (pullY - SHOW_AT) / (TRIGGER - SHOW_AT)));
        const show = pullY >= SHOW_AT || refreshing;
        if (!show) return null;
        const arcLen = refreshing ? circ * 0.75 : progress * circ;
        return (
          <>
            <style>{`@keyframes ptr-spin { to { transform: rotate(360deg) } }`}</style>
            <div style={{ position: "fixed", top: 10, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 300, pointerEvents: "none" }}>
              <svg
                width="44" height="44" viewBox="0 0 44 44"
                style={{
                  filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.15))",
                  animation: refreshing ? "ptr-spin 0.8s linear infinite" : "none",
                  transformOrigin: "22px 22px",
                }}
              >
                <circle cx="22" cy="22" r="21" fill="white" />
                <circle cx="22" cy="22" r={r} fill="none" stroke="#e5e7eb" strokeWidth="3" />
                <circle
                  cx="22" cy="22" r={r}
                  fill="none" stroke="#f37121" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={`${arcLen} ${circ}`}
                  transform="rotate(-90 22 22)"
                />
              </svg>
            </div>
          </>
        );
      })()}

      {/* Header — orange for the current ISO year, grey for the read-only
          archive. The eyebrow opens the year sheet. */}
      <div style={{ background: brandColor, color: "#fff", padding: "14px 20px 20px", textAlign: "center", transition: "background 0.2s" }}>
        {week.startWeek != null && week.eindWeek != null && (
          <button
            onClick={() => setYearSheetOpen(true)}
            aria-label="Kies jaar"
            style={{ background: "none", border: "none", padding: "3px 6px 1px", margin: "0 0 4px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, lineHeight: "17px", letterSpacing: 4, textTransform: "uppercase", color: "rgba(255,255,255,0.75)" }}
          >
            {readOnly ? `Archief ${week.jaar}` : week.jaar} · Week {week.startWeek} – {week.eindWeek}
            {/* Chevron as an SVG one cap-height tall sitting on the
                baseline, so its centre is the capitals' centre line in
                whatever font the phone renders (a "⌄" glyph sits at the
                bottom of its own box and rode low). The attributes are the
                fallback where the `cap` unit is unsupported. */}
            <svg aria-hidden="true" viewBox="0 0 10 10" width="0.7em" height="0.7em" style={{ width: "1cap", height: "1cap", marginLeft: 6, verticalAlign: "baseline", overflow: "visible" }}>
              <path d="M1.5 3.25 L5 6.75 L8.5 3.25" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>
          {week.startWeek != null && week.eindWeek != null ? `Week ${week.week - week.startWeek + 1} van ${week.eindWeek - week.startWeek + 1}` : "Trainingsschema"}
        </h1>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <span style={{ background: phase.bg, color: phase.text, fontSize: 14, fontWeight: 700, letterSpacing: 0.3, padding: "5px 16px", borderRadius: 20, fontFamily: "sans-serif" }}>
            {week.phase}
          </span>
        </div>
        {readOnly && (
          currentYearHasSchema ? (
            <button
              onClick={() => switchYear(today.isoYear)}
              style={{ marginTop: 12, background: "rgba(255,255,255,0.2)", color: "#fff", border: "none", borderRadius: 20, padding: "6px 16px", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", cursor: "pointer" }}
            >
              Naar {today.isoYear} →
            </button>
          ) : (
            <div style={{ marginTop: 12, fontSize: 13, fontFamily: "sans-serif", color: "rgba(255,255,255,0.85)" }}>
              Nog geen schema voor {today.isoYear}
            </div>
          )
        )}
      </div>

      {/* Offline indicator */}
      {schemaOffline && (
        <div style={{ background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", padding: "6px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "sans-serif", fontSize: 12, color: "#64748b" }}>
          <span>📵</span>
          <span>Offline — schema uit cache</span>
        </div>
      )}

      {/* Week selector */}
      <div style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "14px 16px", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", minWidth: "fit-content", margin: "0 auto" }}>
          {schema.weeks.map((w, i) => w.jaar === viewYear && (
            <button
              key={i}
              ref={el => weekButtonRefs.current[i] = el}
              onClick={() => { closeAndSave(); setSummaryOpen(false); setSelectedWeek(i); }}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontFamily: "sans-serif",
                fontSize: 13,
                fontWeight: selectedWeek === i ? 700 : 400,
                background: selectedWeek === i ? brandColor : "#f0f0f0",
                color: selectedWeek === i ? "#fff" : "#555",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Day selector */}
      <div style={{ padding: "12px 12px 0", display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5, maxWidth: 600, margin: "0 auto" }}>
        {week.days.map((d, i) => (
          <WeekDayTile
            key={`${schemaGen}-${i}`}
            day={d}
            isSelected={selectedDay === i}
            isToday={!readOnly && todayDayIdx === i}
            isCompleted={
              d.type === "training"
                ? (d.dag_nummer != null && completedDays.has(dKey(week.yw, d.dag_nummer)))
                : (d.type === "power_hour" || d.type === "boksen") && Boolean(dayScores[dateForDay(week, d.dag_volgorde)])
            }
            onSelect={() => { closeAndSave(); setSummaryOpen(false); setSelectedDay(i); }}
            onOpenSummary={selectedDay === i && d === day && dayHasSummary(d, week, { dayScores, completedDays, weights, swaps }) ? () => setSummaryOpen(true) : undefined}
            onLongPress={readOnly ? undefined : () => {
              const datum = dateForDay(week, d.dag_volgorde);
              if (d.type === "training" && d.dag_nummer != null) {
                const willComplete = !completedDays.has(dKey(week.yw, d.dag_nummer));
                toggleDayCompletion(week.yw, d.dag_nummer);
                if (willComplete) setScorePrompt({ datum, dayLabel: d.naam });
              } else if (d.type === "power_hour" || d.type === "boksen") {
                setScorePrompt({ datum, dayLabel: d.naam });
              }
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "16px", maxWidth: 600, margin: "0 auto" }}>

        {day.type === "rust" && (() => {
          // Priority: week-specific row (week_nummer = calWeek) > catch-all (week_nummer = 0)
          const restGoals = (type) => {
            const all = (schema.restDayGoals || []).filter(g => g.dag_van_week === type && g.schema_id === week.schemaId);
            const specific = all.filter(g => g.week_nummer === week.week);
            return specific.length > 0 ? specific : all.filter(g => g.week_nummer === 0);
          };
          return day.naam === "Anti-zit"
            ? <StretchenCard goals={restGoals("stretchen")} day={day} />
            : <VrijeDagCard goals={restGoals("vrije_dag")} day={day} />;
        })()}

        {(day.type === "power_hour" || day.type === "boksen") && (() => {
          const datum = dateForDay(week, day.dag_volgorde);
          const onOpenPrompt = readOnly ? undefined : () => setScorePrompt({ datum, dayLabel: day.naam });
          return day.type === "power_hour"
            ? <PowerHourCard day={day} score={dayScores[datum]} onOpenPrompt={onOpenPrompt} />
            : <BoksenCard day={day} score={dayScores[datum]} onOpenPrompt={onOpenPrompt} />;
        })()}

        {day.type === "training" && (<>

        {/* Mobility — warm-up done right after the bike, before the first
            real exercise. Rendered before the schema-branch ternary below so
            it sits above BOTH schema 2's Supersets and schema 1's Barbell
            Hoofdoefening, without touching either branch. Bare ExRow, no
            SwipeableRow (no swap for mobility) and no onToggle/weight props
            (no weight panel, no reps stepper, no "Laatste keer" line) —
            same minimal shape as a core row, just without the swap wrapper. */}
        {day.mobility.length > 0 && (
          <Section
            title="Mobility"
            icon="🤸"
            accent="#0d9488"
            timerSeconds={60}
            timerActive={activeTimer === "mobility"}
            onTimerClick={() => handleTimerClick("mobility", "Mobility", "🤸", 60, "#0d9488")}
          >
            {day.mobility.map((ex, i) => (
              <ExRow
                key={i}
                num={i + 1}
                name={ex.name}
                sets={ex.sets}
                note={ex.note}
                accent="#0d9488"
                light="#ccfbf1"
                completed={completedExercises.has(eKey(ex.name, week.yw, day.dag_nummer))}
                onLongPress={readOnly ? undefined : () => toggleExerciseCompletion(ex.name, week.yw, day.dag_nummer)}
              />
            ))}
          </Section>
        )}

        {/* Barbell */}
        {usesSupersetLayout(week) ? (() => {
          const superset1 = [
            { ...day.barbell, categorie: "barbell" },
            ...day.spiergroep.filter(ex => ex.note === "Superset 1"),
          ];
          const superset2 = day.spiergroep.filter(ex => ex.note === "Superset 2");
          const los = day.spiergroep.filter(ex => !ex.note || (ex.note !== "Superset 1" && ex.note !== "Superset 2"));
          const ssProps = {
            expandedExercise,
            onToggle: handleExerciseClick,
            yw: week.yw,
            dayId: day.dag_nummer,
            weights,
            savedIndicators,
            completedExercises,
            onWeightChange: (name, wk, person, val) => handleWeightChange(name, wk, person, val),
            onRepsChange: (name, wk, person, val) => handleRepsChange(name, wk, person, val),
            getEffectiveReps: effectiveReps,
            personalRecords,
            toggleCompletion: readOnly ? undefined : toggleExerciseCompletion,
            readOnly,
            lightColor: colors.light,
          };
          return (
            <>
            <Section title="Supersets" icon="⚡" accent={colors.accent} timerSeconds={90} timerActive={activeTimer === "spiergroep"} onTimerClick={() => handleTimerClick("spiergroep", "Supersets", "⚡", 90, colors.accent)}>
              <SupersetBlock title="SUPERSET 1" exercises={superset1} accentColor={colors.accent} {...ssProps} />
              <SupersetBlock title="SUPERSET 2" exercises={superset2} accentColor={colors.accent} {...ssProps} />
            </Section>
            {los.length > 0 && (
              <Section title="Losse oefeningen" icon="🎯" accent={colors.accent} timerSeconds={90} timerActive={activeTimer === "losse"} onTimerClick={() => handleTimerClick("losse", "Losse oefeningen", "🎯", 90, colors.accent)}>
                {los.map((ex, i) => {
                  const k = wKey(ex.name, week.yw);
                  const w = weights[k] || { M: "", Z: "" };
                  const prevResult = findPrevWeight(ex.name, week.yw, weights);
                  const prevW = prevResult || { M: null, Z: null };
                  return (
                    <ExRow
                      key={i}
                      num={i + 1}
                      name={ex.name}
                      sets={ex.sets}
                      note={ex.weight_hint}
                      accent={colors.accent}
                      light={colors.light}
                      optional={ex.optional}
                      expanded={expandedExercise === ex.name}
                      onToggle={() => handleExerciseClick(ex.name)}
                      weightM={w.M}
                      weightZ={w.Z}
                      onWeightChange={(person, value) => handleWeightChange(ex.name, week.yw, person, value)}
                      readOnly={readOnly}
                      repsM={effectiveReps(ex.name, week.yw, "M")}
                      repsZ={effectiveReps(ex.name, week.yw, "Z")}
                      onRepsChange={(person, value) => handleRepsChange(ex.name, week.yw, person, value)}
                      prevWeightM={prevW.M}
                      prevWeightZ={prevW.Z}
                      prevRepsM={prevW.repsM}
                      prevRepsZ={prevW.repsZ}
                      prevWeekLabel={prevResult?.label}
                      pr={personalRecords[ex.name]}
                      savedM={!!savedIndicators[`${ex.name}__${week.yw}__M`]}
                      savedZ={!!savedIndicators[`${ex.name}__${week.yw}__Z`]}
                      completed={completedExercises.has(eKey(ex.name, week.yw, day.dag_nummer))}
                      onLongPress={readOnly ? undefined : () => toggleExerciseCompletion(ex.name, week.yw, day.dag_nummer)}
                    />
                  );
                })}
              </Section>
            )}
            </>
          );
        })() : (
          <>
            <Section
              title="Barbell Hoofdoefening"
              icon="🏋️"
              accent="#f37121"
              timerSeconds={120}
              timerActive={activeTimer === "barbell"}
              onTimerClick={() => handleTimerClick("barbell", "Barbell Hoofdoefening", "🏋️", 120, "#f37121")}
            >
          {(() => {
            const k = wKey(day.barbell.name, week.yw);
            const w = weights[k] || { M: "", Z: "" };
            const prevResult = findPrevWeight(day.barbell.name, week.yw, weights);
            const prevW = prevResult || { M: null, Z: null };
            const hasPrev = prevW.M !== "" && prevW.M != null || prevW.Z !== "" && prevW.Z != null;
            const barbellCompleted = completedExercises.has(eKey(day.barbell.name, week.yw, day.dag_nummer));
            return (
              <div style={{ borderRadius: 10, overflow: "hidden" }}>
                <div
                  style={{ background: "#f37121", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={(e) => { if (bbLongPressed.current) { bbLongPressed.current = false; e.stopPropagation(); return; } handleExerciseClick(day.barbell.name); }}
                  onMouseDown={bbStartPress} onMouseUp={bbCancelPress}
                  onTouchStart={bbStartPress} onTouchEnd={bbCancelPress} onTouchMove={bbHandleTouchMove}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ visibility: barbellCompleted ? "visible" : "hidden", width: 24, height: 24, borderRadius: "50%", background: "#16a34a", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 700, flexShrink: 0 }}>✓</span>
                    <div>
                      <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{day.barbell.name}</div>
                      {day.barbell.note && <HintBadges text={day.barbell.note} onDark textColor="#ffcfa0" />}
                    </div>
                  </div>
                  <div style={{ background: "#fff", color: "#f37121", padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap" }}>
                    {day.barbell.sets}
                  </div>
                </div>
                {expandedExercise === day.barbell.name && (
                  <div
                    style={{ background: "#fff8f5", borderTop: "1px solid #f0d0b8", padding: "10px 12px 10px 16px", display: "flex", flexDirection: "column", gap: 8 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                      {["M", "Z"].map((person) => {
                        const currentReps = effectiveReps(day.barbell.name, week.yw, person);
                        const currentRepsNum = currentReps === "" || currentReps == null ? null : Number(currentReps);
                        return (
                        <div key={person} style={{ display: person === "Z" ? "none" : "flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="number"
                            disabled={readOnly}
                            step="any"
                            min={0}
                            value={person === "M" ? w.M : w.Z}
                            onChange={(e) => handleWeightChange(day.barbell.name, week.yw, person, e.target.value)}
                            placeholder="kg"
                            style={{ width: 70, padding: "5px 8px", borderRadius: 6, border: "1px solid #e0c8b8", fontFamily: "sans-serif", fontSize: 13, outline: "none", background: "#fff" }}
                          />
                          <span style={{ display: "inline-flex", width: 14, justifyContent: "center", color: "#16a34a", fontSize: 14, fontWeight: 700, lineHeight: 1, visibility: savedIndicators[`${day.barbell.name}__${week.yw}__${person}`] ? "visible" : "hidden" }}>✓</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                            <button
                              type="button"
                              hidden={readOnly}
                              disabled={currentRepsNum == null}
                              onClick={() => handleRepsChange(day.barbell.name, week.yw, person, String(Math.max(1, currentRepsNum - 1)))}
                              style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: currentRepsNum == null ? "default" : "pointer", opacity: currentRepsNum == null ? 0.4 : 1 }}
                            >−</button>
                            <span style={{ minWidth: 18, textAlign: "center", fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#1a1a1a", userSelect: "none" }}>
                              {currentRepsNum ?? "–"}
                            </span>
                            <button
                              type="button"
                              hidden={readOnly}
                              onClick={() => handleRepsChange(day.barbell.name, week.yw, person, String(Math.min(50, (currentRepsNum ?? 0) + 1)))}
                              style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: "pointer" }}
                            >+</button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    {(hasPrev || personalRecords[day.barbell.name]) && (
                      <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#bbb" }}>
                        {hasPrev && <>{prevResult?.label} · <span style={{ color: "#1a1a1a" }}>{prevW.M !== "" && prevW.M != null ? `${prevW.M}kg${prevW.repsM !== "" && prevW.repsM != null ? ` × ${prevW.repsM}` : ''}` : "—"}</span><span style={{ display: "none" }}> / <span style={{ color: "#1a1a1a" }}>Z:</span> <span style={{ color: "#1a1a1a" }}>{prevW.Z !== "" && prevW.Z != null ? `${prevW.Z}kg${prevW.repsZ !== "" && prevW.repsZ != null ? ` × ${prevW.repsZ}` : ''}` : "—"}</span></span></>}<PrText pr={personalRecords[day.barbell.name]} currentWeight={w.M} standalone={!hasPrev} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </Section>

        {/* Spiergroep */}
        <Section
          title="Spiergroep Oefeningen"
          icon="🎯"
          accent={colors.accent}
          timerSeconds={90}
          timerActive={activeTimer === "spiergroep"}
          onTimerClick={() => handleTimerClick("spiergroep", "Spiergroep Oefeningen", "🎯", 90, colors.accent)}
        >
          {day.spiergroep.map((ex, i) => {
            const k = wKey(ex.name, week.yw);
            const w = weights[k] || { M: "", Z: "" };
            const prevResult = findPrevWeight(ex.name, week.yw, weights);
            const prevW = prevResult || { M: null, Z: null };
            return (
              <ExRow
                key={i}
                num={i + 1}
                name={ex.name}
                sets={ex.sets}
                note={ex.note}
                accent={colors.accent}
                light={colors.light}
                optional={ex.optional}
                expanded={expandedExercise === ex.name}
                onToggle={() => handleExerciseClick(ex.name)}
                weightM={w.M}
                weightZ={w.Z}
                onWeightChange={(person, value) => handleWeightChange(ex.name, week.yw, person, value)}
                readOnly={readOnly}
                repsM={effectiveReps(ex.name, week.yw, "M")}
                repsZ={effectiveReps(ex.name, week.yw, "Z")}
                onRepsChange={(person, value) => handleRepsChange(ex.name, week.yw, person, value)}
                prevWeightM={prevW.M}
                prevWeightZ={prevW.Z}
                prevRepsM={prevW.repsM}
                prevRepsZ={prevW.repsZ}
                prevWeekLabel={prevResult?.label}
                pr={personalRecords[ex.name]}
                savedM={!!savedIndicators[`${ex.name}__${week.yw}__M`]}
                savedZ={!!savedIndicators[`${ex.name}__${week.yw}__Z`]}
                completed={completedExercises.has(eKey(ex.name, week.yw, day.dag_nummer))}
                onLongPress={readOnly ? undefined : () => toggleExerciseCompletion(ex.name, week.yw, day.dag_nummer)}
              />
            );
          })}
        </Section>

          </>
        )}

                {/* Kettlebell */}
        <Section
          title="Kettlebell (Full Body)"
          icon="🔔"
          accent="#c05621"
          timerSeconds={60}
          timerActive={activeTimer === "kettlebell"}
          onTimerClick={() => handleTimerClick("kettlebell", "Kettlebell (Full Body)", "🔔", 60, "#c05621")}
        >
          {(() => {
            const hiitInterval = day.kettlebell[0]?.hiitInterval || null;
            return (
              <>
                {hiitInterval && (
                  <div style={{
                    margin: "0 0 8px",
                    background: "#fff8f3",
                    border: "1.5px solid #f37121",
                    borderRadius: 10,
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18 }}>⚡</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#f37121", fontFamily: "sans-serif" }}>HIIT Intervallen</div>
                        <div style={{ fontSize: 11, color: "#888", fontFamily: "sans-serif" }}>werk / rust per oefening</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#f37121", lineHeight: 1, fontFamily: "sans-serif" }}>{hiitInterval.work}s</div>
                        <div style={{ fontSize: 10, color: "#888", fontFamily: "sans-serif" }}>werk</div>
                      </div>
                      <div style={{ fontSize: 16, color: "#ccc" }}>/</div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#888", lineHeight: 1, fontFamily: "sans-serif" }}>{hiitInterval.rest}s</div>
                        <div style={{ fontSize: 10, color: "#888", fontFamily: "sans-serif" }}>rust</div>
                      </div>
                    </div>
                  </div>
                )}
                {day.kettlebell.map((ex, i) => {
                  const sk = sKey(ex.name, week.yw, day.dag_nummer);
                  const swappedName = swaps[sk];
                  const displayName = swappedName || ex.name;
                  const k = wKey(displayName, week.yw);
                  const w = weights[k] || { M: "", Z: "" };
                  const prevResult = findPrevWeight(displayName, week.yw, weights);
                  const prevW = prevResult || { M: null, Z: null };
                  return (
                    <SwipeableRow
                      key={i}
                      onSwipeRight={readOnly ? undefined : () => { closeAndSave(); setSwapModal({ original: ex.name, week: week.yw, day: day.dag_nummer, options: KB_EXERCISES }); }}
                      onSwipeLeft={swappedName && !readOnly ? () => revertSwap(ex.name, week.yw, day.dag_nummer) : undefined}
                    >
                      <ExRow
                        num={i + 1}
                        name={displayName}
                        sets={ex.sets}
                        note={ex.note}
                        accent="#c05621"
                        light="#fed7aa"
                        optional={ex.optional}
                        expanded={expandedExercise === displayName}
                        onToggle={() => handleExerciseClick(displayName)}
                        weightM={w.M}
                        weightZ={w.Z}
                        onWeightChange={(person, value) => handleWeightChange(displayName, week.yw, person, value)}
                        readOnly={readOnly}
                        repsM={effectiveReps(displayName, week.yw, "M")}
                        repsZ={effectiveReps(displayName, week.yw, "Z")}
                        onRepsChange={(person, value) => handleRepsChange(displayName, week.yw, person, value)}
                        prevWeightM={prevW.M}
                        prevWeightZ={prevW.Z}
                        prevRepsM={prevW.repsM}
                        prevRepsZ={prevW.repsZ}
                        prevWeekLabel={prevResult?.label}
                        pr={personalRecords[displayName]}
                        savedM={!!savedIndicators[`${displayName}__${week.yw}__M`]}
                        savedZ={!!savedIndicators[`${displayName}__${week.yw}__Z`]}
                        completed={completedExercises.has(eKey(displayName, week.yw, day.dag_nummer))}
                        onLongPress={readOnly ? undefined : () => toggleExerciseCompletion(displayName, week.yw, day.dag_nummer)}
                        swapped={!!swappedName}
                        originalName={swappedName ? ex.name : undefined}
                        hiitInterval={ex.hiitInterval || hiitInterval}
                      />
                    </SwipeableRow>
                  );
                })}
              </>
            );
          })()}
        </Section>

        {/* Core */}
        <Section
          title="Core Finisher"
          icon="🔥"
          accent="#7c3aed"
          timerSeconds={45}
          timerActive={activeTimer === "core"}
          onTimerClick={() => handleTimerClick("core", "Core Finisher", "🔥", 45, "#7c3aed")}
        >
          {day.core.map((ex, i) => {
            const sk = sKey(ex.name, week.yw, day.dag_nummer);
            const swappedName = swaps[sk];
            const displayName = swappedName || ex.name;
            return (
              <SwipeableRow
                key={i}
                onSwipeRight={readOnly ? undefined : () => { closeAndSave(); setSwapModal({ original: ex.name, week: week.yw, day: day.dag_nummer, options: CORE_EXERCISES }); }}
                onSwipeLeft={swappedName && !readOnly ? () => revertSwap(ex.name, week.yw, day.dag_nummer) : undefined}
              >
                <ExRow
                  num={i + 1}
                  name={displayName}
                  sets={ex.sets}
                  note={ex.note}
                  accent="#7c3aed"
                  light="#ede9fe"
                  optional={ex.optional}
                  completed={completedExercises.has(eKey(displayName, week.yw, day.dag_nummer))}
                  onLongPress={readOnly ? undefined : () => toggleExerciseCompletion(displayName, week.yw, day.dag_nummer)}
                  swapped={!!swappedName}
                  originalName={swappedName ? ex.name : undefined}
                />
              </SwipeableRow>
            );
          })}
        </Section>

        {/* Progress note */}
        {week.phase === "Opbouw" && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 14px", marginTop: 4, fontFamily: "sans-serif", fontSize: 13, color: "#166534" }}>
            <strong>📈 Progressie:</strong> Verhoog het gewicht elke week. Week 1 = basisgewicht, Week 2 = +5kg/zwaarder, Week 3 = piekgewicht.
          </div>
        )}
        {week.phase === "Nieuwe Prikkel" && (
          <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 10, padding: "12px 14px", marginTop: 4, fontFamily: "sans-serif", fontSize: 13, color: "#5b21b6" }}>
            {schema.weeks[selectedWeek + 1]?.phase === "Nieuwe Prikkel"
              ? <><strong>⚡ Nieuwe prikkel:</strong> Nieuwe oefeningen activeren andere spiervezels. Begin met een goed uitvoerbaar gewicht en bouw op volgende week.</>
              : <><strong>⚡ Nieuwe prikkel:</strong> Piekweek — ga voor maximaal gewicht op alle oefeningen.</>
            }
          </div>
        )}

        <div style={{ textAlign: "center", color: "#bbb", fontSize: 11, fontFamily: "sans-serif", marginTop: 20, marginBottom: 8 }}>
          Core dagelijks herhalen · Rust: 60–90 sec tussen sets
        </div>

        </>)}

        {/* Progressie */}
        {(() => {
          const trainingDays = day.type === "training" ? [day] : [];
          const dayExercises = trainingDays.length > 0 ? [
            day.barbell.name,
            ...day.spiergroep.map(e => e.name),
            ...day.kettlebell.map(e => e.name),
          ] : [];
          const uniq = (arr) => [...new Set(arr)].filter(Boolean).filter(e => !dayExercises.includes(e));
          const allBarbell = uniq(schema.weeks.flatMap(w => w.days.filter(d => d.type === "training").map(d => d.barbell.name)));
          const allSpiergroep = uniq(schema.weeks.flatMap(w => w.days.filter(d => d.type === "training").flatMap(d => d.spiergroep.map(e => e.name))));
          const allKettlebell = uniq(schema.weeks.flatMap(w => w.days.filter(d => d.type === "training").flatMap(d => d.kettlebell.map(e => e.name))));
          const allCore = uniq(schema.weeks.flatMap(w => w.days.filter(d => d.type === "training").flatMap(d => d.core.map(e => e.name))));
          const allExercises = [...dayExercises, ...allBarbell, ...allSpiergroep, ...allKettlebell, ...allCore];
          const selEx = progressieExercise ?? allExercises[0];
          // A week whose entry is a deload row is dropped entirely (no
          // x-tick, no null point), so neither line breaks at a deload week.
          // History crosses years: every schema week of every year, in
          // (jaar, week) order (schema.weeks is sorted by yw). Labels carry
          // the year ("W52 '26", "W1 '27") only when the weeks with data
          // span more than one year.
          const chartWeeks = schema.weeks.filter(w => isReferenceWeight(weights[wKey(selEx, w.yw)]));
          const loggedYears = new Set(chartWeeks.filter(w => weights[wKey(selEx, w.yw)]).map(w => w.jaar));
          const chartLabel = (w) => loggedYears.size > 1 ? `W${w.week} '${String(w.jaar).slice(-2)}` : `W${w.week}`;
          const chartData = chartWeeks.map(w => {
            const entry = weights[wKey(selEx, w.yw)];
            const mVal = entry?.M;
            const mWeight = mVal !== "" && mVal != null ? Number(mVal) : null;
            const mReps = usableReps(entry?.repsM);
            return {
              week: chartLabel(w),
              M: mWeight,
              repsM: mReps,
              M1RM: mWeight != null && mReps != null ? estimatedOneRepMax(mWeight, mReps) : null,
            };
          });
          const mVals = chartData.map(d => d.M).filter(v => v != null);
          const mMax = mVals.length ? Math.max(...mVals) : null;
          const mGain = mVals.length >= 2 ? mVals[mVals.length - 1] - mVals[0] : null;
          // Whether this exercise has ANY usable 1RM point at all — decides
          // whether the M1RM line (and its legend entry) renders below.
          // Without this, a kettlebell exercise (weight logged, reps never)
          // would still reserve a legend slot for a line that draws nothing.
          const hasM1RM = chartData.some(d => d.M1RM != null);
          return (
            <div style={{ marginTop: 12 }}>
              <div style={{
                background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px #0001", overflow: "hidden",
                border: progressieOpen ? "2px solid #f37121" : "2px solid transparent", transition: "border 0.2s",
              }}>
                <button
                  onClick={() => setProgressieOpen(o => !o)}
                  style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>📈</span>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "#1a1a1a" }}>Progressie</span>
                  </div>
                  <span style={{ fontSize: 18, color: "#f37121", transform: progressieOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s", display: "inline-block" }}>⌄</span>
                </button>
                {progressieOpen && (
                  <div style={{ padding: "0 16px 16px" }}>
                    <select
                      value={selEx}
                      onChange={e => setProgressieExercise(e.target.value)}
                      style={{
                        width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #f37121",
                        fontSize: 14, fontWeight: 600, color: "#1a1a1a", background: "#fff", marginBottom: 16,
                        cursor: "pointer", outline: "none", appearance: "none",
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23f37121' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", paddingRight: 36,
                      }}
                    >
                      {allExercises.map(ex => <option key={ex} value={ex}>{ex}</option>)}
                    </select>
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      <div style={{ flex: 1, background: "#fff8f3", border: "1px solid #f3712133", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>M — Max</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#f37121" }}>{mMax != null ? `${mMax} kg` : "—"}</div>
                        <div style={{ fontSize: 11, color: mGain > 0 ? "#16a34a" : "#64748b", fontWeight: 600 }}>{mGain != null ? (mGain > 0 ? `+${mGain} kg` : `${mGain} kg`) : "—"}</div>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#888" }} />
                        <YAxis tick={{ fontSize: 12, fill: "#888" }} unit=" kg" />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} formatter={v => <span style={{ color: "#555", fontWeight: 600 }}>{v}</span>} />
                        <Line type="monotone" dataKey="M" name="M" stroke="#f37121" strokeWidth={3} dot={{ fill: "#f37121", strokeWidth: 2, r: 5 }} activeDot={{ r: 7 }} connectNulls />
                        {hasM1RM && (
                          <Line type="monotone" dataKey="M1RM" name="M · 1RM" stroke="#0ea5e9" strokeWidth={2} dot={{ fill: "#0ea5e9", strokeWidth: 1, r: 3 }} activeDot={{ r: 5 }} />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {timerLocked && <div style={{ position: "fixed", inset: 0, zIndex: 49 }} />}

      {activeTimer && activeSection && (() => {
        const progress = activeSection.seconds > 0 ? timeLeft / activeSection.seconds : 0;
        const isDone = timeLeft === 0;
        return (
          <div style={{
            position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
            width: "calc(100% - 32px)", maxWidth: 568, background: isDone ? "#16a34a" : activeSection.accent,
            color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", gap: 14,
            boxShadow: "0 -4px 20px #0004", borderRadius: "20px 20px 0 0", transition: "background 0.3s", zIndex: 50,
            overflow: "hidden",
          }}>
            {timerLocked && (
              <div style={{ position: "absolute", inset: 0, background: isDone ? "#16a34a" : activeSection.accent, display: "flex", alignItems: "center", padding: "0 20px", gap: 14, zIndex: 1 }}>
                <div style={{ position: "relative", width: 75, height: 75, flexShrink: 0 }}>
                  <svg width="75" height="75" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="37.5" cy="37.5" r="31" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
                    <circle cx="37.5" cy="37.5" r="31" fill="none" stroke="#fff" strokeWidth="4"
                      strokeDasharray={2 * Math.PI * 31}
                      strokeDashoffset={2 * Math.PI * 31 * (1 - progress)}
                      strokeLinecap="round"
                      style={{ transition: "stroke-dashoffset 0.9s linear" }}
                    />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: isDone ? 31 : 19, fontWeight: 700 }}>
                    {isDone ? "🔔" : formatTime(timeLeft)}
                  </div>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>{activeSection.icon} {activeSection.label} rust</div>
                  {isDone && <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2, marginTop: 2 }}>Rust voorbij, ga! 💪</div>}
                </div>
                <button onClick={() => setTimerLocked(false)}
                  style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 20, WebkitAppearance: "none", appearance: "none", width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  🔓
                </button>
              </div>
            )}
            <div style={{ position: "relative", width: 75, height: 75, flexShrink: 0 }}>
              <svg width="75" height="75" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="37.5" cy="37.5" r="31" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
                <circle cx="37.5" cy="37.5" r="31" fill="none" stroke="#fff" strokeWidth="4"
                  strokeDasharray={2 * Math.PI * 31}
                  strokeDashoffset={2 * Math.PI * 31 * (1 - progress)}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 0.9s linear" }}
                />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: isDone ? 31 : 19, fontWeight: 700 }}>
                {isDone ? "🔔" : formatTime(timeLeft)}
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
              <div style={{ fontSize: 13, opacity: 0.8 }}>{activeSection.icon} {activeSection.label} rust</div>
              {isDone && <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2, marginTop: 2 }}>Rust voorbij, ga! 💪</div>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {!isDone && (
                <button onClick={() => { if (running) { pause(); } else { start(timeLeft, activeSection?.label ?? ""); } }}
                  style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 20, lineHeight: 1, WebkitAppearance: "none", appearance: "none", width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {running ? "II" : "▶"}
                </button>
              )}
              <button onClick={() => { restart(activeSection.seconds, activeSection.label); setTimerLocked(true); }}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 20, lineHeight: 1, WebkitAppearance: "none", appearance: "none", width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                ↺
              </button>
              <button onClick={() => { setActiveTimer(null); setActiveSection(null); setTimerLocked(false); NativeTimer.stop().catch(console.error); }}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 20, lineHeight: 1, WebkitAppearance: "none", appearance: "none", width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                ✕
              </button>
            </div>
          </div>
        );
      })()}

      {swapModal && (
        <BottomSheet
          currentExercise={swaps[sKey(swapModal.original, swapModal.week, swapModal.day)] || swapModal.original}
          exercises={(swapModal.options || KB_EXERCISES).filter((n) => n !== (swaps[sKey(swapModal.original, swapModal.week, swapModal.day)] || swapModal.original))}
          onSelect={(name) => saveSwap(swapModal.original, name, swapModal.week, swapModal.day)}
          onClose={() => setSwapModal(null)}
        />
      )}

      {summaryOpen && (() => {
        const datum = dateForDay(week, day.dag_volgorde);
        let groups = [];
        let finisherBlocks = [];
        if (day.type === "training") {
          const displayName = (ex) => swaps[sKey(ex.name, week.yw, day.dag_nummer)] ?? ex.name;
          // Same grouping as the day screen above (schema 2: supersets +
          // losse oefeningen; schema 1: barbell + spiergroep).
          const raw = usesSupersetLayout(week)
            ? [
                { title: "Superset 1", exercises: [day.barbell, ...day.spiergroep.filter(ex => ex.note === "Superset 1")] },
                { title: "Superset 2", exercises: day.spiergroep.filter(ex => ex.note === "Superset 2") },
                { title: "Losse oefeningen", exercises: day.spiergroep.filter(ex => !ex.note || (ex.note !== "Superset 1" && ex.note !== "Superset 2")) },
              ]
            : [
                { title: "Barbell hoofdoefening", exercises: [day.barbell] },
                { title: "Spiergroep oefeningen", exercises: day.spiergroep },
              ];
          groups = raw
            .map(g => ({
              title: g.title,
              rows: g.exercises
                .filter(ex => ex?.name)
                .map(displayName)
                .filter(name => { const m = weights[wKey(name, week.yw)]?.M; return m !== "" && m != null; })
                .map(name => summarizeExercise(name, week.yw, weights, prescribedReps, swaps)),
            }))
            .filter(g => g.rows.length > 0);
          // Same order, names and colours as the day screen's sections;
          // same completion key as the ExCircle tick (name + week + dag_nummer).
          finisherBlocks = [
            { title: "Mobility", icon: "🤸", accent: "#0d9488", light: "#ccfbf1", list: day.mobility },
            { title: "Kettlebell (Full Body)", icon: "🔔", accent: "#c05621", light: "#fed7aa", list: day.kettlebell },
            { title: "Core Finisher", icon: "🔥", accent: "#7c3aed", light: "#ede9fe", list: day.core },
          ]
            .map(({ list, ...b }) => ({
              ...b,
              items: list.filter(ex => ex?.name).map(ex => {
                const name = displayName(ex);
                return { name, optional: !!ex.optional, done: completedExercises.has(eKey(name, week.yw, day.dag_nummer)) };
              }),
            }))
            .filter(b => b.items.length > 0);
        }
        return (
          <DaySummarySheet
            day={day}
            weekNum={week.week}
            phase={week.phase}
            datum={datum}
            score={dayScores[datum]}
            groups={groups}
            finisherBlocks={finisherBlocks}
            onClose={() => setSummaryOpen(false)}
          />
        );
      })()}

      {yearSheetOpen && (
        <YearSheet
          years={schemaYears}
          currentYear={today.isoYear}
          viewYear={viewYear}
          onSelect={switchYear}
          onClose={() => setYearSheetOpen(false)}
        />
      )}

      {scorePrompt && (
        <ScorePromptModal
          dayLabel={scorePrompt.dayLabel}
          initialScore={dayScores[scorePrompt.datum]}
          onSubmit={(training, motivatie) => saveScore(scorePrompt.datum, training, motivatie)}
          onClose={() => setScorePrompt(null)}
        />
      )}
    </div>
  );
}

function Section({ title, icon, accent, timerSeconds, timerActive, onTimerClick, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, marginBottom: 12, overflow: "hidden", boxShadow: "0 1px 4px #0001" }}>
      <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#1a1a1a" }}>{title}</span>
        </div>
        <button
          onClick={onTimerClick}
          style={{ background: timerActive ? accent : "#f0f0f0", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: timerActive ? "#fff" : "#555", transition: "all 0.15s" }}
        >
          ⏱ {formatTimerLabel(timerSeconds)}
        </button>
      </div>
      <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function ExRow({ num, name, sets, note, accent, light, optional, expanded, onToggle, weightM, weightZ, onWeightChange, repsM, repsZ, onRepsChange, prevWeightM, prevWeightZ, prevRepsM, prevRepsZ, prevWeekLabel, pr, savedM, savedZ, completed, onLongPress, swapped, originalName, hiitInterval, readOnly }) {
  const isClickable = !!onToggle;
  const hasPrev = (prevWeightM !== "" && prevWeightM != null) || (prevWeightZ !== "" && prevWeightZ != null);
  return (
    <div style={{ borderRadius: 8, overflow: "hidden", border: optional ? "1.5px dashed #f37121" : "none" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, background: hexA(light, 0.33), padding: "10px 12px", cursor: isClickable ? "pointer" : "default" }}
        onClick={onToggle}
      >
        <ExCircle num={num} completed={completed} accent={accent} optional={optional} onLongPress={onLongPress} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{name}</span>
            {optional && <span style={{ fontSize: 10, background: "#fff0e6", color: "#f37121", padding: "2px 7px", borderRadius: 10, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: 0.5, border: "1px solid #f37121" }}>OPTIONEEL</span>}
            {swapped && <span style={{ fontSize: 10, background: "#fff0e6", color: "#f37121", padding: "2px 7px", borderRadius: 10, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: 0.5, border: "1px solid #f37121" }}>GEWIJZIGD</span>}
          </div>
          {note && <HintBadges text={note} textColor={optional ? "#f37121" : accent} />}
          {originalName && <div style={{ fontSize: 11, color: "#bbb", fontFamily: "sans-serif", marginTop: 1 }}>↩ {originalName}</div>}
        </div>
        {hiitInterval ? (
          <div style={{ display: "flex" }}>
            <div style={{ background: optional ? "#fff0e6" : "#f37121", color: optional ? "#f37121" : "#fff", border: optional ? "1px solid #f37121" : "none", padding: "4px 8px", borderRadius: "10px 0 0 10px", fontSize: 12, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap" }}>
              {hiitInterval.work}s
            </div>
            <div style={{ background: "#888", color: "#fff", padding: "4px 8px", borderRadius: "0 10px 10px 0", fontSize: 12, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap" }}>
              {hiitInterval.rest}s
            </div>
          </div>
        ) : (
          <div style={{ background: optional ? "#fff0e6" : accent, color: optional ? "#f37121" : "#fff", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap", flexShrink: 0, border: optional ? "1px solid #f37121" : "none" }}>
            {sets}
          </div>
        )}
      </div>
      {expanded && (
        <div
          style={{ background: "#fff8f5", borderTop: "1px solid #f0d0b8", padding: "10px 12px 10px 48px", display: "flex", flexDirection: "column", gap: 8 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            {["M", "Z"].map((person) => {
              const currentReps = person === "M" ? repsM : repsZ;
              const currentRepsNum = currentReps === "" || currentReps == null ? null : Number(currentReps);
              return (
              <div key={person} style={{ display: person === "Z" ? "none" : "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  disabled={readOnly}
                  step="any"
                  min={0}
                  value={person === "M" ? weightM : weightZ}
                  onChange={(e) => onWeightChange(person, e.target.value)}
                  placeholder="kg"
                  style={{ width: 70, padding: "5px 8px", borderRadius: 6, border: "1px solid #e0c8b8", fontFamily: "sans-serif", fontSize: 13, outline: "none", background: "#fff" }}
                />
                <span style={{ display: "inline-flex", width: 14, justifyContent: "center", color: "#16a34a", fontSize: 14, fontWeight: 700, lineHeight: 1, visibility: ((person === "M" && savedM) || (person === "Z" && savedZ)) ? "visible" : "hidden" }}>✓</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                  <button
                    type="button"
                    hidden={readOnly}
                    disabled={currentRepsNum == null}
                    onClick={() => onRepsChange(person, String(Math.max(1, currentRepsNum - 1)))}
                    style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: currentRepsNum == null ? "default" : "pointer", opacity: currentRepsNum == null ? 0.4 : 1 }}
                  >−</button>
                  <span style={{ minWidth: 18, textAlign: "center", fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#1a1a1a", userSelect: "none" }}>
                    {currentRepsNum ?? "–"}
                  </span>
                  <button
                    type="button"
                    hidden={readOnly}
                    onClick={() => onRepsChange(person, String(Math.min(50, (currentRepsNum ?? 0) + 1)))}
                    style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: "pointer" }}
                  >+</button>
                </div>
              </div>
              );
            })}
          </div>
          {(hasPrev || pr) && (
            <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#bbb" }}>
              {hasPrev && <>{prevWeekLabel || "Vorige week"} · <span style={{ color: "#1a1a1a" }}>{prevWeightM !== "" && prevWeightM != null ? `${prevWeightM}kg${prevRepsM !== "" && prevRepsM != null ? ` × ${prevRepsM}` : ''}` : "—"}</span><span style={{ display: "none" }}> / <span style={{ color: "#1a1a1a" }}>Z:</span> <span style={{ color: "#1a1a1a" }}>{prevWeightZ !== "" && prevWeightZ != null ? `${prevWeightZ}kg${prevRepsZ !== "" && prevRepsZ != null ? ` × ${prevRepsZ}` : ''}` : "—"}</span></span></>}<PrText pr={pr} currentWeight={weightM} standalone={!hasPrev} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function TypeBadge({ type }) {
  const cfg = {
    barbell:  { bg: "#1a1a1a", label: "BB" },
    dumbbell: { bg: "#3b82f6", label: "DB" },
    cable:    { bg: "#8b5cf6", label: "cable" },
    machine:  { bg: "#059669", label: "machine" },
  };
  const c = cfg[type];
  if (!c) return null;
  return <Badge bg={c.bg} color="#fff">{c.label}</Badge>;
}

// Shared pill used by TypeBadge (equipment) and HintBadges (weight hints).
function Badge({ bg, color, children }) {
  return (
    <span style={{ fontSize: 9, background: bg, color, padding: "2px 6px", borderRadius: 10, fontFamily: "sans-serif", fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

// Weight hints ("+gewicht", "+5kg piek", "Focusgewicht") get a solid red pill;
// everything else ("dropset", "deload", "60-70%") a soft slate one.
function hintColors(segment) {
  if (/gewicht|^\+\d/i.test(segment)) return { bg: "#dc2626", color: "#fff" };
  return { bg: "#e2e8f0", color: "#334155" };
}

// Renders a weight_hint / note string as a row of badges, split on "·" at
// render time (the DB stores e.g. "+gewicht · dropset" as one string).
// Segments longer than 20 chars stay plain text so free-text KB/core notes
// are never squeezed into a pill. onDark: the orange schema-1 barbell card.
function HintBadges({ text, onDark, textColor }) {
  const segments = text.split("·").map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 1 }}>
      {segments.map((s, i) => {
        if (s.length > 20) return <span key={i} style={{ fontSize: 11, color: textColor, fontFamily: "sans-serif" }}>{s}</span>;
        const c = onDark ? { bg: "rgba(255,255,255,0.22)", color: "#fff" } : hintColors(s);
        return <Badge key={i} bg={c.bg} color={c.color}>{s}</Badge>;
      })}
    </div>
  );
}

function SupersetBlock({ title, exercises, accentColor, lightColor, expandedExercise, onToggle, yw, dayId, weights, savedIndicators, completedExercises, onWeightChange, onRepsChange, getEffectiveReps, toggleCompletion, personalRecords, readOnly }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, paddingLeft: 4 }}>
        <div style={{ background: accentColor, color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: "3px 8px", borderRadius: 20, fontFamily: "sans-serif" }}>
          {title}
        </div>
        <div style={{ flex: 1, height: 1, background: hexA(accentColor, 0.25) }} />
      </div>
      <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", border: `2px solid ${hexA(accentColor, 0.2)}` }}>
        {exercises.map((ex, i) => {
          const type = inferExerciseType(ex.name, ex.categorie);
          const k = wKey(ex.name, yw);
          const w = weights[k] || { M: "", Z: "" };
          const prevResult = findPrevWeight(ex.name, yw, weights);
          const prevW = prevResult || { M: null, Z: null };
          const hasPrev = (prevW.M !== "" && prevW.M != null) || (prevW.Z !== "" && prevW.Z != null);
          const isExpanded = expandedExercise === ex.name;
          const isCompleted = completedExercises.has(eKey(ex.name, yw, dayId));
          return (
            <div key={i}>
              <div
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: hexA(lightColor, 0.33), cursor: "pointer" }}
                onClick={() => onToggle(ex.name)}
              >
                <ExCircle num={i + 1} completed={isCompleted} accent={accentColor} onLongPress={toggleCompletion ? () => toggleCompletion(ex.name, yw, dayId) : undefined} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", fontFamily: "sans-serif" }}>{ex.name}</span>
                    <TypeBadge type={type} />
                  </div>
                  {ex.weight_hint && <HintBadges text={ex.weight_hint} textColor={accentColor} />}
                </div>
                <div style={{ background: accentColor, color: "#fff", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {ex.sets}
                </div>
              </div>
              {isExpanded && (() => {
                const currentReps = getEffectiveReps(ex.name, yw, "M");
                const currentRepsNum = currentReps === "" || currentReps == null ? null : Number(currentReps);
                return (
                <div style={{ background: "#fff8f5", borderTop: "1px solid #f0d0b8", padding: "10px 12px 10px 52px", display: "flex", flexDirection: "column", gap: 8 }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="number" disabled={readOnly} step="any" min={0} value={w.M} onChange={e => onWeightChange(ex.name, yw, "M", e.target.value)} placeholder="kg" style={{ width: 70, padding: "5px 8px", borderRadius: 6, border: "1px solid #e0c8b8", fontFamily: "sans-serif", fontSize: 13, outline: "none", background: "#fff" }} />
                    <span style={{ display: "inline-flex", width: 14, justifyContent: "center", color: "#16a34a", fontSize: 14, fontWeight: 700, visibility: savedIndicators[`${ex.name}__${yw}__M`] ? "visible" : "hidden" }}>✓</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                      <button
                        type="button"
                        hidden={readOnly}
                        disabled={currentRepsNum == null}
                        onClick={() => onRepsChange(ex.name, yw, "M", String(Math.max(1, currentRepsNum - 1)))}
                        style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: currentRepsNum == null ? "default" : "pointer", opacity: currentRepsNum == null ? 0.4 : 1 }}
                      >−</button>
                      <span style={{ minWidth: 18, textAlign: "center", fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#1a1a1a", userSelect: "none" }}>
                        {currentRepsNum ?? "–"}
                      </span>
                      <button
                        type="button"
                        hidden={readOnly}
                        onClick={() => onRepsChange(ex.name, yw, "M", String(Math.min(50, (currentRepsNum ?? 0) + 1)))}
                        style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: "pointer" }}
                      >+</button>
                    </div>
                  </div>
                  {(hasPrev || personalRecords[ex.name]) && (
                    <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#bbb" }}>
                      {hasPrev && <>{prevResult?.label} · <span style={{ color: "#1a1a1a" }}>{prevW.M !== "" && prevW.M != null ? `${prevW.M}kg${prevW.repsM !== "" && prevW.repsM != null ? ` × ${prevW.repsM}` : ''}` : "—"}</span></>}<PrText pr={personalRecords[ex.name]} currentWeight={w.M} standalone={!hasPrev} />
                    </div>
                  )}
                </div>
                );
              })()}
              {i < exercises.length - 1 && !isExpanded && (
                <div style={{ display: "flex", alignItems: "center", padding: "0 14px", background: "#fff" }}>
                  <div style={{ width: 28, display: "flex", justifyContent: "center" }}>
                    <div style={{ width: 2, height: 16, background: hexA(accentColor, 0.38), borderRadius: 1 }} />
                  </div>
                  <div style={{ flex: 1, paddingLeft: 10 }}>
                    <span style={{ fontSize: 9, color: accentColor, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: 1 }}>GEEN RUST →</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExCircle({ num, completed, accent, optional, onLongPress }) {
  const timer = useRef(null);
  const longPressed = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const startPress = (e) => {
    longPressed.current = false;
    // No handler (read-only archive): no haptic, no long press at all.
    if (!onLongPress) return;
    const t = e.touches?.[0];
    if (t) startPos.current = { x: t.clientX, y: t.clientY };
    timer.current = setTimeout(() => {
      longPressed.current = true;
      triggerImpact();
      onLongPress();
    }, 1000);
  };

  const cancelPress = () => clearTimeout(timer.current);

  const handleTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - startPos.current.x) > 10 || Math.abs(t.clientY - startPos.current.y) > 10) cancelPress();
  };

  return (
    <div
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={handleTouchMove}
      onClick={(e) => { if (longPressed.current) { longPressed.current = false; e.stopPropagation(); } }}
      style={{
        width: 26, height: 26, borderRadius: "50%",
        background: completed ? "#16a34a" : (optional ? "transparent" : accent),
        color: completed ? "#fff" : (optional ? "#f37121" : "#fff"),
        border: completed ? "none" : (optional ? "1.5px dashed #f37121" : "none"),
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: completed ? 14 : 12, fontWeight: 700, fontFamily: "sans-serif",
        flexShrink: 0, cursor: "pointer", userSelect: "none",
      }}
    >
      {completed ? "✓" : num}
    </div>
  );
}

const STREK_ICONS = { trap: "🪜", sta_op: "🧍", avond: "🌙", vacuum: "💨" };
const VRIJ_ICONS  = { gezin: "👨‍👩‍👧", optioneel: "✨" };

function StretchenCard({ goals, day }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "20px", boxShadow: "0 1px 4px #0001", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 32 }}>{day.emoji}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#1a1a1a", fontFamily: "sans-serif" }}>Anti-zit dag</div>
          <div style={{ fontSize: 12, color: "#64748b", fontFamily: "sans-serif", marginTop: 2 }}>Blijf in beweging — geen training, wel actief</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {goals.length === 0 && (
          <div style={{ fontSize: 13, color: "#94a3b8", fontFamily: "sans-serif", textAlign: "center", padding: "12px 0" }}>Geen doelen gevonden</div>
        )}
        {goals.map((g, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "#f8faff", borderRadius: 10, padding: "11px 14px" }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{STREK_ICONS[g.type] || "✅"}</span>
            <div style={{ flex: 1, fontSize: 14, color: "#1e293b", fontFamily: "sans-serif", lineHeight: 1.4 }}>{g.beschrijving}</div>
            {g.duur_minuten && (
              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", background: "#e2e8f0", borderRadius: 20, padding: "2px 8px", flexShrink: 0, fontFamily: "sans-serif" }}>
                {g.duur_minuten} min
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function VrijeDagCard({ goals, day }) {
  const main   = goals.find(g => g.type === "gezin");
  const optie  = goals.find(g => g.type === "optioneel");
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "28px 20px", textAlign: "center", boxShadow: "0 1px 4px #0001", marginBottom: 12 }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{day.emoji}</div>
      <div style={{ fontWeight: 700, fontSize: 18, color: "#1a1a1a", marginBottom: 8, fontFamily: "sans-serif" }}>Vrije dag</div>
      <div style={{ fontSize: 14, color: "#334155", fontFamily: "sans-serif", lineHeight: 1.6, marginBottom: optie ? 16 : 0 }}>
        {main?.beschrijving || "Tijd met het gezin staat voorop vandaag."}
      </div>
      {optie && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f1f5f9", borderRadius: 20, padding: "6px 14px", fontSize: 13, color: "#64748b", fontFamily: "sans-serif" }}>
          <span>{VRIJ_ICONS.optioneel}</span>
          <span>{optie.beschrijving}</span>
          {optie.duur_minuten && <span style={{ fontWeight: 700 }}>· {optie.duur_minuten} min</span>}
        </div>
      )}
    </div>
  );
}

// Header color #ea580c is intentionally NOT the shared #f97316 used
// elsewhere for these day types — a pre-existing, known inconsistency
// carried forward unchanged (see rename plan §1, "Card copy" — flagged,
// not part of this migration's scope).
// Read-only 5-star row — empty (score undefined/0) or filled up to
// `value`. Used on PowerHourCard/BoksenCard, the only place a saved score
// is shown outside the entry prompt itself (no dashboard, no chart —
// point 10 is explicit that this is the only display surface).
function StarRow({ value = 0 }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ fontSize: 15, color: n <= value ? "#ea580c" : "#fdba9c" }}>{n <= value ? "★" : "☆"}</span>
      ))}
    </div>
  );
}

// Score entry point shared by PowerHourCard/BoksenCard — a two-row star
// summary (empty when no score exists yet, the visible affordance) plus a
// button that opens the same ScorePromptModal the tile long-press does.
function ScoreSummary({ score, onOpenPrompt }) {
  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #fed7aa" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#9a3412", fontFamily: "sans-serif", minWidth: 90, textAlign: "right" }}>Training</span>
          <StarRow value={score?.training} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#9a3412", fontFamily: "sans-serif", minWidth: 90, textAlign: "right" }}>Energie</span>
          <StarRow value={score?.motivatie} />
        </div>
      </div>
      {onOpenPrompt && (
        <button
          onClick={onOpenPrompt}
          style={{ background: "#ea580c", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", cursor: "pointer" }}
        >
          {score ? "Score aanpassen" : "Geef een score"}
        </button>
      )}
    </div>
  );
}

function PowerHourCard({ day, score, onOpenPrompt }) {
  return (
    <div style={{ background: "#fff7ed", border: "2px solid #fed7aa", borderRadius: 14, padding: "28px 20px", textAlign: "center", boxShadow: "0 1px 4px #0001", marginBottom: 12 }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{day.emoji}</div>
      <div style={{ fontWeight: 700, fontSize: 18, color: "#ea580c", marginBottom: 8, fontFamily: "sans-serif" }}>Power Hour</div>
      <div style={{ fontSize: 14, color: "#7c2d12", fontFamily: "sans-serif", lineHeight: 1.5, marginBottom: 12 }}>
        Externe sportzaal — buiten dit trainingsschema.
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#ffedd5", borderRadius: 20, padding: "5px 14px", fontSize: 12, color: "#9a3412", fontFamily: "sans-serif", fontWeight: 600 }}>
        <span>🕐</span><span>HIIT</span>
      </div>
      <ScoreSummary score={score} onOpenPrompt={onOpenPrompt} />
    </div>
  );
}

function BoksenCard({ day, score, onOpenPrompt }) {
  return (
    <div style={{ background: "#fff7ed", border: "2px solid #fed7aa", borderRadius: 14, padding: "28px 20px", textAlign: "center", boxShadow: "0 1px 4px #0001", marginBottom: 12 }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{day.emoji}</div>
      <div style={{ fontWeight: 700, fontSize: 18, color: "#ea580c", marginBottom: 8, fontFamily: "sans-serif" }}>Boksen</div>
      <div style={{ fontSize: 14, color: "#7c2d12", fontFamily: "sans-serif", lineHeight: 1.5, marginBottom: 12 }}>
        Boksen in Beverwijk
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#ffedd5", borderRadius: 20, padding: "5px 14px", fontSize: 12, color: "#9a3412", fontFamily: "sans-serif", fontWeight: 600 }}>
        <span>🥊</span><span>Boksen &amp; Zaktraining</span>
      </div>
      <ScoreSummary score={score} onOpenPrompt={onOpenPrompt} />
    </div>
  );
}

function WeekDayTile({ day, isSelected, isToday, isCompleted, onSelect, onLongPress, onOpenSummary }) {
  const timer = useRef(null);
  const longPressed = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const isRust = day.type === "rust";
  const isSpecialActivity = day.type === "power_hour" || day.type === "boksen";
  const tileColor = day.kleur || (day.dag_nummer ? dayColors[day.dag_nummer].accent : null) || (isSpecialActivity ? "#f97316" : "#94a3b8");

  const startPress = (e) => {
    // Rest days have nothing to complete or score. power_hour/boksen used
    // to be excluded here too (a deliberate "wasted haptic" guard, back
    // when long-press did nothing for these types) — now it opens the
    // star-score prompt, so the gesture does something and the guard no
    // longer applies to them.
    if (isRust || !onLongPress) return;
    longPressed.current = false;
    const t = e.touches?.[0];
    if (t) startPos.current = { x: t.clientX, y: t.clientY };
    timer.current = setTimeout(() => { longPressed.current = true; triggerImpact(); onLongPress(); }, 1000);
  };
  const cancelPress = () => clearTimeout(timer.current);
  const handleMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - startPos.current.x) > 10 || Math.abs(t.clientY - startPos.current.y) > 10) cancelPress();
  };

  return (
    <button
      onMouseDown={startPress} onMouseUp={cancelPress}
      onTouchStart={startPress} onTouchEnd={cancelPress} onTouchMove={handleMove}
      onClick={() => { if (longPressed.current) { longPressed.current = false; return; } onSelect(); }}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "0 2px 6px", borderRadius: 10,
        border: isSelected ? `2px solid ${tileColor}` : isToday ? "2px solid #ddd" : "2px solid transparent",
        cursor: "pointer", background: isSelected ? (day.dag_nummer ? dayColors[day.dag_nummer].bg : hexA(tileColor, 0.15)) : "#fff",
        boxShadow: isSelected ? `0 2px 8px ${hexA(tileColor, 0.25)}` : "0 1px 3px rgba(0,0,0,0.06)",
        userSelect: "none", minWidth: 0,
        ...(onOpenSummary ? { position: "relative" } : {}),
      }}
    >
      {/* Today dot zone — fixed 8px, always present */}
      <div style={{ height: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isToday && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#f37121" }} />}
      </div>

      {/* Day label — fixed 16px */}
      <div style={{ height: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: isSelected ? tileColor : "#aaa", letterSpacing: 0.5, fontFamily: "sans-serif" }}>
        {day.dag_label}
      </div>

      {/* Emoji / checkmark — fixed 24px */}
      <div style={{ height: 24, display: "flex", alignItems: "center", justifyContent: "center", opacity: isRust ? 0.45 : 1 }}>
        {isCompleted
          ? <span style={{ fontSize: 14, fontWeight: 900, color: "#16a34a", lineHeight: 1 }}>✓</span>
          : <span style={{ fontSize: 16, lineHeight: 1 }}>{day.emoji}</span>
        }
      </div>

      {/* Separator zone — fixed 7px, rust dot centered inside */}
      <div style={{ height: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isRust && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#94a3b8" }} />}
      </div>

      {/* Name zone — fixed 30px (3 × 10px lines), always 3 rows so all tiles align */}
      <div style={{ height: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", overflow: "hidden", fontSize: 10, fontWeight: 700, lineHeight: "10px", fontFamily: "sans-serif", color: isSpecialActivity ? "#f97316" : isRust ? "#94a3b8" : tileColor }}>
        {(() => { const words = (day.naam || "").split(" "); while (words.length < 3) words.push(" "); return words.map((w, i) => <div key={i}>{w}</div>); })()}
      </div>

      {/* Day summary tab — hangs from the selected tile's bottom border
          into the 16px gap above the first card. The outer element is a
          44px-wide invisible hit area; every pointer event stops here so
          a tap never starts the tile's long-press timer, re-selects the
          tile, or starts a pull-to-refresh. */}
      {onOpenSummary && (
        <a
          role="button"
          tabIndex={0}
          aria-label="Samenvatting van de training"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onOpenSummary(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpenSummary(); } }}
          style={{ position: "absolute", left: "50%", bottom: -18, width: 44, height: 32, marginLeft: -22, display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1, cursor: "pointer" }}
        >
          <div style={{ width: 30, height: 18, borderRadius: "0 0 9px 9px", background: tileColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </a>
      )}
    </button>
  );
}

function DayButton({ day, isSelected, isCompleted, colors, onSelect, onLongPress }) {
  const c = colors;
  const timer = useRef(null);
  const longPressed = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const startPress = (e) => {
    longPressed.current = false;
    const t = e.touches?.[0];
    if (t) startPos.current = { x: t.clientX, y: t.clientY };
    timer.current = setTimeout(() => {
      longPressed.current = true;
      triggerImpact();
      onLongPress();
    }, 1000);
  };

  const cancelPress = () => clearTimeout(timer.current);

  const handleTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - startPos.current.x) > 10 || Math.abs(t.clientY - startPos.current.y) > 10) cancelPress();
  };

  return (
    <button
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={handleTouchMove}
      onClick={() => { if (longPressed.current) { longPressed.current = false; return; } onSelect(); }}
      style={{
        padding: "10px 6px",
        borderRadius: 10,
        border: isSelected ? `2px solid ${c.accent}` : "2px solid transparent",
        cursor: "pointer",
        background: isSelected ? c.bg : "#fff",
        textAlign: "center",
        transition: "all 0.15s",
        boxShadow: isSelected ? `0 2px 8px ${c.accent}33` : "0 1px 3px #0001",
        userSelect: "none",
      }}
    >
      <div style={{ position: "relative", display: "inline-block" }}>
        <div style={{ fontSize: 20 }}>{day.emoji}</div>
        {isCompleted && (
          <div style={{ position: "absolute", top: -4, right: -6, background: "#16a34a", color: "#fff", borderRadius: "50%", width: 14, height: 14, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 }}>✓</div>
        )}
      </div>
      <div style={{ fontSize: 10, fontFamily: "sans-serif", fontWeight: 600, color: isSelected ? c.accent : "#888", marginTop: 2, lineHeight: 1.2 }}>
        {day.name}
      </div>
    </button>
  );
}

function SwipeableRow({ onSwipeRight, onSwipeLeft, children }) {
  const startX = useRef(null);
  const startY = useRef(null);
  const swiped = useRef(false);
  const isMouseDown = useRef(false);
  const [offsetX, setOffsetX] = useState(0);

  const onStart = (e) => {
    const p = e.touches?.[0] || e;
    startX.current = p.clientX;
    startY.current = p.clientY;
    swiped.current = false;
  };

  const onMove = (e) => {
    if (startX.current === null || swiped.current) return;
    const p = e.touches?.[0] || e;
    const dx = p.clientX - startX.current;
    const dy = Math.abs(p.clientY - startY.current);
    if (dy > 30) { startX.current = null; setOffsetX(0); return; }
    if (dx > 0 && onSwipeRight) {
      setOffsetX(Math.min(dx, 80));
      if (dx >= 60) {
        swiped.current = true;
        startX.current = null;
        setOffsetX(0);
        onSwipeRight();
      }
    } else if (dx < 0 && onSwipeLeft) {
      setOffsetX(Math.max(dx, -80));
      if (dx <= -60) {
        swiped.current = true;
        startX.current = null;
        setOffsetX(0);
        onSwipeLeft();
      }
    } else {
      startX.current = null;
      setOffsetX(0);
    }
  };

  const onEnd = () => { isMouseDown.current = false; startX.current = null; setOffsetX(0); };

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      {onSwipeLeft && offsetX < 0 && (
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, display: "flex", alignItems: "center", paddingRight: 16, color: "#dc2626", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif" }}>
          ↩ Terug
        </div>
      )}
      <div
        onMouseDown={(e) => { isMouseDown.current = true; onStart(e); }}
        onMouseMove={(e) => { if (isMouseDown.current) onMove(e); }}
        onMouseUp={onEnd}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onClick={(e) => { if (swiped.current) { swiped.current = false; e.stopPropagation(); } }}
        style={{ transform: `translateX(${offsetX}px)`, transition: offsetX === 0 ? "transform 0.2s" : "none" }}
      >
        {children}
      </div>
    </div>
  );
}

// Fixed per-value descriptions shown under each StarPicker row, so the
// scale means the same thing every time it's used instead of drifting with
// mood alone. Keyed 1-5 to match the star value directly; consulted only by
// StarPicker below, kept local to it rather than declared per call site.
const TRAINING_SCORE_DESCRIPTIONS = {
  1: "Afgebroken door vermoeidheid",
  2: "Schema niet helemaal kunnen volgen, was te zwaar",
  3: "Niet mijn beste werk. Was pittig om af te maken",
  4: "Goeie workout! Tank was niet helemaal leeg aan het eind",
  5: "Kruipend naar huis 😈. Love it!",
};
const ENERGY_SCORE_DESCRIPTIONS = {
  1: "Vermoeid, moest mezelf echt moed inpraten",
  2: "Laag in mijn energie, niet meer recht te trekken",
  3: "Moe, moest echt energie bijtanken van tevoren",
  4: "Voelde goed. Geen vermoeidheid als belemmering",
  5: "Kon niet wachten! Hoog in m'n energie",
};

// Interactive 1-5 star row for ScorePromptModal — tap a star to set the
// value. Distinct from the read-only StarRow on PowerHourCard/BoksenCard,
// which only ever displays a saved score.
function StarPicker({ label, value, onChange, descriptions }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: "sans-serif", fontSize: 14, color: "#1a1a1a", marginBottom: 8, textAlign: "center" }}>{label}</div>
      <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 30, color: n <= value ? "#f37121" : "#ddd", lineHeight: 1, WebkitAppearance: "none", appearance: "none" }}
          >
            {n <= value ? "★" : "☆"}
          </button>
        ))}
      </div>
      {/* Reserves two lines' worth of height up front (the two longest
          descriptions wrap at this modal's width; the shortest doesn't) so
          the star row above never shifts when a shorter or longer
          description swaps in on tap. */}
      <div style={{ fontFamily: "sans-serif", fontSize: 12, color: "#999", textAlign: "center", marginTop: 8, lineHeight: 1.4, minHeight: 34 }}>
        {value > 0 ? descriptions[value] : ""}
      </div>
    </div>
  );
}

// Point 10: centred overlay for the two-question session score, opened by
// the long-press that already marks a day complete (training) or by the
// tile long-press / card button on Power Hour and Boksen days, which have
// no other completion state. A new component, not a BottomSheet
// adaptation — that slides up from the bottom, which is the wrong pattern
// for a form the user is asked to fill in, not a list to pick from.
//
// Scroll-lock, Escape, and Android back-gesture handling are all new
// here — BottomSheet has none of the three. The back-gesture fix needs no
// native dependency (@capacitor/app is not installed): pushing a dummy
// history entry makes the WebView's own canGoBack() true, so a hardware
// back press or back gesture fires `popstate` and closes this overlay
// instead of the app's default (no router, no other history anywhere in
// this app) fallback of exiting/minimizing. See the effect below for why
// the cleanup only calls history.back() when we did NOT arrive via that
// popstate — otherwise it would consume a second, unrelated entry.
//
// No focus trap: this app is touch-primary, no component anywhere manages
// focus, and adding one here would be new scope beyond what this feature
// needs.
function ScorePromptModal({ dayLabel, initialScore, onSubmit, onClose }) {
  const [training, setTraining] = useState(initialScore?.training ?? 0);
  const [motivatie, setMotivatie] = useState(initialScore?.motivatie ?? 0);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    window.history.pushState({ scorePrompt: true }, "");
    const closedViaPopstate = { current: false };
    const handlePopState = () => { closedViaPopstate.current = true; onClose(); };
    const handleKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleKeyDown);
      // Closed via any path OTHER than the back gesture (backdrop, submit,
      // this component simply unmounting) — the entry pushed above is
      // still sitting there, unconsumed, and would otherwise eat a later,
      // unrelated back-press. Listeners are already removed, so the
      // popstate this causes can't re-trigger handlePopState.
      if (!closedViaPopstate.current) window.history.back();
    };
    // Mount/unmount only — onClose is stable enough for this file's own
    // convention (see e.g. the swap/timer effects), and re-running this
    // on every render would push a new history entry each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSubmit = training > 0 && motivatie > 0;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#0007", zIndex: 100 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "#fff", borderRadius: 18, padding: "24px 20px", zIndex: 101, width: "calc(100% - 48px)", maxWidth: 340, boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
        {dayLabel && (
          <div style={{ textAlign: "center", fontFamily: "sans-serif", fontSize: 12, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 16 }}>{dayLabel}</div>
        )}
        <StarPicker label="Hoe ging de training?" value={training} onChange={setTraining} descriptions={TRAINING_SCORE_DESCRIPTIONS} />
        <StarPicker label="Hoe was je energie voor de training?" value={motivatie} onChange={setMotivatie} descriptions={ENERGY_SCORE_DESCRIPTIONS} />
        <button
          onClick={() => canSubmit && onSubmit(training, motivatie)}
          disabled={!canSubmit}
          style={{ width: "100%", background: canSubmit ? "#f37121" : "#f3d9c4", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 700, fontFamily: "sans-serif", cursor: canSubmit ? "pointer" : "default", marginTop: 4 }}
        >
          Opslaan
        </button>
      </div>
    </>
  );
}

// Year picker opened from the header eyebrow: every year that has a
// schema, newest first, the current ISO year marked. Same open/close
// mechanics as ScorePromptModal (scroll lock, Escape, back gesture via a
// pushed history entry that is popped again on any other close).
function YearSheet({ years, currentYear, viewYear, onSelect, onClose }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    window.history.pushState({ yearSheet: true }, "");
    const closedViaPopstate = { current: false };
    const handlePopState = () => { closedViaPopstate.current = true; onClose(); };
    const handleKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleKeyDown);
      if (!closedViaPopstate.current) window.history.back();
    };
    // Mount/unmount only — same reasoning as ScorePromptModal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#0007", zIndex: 100 }} />
      <div role="dialog" aria-label="Kies jaar" style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "#fff", borderRadius: "20px 20px 0 0", padding: "20px 16px 28px", zIndex: 101, maxWidth: 600, margin: "0 auto", boxShadow: "0 -10px 40px rgba(0,0,0,0.2)", fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 12, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center", marginBottom: 14 }}>Jaar</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {years.map((y) => {
            const selected = y === viewYear;
            const isCurrent = y === currentYear;
            return (
              <button
                key={y}
                onClick={() => onSelect(y)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderRadius: 12, border: selected ? `2px solid ${isCurrent ? "#f37121" : "#64748b"}` : "2px solid #eee", background: selected ? (isCurrent ? "#fff8f3" : "#f1f5f9") : "#fff", cursor: "pointer", fontSize: 16, fontWeight: selected ? 700 : 500, color: "#1a1a1a" }}
              >
                <span>{y}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: isCurrent ? "#f37121" : "#64748b" }}>{isCurrent ? "Huidig jaar" : "Archief"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function BottomSheet({ currentExercise, exercises, onSelect, onClose }) {
  const [hovered, setHovered] = useState(null);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#0005", zIndex: 100 }} />
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderRadius: "16px 16px 0 0", padding: "16px 16px 48px", zIndex: 101, maxHeight: "70vh", overflowY: "auto" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#ddd", margin: "0 auto 16px" }} />
        <div style={{ textAlign: "center", marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #eee" }}>
          <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#999", marginBottom: 4, letterSpacing: 0.5, textTransform: "uppercase" }}>Wissel voor</div>
          <div style={{ fontFamily: "'Georgia', serif", fontWeight: 700, fontSize: 16, color: "#1a1a1a" }}>{currentExercise}</div>
        </div>
        {exercises.map((name) => (
          <div
            key={name}
            onClick={() => onSelect(name)}
            onMouseEnter={() => setHovered(name)}
            onMouseLeave={() => setHovered(null)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 8px", borderBottom: "1px solid #f0f0f0", fontFamily: "sans-serif", fontSize: 14, color: "#1a1a1a", cursor: "pointer", background: hovered === name ? "#fff8f3" : "transparent", transition: "background 0.15s" }}
          >
            <span>{name}</span>
            <span style={{ color: "#f37121", fontSize: 16, fontWeight: 700 }}>→</span>
          </div>
        ))}
      </div>
    </>
  );
}

// 80x28 sparkline for the day summary over the last <=6 measured weeks:
// orange = kg, blue = estimated 1RM (weeks with usable reps only, never
// bridged over a week without). Both are % change vs. their own first
// point in the window, on one shared y-scale with a minimum 10-point span
// so a small change doesn't look steep. Today is the last point, except on
// a deload day (deload rows are never drawn).
function Sparkline({ points }) {
  const W = 80, H = 28, PAD = 3;
  if (!points.length) return null;
  const pct = (v, base) => (v / base - 1) * 100;
  const kgPct = points.map(p => pct(p.kg, points[0].kg));
  const firstE = points.find(p => p.e1rm != null)?.e1rm;
  const ePct = points.map(p => (p.e1rm != null ? pct(p.e1rm, firstE) : null));
  const all = [0, ...kgPct, ...ePct.filter(v => v != null)];
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 10) { const mid = (hi + lo) / 2; lo = mid - 5; hi = mid + 5; }
  const x = (i) => (points.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1));
  const y = (v) => H - PAD - ((v - lo) * (H - 2 * PAD)) / (hi - lo);
  // Runs of consecutive points that have an e1RM.
  const runs = [];
  ePct.forEach((v, i) => {
    if (v == null) return;
    if (i > 0 && ePct[i - 1] != null) runs[runs.length - 1].push(i);
    else runs.push([i]);
  });
  const last = points.length - 1;
  const signed = (v) => `${v >= 0 ? "+" : "−"}${formatNl(Math.abs(v), 1)}%`;
  const lastE = ePct[last] ?? [...ePct].reverse().find(v => v != null);
  const label = `Gewicht ${signed(kgPct[last])}${firstE != null ? ` en geschat 1RM ${signed(lastE)}` : ""} ten opzichte van het eerste punt in het grafiekje`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ flexShrink: 0, display: "block" }}>
      {points.length > 1 && (
        <polyline points={kgPct.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke="#fdba8c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {runs.map((run, j) => run.length > 1
        ? <polyline key={j} data-line="e1rm" points={run.map(i => `${x(i)},${y(ePct[i])}`).join(" ")} fill="none" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.8" />
        : run[0] !== last && <circle key={j} data-line="e1rm" cx={x(run[0])} cy={y(ePct[run[0]])} r="1.5" fill="#0ea5e9" />
      )}
      {/* Today's dots. When both land on the same spot (same % change),
          the blue one becomes a ring around the orange one so both stay
          visible. */}
      {ePct[last] != null && Math.abs(y(ePct[last]) - y(kgPct[last])) < 3 ? (
        <>
          <circle data-dot="e1rm" cx={x(last)} cy={y(ePct[last])} r="3.5" fill="#0ea5e9" />
          <circle data-dot="kg" cx={x(last)} cy={y(kgPct[last])} r="2" fill="#f37121" />
        </>
      ) : (
        <>
          <circle data-dot="kg" cx={x(last)} cy={y(kgPct[last])} r="2.75" fill="#f37121" />
          {ePct[last] != null && <circle data-dot="e1rm" cx={x(last)} cy={y(ePct[last])} r="2.75" fill="#0ea5e9" />}
        </>
      )}
    </svg>
  );
}

function SummaryScoreCard({ label, value, descriptions }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: "#fff8f3", border: "1px solid #f3712133", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#888", marginBottom: 4 }}>{label}</div>
      <StarRow value={value} />
      <div style={{ fontFamily: "sans-serif", fontSize: 12, color: value ? "#1a1a1a" : "#bbb", lineHeight: 1.4, marginTop: 6 }}>
        {value ? descriptions[value] : "Nog geen score"}
      </div>
    </div>
  );
}

function SummaryPill({ bg, color, children }) {
  return (
    <span style={{ background: bg, color, fontFamily: "sans-serif", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

// Read-only summary of one day (selected day in the selected week), opened
// from the tab under the selected day tile. Built entirely from state the
// app already loaded — no fetches, no writes. Visual shell mirrors
// BottomSheet; the open/close effect is ScorePromptModal's verbatim
// (scroll-lock, Escape, history entry for the back gesture) so a future
// native back-button fix covers this overlay the same way.
function DaySummarySheet({ day, weekNum, phase, datum, score, groups, finisherBlocks, onClose }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    window.history.pushState({ daySummary: true }, "");
    const closedViaPopstate = { current: false };
    const handlePopState = () => { closedViaPopstate.current = true; onClose(); };
    const handleKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleKeyDown);
      if (!closedViaPopstate.current) window.history.back();
    };
    // Mount/unmount only — same reasoning as ScorePromptModal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isTraining = day.type === "training";
  const rows = groups.flatMap(g => g.rows);
  const prCount = rows.filter(r => r.prKg || r.pr1rm).length;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#0005", zIndex: 100 }} />
      <div
        role="dialog"
        aria-label={`Samenvatting ${day.naam}`}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 600, margin: "0 auto", background: "#fff", borderRadius: "16px 16px 0 0", padding: "16px 16px calc(32px + env(safe-area-inset-bottom))", zIndex: 101, maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#ddd", margin: "0 auto 8px" }} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Sluiten"
          style={{ position: "absolute", top: 8, right: 8, width: 44, height: 44, border: "none", background: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", WebkitAppearance: "none", appearance: "none" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {/* Header */}
        <div style={{ paddingRight: 40, marginBottom: 16 }}>
          <div style={{ fontFamily: "sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#f37121", marginBottom: 4 }}>Samenvatting</div>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: "#1a1a1a", lineHeight: 1.2 }}>{day.naam}</div>
          <div style={{ fontFamily: "sans-serif", fontSize: 13, color: "#888", marginTop: 4 }}>
            {formatSummaryDate(datum, day.dag_label)} · Week {weekNum}{phase ? ` · ${phase}` : ""}
          </div>
        </div>

        {/* Scores (score_motivatie holds the energy score) */}
        <div style={{ display: "flex", gap: 8, marginBottom: isTraining ? 16 : 0 }}>
          <SummaryScoreCard label="Training" value={score?.training} descriptions={TRAINING_SCORE_DESCRIPTIONS} />
          <SummaryScoreCard label="Energie" value={score?.motivatie} descriptions={ENERGY_SCORE_DESCRIPTIONS} />
        </div>

        {isTraining && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              <SummaryPill bg="#f0f0f2" color="#3f3f46">{rows.length} oefeningen</SummaryPill>
              {prCount > 0 && <SummaryPill bg="#fff0e6" color="#f37121">{prCount} met een PR</SummaryPill>}
            </div>

            {groups.map((g) => (
              <div key={g.title} style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "sans-serif", fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#888", marginBottom: 6 }}>{g.title}</div>
                <div style={{ border: "1px solid #f0f0f0", borderRadius: 12, overflow: "hidden" }}>
                  {g.rows.map((r, i) => (
                    <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: i > 0 ? "1px solid #f0f0f0" : "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: "sans-serif", fontSize: 14, fontWeight: 700, color: "#1a1a1a", overflowWrap: "anywhere" }}>{r.name}</span>
                          {r.prKg && <Badge bg="#f37121" color="#fff">PR kg</Badge>}
                          {r.pr1rm && <Badge bg="#f37121" color="#fff">PR 1RM</Badge>}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 }}>
                          <span style={{ fontFamily: "sans-serif", fontSize: 14, color: "#1a1a1a" }}>
                            {formatNl(r.kg)} kg{r.reps != null ? ` × ${r.reps}` : ""}
                          </span>
                          <span style={{ fontFamily: "sans-serif", fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 10, whiteSpace: "nowrap", background: r.delta.up ? "#e7f5ec" : "#f0f0f2", color: r.delta.up ? "#166534" : "#3f3f46" }}>
                            {r.delta.label}
                          </span>
                        </div>
                        {(r.prevKg != null || r.e1rm != null) && (
                          <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#888", marginTop: 3 }}>
                            {[
                              r.prevKg != null ? `Vorige keer ${formatNl(r.prevKg)} kg${r.prevReps != null ? ` × ${r.prevReps}` : ""}` : null,
                              r.e1rm != null ? `1RM ≈ ${formatNl(r.e1rm, 1)} kg${r.e1rmDelta ? ` (${r.e1rmDelta})` : ""}` : null,
                            ].filter(Boolean).map((part, k) => (
                              <span key={k}>{k > 0 && " · "}<span style={{ whiteSpace: "nowrap" }}>{part}</span></span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Sparkline points={r.spark} />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Every mobility/KB/core exercise with its tick. Not done is
                muted grey, never red — skipping a finisher isn't a failure. */}
            {finisherBlocks.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "sans-serif", fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#888", marginBottom: 6 }}>Mobility, KB &amp; Core</div>
                <div style={{ border: "1px solid #f0f0f0", borderRadius: 12, padding: "2px 12px" }}>
                  {finisherBlocks.map((b, i) => (
                    <div key={b.title} data-block={b.title} style={{ padding: "8px 0", borderTop: i > 0 ? "1px solid #f0f0f0" : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 14 }} aria-hidden="true">{b.icon}</span>
                        <span style={{ fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>{b.title}</span>
                        {b.items.some(it => it.optional) && <span style={{ fontSize: 10, background: "#fff0e6", color: "#f37121", padding: "2px 7px", borderRadius: 10, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: 0.5, border: "1px solid #f37121" }}>OPTIONEEL</span>}
                        <span style={{ marginLeft: "auto", fontFamily: "sans-serif", fontSize: 12, color: "#888" }}>
                          {b.items.filter(it => it.done).length}/{b.items.length}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {b.items.map(it => (
                          <span
                            key={it.name}
                            data-done={it.done}
                            style={{ fontFamily: "sans-serif", fontSize: 12, fontWeight: it.done ? 700 : 500, padding: "4px 10px", borderRadius: 20, background: it.done ? b.light : "#f4f4f5", color: it.done ? b.accent : "#a1a1aa", border: it.optional ? "1.5px dashed #f37121" : "1.5px solid transparent", overflowWrap: "anywhere" }}
                          >
                            {it.done && <span aria-hidden="true">✓ </span>}{it.name}
                            <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{it.done ? ", gedaan" : ", niet gedaan"}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#bbb", lineHeight: 1.5 }}>
              1RM is een schatting (Epley). Rond 15 reps en hoger is hij indicatief. Grafiekje: oranje is gewicht, blauw is geschat 1RM, beide als verandering t.o.v. hun eerste punt. De stip is vandaag.
            </div>
          </>
        )}
      </div>
    </>
  );
}
