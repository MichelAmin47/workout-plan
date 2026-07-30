# CLAUDE.md (workout-app)

This file provides guidance to Claude Code (claude.ai/code) when working with code in `workout-app/`. See the root `CLAUDE.md` for the monorepo layout and how this app relates to `voeding-app` / `shared`.

## Project Overview

A Vite + React app that renders a 14-week gym training plan across two schemas (schema 1: calWeeks 23–30, schema 2: calWeeks 31–36). The component (`fitness_schema.jsx`) lives at this app's root and is self-contained — all styling is inline, no CSS file.

## Dev server

Run from inside `workout-app/`:

```bash
npm run dev      # http://localhost:5173
npm run build
npm run preview
```

Requires Node.js 20.19+ or 22.12+. The project was developed on Node 22.22.3 (nvm).

## Android build

The production app (`main` branch) points its WebView at `https://workout-plan-taupe.vercel.app` via the `server.url` in `capacitor.config.ts` (repo root). **JS/UI changes pushed to `main` are picked up automatically after a pull-to-refresh in the running app — no APK rebuild required.**

`cap sync` + APK rebuild is only needed when native Android files change (e.g. `capacitor.config.ts` itself, Java plugins, `AndroidManifest.xml`, `build.gradle`). `capacitor.config.ts` and `android/` both live at the **repo root** (one level up from this app), so run this from the repo root, not from `workout-app/`:

```bash
npm run build --prefix workout-app && npx cap sync android
```

`cap sync` copies `workout-app/dist/` (per `webDir: 'workout-app/dist'` in the root `capacitor.config.ts`) into `android/app/src/main/assets/public/` and updates `android/app/src/main/assets/capacitor.config.json` (gitignored). After syncing native changes, rebuild and install the APK in Android Studio.

**Important:** `android/app/src/main/res/values/strings.xml` holds the launcher app name (`app_name`) and package name. It is tracked in git but NOT updated by `cap sync` — if `appName` or `appId` changes in `capacitor.config.ts`, update `strings.xml` manually too.

## File layout

Paths below are relative to `workout-app/` unless noted otherwise:

```
fitness_schema.jsx        ← the component (edit this for data/UI changes)
index.html                ← single page shell; mounts /src/main.jsx, favicon from /public
src/
  main.jsx                ← React root; wraps <App /> in StrictMode, mounts to #root
  App.jsx                 ← one-liner wrapper: `return <FitnessSchema />`
  supabase.js             ← Supabase client (createClient with env vars)
  index.css               ← minimal reset only (body margin: 0, #root min-height: 100svh)
  App.css                 ← unused (default Vite scaffold leftover, safe to ignore)
  assets/
    react.svg / vite.svg  ← unused scaffold assets
    hero.png              ← unused
public/
  favicon.svg             ← orange dumbbell icon shown in browser tab
  icons.svg               ← unused
  boxing-bell.mp3         ← bell sound played natively by TimerPlugin on Android
.env                      ← not committed; holds VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
vite.config.js            ← minimal: only @vitejs/plugin-react, no aliases or custom config
eslint.config.js          ← standard Vite scaffold ESLint config (react-hooks, react-refresh)
package.json              ← scripts: dev / build / preview / lint; @capacitor/core + @capacitor/haptics only (cli/android tooling lives in the root package.json)
sql/                      ← migration.sql, migration_week31-36.sql — workout schema/exercise migrations (reference only, not auto-applied)
knowledge_docs/           ← workout-app-specific docs (e.g. pre_merge_testlijst_bijgewerkt.md); project-wide docs live in the root knowledge_docs/ instead
timer_mock.jsx            ← standalone timer UI mock, not imported by the app
screenshots/              ← reference screenshots from past feature work

../ (repo root)
  capacitor.config.ts     ← webDir: 'workout-app/dist'; server.url points at production
  android/                ← Capacitor Android project (generated, do not edit build files)
    app/src/main/
      java/com/workout/plan/
        MainActivity.java              ← registers BatteryOptimizationPlugin + TimerPlugin
        TimerPlugin.java               ← thin Capacitor wrapper; binds to TimerService
        TimerService.java              ← owns the countdown, FGS, notification + action buttons
        TimerActionReceiver.java       ← BroadcastReceiver for lock-screen ↺/✕ button taps
        BatteryOptimizationPlugin.java ← requests battery optimization exemption
      res/
        drawable/ic_timer_notification.xml ← flat monochrome notification icon (required)
        raw/boxing_bell.mp3       ← bell audio used by TimerPlugin.playBell()
      AndroidManifest.xml         ← permissions + foreground service declaration
      res/values/strings.xml      ← app_name + package_name (tracked in git; update manually if appId/appName changes)
```

## Dependency versions (as of last update)

- React 19, react-dom 19
- Vite 8, @vitejs/plugin-react 6
- @supabase/supabase-js (latest) — weight persistence
- recharts (latest) — progress chart
- @capacitor/core, @capacitor/haptics@8.0.2 — `Haptics.impact()` for long-press feedback (this app's runtime deps only; `@capacitor/cli` + `@capacitor/android` live in the root `package.json` for native tooling)
- vite-plugin-pwa@1.3.0 — service worker for offline app-shell caching
- No routing, no state management, no CSS framework

## Environment variables

Required in `workout-app/.env` (not committed):
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Vercel deployment

Production URL: `https://workout-plan-taupe.vercel.app` (stable Vercel alias, never rotates).
The `main` branch auto-deploys to production. The `server.url` in the root `capacitor.config.ts` points here so the Android WebView always loads the latest production JS.

**Required Vercel dashboard settings** (Settings → for the Production environment):
- **Root Directory** → `workout-app` (set since the monorepo restructure — the app no longer lives at the repo root; no `vercel.json` exists, so this lives only in the dashboard. Confirmed working: live-update via pull-to-refresh tested successfully against this setting)
- Deployment Protection → **Disabled** (otherwise the Android WebView gets an auth challenge instead of the app)
- Vercel Toolbar → **Disabled** (injected toolbar breaks the mobile WebView layout)

## Component architecture

Everything lives in `fitness_schema.jsx`:

- **`schema`** — dynamic object built from Supabase (`schemas`, `schema_days`, `exercises` tables). Cached in `localStorage["cached_schema_v2"]` for offline use. Two phases: `"Opbouw"` (weeks 1–3) and `"Nieuwe Prikkel"` (weeks 4+). Built by `buildWeeks()` at module scope.
- **`buildWeeks(schemas, schemaDays, exercises, weekOverrides = [])`** — module-scope pure function. Transforms raw Supabase rows into week/day structures. Iterates all schemas in one pass, producing a flat array of all calendar weeks across both schemas. Each week object includes `{ week, label, phase, schemaId, days }`. Each week has 7 days sorted by `dag_volgorde`. Training days have `barbell/spiergroep/kettlebell/core`; non-training days have only metadata (`type`, `dag_label`, `emoji`, `naam`). `schemaId` is used downstream to filter `restDayGoals` per schema.
- **`FitnessSchema`** (default export) — top-level component. Manages state: `selectedWeek`, `selectedDay` (index 0–6 into `week.days`, persisted to `localStorage["selectedDay"]`), `schema` (object `{ weeks, restDayGoals }` — the full built schema plus rest-day goal rows from Supabase, cached in `localStorage["cached_schema_v2"]`), `schemaGen` (integer counter incremented on every successful schema refresh — used as part of `WeekDayTile` keys to force remount after pull-to-refresh), `weights`, `expandedExercise`, `completedDays`, `completedExercises`, `swaps`, `swapModal`, `activeTimer`, `activeSection`, `timerLocked`, `schemaOffline` (bool — true when Supabase unreachable and serving from cache), `refreshing` (bool — pull-to-refresh in progress), `pullY` (raw px pulled). Also: `progressieOpen`, `progressieExercise`. Calls `useTimer`. The app header shows title + phase badge. Offline shows a gray banner below the header.
- **`SupersetBlock`** — renders one superset group (e.g. "SUPERSET 1") inside the Supersets section (schema 2 only, `week.week >= 31`). Shows a colored pill header, a rounded card with exercises separated by "GEEN RUST →" connectors, and an expanded weight panel when an exercise is tapped. Each exercise row includes `TypeBadge`. Props: `title`, `exercises`, `accentColor`, `lightColor`, plus shared weight/completion props.
- **`TypeBadge`** — small inline pill rendered next to an exercise name in `SupersetBlock`. Calls `inferExerciseType(name, categorie)` to return one of `"barbell"` / `"dumbbell"` / `"cable"` / `"machine"` / `null`. Returns `null` (renders nothing) for KB, core, and bodyweight exercises.
- **`inferExerciseType(name, categorie)`** — module-scope helper. Checks `categorie === "barbell"` first, then falls through to regex patterns on the name: `/^(Barbell |T-Bar )/` or `name.includes("(barbell)")` → barbell; `name.includes("Dumbbell")` or `name === "Hammer Curl"` → dumbbell; `/Cable|Pulldown/` → cable; `/Machine|Leg Press|Hack Squat|Pec Deck/` → machine.
- **`StretchenCard`** — renders for `day.naam === "Anti-zit"` rust days. Shows a list of goals from `rest_day_goals` filtered by `dag_van_week === "stretchen"`. Icons keyed by `type` field (`trap`, `sta_op`, `avond`, `vacuum`).
- **`VrijeDagCard`** — renders for all other rust days. Shows goals from `rest_day_goals` filtered by `dag_van_week === "vrije_dag"`. Icons keyed by `type` (`gezin`, `optioneel`). Supports week-specific overrides: rows with `week_nummer === week.week` take priority over `week_nummer === 0` catch-all.
- **`CardioFitnessCard`** — renders for `day.type === "cardio_fitness"` days. Hardcoded layout (no Supabase fetch).
- **`Section`** — always-expanded card wrapper used for each exercise category. Header shows section title + a timer button (⏱ label). Timer button uses section accent when active. Props: `title`, `icon`, `accent`, `timerSeconds`, `timerActive`, `onTimerClick`.
- **`ExRow`** — single exercise row (number badge, name, optional note, sets pill). When `onToggle` is provided (spiergroep, kettlebell), the row is clickable and renders a weight input panel below it when `expanded` is true. The panel contains M: and Z: number inputs that save to Supabase on change, plus a previous-week reference line. The number badge is rendered by `ExCircle`. Accepts `swapped` (bool) and `originalName` (string) props — when `swapped` is true, shows a purple "GEWIJZIGD" badge next to the name and renders `↩ originalName` below in gray. Accepts `hiitInterval` (`{ work, rest }` or null) — when set, renders a split badge (`Xs | Ys`) instead of the regular sets pill.
- **`ExCircle`** — the circular number badge inside `ExRow`. Supports a 1000ms long press (`onLongPress`) to toggle exercise completion. Shows a green ✓ when completed. Long press works on both mouse and touch; suppresses the subsequent click to prevent the weight panel from toggling.
- **`WeekDayTile`** — 7-day week selector tile. Shows day abbreviation (`dag_label`), emoji, multi-line name split per word, an orange dot above today's tile, and a gray dot for rest days. 1000ms long press on training days toggles day completion. Non-training days (rust/cardio_fitness) ignore long press. Props: `day`, `isSelected`, `isToday`, `isCompleted`, `onSelect`, `onLongPress`.
- **`DayButton`** — legacy 4-day selector button (still present in code but no longer rendered; superseded by `WeekDayTile`).
- **`SwipeableRow`** — wrapper component around each KB exercise row. Detects a horizontal swipe of ≥60px with <30px vertical drift (mouse and touch) and fires `onSwipeRight`. Translates the row during swipe and snaps back. Suppresses the click event after a completed swipe via a `swiped` ref.
- **`BottomSheet`** — modal slide-up panel rendered when `swapModal` is set. Fixed overlay (zIndex 100) + fixed sheet (zIndex 101). Lists all KB exercises except the currently displayed one. Selecting an exercise calls `saveSwap()`, updates the `swaps` map, and closes the sheet.
- **`KB_EXERCISES`** — constant array of 30 KB exercise names defined outside the component, used to populate the bottom sheet list.
- **`dayColors` / `phaseColors`** — lookup maps from day ID / phase name to color tokens. These drive all theming; there is no CSS file.
- **`currentWeekIndex(allWeeks)`** — calculates the current ISO week number (shifts to Thursday of the current week, then counts weeks from Jan 1), then returns `allWeeks.findIndex(w => w.label === \`Week ${isoWeek}\`)`. Returns -1 if today is outside the program range; the caller falls back to `selectedWeek = 0`. Used as the initial value of `selectedWeek` on mount.
- **`wKey(exercise, week)`** — builds the in-memory map key `"exercise__week"` used to look up weights from the `weights` state object.
- **`dKey(weekNum, dayId)`** — builds the key `"week__dayId"` used in the `completedDays` Set.
- **`eKey(exercise, weekNum, dayId)`** — builds the key `"exercise__week__dayId"` used in the `completedExercises` Set.
- **`sKey(original, weekNum, dayId)`** — builds the key `"original__week__dayId"` used in the `swaps` map.

## Data shape

`week.days` is a 7-element array sorted by `dag_volgorde` (Mon–Sun). Each entry has:
- `dayId` — `schema_days.id` (UUID)
- `dag_nummer` — muscle-group ID 1–4 (nullable; null for non-training days)
- `type` — `"training"` | `"rust"` | `"cardio_fitness"`
- `dag_label` — abbreviated day name (`"Ma"`, `"Di"`, …)
- `dag_volgorde` — sort order 1–7
- `emoji` — day emoji from DB
- `naam` — day name (e.g. `"Rug & Biceps"`, `"Anti-zit"`, `"Vrije dag"`)

Training days additionally have:
- `spiergroep` — muscle-group isolation exercises (array of exercise objects)
- `barbell` — single compound barbell lift (plain object, not array)
- `kettlebell` — full-body KB movements (array of exercise objects)
- `core` — core finisher exercises (array of exercise objects)

Exercise object fields:
```js
{ name: string, sets: string, note: string, optional?: true, hiitInterval?: { work: number, rest: number } }
```
`optional: true` renders the row with a dashed orange border and "OPTIONEEL" badge. Only appears on `spiergroep` exercises (last item per day). Kettlebell and core exercises never have `optional`. `hiitInterval` is set on kettlebell exercises when `hiit_work` / `hiit_rest` are non-null in the DB row; see the KB HIIT intervals section.

Each week object also carries:
- `schemaId` — UUID of the parent schema; used to filter `restDayGoals` so schema 1 and schema 2 rest-day content don't bleed into each other.

**Content area for non-training days**: When `day.type === "rust"`, either `StretchenCard` (if `day.naam === "Anti-zit"`) or `VrijeDagCard` (all other rust days) is shown; both pull their content from the `rest_day_goals` Supabase table filtered by `dag_van_week` and `g.schema_id === week.schemaId`. Week-specific rows (`week_nummer === week.week`) take priority over catch-all rows (`week_nummer === 0`). When `day.type === "cardio_fitness"`, a hardcoded `CardioFitnessCard` is shown. The Progressie chart is shown in all cases (it reads all exercise weights globally). Training sections (Barbell/Spiergroep/KB/Core) are guarded by `{day.type === "training" && ...}`.

**Supabase `schema_days` columns**: `dag_label` TEXT, `dag_volgorde` INTEGER, `dag_nummer` INTEGER (nullable), `type` CHECK in ('training','rust','cardio_fitness'), `emoji` TEXT, `spiergroep_naam` (→ `naam` in JS).

## Color tokens

`dayColors` is keyed by day id (1–4):
- `1` (Benen & Billen) — red `#e63946`
- `2` (Borst & Triceps) — blue `#2563eb`
- `3` (Rug & Biceps) — purple `#7c3aed`
- `4` (Schouders) — yellow `#ca8a04`

Optional exercise accent color is always orange `#f37121` (same as the app header/brand color), regardless of the current day.

## Section render order

**Schema 1 (`week.week <= 30`):** Barbell → Spiergroep → Kettlebell → Core → Progressie. The Barbell section uses a solid orange card (not `ExRow`) but is also clickable and shows an inline weight panel when expanded.

**Schema 2 (`week.week >= 31`):** The Barbell and Spiergroep sections are replaced by a single **Supersets** section rendered via `SupersetBlock`. The Barbell exercise (note = `"Superset 1"`) and matching spiergroep exercises are grouped into SUPERSET 1; the remaining paired spiergroep exercises into SUPERSET 2; any remaining spiergroep exercises (empty `note`) into a "LOSSE OEFENINGEN" block. Order: Supersets → Kettlebell → Core → Progressie.

The progress note below the sections is driven by `week.phase`: "Opbouw" weeks show a progressive overload tip; "Nieuwe Prikkel" weeks show either an intro tip ("begin with a workable weight, build next week") or a peak tip ("go for max weight"), determined by checking whether `schema.weeks[selectedWeek + 1]?.phase === "Nieuwe Prikkel"` — if true it's the intro week, otherwise it's the peak week.

## Progressie chart

A collapsible **Progressie** section sits at the bottom of the content area. State: `progressieOpen` (bool), `progressieExercise` (string or null, defaults to first exercise).

When open it shows:
- A styled `<select>` dropdown with exercises ordered: current day's exercises first, then all barbell → spiergroep → kettlebell → core exercises from the full schema (deduplicated, excluding already-listed day exercises).
- A stats row with M — Max / gain (orange) and Z — Max / gain (blue) cards derived from the `weights` state already loaded on mount.
- A Recharts `LineChart` (220px height) with M in orange `#f37121` and Z in blue `#0ea5e9`, `connectNulls`, week labels on X axis (`W23`–`W36`).
- A `CustomTooltip` component renders a white card with colored dots and bold kg values.

The chart reads from the existing `weights` state — no additional Supabase fetch needed.

## Completion tracking

A 2000ms long press toggles completion state, persisted to Supabase. Long press is implemented inline per component using a `useRef` timer (not a custom hook, to avoid hook-in-loop issues). `triggerImpact()` fires on mobile when the long press triggers.

**Day completion** — long press on a `WeekDayTile` (training days only) toggles the day's completion for the currently selected week. Stored in `completedDays` (Set, keyed by `dKey`). The green ✓ replaces the emoji in the tile.

**Exercise completion** — long press on an `ExCircle` toggles that exercise's completion for the current week and day. Stored in `completedExercises` (Set, keyed by `eKey`). The circle turns solid green with ✓. The click event after a long press is suppressed via `e.stopPropagation()` to prevent the weight panel from opening.

Both sets are fetched on mount from Supabase. The `completedDays` key uses `dayId` (the muscle-group ID 1–4), not the day index.

**Long press implementation details:** The timer starts on `mousedown` / `touchstart`. It is cancelled on `mouseup` / `touchend`. `onMouseLeave` is intentionally NOT used as a cancel trigger — mouse drift during a hold would reset the timer. For touch, `touchmove` only cancels if the finger has moved more than 10px from the start position (stored in a `startPos` ref), preventing natural hand tremor from resetting the timer. The threshold is 1000ms. The root app div has `userSelect: none` / `WebkitUserSelect: none` to prevent the iOS/Android copy-paste callout from appearing during a hold.

The Supabase table schemas:
```
completed_days:
  week  int
  day   int        (day id, 1–4)
  unique constraint on (week, day)

completed_exercises:
  exercise  text
  week      int
  day       int    (day id, 1–4)
  unique constraint on (exercise, week, day)
```

## KB HIIT intervals

When KB exercises have `hiit_work` / `hiit_rest` values in the `exercises` table, the kettlebell section switches to HIIT interval mode for that week. The KB section renders:

1. A **HIIT banner** above the exercise list — orange border card showing ⚡ "HIIT Intervallen" with the werk/rust seconds side-by-side.
2. Each KB `ExRow` receives `hiitInterval={{ work, rest }}` and renders a **split badge** (orange `Xs` left pill + gray `Ys` right pill) instead of the normal sets pill.

The `hiitInterval` is read from `day.kettlebell[0]?.hiitInterval` — set in `buildWeeks` by `toEx()` when `e.hiit_work != null`. **There is no hardcoded JS constant**; all HIIT work/rest values come from the `exercises` table in Supabase. When `hiit_work` is `null` on an exercise row, `hiitInterval` is `null` and the normal sets pill is shown instead.

**Schema 1 HIIT schedule** (relative weeks 4–8 = calWeeks 26–30):
30s/20s → 35s/20s → 40s/20s → 45s/20s → 45s/20s

**Schema 2 HIIT schedule** (all 6 weeks = calWeeks 31–36):
30s/20s → 35s/20s → 40s/15s → 45s/15s → 50s/15s → 50s/10s

## KB exercise swapping

Each kettlebell exercise row is wrapped in `<SwipeableRow>`. It handles swipes in both directions (≥60px horizontal, <30px vertical drift):

**Swipe right** — opens `<BottomSheet>` with all KB exercises except the currently displayed one. Selecting an exercise:
1. Calls `saveSwap(original, newExercise, weekNum, dayId)` — upserts to the `exercise_swaps` table.
2. Updates `swaps` state map so the row immediately renders the new exercise name.
3. Closes the bottom sheet (`swapModal = null`).

**Swipe left** — only available on rows that are already swapped (GEWIJZIGD). Shows a red "↩ Terug" hint behind the row as you drag. On release at ≥60px, calls `revertSwap(original, weekNum, dayId)` which removes the key from `swaps` state and deletes the row from `exercise_swaps` in Supabase.

`SwipeableRow` accepts `onSwipeRight` and `onSwipeLeft` props. `onSwipeLeft` is only passed when `swappedName` is set; unswapped rows ignore leftward drags. The row wraps its children in a `position: relative` container so the "↩ Terug" hint can be absolutely positioned on the right edge.

Swapped rows show a purple **GEWIJZIGD** badge and the original name below with an `↩` prefix. The display name is resolved as `swaps[sKey(ex.name, weekNum, dayId)] ?? ex.name`.

The Supabase table schema:
```
exercise_swaps:
  original_exercise  text
  new_exercise       text
  week               int
  day                int    (day id, 1–4)
  unique constraint on (original_exercise, week, day)
```

All swaps are fetched on mount alongside the other Supabase data.

## Supabase weight tracking

On load, all rows are fetched from the `weights` table and stored in a `weights` map keyed by `"exerciseName__weekNumber"`. Clicking any exercise row expands a small panel with two number inputs labeled **M:** and **Z:** (for each person). On input change, an upsert fires immediately. When the user opens a different exercise, the current exercise's values are flushed to Supabase before switching (`flushSave`). The same flush runs when switching week or day tabs.

**Z field visibility** — The Z input field and the Z portion of the "Vorige week" reference line are hidden with `display: none` (not deleted). The data is still saved/loaded from Supabase. Hidden via: `display: person === "Z" ? "none" : "flex"` on input containers, and `<span style={{ display: "none" }}>` wrapping the `/ Z: ...` text in both the barbell section and `ExRow`.

The `weights` Supabase table schema:
```
exercise  text
week      int        (absolute calendar week, e.g. 23–36)
person    text       ('M' or 'Z')
weight    numeric
unique constraint on (exercise, week, person)
```

The `rest_day_goals` table schema:
```
rest_day_goals:
  id            uuid (PK)
  schema_id     uuid (FK → schemas.id)
  week_nummer   int        (0 = catch-all for every week; specific calWeek = override for that week only)
  dag_van_week  text       ('stretchen' | 'vrije_dag')
  type          text       (icon key: 'trap'|'sta_op'|'avond'|'vacuum' for stretchen; 'gezin'|'optioneel' for vrije_dag)
  beschrijving  text
  duur_minuten  int        (nullable)
```

The `week_overrides` table schema:
```
id                  uuid (PK)
schema_id           uuid (FK → schemas.id)
week_nummer         int        (absolute calendar week, e.g. 30)
dag_nummer          int        (dag_volgorde of the day to override: 1=Ma … 7=Zo)
dag_van_week        text       ('rust' | 'training' | 'cardio_fitness')
emoji               text       (nullable — tile emoji; defaults: 🏖️ for rust, 🥊 for cardio_fitness)
naam                text       (nullable — tile label; defaults: 'Vrije dag' for rust, 'Cardio Fitness' for cardio_fitness)
unique constraint on (schema_id, week_nummer, dag_nummer)
```

Overrides are fetched in `fetchSchemaData()` alongside schemas/schema_days/exercises and passed to `buildWeeks()`. Inside `buildWeeks`, an `overrideMap` keyed by `"calWeek__dagVolgorde"` is built per schema. When a day matches an override: `type` becomes `dag_van_week`; `emoji`/`naam` use the override values (or type-based fallbacks); `dag_nummer` and `kleur` are set to `null` so the tile renders in neutral gray. The override is baked into `localStorage["cached_schema_v2"]` so it works offline. Pull-to-refresh re-fetches and reapplies overrides.

Important: Supabase `PostgrestBuilder` is a lazy promise — the HTTP request only fires when `.then()` is called or the result is awaited. Always chain `.then()` on upsert/insert calls, otherwise the request is silently dropped.

## Offline support & pull-to-refresh

**Schema caching** — on successful Supabase fetch, the full schema is stored in `localStorage["cached_schema_v2"]` as JSON. On load, the app serves cached data immediately (cache-first), then fetches fresh data in the background and updates the cache. If Supabase is unreachable and a cache exists, a gray "offline" banner appears below the header (`schemaOffline` state). Cache key is `cached_schema_v2` (versioned to avoid stale structure issues).

**Service worker** — `vite-plugin-pwa` generates a Workbox service worker that precaches all build assets (JS/CSS/HTML). This lets the Capacitor WebView load the app shell offline after the first online visit, before localStorage can even be read. Configured in `vite.config.js` with `registerType: 'autoUpdate'`.

**Pull-to-refresh** — touch events on the root div: `handlePullStart` / `handlePullMove` / `handlePullEnd`. A raw pull distance (`rawPullDist`) is tracked starting from `touchstart`. The visible pull distance (`pullY`) uses damped mapping. A progress ring SVG indicator appears after 150px raw pull and fills as you pull toward the 260px trigger threshold. On release at ≥260px (or immediately when `refreshing` is true), it triggers `refreshAll()` — re-fetches schema + user data from Supabase and updates the cache. The root div has `overscrollBehaviorY: "contain"` to prevent the browser's native overscroll. The indicator shows an orange arc (`strokeDasharray`) that rotates when refreshing (`@keyframes ptr-spin` injected via `<style>` tag).

## Rest timer

Each section header has a timer button showing the rest duration (e.g. "⏱ 2min"). Clicking it starts a countdown in a fixed bottom bar; clicking it again closes the timer. Only one timer is active at a time.

Timer durations per section:
- Barbell: 120s (2min)
- Spiergroep: 90sec
- Kettlebell: 60s (1min)
- Core: 45sec

The bottom bar shows a circular SVG progress ring (75px container, r=31), countdown text inside the ring (19px, 31px when done), section label with "rust" suffix centered below, and II/▶, ↺, ✕ controls (20px icons, 38×38px fixed size, `appearance: none` to prevent Android emoji rendering). On completion: background turns green (`#16a34a`), ring shows 🔔, "Rust voorbij, ga! 💪" appears below the label. Bell, vibration, and screen wake on completion are all handled natively by `TimerPlugin` — not from JS.

**Lock overlay** — when a timer starts or resets (↺), a `timerLocked` state covers the controls with an absolute-positioned overlay matching the bar's background color. The overlay shows the live progress ring and countdown so the user can still see the time, plus a 🔓 button on the right to dismiss it. A separate transparent full-screen overlay (`position: fixed, inset: 0, zIndex: 49`) also blocks all taps on the rest of the page while locked. The timer bar sits at `zIndex: 50`. Tapping 🔓 dismisses both overlays.

The `useTimer(initialSeconds, { onComplete, onStop })` hook lives outside the component. It drives state from native Android events rather than `setInterval`. On mount it registers three `NativeTimer` listeners: `timerTick` (updates `timeLeft`), `timerComplete` (sets `running = false`, `timeLeft = 0`, fires `onComplete`), and `timerStopped` (sets `running = false`, `timeLeft = 0`, fires `onStop`). Methods: `start(seconds, title)` — sets state and calls `NativeTimer.start`; `pause()` — calls `NativeTimer.pause`; `reset(seconds)` — calls `NativeTimer.stop`; `restart(seconds, title)` — calls `NativeTimer.restart`. Both `start` and `restart` accept an optional `title` string forwarded to the native plugin for use in the running notification. `onComplete` fires when the countdown reaches zero. `onStop` fires when the timer is stopped from the lock-screen notification (✕ button) or from JS. The root div gets `paddingBottom: 100` when a timer is active so content isn't hidden behind the bar.

`onTimerComplete` (component-level) is a no-op `() => {}`. Bell playback, vibration, screen wake, and the completion notification are all handled natively by `TimerService` — not from JS. `onTimerStop` (component-level) clears `activeTimer`, `activeSection`, `timerLocked`.

Wake Lock: the Web API `navigator.wakeLock` is not used. Screen keep-awake while the timer runs is handled by the Android foreground service keeping the process alive; screen wake on completion is handled natively by `TimerService.wakeScreen()`.

Helper functions: `playBoxingBell()` (Web Audio API — defined but not called on timer completion; native handles it), `triggerVibration()` (calls `Haptics.vibrate({ duration: 1600 })` — defined but not called on completion; native handles it), `triggerImpact()` (long press — calls `Haptics.impact({ style: ImpactStyle.Medium })`), `formatTime(seconds)` → `"M:SS"`, `formatTimerLabel(seconds)` → `"Xmin"` or `"Xsec"`. Haptics helpers use `.catch(() => {})` so they fail silently in web browsers where Capacitor Haptics is unavailable.

## Progressive overload pattern (schema 1, weeks 1–3)

**Applies to schema 1 only (calWeeks 23–25).** Schema 2 uses supersets throughout; see `week.week >= 31` render branch.

Within schema 1's first three relative weeks, the same exercises repeat with increasing volume (e.g. 3x → 4x → 5x sets) and the barbell notes say `"Focusgewicht"` → `"+5kg"` → `"+5kg piek"`. The `note` field on `spiergroep` exercises is `""` in week 1 and `"+gewicht"` in weeks 2–3.

## Android / Capacitor

The app is wrapped in Capacitor 8 and can be built as an Android APK. The web assets are loaded into an Android WebView via the Capacitor bridge. `capacitor.config.ts` and `android/` both live at the repo root (see root `CLAUDE.md`), not inside `workout-app/`.

### Timer architecture (native)

The timer is fully native — no capawesome plugin, no `@capacitor/local-notifications`. Three Java classes own the implementation:

**`TimerService extends Service`** — owns everything:
- `startForeground(RUNNING_NOTIF_ID, ...)` with a persistent notification on channel `timer-running-v1`
- The notification uses `Notification.MediaStyle().setShowActionsInCompactView(0, 1)` so the **↺ Opnieuw** and **✕ Stop** action buttons are visible in the collapsed notification on the lock screen without needing to expand it. Uses framework `Notification.Builder` (not `NotificationCompat`) to access `Notification.MediaStyle`. `VISIBILITY_PUBLIC` ensures the full content is shown on the lock screen.
- The completion notification also uses `Notification.MediaStyle().setShowActionsInCompactView(0)` so **↺ Opnieuw** is visible collapsed.
- `Handler.postDelayed` countdown on the main looper (immune to WebView JS throttling)
- `setOnlyAlertOnce(true)` — no re-alert sound/vibration on each second update
- `setOngoing(true)` — user cannot swipe-dismiss the running notification
- `TimerCallback` interface: `onTick(int)`, `onComplete()`, `onStop()` — called by the service to push events to `TimerPlugin`
- Static action constants: `ACTION_RESTART = "com.workout.plan.TIMER_RESTART"`, `ACTION_STOP = "com.workout.plan.TIMER_STOP"`
- On `ACTION_RESTART` via `onStartCommand`: calls `restart(totalSeconds, sectionTitle)` — resets to the original duration
- On `ACTION_STOP` via `onStartCommand`: calls `stopTimer()` then `callback.onStop()`
- `stopTimer()` calls `stopForeground(true)` — removes the running notification
- On completion: calls `stopForeground(true)`, then `postCompletionNotification()`, `wakeScreen()`, `playBell()`, `vibrate()`, `callback.onComplete()`

**`TimerActionReceiver extends BroadcastReceiver`** — forwards lock-screen button taps to the service:
```java
Intent serviceIntent = new Intent(context, TimerService.class);
serviceIntent.setAction(intent.getAction());
context.startService(serviceIntent);
```

**`TimerPlugin extends Plugin implements TimerService.TimerCallback`** — thin Capacitor wrapper:
- Binds to `TimerService` via `ServiceConnection` + `Context.BIND_AUTO_CREATE`
- `load()` starts the service (`startService`) and binds to it
- `handleOnDestroy()` unbinds
- `onTick` / `onComplete` / `onStop` forward events via `notifyListeners()`
- `start()` requests `POST_NOTIFICATIONS` permission on API 33+ before delegating to the service
- All other `@PluginMethod` implementations just delegate to `timerService`

### Notification channels

Two channels are created by `TimerService.onCreate()` (channels are immutable after first creation — use a new ID if sound/importance must change):

| Channel ID | Name | Importance | Sound | Used for |
|---|---|---|---|---|
| `timer-running-v1` | Timer (loopt) | DEFAULT | none | Persistent FGS notification with ↺/✕ buttons |
| `timer-complete-v3` | Timer klaar | DEFAULT | none | Completion notification (tap opens app) |

### On completion (`timeLeftSeconds <= 0`) in `TimerService`:
1. `stopForeground(true)` — removes the running notification
2. `postCompletionNotification()` — posts on `timer-complete-v3`; tapping opens the app
3. `wakeScreen()` — acquires `SCREEN_BRIGHT_WAKE_LOCK | ACQUIRE_CAUSES_WAKEUP` for 5 seconds
4. `playBell()` — plays `res/raw/boxing_bell.mp3` via `MediaPlayer` with `AudioAttributes.USAGE_MEDIA`. Requests `AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE` so Spotify pauses. Uses `AudioManager.AUDIO_SESSION_ID_GENERATE` (constant `0`) — **not** `AudioManager.generateAudioSessionId()` which is a non-static method. `USAGE_MEDIA` (not `USAGE_ALARM`) is intentional: `USAGE_ALARM` routes to all outputs simultaneously (speakers + Bluetooth), while `USAGE_MEDIA` respects the active output.
5. `vibrate()` — `VibrationEffect.createOneShot(1600, DEFAULT_AMPLITUDE)` on API 26+
6. `callback.onComplete()` → `TimerPlugin.notifyListeners("timerComplete", ...)` → JS `timerComplete` event

### Native events fired by `TimerPlugin`
- `timerTick` → `{ timeLeft: number }` — every second
- `timerComplete` → `{}` — countdown hit zero
- `timerStopped` → `{}` — stop button tapped (lock screen ✕ or JS `NativeTimer.stop()`)

### BatteryOptimizationPlugin (`BatteryOptimizationPlugin.java`)

Registered as `"BatteryOptimization"`. On first timer start, `checkAndRequest()` is called from JS: if `isIgnoringBatteryOptimizations()` returns false, it opens the system dialog via `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. This covers standard Android battery optimization. OEM-level deep-sleep (e.g. Samsung) requires the user to manually set Battery → Unrestricted in device settings.

### AndroidManifest permissions

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

`POST_NOTIFICATIONS` is a runtime permission on API 33+; `TimerPlugin.start()` requests it via Capacitor's `requestPermissionForAlias` before starting the timer. `WAKE_LOCK` is required for `TimerService.wakeScreen()`. The `TimerService` and `TimerActionReceiver` are declared in the manifest; the old capawesome `AndroidForegroundService` declaration has been removed.

The `MainActivity` has no `android:showWhenLocked` or `android:turnScreenOn` attributes — these would bypass the lock screen and show the app directly. The wake lock approach is correct: it lights up the screen so the notification is visible on the lock screen.

## Language

UI text and exercise notes are in Dutch.
