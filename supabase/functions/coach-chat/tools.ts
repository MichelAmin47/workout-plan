import { supabase } from '../_shared/supabaseClient.ts'
import { closeDayWithSummary } from '../_shared/summary.ts'

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: unknown
}

// Flattens the working message list into plain "Gebruiker: ... / Coach: ..."
// turns for the summary model, skipping tool_use/tool_result plumbing.
function buildTranscript(messages: ConversationMessage[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      lines.push(`${msg.role === 'user' ? 'Gebruiker' : 'Coach'}: ${msg.content}`)
    } else if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { text: string }) => block.text)
        .join(' ')
      if (text.trim()) {
        lines.push(`${msg.role === 'user' ? 'Gebruiker' : 'Coach'}: ${text.trim()}`)
      }
    }
  }
  return lines.join('\n')
}

// The day-close model and morning-checkin read these facts later, out of
// this conversation's context — a third-person fact about the user has to
// get his gender right on its own (02-10: a day-close aandachtspunt said
// "haar"; the user is a man). Same rule as _shared/summary.ts.
const FEIT_DESCRIPTION =
  'The fact, phrased as a neutral statement/observation. Refer to the user as "de gebruiker" or "hij/hem/zijn" — never "zij/haar".'

// One component of a logged meal, shared by nutrition_log_add's componenten
// and nutrition_log_update's component_wijziging/component_toevoegen. Two
// shapes in one schema: a known product (product_id + gram|stuks — the
// SERVER computes protein/kcal from nutrition_product, see resolveComponent
// below; that is the whole fix for a stored product value being applied
// wrongly) or an estimate (naam + hoeveelheid + eiwitten_g + calorieen).
const COMPONENT_PROPERTIES = {
  product_id: {
    type: 'string',
    description:
      'id of a product from the "Bekende producten" context list — only when this component really IS that product. With product_id, do NOT send eiwitten_g/calorieen/naam/hoeveelheid: the server computes them from the product and the amount.',
  },
  gram: { type: 'number', description: 'Amount in grams. With product_id: exactly one of gram or stuks.' },
  stuks: { type: 'number', description: 'Number of pieces in the product\'s own unit (plakken, pakjes, …). With product_id: exactly one of gram or stuks.' },
  basis: {
    type: 'string',
    enum: ['rauw', 'bereid'],
    description: 'Only for weighed meat/fish: whether the gram amount is the raw or the cooked (bereid) weight. Never guess this — see the tool description.',
  },
  naam: { type: 'string', description: 'Without product_id: short name of the component, e.g. "volkoren brood"' },
  hoeveelheid: { type: 'string', description: 'Without product_id: the amount as shown on the card, e.g. "2 sneetjes", "150g", "1 bakje". Include "rauw"/"bereid" for weighed meat/fish, e.g. "70g bereid".' },
  eiwitten_g: { type: 'number', description: 'Without product_id: grams of protein for this component' },
  calorieen: { type: 'number', description: 'Without product_id: kcal for this component' },
  bron: {
    type: 'string',
    enum: ['geschat', 'gebruiker'],
    description: 'Without product_id: "geschat" when the numbers are your estimate; "gebruiker" only when the user stated the value for this component themselves (e.g. "dat was 135 kcal").',
  },
}

export const TOOLS = [
  {
    name: 'nutrition_log_add',
    description:
      'Log a meal or snack the user has ACTUALLY eaten (not something planned/future), split into its components (one per distinct food: "crackers met 3 plakken kipfilet" = 2 components). A single item is one component. For every component that matches a product in the "Bekende producten" context list, use product_id + gram or stuks — never estimate a known product yourself. Anything else is a component with bron "geschat" and your own estimate. The server computes the meal totals from the components; the logged meal is shown to the user as a card with each component, so the numbers must be checkable. RAW VS COOKED: for weighed meat or fish (e.g. "70g rul gehakt", "100g kalkoenshoarma") where it is not clear whether the weight is raw or cooked (bereid), ask the user once ("was die 70g rauw of bereid gewogen?") BEFORE logging, then set basis on that component. Do not ask when the user already said it, or when the amount is not a weight (pieces, slices, a portion).',
    input_schema: {
      type: 'object',
      properties: {
        omschrijving: { type: 'string', description: 'Short description of what was eaten, e.g. "2 boterhammen met kaas"' },
        componenten: {
          type: 'array',
          minItems: 1,
          description: 'One entry per component of the meal (at least one).',
          items: { type: 'object', properties: COMPONENT_PROPERTIES },
        },
        tijdstip: {
          type: 'string',
          description:
            'Time the meal was EATEN, not when it is being logged, 24h HH:MM, Europe/Amsterdam. If the user states a time, or says "net"/"zojuist" and clearly means right now, use that directly — do not ask. Otherwise, ask one short question for the actual eating time (e.g. "was dat vanochtend, of net?") instead of defaulting to the current time from context, but only when there is a real signal the two might diverge: the meal is described with an earlier-moment word ("ontbijt", "lunch", "vanochtend", "tussen de middag") while the current time is well past that window, or several meals are being logged in one message. Do not ask this on every log — only when one of those signals is present.',
        },
      },
      required: ['omschrijving', 'componenten', 'tijdstip'],
    },
  },
  {
    name: 'nutrition_log_update',
    description:
      'Correct an existing nutrition_log entry. Use the id from the "vandaag gelogde maaltijden" context list (or from this turn\'s nutrition_log_add result). A meal WITH components is corrected one component at a time — never re-derive the whole meal: component_wijziging changes one component (only the fields you pass), component_toevoegen adds one, component_verwijderen removes one; at most one of these per call. The server recomputes the meal totals. COMPONENT INDICES: if this meal was already added or updated earlier in this same turn, use the indices from that latest tool result, NOT from the context list — removing a component shifts the indices of everything after it. If the user gives new package values for a product, first update the product with product_opslaan, then call this with component_wijziging { index, herbereken: true } so that component is recomputed from the corrected product. eiwitten_g/calorieen at the top level are ONLY for old meals listed without components.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'uuid of the nutrition_log row to correct' },
        omschrijving: { type: 'string' },
        tijdstip: {
          type: 'string',
          description:
            'Corrected eating time, 24h HH:MM, Europe/Amsterdam — only when the user is stating/correcting the time for this specific row (e.g. "dat was eigenlijk om 8 uur"). Apply directly, don\'t ask for confirmation of a time they just gave. Never volunteer a time correction unprompted for a row the user hasn\'t questioned.',
        },
        component_wijziging: {
          type: 'object',
          description: 'Change one existing component. Pass index plus only the fields that change.',
          properties: {
            index: { type: 'number', description: 'Index (#) of the component to change' },
            herbereken: { type: 'boolean', description: 'true = recompute this product component from the (corrected) product table' },
            ...COMPONENT_PROPERTIES,
          },
          required: ['index'],
        },
        component_toevoegen: {
          type: 'object',
          description: 'Add one component to this meal (same shape as a nutrition_log_add component).',
          properties: COMPONENT_PROPERTIES,
        },
        component_verwijderen: { type: 'number', description: 'Index (#) of the component to remove' },
        eiwitten_g: { type: 'number', description: 'ONLY for an old meal without components' },
        calorieen: { type: 'number', description: 'ONLY for an old meal without components' },
      },
      required: ['id'],
    },
  },
  {
    name: 'nutrition_log_delete',
    description: 'Remove a nutrition_log entry that was logged in error (e.g. a duplicate, or something the user says they had not actually eaten yet).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'uuid of the nutrition_log row to delete' } },
      required: ['id'],
    },
  },
  {
    name: 'product_opslaan',
    description:
      'Store a new product, or correct an existing one (pass its id from "Bekende producten"), in the product table. ONLY with values the user gives you from a package or states as fact (e.g. "Jumbo minicrackers, per pak 3,1g eiwit, 135 kcal") — NEVER with your own estimates. This is where product values belong: never store them in coach_memory. Correcting a product here is what makes the correction hold for every future log. Values per 100g and/or per piece (stuk_naam + per-piece values, or stuk_naam + stuk_gewicht_g together with per-100g values); protein and kcal always as a pair. For meat or fish, gewicht_basis must say whether the per-100g values are for the raw or the cooked (bereid) weight — ask if the user did not say; raw and cooked are separate products.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'uuid of an existing product to correct; omit to create a new one' },
        naam: { type: 'string', description: 'Product name incl. brand where known, e.g. "Jumbo minicrackers"' },
        zoektermen: { type: 'array', items: { type: 'string' }, description: 'Other words the user uses for it, e.g. ["minicrackers"]' },
        gewicht_basis: { type: 'string', enum: ['nvt', 'rauw', 'bereid'], description: '"rauw"/"bereid" for meat and fish, otherwise "nvt"' },
        eiwit_per_100g: { type: 'number' },
        kcal_per_100g: { type: 'number' },
        stuk_naam: { type: 'string', description: 'Name of one piece, singular: "plak", "pak", "reep"' },
        stuk_gewicht_g: { type: 'number', description: 'Weight of one piece in grams, when known' },
        eiwit_per_stuk: { type: 'number' },
        kcal_per_stuk: { type: 'number' },
        bron: { type: 'string', enum: ['verpakking', 'gebruiker'], description: '"verpakking" when read from the package, otherwise "gebruiker"' },
        notitie: { type: 'string' },
      },
      required: ['naam', 'gewicht_basis', 'bron'],
    },
  },
  {
    name: 'memory_add',
    description:
      'Store a new durable fact about the user in long-term memory. Only call this when the fact passes ALL storage criteria from your instructions (still true in a month, would concretely change future advice, not already readable from other context). When in doubt, do not call this. Product values (protein/kcal per 100g or per piece) never go here — those belong in product_opslaan.',
    input_schema: {
      type: 'object',
      properties: {
        feit: { type: 'string', description: FEIT_DESCRIPTION },
        categorie: { type: 'string', enum: ['voorkeur', 'gewoonte', 'definitie', 'vaste_gewoonte'] },
      },
      required: ['feit', 'categorie'],
    },
  },
  {
    name: 'memory_update',
    description: 'Rewrite/refine the wording of an existing active memory fact. Use this instead of memory_add when a near-duplicate fact about the same subject already exists in context.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'uuid of the coach_memory row to update' },
        feit: { type: 'string', description: FEIT_DESCRIPTION },
      },
      required: ['id', 'feit'],
    },
  },
  {
    name: 'memory_deactivate',
    description: 'Retire a memory fact that the user says is wrong or no longer applies. Soft delete — never permanently removed.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'uuid of the coach_memory row to deactivate' } },
      required: ['id'],
    },
  },
  {
    name: 'close_day_summary',
    description:
      'Close out today and write the end-of-day summary. Call this when the user asks to close/end the day (e.g. "sluit de dag af"). This triggers a separate compression step over the whole conversation — do not write the summary yourself.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'weight_log_add',
    description: 'Log a body weight measurement the user just reported (e.g. "ik weeg 110,4", "110,4 kg vanochtend"). Parse the number, including Dutch decimal-comma notation.',
    input_schema: {
      type: 'object',
      properties: {
        gewicht: { type: 'number', description: 'Body weight in kg, e.g. 110.4' },
      },
      required: ['gewicht'],
    },
  },
  {
    name: 'weight_log_update',
    description: 'Correct a previously logged weight measurement (e.g. the user says they mistyped it). Use the id from context if available, or ask which entry if ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'uuid of the weight_log row to correct' },
        gewicht: { type: 'number', description: 'Corrected body weight in kg' },
      },
      required: ['id', 'gewicht'],
    },
  },
  {
    name: 'render_meal_card',
    description:
      'Render a concrete meal suggestion as a structured card instead of writing it out as text. Only for a specific suggestion with identifiable ingredients (e.g. "kip met zoete aardappel en broccoli") — NOT for general advice with no concrete components (e.g. "eet vanavond wat meer koolhydraten"), which stays a plain reply. This is a suggestion for something not yet eaten, not a log entry — do not call nutrition_log_add for it.',
    input_schema: {
      type: 'object',
      properties: {
        titel: { type: 'string', description: 'Short name for the suggestion, e.g. "Kip met zoete aardappel"' },
        tag: { type: 'string', description: 'Short uppercase category label, e.g. "AVONDETEN", "LUNCH", "SNACK"' },
        ingredienten: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              naam: { type: 'string' },
              hoeveelheid: { type: 'string', description: 'Quantity, e.g. "150g" or "1 stuk"' },
            },
            required: ['naam', 'hoeveelheid'],
          },
        },
        kcal: { type: 'number', description: 'Estimated total calories for this suggestion' },
        eiwitten_g: { type: 'number', description: 'Estimated grams of protein' },
        koolhydraten_g: { type: 'number', description: 'Estimated grams of carbohydrates' },
        vet_g: { type: 'number', description: 'Estimated grams of fat' },
      },
      required: ['titel', 'tag', 'ingredienten', 'kcal', 'eiwitten_g', 'koolhydraten_g', 'vet_g'],
    },
  },
]

interface MealCardInput {
  titel: string
  tag: string
  ingredienten: { naam: string; hoeveelheid: string }[]
  kcal: number
  eiwitten_g: number
  koolhydraten_g: number
  vet_g: number
}

// Maps the tool's raw fields onto the exact shape MealCard/cardToText
// already expect (see Coach.jsx's render switch and chatApi.js) — items:
// [{name, detail}], macros: [{val, label}] in a fixed kcal/eiwit/koolhydraten/vet
// order. The order is code-controlled here, not left to the model, so the
// card layout is consistent regardless of which order the model happened
// to fill in the tool call.
export function formatMealCard(input: MealCardInput) {
  return {
    title: input.titel,
    tag: input.tag,
    items: input.ingredienten.map((i) => ({ name: i.naam, detail: i.hoeveelheid })),
    macros: [
      { val: `${Math.round(input.kcal)}`, label: 'kcal' },
      { val: `${Math.round(input.eiwitten_g)}g`, label: 'eiwit' },
      { val: `${Math.round(input.koolhydraten_g)}g`, label: 'koolhydraten' },
      { val: `${Math.round(input.vet_g)}g`, label: 'vet' },
    ],
  }
}

// ── Meal components (nutrition_log.componenten) ──
//
// The database trigger nutrition_log_sync_componenten (see
// supabase/migrations/20261005_nutrition_product_and_componenten.sql) is
// what keeps a row's eiwitten_g/calorieen equal to the sum of its
// components — it rounds each component (0.1g / whole kcal) and overwrites
// the totals on every write. This code never writes totals for a row with
// components; it only builds the component list. Product components are
// computed HERE from nutrition_product, never taken from the model: a
// remembered value that the model then applies wrongly is exactly the 30-09
// failure (kipfilet fact existed, estimate still came out high).

interface Product {
  id: string
  naam: string
  gewicht_basis: 'nvt' | 'rauw' | 'bereid'
  eiwit_per_100g: number | null
  kcal_per_100g: number | null
  stuk_naam: string | null
  stuk_gewicht_g: number | null
  eiwit_per_stuk: number | null
  kcal_per_stuk: number | null
}

interface Component {
  naam: string
  hoeveelheid: string
  gram: number | null
  stuks: number | null
  basis: 'rauw' | 'bereid' | null
  eiwitten_g: number
  calorieen: number
  bron: 'product' | 'geschat' | 'gebruiker'
  product_id: string | null
}

const PRODUCT_COLUMNS = 'id, naam, gewicht_basis, eiwit_per_100g, kcal_per_100g, stuk_naam, stuk_gewicht_g, eiwit_per_stuk, kcal_per_stuk'
const LOG_COLUMNS = 'id, omschrijving, tijdstip, eiwitten_g, calorieen, componenten'

// Plural of a product's piece unit for the card's hoeveelheid text. Falls
// back to the singular word ("2 × reep" would read worse than "2 reep" is
// wrong) — a missing entry here only affects display, never a number.
const STUK_MEERVOUD: Record<string, string> = {
  plak: 'plakken',
  pak: 'pakjes',
  pakje: 'pakjes',
  stuk: 'stuks',
  ei: 'eieren',
  reep: 'repen',
  sneetje: 'sneetjes',
  bakje: 'bakjes',
  zakje: 'zakjes',
  blikje: 'blikjes',
  portie: 'porties',
  schep: 'scheppen',
  boterham: 'boterhammen',
}

function nl(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',')
}

function toNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v)
}

async function loadProduct(id: string): Promise<Product | null> {
  const { data } = await supabase.from('nutrition_product').select(PRODUCT_COLUMNS).eq('id', id).eq('actief', true).limit(1)
  const p = data?.[0]
  if (!p) return null
  return {
    ...p,
    eiwit_per_100g: num(p.eiwit_per_100g),
    kcal_per_100g: num(p.kcal_per_100g),
    stuk_gewicht_g: num(p.stuk_gewicht_g),
    eiwit_per_stuk: num(p.eiwit_per_stuk),
    kcal_per_stuk: num(p.kcal_per_stuk),
  } as Product
}

type Resolved = { ok: true; component: Component } | { ok: false; error: string }

const NIETS_OPGESLAGEN = ' Er is niets opgeslagen.'

// Turns one raw component from the model into a stored component. Errors
// are phrased for the model (it reads them as the tool result) and always
// say nothing was written.
async function resolveComponent(raw: Record<string, unknown>): Promise<Resolved> {
  const gram = toNumber(raw.gram)
  const stuks = toNumber(raw.stuks)
  const basisRaw = raw.basis === 'rauw' || raw.basis === 'bereid' ? raw.basis : null
  if ((gram !== null && gram <= 0) || (stuks !== null && stuks <= 0)) {
    return { ok: false, error: 'gram/stuks moet groter dan 0 zijn.' + NIETS_OPGESLAGEN }
  }

  if (typeof raw.product_id === 'string' && raw.product_id) {
    const p = await loadProduct(raw.product_id)
    if (!p) return { ok: false, error: `Onbekend of inactief product_id ${raw.product_id} — gebruik een id uit "Bekende producten", of log dit onderdeel als geschat.` + NIETS_OPGESLAGEN }
    if ((gram === null) === (stuks === null)) {
      return { ok: false, error: `Geef bij product "${p.naam}" precies één van gram of stuks.` + NIETS_OPGESLAGEN }
    }

    let basis: 'rauw' | 'bereid' | null = basisRaw
    if (gram !== null && p.gewicht_basis !== 'nvt') {
      if (!basis) {
        return {
          ok: false,
          error: `De waarden van "${p.naam}" gelden per 100g ${p.gewicht_basis}. Het is niet duidelijk of die ${nl(gram)}g rauw of bereid gewogen is: vraag dit één keer aan de gebruiker en geef dan basis mee.` + NIETS_OPGESLAGEN,
        }
      }
      if (basis !== p.gewicht_basis) {
        return {
          ok: false,
          error: `"${p.naam}" heeft waarden per 100g ${p.gewicht_basis}, maar dit gewicht is ${basis}. Gebruik een product met basis ${basis} uit "Bekende producten", of log dit onderdeel als geschat met basis ${basis}.` + NIETS_OPGESLAGEN,
        }
      }
    }
    if (gram === null && basis === null && p.gewicht_basis !== 'nvt') basis = p.gewicht_basis

    let eiwit: number
    let kcal: number
    let hoeveelheid: string
    if (gram !== null) {
      if (p.eiwit_per_100g !== null && p.kcal_per_100g !== null) {
        eiwit = (gram * p.eiwit_per_100g) / 100
        kcal = (gram * p.kcal_per_100g) / 100
      } else if (p.stuk_gewicht_g && p.eiwit_per_stuk !== null && p.kcal_per_stuk !== null) {
        eiwit = (gram / p.stuk_gewicht_g) * p.eiwit_per_stuk
        kcal = (gram / p.stuk_gewicht_g) * p.kcal_per_stuk
      } else {
        return { ok: false, error: `"${p.naam}" heeft alleen waarden per ${p.stuk_naam ?? 'stuk'} zonder gewicht — geef stuks in plaats van gram.` + NIETS_OPGESLAGEN }
      }
      hoeveelheid = `${nl(gram)}g${basis ? ` ${basis}` : ''}`
    } else {
      const n = stuks as number
      const eenheid = n === 1 ? (p.stuk_naam ?? 'stuk') : (STUK_MEERVOUD[p.stuk_naam ?? 'stuk'] ?? p.stuk_naam ?? 'stuks')
      if (p.eiwit_per_stuk !== null && p.kcal_per_stuk !== null) {
        eiwit = n * p.eiwit_per_stuk
        kcal = n * p.kcal_per_stuk
        hoeveelheid = `${nl(n)} ${eenheid}`
      } else if (p.stuk_gewicht_g && p.eiwit_per_100g !== null && p.kcal_per_100g !== null) {
        const g = n * p.stuk_gewicht_g
        eiwit = (g * p.eiwit_per_100g) / 100
        kcal = (g * p.kcal_per_100g) / 100
        hoeveelheid = `${nl(n)} ${eenheid} (${nl(g)}g)`
      } else {
        return { ok: false, error: `"${p.naam}" heeft geen waarde per stuk — geef gram in plaats van stuks.` + NIETS_OPGESLAGEN }
      }
    }

    return {
      ok: true,
      component: { naam: p.naam, hoeveelheid, gram, stuks, basis, eiwitten_g: eiwit, calorieen: kcal, bron: 'product', product_id: p.id },
    }
  }

  const naam = typeof raw.naam === 'string' ? raw.naam.trim() : ''
  const eiwit = toNumber(raw.eiwitten_g)
  const kcal = toNumber(raw.calorieen)
  if (!naam) return { ok: false, error: 'Een onderdeel zonder product_id heeft een naam nodig.' + NIETS_OPGESLAGEN }
  if (eiwit === null || kcal === null || eiwit < 0 || kcal < 0) {
    return { ok: false, error: `Onderdeel "${naam}" heeft geen product_id, dus eiwitten_g en calorieen (≥ 0) zijn verplicht.` + NIETS_OPGESLAGEN }
  }
  const bron = raw.bron === 'gebruiker' ? 'gebruiker' : 'geschat'
  const hoeveelheid = typeof raw.hoeveelheid === 'string' && raw.hoeveelheid.trim() ? raw.hoeveelheid.trim() : gram !== null ? `${nl(gram)}g${basisRaw ? ` ${basisRaw}` : ''}` : ''
  return {
    ok: true,
    component: { naam, hoeveelheid, gram, stuks, basis: basisRaw, eiwitten_g: eiwit, calorieen: kcal, bron, product_id: null },
  }
}

interface LogRow {
  id: string
  omschrijving: string
  tijdstip: string | null
  eiwitten_g: number | string | null
  calorieen: number | string | null
  componenten: Component[] | null
}

// The log card, built ONLY from the row as the database returned it after
// the write (post-trigger) — never from the model's input or prose. Passed
// to index.ts under the "_kaart" key, which runToolLoop strips before the
// result goes back to the model.
function buildKaart(row: LogRow, actie: 'gelogd' | 'aangepast') {
  return {
    logId: row.id,
    titel: row.omschrijving,
    tijdstip: row.tijdstip ? row.tijdstip.slice(0, 5) : null,
    rows: (row.componenten ?? []).map((c) => ({
      naam: c.naam,
      hoeveelheid: c.hoeveelheid ?? '',
      eiwit: Number(c.eiwitten_g),
      kcal: Number(c.calorieen),
      bron: c.bron,
    })),
    totaal: { eiwit: Number(row.eiwitten_g) || 0, kcal: Number(row.calorieen) || 0 },
    actie,
  }
}

// What the model gets back about a written row: the stored numbers, and
// the component list WITH indices — a same-turn correction must use these
// indices, not the (pre-turn) context list.
function rowForModel(row: LogRow) {
  return {
    eiwitten_g: Number(row.eiwitten_g) || 0,
    componenten: (row.componenten ?? []).map((c, index) => ({
      index,
      naam: c.naam,
      hoeveelheid: c.hoeveelheid,
      eiwitten_g: c.eiwitten_g,
      calorieen: c.calorieen,
      bron: c.bron,
    })),
  }
}

// Recomputed fresh after every nutrition_log write, same reduce shape
// buildDynamicContext already uses — not extracted into a shared module for
// one call site's worth of reuse per file, consistent with this project's
// existing runtime-duplication precedent (currentCalWeek,
// aandachtspuntHasQuestion). Returning this from add/update/delete means
// the coach's running-total confirmation comes from a real post-write SUM
// instead of the pre-turn context snapshot, and a write that silently
// didn't land shows up as an unchanged total instead of being invisible.
async function computeDayTotals(todayStr: string): Promise<{ eiwitTotaal: number; calorieTotaal: number }> {
  const { data } = await supabase.from('nutrition_log').select('eiwitten_g, calorieen').eq('datum', todayStr)
  const rows = data ?? []
  return {
    // Rounded to 0.1g / whole kcal: components carry decimals, and a raw
    // float sum ("14.299999999999999") would reach both the model and the
    // header. prompt.ts rounds its starting totals identically, so index.ts's
    // no-op comparison still compares like with like.
    eiwitTotaal: Math.round(rows.reduce((sum, r) => sum + (Number(r.eiwitten_g) || 0), 0) * 10) / 10,
    calorieTotaal: Math.round(rows.reduce((sum, r) => sum + (Number(r.calorieen) || 0), 0)),
  }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  todayStr: string,
  conversationMessages: ConversationMessage[],
): Promise<unknown> {
  switch (name) {
    case 'nutrition_log_add': {
      const rawComponents = Array.isArray(input.componenten) ? (input.componenten as Record<string, unknown>[]) : []
      if (rawComponents.length === 0) {
        return { error: 'componenten is verplicht: minstens één onderdeel.' + NIETS_OPGESLAGEN }
      }
      const componenten: Component[] = []
      for (const raw of rawComponents) {
        const resolved = await resolveComponent(raw ?? {})
        if (!resolved.ok) return { error: resolved.error }
        componenten.push(resolved.component)
      }
      // eiwitten_g/calorieen deliberately not written — the trigger sets
      // them from componenten; anything the model sent at the top level is
      // ignored.
      const { data, error } = await supabase
        .from('nutrition_log')
        .insert({ datum: todayStr, tijdstip: input.tijdstip, omschrijving: input.omschrijving, componenten })
        .select(LOG_COLUMNS)
        .single()
      if (error) return { error: error.message }
      const row = data as LogRow
      const totals = await computeDayTotals(todayStr)
      return { id: row.id, status: 'logged', ...rowForModel(row), ...totals, _kaart: buildKaart(row, 'gelogd') }
    }
    case 'nutrition_log_update': {
      const { data: existingRows, error: readError } = await supabase.from('nutrition_log').select(LOG_COLUMNS).eq('id', input.id).limit(1)
      if (readError) return { error: readError.message }
      const existing = existingRows?.[0] as LogRow | undefined
      if (!existing) return { error: `Geen maaltijd gevonden met id ${input.id}.` }

      const patch: Record<string, unknown> = {}
      if (input.omschrijving !== undefined) patch.omschrijving = input.omschrijving
      if (input.tijdstip !== undefined) patch.tijdstip = input.tijdstip

      const wijziging = input.component_wijziging as Record<string, unknown> | undefined
      const toevoegen = input.component_toevoegen as Record<string, unknown> | undefined
      const verwijderen = input.component_verwijderen
      const opCount = [wijziging, toevoegen, verwijderen].filter((op) => op !== undefined && op !== null).length
      if (opCount > 1) return { error: 'Eén onderdeel-bewerking per aanroep (component_wijziging, component_toevoegen óf component_verwijderen).' + NIETS_OPGESLAGEN }

      if (existing.componenten === null) {
        // Legacy row (logged before componenten existed) — the old
        // whole-row correction still applies, and only here.
        if (opCount > 0) {
          return { error: 'Deze maaltijd is gelogd voordat maaltijden in onderdelen werden opgeslagen. Corrigeer hier eiwitten_g/calorieen direct.' + NIETS_OPGESLAGEN }
        }
        if (input.eiwitten_g !== undefined) patch.eiwitten_g = input.eiwitten_g
        if (input.calorieen !== undefined) patch.calorieen = input.calorieen
      } else {
        if (input.eiwitten_g !== undefined || input.calorieen !== undefined) {
          return {
            error: 'Deze maaltijd heeft onderdelen; de totalen volgen uit de onderdelen. Corrigeer het betreffende onderdeel met component_wijziging (index uit het laatste tool-resultaat of de contextlijst), of voeg een onderdeel toe/verwijder er een.' + NIETS_OPGESLAGEN,
          }
        }
        const componenten = [...existing.componenten]
        const checkIndex = (v: unknown): number | string => {
          const i = Number(v)
          if (!Number.isInteger(i) || i < 0 || i >= componenten.length) {
            return `Ongeldige index ${String(v)} — deze maaltijd heeft onderdelen 0 t/m ${componenten.length - 1}.` + NIETS_OPGESLAGEN
          }
          return i
        }

        if (wijziging) {
          const i = checkIndex(wijziging.index)
          if (typeof i === 'string') return { error: i }
          const current = componenten[i]
          const valuesGiven = wijziging.eiwitten_g !== undefined || wijziging.calorieen !== undefined
          const productPath =
            !valuesGiven &&
            (typeof wijziging.product_id === 'string' ||
              (current.bron === 'product' &&
                (wijziging.gram !== undefined || wijziging.stuks !== undefined || wijziging.basis !== undefined || wijziging.herbereken === true)))
          let raw: Record<string, unknown>
          if (productPath) {
            // A changed amount replaces the other unit (gram ↔ stuks);
            // otherwise the stored amount is kept and recomputed against
            // the current product values.
            const newAmount = wijziging.gram !== undefined || wijziging.stuks !== undefined
            raw = {
              product_id: wijziging.product_id ?? current.product_id,
              gram: newAmount ? wijziging.gram : current.gram,
              stuks: newAmount ? wijziging.stuks : current.stuks,
              basis: wijziging.basis ?? current.basis,
            }
          } else {
            // Values set directly. A product component whose numbers the
            // user overrides is no longer computed from the product — it
            // becomes the user's value, unless the model says otherwise.
            raw = {
              naam: wijziging.naam ?? current.naam,
              hoeveelheid: wijziging.hoeveelheid ?? current.hoeveelheid,
              gram: wijziging.gram ?? current.gram,
              stuks: wijziging.stuks ?? current.stuks,
              basis: wijziging.basis ?? current.basis,
              eiwitten_g: wijziging.eiwitten_g ?? current.eiwitten_g,
              calorieen: wijziging.calorieen ?? current.calorieen,
              bron: wijziging.bron ?? (current.bron === 'product' ? 'gebruiker' : current.bron),
            }
          }
          const resolved = await resolveComponent(raw)
          if (!resolved.ok) return { error: resolved.error }
          componenten[i] = resolved.component
        } else if (toevoegen) {
          const resolved = await resolveComponent(toevoegen)
          if (!resolved.ok) return { error: resolved.error }
          componenten.push(resolved.component)
        } else if (verwijderen !== undefined && verwijderen !== null) {
          const i = checkIndex(verwijderen)
          if (typeof i === 'string') return { error: i }
          if (componenten.length === 1) {
            return { error: 'Dit is het enige onderdeel — verwijder dan de hele maaltijd met nutrition_log_delete.' + NIETS_OPGESLAGEN }
          }
          componenten.splice(i, 1)
        }
        if (opCount > 0) patch.componenten = componenten
      }

      if (Object.keys(patch).length === 0) return { error: 'Niets om aan te passen.' + NIETS_OPGESLAGEN }
      const { data, error } = await supabase.from('nutrition_log').update(patch).eq('id', input.id).select(LOG_COLUMNS).single()
      if (error) return { error: error.message }
      const row = data as LogRow
      const totals = await computeDayTotals(todayStr)
      return { status: 'updated', ...rowForModel(row), ...totals, _kaart: buildKaart(row, 'aangepast') }
    }
    case 'nutrition_log_delete': {
      const { error } = await supabase.from('nutrition_log').delete().eq('id', input.id)
      if (error) return { error: error.message }
      const totals = await computeDayTotals(todayStr)
      return { status: 'deleted', ...totals, _deletedLogId: input.id }
    }
    case 'product_opslaan': {
      const fields: Record<string, unknown> = {}
      for (const key of ['naam', 'zoektermen', 'gewicht_basis', 'eiwit_per_100g', 'kcal_per_100g', 'stuk_naam', 'stuk_gewicht_g', 'eiwit_per_stuk', 'kcal_per_stuk', 'bron', 'notitie']) {
        if (input[key] !== undefined) fields[key] = input[key]
      }
      // The pair rule is also a database CHECK — repeated here only so the
      // model gets a readable reason instead of a constraint name.
      if ((fields.eiwit_per_100g === undefined) !== (fields.kcal_per_100g === undefined) && !input.id) {
        return { error: 'Geef eiwit_per_100g en kcal_per_100g altijd samen.' + NIETS_OPGESLAGEN }
      }
      if ((fields.eiwit_per_stuk === undefined) !== (fields.kcal_per_stuk === undefined) && !input.id) {
        return { error: 'Geef eiwit_per_stuk en kcal_per_stuk altijd samen.' + NIETS_OPGESLAGEN }
      }
      const query = input.id
        ? supabase.from('nutrition_product').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', input.id)
        : supabase.from('nutrition_product').insert(fields)
      const { data, error } = await query.select(`${PRODUCT_COLUMNS}, bron`).single()
      if (error) {
        const hint = error.code === '23505' ? ' Dit product bestaat al — corrigeer het met zijn id uit "Bekende producten".' : ''
        return { error: `${error.message}.${hint}` + NIETS_OPGESLAGEN }
      }
      return { status: input.id ? 'product_updated' : 'product_stored', product: data }
    }
    case 'weight_log_add': {
      const { data, error } = await supabase
        .from('weight_log')
        .insert({ datum: todayStr, gewicht: input.gewicht })
        .select('id')
        .single()
      if (error) return { error: error.message }
      return { id: data.id, status: 'logged' }
    }
    case 'weight_log_update': {
      const { error } = await supabase.from('weight_log').update({ gewicht: input.gewicht }).eq('id', input.id)
      if (error) return { error: error.message }
      return { status: 'updated' }
    }
    case 'memory_add': {
      const { data, error } = await supabase
        .from('coach_memory')
        .insert({ feit: input.feit, categorie: input.categorie })
        .select('id')
        .single()
      if (error) return { error: error.message }
      return { id: data.id, status: 'stored' }
    }
    case 'memory_update': {
      const { error } = await supabase
        .from('coach_memory')
        .update({ feit: input.feit, updated_at: new Date().toISOString() })
        .eq('id', input.id)
      if (error) return { error: error.message }
      return { status: 'updated' }
    }
    case 'memory_deactivate': {
      const { error } = await supabase
        .from('coach_memory')
        .update({ actief: false, updated_at: new Date().toISOString() })
        .eq('id', input.id)
      if (error) return { error: error.message }
      return { status: 'deactivated' }
    }
    case 'close_day_summary': {
      const transcript = buildTranscript(conversationMessages)
      const result = await closeDayWithSummary(todayStr, transcript || null)
      if (!result.ok) {
        return { error: result.error ?? 'Kon de dag niet afsluiten.' }
      }
      // Distinguishes "just closed" from "already existed" so the model
      // can respond honestly instead of always claiming a fresh close —
      // see PERSONA_PROMPT's "Dag afsluiten" section.
      return { status: result.alreadyClosed ? 'already_closed' : 'closed' }
    }
    case 'render_meal_card': {
      // No DB side effect — this tool is purely a structured-output vehicle.
      // The actual card content is picked up by index.ts directly from the
      // tool_use block (see formatMealCard above), not from this return
      // value, which only becomes the tool_result fed back to the model.
      //
      // The plain { status: 'rendered' } this used to return was too terse
      // — reproduced a bug where a meal-card revision occasionally had the
      // model re-invoke this tool one or more extra times (not always, only
      // sometimes — sampling variance) instead of moving on to its closing
      // text, eating into MAX_TOOL_ITERATIONS. An explicit instruction here
      // is cheap insurance against that ambiguity.
      return { status: 'rendered', instructie: 'De kaart is nu getoond aan de gebruiker. Schrijf nu je korte afsluitende reactie in platte tekst — roep dit tool niet nogmaals aan voor dezelfde suggestie.' }
    }
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
