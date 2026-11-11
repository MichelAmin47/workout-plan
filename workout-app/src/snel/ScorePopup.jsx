// Score popup in the "Snel" look (spec: "Score popup", PR 4). Purely
// presentational: ScorePromptModal in fitness_schema.jsx keeps the two
// score values, the open/close effect (scroll lock, Escape, back gesture)
// and canSubmit, and passes them in, so saving and closing behave exactly
// as in the old look. Own module so a test harness can render it with props.
//
// Props:
//   theme                         redesign tokens
//   dayLabel                      day name shown on top (may be empty)
//   training, motivatie           current values, 0 = not set
//   onTraining, onMotivatie       (n) => void, the old StarPicker onChange
//   trainingLabel, energyLabel    the two questions, from ScorePromptModal
//   trainingDescriptions, energyDescriptions   meaning per star value
//   canSubmit, onSubmit, onClose  as in the old modal
const STAR_PATH = "M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z";

function SnelStarPicker({ theme, label, value, onChange, descriptions }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 16, fontWeight: 600, textAlign: "center" }}>{label}</span>
      <div role="group" aria-label={label} style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={n === 1 ? "1 ster" : `${n} sterren`}
            aria-pressed={n <= value}
            style={{ width: 48, height: 48, border: "none", background: "transparent", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}
          >
            <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill={n <= value ? theme.accent : "none"} stroke={n <= value ? theme.accent : theme.dim} strokeWidth="1.6" strokeLinejoin="round">
              <path d={STAR_PATH} />
            </svg>
          </button>
        ))}
      </div>
      {/* Two lines reserved, as in the old popup, so the stars never shift
          when a longer description wraps. */}
      <span style={{ minHeight: 40, fontSize: 14, lineHeight: "20px", fontStyle: "italic", color: theme.text2, textAlign: "center" }}>
        {value > 0 ? descriptions[value] : ""}
      </span>
    </div>
  );
}

export default function SnelScorePopup({ theme, dayLabel, training, motivatie, onTraining, onMotivatie, trainingLabel, energyLabel, trainingDescriptions, energyDescriptions, canSubmit, onSubmit, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(5,7,10,0.7)", zIndex: 100 }} />
      <div
        role="dialog"
        aria-label={dayLabel ? `Score ${dayLabel}` : "Score"}
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 101, width: "calc(100% - 24px)", maxWidth: 420, boxSizing: "border-box", background: theme.card, border: `1px solid ${theme.line2}`, borderRadius: 20, padding: "22px 20px 20px", display: "flex", flexDirection: "column", gap: 22, color: theme.text, fontFamily: theme.fontBody }}
      >
        {dayLabel && (
          <div style={{ textAlign: "center", fontFamily: theme.fontHead, fontWeight: 700, fontStyle: "italic", fontSize: 30, lineHeight: 1, textTransform: "uppercase" }}>{dayLabel}</div>
        )}
        <SnelStarPicker theme={theme} label={trainingLabel} value={training} onChange={onTraining} descriptions={trainingDescriptions} />
        <SnelStarPicker theme={theme} label={energyLabel} value={motivatie} onChange={onMotivatie} descriptions={energyDescriptions} />
        <button
          type="button"
          onClick={() => canSubmit && onSubmit(training, motivatie)}
          disabled={!canSubmit}
          style={{ minHeight: 52, border: "none", borderRadius: 14, background: canSubmit ? theme.accent : theme.line2, color: canSubmit ? theme.onAccent : theme.dim, fontFamily: theme.fontHead, fontWeight: 700, fontStyle: "italic", fontSize: 20, letterSpacing: 1, textTransform: "uppercase", cursor: canSubmit ? "pointer" : "default", WebkitAppearance: "none", appearance: "none" }}
        >
          Opslaan
        </button>
      </div>
    </>
  );
}
