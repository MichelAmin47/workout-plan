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

// Claude's Messages API requires strict user/assistant alternation starting
// with "user". Our thread mixes plain bubbles with card types and sometimes
// has back-to-back same-role turns (e.g. two user messages before a reply),
// so consecutive same-role entries get merged, and any leading
// non-user entries (e.g. the opening check-in card) are dropped.
export function toApiMessages(messages) {
  const mapped = []
  for (const msg of messages) {
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
  return { reply: data.reply, daySummaryWritten: Boolean(data.daySummaryWritten) }
}
