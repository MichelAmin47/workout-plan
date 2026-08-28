// Supabase Edge Function: coach-chat
//
// Proxies chat messages from voeding-app to the Claude API. Builds a system
// prompt from a fixed persona/preferences block plus dynamic context pulled
// from Supabase (today's workout, recent daily summaries, today's nutrition
// log + protein progress, active long-term memory facts), then runs a
// multi-turn tool-use loop so the coach can log/correct/delete meals
// (nutrition_log) and manage its own long-term memory (coach_memory).

import { amsterdamNow, isoDateString, resolveActiveDate } from '../_shared/today.ts'
import { callClaude, extractText, type ClaudeMessage } from '../_shared/anthropic.ts'
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

// Was 5 — bumped after a reproduced bug: a meal-card revision ("kan het met
// minder kip?") occasionally has the model re-invoke render_meal_card more
// than once before settling on final text (Claude's own sampling variance,
// not deterministic — the exact same message succeeded on one run and
// exhausted the loop on another), and 5 wasn't always enough headroom for
// that. See also the render_meal_card tool_result below, made more
// directive for the same reason.
const MAX_TOOL_ITERATIONS = 8

// Small on purpose — this only ever needs one more nutrition_log_add
// attempt, not a fresh multi-step conversation. See "sub-mechanism A" below.
const MAX_RETRY_ITERATIONS = 3

// 13 August finding (voeding-app-v2.md §9): a reply narrated a meal as
// logged (time + protein figure) without nutrition_log_add ever having
// been called, alongside a stated running total that didn't match SUM —
// the tool call plausibly never happened, in a turn that also had to
// produce a long structured overview. Two independent, differently-risky
// checks run after the tool loop, before the reply is trusted:
//
// Sub-mechanism A ("attempted but didn't land"): nutrition_log_add was
// called this turn, but the totals it returned (fresh off Part 1's
// computeDayTotals) are identical to the pre-turn snapshot. A real write
// was requested, so retrying it once is safe — it repeats an action the
// user already asked for, not a new one.
//
// Sub-mechanism B ("claimed but never attempted" — the actual 13 August
// shape): the reply text itself states an eiwit figure, but no
// nutrition_log_add/_update happened this turn at all. Deliberately NOT
// given a corrective retry with tool access: a false positive here (e.g.
// "hoeveel eiwit zit er in een ei?") would let the retry invent a write
// nobody asked for — a phantom meal is worse than a visible missing one,
// since it inflates the total and looks legitimate afterward. B only ever
// appends a disclaimer, never calls a tool, never writes anything.
const EIWIT_CLAIM_PATTERN = /\d+\s*g\s*eiwit/i

interface TurnResult {
  finalReplyText: string | null
  lastAssistantContent: unknown
}

// Shared by the main turn and sub-mechanism A's retry — both are "run the
// tool loop until the model stops calling tools," differing only in the
// iteration cap and in what's already sitting in workingMessages before
// the first call. Mutates the outer tracking variables (calledToolNames,
// mealCard, daySummaryWritten, lastNutritionTotals) via closure rather
// than threading them through return values, since both call sites need
// the same accumulating state, not a fresh copy each time.
async function runToolLoop(
  apiKey: string,
  systemPrompt: string,
  workingMessages: ClaudeMessage[],
  todayStr: string,
  maxIterations: number,
  calledToolNames: string[],
  onToolResult: (name: string, result: unknown) => void,
): Promise<TurnResult> {
  for (let i = 0; i < maxIterations; i++) {
    const result = await callClaude(apiKey, {
      model: 'claude-sonnet-5',
      system: systemPrompt,
      messages: workingMessages,
      tools: TOOLS,
      maxTokens: 1024,
    })

    if (!result.ok) {
      console.error('Anthropic API error', result.status, result.errorText)
      throw new Error('anthropic_unreachable')
    }

    const data = result.data!

    if (data.stop_reason === 'tool_use') {
      workingMessages.push({ role: 'assistant', content: data.content })

      const toolResults = []
      for (const block of data.content ?? []) {
        if (block.type === 'tool_use' && block.id && block.name) {
          calledToolNames.push(block.name)
          const toolResult = await executeTool(block.name, block.input ?? {}, todayStr, workingMessages)
          onToolResult(block.name, toolResult)
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolResult) })
        }
      }
      workingMessages.push({ role: 'user', content: toolResults })
      continue
    }

    return { finalReplyText: extractText(data.content), lastAssistantContent: data.content }
  }

  return { finalReplyText: null, lastAssistantContent: null }
}

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
    const systemPrompt = `${PERSONA_PROMPT}\n\n## Actuele context\n\n${dynamicContext.text}`

    const workingMessages = [...messages] as ClaudeMessage[]
    let daySummaryWritten = false
    // Diagnostics only, for the !finalReplyText branch below — this loop
    // previously had no logging at all when it ran out of iterations,
    // which is exactly what made the meal-card revision bug hard to
    // diagnose from the platform's HTTP-level logs alone.
    const calledToolNames: string[] = []
    // Last call wins if the model somehow calls this twice in one exchange
    // — discouraged via PERSONA_PROMPT ("too many cards is worse than too
    // few"), not worth guarding further for a single-user beta app.
    let mealCard: ReturnType<typeof formatMealCard> | null = null
    // Most recent successful nutrition_log_add/_update/_delete result this
    // request — sub-mechanism A compares this against dynamicContext's
    // pre-turn snapshot to catch a write that ran but didn't change
    // anything.
    let lastNutritionTotals: { eiwitTotaal: number; calorieTotaal: number } | null = null

    const onToolResult = (name: string, toolResult: unknown) => {
      if (name === 'close_day_summary' && toolResult && typeof toolResult === 'object' && !('error' in toolResult)) {
        daySummaryWritten = true
      }
      // The card content comes straight from the tool_use block's input in
      // the caller, not from executeTool's return value — handled there,
      // not here.
      if (
        (name === 'nutrition_log_add' || name === 'nutrition_log_update' || name === 'nutrition_log_delete') &&
        toolResult &&
        typeof toolResult === 'object' &&
        !('error' in toolResult) &&
        'eiwitTotaal' in toolResult
      ) {
        lastNutritionTotals = toolResult as { eiwitTotaal: number; calorieTotaal: number }
      }
    }

    let turnResult: TurnResult
    try {
      turnResult = await runToolLoop(apiKey, systemPrompt, workingMessages, todayStr, MAX_TOOL_ITERATIONS, calledToolNames, onToolResult)
    } catch {
      return jsonResponse({ error: 'Coach is momenteel niet bereikbaar.' }, 502)
    }

    // render_meal_card's actual card content must come from the tool_use
    // block's input (see formatMealCard's own note in tools.ts) — easiest
    // done as its own pass over workingMessages' assistant turns rather
    // than threading the raw block through the callback above.
    for (const msg of workingMessages) {
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
      for (const block of msg.content as Array<{ type: string; name?: string; input?: unknown }>) {
        if (block.type === 'tool_use' && block.name === 'render_meal_card' && block.input) {
          mealCard = formatMealCard(block.input as unknown as Parameters<typeof formatMealCard>[0])
        }
      }
    }

    let finalReplyText = turnResult.finalReplyText

    if (!finalReplyText) {
      console.error('coach-chat: exhausted MAX_TOOL_ITERATIONS without final text, tools called in order:', calledToolNames)
      return jsonResponse({ error: 'Coach kon geen antwoord afronden.' }, 502)
    }

    // Sub-mechanism A: nutrition_log_add ran this turn, but the totals it
    // returned match the pre-turn snapshot exactly (both protein AND
    // calories, so a genuine near-zero item doesn't false-positive) — a
    // silent no-op write. Safe to retry: a real call was already made for
    // this exact meal, so trying again completes a requested action
    // rather than inventing one.
    const addNoOp =
      calledToolNames.includes('nutrition_log_add') &&
      lastNutritionTotals !== null &&
      (lastNutritionTotals as { eiwitTotaal: number; calorieTotaal: number }).eiwitTotaal === dynamicContext.startingEiwitTotaal &&
      (lastNutritionTotals as { eiwitTotaal: number; calorieTotaal: number }).calorieTotaal === dynamicContext.startingCalorieTotaal

    if (addNoOp) {
      console.error('coach-chat: nutrition_log_add ran but daily totals did not change — retrying once', { todayStr })
      workingMessages.push({ role: 'assistant', content: turnResult.lastAssistantContent })
      workingMessages.push({
        role: 'user',
        content:
          '[Automatische controle] Je nutrition_log_add-aanroep leek niet te zijn verwerkt (het dagtotaal veranderde niet). Probeer de tool nog eenmaal aan te roepen voor dezelfde maaltijd.',
      })

      const retryCalledTools: string[] = []
      let retryResult: TurnResult
      try {
        retryResult = await runToolLoop(apiKey, systemPrompt, workingMessages, todayStr, MAX_RETRY_ITERATIONS, retryCalledTools, onToolResult)
      } catch {
        retryResult = { finalReplyText: null, lastAssistantContent: null }
      }
      calledToolNames.push(...retryCalledTools)

      const stillNoOp =
        !retryCalledTools.includes('nutrition_log_add') ||
        lastNutritionTotals === null ||
        ((lastNutritionTotals as { eiwitTotaal: number; calorieTotaal: number }).eiwitTotaal === dynamicContext.startingEiwitTotaal &&
          (lastNutritionTotals as { eiwitTotaal: number; calorieTotaal: number }).calorieTotaal === dynamicContext.startingCalorieTotaal)

      if (!retryResult.finalReplyText || stillNoOp) {
        finalReplyText = 'Dat kon ik net niet goed verwerken — kun je die maaltijd nog een keer melden, dan zorg ik dat hij goed gelogd wordt.'
      } else {
        finalReplyText = retryResult.finalReplyText
      }
    }

    // Sub-mechanism B: re-evaluated against whatever finalReplyText is at
    // this point (original, or A's retry/fallback) — a claim surviving
    // into the actually-returned text is what matters, matching the plan:
    // run A first, then check B against the result.
    const nutritionToolCalledThisRequest = calledToolNames.includes('nutrition_log_add') || calledToolNames.includes('nutrition_log_update')
    if (!nutritionToolCalledThisRequest && EIWIT_CLAIM_PATTERN.test(finalReplyText)) {
      console.error('coach-chat: reply states a protein figure but no nutrition_log_add/_update ran this turn', { todayStr })
      finalReplyText = `${finalReplyText}\n\n(Even checken: ik heb hier niets gelogd. Als je dit wél wilde loggen, laat het weten.)`
    }

    // Included always, not just on a close — the client's own cutoff
    // computation *should* agree with this given a device clock roughly in
    // sync, but for the one flow where disagreement would actually misfile
    // data (fetching what was just closed), the client uses this value
    // directly instead of trusting that agreement.
    //
    // dayTotals: lastNutritionTotals was already computed (computeDayTotals,
    // a real post-write SUM) for this function's own no-op-retry check above
    // — it was just never sent anywhere. The Coach header's nutrition
    // counters need exactly this value after a mid-conversation log, and
    // the alternative (the client re-querying nutrition_log itself) would
    // reintroduce a second source of truth for the same number this
    // function already computed. Purely additive: null when no nutrition
    // write happened this turn, no change to any other field, no prompt
    // change.
    return jsonResponse({ reply: finalReplyText, daySummaryWritten, activeDate: todayStr, mealCard, dayTotals: lastNutritionTotals })
  } catch (err) {
    console.error('coach-chat error', err)
    return jsonResponse({ error: 'Er ging iets mis.' }, 500)
  }
})
