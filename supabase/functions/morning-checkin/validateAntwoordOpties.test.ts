// Local, zero-deploy regression test for validateAntwoordOpties and
// diagnoseAntwoordOptieLabels (see index.ts). Safe to keep in this
// directory: this project's Edge Function deploys are explicit-file-list
// (deploy_edge_function's `files` array, constructed from fresh Reads), not
// directory-glob — see the plan's investigation finding 4 — so this file is
// never part of any deploy payload regardless of where it sits on disk.
//
// Run with: deno test supabase/functions/morning-checkin/validateAntwoordOpties.test.ts

import { assertEquals } from 'jsr:@std/assert'
import { diagnoseAntwoordOptieLabels, validateAntwoordOpties } from './index.ts'

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

// Content problems (empty/too-long/duplicate) no longer fail the whole set
// on their own — a single bad label among 2 drops that one label, leaving
// fewer than 2 to show, which is what actually rejects the set here. The
// afkeurReden is the new 'te_weinig_geldige_labels', not the old per-content
// reason — see index.ts's comment on why.
Deno.test('rejected: empty-string label (2 supplied, 1 valid remains — still too few)', () => {
  const result = validateAntwoordOpties(['Ja', ''])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'te_weinig_geldige_labels' })
})

Deno.test('rejected: whitespace-only label (2 supplied, 1 valid remains — still too few)', () => {
  const result = validateAntwoordOpties(['Ja', '   '])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'te_weinig_geldige_labels' })
})

Deno.test('rejected: 41-code-point label (one over the new limit)', () => {
  const fortyOne = 'a'.repeat(41)
  assertEquals(fortyOne.length, 41)
  const result = validateAntwoordOpties(['Ja', fortyOne])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'te_weinig_geldige_labels' })
})

Deno.test('accepted: exactly-40-code-point label (at the new limit)', () => {
  const forty = 'a'.repeat(40)
  const result = validateAntwoordOpties(['Ja', forty])
  assertEquals(result, { opties: ['Ja', forty], aangeboden: 2, validatie: 'geaccepteerd', afkeurReden: null })
})

Deno.test('rejected: duplicate pair (2 supplied, 1 valid remains — still too few)', () => {
  const result = validateAntwoordOpties(['Ja', 'Ja'])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'te_weinig_geldige_labels' })
})

Deno.test('rejected: duplicate pair that only differs by whitespace (trim-before-compare, still too few)', () => {
  const result = validateAntwoordOpties(['Ja', 'Ja '])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'te_weinig_geldige_labels' })
})

Deno.test('deels_geaccepteerd: 3 supplied, one too long — the other two are shown', () => {
  const tooLong = 'a'.repeat(41)
  const result = validateAntwoordOpties(['Ja', tooLong, 'Nee'])
  assertEquals(result, { opties: ['Ja', 'Nee'], aangeboden: 3, validatie: 'deels_geaccepteerd', afkeurReden: null })
})

Deno.test('deels_geaccepteerd: 3 supplied, a duplicate pair plus one distinct — the distinct pair is shown', () => {
  const result = validateAntwoordOpties(['Ja, top', 'Iets anders', 'Ja, top '])
  assertEquals(result, { opties: ['Ja, top', 'Iets anders'], aangeboden: 3, validatie: 'deels_geaccepteerd', afkeurReden: null })
})

Deno.test('rejected: 2 supplied, both collapse to the same trimmed value — only 1 remains', () => {
  const result = validateAntwoordOpties(['Ja, top', 'Ja, top '])
  assertEquals(result, { opties: null, aangeboden: 2, validatie: 'afgekeurd', afkeurReden: 'te_weinig_geldige_labels' })
})

// Real historical outputs (see morning-checkin's background) run through
// the new 40-char limit. The 13-09 and 16-09 pairs were already fine under
// the old 20-char limit and stay fully accepted. The 15-09 pair is the
// actual regression check: it was REJECTED outright in production
// (label_te_lang, both labels under the new limit but the second, at 22,
// was over the old 20) and now passes fully.
Deno.test('regression: 13-09 real pair ("Ja, top" / "Gaat wel") — accepted, unaffected by the limit change', () => {
  const result = validateAntwoordOpties(['Ja, top', 'Gaat wel'])
  assertEquals(result, { opties: ['Ja, top', 'Gaat wel'], aangeboden: 2, validatie: 'geaccepteerd', afkeurReden: null })
})

Deno.test('regression: 16-09 real pair ("Ja, hou ik vast" / "Nog niet echt") — accepted, unaffected by the limit change', () => {
  const result = validateAntwoordOpties(['Ja, hou ik vast', 'Nog niet echt'])
  assertEquals(result, { opties: ['Ja, hou ik vast', 'Nog niet echt'], aangeboden: 2, validatie: 'geaccepteerd', afkeurReden: null })
})

Deno.test('regression: 15-09 real pair ("Goed, veel gedronken" / "Nog niet echt op gelet") — was rejected in production (label_te_lang), now fully accepted', () => {
  const result = validateAntwoordOpties(['Goed, veel gedronken', 'Nog niet echt op gelet'])
  assertEquals(result, { opties: ['Goed, veel gedronken', 'Nog niet echt op gelet'], aangeboden: 2, validatie: 'geaccepteerd', afkeurReden: null })
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

// diagnoseAntwoordOptieLabels — must classify each label with the exact
// same behouden/dropReden the validator above used for the equivalent
// input, since both call the same shared classifier.

Deno.test('diag: three labels, one too long — two behouden:true, one behouden:false/dropReden:te_lang', () => {
  const tooLong = 'a'.repeat(41)
  const result = diagnoseAntwoordOptieLabels(['Ja', tooLong, 'Nee'])
  assertEquals(result, [
    { waarde: 'Ja', lengte: 2, behouden: true },
    { waarde: tooLong, lengte: 41, behouden: false, dropReden: 'te_lang' },
    { waarde: 'Nee', lengte: 3, behouden: true },
  ])
})

Deno.test('diag: empty label gets dropReden leeg', () => {
  const result = diagnoseAntwoordOptieLabels(['Ja', ''])
  assertEquals(result, [
    { waarde: 'Ja', lengte: 2, behouden: true },
    { waarde: '', lengte: 0, behouden: false, dropReden: 'leeg' },
  ])
})

Deno.test('diag: duplicate after trim — first occurrence kept, second dropped as duplicaat', () => {
  const result = diagnoseAntwoordOptieLabels(['Ja, top', 'Ja, top '])
  assertEquals(result, [
    { waarde: 'Ja, top', lengte: 7, behouden: true },
    { waarde: 'Ja, top', lengte: 7, behouden: false, dropReden: 'duplicaat' },
  ])
})

Deno.test('diag: non-string item alongside valid strings — string entries still classified by their own relative order', () => {
  const result = diagnoseAntwoordOptieLabels(['Ja', 5, 'Ja'])
  assertEquals(result, [
    { waarde: 'Ja', lengte: 2, behouden: true },
    { waarde: null, ruwType: 'number' },
    { waarde: 'Ja', lengte: 2, behouden: false, dropReden: 'duplicaat' },
  ])
})

Deno.test('diag: raw not an array at all', () => {
  const result = diagnoseAntwoordOptieLabels('Ja, Nee')
  assertEquals(result, [{ waarde: null, ruwType: 'geen_array' }])
})

Deno.test('diag: raw absent', () => {
  assertEquals(diagnoseAntwoordOptieLabels(undefined), [])
  assertEquals(diagnoseAntwoordOptieLabels(null), [])
})
