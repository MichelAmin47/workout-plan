# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Vite + React app that renders a 5-week gym training plan. The component (`fitness_schema.jsx`) lives at the project root and is self-contained — all styling is inline, no CSS file.

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
  index.css               ← minimal reset only (body margin: 0, #root min-height: 100svh)
  App.css                 ← unused (default Vite scaffold leftover, safe to ignore)
  assets/
    react.svg / vite.svg  ← unused scaffold assets
    hero.png              ← unused
public/
  favicon.svg             ← orange dumbbell icon shown in browser tab
  icons.svg               ← unused
vite.config.js            ← minimal: only @vitejs/plugin-react, no aliases or custom config
eslint.config.js          ← standard Vite scaffold ESLint config (react-hooks, react-refresh)
package.json              ← scripts: dev / build / preview / lint
```

## Dependency versions (as of last update)

- React 19, react-dom 19
- Vite 8, @vitejs/plugin-react 6
- No routing, no state management, no CSS framework — intentionally zero-dependency UI

## Component architecture

Everything lives in `fitness_schema.jsx`:

- **`schema`** — static data object containing the full 5-week program. Two phases: `"Opbouw"` (weeks 1–3, same exercises with progressive overload) and `"Nieuwe Prikkel"` (weeks 4–5, new exercises).
- **`FitnessSchema`** (default export) — top-level component. Manages three pieces of state: `selectedWeek`, `selectedDay`, and `expandedSections`. Derives all display data from `schema` by indexing with those state values.
- **`Section`** — collapsible card wrapper used for each exercise category.
- **`ExRow`** — single exercise row (number badge, name, optional note, sets pill). Accepts an `optional` boolean that switches the row to a dashed orange border style and adds an "OPTIONEEL" badge.
- **`dayColors` / `phaseColors`** — lookup maps from day ID / phase name to color tokens. These drive all theming; there is no CSS file.
- **`getCurrentWeekIndex()`** — calculates the current ISO week number, subtracts 23 (first week of the program), and clamps to 0–4. Used as the initial value of `selectedWeek`.

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
- `3` (Rug & Biceps) — green `#16a34a`
- `4` (Schouders) — yellow `#ca8a04`

Optional exercise accent color is always orange `#f37121` (same as the app header/brand color), regardless of the current day.

## Section render order

Inside the content area, sections are rendered in this fixed order: Barbell → Spiergroep → Kettlebell → Core. The Barbell section uses a solid orange card (not `ExRow`). The progress note below the sections changes based on `selectedWeek`: weeks 0–2 show an "Opbouw" (progressive overload) tip; weeks 3–4 show a "Nieuwe prikkel" tip.

## Progressive overload pattern (weeks 1–3)

Weeks 1–3 use the same exercises. Volume increases each week (e.g. 3x → 4x → 5x sets) and the barbell notes say `"Focusgewicht"` → `"+5kg"` → `"+5kg piek"`. The `note` field on `spiergroep` exercises is `""` in week 1 and `"+gewicht"` in weeks 2–3.

## Language

UI text and exercise notes are in Dutch.
