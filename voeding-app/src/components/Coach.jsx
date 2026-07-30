import { useEffect, useRef, useState } from 'react'
import './Coach.css'
import DayMarker from './DayMarker.jsx'
import CheckinCard from './CheckinCard.jsx'
import MealCard from './MealCard.jsx'
import SummaryCard from './SummaryCard.jsx'
import { UserBubble, CoachBubble } from './ChatBubble.jsx'
import TypingIndicator from './TypingIndicator.jsx'
import SendIcon from './SendIcon.jsx'
import { seedMessages, quickReplyOptions, makeMessageId } from '../data/seedMessages.js'
import { askCoach } from '../lib/chatApi.js'

const FALLBACK_ERROR_TEXT = 'Sorry, ik kan even niet reageren — probeer het zo nog eens.'

function nowTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Coach() {
  const [messages, setMessages] = useState(seedMessages)
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const scrollRef = useRef(null)

  // Quick replies only make sense while the most recent thing in the thread
  // is a check-in question nobody has answered yet.
  const showQuickReplies = !isTyping && messages[messages.length - 1]?.type === 'checkin-card'

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, isTyping])

  async function sendMessage(text) {
    const trimmed = text.trim()
    if (!trimmed) return

    const userMessage = { id: makeMessageId(), type: 'user', text: trimmed, time: nowTime() }
    const threadWithUserMessage = [...messages, userMessage]
    setMessages(threadWithUserMessage)
    setInputValue('')
    setIsTyping(true)

    let replyText
    try {
      replyText = await askCoach(threadWithUserMessage)
    } catch (err) {
      console.error('coach-chat call failed', err)
      replyText = FALLBACK_ERROR_TEXT
    }

    setIsTyping(false)
    setMessages((prev) => [...prev, { id: makeMessageId(), type: 'coach', text: replyText, time: nowTime() }])
  }

  function handleSubmit(e) {
    e.preventDefault()
    sendMessage(inputValue)
  }

  function handleQuickReply(option) {
    setInputValue(option)
  }

  return (
    <div className="app">
      <div className="coach-header">
        <div className="coach-identity">
          <div className="coach-avatar">🌿</div>
          <div>
            <div className="coach-name">Coach</div>
            <div className="coach-status">Jouw voedingscoach</div>
          </div>
        </div>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((msg) => {
          switch (msg.type) {
            case 'day-marker':
              return <DayMarker key={msg.id} label={msg.label} />
            case 'checkin-card':
              return (
                <CheckinCard
                  key={msg.id}
                  eyebrow={msg.eyebrow}
                  question={msg.question}
                  contextLabel={msg.contextLabel}
                  contextText={msg.contextText}
                />
              )
            case 'meal-card':
              return <MealCard key={msg.id} title={msg.title} tag={msg.tag} items={msg.items} macros={msg.macros} />
            case 'summary-card':
              return (
                <SummaryCard key={msg.id} eyebrow={msg.eyebrow} text={msg.text} note={msg.note} streak={msg.streak} />
              )
            case 'user':
              return <UserBubble key={msg.id} text={msg.text} time={msg.time} />
            case 'coach':
              return <CoachBubble key={msg.id} text={msg.text} time={msg.time} />
            default:
              return null
          }
        })}
        {isTyping && <TypingIndicator />}
      </div>

      {showQuickReplies && (
        <div className="quick-replies">
          {quickReplyOptions.map((option) => (
            <button key={option} type="button" className="quick-reply" onClick={() => handleQuickReply(option)}>
              {option}
            </button>
          ))}
        </div>
      )}

      <form className="input-bar" onSubmit={handleSubmit}>
        <input
          className="input-field"
          type="text"
          placeholder="Typ een bericht…"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
        <button className="send-btn" type="submit" disabled={!inputValue.trim()}>
          <SendIcon />
        </button>
      </form>
    </div>
  )
}
