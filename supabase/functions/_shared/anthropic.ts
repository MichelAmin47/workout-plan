// Thin wrapper around POST /v1/messages, shared by the chat loop
// (coach-chat) and the two summary paths (manual + cron).

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: unknown
}

export interface ClaudeCallOptions {
  model: string
  system: string
  messages: ClaudeMessage[]
  tools?: unknown[]
  toolChoice?: { type: 'tool'; name: string } | { type: 'auto' } | { type: 'any' }
  maxTokens?: number
}

export interface ClaudeCallResult {
  ok: boolean
  status: number
  data?: {
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
    stop_reason?: string
  }
  errorText?: string
}

export async function callClaude(apiKey: string, opts: ClaudeCallOptions): Promise<ClaudeCallResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: opts.messages,
  }
  if (opts.tools) body.tools = opts.tools
  if (opts.toolChoice) body.tool_choice = opts.toolChoice

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errorText = await res.text()
    return { ok: false, status: res.status, errorText }
  }

  const data = await res.json()
  return { ok: true, status: res.status, data }
}

export function extractText(content: Array<{ type: string; text?: string }> | undefined): string {
  return (content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim()
}
