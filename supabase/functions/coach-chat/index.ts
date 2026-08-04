// Supabase Edge Function: coach-chat
//
// Proxies chat messages from voeding-app to the Claude API. Builds a system
// prompt from a fixed persona/preferences block plus dynamic context pulled
// from Supabase (today's workout, recent daily summaries, today's nutrition
// log + protein progress, active long-term memory facts), then runs a
// multi-turn tool-use loop so the coach can log/correct/delete meals
// (nutrition_log) and manage its own long-term memory (coach_memory).

import { amsterdamNow, isoDateString } from './today.ts'
import { PERSONA_PROMPT, buildDynamicContext } from './prompt.ts'
import { TOOLS, executeTool } from './tools.ts'

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

    const todayStr = isoDateString(amsterdamNow())
    const dynamicContext = await buildDynamicContext()
    const systemPrompt = `${PERSONA_PROMPT}\n\n## Actuele context\n\n${dynamicContext}`

    const workingMessages = [...messages]
    let finalReplyText: string | null = null

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 1024,
          system: systemPrompt,
          messages: workingMessages,
          tools: TOOLS,
        }),
      })

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text()
        console.error('Anthropic API error', anthropicRes.status, errText)
        return jsonResponse({ error: 'Coach is momenteel niet bereikbaar.' }, 502)
      }

      const data = await anthropicRes.json()

      if (data.stop_reason === 'tool_use') {
        workingMessages.push({ role: 'assistant', content: data.content })

        const toolResults = []
        for (const block of data.content ?? []) {
          if (block.type === 'tool_use') {
            const result = await executeTool(block.name, block.input ?? {}, todayStr)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
          }
        }
        workingMessages.push({ role: 'user', content: toolResults })
        continue
      }

      finalReplyText = (data.content ?? [])
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { text: string }) => block.text)
        .join('\n')
        .trim()
      break
    }

    if (!finalReplyText) {
      return jsonResponse({ error: 'Coach kon geen antwoord afronden.' }, 502)
    }

    return jsonResponse({ reply: finalReplyText })
  } catch (err) {
    console.error('coach-chat error', err)
    return jsonResponse({ error: 'Er ging iets mis.' }, 500)
  }
})
