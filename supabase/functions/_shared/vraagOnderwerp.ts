// Topic cap for the morning check-in question, plus the closer→card day-word
// shift. Pure functions only (no imports, no I/O), shared by the closer
// (_shared/summary.ts, which writes vraag_voor_morgen) and the card
// (morning-checkin), so both ends enforce exactly the same rules.
//
// Why this exists (2026-11-06): 18 of 19 cards (19 Oct - 6 Nov) took their
// question from the closer, which judges each day in isolation — a stable
// habit (less protein in the morning, his normal pattern) became a "protein
// earlier in the day" question on ~12 of 19 days. A prompt rule "don't
// repeat the last three questions" did not hold (the third prompt-only
// anti-repetition rule in this project to fail). The fix is structural: a
// topic that occurred CAP_MAX times in the window is removed from the tool
// schema's enum, so the model cannot pick it at all.

export const VRAAG_ONDERWERPEN = [
  'eiwit_timing',
  'maaltijd',
  'herstel',
  'energie',
  'slaap',
  'gezondheid',
  'logging',
  'training',
  'anders',
] as const

export type VraagOnderwerp = (typeof VRAAG_ONDERWERPEN)[number]

// Point-of-use descriptions, rendered into the enum field's description of
// both tool schemas (record_summary.vraag_onderwerp, render_checkin_card.
// vraag_onderwerp). Must stay in sync with the CHECK constraint in
// supabase/migrations/20261106_vraag_onderwerp.sql.
export const VRAAG_ONDERWERP_BESCHRIJVING: Record<VraagOnderwerp, string> = {
  eiwit_timing: 'ontbijt, eiwit eerder op de dag, verdeling over de dag, het laatste eiwitmoment \'s avonds',
  maaltijd: 'een specifieke maaltijd of wat hij gaat eten/klaarmaken (niet het tijdstip of de verdeling van eiwit)',
  herstel: 'spierpijn, stijfheid, hoe het lichaam aanvoelt na een training',
  energie: 'energieniveau, energiedip, hoe fit hij zich voelt',
  slaap: 'slapen, uitrusten, op tijd naar bed',
  gezondheid: 'ziekte, blessure, klachten (griep, enkel, schouder)',
  logging: 'hoe iets gelogd of gewogen is (rauw/bereid, per stuk of totaal, verpakkingswaarden)',
  training: 'de training zelf: of, wanneer of hoe hij traint',
  anders: 'iets dat in geen van de andere onderwerpen past',
}

// "Max 3 per 7 days": a topic is allowed on card date X if it occurs fewer
// than CAP_MAX times in coach_checkin_card for X-6 .. X-1 (what the user
// actually saw, not what the closer proposed).
export const CAP_MAX = 3
export const CAP_VENSTER_DAGEN = 6

export function isVraagOnderwerp(value: unknown): value is VraagOnderwerp {
  return typeof value === 'string' && (VRAAG_ONDERWERPEN as readonly string[]).includes(value)
}

// Calendar-date arithmetic on 'YYYY-MM-DD' strings, done in UTC so it never
// depends on the runtime's timezone or a DST transition.
export function plusDagen(isoDatum: string, dagen: number): string {
  const [y, m, d] = isoDatum.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + dagen))
  return t.toISOString().slice(0, 10)
}

// The single definition of the cap window, for both ends:
// - morning-checkin calls it with X = today's card date;
// - the closer on day D calls it with X = D+1 (it writes the question for
//   tomorrow's card), so its window is D-5 .. D by construction.
export function capVenster(kaartDatum: string): { van: string; totEnMet: string } {
  return { van: plusDagen(kaartDatum, -CAP_VENSTER_DAGEN), totEnMet: plusDagen(kaartDatum, -1) }
}

// Topics that hit the cap for card date X. Rows outside capVenster(X) are
// ignored (so a query that fetched too wide a range can't inflate a count),
// and so are NULL / unknown topics: rows written before the column existed
// count as "no topic", which means the cap ramps up from the deploy on.
export function gecapteOnderwerpen(
  rows: { datum: string; vraag_onderwerp: string | null }[],
  kaartDatum: string,
): VraagOnderwerp[] {
  const { van, totEnMet } = capVenster(kaartDatum)
  const telling = new Map<VraagOnderwerp, number>()
  for (const row of rows) {
    if (row.datum < van || row.datum > totEnMet) continue
    if (!isVraagOnderwerp(row.vraag_onderwerp)) continue
    telling.set(row.vraag_onderwerp, (telling.get(row.vraag_onderwerp) ?? 0) + 1)
  }
  return VRAAG_ONDERWERPEN.filter((o) => (telling.get(o) ?? 0) >= CAP_MAX)
}

export function toegestaneOnderwerpen(gecapt: VraagOnderwerp[]): VraagOnderwerp[] {
  return VRAAG_ONDERWERPEN.filter((o) => !gecapt.includes(o))
}

// One line per allowed topic, for the enum field's description.
export function onderwerpenBeschrijving(toegestaan: VraagOnderwerp[]): string {
  return toegestaan.map((o) => `"${o}": ${VRAAG_ONDERWERP_BESCHRIJVING[o]}`).join('; ')
}

// The fact line both prompts get (same style as §28's stemming ban): which
// topics are unavailable and why. Empty string when nothing is capped.
export function gecaptFeitRegel(gecapt: VraagOnderwerp[], voorWanneer: 'vandaag' | 'morgen'): string {
  if (gecapt.length === 0) return ''
  return `- Onderwerp(en) die ${voorWanneer} NIET beschikbaar zijn voor de vraag, omdat ze in de afgelopen 7 dagen al ${CAP_MAX}× op de ochtendkaart stonden: ${gecapt.map((o) => `"${o}" (${VRAAG_ONDERWERP_BESCHRIJVING[o]})`).join(', ')}. Ze staan daarom ook niet in de tool-opties — kies een ander onderwerp.`
}

// Self-labelling has already failed once (05 Nov: card said vraag_bron
// "afsluiter" but asked about protein timing). eiwit_timing is the one topic
// that actually ran away, so it alone gets a narrow keyword cross-check on
// the question text; every other topic relies on the enum.
const EIWIT_TIMING_PATROON =
  /ontbijt|eerder op de dag|vroeger op de dag|voor de middag|(?:verdeel|verdelen|verdeeld|verspreid)\w*\s+over\s+de\s+dag|over de dag (?:te )?(?:verdel|verspreid)|eiwitrijk\w*\s+start|laatste eiwitmoment|vlak voor het slapen|pas 's avonds|eerder op de avond|vroeger op de avond/i

export function herkenEiwitTiming(tekst: string | null | undefined): boolean {
  return Boolean(tekst) && EIWIT_TIMING_PATROON.test(tekst!)
}

// The topic a question really has: the model's label, overruled by the
// eiwit_timing keyword check. `herlabeld` is true when the code changed it.
export function bepaalOnderwerp(
  label: string | null | undefined,
  vraagTekst: string | null | undefined,
): { onderwerp: VraagOnderwerp | null; herlabeld: boolean } {
  const gelabeld = isVraagOnderwerp(label) ? label : null
  if (herkenEiwitTiming(vraagTekst) && gelabeld !== 'eiwit_timing') {
    return { onderwerp: 'eiwit_timing', herlabeld: true }
  }
  return { onderwerp: gelabeld, herlabeld: false }
}

// ── Relative day words: closer (day D) → card (day D+1) ──
//
// Only the "morgen" family is converted. The closer writes on D for the card
// on D+1, so its "morgen" always means the card's "vandaag". Other relative
// words are deliberately NOT converted: the closer often already writes from
// the card's perspective (24 Oct "Hoe voel je je vandaag, …?", 29 Oct "Zit je
// vandaag weer veel in de auto, …?" — both correct as-is), and the cron
// closes day D at ~03:00 on D+1, so "vandaag" is ambiguous anyway.
//
// Single pass (no chaining), letter-boundary lookarounds instead of \b
// (Unicode-safe, and the preceding-apostrophe exclusion keeps "'s morgens"
// intact — "overmorgen" and "morgens" never match either).
const MORGEN_VERVANGING: Record<string, string> = {
  morgenochtend: 'vanochtend',
  morgenvroeg: 'vanochtend',
  morgenmiddag: 'vanmiddag',
  morgenavond: 'vanavond',
  morgen: 'vandaag',
}
const MORGEN_PATROON = /(?<![\p{L}'])(morgenochtend|morgenvroeg|morgenmiddag|morgenavond|morgen)(?![\p{L}])/giu

export function verschuifMorgen(tekst: string): string {
  return tekst.replace(MORGEN_PATROON, (match) => {
    const vervanging = MORGEN_VERVANGING[match.toLowerCase()]
    return match[0] === match[0].toUpperCase() ? vervanging[0].toUpperCase() + vervanging.slice(1) : vervanging
  })
}

// Output guard for the card: true when the text contains a "morgen" word.
export function bevatMorgenWoord(tekst: string | null | undefined): boolean {
  if (!tekst) return false
  return new RegExp(MORGEN_PATROON.source, 'iu').test(tekst)
}

// "Je bent morgen vrij met de kids — lukt het je om …?" → context + question.
// Splits on the first " — " only; no split when either side would be empty.
export function splitsContext(tekst: string): { context: string | null; vraag: string } {
  const i = tekst.indexOf(' — ')
  if (i <= 0) return { context: null, vraag: tekst.trim() }
  const context = tekst.slice(0, i).trim()
  const vraag = tekst.slice(i + 3).trim()
  if (!context || !vraag) return { context: null, vraag: tekst.trim() }
  return { context, vraag }
}

// A relative day word other than the "morgen" family in the ORIGINAL
// (unconverted) context clause means the closer wrote that clause from its
// own day D ("Je hebt vandaag veel … gegeten", "Je kwam gisteren pas laat
// …"); copied onto the D+1 card it would name the wrong day. Such a clause
// is never copied by code — it is left to the model, which has the
// "Gisteren was…/Vandaag is…" anchors.
const ANDER_DAGWOORD_PATROON =
  /(?<![\p{L}])(vandaag|gisteren|eergisteren|vanavond|vanochtend|vanmiddag|vannacht|gisteravond|gisterochtend|gistermiddag)(?![\p{L}])/iu

export function contextVeiligVoorKaart(origineleContext: string | null): boolean {
  return Boolean(origineleContext) && !ANDER_DAGWOORD_PATROON.test(origineleContext!)
}

// The boodschap the card gets when it uses the closer's question but drops
// its context: the converted context clause as a sentence, or null when
// there is no clause or it isn't safe to copy (see contextVeiligVoorKaart).
export function contextVoorKaart(origineleVraagVoorMorgen: string): string | null {
  const { context } = splitsContext(origineleVraagVoorMorgen)
  if (!context || !contextVeiligVoorKaart(context)) return null
  const omgezet = verschuifMorgen(context)
  return /[.!?]$/.test(omgezet) ? omgezet : `${omgezet}.`
}
