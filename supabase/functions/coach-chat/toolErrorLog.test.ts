// Local, zero-deploy tests for toolErrorLog.ts (never part of a deploy
// payload). Pure module: no env, no network.
//
// Run with: deno test supabase/functions/coach-chat/toolErrorLog.test.ts

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert'
import { ERROR_MAX_CHARS, INPUT_MAX_CHARS, TOOL_ERROR_PREFIX, toolErrorLogLine } from './toolErrorLog.ts'

function parse(line: string) {
  assert(line.startsWith(`${TOOL_ERROR_PREFIX} `))
  assertFalse(line.includes('\n'), 'one line')
  return JSON.parse(line.slice(TOOL_ERROR_PREFIX.length + 1))
}

Deno.test('no error → no log line', () => {
  assertEquals(toolErrorLogLine('nutrition_log_add', 0, { id: 'x', status: 'logged' }, {}), null)
  assertEquals(toolErrorLogLine('nutrition_log_add', 0, null, {}), null)
  assertEquals(toolErrorLogLine('nutrition_log_add', 0, 'tekst', {}), null)
  assertEquals(toolErrorLogLine('nutrition_log_add', 0, [{ error: 'x' }], {}), null)
})

Deno.test('a typical rejection: tool, iteration, error text, input keys and input', () => {
  const input = { omschrijving: 'Lunch', tijdstip: '12:30', componenten: [{ product_id: 'p', gram: 2 }] }
  const line = toolErrorLogLine('nutrition_log_add', 1, { error: '"Bruin brood" heeft alleen waarden per snee zonder gewicht — geef stuks in plaats van gram. Er is niets opgeslagen.' }, input)
  const o = parse(line!)
  assertEquals(o.tool, 'nutrition_log_add')
  assertEquals(o.i, 1)
  assert(o.error.startsWith('"Bruin brood" heeft alleen waarden per snee'))
  assertEquals(o.keys, ['omschrijving', 'tijdstip', 'componenten'])
  assertEquals(o.input, JSON.stringify(input))
})

Deno.test('error truncated at 300, input at 500 characters', () => {
  // Text with spaces: a single 1000-letter word would itself be a
  // base64-alphabet run and get replaced instead of truncated.
  const longError = 'onderdeel niet geldig '.repeat(50)
  const longInput = { omschrijving: 'kip met rijst en broccoli '.repeat(80) }
  const o = parse(toolErrorLogLine('nutrition_log_add', 0, { error: longError }, longInput)!)
  assertEquals(o.error.length, ERROR_MAX_CHARS + 1)
  assert(o.error.endsWith('…'))
  assertEquals(o.input.length, INPUT_MAX_CHARS + 1)
  assert(o.input.endsWith('…'))
  assertEquals(o.keys, ['omschrijving'])
})

Deno.test('no base64 in the output, in input or error', () => {
  const b64 = 'QUJDRA'.repeat(900) // 5400 base64 characters
  const line = toolErrorLogLine('nutrition_log_add', 0, { error: `kapot: ${b64}` }, { omschrijving: 'foto', data: b64 })!
  assertFalse(line.includes('QUJDRAQUJDRA'), 'base64 leaked')
  const o = parse(line)
  assert(o.input.includes('[base64 weggelaten, 5400 tekens]'))
  assert(o.error.includes('[base64 weggelaten, 5400 tekens]'))
  assertEquals(o.keys, ['omschrijving', 'data'])
})

Deno.test('short ids and normal text are kept (no false base64 match)', () => {
  const id = '7ea6ea5d-9d10-4727-9959-db8ba7de059c'
  const o = parse(toolErrorLogLine('nutrition_log_update', 0, { error: `Geen maaltijd gevonden met id ${id}.` }, { id })!)
  assert(o.error.includes(id))
  assert(o.input.includes(id))
})

Deno.test('non-string error and input without keys still give one line', () => {
  const o = parse(toolErrorLogLine('memory_add', 2, { error: { code: 23505 } }, undefined)!)
  assertEquals(o.error, '{"code":23505}')
  assertEquals(o.keys, [])
  assertEquals(o.input, 'null')
})
