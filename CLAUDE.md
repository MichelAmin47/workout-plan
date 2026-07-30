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
voeding-app/          ← placeholder scaffold for the future nutrition-tracking app. No features yet.
shared/               ← empty for now; future home for cross-app Supabase client config + generated types.
```

Each app (`workout-app/`, `voeding-app/`) is a fully independent Vite + React project — its own `package.json`, `node_modules`, lockfile. There is no npm workspaces setup tying them together; the root `package.json` exists solely so `npx cap sync android` can run from the repo root.

## Working in this repo

- **Editing the workout app** → see `workout-app/CLAUDE.md`. Run `npm run dev` / `npm run build` from inside `workout-app/`.
- **Editing the (future) nutrition app** → `voeding-app/`, currently an empty scaffold.
- **Native Android build** (`cap sync`, APK rebuild) → run from this repo root, not from `workout-app/`:
  ```bash
  npm run build --prefix workout-app && npx cap sync android
  ```
  See `workout-app/CLAUDE.md` → "Android build" for when this is actually needed (native changes only; JS/UI changes on `main` live-update via Vercel).
- **Supabase schema / table reference** → `knowledge_docs/supabase_kennis_doc.md`.

## Vercel deployment

Production URL `https://workout-plan-taupe.vercel.app` serves `workout-app/`. No `vercel.json` exists — the project's **Root Directory** must be set to `workout-app` in the Vercel dashboard (Settings → General) for deployments to resolve correctly post-restructure. See `workout-app/CLAUDE.md` → "Vercel deployment" for the rest of the required dashboard settings.

## Language

UI text and exercise notes are in Dutch.
