export default function SummaryCard({ eyebrow, text, note, streak }) {
  return (
    <div className="summary-card">
      <div className="summary-eyebrow">{eyebrow}</div>
      <div className="summary-text">{text}</div>
      <div className="summary-divider" />
      <div className="summary-note">
        <strong>Wat ik onthoud voor morgen:</strong>
        <br />
        {note}
      </div>
      <div className="streak-pill">{streak}</div>
    </div>
  )
}
