// Supabase Edge Function: coach-chat
//
// Proxies chat messages from voeding-app to the Claude API. Builds a system
// prompt from a fixed persona/preferences block plus dynamic context pulled
// from Supabase (today's workout, recent daily summaries, today's nutrition
// log + protein progress, active long-term memory facts), then runs a
// multi-turn tool-use loop so the coach can log/correct/delete meals
// (nutrition_log) and manage its own long-term memory (coach_memory).

import { amsterdamNow, isoDateString, resolveActiveDate } from '../_shared/today.ts'
import { callClaude, extractText } from '../_shared/anthropic.ts'
import { PERSONA_PROMPT, buildDynamicContext } from './prompt.ts'
import { TOOLS, executeTool, formatMealCard } from './tools.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

const MAX_TOOL_ITERATIONS = 5

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json().catch(() => null)
    const messages = body?.messages

    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: 'messages array is required' }, 400)
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY secret is not set')
      return jsonResponse({ error: 'Coach is niet geconfigureerd.' }, 500)
    }

    // The day currently "in play", not the raw calendar date — past
    // midnight (before the 04:00 cutoff), this is still yesterday from the
    // user's perspective. Used for both nutrition_log entries and
    // close_day_summary, so logging and closing always agree on which day
    // is being acted on. See _shared/today.ts for the full reasoning.
    const todayStr = isoDateString(resolveActiveDate(amsterdamNow()))
    const dynamicContext = await buildDynamicContext()
    const systemPrompt = `${PERSONA_PROMPT}\n\n## Actuele context\n\n${dynamicContext}`

    const workingMessages = [...messages]
    let finalReplyText: string | null = null
    let daySummaryWritten = false
    // Last call wins if the model somehow calls this twice in one exchange
    // — discouraged via PERSONA_PROMPT ("too many cards is worse than too
    // few"), not worth guarding further for a single-user beta app.
    let mealCard: ReturnType<typeof formatMealCard> | null = null

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await callClaude(apiKey, {
        model: 'claude-sonnet-5',
        system: systemPrompt,
        messages: workingMessages,
        tools: TOOLS,
        maxTokens: 1024,
      })

      if (!result.ok) {
        console.error('Anthropic API error', result.status, result.errorText)
        return jsonResponse({ error: 'Coach is momenteel niet bereikbaar.' }, 502)
      }

      const data = result.data!

      if (data.stop_reason === 'tool_use') {
        workingMessages.push({ role: 'assistant', content: data.content })

        const toolResults = []
        for (const block of data.content ?? []) {
          if (block.type === 'tool_use' && block.id && block.name) {
            const toolResult = await executeTool(block.name, block.input ?? {}, todayStr, workingMessages)
            if (block.name === 'close_day_summary' && toolResult && typeof toolResult === 'object' && !('error' in toolResult)) {
              daySummaryWritten = true
            }
            // The card content comes straight from the tool_use block's
            // input, not from executeTool's return value — that return
            // value only becomes the tool_result echoed back to the model.
            if (block.name === 'render_meal_card' && block.input) {
              mealCard = formatMealCard(block.input as unknown as Parameters<typeof formatMealCard>[0])
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolResult) })
          }
        }
        workingMessages.push({ role: 'user', content: toolResults })
        continue
      }

      finalReplyText = extractText(data.content)
      break
    }

    if (!finalReplyText) {
      return jsonResponse({ error: 'Coach kon geen antwoord afronden.' }, 502)
    }

    // Included always, not just on a close — the client's own cutoff
    // computation *should* agree with this given a device clock roughly in
    // sync, but for the one flow where disagreement would actually misfile
    // data (fetching what was just closed), the client uses this value
    // directly instead of trusting that agreement.
    return jsonResponse({ reply: finalReplyText, daySummaryWritten, activeDate: todayStr, mealCard })
  } catch (err) {
    console.error('coach-chat error', err)
    return jsonResponse({ error: 'Er ging iets mis.' }, 500)
  }
})
