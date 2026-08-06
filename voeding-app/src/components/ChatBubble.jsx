import { renderCoachMarkdown } from '../lib/renderMarkdown.js'

// User bubbles stay plain text — the user isn't writing markdown, and
// rendering it here risks mangling something they typed literally (e.g.
// literal asterisks).
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
        <div className="bubble-coach" dangerouslySetInnerHTML={{ __html: renderCoachMarkdown(text) }} />
        {time && <div className="msg-time">{time}</div>}
      </div>
    </div>
  )
}
