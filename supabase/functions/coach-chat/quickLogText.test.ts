// Local, zero-deploy tests for quickLogText.ts (never part of a deploy
// payload — deploys are explicit file lists).
//
// Run with: deno test supabase/functions/coach-chat/quickLogText.test.ts

import { assert, assertEquals, assertFalse, assertThrows } from 'jsr:@std/assert'
import { QUICK_LOG_PREFIX, buildQuickLogUserText, replaceQuickLogLine } from './quickLogText.ts'

type Msg = { role: 'user' | 'assistant'; content: unknown }

// addLog's real return shape (07-11 15:05, "Brood pindakaas kip", back-dated).
const result = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  status: 'logged',
  eiwitten_g: 17.6,
  componenten: [
    { index: 0, naam: 'Volkoren brood', hoeveelheid: '2 sneetjes', eiwitten_g: 7.2, calorieen: 170, bron: 'product' },
    { index: 1, naam: 'Pindakaas', hoeveelheid: '20g', eiwitten_g: 5, calorieen: 120, bron: 'product' },
    { index: 2, naam: 'Kipfilet', hoeveelheid: '2 plakjes', eiwitten_g: 5.4, calorieen: 30, bron: 'product' },
  ],
  eiwitTotaal: 38.6,
  calorieTotaal: 1012,
  _kaart: { type: 'log-card', titel: 'geheim' },
}
const input = { omschrijving: 'Brood pindakaas kip', tijdstip: '12:30', componenten: [] }

function assertAlternates(messages: Msg[]) {
  assertEquals(messages[0].role, 'user')
  assertEquals(messages[messages.length - 1].role, 'user')
  for (let i = 1; i < messages.length; i++) assert(messages[i].role !== messages[i - 1].role, `same role at ${i - 1}/${i}`)
}

Deno.test('text: name, date, time, eiwit, components, id and day total', () => {
  const text = buildQuickLogUserText(result, input, '2026-11-07')
  assert(text.startsWith(`${QUICK_LOG_PREFIX}: Brood pindakaas kip, gegeten op 2026-11-07 om 12:30.`))
  assert(text.includes('geen tool voor aangeroepen'))
  assert(text.includes('log-id a1b2c3d4-0000-4000-8000-000000000001'))
  assert(text.includes('17.6g eiwit'))
  assert(text.includes('[0] Volkoren brood (2 sneetjes) 7.2g'))
  assert(text.includes('[2] Kipfilet (2 plakjes) 5.4g'))
  assert(text.includes('Dagtotaal eiwit na deze log: 38.6g.'))
})

Deno.test('text: no client keys, no kcal, no tool vocabulary that reads as a call by the model', () => {
  const text = buildQuickLogUserText(result, input, '2026-11-07')
  assertFalse(text.includes('geheim'))
  assertFalse(text.includes('_kaart'))
  assertFalse(text.includes('log-card'))
  assertFalse(/kcal|calorie|1012|170/.test(text))
  assertFalse(text.includes('nutrition_log_add'))
  assertFalse(text.includes('tool_use'))
})

Deno.test('replace: client quick-log line replaced, alternation kept, nothing appended', () => {
  const messages: Msg[] = [
    { role: 'user', content: '⚡ Snel loggen — door de app opgeslagen, niet door jou: Banaan, gegeten op 2026-11-07 om 12:33' },
    { role: 'assistant', content: 'Banaan gelogd, 2g eiwit. Je staat op 2g.' },
    { role: 'user', content: '⚡ Snel loggen — door de app opgeslagen, niet door jou: Brood pindakaas kip, gegeten op 2026-11-07 om 12:30' },
  ]
  const text = buildQuickLogUserText(result, input, '2026-11-07')
  const out = replaceQuickLogLine(messages, text)
  assertEquals(out.length, messages.length)
  assertAlternates(out)
  assertEquals(out[2].content, text)
  assertEquals(out.slice(0, 2), messages.slice(0, 2))
  // input not mutated
  assert(String(messages[2].content).endsWith('om 12:30'))
  // no assistant tool_use anywhere
  assertFalse(JSON.stringify(out).includes('tool_use'))
})

Deno.test('replace: old client label (pre-2026-11-07) is replaced too', () => {
  const messages: Msg[] = [{ role: 'user', content: '⚡ Snel loggen (al gelogd door de app): Banaan, gegeten om 12:33' }]
  const out = replaceQuickLogLine(messages, 'SERVER')
  assertEquals(out, [{ role: 'user', content: 'SERVER' }])
})

Deno.test('replace: text the user typed before the tap (merged by the client) is kept', () => {
  const messages: Msg[] = [
    { role: 'user', content: 'hoi' },
    { role: 'assistant', content: 'hoi!' },
    { role: 'user', content: 'ik had net trek\n⚡ Snel loggen (al gelogd door de app): Banaan, gegeten om 12:33' },
  ]
  const out = replaceQuickLogLine(messages, 'SERVER')
  assertAlternates(out)
  assertEquals(out[2].content, 'ik had net trek\nSERVER')
})

Deno.test('replace: an earlier quick-log line inside the same merged turn is left alone', () => {
  const messages: Msg[] = [{ role: 'user', content: '⚡ Snel loggen (al gelogd door de app): Banaan, gegeten om 12:33\n⚡ Snel loggen (al gelogd door de app): Snickers, gegeten om 12:40' }]
  const out = replaceQuickLogLine(messages, 'SERVER')
  assertEquals(out[0].content, '⚡ Snel loggen (al gelogd door de app): Banaan, gegeten om 12:33\nSERVER')
})

Deno.test('replace: array content gets a text block, last message must be user', () => {
  const out = replaceQuickLogLine([{ role: 'user', content: [{ type: 'text', text: 'x' }] }] as Msg[], 'SERVER')
  assertEquals(out[0].content, [{ type: 'text', text: 'x' }, { type: 'text', text: 'SERVER' }])
  assertThrows(() => replaceQuickLogLine([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] as Msg[], 'SERVER'))
})
