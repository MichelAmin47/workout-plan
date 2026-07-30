export function UserBubble({ text, time }) {
  return (
    <div className="msg-user">
      <div className="bubble-user">{text}</div>
      {time && <div className="msg-time">{time}</div>}
    </div>
  )
}

export function CoachBubble({ text, time }) {
  return (
    <div className="msg-coach">
      <div className="msg-coach-avatar">🌿</div>
      <div>
        <div className="bubble-coach">{text}</div>
        {time && <div className="msg-time">{time}</div>}
      </div>
    </div>
  )
}
