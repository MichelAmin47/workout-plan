# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository — a monorepo housing a workout-tracking app and (eventually) a nutrition-tracking app, both backed by the same Supabase project.

## Layout

```
capacitor.config.ts   ← Capacitor config (Android). webDir: 'workout-app/dist'. Lives here, not inside workout-app/, so it can sit alongside android/.
package.json          ← root-level, Capacitor tooling ONLY (@capacitor/cli, @capacitor/core, @capacitor/android, @capacitor/haptics). Not a workspace root — does not manage workout-app's or voeding-app's dependencies.
android/              ← Capacitor Android project (generated; do not edit build files). Stays at repo root regardless of which app is active — android/capacitor.settings.gradle resolves native plugins via ../node_modules, which is why the Capacitor tooling package.json lives at this level too.
(reference docs)      ← supabase_kennis_doc.md, schema docs and voeding-app docs live in the claude.ai project "Fitness & Voeding", not in this repo.
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
- **Supabase schema / table reference** → `supabase_kennis_doc.md` in the claude.ai project "Fitness & Voeding" (not in this repo).

## voeding-app step sync (Health Connect)

`voeding-app/src/lib/stepSync.js` reads steps from Health Connect via `@capgo/capacitor-health` and upserts one row per calendar day into `step_log` (`datum`, `stappen`, `bronnen`, `bijgewerkt_op`), on app open and on resume. `fetchTodaySteps()` (header display) is separate and platform-independent; `syncSteps()` is native-only, best-effort, never throws.

- **Check plugin return shapes against the plugin source, not assumptions.** Read `node_modules/@capgo/capacitor-health/dist/esm/definitions.d.ts` and the Android source (`android/src/main/java/app/capgo/plugin/health/`). `checkAuthorization`/`requestAuthorization` return `{ readAuthorized, readDenied, writeAuthorized, writeDenied }` — there is no `read` field. Reading `result.read` once stored every real grant as "denied" and silently disabled the sync on device (fixed in PR #2).
- **Permission handling:** `checkAuthorization` runs on every sync (cheap, no UI), so grants/revokes made in Health Connect settings are always picked up — don't cache "granted". localStorage `step_permission_denied_v2` records only an explicit denial, to avoid re-prompting on every open. The old `step_permission_decided_v1` key is deleted on every sync; don't reuse it.
- **Range:** first sync (empty table) backfills 30 days (Health Connect's default read cap without the history permission); every later sync re-reads all of today − 6 … today, regardless of what is stored — source apps (Samsung Health) write days to Health Connect late, and a start date derived from the latest stored datum once left a skipped day permanently unfilled. A re-read overwrites the stored count with Health Connect's current value, lower or higher (HC deduplicates; it is the source of truth). Days are plain local calendar days — not threadStorage's 04:00-shifted nutrition day. A day with no Health Connect data is skipped (not in the upsert, so an existing row stays untouched), never written as 0.
- **DST:** the plugin's `bucket: 'day'` is a fixed 24h duration, so a 25h fall-back day returns two buckets — `readAggregatedStepsForDay` sums all buckets, never just `samples[0]`.
- **`bronnen`** is filled from `sample.sourceName`, which the plugin overwrites with the device label ("samsung SM-S938B") whenever a record has device metadata. The writing app's package name is in `sample.sourceId` (`metadata.dataOrigin.packageName`).
- **Diagnosing on device:** every early exit logs `console.warn('[stepSync] <reason>', …)`, and Supabase errors are logged rather than ignored. Debug builds are inspectable via `chrome://inspect` (USB), or `adb logcat` filtered on `Capacitor/Console`. When USB isn't an option, a temporary read-only in-app panel worked well (PR #1, since removed). Supabase edge logs show which `step_log` requests the phone actually makes: no `step_log?select=datum&limit=1` (table-empty check) request means the sync exited before its first Supabase call.

## voeding-app meal components, log cards, product table

Every meal the coach logs is stored with its components and shown as a log card (built 2026-10-05; migration `supabase/migrations/20261005_nutrition_product_and_componenten.sql`).

- **`nutrition_log.componenten`** (jsonb): `[{naam, hoeveelheid, gram, stuks, basis: rauw|bereid|null, eiwitten_g, calorieen, bron: product|geschat|gebruiker, product_id}]`. **Date boundary:** every row logged before 2026-10-05 has `componenten = null` — that is not missing data. Legacy rows are corrected as a whole (top-level `eiwitten_g`/`calorieen` on `nutrition_log_update`); rows with components only per component.
- **Consistency lives in the database**, trigger `nutrition_log_sync_componenten` (BEFORE INSERT/UPDATE): when `componenten` is set it validates them (rejects malformed entries), rounds each component (eiwit 0.1g, kcal whole) and **overwrites** `eiwitten_g`/`calorieen` with the sum of the rounded components — for every writer. Never write row totals for a row with components; they would be overwritten anyway.
- **`nutrition_product`**: known products with package/user values (per 100g and/or per piece, `gewicht_basis` nvt|rauw|bereid — raw and cooked meat are separate rows). Product components are computed **server-side** in `coach-chat/tools.ts` (`resolveComponent`), never estimated by the model. Products are injected into coach-chat's context in full (`prompt.ts`, "Bekende producten"); past 150 active products `buildDynamicContext` warns `[products]` — that is the moment to switch to a lookup tool. Product values belong here (tool `product_opslaan`), not in `coach_memory`.
- **Log cards** are built in `tools.ts` (`buildKaart`) from the row as the database returned it after the write, passed to `index.ts` under `_`-prefixed keys (stripped before the tool result goes back to the model), and returned as `logCards`/`deletedLogIds`. The client stores only display fields (`type: 'log-card'`) and `chatApi.js` `cardToText` sends **nothing** for them — the same rows are already in coach-chat's context, and kcal in assistant history would nudge the coach to talk calories. The card shows kcal; the coach's text still never volunteers it.
- `_shared/summary.ts` and morning-checkin select `nutrition_log` columns explicitly — `componenten` never reaches the day-close or the check-in.

## voeding-app quick log ("snel loggen", favourites)

Built 2026-10-30; migration `supabase/migrations/20261030_nutrition_favoriet.sql`. A bolt button left of the chat input opens a sheet (eating time + favourites); one tap logs a whole favourite **through coach-chat**.

- **`nutrition_favoriet`**: `naam`, `componenten` jsonb `[{product_id, gram|stuks, basis?}]`, `gebruikt_aantal`, `laatst_gebruikt_op`, `actief`. Trigger `nutrition_favoriet_valideer` allows only those four keys per component and requires an active `nutrition_product` — a favourite can never contain an estimate. Ordered `gebruikt_aantal desc, created_at asc`.
- **Deterministic by construction:** the client sends `quickLog: { favorietId, tijdstip }`, never components. coach-chat (`tools.ts` `logFavoriet`) writes the row from the favourite record through the same `addLog` path as a model `nutrition_log_add`, **before** any model call. It then replaces the client's `⚡ Snel loggen …` line in the last user message with one server-built text block (`coach-chat/quickLogText.ts`, `buildQuickLogUserText` + `replaceQuickLogLine`, unit-tested). That block states the **app** saved the meal (no tool call by the model) and carries name, date, time, eiwitten_g, components with indices, log id and the new day total. It contains no kcal and no `_`-keys. A model `nutrition_log_add` during a quick-log request is blocked (duplicate guard). History lines (`chatApi.js`) use the same label with the date: `⚡ Snel loggen — door de app opgeslagen, niet door jou: <naam>, gegeten op <datum> om <tijd>`.
- **The 5.5 models always think** (adaptive thinking can't be disabled), so an injected turn must never be presented as the model's own. Until 2026-11-07 the write was a synthetic `nutrition_log_add` tool_use/tool_result pair. On 07-11 the coach reasoned about "its own" call against the "already logged" label and the never-re-log rule, and invented an apology for having offered the meal twice.
- `gebruikt_aantal` goes up only after the insert succeeded. A failed quick log writes nothing, makes no model call, and is marked `status: 'mislukt'` in the thread, so it is never sent to the coach as logged.
- `{ action: 'favorieten' }` on coach-chat returns the sheet's list, resolved with `resolveComponent` (the protein shown is what gets logged). No favourites block is in the per-turn context.
- New favourites only via chat: tool `favoriet_opslaan` (preferably `log_id` of a logged meal; refused if any component is not a product).

## voeding-app morning check-in: topic cap, day words, models

Built 2026-11-06; migration `supabase/migrations/20261106_vraag_onderwerp.sql`; shared logic in `supabase/functions/_shared/vraagOnderwerp.ts` (pure, unit-tested in `vraagOnderwerp.test.ts`).

- **Topic cap is structural, not a prompt rule.** Every card question and every closer `vraag_voor_morgen` has a `vraag_onderwerp` (fixed enum of 9: eiwit_timing, maaltijd, herstel, energie, slaap, gezondheid, logging, training, anders). A topic is allowed on card date X only if it occurs < 3 times in `coach_checkin_card` for X-6 … X-1 (`capVenster`, one definition for both ends; the closer on D uses X = D+1). Capped topics are removed from the tool schema's enum at **both** ends (`summary.ts` and morning-checkin). "anders" is capped too. NULL topics don't count.
- **Labels are not trusted.** A narrow eiwit_timing keyword check (`bepaalOnderwerp`) relabels a protein-timing question tagged as something else (05 Nov: a card labelled "afsluiter" asked about protein timing). A closer question whose topic is capped is not stored (closer) or not offered to the model (card → falls back to `maaltijden`).
- **Day words:** only the "morgen" family of the closer's text is shifted in code before the card prompt (`verschuifMorgen`: morgen→vandaag, morgenochtend/-vroeg→vanochtend, morgenmiddag→vanmiddag, morgenavond→vanavond). vandaag/gisteren are **not** converted: the closer often already writes from the card's perspective. A "morgen" in the card output is rejected (retry), never rewritten. The closer's context clause before " — " is copied into `boodschap` only when it contains no other relative day word.
- `antwoord_opties` is required in the card schema; the 2–3 count and the 40-char limit stay in `validateAntwoordOpties` (strict mode supports neither).
- **Models:** morning-checkin `claude-sonnet-5-5` (2048 tokens), day-close `claude-opus-5-5` (4096), both `output_config.effort: 'low'`, `tool_choice: auto` + `strict: true` tool schemas (forced tool_choice 400s on 5.5). A response without the tool call → one corrective retry; the card then falls back to its template, the closer fails loudly (`[summary] GEEN SAMENVATTING`) and never writes an empty row. coach-chat sends no effort (unchanged body; `anthropic.test.ts`).
- **Naming:** text written *about* the user (summaries, aandachtspunt, coach_memory facts, the closer's transcript label) uses "Mies" (hij/hem/zijn); direct address in chat, on the card and in `vraag_voor_morgen` stays je/jij.

## Vercel deployment

Production URL `https://workout-plan-taupe.vercel.app` serves `workout-app/`; `https://workout-plan-77mz.vercel.app` serves `voeding-app/` as its own separate Vercel project. No `vercel.json` exists for either — each project's **Root Directory** is set in its own Vercel dashboard (Settings → General). Live-update (picking up `main` pushes without an APK rebuild) is confirmed working for both apps against this setting. See `workout-app/CLAUDE.md` → "Vercel deployment" for the rest of workout-app's dashboard settings.

## Language

UI text and exercise notes are in Dutch.
