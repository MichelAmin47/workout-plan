// Local, zero-deploy test for the photo-meal lines of the morning card's
// prompt (never part of a deploy payload). Like validateAntwoordOpties.test.ts
// it imports index.ts, so it needs dummy env values and lets Deno.serve bind:
//
//   SUPABASE_URL=http://localhost:1 SUPABASE_ANON_KEY=dummy SUPABASE_SERVICE_ROLE_KEY=dummy \
//     deno test --allow-env --allow-net supabase/functions/morning-checkin/fotoRegel.test.ts

import { assert, assertEquals } from 'jsr:@std/assert'
import { FOTO_REGEL, formatGisterenMeals } from './index.ts'

Deno.test('formatGisterenMeals: a photo meal is labelled, other meals are unchanged', () => {
  const text = formatGisterenMeals([
    { tijdstip: '12:30:00', omschrijving: 'Brood met kip', eiwitten_g: 22.4, herkomst: null },
    { tijdstip: '18:45:00', omschrijving: 'Kip met rijst bij mijn moeder', eiwitten_g: 40, herkomst: 'foto' },
  ])
  assertEquals(text, '- 12:30:00 Brood met kip: 22.4g eiwit\n- 18:45:00 Kip met rijst bij mijn moeder (schatting van foto): 40g eiwit')
})

Deno.test('formatGisterenMeals: rows without herkomst (older select shape) and an empty day', () => {
  assertEquals(formatGisterenMeals([{ tijdstip: null, omschrijving: 'Shake', eiwitten_g: 25 }]), '- ? Shake: 25g eiwit')
  assertEquals(formatGisterenMeals([]), 'Geen maaltijden gelogd.')
})

Deno.test('FOTO_REGEL: ranges/no weights for photo meals and never ask for a photo', () => {
  assert(FOTO_REGEL.includes('(schatting van foto)'))
  assert(FOTO_REGEL.includes('nooit een gewicht van het eten'))
  assert(FOTO_REGEL.includes('Vraag hem nooit om een foto'))
})
