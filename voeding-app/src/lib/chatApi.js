import { supabase } from '../supabase.js'

function cardToText(msg) {
  switch (msg.type) {
    case 'checkin-card':
      return `${msg.question} (${msg.contextLabel} ${msg.contextText})`
    case 'meal-card': {
      const items = msg.items.map((i) => `${i.name} (${i.detail})`).join(', ')
      const macros = msg.macros.map((m) => `${m.val} ${m.label}`).join(', ')
      return `${msg.title} [${msg.tag}]: ${items}. Macro's: ${macros}.`
    }
    case 'summary-card':
      return `${msg.text} Wat ik onthoud voor morgen: ${msg.note} ${msg.streak}`
    default:
      return null
  }
}

// Real incident (2026-09-12, ~13:15): a thread left running since Friday —
// Coach.jsx's rollover deliberately never trims history, only inserts a
// 'day-marker' bubble between days (see buildRolloverTransition's own
// comment: "keep everything... insert a day-marker") — grew unbounded and
// coach-chat started failing every turn (exhausted its tool-use loop with
// no usable reply). Confirmed by experiment: clearing the stored thread
// fixed it immediately. Scoping what's SENT to the API to the current day
// closes this off permanently, without touching what's stored or shown —
// the full scrollback stays intact for the user, only the outgoing payload
// shrinks. Cross-day continuity for the model already comes from
// buildDynamicContext's coach_sessions summaries + coach_memory facts on
// the server side, never from the raw multi-day transcript, so nothing is
// lost by not sending anything before the most recent day-marker.
//
// Plain reverse loop, not Array.prototype.findLastIndex (ES2023) — this
// app ships through a Capacitor Android WebView whose engine version isn't
// something to assume support on.
function scopeToCurrentDay(messages) {
  let start = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'day-marker') {
      start = i + 1
      break
    }
  }
  return messages.slice(start)
}

// Claude's Messages API requires strict user/assistant alternation starting
// with "user". Our thread mixes plain bubbles with card types and sometimes
// has back-to-back same-role turns (e.g. two user messages before a reply),
// so consecutive same-role entries get merged, and any leading
// non-user entries (e.g. the opening check-in card) are dropped.
export function toApiMessages(messages) {
  const mapped = []
  for (const msg of scopeToCurrentDay(messages)) {
    if (msg.type === 'user') {
      mapped.push({ role: 'user', content: msg.text })
    } else if (msg.type === 'coach') {
      mapped.push({ role: 'assistant', content: msg.text })
    } else {
      const text = cardToText(msg)
      if (text) mapped.push({ role: 'assistant', content: text })
    }
  }

  const merged = []
  for (const entry of mapped) {
    const last = merged[merged.length - 1]
    if (last && last.role === entry.role) {
      last.content = `${last.content}\n${entry.content}`
    } else {
      merged.push({ ...entry })
    }
  }

  while (merged.length > 0 && merged[0].role !== 'user') {
    merged.shift()
  }

  return merged
}

export async function askCoach(messages) {
  const { data, error } = await supabase.functions.invoke('coach-chat', {
    body: { messages: toApiMessages(messages) },
  })
  if (error || !data?.reply) {
    throw error ?? new Error('No reply from coach-chat')
  }
  // activeDate is the day the server actually logged/closed against (past
  // midnight, before its 04:00 cutoff, that's still yesterday) — used
  // instead of recomputing locally wherever agreement with the server
  // matters most, e.g. fetching what a close just wrote.
  return {
    reply: data.reply,
    daySummaryWritten: Boolean(data.daySummaryWritten),
    activeDate: data.activeDate,
    mealCard: data.mealCard ?? null,
    // { eiwitTotaal, calorieTotaal } from the most recent nutrition_log
    // write this turn, or null if none happened — see coach-chat/index.ts's
    // lastNutritionTotals. The Coach header's counters update from this
    // directly rather than re-querying, so they can never drift from what
    // the coach itself just computed and (if asked) reported.
    dayTotals: data.dayTotals ?? null,
  }
}
