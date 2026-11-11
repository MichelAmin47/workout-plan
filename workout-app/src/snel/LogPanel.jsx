import PrText from "./PrText.jsx";

// Inline log panel in the "Snel" look (spec: "Inline log panel (unchanged
// behaviour)", PR 3). Purely presentational: every call site passes its
// existing values and handlers, so saving, the success tick, reps prefill
// and PR detection stay exactly where they were. Only person M is shown; the
// Z column has been display:none (unreachable) in the old look for years.
//
// Props:
//   theme, color            redesign tokens + the block colour of the row
//   weight, onWeightChange  kg value and (value) => void, as the old input
//   saved                   show the save-success tick (space kept when false)
//   reps                    number | null — the stepper value ("–" when null)
//   onRepsMinus/onRepsPlus  the old − / + onClick bodies
//   readOnly                archive: input disabled, stepper buttons hidden
//   hasPrev, prevLabel, prevText   the "Laatste keer" part of the line
//   pr, currentWeight       passed to PrText (green when currentWeight = PR)
export default function SnelLogPanel({ theme, color, weight, onWeightChange, saved, reps, onRepsMinus, onRepsPlus, readOnly, hasPrev, prevLabel, prevText, pr, currentWeight }) {
  const stepBtn = {
    width: 42, height: 42, padding: 0, border: "none", background: "transparent",
    color: theme.text2, fontFamily: theme.fontBody, fontSize: 22, fontWeight: 600, lineHeight: "42px", textAlign: "center",
  };
  return (
    <div
      style={{ background: `color-mix(in srgb, ${color} 8%, ${theme.row})`, borderTop: `1px solid ${theme.line}`, padding: "4px 12px 12px 50px", display: "flex", flexDirection: "column", gap: 8 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8 }}>
        <input
          type="number"
          disabled={readOnly}
          step="any"
          min={0}
          value={weight}
          onChange={(e) => onWeightChange(e.target.value)}
          placeholder="kg"
          aria-label="Gewicht in kg"
          style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", border: `1px solid ${color}`, borderRadius: 10, background: theme.bg, color: theme.text, padding: "0 12px", fontFamily: theme.fontHead, fontWeight: 700, fontStyle: "italic", fontSize: 22, outline: "none", opacity: readOnly ? 0.6 : 1 }}
        />
        <span role="status" aria-label={saved ? "Opgeslagen" : undefined} style={{ width: 28, height: 28, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", visibility: saved ? "visible" : "hidden" }}>
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={theme.success} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L19 7" /></svg>
        </span>
        <div style={{ display: "flex", alignItems: "center", height: 44, boxSizing: "border-box", border: `1px solid ${theme.line2}`, borderRadius: 10, background: theme.bg, overflow: "hidden", flex: "none" }}>
          <button
            type="button"
            aria-label="Minder reps"
            hidden={readOnly}
            disabled={reps == null}
            onClick={onRepsMinus}
            style={{ ...stepBtn, cursor: reps == null ? "default" : "pointer", opacity: reps == null ? 0.4 : 1 }}
          >−</button>
          <span aria-live="polite" style={{ minWidth: 34, padding: readOnly ? "0 12px" : 0, textAlign: "center", fontFamily: theme.fontHead, fontWeight: 700, fontStyle: "italic", fontSize: 22, color: theme.text, userSelect: "none" }}>
            {reps ?? "–"}
          </span>
          <button
            type="button"
            aria-label="Meer reps"
            hidden={readOnly}
            onClick={onRepsPlus}
            style={{ ...stepBtn, cursor: "pointer" }}
          >+</button>
        </div>
      </div>
      {(hasPrev || pr) && (
        <span style={{ fontFamily: theme.fontBody, fontSize: 12, lineHeight: 1.35, color: theme.muted }}>
          {hasPrev && <>{prevLabel} · <span style={{ color: theme.text, fontWeight: 600 }}>{prevText}</span></>}<PrText theme={theme} pr={pr} currentWeight={currentWeight} standalone={!hasPrev} />
        </span>
      )}
    </div>
  );
}
