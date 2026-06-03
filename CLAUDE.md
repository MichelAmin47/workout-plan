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
fitness_schema.jsx   ← the component (edit this for data/UI changes)
src/
  main.jsx           ← React root, mounts <App />
  App.jsx            ← thin wrapper: import FitnessSchema from '../fitness_schema.jsx'
  index.css          ← minimal reset only (body margin, #root min-height)
index.html
vite.config.js
```

## Component architecture

Everything lives in `fitness_schema.jsx`:

- **`schema`** — static data object containing the full 5-week program. Two phases: `"Opbouw"` (weeks 1–3, same exercises with progressive overload) and `"Nieuwe Prikkel"` (weeks 4–5, new exercises).
- **`FitnessSchema`** (default export) — top-level component. Manages three pieces of state: `selectedWeek`, `selectedDay`, and `expandedSections`. Derives all display data from `schema` by indexing with those state values.
- **`Section`** — collapsible card wrapper used for each exercise category.
- **`ExRow`** — single exercise row (number badge, name, optional note, sets pill).
- **`dayColors` / `phaseColors`** — lookup maps from day ID / phase name to color tokens. These drive all theming; there is no CSS file.

## Data shape

Each `week.days[n]` entry has four exercise categories:
- `spiergroep` — muscle-group isolation exercises (array)
- `barbell` — single compound barbell lift (object, not array)
- `kettlebell` — full-body KB movements (array)
- `core` — core finisher exercises (array)

`schema.days` (the 4-day split labels/colors) and `week.days` (the actual exercises) are both indexed by position — `schema.days[i].id` is `i + 1`.

## Language

UI text and exercise notes are in Dutch.
