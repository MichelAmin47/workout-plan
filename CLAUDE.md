# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Vite + React app that renders a 7-week gym training plan. The component (`fitness_schema.jsx`) lives at the project root and is self-contained — all styling is inline, no CSS file.

## Dev server

```bash
npm run dev      # http://localhost:5173
npm run build
npm run preview
```

Requires Node.js 20.19+ or 22.12+. The project was developed on Node 22.22.3 (nvm).

## File layout

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
package.json              ← scripts: dev / build / preview / lint
android/                  ← Capacitor Android project (generated, do not edit build files)
  app/src/main/
    java/com/workout/plan/
      MainActivity.java         ← registers BatteryOptimizationPlugin + TimerPlugin
      TimerPlugin.java          ← custom native timer plugin (NativeTimer)
      BatteryOptimizationPlugin.java ← requests battery optimization exemption
    res/
      drawable/ic_timer_notification.xml ← flat monochrome notification icon (required)
      raw/boxing_bell.mp3       ← bell audio used by TimerPlugin.playBell()
    AndroidManifest.xml         ← permissions + foreground service declaration
```

## Dependency versions (as of last update)

- React 19, react-dom 19
- Vite 8, @vitejs/plugin-react 6
- @supabase/supabase-js (latest) — weight persistence
- recharts (latest) — progress chart
- @capacitor/core, @capacitor/android — Capacitor 8 Android bridge
- @capacitor/haptics@8.0.2 — `Haptics.impact()` for long-press feedback
- @capacitor/local-notifications@8.2.0 — in-progress timer notification on lock screen
- @capawesome-team/capacitor-android-foreground-service@8.1.0 — keeps app alive in background while timer runs
- No routing, no state management, no CSS framework

## Environment variables

Required in `.env` (not committed):
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Component architecture

Everything lives in `fitness_schema.jsx`:

- **`schema`** — static data object containing the full 7-week program. Two phases: `"Opbouw"` (weeks 1–3, same exercises with progressive overload) and `"Nieuwe Prikkel"` (weeks 4–7, two 2-week intro→peak blocks with new exercises each block).
- **`FitnessSchema`** (default export) — top-level component. Manages state: `selectedWeek`, `selectedDay` (persisted to `localStorage` under key `"selectedDay"`), `weights` (map of fetched weights from Supabase), `expandedExercise` (name of the currently open weight panel), `completedDays` (Set of completed day keys), `completedExercises` (Set of completed exercise keys), `swaps` (map of swapped KB exercises keyed by `sKey`), `swapModal` (null or `{original, week, day}` for the open bottom sheet), `activeTimer` (section key or null), `activeSection` (object with key/label/icon/seconds/accent or null), and `timerLocked` (bool). Calls `useTimer` for the rest timer. Barbell long-press uses component-level refs `bbTimerRef`, `bbLongPressed`, `bbStartPos`. Derives all display data from `schema` by indexing with those state values. The app header shows the title "7-Weken Trainingsschema" and a phase badge (e.g. "Opbouw" / "Nieuwe Prikkel") — no other controls.
- **`Section`** — always-expanded card wrapper used for each exercise category. Header shows section title + a timer button (⏱ label). Timer button uses section accent when active. Props: `title`, `icon`, `accent`, `timerSeconds`, `timerActive`, `onTimerClick`.
- **`ExRow`** — single exercise row (number badge, name, optional note, sets pill). When `onToggle` is provided (spiergroep, kettlebell), the row is clickable and renders a weight input panel below it when `expanded` is true. The panel contains M: and Z: number inputs that save to Supabase on change, plus a previous-week reference line. The number badge is rendered by `ExCircle`. Accepts `swapped` (bool) and `originalName` (string) props — when `swapped` is true, shows a purple "GEWIJZIGD" badge next to the name and renders `↩ originalName` below in gray. Accepts `hiitInterval` (`{ work, rest }` or null) — when set, renders a split badge (`Xs | Ys`) instead of the regular sets pill.
- **`ExCircle`** — the circular number badge inside `ExRow`. Supports a 1000ms long press (`onLongPress`) to toggle exercise completion. Shows a green ✓ when completed. Long press works on both mouse and touch; suppresses the subsequent click to prevent the weight panel from toggling.
- **`DayButton`** — day selector button. Short click selects the day; 1000ms long press toggles completion for that day in the current week. Shows a small green ✓ badge overlaid on the emoji when completed.
- **`SwipeableRow`** — wrapper component around each KB exercise row. Detects a horizontal swipe of ≥60px with <30px vertical drift (mouse and touch) and fires `onSwipeRight`. Translates the row during swipe and snaps back. Suppresses the click event after a completed swipe via a `swiped` ref.
- **`BottomSheet`** — modal slide-up panel rendered when `swapModal` is set. Fixed overlay (zIndex 100) + fixed sheet (zIndex 101). Lists all KB exercises except the currently displayed one. Selecting an exercise calls `saveSwap()`, updates the `swaps` map, and closes the sheet.
- **`KB_EXERCISES`** — constant array of 30 KB exercise names defined outside the component, used to populate the bottom sheet list.
- **`HIIT_INTERVALS`** — constant map from week number to `{ work, rest }` seconds: `{ 4: { work: 30, rest: 20 }, 5: { work: 35, rest: 20 }, 6: { work: 40, rest: 20 }, 7: { work: 45, rest: 20 } }`. Weeks 4–7 = Weeks 26–29.
- **`dayColors` / `phaseColors`** — lookup maps from day ID / phase name to color tokens. These drive all theming; there is no CSS file.
- **`getCurrentWeekIndex()`** — calculates the current ISO week number, subtracts 23 (first week of the program), and clamps to 0–6. Used as the initial value of `selectedWeek`.
- **`wKey(exercise, week)`** — builds the in-memory map key `"exercise__week"` used to look up weights from the `weights` state object.
- **`dKey(weekNum, dayId)`** — builds the key `"week__dayId"` used in the `completedDays` Set.
- **`eKey(exercise, weekNum, dayId)`** — builds the key `"exercise__week__dayId"` used in the `completedExercises` Set.
- **`sKey(original, weekNum, dayId)`** — builds the key `"original__week__dayId"` used in the `swaps` map.

## Data shape

Each `week.days[n]` entry has four exercise categories:
- `spiergroep` — muscle-group isolation exercises (array of exercise objects)
- `barbell` — single compound barbell lift (plain object, not array)
- `kettlebell` — full-body KB movements (array of exercise objects)
- `core` — core finisher exercises (array of exercise objects)

Exercise object fields:
```js
{ name: string, sets: string, note: string, optional?: true }
```
`optional: true` renders the row with a dashed orange border and "OPTIONEEL" badge. Only appears on `spiergroep` exercises (last item per day). Kettlebell and core exercises never have `optional`.

`schema.days` (the 4-day split labels/colors) and `week.days` (the actual exercises) are both indexed by position — `schema.days[i].id` maps to `week.days[i].dayId`. The render order in `schema.days` is: Schouders (id 4), Borst & Triceps (id 2), Rug & Biceps (id 3), Benen & Billen (id 1).

## Color tokens

`dayColors` is keyed by day id (1–4):
- `1` (Benen & Billen) — red `#e63946`
- `2` (Borst & Triceps) — blue `#2563eb`
- `3` (Rug & Biceps) — purple `#7c3aed`
- `4` (Schouders) — yellow `#ca8a04`

Optional exercise accent color is always orange `#f37121` (same as the app header/brand color), regardless of the current day.

## Section render order

Inside the content area, sections are rendered in this fixed order: Barbell → Spiergroep → Kettlebell → Core → Progressie. The Barbell section uses a solid orange card (not `ExRow`) but is also clickable and shows an inline weight panel when expanded. The progress note below the sections is driven by `week.phase`: "Opbouw" weeks show a progressive overload tip; "Nieuwe Prikkel" weeks show either an intro tip ("begin with a workable weight, build next week") or a peak tip ("go for max weight"), determined by checking whether `schema.weeks[selectedWeek + 1]?.phase === "Nieuwe Prikkel"` — if true it's the intro week, otherwise it's the peak week.

## Progressie chart

A collapsible **Progressie** section sits at the bottom of the content area. State: `progressieOpen` (bool), `progressieExercise` (string or null, defaults to first exercise).

When open it shows:
- A styled `<select>` dropdown with exercises ordered: current day's exercises first, then all barbell → spiergroep → kettlebell → core exercises from the full schema (deduplicated, excluding already-listed day exercises).
- A stats row with M — Max / gain (orange) and Z — Max / gain (blue) cards derived from the `weights` state already loaded on mount.
- A Recharts `LineChart` (220px height) with M in orange `#f37121` and Z in blue `#0ea5e9`, `connectNulls`, week labels on X axis (`W23`–`W29`).
- A `CustomTooltip` component renders a white card with colored dots and bold kg values.

The chart reads from the existing `weights` state — no additional Supabase fetch needed.

## Completion tracking

A 2000ms long press toggles completion state, persisted to Supabase. Long press is implemented inline per component using a `useRef` timer (not a custom hook, to avoid hook-in-loop issues). `triggerImpact()` fires on mobile when the long press triggers.

**Day completion** — long press on a `DayButton` toggles the day's completion for the currently selected week. Stored in `completedDays` (Set, keyed by `dKey`). The green ✓ badge overlays the emoji.

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

## KB HIIT intervals (weeks 26–29)

For weeks 26–29 (`week.week` 4–7), the kettlebell section switches to HIIT interval mode. The KB section renders:

1. A **HIIT banner** above the exercise list — orange border card showing ⚡ "HIIT Intervallen" with the werk/rust seconds side-by-side.
2. Each KB `ExRow` receives `hiitInterval={{ work, rest }}` and renders a **split badge** (orange `Xs` left pill + gray `Ys` right pill) instead of the normal sets pill.

Weeks 23–25 (`week.week` 1–3) are unaffected; `hiitInterval` is `null` and sets display normally. The split is derived via `HIIT_INTERVALS[week.week] || null` inside an IIFE wrapping the KB section's children. Work intervals escalate across the four weeks: 30s → 35s → 40s → 45s, rest stays at 20s.

## KB exercise swapping

Each kettlebell exercise row is wrapped in `<SwipeableRow>`. Swiping right (≥60px horizontal, <30px vertical drift) on any KB row opens `<BottomSheet>` with a list of all KB exercises minus the currently displayed one. Selecting an exercise:

1. Calls `saveSwap(original, newExercise, weekNum, dayId)` — upserts to the `exercise_swaps` table.
2. Updates `swaps` state map so the row immediately renders the new exercise name.
3. Closes the bottom sheet (`swapModal = null`).

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
week      int        (program week number 1–5)
person    text       ('M' or 'Z')
weight    numeric
unique constraint on (exercise, week, person)
```

Important: Supabase `PostgrestBuilder` is a lazy promise — the HTTP request only fires when `.then()` is called or the result is awaited. Always chain `.then()` on upsert/insert calls, otherwise the request is silently dropped.

## Rest timer

Each section header has a timer button showing the rest duration (e.g. "⏱ 2min"). Clicking it starts a countdown in a fixed bottom bar; clicking it again closes the timer. Only one timer is active at a time.

Timer durations per section:
- Barbell: 120s (2min)
- Spiergroep: 90sec
- Kettlebell: 60s (1min)
- Core: 45sec

The bottom bar shows a circular SVG progress ring (75px container, r=31), countdown text inside the ring (19px, 31px when done), section label with "rust" suffix centered below, and II/▶, ↺, ✕ controls (20px icons, 38×38px fixed size, `appearance: none` to prevent Android emoji rendering). On completion: background turns green (`#16a34a`), ring shows 🔔, "Rust voorbij, ga! 💪" appears below the label. Bell, vibration, and screen wake on completion are all handled natively by `TimerPlugin` — not from JS.

**Lock overlay** — when a timer starts or resets (↺), a `timerLocked` state covers the controls with an absolute-positioned overlay matching the bar's background color. The overlay shows the live progress ring and countdown so the user can still see the time, plus a 🔓 button on the right to dismiss it. A separate transparent full-screen overlay (`position: fixed, inset: 0, zIndex: 49`) also blocks all taps on the rest of the page while locked. The timer bar sits at `zIndex: 50`. Tapping 🔓 dismisses both overlays.

The `useTimer(initialSeconds, { onComplete })` hook lives outside the component. It drives state from native Android events rather than `setInterval`. On mount it registers two `NativeTimer` listeners: `timerTick` (updates `timeLeft`) and `timerComplete` (sets `running = false`, `timeLeft = 0`, fires `onComplete`). Methods: `start(seconds, title)` — sets state and calls `NativeTimer.start`; `pause()` — calls `NativeTimer.pause`; `reset(seconds)` — calls `NativeTimer.stop`; `restart(seconds, title)` — calls `NativeTimer.restart`. Both `start` and `restart` accept an optional `title` string forwarded to the native plugin for use in the completion notification. `onComplete` fires when the countdown reaches zero. The root div gets `paddingBottom: 100` when a timer is active so content isn't hidden behind the bar.

`onTimerComplete` (component-level) calls `stopForegroundTimer()` only. Bell playback, vibration, screen wake, and the completion notification are all handled natively by `TimerPlugin` — not from JS.

Wake Lock: the Web API `navigator.wakeLock` is not used. Screen keep-awake while the timer runs is handled by the Android foreground service keeping the process alive; screen wake on completion is handled natively by `TimerPlugin.wakeScreen()`.

Helper functions: `playBoxingBell()` (Web Audio API — defined but not called on timer completion; native handles it), `triggerVibration()` (calls `Haptics.vibrate({ duration: 1600 })` — defined but not called on completion; native handles it), `triggerImpact()` (long press — calls `Haptics.impact({ style: ImpactStyle.Medium })`), `formatTime(seconds)` → `"M:SS"`, `formatTimerLabel(seconds)` → `"Xmin"` or `"Xsec"`. Haptics helpers use `.catch(() => {})` so they fail silently in web browsers where Capacitor Haptics is unavailable.

## Progressive overload pattern (weeks 1–3)

Weeks 1–3 use the same exercises. Volume increases each week (e.g. 3x → 4x → 5x sets) and the barbell notes say `"Focusgewicht"` → `"+5kg"` → `"+5kg piek"`. The `note` field on `spiergroep` exercises is `""` in week 1 and `"+gewicht"` in weeks 2–3.

## Android / Capacitor

The app is wrapped in Capacitor 8 and can be built as an Android APK. The web assets are loaded into an Android WebView via the Capacitor bridge.

### Foreground service

`@capawesome-team/capacitor-android-foreground-service` keeps the process alive in the background while the timer runs. It is started in `startForegroundTimer(section)` and stopped in `stopForegroundTimer()`.

```js
ForegroundService.startForegroundService({
  id: 99,
  title: section.label,
  body: "Timer loopt...",
  smallIcon: "ic_timer_notification",
  notificationChannelId: FGS_CHANNEL_ID,   // "fgs-timer-v2"
  silent: true,
  serviceType: 1,   // dataSync = 1 (NOT 4 — that is phoneCall)
});
```

The notification icon **must** be a flat monochrome vector drawable in `res/drawable/`. Adaptive icon layers in `drawable-v24/` will fail; the foreground service crashes within 5s if the icon resolves incorrectly.

### Notification channels

Three channels are created on mount (channels are immutable after first creation — use a new ID if sound/importance must change):

| Channel ID | Name | Importance | Sound | Used for |
|---|---|---|---|---|
| `fgs-timer-v2` | Timer (achtergrond) | 3 (DEFAULT) | none | Foreground service persistent notification |
| `timer-silent` | Timer (stil) | 2 (LOW) | none | In-progress timer notification on lock screen |
| `timer-complete-v3` | Timer klaar | 3 (DEFAULT) | none | Completion notification (posted natively by TimerPlugin) |

### NativeTimer plugin (`TimerPlugin.java`)

Custom Capacitor plugin that runs the countdown on the Android main `Handler` (immune to WebView JS throttling). Registered as `"NativeTimer"` via `registerPlugin()` on the JS side and `@CapacitorPlugin(name = "NativeTimer")` on the Java side.

**Plugin methods:** `start({ seconds, title })`, `pause()`, `resume()`, `stop()`, `restart({ seconds, title })`.

**Native events fired:** `timerTick` → `{ timeLeft: number }` every second; `timerComplete` → `{}` when countdown hits zero.

**On completion (`timeLeftSeconds <= 0`):**
1. `postCompletionNotification()` — posts a notification on channel `timer-complete-v3` so it appears on the lock screen. Tapping it opens the app.
2. `wakeScreen()` — acquires `SCREEN_BRIGHT_WAKE_LOCK | ACQUIRE_CAUSES_WAKEUP` for 5 seconds. This lights up the screen from locked state; the `wl.acquire(5000)` call auto-releases. Requires `WAKE_LOCK` permission in the manifest.
3. `playBell()` — plays `res/raw/boxing_bell.mp3` via `MediaPlayer` with `AudioAttributes.USAGE_ALARM`. Before playback, explicitly requests `AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE` via `AudioManager` so Spotify (and other media apps) pause for the duration of the bell. Audio focus is released in `MediaPlayer.OnCompletionListener`. Uses `AudioManager.AUDIO_SESSION_ID_GENERATE` (constant `0`) as the session ID argument — **not** `AudioManager.generateAudioSessionId()` which is a non-static method and will not compile.
4. `vibrate()` — fires `VibrationEffect.createOneShot(1600, DEFAULT_AMPLITUDE)` on API 26+.
5. `notifyListeners("timerComplete", ...)` — signals the JS layer.

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
```

`WAKE_LOCK` is required for both `TimerPlugin.wakeScreen()` (completion screen wake) and the foreground service plugin's internal partial wake lock.

The foreground service is declared with `android:foregroundServiceType="dataSync"`, which maps to type value `1`. Always pass `serviceType: 1` when calling `startForegroundService()` from JS — value `4` is `phoneCall` and will crash.

The `MainActivity` has no `android:showWhenLocked` or `android:turnScreenOn` attributes — these would bypass the lock screen and show the app directly. The wake lock approach is correct: it lights up the screen so the notification is visible on the lock screen.

## Language

UI text and exercise notes are in Dutch.
