// Local, zero-deploy tests for vraagOnderwerp.ts (never part of a deploy
// payload — deploys are explicit file lists).
//
// Run with: deno test supabase/functions/_shared/vraagOnderwerp.test.ts

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert'
import {
  bepaalOnderwerp,
  bevatMorgenWoord,
  capVenster,
  contextVoorKaart,
  gecapteOnderwerpen,
  herkenEiwitTiming,
  splitsContext,
  toegestaneOnderwerpen,
  verschuifMorgen,
} from './vraagOnderwerp.ts'

// The backfill of coach_checkin_card.vraag_onderwerp (31 Oct - 6 Nov), with
// no newer rows — the fixture for the cap boundary tests.
const BACKFILL = [
  { datum: '2026-10-30', vraag_onderwerp: null },
  { datum: '2026-10-31', vraag_onderwerp: 'eiwit_timing' },
  { datum: '2026-11-01', vraag_onderwerp: 'maaltijd' },
  { datum: '2026-11-02', vraag_onderwerp: 'herstel' },
  { datum: '2026-11-03', vraag_onderwerp: 'eiwit_timing' },
  { datum: '2026-11-04', vraag_onderwerp: 'eiwit_timing' },
  { datum: '2026-11-05', vraag_onderwerp: 'eiwit_timing' },
  { datum: '2026-11-06', vraag_onderwerp: 'eiwit_timing' },
]

// ── Cap window ──

Deno.test('capVenster: X = 10 Nov is 4 Nov .. 9 Nov', () => {
  assertEquals(capVenster('2026-11-10'), { van: '2026-11-04', totEnMet: '2026-11-09' })
})

Deno.test('capVenster: crosses a month boundary', () => {
  assertEquals(capVenster('2026-11-03'), { van: '2026-10-28', totEnMet: '2026-11-02' })
})

Deno.test('cap: card X = 6 Nov (today) → eiwit_timing capped (4× in 31 Oct .. 5 Nov)', () => {
  assertEquals(gecapteOnderwerpen(BACKFILL, '2026-11-06'), ['eiwit_timing'])
})

Deno.test('cap boundary: card X = 10 Nov → eiwit_timing capped (4, 5, 6 Nov = 3)', () => {
  assertEquals(gecapteOnderwerpen(BACKFILL, '2026-11-10'), ['eiwit_timing'])
})

Deno.test('cap boundary: card X = 11 Nov → eiwit_timing allowed (5, 6 Nov = 2)', () => {
  assertEquals(gecapteOnderwerpen(BACKFILL, '2026-11-11'), [])
})

Deno.test('cap boundary: closer D = 9 Nov writes for X = 10 Nov → still capped', () => {
  const closerDag = '2026-11-09'
  const kaartDatum = '2026-11-10' // D + 1, exactly how summary.ts derives it
  assertEquals(capVenster(kaartDatum), { van: '2026-11-04', totEnMet: closerDag })
  assertEquals(gecapteOnderwerpen(BACKFILL, kaartDatum), ['eiwit_timing'])
})

Deno.test('cap: rows outside the window are not counted', () => {
  // 31 Oct is outside the window for X = 11 Nov; adding it must not matter.
  const extra = [...BACKFILL, { datum: '2026-10-31', vraag_onderwerp: 'eiwit_timing' }]
  assertEquals(gecapteOnderwerpen(extra, '2026-11-11'), [])
})

Deno.test('cap: the card date itself (X) is not in its own window', () => {
  const rows = [
    { datum: '2026-11-08', vraag_onderwerp: 'slaap' },
    { datum: '2026-11-09', vraag_onderwerp: 'slaap' },
    { datum: '2026-11-10', vraag_onderwerp: 'slaap' },
  ]
  assertEquals(gecapteOnderwerpen(rows, '2026-11-10'), [])
  assertEquals(gecapteOnderwerpen(rows, '2026-11-11'), ['slaap'])
})

Deno.test('cap: NULL and unknown topics are not counted', () => {
  const rows = [
    { datum: '2026-11-03', vraag_onderwerp: null },
    { datum: '2026-11-04', vraag_onderwerp: null },
    { datum: '2026-11-05', vraag_onderwerp: null },
    { datum: '2026-11-02', vraag_onderwerp: 'onzin' },
  ]
  assertEquals(gecapteOnderwerpen(rows, '2026-11-06'), [])
})

Deno.test('cap: "anders" is capped like any other topic', () => {
  const rows = ['2026-11-01', '2026-11-02', '2026-11-03'].map((datum) => ({ datum, vraag_onderwerp: 'anders' }))
  assertEquals(gecapteOnderwerpen(rows, '2026-11-06'), ['anders'])
  assertFalse(toegestaneOnderwerpen(['anders']).includes('anders'))
})

// ── eiwit_timing keyword cross-check ──

Deno.test('herkenEiwitTiming: every backfilled eiwit_timing card matches', () => {
  for (const t of [
    'Lukt het om vandaag al bij het ontbijt een eiwitrijke keuze in te bouwen?',
    'Lukte het om voor de middag al een eiwitrijke start te maken?',
    'Lukt het om bij het ontbijt vandaag al een eiwitrijkere start te pakken?',
    "Lukt het om vandaag het meeste eiwit wat eerder op de dag binnen te krijgen, in plaats van pas 's avonds laat?",
    'Zou je je laatste eiwitmoment vanavond wat eerder kunnen inplannen dan vlak voor het slapen?',
    'Lukt het je om je eiwit vandaag weer mooi verspreid over de dag binnen te krijgen?',
    'Je werkte dinsdag een keertje thuis — lukt het je morgen ook om je eiwit zo goed over de dag te verdelen?',
  ]) assert(herkenEiwitTiming(t), t)
})

Deno.test('herkenEiwitTiming: other topics do not match', () => {
  for (const t of [
    'Ga je vandaag weer een eiwitrijke hoofdmaaltijd klaarmaken, net als met de kippendijen?',
    'Hoe voelen je benen vandaag aan na je nuchtere beendag van zondag?',
    'Zou je morgen bij je spaghetti of rijst kunnen doorgeven of je het rauw of gekookt hebt gewogen?',
    'Hoe voel je je vandaag, is de griep al wat gezakt?',
    'Je bent morgen vrij met de kids — lukt het je om tussendoor een eiwitrijke snack binnen handbereik te houden?',
  ]) assertFalse(herkenEiwitTiming(t), t)
})

Deno.test('bepaalOnderwerp: a mislabelled protein-timing question is relabelled', () => {
  assertEquals(bepaalOnderwerp('maaltijd', 'Lukt het om bij het ontbijt al eiwit te pakken?'), { onderwerp: 'eiwit_timing', herlabeld: true })
  assertEquals(bepaalOnderwerp('eiwit_timing', 'Lukt het om bij het ontbijt al eiwit te pakken?'), { onderwerp: 'eiwit_timing', herlabeld: false })
  assertEquals(bepaalOnderwerp('herstel', 'Hoe voelen je benen aan?'), { onderwerp: 'herstel', herlabeld: false })
  assertEquals(bepaalOnderwerp(null, 'Zou je morgen je laatste eiwitmoment wat eerder kunnen plannen?'), { onderwerp: 'eiwit_timing', herlabeld: true })
  assertEquals(bepaalOnderwerp(undefined, 'Hoe voelen je benen aan?'), { onderwerp: null, herlabeld: false })
})

// ── "morgen" conversion ──

Deno.test('15 Oct closer text never yields "morgen" on the 16 Oct card', () => {
  const uit = verschuifMorgen('Je hebt vandaag veel van je eten onderweg in de auto gegeten — lukt het morgen om iets eiwitrijks mee te nemen voor de rit?')
  assertFalse(bevatMorgenWoord(uit))
  assert(uit.includes('lukt het vandaag om iets eiwitrijks'))
  assertEquals(verschuifMorgen('lukt het morgen om iets eiwitrijks mee te nemen voor de rit?'), 'lukt het vandaag om iets eiwitrijks mee te nemen voor de rit?')
})

Deno.test('morgenochtend → vanochtend, morgenavond → vanavond, morgenmiddag/morgenvroeg', () => {
  assertEquals(verschuifMorgen('Lukt het je morgenochtend wel om iets eiwitrijks te eten?'), 'Lukt het je vanochtend wel om iets eiwitrijks te eten?')
  assertEquals(verschuifMorgen('Ga je morgenavond boksen?'), 'Ga je vanavond boksen?')
  assertEquals(verschuifMorgen('Eet je morgenmiddag op kantoor?'), 'Eet je vanmiddag op kantoor?')
  assertEquals(verschuifMorgen('Train je morgenvroeg nuchter?'), 'Train je vanochtend nuchter?')
})

Deno.test('capitalisation is preserved', () => {
  assertEquals(verschuifMorgen('Morgen lukt het?'), 'Vandaag lukt het?')
  assertEquals(verschuifMorgen('Morgenochtend train je?'), 'Vanochtend train je?')
})

Deno.test('overmorgen and \'s morgens are untouched', () => {
  assertEquals(verschuifMorgen('Ga je overmorgen trainen?'), 'Ga je overmorgen trainen?')
  assertEquals(verschuifMorgen("Eet je 's morgens altijd kwark?"), "Eet je 's morgens altijd kwark?")
  assertEquals(verschuifMorgen('Eet je morgens altijd kwark?'), 'Eet je morgens altijd kwark?')
})

Deno.test('single pass: morgen → vandaag is not converted again', () => {
  assertEquals(verschuifMorgen('morgen en morgenavond'), 'vandaag en vanavond')
})

Deno.test('unchanged: closer texts already written from the card\'s perspective (24 Oct, 29 Oct)', () => {
  const t24 = 'Hoe voel je je vandaag, is de griep al wat gezakt?'
  const t29 = 'Zit je vandaag weer veel in de auto, en lukt het dan om al eerder op de dag een eiwitrijke optie mee te nemen?'
  assertEquals(verschuifMorgen(t24), t24)
  assertEquals(verschuifMorgen(t29), t29)
})

Deno.test('output guard: detects a "morgen" word, ignores overmorgen/\'s morgens', () => {
  assert(bevatMorgenWoord('Lukt het om morgen iets eiwitrijks mee te nemen?'))
  assert(bevatMorgenWoord('Morgenavond weer boksen?'))
  assertFalse(bevatMorgenWoord('Lukt het om vandaag iets eiwitrijks mee te nemen?'))
  assertFalse(bevatMorgenWoord("Eet je 's morgens kwark?"))
  assertFalse(bevatMorgenWoord('Ga je overmorgen trainen?'))
  assertFalse(bevatMorgenWoord(null))
})

// ── Context clause ──

Deno.test('splitsContext: splits on the first " — "', () => {
  assertEquals(splitsContext('Je bent morgen vrij met de kids — lukt het je om tussendoor een eiwitrijke snack binnen handbereik te houden?'), {
    context: 'Je bent morgen vrij met de kids',
    vraag: 'lukt het je om tussendoor een eiwitrijke snack binnen handbereik te houden?',
  })
  assertEquals(splitsContext('Hoe voelen je benen aan?'), { context: null, vraag: 'Hoe voelen je benen aan?' })
})

Deno.test('contextVoorKaart: 13 Oct context is converted and kept', () => {
  assertEquals(
    contextVoorKaart('Je bent morgen vrij met de kids — lukt het je om tussendoor een eiwitrijke snack binnen handbereik te houden?'),
    'Je bent vandaag vrij met de kids.',
  )
})

Deno.test('contextVoorKaart: a day-D word in the context is never copied (15 Oct, 3 Nov)', () => {
  assertEquals(contextVoorKaart('Je hebt vandaag veel van je eten onderweg in de auto gegeten — lukt het morgen om iets eiwitrijks mee te nemen voor de rit?'), null)
  assertEquals(contextVoorKaart('Je kwam gisteren pas laat op de avond bij je eiwitdoel uit — zou je morgen al bij het ontbijt een eiwitrijkere start kunnen pakken?'), null)
})

Deno.test('contextVoorKaart: weekday-anchored context is kept as-is', () => {
  assertEquals(
    contextVoorKaart('Je werkte dinsdag een keertje thuis — lukt het je morgen ook om je eiwit zo goed over de dag te verdelen?'),
    'Je werkte dinsdag een keertje thuis.',
  )
  assertEquals(contextVoorKaart('Hoe voelen je benen aan na de beendag van zondag?'), null)
})
