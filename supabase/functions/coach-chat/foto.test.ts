// Local, zero-deploy tests for foto.ts and transcript.ts (never part of a
// deploy payload — deploys are explicit file lists). Both modules are pure:
// no env, no network.
//
// Run with: deno test supabase/functions/coach-chat/foto.test.ts

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert'
import {
  FOTO_MARKER,
  FOTO_MARKER_GELOGD,
  alsFotoSchatting,
  beoordeelHerkomst,
  eiwitClaimDisclaimer,
  fotoInGesprek,
  fotoVoorstelOpen,
  injectFoto,
  valideerFoto,
} from './foto.ts'
import { buildTranscript } from './transcript.ts'

type Msg = { role: 'user' | 'assistant'; content: unknown }

const FOTO = { mediaType: 'image/jpeg', data: 'QUJDRA==' }
const fotoBericht = `${FOTO_MARKER}\ndit, en om 15:00 had ik ook een shake`

// Strings as the client renders them (voeding-app/src/lib/fotoMarker.js).
const MISLUKT = '📷 foto (niet aangekomen bij de coach)'
const VERLOPEN = '📷 eerdere foto niet meer zichtbaar, niet gelogd'

// ── marker detection ──

Deno.test('fotoInGesprek / fotoVoorstelOpen: open photo', () => {
  const msgs: Msg[] = [{ role: 'user', content: fotoBericht }]
  assert(fotoInGesprek(msgs))
  assert(fotoVoorstelOpen(msgs))
})

Deno.test('fotoInGesprek / fotoVoorstelOpen: logged photo counts as in the conversation, not as open', () => {
  const msgs: Msg[] = [
    { role: 'user', content: `${FOTO_MARKER_GELOGD}\nmijn lunch` },
    { role: 'assistant', content: 'Gelogd.' },
    { role: 'user', content: 'en nu een appel' },
  ]
  assert(fotoInGesprek(msgs))
  assertFalse(fotoVoorstelOpen(msgs))
})

Deno.test('fotoInGesprek: a failed photo and the expired-photo notice do not count', () => {
  for (const line of [MISLUKT, VERLOPEN]) {
    const msgs: Msg[] = [{ role: 'user', content: `${line}\nhoi` }]
    assertFalse(fotoInGesprek(msgs), line)
    assertFalse(fotoVoorstelOpen(msgs), line)
  }
})

Deno.test('fotoInGesprek: the marker must be a whole line, from the user', () => {
  assertFalse(fotoInGesprek([{ role: 'user', content: 'ik stuur zo een 📷 foto' }]))
  assertFalse(fotoInGesprek([{ role: 'assistant', content: FOTO_MARKER }]))
  // merged with an earlier user line (chatApi.js merges same-role turns)
  assert(fotoInGesprek([{ role: 'user', content: `eerst dit\n${FOTO_MARKER}` }]))
})

Deno.test('fotoInGesprek: also sees the marker after injection (array content)', () => {
  const injected = injectFoto([{ role: 'user', content: fotoBericht }] as Msg[], { mediaType: 'image/jpeg', data: 'QUJDRA==' })
  assert(fotoInGesprek(injected))
})

// ── validation + injection ──

Deno.test('valideerFoto: accepts a jpeg with the marker on the last user message', () => {
  const r = valideerFoto(FOTO, [{ role: 'user', content: fotoBericht }], undefined)
  assert(r.ok)
})

Deno.test('valideerFoto: rejects quick log, bad type, oversize, bad base64, missing marker, wrong role', () => {
  const ok: Msg[] = [{ role: 'user', content: fotoBericht }]
  assertFalse(valideerFoto(FOTO, ok, { favorietId: 'x', tijdstip: '12:00' }).ok)
  assertFalse(valideerFoto({ mediaType: 'image/heic', data: 'QUJD' }, ok, undefined).ok)
  assertFalse(valideerFoto({ mediaType: 'image/jpeg', data: 'A'.repeat(2_000_001) }, ok, undefined).ok)
  assertFalse(valideerFoto({ mediaType: 'image/jpeg', data: 'not base64!' }, ok, undefined).ok)
  assertFalse(valideerFoto({ mediaType: 'image/jpeg', data: '' }, ok, undefined).ok)
  assertFalse(valideerFoto(null, ok, undefined).ok)
  assertFalse(valideerFoto(FOTO, [{ role: 'user', content: 'geen marker' }], undefined).ok)
  assertFalse(valideerFoto(FOTO, [{ role: 'user', content: `${FOTO_MARKER_GELOGD}\nx` }], undefined).ok)
  assertFalse(valideerFoto(FOTO, [{ role: 'user', content: fotoBericht }, { role: 'assistant', content: 'x' }], undefined).ok)
})

Deno.test('injectFoto: only the last message changes; text next to the image is kept in full', () => {
  const msgs: Msg[] = [
    { role: 'user', content: 'goedemorgen' },
    { role: 'assistant', content: 'Hoi!' },
    { role: 'user', content: fotoBericht },
  ]
  const out = injectFoto(msgs, { mediaType: 'image/jpeg', data: 'QUJDRA==' })
  assertEquals(out.length, 3)
  assertEquals(out[0], msgs[0])
  assertEquals(out[1], msgs[1])
  assertEquals(out[2].role, 'user')
  assertEquals(out[2].content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJDRA==' } },
    { type: 'text', text: fotoBericht },
  ])
  // input untouched
  assertEquals(msgs[2].content, fotoBericht)
})

// ── transcript for the day-close ──

Deno.test('buildTranscript: a photo message keeps the marker and the text, drops only the image', () => {
  const msgs = injectFoto(
    [
      { role: 'user', content: 'hoi' },
      { role: 'assistant', content: 'Hoi Mies' },
      { role: 'user', content: fotoBericht },
    ] as Msg[],
    { mediaType: 'image/jpeg', data: 'QUJDRA==' },
  )
  const transcript = buildTranscript(msgs)
  assertEquals(transcript, `Mies: hoi\nCoach: Hoi Mies\nMies: ${fotoBericht}`)
  assertFalse(transcript.includes('QUJDRA'))
})

Deno.test('buildTranscript: string history with markers passes through unchanged', () => {
  const msgs: Msg[] = [
    { role: 'user', content: `${FOTO_MARKER_GELOGD}\nmijn lunch` },
    { role: 'assistant', content: 'Kip met rijst, rond de 40g eiwit — gelogd.' },
  ]
  assertEquals(buildTranscript(msgs), `Mies: ${FOTO_MARKER_GELOGD}\nmijn lunch\nCoach: Kip met rijst, rond de 40g eiwit — gelogd.`)
})

// ── herkomst ──

const geenFoto = { fotoInGesprek: false, fotoTurn: false }
const fotoEerder = { fotoInGesprek: true, fotoTurn: false }
const fotoNu = { fotoInGesprek: true, fotoTurn: true }

Deno.test('beoordeelHerkomst: no photo in the conversation → always NULL, "foto" is refused', () => {
  assertEquals(beoordeelHerkomst(undefined, geenFoto), { ok: true, herkomst: null })
  assertEquals(beoordeelHerkomst('geen', geenFoto), { ok: true, herkomst: null })
  assertFalse(beoordeelHerkomst('foto', geenFoto).ok)
})

Deno.test('beoordeelHerkomst: photo earlier in the conversation → explicit choice required', () => {
  assertEquals(beoordeelHerkomst('foto', fotoEerder), { ok: true, herkomst: 'foto' })
  assertEquals(beoordeelHerkomst('geen', fotoEerder), { ok: true, herkomst: null })
  // the model forgot it: an error it retries on, never a silent NULL
  const vergeten = beoordeelHerkomst(undefined, fotoEerder)
  assertFalse(vergeten.ok)
  assert(!vergeten.ok && vergeten.error.includes('niets opgeslagen'))
  assertFalse(beoordeelHerkomst('ja', fotoEerder).ok)
})

Deno.test('beoordeelHerkomst: in the photo turn itself a photo meal is never logged, a shake is', () => {
  assertFalse(beoordeelHerkomst('foto', fotoNu).ok)
  assertEquals(beoordeelHerkomst('geen', fotoNu), { ok: true, herkomst: null })
})

// ── components of a photo meal ──

type C = { hoeveelheid: string; bron: 'product' | 'geschat' | 'gebruiker'; product_id: string | null; eiwitten_g: number }

Deno.test('alsFotoSchatting: product component → geschat, product_id kept, values untouched, "~" amount', () => {
  const c: C = { hoeveelheid: '140g bereid', bron: 'product', product_id: 'p1', eiwitten_g: 43.4 }
  assertEquals(alsFotoSchatting(c), { hoeveelheid: '~140g bereid', bron: 'geschat', product_id: 'p1', eiwitten_g: 43.4 })
})

Deno.test('alsFotoSchatting: per-piece product amount gets "~" too', () => {
  const c: C = { hoeveelheid: '2,5 sneeën', bron: 'product', product_id: 'p2', eiwitten_g: 10 }
  assertEquals(alsFotoSchatting(c).hoeveelheid, '~2,5 sneeën')
})

Deno.test('alsFotoSchatting: estimate keeps a non-numeric amount, never doubles "~", keeps a user value', () => {
  assertEquals(alsFotoSchatting({ hoeveelheid: 'een schep', bron: 'geschat', product_id: null, eiwitten_g: 2 }).hoeveelheid, 'een schep')
  assertEquals(alsFotoSchatting({ hoeveelheid: '~150g', bron: 'geschat', product_id: null, eiwitten_g: 2 }).hoeveelheid, '~150g')
  const gebruiker: C = { hoeveelheid: '1 shake', bron: 'gebruiker', product_id: null, eiwitten_g: 25 }
  assertEquals(alsFotoSchatting(gebruiker), gebruiker)
})

// ── sub-mechanism B ──

Deno.test('eiwitClaimDisclaimer (a): open proposal, follow-up "de helft laten staan" restates a range, no add → NO disclaimer', () => {
  // The turn after the photo: the client sends the open marker, the coach's
  // proposal and the answer. No image in this request, nothing logged yet.
  const msgs: Msg[] = [
    { role: 'user', content: `${FOTO_MARKER}\nmijn avondeten` },
    { role: 'assistant', content: 'Kip (zo\'n 120-160g): 30-40g eiwit, rijst: 4-6g eiwit. Samen 35-45g eiwit. Heb je het helemaal opgegeten?' },
    { role: 'user', content: 'nee, de helft laten staan' },
  ]
  const reply = 'Dan kom je rond 17-23g eiwit uit: kip zo\'n 60-80g en een halve portie rijst. Zal ik het zo loggen?'
  assert(fotoVoorstelOpen(msgs))
  assertFalse(eiwitClaimDisclaimer({ reply, nutritionToolCalled: false, favorietTurn: false, fotoVoorstelOpen: fotoVoorstelOpen(msgs) }))
})

Deno.test('eiwitClaimDisclaimer (b): the same reply with no photo in the conversation → disclaimer, as before', () => {
  const reply = 'Dan kom je rond 17-23g eiwit uit.'
  assert(eiwitClaimDisclaimer({ reply, nutritionToolCalled: false, favorietTurn: false, fotoVoorstelOpen: false }))
})

Deno.test('eiwitClaimDisclaimer (c): open proposal, reply claims it is logged, no add → disclaimer', () => {
  for (const reply of ['Top, gelogd! Je staat nu op 82g.', 'Ik heb het genoteerd.', 'Opgeslagen als avondeten.']) {
    assert(eiwitClaimDisclaimer({ reply, nutritionToolCalled: false, favorietTurn: false, fotoVoorstelOpen: true }), reply)
  }
})

Deno.test('eiwitClaimDisclaimer (c2): open proposal, negated claims are not claims', () => {
  for (const reply of ['Ik heb nog niets gelogd — klopt dit?', 'Dit is nog niet opgeslagen, laat maar weten of het klopt.', 'Niets gelogd tot je bevestigt: 35-45g eiwit.']) {
    assertFalse(eiwitClaimDisclaimer({ reply, nutritionToolCalled: false, favorietTurn: false, fotoVoorstelOpen: true }), reply)
  }
})

Deno.test('eiwitClaimDisclaimer (d): only a logged photo in the conversation + a figure, no add → disclaimer, as before', () => {
  const msgs: Msg[] = [
    { role: 'user', content: `${FOTO_MARKER_GELOGD}\nmijn lunch` },
    { role: 'assistant', content: 'Gelogd.' },
    { role: 'user', content: 'en die appel van daarnet?' },
  ]
  const reply = 'Die appel was zo\'n 0,5g eiwit.'
  assertFalse(fotoVoorstelOpen(msgs))
  assert(eiwitClaimDisclaimer({ reply, nutritionToolCalled: false, favorietTurn: false, fotoVoorstelOpen: fotoVoorstelOpen(msgs) }))
})

Deno.test('eiwitClaimDisclaimer: a nutrition write or a favourite turn never gets the disclaimer', () => {
  const reply = 'Gelogd: 40g eiwit.'
  for (const open of [true, false]) {
    assertFalse(eiwitClaimDisclaimer({ reply, nutritionToolCalled: true, favorietTurn: false, fotoVoorstelOpen: open }))
    assertFalse(eiwitClaimDisclaimer({ reply, nutritionToolCalled: false, favorietTurn: true, fotoVoorstelOpen: open }))
  }
})
