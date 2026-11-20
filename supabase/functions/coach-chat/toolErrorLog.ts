// One log line per tool call that the server rejected (2026-11-20).
//
// Pure, no imports — unit-tested in toolErrorLog.test.ts.
//
// Every rejection reaches the model as { error: string } (tools.ts, and the
// quick-log duplicate block in index.ts); the model reads it and retries,
// but nothing was logged, so a turn that took several attempts could not be
// explained afterwards (18-11 test: 4 model calls for one photo log). This
// only builds the log line — index.ts sends the tool result to the model
// exactly as before.
//
// Tool inputs never carry image data (the photo only exists in the
// messages, see foto.ts), but any long base64-looking run is replaced
// before truncating anyway, so a log line can never hold image bytes.

export const TOOL_ERROR_PREFIX = '[coach-chat tool-error]'
export const ERROR_MAX_CHARS = 300
export const INPUT_MAX_CHARS = 500

const BASE64_RUN = /[A-Za-z0-9+/=]{200,}/g

function zonderBase64(text: string): string {
  return text.replace(BASE64_RUN, (run) => `[base64 weggelaten, ${run.length} tekens]`)
}

function kort(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

// null when the tool result is not an error — the caller logs nothing then.
export function toolErrorLogLine(tool: string, iteration: number, result: unknown, input: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !('error' in result)) return null
  const error = (result as { error: unknown }).error
  const errorText = typeof error === 'string' ? error : JSON.stringify(error) ?? String(error)
  const keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input) : []
  let inputText: string
  try {
    inputText = JSON.stringify(input ?? null) ?? 'null'
  } catch {
    inputText = '"[niet serialiseerbaar]"'
  }
  return `${TOOL_ERROR_PREFIX} ${JSON.stringify({
    tool,
    i: iteration,
    error: kort(zonderBase64(errorText), ERROR_MAX_CHARS),
    keys,
    input: kort(zonderBase64(inputText), INPUT_MAX_CHARS),
  })}`
}
