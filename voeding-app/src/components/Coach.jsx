import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
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
import { fetchProteinProgress } from '../lib/dayProgress.js'
import { todayDateString, loadStoredThread, saveThread, clearThread } from '../lib/threadStorage.js'
import { shouldShowCheckin, hasShownCheckinToday, markCheckinShown, fetchMorningCheckin } from '../lib/morningCheckin.js'

const FALLBACK_ERROR_TEXT = 'Sorry, ik kan even niet reageren — probeer het zo nog eens.'
// Same intent as the block 4b opening variant, phrased for arriving
// mid-conversation (via a notification tap) rather than as a greeting.
const NOTIFICATION_TAP_QUESTION = 'Is er nog iets dat je vandaag hebt gegeten dat ik nog niet weet, zodat ik de dag kan samenvatten? 🌿'

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

// A thread left open (or just resumed) past midnight keeps presenting
// itself as the previous day — nothing invalidates it on a plain calendar
// rollover with no summary event involved. Discarding that thread would
// lose a conversation the user may not have finished; silently relabelling
// it as today would mix yesterday's messages into today with no boundary.
// Instead: keep everything, insert a day-marker, and start today's opening
// right after it — same DayMarker component the original mock already had
// for exactly this, just never wired up to anything until now.
async function buildRolloverTransition(previousMessages, previousDate, today) {
  const [progress, summaryId] = await Promise.all([fetchProteinProgress(today, previousDate), fetchSummaryId(today)])
  const marker = { id: makeMessageId(), type: 'day-marker', label: 'Vandaag' }
  const opening = await buildDailyOpening(summaryId !== null, progress, today)
  // A day-close-button left untapped from a manual close on `previousDate`
  // is stale by the time a rollover fires — this transition already starts
  // the new day itself (via the opening below), and tapping the stale
  // button afterwards would clearThread() and wipe the new day's
  // just-appended messages using a now-outdated activeDate. Drop it rather
  // than carry it forward as dead history.
  const carryOver = previousMessages.filter((m) => m.type !== 'day-close-button')
  return { messages: [...carryOver, marker, ...opening], summaryId }
}

// Block 5: wraps buildOpeningMessages with the morning check-in card
// decision. Called from every genuine "first open of today" moment (the
// mount effect's fresh-thread and cron-invalidated branches, and the
// rollover transition above, which also covers the visibilitychange
// midnight-crossing path since it's the same function) — deliberately NOT
// called from the close_day_summary reset in sendMessage, since that's a
// fresh thread starting mid-conversation right after a close, not an app
// open, and a check-in card there would be a non-sequitur.
//
// hasShownCheckinToday/markCheckinShown (morningCheckin.js) are what make
// this once-per-day rather than once-per-reopen: markCheckinShown only
// fires on a genuinely successful card render, so a failed or slow call
// doesn't burn the day's one shot and can still succeed on a later reopen
// the same morning. Any other outcome — already shown today, no trigger,
// the call failing — falls back to the exact same template
// buildOpeningMessages always produced.
async function buildDailyOpening(hasSummaryToday, progress, today) {
  if (!hasShownCheckinToday(today)) {
    const { show } = await shouldShowCheckin()
    if (show) {
      const result = await fetchMorningCheckin()
      if (result.ok && result.card) {
        markCheckinShown(today)
        return [{ id: makeMessageId(), type: 'checkin-card', ...result.card }]
      }
    }
  }
  return buildOpeningMessages(hasSummaryToday, progress)
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
  // Bumped by the notification tap listener; consumed by the join-effect
  // below once thread restoration has also finished. Two independent async
  // signals (tap event, thread restore) that can arrive in either order —
  // this plus `threadDate` together are how we wait for both. A counter
  // rather than a boolean so a second real-device tap (foreground re-tap)
  // is also distinguishable from the first once consumed.
  const [notificationTapToken, setNotificationTapToken] = useState(0)
  const consumedTapTokenRef = useRef(0)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  // Not rendered, so a ref is enough — read at save time, written whenever a
  // thread is (re)stamped fresh. See threadStorage.js for why this exists.
  const summaryIdAtStartRef = useRef(null)
  // Mirrors `messages` for the visibilitychange handler below, which needs
  // the latest thread content inside an async callback that only
  // re-subscribes when `threadDate` changes (not on every message).
  const messagesRef = useRef([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Quick replies (fixed mood buttons) only make sense while the most
  // recent thing in the thread is a check-in card whose question is
  // specifically a mood/wellbeing one — `questionType` comes from the
  // model itself (morning-checkin's vraag_type: 'geen'/'stemming'/
  // 'anders'), since a checkin-card can be a plain statement ("Vandaag
  // staan de schouders op het programma...") with nothing to reply to, or
  // a non-mood question (e.g. "hoe laat train je vandaag?") where mood
  // buttons wouldn't make sense as answers. Keying off message type alone
  // would show mood pills for a question that was never asked, or for the
  // wrong kind of question.
  const lastMessage = messages[messages.length - 1]
  const showQuickReplies = !isTyping && lastMessage?.type === 'checkin-card' && lastMessage?.questionType === 'mood'

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
      const today = todayDateString()

      if (!stored) {
        const progress = await fetchProteinProgress(today)
        summaryIdAtStartRef.current = await fetchSummaryId(today)
        const opening = await buildDailyOpening(summaryIdAtStartRef.current !== null, progress, today)
        if (cancelled) return
        setMessages(opening)
        setThreadDate(today)
        return
      }

      // Calendar rollover: the stored thread belongs to a day that's since
      // passed. Checked before the summary-id comparison below, since that
      // comparison is only meaningful for "did *this* date's own summary
      // change" — a plain date mismatch is a different situation entirely.
      if (stored.date !== today) {
        const transition = await buildRolloverTransition(stored.messages, stored.date, today)
        if (cancelled) return
        summaryIdAtStartRef.current = transition.summaryId
        setMessages(transition.messages)
        setThreadDate(today)
        return
      }

      const currentId = await fetchSummaryId(stored.date)
      if (cancelled) return

      if (currentId !== (stored.summaryIdAtStart ?? null)) {
        clearThread()
        const progress = await fetchProteinProgress(today)
        summaryIdAtStartRef.current = await fetchSummaryId(today)
        const opening = await buildDailyOpening(summaryIdAtStartRef.current !== null, progress, today)
        if (cancelled) return
        setMessages(opening)
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

  // Catches the case restoreThread's mount-time check can't: the app never
  // closed, just sat backgrounded across midnight with the same thread
  // still active in memory. visibilitychange (a standard web API, not a
  // Capacitor plugin — no native dependency, no rebuild) fires reliably
  // when the WebView's Activity resumes to the foreground. Re-registers
  // only on a threadDate change (rare) rather than depending on `messages`
  // directly (every chat message), reading the latest thread via the ref
  // above instead.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible' || !threadDate) return
      const today = todayDateString()
      if (threadDate === today) return
      ;(async () => {
        const transition = await buildRolloverTransition(messagesRef.current, threadDate, today)
        summaryIdAtStartRef.current = transition.summaryId
        setMessages(transition.messages)
        setThreadDate(today)
      })()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [threadDate])

  // Tapping the daily reminder opens the app but otherwise looks identical
  // to a normal open — this listener is what distinguishes "opened via the
  // notification" from "opened normally," which the fresh-thread opening
  // message alone can't do (that's purely clock-based). Registering the
  // listener is enough even on a cold start: the native side retains the
  // tap event until a listener exists to consume it (retainUntilConsumed),
  // so there's no race with this effect running before/after the tap.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const listenerPromise = LocalNotifications.addListener('localNotificationActionPerformed', () => {
      setNotificationTapToken((t) => t + 1)
    })
    return () => {
      listenerPromise.then((handle) => handle.remove())
    }
  }, [])

  // Fires once both async signals have landed, in whichever order: the
  // notification tap (above) and thread restoration (the effect above
  // that). `threadDate` is only used here as a "has restoration finished"
  // signal, not as the date to check — a resumed thread can be carrying a
  // stale date (restoreThread only invalidates a stored thread when *its
  // own* date's summary changes, not on a plain calendar rollover with no
  // new summary involved), so the actual "is today closed" check below
  // uses todayDateString() fresh, always the real current date regardless
  // of what date the visible thread happens to be internally labelled as.
  //
  // Two guards, checked live rather than via a flag captured at
  // thread-build time (a "was it fresh" ref went stale the moment the app
  // was left open past the moment it was built — e.g. built fresh at 15:00,
  // still open at 23:30, tapped: the opening shown was never a closing
  // question, so appending one here is still correct):
  // - has a closing question already appeared in *this* thread (either
  //   block 4b's own opening, or an earlier tap this same session) — read
  //   from the live message list inside the updater, not a ref;
  // - is today already closed — a live fetch, since that can become true
  //   from something other than this thread (the 02:00 cron, or the user
  //   typing it themselves).
  useEffect(() => {
    if (!threadDate || notificationTapToken === consumedTapTokenRef.current) return
    consumedTapTokenRef.current = notificationTapToken

    let cancelled = false
    ;(async () => {
      const summary = await fetchTodaySummary(todayDateString())
      if (cancelled || summary) return
      setMessages((prev) => {
        if (prev.some((m) => m.isClosingQuestion)) return prev
        return [
          ...prev,
          { id: makeMessageId(), type: 'coach', text: NOTIFICATION_TAP_QUESTION, time: nowTime(), isClosingQuestion: true },
        ]
      })
    })()

    return () => {
      cancelled = true
    }
  }, [threadDate, notificationTapToken])

  // Persist on every change, once we know which date this thread belongs to
  // (guards against overwriting a not-yet-restored stored thread with the
  // initial seed before the mount check above has run).
  useEffect(() => {
    if (threadDate) {
      saveThread(threadDate, messages, summaryIdAtStartRef.current)
    }
  }, [threadDate, messages])

  // Runs when the user taps the day-close-button message, not automatically
  // — previously this ran unconditionally 1.5s after the closing reply
  // (CLOSE_DAY_RESET_DELAY_MS), which cleared the thread before anyone could
  // finish reading the closing message. The DB write (coach_sessions) has
  // already happened by the time the button exists — see close_day_summary
  // in coach-chat/tools.ts — so this only ever does client-side reads +
  // state changes, never a write.
  async function handleStartNewDay(activeDate) {
    clearThread()
    // Use the date the server actually closed, not a locally-recomputed
    // one — this is exactly the flow the "closed after midnight, filed
    // under the wrong date" bug was found in, so it's the one spot
    // where trusting agreement between two independent clocks isn't
    // good enough. Falls back to a local computation only if the
    // server response is ever missing this field.
    const today = activeDate ?? todayDateString()
    const [summary, progress] = await Promise.all([fetchTodaySummary(today), fetchProteinProgress(today)])
    summaryIdAtStartRef.current = summary?.id ?? null
    setJustClosedSummary(
      summary ? { eyebrow: 'Dag afgesloten', text: summary.samenvatting, note: summary.aandachtspunt } : null,
    )
    setMessages(buildOpeningMessages(summary != null, progress))
    setThreadDate(today)
  }

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
    let closedActiveDate = null
    let mealCard = null
    try {
      const result = await askCoach(threadWithUserMessage)
      replyText = result.reply
      daySummaryWritten = result.daySummaryWritten
      closedActiveDate = result.activeDate
      mealCard = result.mealCard
    } catch (err) {
      console.error('coach-chat call failed', err)
      replyText = FALLBACK_ERROR_TEXT
    }

    setIsTyping(false)
    // Card first, then the trailing text reply — matches the persona
    // prompt's instruction to lead with the card and follow with one short
    // line, not describe the card in text beforehand. Both land in the same
    // `messages` array as the plain-text case, so the existing saveThread
    // effect persists the card exactly like any other message — no separate
    // persistence path needed.
    //
    // A confirmed close (daySummaryWritten) appends a day-close-button
    // message instead of auto-clearing the thread — the closing text stays
    // on screen, fully persisted (saveThread covers this array like any
    // other message), until the user taps it. Chat stays usable in the
    // meantime; nothing here blocks sendMessage from being called again.
    setMessages((prev) => [
      ...prev,
      ...(mealCard ? [{ id: makeMessageId(), type: 'meal-card', ...mealCard }] : []),
      { id: makeMessageId(), type: 'coach', text: replyText, time: nowTime() },
      ...(daySummaryWritten
        ? [{ id: makeMessageId(), type: 'day-close-button', activeDate: closedActiveDate ?? todayDateString() }]
        : []),
    ])
  }

  // Auto-grow: re-measure on every inputValue change, whether from typing,
  // a quick-reply fill, or the post-send reset to ''. Resetting to 'auto'
  // first (rather than only ever growing) is what lets scrollHeight shrink
  // back down as text is deleted — without it the browser keeps the tallest
  // height it ever computed. CSS's max-height on .input-field is the actual
  // cap (30vh) — this just feeds it the content's natural height, and
  // overflow-y:auto takes over once that exceeds the cap.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [inputValue])

  function handleSubmit(e) {
    e.preventDefault()
    sendMessage(inputValue)
  }

  // Enter sends (matches the single-line input's native behavior, so
  // existing muscle memory doesn't break); Shift+Enter inserts a newline,
  // the standard convention this app had no prior pattern for (WhatsApp/
  // Slack/ChatGPT-style) — otherwise a growable field with no way to add a
  // deliberate line break would only ever grow from wrapping.
  function handleInputKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputValue)
    }
  }

  function handleQuickReply(option) {
    setInputValue(option)
  }

  // TEMPORARY — reminder-not-firing investigation (23:30 report, 13 aug),
  // remove once diagnosed. alert() so it's readable without devtools.
  async function checkPending() {
    const { notifications } = await LocalNotifications.getPending()
    if (notifications.length === 0) {
      alert('No pending notifications.')
      return
    }
    alert(
      notifications
        .map((n) => `id ${n.id}: ${JSON.stringify(n.schedule)}`)
        .join('\n\n'),
    )
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
          {/* TEMPORARY — remove after reminder investigation */}
          <button type="button" className="test-notification-btn" onClick={checkPending}>
            📋 pending
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
            case 'day-close-button':
              return (
                <div key={msg.id} className="day-close-button-row">
                  <button type="button" className="day-close-button" onClick={() => handleStartNewDay(msg.activeDate)}>
                    Start nieuwe dag
                  </button>
                </div>
              )
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
        <textarea
          ref={inputRef}
          className="input-field"
          rows={1}
          placeholder="Typ een bericht…"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <button className="send-btn" type="submit" disabled={!inputValue.trim()}>
          <SendIcon />
        </button>
      </form>
    </div>
  )
}
