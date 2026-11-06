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
  // Forced tool use ({type:'tool'} / {type:'any'}) returns a 400 on the 5.5
  // models — callers on those models use 'auto' (or omit it) with a strict
  // tool schema, and handle the "no tool call" case themselves.
  toolChoice?: { type: 'tool'; name: string } | { type: 'auto' } | { type: 'any' }
  maxTokens?: number
  // Optional output_config.effort (Messages API, GA, no beta header — see
  // platform.claude.com/docs/en/build-with-claude/effort). Sent only when
  // set: coach-chat omits it, so its request body is exactly what it was
  // before this field existed (model default effort). morning-checkin and
  // the day-close pass 'low'. On the 5.5 models thinking is adaptive and
  // can't be disabled; effort is the control, and thinking counts toward
  // max_tokens — size maxTokens for thinking + output.
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  // Optional hard deadline for this call, in ms. Added for morning-checkin's
  // card generation, which must never let a slow attempt (or a slow attempt
  // + retry) push the whole request past the client's 20s timeout (the
  // client does not retry on timeout — see voeding-app/src/lib/
  // morningCheckin.js). Every other caller (coach-chat's tool loop,
  // closeDayWithSummary's rich/thin variants) omits this and keeps its
  // existing unbounded behaviour.
  timeoutMs?: number
}

export interface ClaudeCallResult {
  ok: boolean
  status: number
  data?: {
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
    stop_reason?: string
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  errorText?: string
  // true only when timeoutMs was set and the call was aborted before a
  // response arrived — distinct from a real API error (errorText), so a
  // caller can tell "ran out of time" apart from "the API rejected this."
  timedOut?: boolean
}

// Exported (and kept separate from the fetch) so a local test can assert
// that a call without `effort` builds exactly the same body as before.
export function buildRequestBody(opts: ClaudeCallOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: opts.messages,
  }
  if (opts.tools) body.tools = opts.tools
  if (opts.toolChoice) body.tool_choice = opts.toolChoice
  if (opts.effort) body.output_config = { effort: opts.effort }
  return body
}

export async function callClaude(apiKey: string, opts: ClaudeCallOptions): Promise<ClaudeCallResult> {
  const body = buildRequestBody(opts)

  const controller = opts.timeoutMs != null ? new AbortController() : null
  const timeoutId = controller ? setTimeout(() => controller.abort(), opts.timeoutMs) : null

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    })
  } catch (err) {
    if (controller?.signal.aborted) {
      return { ok: false, status: 0, timedOut: true }
    }
    throw err
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId)
  }

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
