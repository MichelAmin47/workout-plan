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
        categorie: { type: 'string', enum: ['voorkeur', 'gewoonte', 'definitie'] },
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
]

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
      return { id: data.id, status: 'logged' }
    }
    case 'nutrition_log_update': {
      const patch: Record<string, unknown> = {}
      if (input.omschrijving !== undefined) patch.omschrijving = input.omschrijving
      if (input.eiwitten_g !== undefined) patch.eiwitten_g = input.eiwitten_g
      if (input.calorieen !== undefined) patch.calorieen = input.calorieen
      const { error } = await supabase.from('nutrition_log').update(patch).eq('id', input.id)
      if (error) return { error: error.message }
      return { status: 'updated' }
    }
    case 'nutrition_log_delete': {
      const { error } = await supabase.from('nutrition_log').delete().eq('id', input.id)
      if (error) return { error: error.message }
      return { status: 'deleted' }
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
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
