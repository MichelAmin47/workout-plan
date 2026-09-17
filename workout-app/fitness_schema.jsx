import { useState, useEffect, useRef } from "react";
import { supabase } from "./src/supabase.js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { registerPlugin } from "@capacitor/core";
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

function wKey(exercise, week) {
  return `${exercise}__${week}`;
}

function dKey(weekNum, dayId) {
  return `${weekNum}__${dayId}`;
}

// Reverse of currentWeekIndex's ISO-week math (date -> week): given a
// calendar week number and an ISO weekday (1=Mon..7=Sun, same numbering
// as schema_days.dag_volgorde), returns that day's actual calendar date
// as YYYY-MM-DD. Standard ISO-8601 anchor (week 1 is always the week
// containing 4 January), run forward from Jan 4 rather than
// currentWeekIndex's Thursday-shift trick — easier to invert cleanly.
// Assumes the target week falls in the current year: nothing in this
// app's data model disambiguates a week number across a year boundary
// (schemas has no year column) — the same assumption currentWeekIndex's
// own `new Date()` reliance already makes everywhere else. Not a new gap.
function dateForDay(calWeek, dagVolgorde) {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const jan4Dow = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Dow + 1);
  const target = new Date(week1Monday);
  target.setDate(week1Monday.getDate() + (calWeek - 1) * 7 + (dagVolgorde - 1));
  const pad = (n) => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function eKey(exercise, weekNum, dayId) {
  return `${exercise}__${weekNum}__${dayId}`;
}

function sKey(original, weekNum, dayId) {
  return `${original}__${weekNum}__${dayId}`;
}

function findPrevWeight(exerciseName, currentWeek, weights) {
  for (let w = currentWeek - 1; w >= 1; w--) {
    const entry = weights[wKey(exerciseName, w)];
    if (entry && (entry.M !== "" && entry.M != null || entry.Z !== "" && entry.Z != null)) {
      return { M: entry.M, Z: entry.Z, repsM: entry.repsM, repsZ: entry.repsZ, weekNum: w, label: `Laatste keer — Week ${w}` };
    }
  }
  return null;
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
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
          <span style={{ color: "#666" }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: "#1a1a1a" }}>{p.value} kg</span>
        </div>
      ))}
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

// Bumped from v4: v4's cached JSON carries `phase` values from the old
// hardcoded `relWeek <= 3` rule (e.g. the deload week 37 baked in as
// "Opbouw"), which would keep painting for returning/offline users until a
// fresh fetch lands. `phase` now comes from the schema_weeks table. See the
// mount effect below for the matching v4 cleanup (mirrors the v2/v3 ones).
const SCHEMA_CACHE_KEY = "cached_schema_v5";

// Fallback naam/emoji for a "special activity" day (Power Hour, Boksen) when
// an override doesn't supply its own — mirrors the isTraining/isRust
// fallback branches below.
function specialActivityDefaults(type) {
  if (type === "boksen") return { naam: "Boksen", emoji: "🥊" };
  return { naam: "Power Hour", emoji: "🕐" };
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
          // lives on `weights.reps`, fetched separately.
          reps: e.reps != null ? Number(e.reps) : null,
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
        };
      });
      allWeeks.push({ week: calWeek, label: `Week ${calWeek}`, phase, schemaId: s.id, days });
    }
  }
  return allWeeks;
}

function currentWeekIndex(allWeeks) {
  const d = new Date();
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - dow);
  const isoWeek = Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return allWeeks.findIndex(w => w.label === `Week ${isoWeek}`);
}

export default function FitnessSchema() {
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => {
    const saved = localStorage.getItem("selectedDay");
    if (saved !== null) { const n = Number(saved); if (n >= 0 && n <= 6) return n; }
    return (new Date().getDay() + 6) % 7; // Mon=0, Sun=6
  });
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
    const [{ data: schemas }, { data: schemaDays }, { data: exercises }, { data: weekOverrides }, { data: restDayGoals }, { data: schemaWeeks }] = await Promise.all([
      supabase.from("schemas").select("*").order("start_week"),
      supabase.from("schema_days").select("*"),
      supabase.from("exercises").select("*").order("volgorde"),
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
    const [wRes, cdRes, ceRes, swRes, dsRes] = await Promise.all([
      supabase.from("weights").select("*"),
      supabase.from("completed_days").select("*"),
      supabase.from("completed_exercises").select("*"),
      supabase.from("exercise_swaps").select("*"),
      supabase.from("day_scores").select("*"),
    ]);
    if (wRes.data) {
      const map = {};
      for (const row of wRes.data) {
        const k = wKey(row.exercise, row.week);
        if (!map[k]) map[k] = { M: "", Z: "" };
        map[k][row.person] = row.weight ?? "";
        map[k][`reps${row.person}`] = row.reps ?? "";
      }
      setWeights(map);
    }
    if (cdRes.data) setCompletedDays(new Set(cdRes.data.map(r => dKey(r.week, r.day))));
    if (ceRes.data) setCompletedExercises(new Set(ceRes.data.map(r => eKey(r.exercise, r.week, r.day))));
    if (swRes.data) {
      const map = {};
      for (const row of swRes.data) map[sKey(row.original_exercise, row.week, row.day)] = row.new_exercise;
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

    let hasCache = false;
    try {
      const raw = localStorage.getItem(SCHEMA_CACHE_KEY);
      if (raw) {
        const { weeks, restDayGoals } = JSON.parse(raw);
        if (weeks?.length) {
          setSchema({ weeks, restDayGoals: restDayGoals || [] });
          const idx = currentWeekIndex(weeks);
          if (idx >= 0) setSelectedWeek(idx);
          setSchemaLoading(false);
          hasCache = true;
        }
      }
    } catch {}

    fetchSchemaData()
      .then(({ weeks: allWeeks, restDayGoals }) => {
        localStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify({ weeks: allWeeks, restDayGoals }));
        setSchema({ weeks: allWeeks, restDayGoals });
        if (!hasCache) {
          const idx = currentWeekIndex(allWeeks);
          if (idx >= 0) setSelectedWeek(idx);
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

  const todayDayIdx = (new Date().getDay() + 6) % 7;
  const week = schema.weeks[selectedWeek];
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
  const prescribedReps = {};
  for (const w of schema.weeks) {
    for (const d of w.days) {
      if (d.type !== "training") continue;
      for (const ex of [d.barbell, ...d.spiergroep, ...d.kettlebell, ...d.core]) {
        if (ex?.name && ex.reps != null) prescribedReps[wKey(ex.name, w.week)] = ex.reps;
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
  const effectiveReps = (exercise, weekNum, person) => {
    const val = weights[wKey(exercise, weekNum)]?.[`reps${person}`];
    if (val !== "" && val != null) return val;
    const prescribed = prescribedReps[wKey(exercise, weekNum)];
    return prescribed != null ? prescribed : "";
  };

  // An empty weight means "clear this measurement" — deletes the row
  // outright, rather than the old silent no-op (which only ever cleared
  // local state, never the database; see CLAUDE.md "Reps logging" for the
  // history). No saved-indicator flash for a delete: that checkmark means
  // "your number was saved," and there's no number to confirm here.
  const saveMeasurement = (exercise, weekNum, person, weightValue, repsValue) => {
    if (weightValue === "" || weightValue === null || weightValue === undefined) {
      supabase.from("weights")
        .delete()
        .eq("exercise", exercise)
        .eq("week", weekNum)
        .eq("person", person)
        .then(({ error }) => { if (error) console.error("[saveMeasurement delete error]", error); });
      return;
    }
    const reps = (repsValue === "" || repsValue === null || repsValue === undefined) ? null : Number(repsValue);
    supabase.from("weights").upsert(
      { exercise, week: weekNum, person, weight: Number(weightValue), reps },
      { onConflict: "exercise,week,person" }
    ).then(({ error }) => {
      if (error) { console.error("[saveMeasurement error]", error); return; }
      const indicatorKey = `${exercise}__${weekNum}__${person}`;
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
  const flushSave = (exerciseName, weekNum) => {
    const k = wKey(exerciseName, weekNum);
    const w = weights[k] || {};
    const pending = {};
    ["M", "Z"].forEach((person) => {
      const timerKey = `${exerciseName}__${weekNum}__${person}`;
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
      const reps = isClearing ? "" : effectiveReps(exerciseName, weekNum, person);
      stateUpdate[`reps${person}`] = reps;
      saveMeasurement(exerciseName, weekNum, person, value, reps);
    });
    setWeights((prev) => ({
      ...prev,
      [k]: { ...(prev[k] || { M: "", Z: "" }), ...stateUpdate },
    }));
  };

  const handleExerciseClick = (name) => {
    const weekNum = week.week;
    if (expandedExercise && expandedExercise !== name) {
      flushSave(expandedExercise, weekNum);
    }
    setExpandedExercise((prev) => (prev === name ? null : name));
  };

  const handleWeightChange = (exercise, weekNum, person, value) => {
    const k = wKey(exercise, weekNum);
    const isClearing = value === "" || value === null || value === undefined;
    // Computed once, used for both the local mirror and the save below, so
    // the two can never disagree — this is what was missing: the save used
    // to include the effective (possibly prefilled) reps value while the
    // local state update didn't, leaving weights[k].reps<person> stale
    // until the next full refetch. Clearing is its own case: the row is
    // about to be deleted entirely, so reps resets to empty rather than
    // falling back to the prescribed number — there is no row left for
    // that number to describe.
    const reps = isClearing ? "" : effectiveReps(exercise, weekNum, person);
    setWeights((prev) => ({
      ...prev,
      [k]: { ...(prev[k] || { M: "", Z: "" }), [person]: value, [`reps${person}`]: reps },
    }));
    const timerKey = `${exercise}__${weekNum}__${person}`;
    clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = setTimeout(() => {
      delete saveTimers.current[timerKey];
      saveMeasurement(exercise, weekNum, person, value, reps);
    }, 500);
  };

  // Reps-only edit (± buttons). Gated on weight already being present —
  // same rule as weight itself: no weight yet means nothing to save, the
  // tap just updates the local display. Once a weight exists, this reuses
  // the same debounce timer key as handleWeightChange, so whichever call
  // (weight or reps) fires last wins — correct, since it always captures
  // the freshest value of both at the moment it's scheduled.
  const handleRepsChange = (exercise, weekNum, person, value) => {
    const k = wKey(exercise, weekNum);
    const field = `reps${person}`;
    setWeights((prev) => ({
      ...prev,
      [k]: { ...(prev[k] || { M: "", Z: "" }), [field]: value },
    }));
    const weightValue = weights[k]?.[person];
    if (weightValue === "" || weightValue == null) return;
    const timerKey = `${exercise}__${weekNum}__${person}`;
    clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = setTimeout(() => {
      delete saveTimers.current[timerKey];
      saveMeasurement(exercise, weekNum, person, weightValue, value);
    }, 500);
  };

  const closeAndSave = () => {
    if (expandedExercise) {
      flushSave(expandedExercise, week.week);
      setExpandedExercise(null);
    }
  };

  const saveSwap = (original, newExercise, weekNum, dayId) => {
    const k = sKey(original, weekNum, dayId);
    setSwaps((prev) => ({ ...prev, [k]: newExercise }));
    supabase.from("exercise_swaps").upsert(
      { original_exercise: original, new_exercise: newExercise, week: weekNum, day: dayId },
      { onConflict: "original_exercise,week,day" }
    ).then(({ error }) => { if (error) console.error("[saveSwap error]", error); });
    setSwapModal(null);
  };

  const revertSwap = (original, weekNum, dayId) => {
    const k = sKey(original, weekNum, dayId);
    setSwaps((prev) => { const next = { ...prev }; delete next[k]; return next; });
    supabase.from("exercise_swaps")
      .delete()
      .eq("original_exercise", original)
      .eq("week", weekNum)
      .eq("day", dayId)
      .then(({ error }) => { if (error) console.error("[revertSwap error]", error); });
  };

  const saveScore = (datum, training, motivatie) => {
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
    const t = e.touches?.[0];
    if (t) bbStartPos.current = { x: t.clientX, y: t.clientY };
    bbTimerRef.current = setTimeout(() => {
      bbLongPressed.current = true;
      triggerImpact();
      toggleExerciseCompletion(day.barbell.name, week.week, day.dag_nummer);
    }, 1000);
  };
  const bbCancelPress = () => clearTimeout(bbTimerRef.current);
  const bbHandleTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - bbStartPos.current.x) > 10 || Math.abs(t.clientY - bbStartPos.current.y) > 10) bbCancelPress();
  };

  const toggleDayCompletion = (weekNum, dayId) => {
    const k = dKey(weekNum, dayId);
    if (completedDays.has(k)) {
      setCompletedDays((prev) => { const s = new Set(prev); s.delete(k); return s; });
      supabase.from("completed_days").delete().eq("week", weekNum).eq("day", dayId).then();
    } else {
      setCompletedDays((prev) => new Set([...prev, k]));
      supabase.from("completed_days").insert({ week: weekNum, day: dayId }).then();
    }
  };

  const toggleExerciseCompletion = (exercise, weekNum, dayId) => {
    const k = eKey(exercise, weekNum, dayId);
    if (completedExercises.has(k)) {
      setCompletedExercises((prev) => { const s = new Set(prev); s.delete(k); return s; });
      supabase.from("completed_exercises").delete().eq("exercise", exercise).eq("week", weekNum).eq("day", dayId).then();
    } else {
      setCompletedExercises((prev) => new Set([...prev, k]));
      supabase.from("completed_exercises").insert({ exercise, week: weekNum, day: dayId }).then();
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

      {/* Header */}
      <div style={{ background: "#f37121", color: "#fff", padding: "24px 20px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: "#888", marginBottom: 6 }}>Basic Fit · Gevorderd</div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>7-Weken Trainingsschema</h1>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <span style={{ background: phase.bg, color: phase.text, fontSize: 14, fontWeight: 700, letterSpacing: 0.3, padding: "5px 16px", borderRadius: 20, fontFamily: "sans-serif" }}>
            {week.phase}
          </span>
        </div>
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
          {schema.weeks.map((w, i) => (
            <button
              key={i}
              ref={el => weekButtonRefs.current[i] = el}
              onClick={() => { closeAndSave(); setSelectedWeek(i); }}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontFamily: "sans-serif",
                fontSize: 13,
                fontWeight: selectedWeek === i ? 700 : 400,
                background: selectedWeek === i ? "#f37121" : "#f0f0f0",
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
            isToday={todayDayIdx === i}
            isCompleted={
              d.type === "training"
                ? (d.dag_nummer != null && completedDays.has(dKey(week.week, d.dag_nummer)))
                : (d.type === "power_hour" || d.type === "boksen") && Boolean(dayScores[dateForDay(week.week, d.dag_volgorde)])
            }
            onSelect={() => { closeAndSave(); setSelectedDay(i); }}
            onLongPress={() => {
              const datum = dateForDay(week.week, d.dag_volgorde);
              if (d.type === "training" && d.dag_nummer != null) {
                const willComplete = !completedDays.has(dKey(week.week, d.dag_nummer));
                toggleDayCompletion(week.week, d.dag_nummer);
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
          const datum = dateForDay(week.week, day.dag_volgorde);
          const onOpenPrompt = () => setScorePrompt({ datum, dayLabel: day.naam });
          return day.type === "power_hour"
            ? <PowerHourCard day={day} score={dayScores[datum]} onOpenPrompt={onOpenPrompt} />
            : <BoksenCard day={day} score={dayScores[datum]} onOpenPrompt={onOpenPrompt} />;
        })()}

        {day.type === "training" && (<>

        {/* Barbell */}
        {week.week >= 31 ? (() => {
          const superset1 = [
            { ...day.barbell, categorie: "barbell" },
            ...day.spiergroep.filter(ex => ex.note === "Superset 1"),
          ];
          const superset2 = day.spiergroep.filter(ex => ex.note === "Superset 2");
          const los = day.spiergroep.filter(ex => !ex.note || (ex.note !== "Superset 1" && ex.note !== "Superset 2"));
          const ssProps = {
            expandedExercise,
            onToggle: handleExerciseClick,
            weekNum: week.week,
            dayId: day.dag_nummer,
            weights,
            savedIndicators,
            completedExercises,
            onWeightChange: (name, wk, person, val) => handleWeightChange(name, wk, person, val),
            onRepsChange: (name, wk, person, val) => handleRepsChange(name, wk, person, val),
            getEffectiveReps: effectiveReps,
            toggleCompletion: toggleExerciseCompletion,
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
                  const k = wKey(ex.name, week.week);
                  const w = weights[k] || { M: "", Z: "" };
                  const prevResult = findPrevWeight(ex.name, week.week, weights);
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
                      onWeightChange={(person, value) => handleWeightChange(ex.name, week.week, person, value)}
                      repsM={effectiveReps(ex.name, week.week, "M")}
                      repsZ={effectiveReps(ex.name, week.week, "Z")}
                      onRepsChange={(person, value) => handleRepsChange(ex.name, week.week, person, value)}
                      prevWeightM={prevW.M}
                      prevWeightZ={prevW.Z}
                      prevRepsM={prevW.repsM}
                      prevRepsZ={prevW.repsZ}
                      prevWeekLabel={prevResult?.label}
                      savedM={!!savedIndicators[`${ex.name}__${week.week}__M`]}
                      savedZ={!!savedIndicators[`${ex.name}__${week.week}__Z`]}
                      completed={completedExercises.has(eKey(ex.name, week.week, day.dag_nummer))}
                      onLongPress={() => toggleExerciseCompletion(ex.name, week.week, day.dag_nummer)}
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
            const k = wKey(day.barbell.name, week.week);
            const w = weights[k] || { M: "", Z: "" };
            const prevResult = findPrevWeight(day.barbell.name, week.week, weights);
            const prevW = prevResult || { M: null, Z: null };
            const hasPrev = prevW.M !== "" && prevW.M != null || prevW.Z !== "" && prevW.Z != null;
            const barbellCompleted = completedExercises.has(eKey(day.barbell.name, week.week, day.dag_nummer));
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
                      {day.barbell.note && <div style={{ color: "#ffcfa0", fontSize: 12, fontFamily: "sans-serif", marginTop: 2 }}>{day.barbell.note}</div>}
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
                        const currentReps = effectiveReps(day.barbell.name, week.week, person);
                        const currentRepsNum = currentReps === "" || currentReps == null ? null : Number(currentReps);
                        return (
                        <div key={person} style={{ display: person === "Z" ? "none" : "flex", alignItems: "center", gap: 6 }}>
                          <label style={{ fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#888" }}>{person}:</label>
                          <input
                            type="number"
                            step="any"
                            min={0}
                            value={person === "M" ? w.M : w.Z}
                            onChange={(e) => handleWeightChange(day.barbell.name, week.week, person, e.target.value)}
                            placeholder="kg"
                            style={{ width: 70, padding: "5px 8px", borderRadius: 6, border: "1px solid #e0c8b8", fontFamily: "sans-serif", fontSize: 13, outline: "none", background: "#fff" }}
                          />
                          <span style={{ display: "inline-flex", width: 14, justifyContent: "center", color: "#16a34a", fontSize: 14, fontWeight: 700, lineHeight: 1, visibility: savedIndicators[`${day.barbell.name}__${week.week}__${person}`] ? "visible" : "hidden" }}>✓</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                            <button
                              type="button"
                              disabled={currentRepsNum == null}
                              onClick={() => handleRepsChange(day.barbell.name, week.week, person, String(Math.max(1, currentRepsNum - 1)))}
                              style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: currentRepsNum == null ? "default" : "pointer", opacity: currentRepsNum == null ? 0.4 : 1 }}
                            >−</button>
                            <span style={{ minWidth: 18, textAlign: "center", fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#1a1a1a", userSelect: "none" }}>
                              {currentRepsNum ?? "–"}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRepsChange(day.barbell.name, week.week, person, String(Math.min(50, (currentRepsNum ?? 0) + 1)))}
                              style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: "pointer" }}
                            >+</button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    {hasPrev && (
                      <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#bbb" }}>
                        {prevResult?.label}  <span style={{ color: "#1a1a1a" }}>M:</span> <span style={{ color: "#1a1a1a" }}>{prevW.M !== "" && prevW.M != null ? `${prevW.M}kg${prevW.repsM !== "" && prevW.repsM != null ? ` × ${prevW.repsM}` : ''}` : "—"}</span><span style={{ display: "none" }}> / <span style={{ color: "#1a1a1a" }}>Z:</span> <span style={{ color: "#1a1a1a" }}>{prevW.Z !== "" && prevW.Z != null ? `${prevW.Z}kg${prevW.repsZ !== "" && prevW.repsZ != null ? ` × ${prevW.repsZ}` : ''}` : "—"}</span></span>
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
            const k = wKey(ex.name, week.week);
            const w = weights[k] || { M: "", Z: "" };
            const prevResult = findPrevWeight(ex.name, week.week, weights);
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
                onWeightChange={(person, value) => handleWeightChange(ex.name, week.week, person, value)}
                repsM={effectiveReps(ex.name, week.week, "M")}
                repsZ={effectiveReps(ex.name, week.week, "Z")}
                onRepsChange={(person, value) => handleRepsChange(ex.name, week.week, person, value)}
                prevWeightM={prevW.M}
                prevWeightZ={prevW.Z}
                prevRepsM={prevW.repsM}
                prevRepsZ={prevW.repsZ}
                prevWeekLabel={prevResult?.label}
                savedM={!!savedIndicators[`${ex.name}__${week.week}__M`]}
                savedZ={!!savedIndicators[`${ex.name}__${week.week}__Z`]}
                completed={completedExercises.has(eKey(ex.name, week.week, day.dag_nummer))}
                onLongPress={() => toggleExerciseCompletion(ex.name, week.week, day.dag_nummer)}
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
                  const sk = sKey(ex.name, week.week, day.dag_nummer);
                  const swappedName = swaps[sk];
                  const displayName = swappedName || ex.name;
                  const k = wKey(displayName, week.week);
                  const w = weights[k] || { M: "", Z: "" };
                  const prevResult = findPrevWeight(displayName, week.week, weights);
                  const prevW = prevResult || { M: null, Z: null };
                  return (
                    <SwipeableRow
                      key={i}
                      onSwipeRight={() => { closeAndSave(); setSwapModal({ original: ex.name, week: week.week, day: day.dag_nummer, options: KB_EXERCISES }); }}
                      onSwipeLeft={swappedName ? () => revertSwap(ex.name, week.week, day.dag_nummer) : undefined}
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
                        onWeightChange={(person, value) => handleWeightChange(displayName, week.week, person, value)}
                        repsM={effectiveReps(displayName, week.week, "M")}
                        repsZ={effectiveReps(displayName, week.week, "Z")}
                        onRepsChange={(person, value) => handleRepsChange(displayName, week.week, person, value)}
                        prevWeightM={prevW.M}
                        prevWeightZ={prevW.Z}
                        prevRepsM={prevW.repsM}
                        prevRepsZ={prevW.repsZ}
                        prevWeekLabel={prevResult?.label}
                        savedM={!!savedIndicators[`${displayName}__${week.week}__M`]}
                        savedZ={!!savedIndicators[`${displayName}__${week.week}__Z`]}
                        completed={completedExercises.has(eKey(displayName, week.week, day.dag_nummer))}
                        onLongPress={() => toggleExerciseCompletion(displayName, week.week, day.dag_nummer)}
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
            const sk = sKey(ex.name, week.week, day.dag_nummer);
            const swappedName = swaps[sk];
            const displayName = swappedName || ex.name;
            return (
              <SwipeableRow
                key={i}
                onSwipeRight={() => { closeAndSave(); setSwapModal({ original: ex.name, week: week.week, day: day.dag_nummer, options: CORE_EXERCISES }); }}
                onSwipeLeft={swappedName ? () => revertSwap(ex.name, week.week, day.dag_nummer) : undefined}
              >
                <ExRow
                  num={i + 1}
                  name={displayName}
                  sets={ex.sets}
                  note={ex.note}
                  accent="#7c3aed"
                  light="#ede9fe"
                  optional={ex.optional}
                  completed={completedExercises.has(eKey(displayName, week.week, day.dag_nummer))}
                  onLongPress={() => toggleExerciseCompletion(displayName, week.week, day.dag_nummer)}
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
          const chartData = schema.weeks.map(w => {
            const mVal = weights[wKey(selEx, w.week)]?.M;
            const zVal = weights[wKey(selEx, w.week)]?.Z;
            return {
              week: `W${w.label.replace("Week ", "")}`,
              M: mVal !== "" && mVal != null ? Number(mVal) : null,
              Z: zVal !== "" && zVal != null ? Number(zVal) : null,
            };
          });
          const mVals = chartData.map(d => d.M).filter(v => v != null);
          const zVals = chartData.map(d => d.Z).filter(v => v != null);
          const mMax = mVals.length ? Math.max(...mVals) : null;
          const zMax = zVals.length ? Math.max(...zVals) : null;
          const mGain = mVals.length >= 2 ? mVals[mVals.length - 1] - mVals[0] : null;
          const zGain = zVals.length >= 2 ? zVals[zVals.length - 1] - zVals[0] : null;
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
                        <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>{mGain != null ? `+${mGain} kg` : "—"}</div>
                      </div>
                      <div style={{ flex: 1, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>Z — Max</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#0ea5e9" }}>{zMax != null ? `${zMax} kg` : "—"}</div>
                        <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>{zGain != null ? `+${zGain} kg` : "—"}</div>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#888" }} />
                        <YAxis tick={{ fontSize: 12, fill: "#888" }} unit=" kg" />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} formatter={v => <span style={{ color: "#555", fontWeight: 600 }}>{v}</span>} />
                        <Line type="monotone" dataKey="M" stroke="#f37121" strokeWidth={3} dot={{ fill: "#f37121", strokeWidth: 2, r: 5 }} activeDot={{ r: 7 }} connectNulls />
                        <Line type="monotone" dataKey="Z" stroke="#0ea5e9" strokeWidth={3} dot={{ fill: "#0ea5e9", strokeWidth: 2, r: 5 }} activeDot={{ r: 7 }} connectNulls />
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

function ExRow({ num, name, sets, note, accent, light, optional, expanded, onToggle, weightM, weightZ, onWeightChange, repsM, repsZ, onRepsChange, prevWeightM, prevWeightZ, prevRepsM, prevRepsZ, prevWeekLabel, savedM, savedZ, completed, onLongPress, swapped, originalName, hiitInterval }) {
  const isClickable = !!onToggle;
  const hasPrev = (prevWeightM !== "" && prevWeightM != null) || (prevWeightZ !== "" && prevWeightZ != null);
  return (
    <div style={{ borderRadius: 8, overflow: "hidden", border: optional ? "1.5px dashed #f37121" : "none" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, background: hexA(light, 0.33), padding: "10px 12px", cursor: isClickable ? "pointer" : "default" }}
        onClick={onToggle}
      >
        <ExCircle num={num} completed={completed} accent={accent} optional={optional} onLongPress={onLongPress} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{name}</span>
            {optional && <span style={{ fontSize: 10, background: "#fff0e6", color: "#f37121", padding: "2px 7px", borderRadius: 10, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: 0.5, border: "1px solid #f37121" }}>OPTIONEEL</span>}
            {swapped && <span style={{ fontSize: 10, background: "#fff0e6", color: "#f37121", padding: "2px 7px", borderRadius: 10, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: 0.5, border: "1px solid #f37121" }}>GEWIJZIGD</span>}
          </div>
          {note && <div style={{ fontSize: 11, color: optional ? "#f37121" : accent, fontFamily: "sans-serif", marginTop: 1 }}>{note}</div>}
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
          <div style={{ background: optional ? "#fff0e6" : accent, color: optional ? "#f37121" : "#fff", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap", border: optional ? "1px solid #f37121" : "none" }}>
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
                <label style={{ fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#888" }}>{person}:</label>
                <input
                  type="number"
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
                    disabled={currentRepsNum == null}
                    onClick={() => onRepsChange(person, String(Math.max(1, currentRepsNum - 1)))}
                    style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: currentRepsNum == null ? "default" : "pointer", opacity: currentRepsNum == null ? 0.4 : 1 }}
                  >−</button>
                  <span style={{ minWidth: 18, textAlign: "center", fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#1a1a1a", userSelect: "none" }}>
                    {currentRepsNum ?? "–"}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRepsChange(person, String(Math.min(50, (currentRepsNum ?? 0) + 1)))}
                    style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: "pointer" }}
                  >+</button>
                </div>
              </div>
              );
            })}
          </div>
          {hasPrev && (
            <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#bbb" }}>
              {prevWeekLabel || "Vorige week"}  <span style={{ color: "#1a1a1a" }}>M:</span> <span style={{ color: "#1a1a1a" }}>{prevWeightM !== "" && prevWeightM != null ? `${prevWeightM}kg${prevRepsM !== "" && prevRepsM != null ? ` × ${prevRepsM}` : ''}` : "—"}</span><span style={{ display: "none" }}> / <span style={{ color: "#1a1a1a" }}>Z:</span> <span style={{ color: "#1a1a1a" }}>{prevWeightZ !== "" && prevWeightZ != null ? `${prevWeightZ}kg${prevRepsZ !== "" && prevRepsZ != null ? ` × ${prevRepsZ}` : ''}` : "—"}</span></span>
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
  return (
    <span style={{ fontSize: 9, background: c.bg, color: "#fff", padding: "2px 6px", borderRadius: 10, fontFamily: "sans-serif", fontWeight: 700, flexShrink: 0 }}>
      {c.label}
    </span>
  );
}

function SupersetBlock({ title, exercises, accentColor, lightColor, expandedExercise, onToggle, weekNum, dayId, weights, savedIndicators, completedExercises, onWeightChange, onRepsChange, getEffectiveReps, toggleCompletion }) {
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
          const k = wKey(ex.name, weekNum);
          const w = weights[k] || { M: "", Z: "" };
          const prevResult = findPrevWeight(ex.name, weekNum, weights);
          const prevW = prevResult || { M: null, Z: null };
          const hasPrev = (prevW.M !== "" && prevW.M != null) || (prevW.Z !== "" && prevW.Z != null);
          const isExpanded = expandedExercise === ex.name;
          const isCompleted = completedExercises.has(eKey(ex.name, weekNum, dayId));
          return (
            <div key={i}>
              <div
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: hexA(lightColor, 0.33), cursor: "pointer" }}
                onClick={() => onToggle(ex.name)}
              >
                <ExCircle num={i + 1} completed={isCompleted} accent={accentColor} onLongPress={() => toggleCompletion(ex.name, weekNum, dayId)} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", fontFamily: "sans-serif" }}>{ex.name}</span>
                    <TypeBadge type={type} />
                  </div>
                  {ex.weight_hint && <div style={{ fontSize: 11, color: accentColor, fontFamily: "sans-serif", marginTop: 1 }}>{ex.weight_hint}</div>}
                </div>
                <div style={{ background: accentColor, color: "#fff", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {ex.sets}
                </div>
              </div>
              {isExpanded && (() => {
                const currentReps = getEffectiveReps(ex.name, weekNum, "M");
                const currentRepsNum = currentReps === "" || currentReps == null ? null : Number(currentReps);
                return (
                <div style={{ background: "#fff8f5", borderTop: "1px solid #f0d0b8", padding: "10px 12px 10px 52px", display: "flex", flexDirection: "column", gap: 8 }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <label style={{ fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#888" }}>M:</label>
                    <input type="number" step="any" min={0} value={w.M} onChange={e => onWeightChange(ex.name, weekNum, "M", e.target.value)} placeholder="kg" style={{ width: 70, padding: "5px 8px", borderRadius: 6, border: "1px solid #e0c8b8", fontFamily: "sans-serif", fontSize: 13, outline: "none", background: "#fff" }} />
                    <span style={{ display: "inline-flex", width: 14, justifyContent: "center", color: "#16a34a", fontSize: 14, fontWeight: 700, visibility: savedIndicators[`${ex.name}__${weekNum}__M`] ? "visible" : "hidden" }}>✓</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                      <button
                        type="button"
                        disabled={currentRepsNum == null}
                        onClick={() => onRepsChange(ex.name, weekNum, "M", String(Math.max(1, currentRepsNum - 1)))}
                        style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: currentRepsNum == null ? "default" : "pointer", opacity: currentRepsNum == null ? 0.4 : 1 }}
                      >−</button>
                      <span style={{ minWidth: 18, textAlign: "center", fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#1a1a1a", userSelect: "none" }}>
                        {currentRepsNum ?? "–"}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRepsChange(ex.name, weekNum, "M", String(Math.min(50, (currentRepsNum ?? 0) + 1)))}
                        style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid #e0c8b8", background: "#fff", color: "#888", fontSize: 14, fontWeight: 700, lineHeight: 1, cursor: "pointer" }}
                      >+</button>
                    </div>
                  </div>
                  {hasPrev && (
                    <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#bbb" }}>
                      {prevResult?.label} <span style={{ color: "#1a1a1a" }}>M:</span> <span style={{ color: "#1a1a1a" }}>{prevW.M !== "" && prevW.M != null ? `${prevW.M}kg${prevW.repsM !== "" && prevW.repsM != null ? ` × ${prevW.repsM}` : ''}` : "—"}</span>
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
    const t = e.touches?.[0];
    if (t) startPos.current = { x: t.clientX, y: t.clientY };
    timer.current = setTimeout(() => {
      longPressed.current = true;
      triggerImpact();
      if (onLongPress) onLongPress();
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
      <button
        onClick={onOpenPrompt}
        style={{ background: "#ea580c", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", cursor: "pointer" }}
      >
        {score ? "Score aanpassen" : "Geef een score"}
      </button>
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

function WeekDayTile({ day, isSelected, isToday, isCompleted, onSelect, onLongPress }) {
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
    if (isRust) return;
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
