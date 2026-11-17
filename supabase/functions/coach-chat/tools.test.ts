// Local, zero-deploy tests for tools.ts's pure parts (never part of a deploy
// payload). tools.ts builds a Supabase client at import time, so this needs
// dummy env values — nothing here touches the network:
//
//   SUPABASE_URL=http://localhost:1 SUPABASE_ANON_KEY=dummy \
//     deno test --allow-env supabase/functions/coach-chat/tools.test.ts

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert'
import { TOOLS, buildTools, productComponent, type Product } from './tools.ts'
import { alsFotoSchatting } from './foto.ts'

function product(over: Partial<Product>): Product {
  return {
    id: 'p',
    naam: 'Product',
    gewicht_basis: 'nvt',
    eiwit_per_100g: null,
    kcal_per_100g: null,
    stuk_naam: null,
    stuk_gewicht_g: null,
    eiwit_per_stuk: null,
    kcal_per_stuk: null,
    ...over,
  }
}

// Shapes of real products (17 Nov): per piece only, per piece with a piece
// weight on top of per-100g values, and per 100g cooked.
const bruinBrood = product({ id: 'brood', naam: 'Bruin brood', stuk_naam: 'snee', eiwit_per_stuk: 4, kcal_per_stuk: 80 })
const eiwitLimo = product({ id: 'limo', naam: 'Upfront Eiwit Limo', stuk_naam: 'limo', eiwit_per_stuk: 19, kcal_per_stuk: 80 })
const kipfiletBeleg = product({ id: 'beleg', naam: 'Kipfilet broodbeleg', stuk_naam: 'plak', stuk_gewicht_g: 12.5, eiwit_per_100g: 15, kcal_per_100g: 100 })
const kipBereid = product({ id: 'kip', naam: 'Kipfilet bereid', gewicht_basis: 'bereid', eiwit_per_100g: 31, kcal_per_100g: 165 })

Deno.test('productComponent + alsFotoSchatting: per-piece product, fractional midpoint (2-3 sneeën → 2,5)', () => {
  const r = productComponent(bruinBrood, null, 2.5, null)
  assert(r.ok)
  if (!r.ok) return
  assertEquals(r.component.eiwitten_g, 10)
  assertEquals(r.component.calorieen, 200)
  assertEquals(r.component.hoeveelheid, '2,5 sneeën')
  const foto = alsFotoSchatting(r.component)
  assertEquals(foto.bron, 'geschat')
  assertEquals(foto.product_id, 'brood')
  assertEquals(foto.stuks, 2.5)
  assertEquals(foto.hoeveelheid, '~2,5 sneeën')
  assertEquals(foto.eiwitten_g, 10)
})

Deno.test('productComponent: per-piece-only product refuses gram (photo or not)', () => {
  const r = productComponent(eiwitLimo, 330, null, 'bereid')
  assertFalse(r.ok)
})

Deno.test('productComponent: one Eiwit Limo, and the new plural for two', () => {
  const een = productComponent(eiwitLimo, null, 1, null)
  assert(een.ok && een.component.hoeveelheid === '1 limo' && een.component.eiwitten_g === 19)
  const twee = productComponent(eiwitLimo, null, 2, null)
  assert(twee.ok && twee.component.hoeveelheid === "2 limo's")
})

Deno.test('productComponent: per-piece via piece weight × per-100g', () => {
  const r = productComponent(kipfiletBeleg, null, 3, null)
  assert(r.ok)
  if (!r.ok) return
  assertEquals(r.component.eiwitten_g, 5.625)
  assertEquals(alsFotoSchatting(r.component).hoeveelheid, '~3 plakken (37,5g)')
})

Deno.test('productComponent + alsFotoSchatting: per-100g cooked product with estimated grams', () => {
  const r = productComponent(kipBereid, 140, null, 'bereid')
  assert(r.ok)
  if (!r.ok) return
  assertEquals(Math.round(r.component.eiwitten_g * 10) / 10, 43.4)
  assertEquals(r.component.bron, 'product')
  assertEquals(r.component.hoeveelheid, '140g bereid')
  const foto = alsFotoSchatting(r.component)
  assertEquals(foto.bron, 'geschat')
  assertEquals(foto.hoeveelheid, '~140g bereid')
})

Deno.test('productComponent without a photo is unchanged: bron product, no "~"', () => {
  const r = productComponent(bruinBrood, null, 2, null)
  assert(r.ok && r.component.bron === 'product' && r.component.hoeveelheid === '2 sneeën')
})

Deno.test('buildTools: without a photo the exact TOOLS array is sent (same request body as before)', () => {
  assert(buildTools({ fotoInGesprek: false }) === TOOLS)
})

Deno.test('buildTools: with a photo nutrition_log_add requires herkomst; nothing else changes', () => {
  const tools = buildTools({ fotoInGesprek: true }) as typeof TOOLS
  assertEquals(tools.length, TOOLS.length)
  const add = tools.find((t) => t.name === 'nutrition_log_add')!
  const schema = add.input_schema as unknown as { properties: Record<string, { enum?: string[] }>; required: string[] }
  assertEquals(schema.properties.herkomst.enum, ['foto', 'geen'])
  assertEquals(schema.required, ['omschrijving', 'componenten', 'tijdstip', 'herkomst'])
  // the original schema object is not mutated
  const origineel = TOOLS.find((t) => t.name === 'nutrition_log_add')!.input_schema as { properties: Record<string, unknown>; required: string[] }
  assertFalse('herkomst' in origineel.properties)
  assertEquals(origineel.required, ['omschrijving', 'componenten', 'tijdstip'])
  for (let i = 0; i < TOOLS.length; i++) {
    if (TOOLS[i].name !== 'nutrition_log_add') assert(tools[i] === TOOLS[i])
  }
})
