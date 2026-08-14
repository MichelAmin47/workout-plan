import { supabase } from '../_shared/supabaseClient.ts'
import { closeDayWithSummary } from '../_shared/summary.ts'

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: unknown
}

// Flattens the working message list into plain "Gebruiker: ... / Coach: ..."
// turns for the summary model, skipping tool_use/tool_result plumbing.
function buildTranscript(messages: ConversationMessage[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      lines.push(`${msg.role === 'user' ? 'Gebruiker' : 'Coach'}: ${msg.content}`)
    } else if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { text: string }) => block.text)
        .join(' ')
      if (text.trim()) {
        lines.push(`${msg.role === 'user' ? 'Gebruiker' : 'Coach'}: ${text.trim()}`)
      }
    }
  }
  return lines.join('\n')
}

export const TOOLS = [
  {
    name: 'nutrition_log_add',
    description:
      'Log a meal or snack the user has ACTUALLY eaten (not something planned/future). Extract a short description and estimated protein and calories.',
    input_schema: {
      type: 'object',
      properties: {
        omschrijving: { type: 'string', description: 'Short description of what was eaten, e.g. "2 boterhammen met kaas"' },
        eiwitten_g: { type: 'number', description: 'Estimated grams of protein for this meal/snack' },
        calorieen: { type: 'number', description: 'Estimated calories (kcal) for this meal/snack' },
        tijdstip: { type: 'string', description: 'Time eaten, 24h HH:MM, Europe/Amsterdam. Use the current time from context if the user does not name one.' },
      },
      required: ['omschrijving', 'eiwitten_g', 'calorieen', 'tijdstip'],
    },
  },
  {
    name: 'nutrition_log_update',
    description: 'Correct an existing nutrition_log entry — its description, protein estimate, and/or calorie estimate. Use the id from the "vandaag gelogde maaltijden" context list.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'uuid of the nutrition_log row to correct' },
        omschrijving: { type: 'string' },
        eiwitten_g: { type: 'number' },
        calorieen: { type: 'number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'nutrition_log_delete',
    description: 'Remove a nutrition_log entry that was logged in error (e.g. a duplicate, or something the user says they had not actually eaten yet).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'uuid of the nutrition_log row to delete' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_add',
    description:
      'Store a new durable fact about the user in long-term memory. Only call this when the fact passes ALL storage criteria from your instructions (still true in a month, would concretely change future advice, not already readable from other context). When in doubt, do not call this.',
    input_schema: {
      type: 'object',
      properties: {
        feit: { type: 'string', description: 'The fact, phrased as a neutral statement/observation' },
        categorie: { type: 'string', enum: ['voorkeur', 'gewoonte', 'definitie', 'vaste_gewoonte'] },
      },
      required: ['feit', 'categorie'],
    },
  },
  {
    name: 'memory_update',
    description: 'Rewrite/refine the wording of an existing active memory fact. Use this instead of memory_add when a near-duplicate fact about the same subject already exists in context.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'uuid of the coach_memory row to update' },
        feit: { type: 'string' },
      },
      required: ['id', 'feit'],
    },
  },
  {
    name: 'memory_deactivate',
    description: 'Retire a memory fact that the user says is wrong or no longer applies. Soft delete — never permanently removed.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'uuid of the coach_memory row to deactivate' } },
      required: ['id'],
    },
  },
  {
    name: 'close_day_summary',
    description:
      'Close out today and write the end-of-day summary. Call this when the user asks to close/end the day (e.g. "sluit de dag af"). This triggers a separate compression step over the whole conversation — do not write the summary yourself.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'weight_log_add',
    description: 'Log a body weight measurement the user just reported (e.g. "ik weeg 110,4", "110,4 kg vanochtend"). Parse the number, including Dutch decimal-comma notation.',
    input_schema: {
      type: 'object',
      properties: {
        gewicht: { type: 'number', description: 'Body weight in kg, e.g. 110.4' },
      },
      required: ['gewicht'],
    },
  },
  {
    name: 'weight_log_update',
    description: 'Correct a previously logged weight measurement (e.g. the user says they mistyped it). Use the id from context if available, or ask which entry if ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'uuid of the weight_log row to correct' },
        gewicht: { type: 'number', description: 'Corrected body weight in kg' },
      },
      required: ['id', 'gewicht'],
    },
  },
  {
    name: 'render_meal_card',
    description:
      'Render a concrete meal suggestion as a structured card instead of writing it out as text. Only for a specific suggestion with identifiable ingredients (e.g. "kip met zoete aardappel en broccoli") — NOT for general advice with no concrete components (e.g. "eet vanavond wat meer koolhydraten"), which stays a plain reply. This is a suggestion for something not yet eaten, not a log entry — do not call nutrition_log_add for it.',
    input_schema: {
      type: 'object',
      properties: {
        titel: { type: 'string', description: 'Short name for the suggestion, e.g. "Kip met zoete aardappel"' },
        tag: { type: 'string', description: 'Short uppercase category label, e.g. "AVONDETEN", "LUNCH", "SNACK"' },
        ingredienten: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              naam: { type: 'string' },
              hoeveelheid: { type: 'string', description: 'Quantity, e.g. "150g" or "1 stuk"' },
            },
            required: ['naam', 'hoeveelheid'],
          },
        },
        kcal: { type: 'number', description: 'Estimated total calories for this suggestion' },
        eiwitten_g: { type: 'number', description: 'Estimated grams of protein' },
        koolhydraten_g: { type: 'number', description: 'Estimated grams of carbohydrates' },
        vet_g: { type: 'number', description: 'Estimated grams of fat' },
      },
      required: ['titel', 'tag', 'ingredienten', 'kcal', 'eiwitten_g', 'koolhydraten_g', 'vet_g'],
    },
  },
]

interface MealCardInput {
  titel: string
  tag: string
  ingredienten: { naam: string; hoeveelheid: string }[]
  kcal: number
  eiwitten_g: number
  koolhydraten_g: number
  vet_g: number
}

// Maps the tool's raw fields onto the exact shape MealCard/cardToText
// already expect (see Coach.jsx's render switch and chatApi.js) — items:
// [{name, detail}], macros: [{val, label}] in a fixed kcal/eiwit/koolhydraten/vet
// order. The order is code-controlled here, not left to the model, so the
// card layout is consistent regardless of which order the model happened
// to fill in the tool call.
export function formatMealCard(input: MealCardInput) {
  return {
    title: input.titel,
    tag: input.tag,
    items: input.ingredienten.map((i) => ({ name: i.naam, detail: i.hoeveelheid })),
    macros: [
      { val: `${Math.round(input.kcal)}`, label: 'kcal' },
      { val: `${Math.round(input.eiwitten_g)}g`, label: 'eiwit' },
      { val: `${Math.round(input.koolhydraten_g)}g`, label: 'koolhydraten' },
      { val: `${Math.round(input.vet_g)}g`, label: 'vet' },
    ],
  }
}

// Recomputed fresh after every nutrition_log write, same reduce shape
// buildDynamicContext already uses — not extracted into a shared module for
// one call site's worth of reuse per file, consistent with this project's
// existing runtime-duplication precedent (currentCalWeek,
// aandachtspuntHasQuestion). Returning this from add/update/delete means
// the coach's running-total confirmation comes from a real post-write SUM
// instead of the pre-turn context snapshot, and a write that silently
// didn't land shows up as an unchanged total instead of being invisible.
async function computeDayTotals(todayStr: string): Promise<{ eiwitTotaal: number; calorieTotaal: number }> {
  const { data } = await supabase.from('nutrition_log').select('eiwitten_g, calorieen').eq('datum', todayStr)
  const rows = data ?? []
  return {
    eiwitTotaal: rows.reduce((sum, r) => sum + (Number(r.eiwitten_g) || 0), 0),
    calorieTotaal: rows.reduce((sum, r) => sum + (Number(r.calorieen) || 0), 0),
  }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  todayStr: string,
  conversationMessages: ConversationMessage[],
): Promise<unknown> {
  switch (name) {
    case 'nutrition_log_add': {
      const { data, error } = await supabase
        .from('nutrition_log')
        .insert({
          datum: todayStr,
          tijdstip: input.tijdstip,
          omschrijving: input.omschrijving,
          eiwitten_g: input.eiwitten_g,
          calorieen: input.calorieen,
        })
        .select('id')
        .single()
      if (error) return { error: error.message }
      const totals = await computeDayTotals(todayStr)
      return { id: data.id, status: 'logged', ...totals }
    }
    case 'nutrition_log_update': {
      const patch: Record<string, unknown> = {}
      if (input.omschrijving !== undefined) patch.omschrijving = input.omschrijving
      if (input.eiwitten_g !== undefined) patch.eiwitten_g = input.eiwitten_g
      if (input.calorieen !== undefined) patch.calorieen = input.calorieen
      const { error } = await supabase.from('nutrition_log').update(patch).eq('id', input.id)
      if (error) return { error: error.message }
      const totals = await computeDayTotals(todayStr)
      return { status: 'updated', ...totals }
    }
    case 'nutrition_log_delete': {
      const { error } = await supabase.from('nutrition_log').delete().eq('id', input.id)
      if (error) return { error: error.message }
      const totals = await computeDayTotals(todayStr)
      return { status: 'deleted', ...totals }
    }
    case 'weight_log_add': {
      const { data, error } = await supabase
        .from('weight_log')
        .insert({ datum: todayStr, gewicht: input.gewicht })
        .select('id')
        .single()
      if (error) return { error: error.message }
      return { id: data.id, status: 'logged' }
    }
    case 'weight_log_update': {
      const { error } = await supabase.from('weight_log').update({ gewicht: input.gewicht }).eq('id', input.id)
      if (error) return { error: error.message }
      return { status: 'updated' }
    }
    case 'memory_add': {
      const { data, error } = await supabase
        .from('coach_memory')
        .insert({ feit: input.feit, categorie: input.categorie })
        .select('id')
        .single()
      if (error) return { error: error.message }
      return { id: data.id, status: 'stored' }
    }
    case 'memory_update': {
      const { error } = await supabase
        .from('coach_memory')
        .update({ feit: input.feit, updated_at: new Date().toISOString() })
        .eq('id', input.id)
      if (error) return { error: error.message }
      return { status: 'updated' }
    }
    case 'memory_deactivate': {
      const { error } = await supabase
        .from('coach_memory')
        .update({ actief: false, updated_at: new Date().toISOString() })
        .eq('id', input.id)
      if (error) return { error: error.message }
      return { status: 'deactivated' }
    }
    case 'close_day_summary': {
      const transcript = buildTranscript(conversationMessages)
      const result = await closeDayWithSummary(todayStr, transcript || null)
      if (!result.ok) {
        return { error: result.error ?? 'Kon de dag niet afsluiten.' }
      }
      // Distinguishes "just closed" from "already existed" so the model
      // can respond honestly instead of always claiming a fresh close —
      // see PERSONA_PROMPT's "Dag afsluiten" section.
      return { status: result.alreadyClosed ? 'already_closed' : 'closed' }
    }
    case 'render_meal_card': {
      // No DB side effect — this tool is purely a structured-output vehicle.
      // The actual card content is picked up by index.ts directly from the
      // tool_use block (see formatMealCard above), not from this return
      // value, which only becomes the tool_result fed back to the model.
      //
      // The plain { status: 'rendered' } this used to return was too terse
      // — reproduced a bug where a meal-card revision occasionally had the
      // model re-invoke this tool one or more extra times (not always, only
      // sometimes — sampling variance) instead of moving on to its closing
      // text, eating into MAX_TOOL_ITERATIONS. An explicit instruction here
      // is cheap insurance against that ambiguity.
      return { status: 'rendered', instructie: 'De kaart is nu getoond aan de gebruiker. Schrijf nu je korte afsluitende reactie in platte tekst — roep dit tool niet nogmaals aan voor dezelfde suggestie.' }
    }
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
