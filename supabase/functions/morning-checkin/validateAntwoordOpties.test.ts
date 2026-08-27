// Local, zero-deploy regression test for validateAntwoordOpties (see
// index.ts). Safe to keep in this directory: this project's Edge Function
// deploys are explicit-file-list (deploy_edge_function's `files` array,
// constructed from fresh Reads), not directory-glob — see the plan's
// investigation finding 4 — so this file is never part of any deploy
// payload regardless of where it sits on disk.
//
// Run with: deno test supabase/functions/morning-checkin/validateAntwoordOpties.test.ts

import { assertEquals } from 'jsr:@std/assert'
import { validateAntwoordOpties } from './index.ts'

Deno.test('valid: 2 options', () => {
  const result = validateAntwoordOpties(['Prima zo', 'Iets vroeger'])
  assertEquals(result, { opties: ['Prima zo', 'Iets vroeger'], aangeboden: 2, validatie: 'geaccepteerd', afkeurReden: null })
})

Deno.test('valid: 3 options', () => {
  const result = validateAntwoordOpties(['Ja', 'Nee', 'Weet niet'])
  assertEquals(result, { opties: ['Ja', 'Nee', 'Weet niet'], aangeboden: 3, validatie: 'geaccepteerd', afkeurReden: null })
})

Deno.test('rejected: 1 option (too few)', () => {
  const result = validateAntwoordOpties(['Ja'])
  assertEquals(result, { opties: null, aangeboden: 1, validatie: 'afgekeurd', afkeurReden: 'te_weinig_opties' })
})

Deno.test('rejected: 4 options (too many)', () => {
  const result = validateAntwoordOpties(['Ja', 'Nee', 'Misschien', 'Weet niet'])
  assertEquals(result, { opties: null, aangeboden: 4, validatie: 'afgekeurd', afkeurReden: 'te_veel_opties' })
})

Deno.test('rejected: empty-string label', () => {
  const result = validateAntwoordOpties(['Ja', ''])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'leeg_label' })
})

Deno.test('rejected: whitespace-only label', () => {
  const result = validateAntwoordOpties(['Ja', '   '])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'leeg_label' })
})

Deno.test('rejected: 21-code-point label (one over the limit)', () => {
  const twentyOne = 'a'.repeat(21)
  assertEquals(twentyOne.length, 21)
  const result = validateAntwoordOpties(['Ja', twentyOne])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'label_te_lang' })
})

Deno.test('accepted: exactly-20-code-point label (at the limit)', () => {
  const twenty = 'a'.repeat(20)
  const result = validateAntwoordOpties(['Ja', twenty])
  assertEquals(result, { opties: ['Ja', twenty], aangeboden: 2, validatie: 'geaccepteerd', afkeurReden: null })
})

Deno.test('rejected: duplicate pair', () => {
  const result = validateAntwoordOpties(['Ja', 'Ja'])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'duplicaat_label' })
})

Deno.test('rejected: duplicate pair that only differs by whitespace (trim-before-compare)', () => {
  const result = validateAntwoordOpties(['Ja', 'Ja '])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'duplicaat_label' })
})

Deno.test('accepted: padded-but-otherwise-valid labels are trimmed and stored trimmed', () => {
  const result = validateAntwoordOpties([' Ja ', 'Nee'])
  assertEquals(result, { opties: ['Ja', 'Nee'], aangeboden: 2, validatie: 'geaccepteerd', afkeurReden: null })
})

Deno.test('rejected: non-array value', () => {
  const result = validateAntwoordOpties('Ja, Nee')
  assertEquals(result, { opties: null, aangeboden: 0, validatie: 'afgekeurd', afkeurReden: 'geen_array' })
})

Deno.test('rejected: array with a non-string item', () => {
  const result = validateAntwoordOpties(['Ja', 5])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'geen_array' })
})

Deno.test('nvt: field absent (undefined)', () => {
  const result = validateAntwoordOpties(undefined)
  assertEquals(result, { opties: null, aangeboden: 0, validatie: 'nvt', afkeurReden: null })
})

Deno.test('nvt: field null', () => {
  const result = validateAntwoordOpties(null)
  assertEquals(result, { opties: null, aangeboden: 0, validatie: 'nvt', afkeurReden: null })
})

Deno.test('nvt: empty array', () => {
  const result = validateAntwoordOpties([])
  assertEquals(result, { opties: null, aangeboden: 0, validatie: 'nvt', afkeurReden: null })
})
