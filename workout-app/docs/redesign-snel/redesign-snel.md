# Workout app — "Snel" redesign spec

Status: all blocks approved by Michel on 9 November 2026. PR 1 merged 10 November 2026 (PR #23). PR 2 merged 11 November 2026 (PR #24). PR 3 in review. This is the single
source of truth for the redesign. The three HTML files in `reference/` are the
approved mockups (made in a design canvas, not runnable React). Copy exact
values from them when this spec is silent; when this spec and a mockup differ,
this spec wins.

**Scope: look only.** Data, queries, logic, gestures and behaviour stay exactly
as they are. If something below seems to require a behaviour change, stop and
ask. Exceptions are listed explicitly (they are all removals).

## Rollout: feature flag

- The new look sits behind a per-device flag (`localStorage`, key
  `ui.redesign`, values `"snel"` / absent). Old look = default until the final
  PR flips it.
- Toggle: tap the week title in the header 5 times within 3 seconds. Show a
  short toast ("Nieuwe stijl aan" / "Nieuwe stijl uit"). No other UI for it.
- Old and new styles live side by side until the cleanup PR. Prefer a style
  token object per theme over scattered conditionals.

## Design tokens

| Token | Value | Use |
|---|---|---|
| `bg` | `#0E1116` | Page background |
| `card` | `#161B22` | Cards (border `#232A34`, radius 16) |
| `row` | `#1A1F27` | Exercise rows inside cards (radius 12) |
| `line` | `#232A34` / `#2A313C` | Borders, dividers |
| `text` | `#EEF1F5` | Primary text |
| `text2` | `#C2CAD4` | Secondary text |
| `muted` | `#8B95A3` | Labels, meta |
| `dim` | `#5E6876` | Rest-day icons, empty stars |
| `accent` | `#FF6B3D` | Navigation (header, week tabs, day strip), kettlebell block, summary sheet, score popup |
| `mobility` | `#2DD4BF` | Mobility block, always |
| `oneRm` | `#3DDCFF` | 1RM series in charts; deload weeks in the phase bar |
| `gain` | `#C6F432` | Weight increase ("+2 kg") |
| `success` | `#4ADE80` | Saved checkmark in the log panel; new PR text |
| `peak` | bg `#3D1519`, text `#FF7B86` | "+gewicht piek" tag |

**Day colour.** Supersets, losse oefeningen, core, and optional losse
oefeningen use the day colour of the selected training day: `schema_days.kleur`
lightened for the dark background. Mapping (derive from `kleur`; do not
hardcode by name if a lighten function gives the same result within a few
points):

| Spiergroep | `schema_days.kleur` | On dark |
|---|---|---|
| Rug & Biceps | `#7c3aed` | `#A78BFA` |
| Borst & Triceps | `#457b9d` | `#7FB6DA` |
| Schouders | `#b45309` | `#E9A04A` |
| Benen & Billen | `#e63946` | `#F2636E` |

**Fonts** (Google Fonts): Barlow Condensed (600, 700, 700 italic) for headings,
numbers, pills and labels; Barlow (400, 500, 600, 600 italic) for body text.
Everything slants: headings, numbers, exercise names and the skewed number
squares (`skewX(-8deg)`). Set pills are NOT italic.

**Icons:** line icons (stroke SVG) replace every emoji.

## Shared components

- **Exercise row:** min-height 44 px, `box-sizing: border-box`, padding 6 px
  12 px, 6 px between rows, 12 px card padding. Little space above/below the
  name. Name: Barlow 600 italic 16 px.
- **Number square:** 26 × 26, radius 7–8, filled in the block colour, dark
  number (Barlow Condensed 700 italic), skewed.
- **Done:** the square becomes dark (`bg`) with a 1.5 px border and a checkmark
  in the block colour. Name is NOT dimmed. Applies to every block.
- **Set pill:** outlined in the block colour, text in the block colour, Barlow
  Condensed 700 15 px, not italic. Mobility uses "1×60s" (× sign, "s").
- **Tags:** BB = filled `#EEF1F5` with dark text; DB = filled `#3B82F6` with
  white text; Dropset = filled `#C2CAD4` with dark text; "+gewicht piek" =
  `peak`; Optioneel = dashed outline in the block colour.
- **Rest-timer pill (block header, right):** filled `#EEF1F5`, dark text and
  stopwatch icon, Barlow Condensed 700 italic 15 px, radius 8. Not in the
  block colour.
- **Section title:** Barlow Condensed 700 italic 20 px, uppercase, letter
  spacing 0.4 px, nowrap, with a block-colour line icon in front.

## Training day (top to bottom)

1. **Header.** No orange bar: dark background. Top row: "2026 · WEEK 44–53 ⌄"
   (muted, opens the existing year/block sheet) left, phase label right as a
   skewed filled pill (accent; cyan when the current week is a deload). Big
   title "WEEK 3 / 10" (x / y, "/ 10" muted), Barlow Condensed 700 italic
   44 px. Under it the **phase bar**: weeks grouped per phase from
   `schema_weeks.phase`. Every week has the same width, deload weeks
   included: each group's width grows with its week count (no fixed width
   for deload groups). Only the current group shows its phase name above it,
   coloured (a block like 37–43 has a different phase every week, and all
   names don't fit at phone width). Done weeks dimmed accent, current week
   taller with a white outline, future weeks outlined only, deload weeks
   cyan. Replaces the old phase badge.
2. **Week tabs.** Same behaviour as now: all weeks with training data,
   horizontal scroll, current week centred on open. Calendar week labels
   ("Week 46"). Small and calm: Barlow 500 15 px, `muted` on `card`, no
   border, height 36; selected = accent fill, dark bold text.
3. **Day strip.** Seven dark tiles. Today: small accent dot on top. Selected:
   accent border and accent day name. Done: accent checkmark. Training day not
   done: dumbbell icon. Anti-zit: car icon. Vrije dag: beach-umbrella icon
   (rest icons `dim`). No per-muscle-group colours. Under the selected tile:
   the summary tab (30 × 18, radius `0 0 9px 9px`, accent fill, dark chevron,
   44 × 32 hit area) — same visibility rules and behaviour as now.
4. **Day title:** none (removed in review; the tile already names the day).
5. **Mobility.** Teal everywhere (icon, squares, pills, done). Timer pill kept.
6. **Supersets.** Label "SUPERSET 1" as plain italic text in the day colour (no
   pill, no line). Each superset in a dark inner frame (`row` bg, `#2A313C`
   border). "GEEN RUST →" connector between partners with a short day-colour
   bar.
7. **Losse oefeningen.** Day colour. Optional exercise: dashed frame, dashed
   number square and dashed pill, all in the day colour; tags "OPTIONEEL" then
   "+gewicht piek" under the name.
8. **Kettlebell.** Always accent orange. HIIT info on one compact line inside
   an accent-outlined box: "HIIT per oefening" left, "40s werk / 20s rust"
   right (numbers 18 px). The 40s | 20s split pill on the row stays.
9. **Core finisher.** Day colour, same rows. No special handling for
   exercises without weight.
10. **Footer line** ("Core dagelijks herhalen · Rust…"): removed.
11. **Progressie hint card** (green "Verhoog het gewicht elke week…"): removed.
12. **Progressie.** Collapsible card, accent icon, chevron accent when open.
    Open: dark native `<select>` (accent triangle) with the exercise; stats row
    "MAX GEWICHT 45 kg +25 kg" (accent / `gain`) and right "1RM 57 kg"
    (`oneRm`); chart with orange weight line + dots, cyan 1RM dots, subtle grid,
    dashed line on the current week, x-axis labels every 6th week; legend
    "gewicht" / "1RM". Data and logic unchanged. The word "geschat" is dropped
    from labels.

### Inline log panel (unchanged behaviour)

Opens under the tapped exercise, as now. Tinted strip (day colour 8 % over
`row`), indented to the name. Row: kg input (empty, placeholder "kg", day-colour
border, 44 px high, Barlow Condensed 700 italic 22 px) — a fixed 28 px slot for
the existing save-success checkmark (`success`, keeps its space when hidden) —
reps stepper (− n +, dark box, 44 px). Line under it: "Laatste keer — Week 45 ·
**45kg × 8** · PR **45kg**" (12 px, values `text`); the PR value turns
`success` green when a new PR is set. No Opslaan button.

### Timer bar (look only; behaviour, phases and buttons as now)

Replaces the full-width coloured bar at the bottom. A floating dark bar:
margin 0 10 px, 14 px above the bottom edge, padding 10 × 12, radius 18,
background `bg` (`#0E1116`), 1 px border in the block colour at 55 %
(`color-mix(in srgb, <block colour> 55%, #0E1116)`), shadow
`0 -8px 24px rgba(0,0,0,.45)`.
- Left: countdown ring 64 px (track `#3A4350`, 5 px; progress in the block
  colour, round caps, starting at 12 o'clock), time centred in Barlow Condensed
  700 italic 20 px.
- Middle: state line (Barlow Condensed 600, 12 px, letter spacing 1.5 px, block
  colour): "RUST", "WERK", or "GEPAUZEERD" (muted). Under it the block name
  with its line icon, Barlow Condensed 700 italic 17 px uppercase, ellipsis if
  too long. Uses the same label the current bar shows (e.g. "Supersets",
  the KB exercise).
- Right: the existing buttons as 42 × 44 icon buttons (radius 12, `#232A34`,
  white line icons): pause/play, restart, stop. When the current bar shows the
  lock (HIIT / input block), the lock button takes the middle slot: filled in
  the block colour with a dark icon when input is blocked, normal button when
  not.
- Paused: ring progress `muted`, play icon instead of pause.
- Block colour = the colour of the block whose timer runs (mobility teal, day
  colour, kettlebell accent).

## Summary sheet (stays accent orange, no day colour)

- Header: grab handle, "SAMENVATTING" small accent, day name big condensed
  italic, date line "wo 21 okt · week 43 · piek gewicht" (phase from the
  schedule, as now), round close button.
- Two stat tiles, in the current order: exercises, then PR's (accent number).
  No "extra's" tile.
- Ratings: two cards (Training, Energie), five stars (filled accent, empty =
  `dim` outline), the note under it. No number.
- Exercises per group: grey group labels; name italic with accent PR labels;
  "16 kg × 10" big; increase "+2 kg" in `gain`, italic; "Vorige keer…" muted;
  sparkline orange (weight) + cyan (1RM).
- Mobility, KB & core: done pills keep a tinted fill + checkmark, colour per
  row: mobility teal, KB accent, core day colour. Count in the same colour once
  something is done. Names not italic.
- Legend + 1RM explanation text: unchanged.

## Score popup (long-press on a day)

Look only; questions, per-star meaning lines and behaviour come from the code.
Dimmed background, dark card (`card`, radius 20). Day name big condensed
italic. Each question in Barlow 600, five 36 px stars in 48 px tap targets
(filled accent / `dim` outline), meaning line in italic under the stars.
Opslaan: grey and disabled until both scores are set, then accent with dark
text, condensed italic uppercase.

## Not designed yet — apply the same rules, flag in the PR

Rest-day content, Power Hour / Boksen cards, archive mode (grey header, year
sheet), swap sheet. Use the tokens and components above, keep behaviour, and
list them in the PR description with screenshots so Michel can review.

## Testing rules (all PRs)

- Tests run against the live Supabase project from the personal "workout-plan"
  environment (only `nhcgepdrbrvfukxpbhmi.supabase.co` allowed). The database
  has open RLS policies, so the test harness must abort and count every
  non-GET request to Supabase; the expected count is 0.
- No long-press, typing into inputs, swipes that select or other writes in
  tests. Michel tests those on the phone.
- Screenshots go on a private claude.ai Artifact page linked from the PR, never
  into git.
- After the redesign: remove the environment or fix the open RLS policies.

## PR plan

1. Flag + tokens + fonts + header with phase bar + week tabs + day strip (incl.
   summary tab). Adds this spec and `reference/` to the repo. **Merged**
   (MichelAmin47/workout-plan#23, 10 Nov 2026).
2. Training-day blocks 5–12 (rows, day colours, done state, tags, timer pills,
   kettlebell, progressie). **Merged** (MichelAmin47/workout-plan#24, 11 Nov
   2026).
3. Inline log panel, plus contrast pass step 1 and the timer bar (see below).
   In review.
4. Summary sheet + score popup.
5. Flag on by default. After a week without issues: remove old styles and the
   flag. Also in this PR: loading screen ("Schema laden…") in the dark style.
   Until then it stays light, so with the flag on there is a short light flash
   before the dark header appears.

Added 10 Nov 2026, to design first in the canvas, then build (order with
PR 3/4 to be decided) → both in PR 3:
- **Contrast pass:** the overall look reads as one large black area. Decided
  11 Nov 2026 (step 1, more may follow): keep all current background, card and
  row colours; add a 1 px border to exercise rows in the block colour at 38 %
  over the row background (`color-mix(in srgb, <block colour> 38%, #1A1F27)`).
  Applies to standalone rows (mobility, losse oefeningen incl. optional, core,
  kettlebell) and to the superset inner frame (the rows inside a superset stay
  borderless). Optional rows keep their dashed border. Mockup:
  `ContrastD.dc.html`.
- **Timer block:** approved 11 Nov 2026, mockup `TimerStaten.dc.html`. See
  "Timer bar" above.

## Decisions in PR 2 (not covered by the spec above)

Agreed with Michel before the build:

- **Hint cards:** with the flag on, both phase hint cards are removed: the
  green "Progressie" card (item 11) and the purple "Nieuwe prikkel" card,
  which is the same kind of hint and is not in the mockup.
- **Schema 1 (2026 weeks 23–30):** same rules. "Spiergroep oefeningen" works
  like Losse oefeningen (day colour). "Barbell hoofdoefening" is a normal dark
  row with a BB tag in accent (it was brand orange). Its long press stays on
  the whole row.
- **Progressie 1RM stat:** the highest estimated 1RM among the chart's points
  (it sits next to MAX GEWICHT); "—" when the exercise has no 1RM point.

Chosen in the build, to review:

- **Active timer pill:** filled in the block colour with dark text (the spec
  only describes the idle `#EEF1F5` pill). The bottom timer bar is not
  redesigned yet and keeps its old colours.
- **Set pills:** `x` between digits shows as `×` in every pill (as in the
  mockup); mobility also shows `sec` as `s`. Timer label "1 min" / "90 sec".
  Display only; database values are untouched.
- **Hint tags:** a segment matching `gewicht` or `+<digit>` gets the `peak`
  colours ("+gewicht", "+gewicht piek", "zonder gewicht" too, the same rule as
  the old red pill); "dropset" gets the Dropset tag; anything else ("deload",
  "60-70%", "nieuw", "full body") gets the mockup's neutral outline (`#3A4350`
  border, `text2`). Segments over 20 characters stay plain muted text.
  Equipment "cable" / "machine" (not designed) use the neutral outline too.
- **GEWIJZIGD** (swapped KB/core): solid outline tag in the block colour;
  "↩ original" in `muted`; the swipe-back "↩ Terug" hint in `peak.text`.
- **Optional KB exercise** (e.g. KB Renegade Row, block 37–43): the same
  dashed frame / square / tag as an optional losse oefening, in accent (the
  mockup shows exactly this).
- **1RM series:** cyan dots only, no line (spec: "cyan 1RM dots"); the old
  look keeps its blue line.
- **Archive:** everything that uses accent (kettlebell, progressie, Power
  Hour) follows the archive grey, as the header does since PR 1. Day colours
  and teal stay.
- **Not designed yet, same tokens applied:** Anti-zit and Vrije dag cards
  (line icons per goal type: stairs, standing figure, moon, wind, people,
  sparkle), Power Hour / Boksen cards (accent, the PR 1 tile icons, stars
  filled accent / `dim` outline, accent "Score aanpassen" button), the swap
  sheet (dark sheet, accent "WISSEL VOOR", accent arrows).
- **Inline log panel:** until PR 3 it only gets a dark background, a dark
  divider and light value text; inputs and stepper are unchanged.

## Decisions in PR 3 (not covered by the spec above)

Agreed with Michel before the build:

- **Timer bar states map onto the timer as it is (11 Nov 2026).** Every
  timer, KB included, is one rest countdown; there is no work phase, so
  "WERK" never shows. The input lock is not HIIT-only: it switches on at
  every start and every restart, as before. While locked the bar shows only
  the lock button in the middle slot (filled in the block colour, dark icon)
  = the existing unlock (🔓); the side slots stay empty, so nothing new
  becomes tappable. Unlocked: pause/play, restart, stop. There is no way to
  lock again except restart, so mockup state 4 ("lock as a normal button")
  does not occur; a KB timer after unlocking looks like state 1.
- **Timer colour of a timer started with the flag off:** if the flag is
  turned on while it runs, the bar uses `accent` and no icon.

Chosen in the build, to review:

- **Block colour of the timer** is captured when the timer starts (mobility
  teal; supersets, losse oefeningen, schema-1 spiergroep and core the day
  colour; kettlebell and schema-1 barbell accent), so switching day does not
  recolour a running timer.
- **Name in the bar:** the same label the old bar shows, i.e. the section
  name ("Supersets", "Kettlebell (Full Body)"), not the KB exercise.
- **Done state** (not designed): ring full in `success`, bell icon instead of
  the time, state line "KLAAR", "Rust voorbij, ga!" under it, border
  `success` at 55 %; buttons restart and stop (no pause, as before).
- **Icon buttons** use `#232A34` (spec), not the mockup's `#262D38`.
- **Active timer pill** (PR 2: filled in the block colour, dark text) stays;
  it matches the bar's block colour.
- **Inline log panel colour** = the colour of the row's block: day colour for
  supersets, losse oefeningen and schema-1 spiergroep; accent for kettlebell
  and the schema-1 barbell card.
- **Panel input** stays `type="number"` (no switch to a text field with a
  decimal keyboard: that would change input behaviour). Only person M is
  rendered; the Z column was already hidden and unreachable.
- **PR value** in the "Laatste keer" line is semibold (`text`), bold
  `success` when the logged weight equals the PR (same rule as before).
- **Row borders** also on the schema-1 barbell card (a standalone row, not in
  the spec list), in accent.
