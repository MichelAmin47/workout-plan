export default function CheckinCard({ eyebrow, question, boodschap, contextLabel, contextText }) {
  return (
    <div className="checkin-card">
      <div className="checkin-eyebrow">{eyebrow}</div>
      <div className="checkin-question">{question}</div>
      {boodschap && <div className="checkin-boodschap">{boodschap}</div>}
      <div className="checkin-context">
        <strong>{contextLabel}</strong> {contextText}
      </div>
    </div>
  )
}
