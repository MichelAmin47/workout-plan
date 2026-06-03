# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file React component (`fitness_schema.jsx`) that renders a 5-week gym training plan. It is a self-contained UI with no build system, bundler config, or package.json — it is intended to be dropped into an existing React app or used via a sandbox (e.g., StackBlitz, CodeSandbox).

## Architecture

Everything lives in one file:

- **`schema`** — static data object containing the full 5-week program. Two phases: `"Opbouw"` (weeks 1–3, same exercises with progressive overload) and `"Nieuwe Prikkel"` (weeks 4–5, new exercises).
- **`FitnessSchema`** (default export) — top-level component. Manages three pieces of state: `selectedWeek`, `selectedDay`, and `expandedSections`. Derives all display data from `schema` by indexing with those state values.
- **`Section`** — collapsible card wrapper used for each exercise category.
- **`ExRow`** — single exercise row (number badge, name, optional note, sets pill).
- **`dayColors` / `phaseColors`** — lookup maps from day ID / phase name to color tokens. These drive all theming; there is no CSS file.

## Data Shape

Each `week.days[n]` entry has four exercise categories:
- `spiergroep` — muscle-group isolation exercises (array)
- `barbell` — single compound barbell lift (object, not array)
- `kettlebell` — full-body KB movements (array)
- `core` — core finisher exercises (array)

`schema.days` (the 4-day split labels/colors) and `week.days` (the actual exercises) are both indexed by position — `schema.days[i].id` is `i + 1`.

## Language

UI text and exercise notes are in Dutch.
