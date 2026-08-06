import { useEffect, useRef, useState } from 'react'
import './Coach.css'
import DayMarker from './DayMarker.jsx'
import CheckinCard from './CheckinCard.jsx'
import MealCard from './MealCard.jsx'
import SummaryCard from './SummaryCard.jsx'
import { UserBubble, CoachBubble } from './ChatBubble.jsx'
import TypingIndicator from './TypingIndicator.jsx'
import SendIcon from './SendIcon.jsx'
import { buildOpeningMessages, quickReplyOptions, makeMessageId } from '../data/seedMessages.js'
import { askCoach } from '../lib/chatApi.js'
import { supabase } from '../supabase.js'
import { todayDateString, loadStoredThread, saveThread, clearThread } from '../lib/threadStorage.js'
// TEMPORARY — remove after block 4 verification
import { fireTestNotification } from '../lib/dailyReminder.js'

const FALLBACK_ERROR_TEXT = 'Sorry, ik kan even niet reageren — probeer het zo nog eens.'
const CLOSE_DAY_RESET_DELAY_MS = 1500

function nowTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// The coach_sessions row id (or null) for a date — used both as the
// staleness baseline stamped onto a fresh thread and as the comparison
// value on the next app open.
async function fetchSummaryId(date) {
  const { data } = await supabase.from('coach_sessions').select('id').eq('datum', date).limit(1)
  return data && data.length > 0 ? data[0].id : null
}

// Same lookup as fetchSummaryId but with the actual summary content — used
// right after a close to show what was just written, instead of just
// tracking that *something* was written.
async function fetchTodaySummary(date) {
  const { data } = await supabase.from('coach_sessions').select('id, samenvatting, aandachtspunt').eq('datum', date).limit(1)
  return data && data.length > 0 ? data[0] : null
}

export default function Coach() {
  const [messages, setMessages] = useState([])
  const [threadDate, setThreadDate] = useState(null)
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  // The just-written summary, shown once above the fresh thread right after
  // a close. Deliberately NOT part of `messages` (never persisted to
  // localStorage) — a fresh app launch is a fresh mount, so this simply
  // isn't there anymore on reopen, with no invalidation logic needed. Only
  // ever set inside the daySummaryWritten branch below, so a normal mid-day
  // open or a failed close never touches it.
  const [justClosedSummary, setJustClosedSummary] = useState(null)
  const scrollRef = useRef(null)
  // Not rendered, so a ref is enough — read at save time, written whenever a
  // thread is (re)stamped fresh. See threadStorage.js for why this exists.
  const summaryIdAtStartRef = useRef(null)

  // Quick replies only make sense while the most recent thing in the thread
  // is a check-in question nobody has answered yet.
  const showQuickReplies = !isTyping && messages[messages.length - 1]?.type === 'checkin-card'

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, isTyping])

  // On mount: resume a stored thread unless a summary appeared for its date
  // *after* the thread was stamped fresh (the cron fallback closed it out
  // server-side while we were away — the server can't touch localStorage
  // itself, so this comparison is how the client catches up). Comparing
  // against summaryIdAtStart, not just "does a row exist," matters: a day
  // can easily already have a summary (an earlier manual close) while the
  // *current* stored thread is a brand-new, still-valid conversation that
  // started after that close. No stored thread at all just starts fresh.
  useEffect(() => {
    let cancelled = false

    async function restoreThread() {
      const stored = loadStoredThread()
      if (!stored) {
        const today = todayDateString()
        summaryIdAtStartRef.current = await fetchSummaryId(today)
        if (cancelled) return
        setMessages(buildOpeningMessages(summaryIdAtStartRef.current !== null))
        setThreadDate(today)
        return
      }

      const currentId = await fetchSummaryId(stored.date)
      if (cancelled) return

      if (currentId !== (stored.summaryIdAtStart ?? null)) {
        const today = todayDateString()
        clearThread()
        summaryIdAtStartRef.current = await fetchSummaryId(today)
        if (cancelled) return
        setMessages(buildOpeningMessages(summaryIdAtStartRef.current !== null))
        setThreadDate(today)
      } else {
        summaryIdAtStartRef.current = stored.summaryIdAtStart ?? null
        setMessages(stored.messages)
        setThreadDate(stored.date)
      }
    }

    restoreThread()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist on every change, once we know which date this thread belongs to
  // (guards against overwriting a not-yet-restored stored thread with the
  // initial seed before the mount check above has run).
  useEffect(() => {
    if (threadDate) {
      saveThread(threadDate, messages, summaryIdAtStartRef.current)
    }
  }, [threadDate, messages])

  async function sendMessage(text) {
    const trimmed = text.trim()
    if (!trimmed) return

    const userMessage = { id: makeMessageId(), type: 'user', text: trimmed, time: nowTime() }
    const threadWithUserMessage = [...messages, userMessage]
    setMessages(threadWithUserMessage)
    setInputValue('')
    setIsTyping(true)

    let replyText
    let daySummaryWritten = false
    try {
      const result = await askCoach(threadWithUserMessage)
      replyText = result.reply
      daySummaryWritten = result.daySummaryWritten
    } catch (err) {
      console.error('coach-chat call failed', err)
      replyText = FALLBACK_ERROR_TEXT
    }

    setIsTyping(false)
    setMessages((prev) => [...prev, { id: makeMessageId(), type: 'coach', text: replyText, time: nowTime() }])

    // Only clear on a confirmed successful close — a failed close_day_summary
    // call must leave the thread exactly as it was, so nothing is lost.
    if (daySummaryWritten) {
      clearThread()
      setTimeout(async () => {
        const today = todayDateString()
        const summary = await fetchTodaySummary(today)
        summaryIdAtStartRef.current = summary?.id ?? null
        setJustClosedSummary(
          summary ? { eyebrow: 'Dag afgesloten', text: summary.samenvatting, note: summary.aandachtspunt } : null,
        )
        setMessages(buildOpeningMessages(summary != null))
        setThreadDate(today)
      }, CLOSE_DAY_RESET_DELAY_MS)
    }
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
          {/* TEMPORARY — remove after block 4 verification */}
          <button type="button" className="test-notification-btn" onClick={fireTestNotification}>
            🔔 test
          </button>
        </div>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {justClosedSummary && (
          <SummaryCard eyebrow={justClosedSummary.eyebrow} text={justClosedSummary.text} note={justClosedSummary.note} />
        )}
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
