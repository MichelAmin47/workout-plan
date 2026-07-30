export default function CheckinCard({ eyebrow, question, contextLabel, contextText }) {
  return (
    <div className="checkin-card">
      <div className="checkin-eyebrow">{eyebrow}</div>
      <div className="checkin-question">{question}</div>
      <div className="checkin-context">
        <strong>{contextLabel}</strong> {contextText}
      </div>
    </div>
  )
}
