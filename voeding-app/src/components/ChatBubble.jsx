import { renderCoachMarkdown } from '../lib/renderMarkdown.js'
import BoltIcon from './BoltIcon.jsx'

// User bubbles stay plain text — the user isn't writing markdown, and
// rendering it here risks mangling something they typed literally (e.g.
// literal asterisks). A quick-log tap ("snel loggen") is a compact bubble
// with a small bolt: "<favourite> · HH:MM". A plate photo shows a "📷 foto"
// chip, never the image: the thread doesn't store it, so the bubble looks
// the same after an app restart (no broken image).
export function UserBubble({ text, time, quickLog, foto }) {
  return (
    <div className="msg-user">
      {quickLog ? (
        <div className="bubble-user bubble-user-quick">
          <BoltIcon size={13} />
          <span>{text}</span>
        </div>
      ) : (
        <div className="bubble-user">
          {foto && <div className={`foto-chip${foto === 'mislukt' ? ' foto-chip-mislukt' : ''}`}>{foto === 'mislukt' ? '📷 foto — niet verstuurd' : '📷 foto'}</div>}
          {text}
        </div>
      )}
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
