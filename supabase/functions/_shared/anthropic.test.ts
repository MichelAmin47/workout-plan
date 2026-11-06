// Local, zero-deploy test: coach-chat's request body must be unchanged by the
// effort field (it never passes one).
//
// Run with: deno test supabase/functions/_shared/anthropic.test.ts

import { assertEquals } from 'jsr:@std/assert'
import { buildRequestBody } from './anthropic.ts'

Deno.test('no effort → exactly the pre-effort body (coach-chat shape)', () => {
  const tools = [{ name: 't', input_schema: { type: 'object', properties: {} } }]
  const messages = [{ role: 'user' as const, content: 'hoi' }]
  const body = buildRequestBody({ model: 'claude-sonnet-5-5', system: 'sys', messages, tools, maxTokens: 4096 })
  assertEquals(body, { model: 'claude-sonnet-5-5', max_tokens: 4096, system: 'sys', messages, tools })
  assertEquals(Object.keys(body), ['model', 'max_tokens', 'system', 'messages', 'tools'])
  assertEquals(JSON.stringify(body), JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 4096, system: 'sys', messages, tools }))
})

Deno.test('effort → output_config.effort, nothing else added', () => {
  const body = buildRequestBody({ model: 'claude-opus-5-5', system: 's', messages: [], effort: 'low', toolChoice: { type: 'auto' }, maxTokens: 4096 })
  assertEquals(body, { model: 'claude-opus-5-5', max_tokens: 4096, system: 's', messages: [], tool_choice: { type: 'auto' }, output_config: { effort: 'low' } })
})
