// "Snel" redesign — feature flag and design tokens.
// Spec: docs/redesign-snel/redesign-snel.md (source of truth for PR 1-5).
// The old look stays the default until the flag-flip PR; every redesigned
// render site branches on `theme ? <new> : <old, unchanged>`, with `theme`
// one of the token objects below (or null for the old look).

export const REDESIGN_KEY = "ui.redesign";

// Per device, in localStorage: "snel" = new look, absent = old look. Any
// storage failure (private mode, blocked site data) reads as off.
export function readRedesignFlag() {
  try { return localStorage.getItem(REDESIGN_KEY) === "snel"; } catch { return false; }
}

export function writeRedesignFlag(on) {
  try {
    if (on) localStorage.setItem(REDESIGN_KEY, "snel");
    else localStorage.removeItem(REDESIGN_KEY);
  } catch { /* localStorage unavailable — the toggle then lasts this session only */ }
}

export const SNEL = {
  bg: "#0E1116",          // page background
  card: "#161B22",        // cards, week tabs, day tiles
  cardBorder: "#232A34",
  row: "#1A1F27",         // exercise rows inside cards
  line: "#232A34",
  line2: "#2A313C",
  headerLine: "#1E242D",  // header bottom border (mockup)
  text: "#EEF1F5",
  text2: "#C2CAD4",
  muted: "#8B95A3",
  dim: "#5E6876",
  accent: "#FF6B3D",      // navigation, kettlebell, summary sheet, score popup
  onAccent: "#0E1116",    // text/icons on an accent fill
  mobility: "#2DD4BF",
  oneRm: "#3DDCFF",       // 1RM series; also deload weeks in the phase bar
  deload: "#3DDCFF",
  gain: "#C6F432",
  success: "#4ADE80",
  peak: { bg: "#3D1519", text: "#FF7B86" },
  // Phase bar (mockup values the spec table doesn't name)
  phaseDone: "#8A3A22",
  phaseDoneDeload: "#1F5966",
  phaseFuture: "#3A4350",
  selectedTile: "#1F1712",
  fontHead: "'Barlow Condensed', sans-serif",
  fontBody: "'Barlow', system-ui, sans-serif",
};

// Archive mode (viewing another year, read-only): same tokens, grey instead
// of orange. Not designed yet — #94A3B8 rather than the old header's #64748b,
// which is too dark under dark text on a selected tab. Deload cyan stays.
export const SNEL_ARCHIVE = { ...SNEL, accent: "#94A3B8", phaseDone: "#4A5260", selectedTile: "#1C2129" };

export function themeFor(snel, readOnly) {
  if (!snel) return null;
  return readOnly ? SNEL_ARCHIVE : SNEL;
}

// Day colour on the dark background, derived from schema_days.kleur. No
// single lighten function lands within a few points of all four approved
// pairs (their target lightness ranges 0.60-0.76), so the approved values
// are explicit and the HSL lighten is only the fallback for an unknown kleur.
const DAY_COLOR_ON_DARK = {
  "#7c3aed": "#A78BFA", // Rug & Biceps
  "#457b9d": "#7FB6DA", // Borst & Triceps
  "#b45309": "#E9A04A", // Schouders
  "#e63946": "#F2636E", // Benen & Billen
};

export function dayColorOnDark(kleur) {
  if (!kleur) return SNEL.accent;
  const known = DAY_COLOR_ON_DARK[kleur.toLowerCase()];
  if (known) return known;
  return lightenForDark(kleur);
}

function lightenForDark(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  if ([r, g, b].some(Number.isNaN)) return SNEL.accent;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const L = Math.max(l, 0.68);
  const S = Math.max(s, 0.6);
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const ch = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${to(ch(h + 1 / 3))}${to(ch(h))}${to(ch(h - 1 / 3))}`.toUpperCase();
}

// Set pill text in the new look (display only; DB values untouched):
// "4x10-12" -> "4×10-12" (mockup), and for mobility "1x60sec" -> "1×60s"
// (spec: "Mobility uses 1×60s").
export function formatSnelSets(sets, { mobility = false } = {}) {
  if (sets == null) return sets;
  let s = String(sets).replace(/(\d)\s*x\s*(\d)/gi, "$1×$2");
  if (mobility) s = s.replace(/(\d)\s*sec\b/gi, "$1s");
  return s;
}

// Rest-timer pill label in the new look: "1 min" / "90 sec" (mockup).
export function formatSnelTimer(seconds) {
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} sec`;
}

// Tag colours for a weight_hint / note segment in the new look. Same
// classification regex as the old hintColors(): weight hints get the
// "+gewicht piek" peak colours, "dropset" the filled Dropset tag,
// anything else ("deload", "60-70%", "per kant") the mockup's neutral
// outline.
export function snelHintTag(theme, segment) {
  if (/gewicht|^\+\d/i.test(segment)) return { bg: theme.peak.bg, fg: theme.peak.text, border: theme.peak.bg };
  if (/^dropset$/i.test(segment)) return { bg: theme.text2, fg: theme.bg, border: theme.text2 };
  return { bg: "transparent", fg: theme.text2, border: theme.phaseFuture };
}
