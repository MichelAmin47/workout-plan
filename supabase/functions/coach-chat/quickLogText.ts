// Quick log ("snel loggen"): how the app's own write reaches the model.
//
// Pure, no imports — unit-tested in quickLogText.test.ts.
//
// Until 2026-11-07 the write was injected as a synthetic nutrition_log_add
// tool_use/tool_result pair: an assistant turn in the model's name, with no
// reasoning behind it. The 5.5 models always think (adaptive thinking can't
// be switched off), and on 07-11 the coach reasoned about "its own" call
// against the "(al gelogd door de app)" label and the "never log a ⚡ line"
// rule, and invented an apology for offering the meal twice. Now the write
// is described in the user turn, explicitly as the app's action — the model
// never sees a tool call it didn't make.

// Shared label shape with voeding-app/src/lib/chatApi.js (history lines).
// Both start with "⚡ Snel loggen", which is what replaceQuickLogLine looks
// for — also the pre-2026-11-07 client label "⚡ Snel loggen (al gelogd door
// de app): …", so a client that hasn't picked up the new label still works.
export const QUICK_LOG_PREFIX = '⚡ Snel loggen — door de app opgeslagen, niet door jou'
const QUICK_LOG_LINE_START = '⚡ Snel loggen'

interface QuickLogComponent {
  index?: number
  naam?: string
  hoeveelheid?: string
  eiwitten_g?: number
}

// result: addLog's return value (id, eiwitten_g, componenten, eiwitTotaal,
// calorieTotaal, _kaart). Only non-client fields are read, and kcal is left
// out on purpose: the reply is eiwit-only, and kcal in the conversation
// nudges the coach to talk calories (same reason log cards send nothing).
export function buildQuickLogUserText(
  result: Record<string, unknown>,
  input: { omschrijving: unknown; tijdstip: unknown },
  datum: string,
): string {
  const componenten = Array.isArray(result.componenten) ? (result.componenten as QuickLogComponent[]) : []
  const onderdelen = componenten
    .map((c, i) => `[${c.index ?? i}] ${c.naam ?? '?'}${c.hoeveelheid ? ` (${c.hoeveelheid})` : ''} ${Number(c.eiwitten_g) || 0}g`)
    .join(', ')
  return [
    `${QUICK_LOG_PREFIX}: ${String(input.omschrijving)}, gegeten op ${datum} om ${String(input.tijdstip)}.`,
    'De app heeft deze maaltijd zelf opgeslagen, vóór jouw beurt: jij hebt er geen tool voor aangeroepen en dat hoeft ook niet.',
    `Opgeslagen (log-id ${String(result.id)}): ${Number(result.eiwitten_g) || 0}g eiwit${onderdelen ? ` — onderdelen: ${onderdelen}` : ''}.`,
    `Dagtotaal eiwit na deze log: ${Number(result.eiwitTotaal) || 0}g.`,
  ].join('\n')
}

// Returns a new message list whose last (user) message carries the server
// text instead of the client's own "⚡ Snel loggen …" line. The client merges
// consecutive user entries with "\n", so anything the user typed before the
// tap (same turn, no reply yet) is kept; only a trailing quick-log line is
// replaced. Nothing is appended as a new message, so strict user/assistant
// alternation is untouched.
export function replaceQuickLogLine<M extends { role: 'user' | 'assistant'; content: unknown }>(messages: M[], text: string): M[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user') throw new Error('quick log: laatste bericht is geen gebruikersbericht')
  let content: unknown
  if (typeof last.content === 'string') {
    const lines = last.content.split('\n')
    if (lines.length > 0 && lines[lines.length - 1].startsWith(QUICK_LOG_LINE_START)) lines.pop()
    const rest = lines.join('\n')
    content = rest.trim() ? `${rest}\n${text}` : text
  } else if (Array.isArray(last.content)) {
    content = [...last.content, { type: 'text', text }]
  } else {
    content = text
  }
  return [...messages.slice(0, -1), { ...last, content }]
}
