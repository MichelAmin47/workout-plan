import { supabase } from './supabaseClient.ts'

export const TOOLS = [
  {
    name: 'nutrition_log_add',
    description:
      'Log a meal or snack the user has ACTUALLY eaten (not something planned/future). Extract a short description and an estimated protein amount in grams.',
    input_schema: {
      type: 'object',
      properties: {
        omschrijving: { type: 'string', description: 'Short description of what was eaten, e.g. "2 boterhammen met kaas"' },
        eiwitten_g: { type: 'number', description: 'Estimated grams of protein for this meal/snack' },
        tijdstip: { type: 'string', description: 'Time eaten, 24h HH:MM, Europe/Amsterdam. Use the current time from context if the user does not name one.' },
      },
      required: ['omschrijving', 'eiwitten_g', 'tijdstip'],
    },
  },
  {
    name: 'nutrition_log_update',
    description: 'Correct an existing nutrition_log entry — its description and/or its protein estimate. Use the id from the "vandaag gelogde maaltijden" context list.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'uuid of the nutrition_log row to correct' },
        omschrijving: { type: 'string' },
        eiwitten_g: { type: 'number' },
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
]

export async function executeTool(name: string, input: Record<string, unknown>, todayStr: string): Promise<unknown> {
  switch (name) {
    case 'nutrition_log_add': {
      const { data, error } = await supabase
        .from('nutrition_log')
        .insert({
          datum: todayStr,
          tijdstip: input.tijdstip,
          omschrijving: input.omschrijving,
          eiwitten_g: input.eiwitten_g,
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
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
