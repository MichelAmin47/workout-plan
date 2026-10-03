# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository — a monorepo housing a workout-tracking app and (eventually) a nutrition-tracking app, both backed by the same Supabase project.

## Layout

```
capacitor.config.ts   ← Capacitor config (Android). webDir: 'workout-app/dist'. Lives here, not inside workout-app/, so it can sit alongside android/.
package.json          ← root-level, Capacitor tooling ONLY (@capacitor/cli, @capacitor/core, @capacitor/android, @capacitor/haptics). Not a workspace root — does not manage workout-app's or voeding-app's dependencies.
android/              ← Capacitor Android project (generated; do not edit build files). Stays at repo root regardless of which app is active — android/capacitor.settings.gradle resolves native plugins via ../node_modules, which is why the Capacitor tooling package.json lives at this level too.
knowledge_docs/       ← project-wide reference docs (not app-specific):
  nieuw_schema_week31-36.md   ← monorepo + schema planning doc (Dutch)
  supabase_kennis_doc.md      ← shared Supabase schema/table reference
  backup_database/            ← CSV snapshots of key tables
workout-app/          ← the workout-tracking app. See workout-app/CLAUDE.md for its full architecture doc.
voeding-app/          ← the nutrition-coach chat app. Fully built, not a placeholder — its own Capacitor Android project (appId `com.nutrition.coach`, entirely separate from workout-app's `android/`) and its own Vercel deployment (`https://workout-plan-77mz.vercel.app`).
shared/               ← empty for now; future home for cross-app Supabase client config + generated types.
```

Each app (`workout-app/`, `voeding-app/`) is a fully independent Vite + React project — its own `package.json`, `node_modules`, lockfile. There is no npm workspaces setup tying them together; the root `package.json` exists solely so `npx cap sync android` can run from the repo root for **workout-app**.

**voeding-app has its own, separate native project**: `voeding-app/capacitor.config.ts` + `voeding-app/android/` (appId `com.nutrition.coach`), distinct from the root `android/` (appId `com.workout.plan`, workout-app only). Its native build commands run from inside `voeding-app/`, not the repo root:
```bash
npm run build --prefix voeding-app && (cd voeding-app && npx cap sync android)
```
`voeding-app/android/` is `.gitignore`d like the root `android/`, with the same force-track precedent for the files that need version control: `voeding-app/android/app/build.gradle`, `voeding-app/android/app/src/main/res/values/strings.xml`, and `voeding-app/android/variables.gradle` are force-added (`git add -f`) — one more file than the root `android/`'s own two, because voeding-app's `minSdkVersion` had to be raised to 26 (Health Connect's own minimum). No `signingConfigs`/keystore exists in this repo for either app — release signing for both has always happened outside version control, on whatever machine holds the keystore.

## Working in this repo

- **Editing the workout app** → see `workout-app/CLAUDE.md`. Run `npm run dev` / `npm run build` from inside `workout-app/`.
- **Editing the nutrition app** → `voeding-app/`. Run `npm run dev` / `npm run build` from inside `voeding-app/`.
- **Native Android build (workout-app)** → run from this repo root:
  ```bash
  npm run build --prefix workout-app && npx cap sync android
  ```
  See `workout-app/CLAUDE.md` → "Android build" for when this is actually needed (native changes only; JS/UI changes on `main` live-update via Vercel).
- **Native Android build (voeding-app)** → run from inside `voeding-app/` (see above) — a separate Capacitor project, not covered by the root-level command.
- **Supabase schema / table reference** → `knowledge_docs/supabase_kennis_doc.md`.

## voeding-app step sync (Health Connect)

`voeding-app/src/lib/stepSync.js` reads steps from Health Connect via `@capgo/capacitor-health` and upserts one row per calendar day into `step_log` (`datum`, `stappen`, `bronnen`, `bijgewerkt_op`), on app open and on resume. `fetchTodaySteps()` (header display) is separate and platform-independent; `syncSteps()` is native-only, best-effort, never throws.

- **Check plugin return shapes against the plugin source, not assumptions.** Read `node_modules/@capgo/capacitor-health/dist/esm/definitions.d.ts` and the Android source (`android/src/main/java/app/capgo/plugin/health/`). `checkAuthorization`/`requestAuthorization` return `{ readAuthorized, readDenied, writeAuthorized, writeDenied }` — there is no `read` field. Reading `result.read` once stored every real grant as "denied" and silently disabled the sync on device (fixed in PR #2).
- **Permission handling:** `checkAuthorization` runs on every sync (cheap, no UI), so grants/revokes made in Health Connect settings are always picked up — don't cache "granted". localStorage `step_permission_denied_v2` records only an explicit denial, to avoid re-prompting on every open. The old `step_permission_decided_v1` key is deleted on every sync; don't reuse it.
- **Range:** first sync (empty table) backfills 30 days (Health Connect's default read cap without the history permission); every later sync re-reads all of today − 6 … today, regardless of what is stored — source apps (Samsung Health) write days to Health Connect late, and a start date derived from the latest stored datum once left a skipped day permanently unfilled. A re-read overwrites the stored count with Health Connect's current value, lower or higher (HC deduplicates; it is the source of truth). Days are plain local calendar days — not threadStorage's 04:00-shifted nutrition day. A day with no Health Connect data is skipped (not in the upsert, so an existing row stays untouched), never written as 0.
- **DST:** the plugin's `bucket: 'day'` is a fixed 24h duration, so a 25h fall-back day returns two buckets — `readAggregatedStepsForDay` sums all buckets, never just `samples[0]`.
- **`bronnen`** is filled from `sample.sourceName`, which the plugin overwrites with the device label ("samsung SM-S938B") whenever a record has device metadata. The writing app's package name is in `sample.sourceId` (`metadata.dataOrigin.packageName`).
- **Diagnosing on device:** every early exit logs `console.warn('[stepSync] <reason>', …)`, and Supabase errors are logged rather than ignored. Debug builds are inspectable via `chrome://inspect` (USB), or `adb logcat` filtered on `Capacitor/Console`. When USB isn't an option, a temporary read-only in-app panel worked well (PR #1, since removed). Supabase edge logs show which `step_log` requests the phone actually makes: no `step_log?select=datum&limit=1` (table-empty check) request means the sync exited before its first Supabase call.

## Vercel deployment

Production URL `https://workout-plan-taupe.vercel.app` serves `workout-app/`; `https://workout-plan-77mz.vercel.app` serves `voeding-app/` as its own separate Vercel project. No `vercel.json` exists for either — each project's **Root Directory** is set in its own Vercel dashboard (Settings → General). Live-update (picking up `main` pushes without an APK rebuild) is confirmed working for both apps against this setting. See `workout-app/CLAUDE.md` → "Vercel deployment" for the rest of workout-app's dashboard settings.

## Language

UI text and exercise notes are in Dutch.
