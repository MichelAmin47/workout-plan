// The conversation as plain text for the day-close model.
//
// Pure, no imports — unit-tested in foto.test.ts (moved out of tools.ts on
// 2026-11-17 so it can be tested without a database client).

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: unknown
}

// Flattens the working message list into plain "Mies: ... / Coach: ..."
// turns for the summary model, skipping tool_use/tool_result plumbing. The
// user's turns are labelled with his name (was "Gebruiker", 2026-11-06): the
// day-close model copied that label into every summary as "de gebruiker".
//
// Only text blocks are kept. A photo message (foto.ts injectFoto) is
// [image, text] with the "📷 foto" marker and everything typed next to the
// photo inside the text block — so the image is dropped here but the marker
// and the text are not. Text blocks are joined with a space, as before.
export function buildTranscript(messages: ConversationMessage[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      lines.push(`${msg.role === 'user' ? 'Mies' : 'Coach'}: ${msg.content}`)
    } else if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { text: string }) => block.text)
        .join(' ')
      if (text.trim()) {
        lines.push(`${msg.role === 'user' ? 'Mies' : 'Coach'}: ${text.trim()}`)
      }
    }
  }
  return lines.join('\n')
}
