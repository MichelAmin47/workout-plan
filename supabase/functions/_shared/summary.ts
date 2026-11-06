// Shared end-of-day summary generation, used by both triggers:
// - coach-chat's close_day_summary tool (rich: conversation + logged data)
// - close-day-cron (thin: logged data only, no conversation access)

import { supabase } from './supabaseClient.ts'
import { isoWeekOf, resolveTodayWorkout, sortMealsByActiveDayOrder } from './today.ts'
import { callClaude, type ClaudeMessage } from './anthropic.ts'
import {
  bepaalOnderwerp,
  capVenster,
  gecaptFeitRegel,
  gecapteOnderwerpen,
  onderwerpenBeschrijving,
  plusDagen,
  toegestaneOnderwerpen,
  type VraagOnderwerp,
} from './vraagOnderwerp.ts'

// Model + budget for both closing routes (chat and cron). claude-opus-5-5
// (§30 phase 2): forced tool_choice returns a 400 on this model, so the call
// uses tool_choice auto with a strict schema and handles "no tool call"
// itself (one retry, then fail loudly — never an empty row). Thinking is
// adaptive and can't be disabled on this model; effort 'low' keeps it short.
// Thinking counts toward max_tokens: the summary itself is ~300-450 tokens,
// and 4096 leaves the same headroom ratio coach-chat runs with (which went
// from C3 failures at 1024 to none at 4096 with ~500-600 normal output).
const SUMMARY_MODEL = 'claude-opus-5-5'
const SUMMARY_MAX_TOKENS = 4096

// Built per call: vraag_onderwerp's enum leaves out every topic that hit the
// cap for tomorrow's card (see _shared/vraagOnderwerp.ts), so the model
// cannot pick one. strict + additionalProperties:false guarantee a
// schema-valid input when the tool IS called (the 5.5 replacement for the
// guarantee forced tool use used to give).
function buildRecordSummaryTool(toegestaan: VraagOnderwerp[]) {
  return {
    name: 'record_summary',
    description: 'Record the end-of-day summary for Mies (the user).',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        samenvatting: {
          type: 'string',
          description:
            'Short reflective summary of the day, in Dutch, 1-2 sentences. Verwijs naar hem als "Mies" of "hij/hem/zijn" — nooit "de gebruiker", nooit "zij/haar". Reken stappen nooit om naar calorieën of verbrande energie.',
        },
        aandachtspunt: {
          type: 'string',
          description:
            'What to carry into tomorrow, in Dutch. Verwijs naar hem als "Mies" of "hij/hem/zijn" — nooit "de gebruiker", nooit "zij/haar". Reken stappen nooit om naar calorieën of verbrande energie, en noem geen stappendoel.',
        },
        vraag_voor_morgen: {
        type: 'string',
        description:
          'Optioneel: één concrete vraag die de ochtend check-in kaart morgen aan hem kan stellen, gebaseerd op iets uit het gesprek van vandaag (indien beschikbaar) of anders op de gelogde maaltijden/training van vandaag. Precies één vraag over precies één onderwerp — nooit twee dingen in één vraag samengevoegd met "en" (bv. nooit "heb je goed geslapen EN hoe voelen je schouders aan", kies er dan één). Vooruitkijkend geformuleerd ("zou je morgen kunnen...", "ga je nog...") — nooit verwijtend ("je hebt gisteren maar..."). Noem hierin NOOIT gewicht, een gewichtstrend of onderhoudsniveau, en NOOIT calorieën — ook niet via stappen (reken stappen nooit om naar calorieën, geen stappendoel). Spreek hem rechtstreeks aan met "je" (deze vraag komt letterlijk op zijn kaart — dus hier NIET "Mies"). Vul bij een vraag ook vraag_onderwerp in. Laat dit veld gewoon weg (of leeg) als de dag echt niets opleverde om morgen naar te vragen — verzin dan niets.',
        },
        vraag_onderwerp: {
          type: 'string',
          enum: toegestaan,
          description: `Alleen samen met vraag_voor_morgen: het onderwerp van die vraag. Kies het onderwerp waar de vraag echt over gaat — een vraag over ontbijt of eiwit eerder op de dag is altijd "eiwit_timing", ook als hij over een maaltijd lijkt te gaan. Beschikbaar: ${onderwerpenBeschrijving(toegestaan)}. Ontbreekt een onderwerp hier, dan is het morgen niet beschikbaar (zie de feiten in de systeemprompt).`,
        },
      },
      required: ['samenvatting', 'aandachtspunt'],
    },
  }
}

function dateFromIsoString(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Full Dutch weekday names, indexed by getDay()||7 - 1 (Ma=0..Zo=6). No
// existing export to reuse: _shared/today.ts's WEEKDAY_LABELS is
// abbreviated ("Ma"/"Di") and module-private, needed here in full-word
// form so the day-anchor instruction below reads as natural prose.
const WEEKDAG_NAMEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']

function weekdagNaam(d: Date): string {
  return WEEKDAG_NAMEN[(d.getDay() || 7) - 1]
}

async function resolveWorkoutForDate(datum: string): Promise<string> {
  const d = dateFromIsoString(datum)
  const weekday = d.getDay() || 7
  return resolveTodayWorkout(isoWeekOf(d), weekday)
}

// Real bug (2026-08-22): an aandachtspunt referencing a training session
// from two days earlier ("de boksles") got carried into morning-checkin's
// prompt with no day attached, which then invented "gisteren" for it — the
// event was actually Thursday, not literally the day before. Without an
// absolute anchor (a weekday name or date), "name the day" is
// unenforceable — the model closing this day has no other way to know
// what weekday it even is, only relative "vandaag"/"trainingsdag" framing.
// This single line is that anchor, shared by both prompt variants below.
function dagAnchorLine(datum: string): string {
  return `Dit is de samenvatting voor ${weekdagNaam(dateFromIsoString(datum))} ${datum}.`
}

// Shared by both prompt variants — the anchoring instruction itself, right
// next to where aandachtspunt is generated (point-of-use, same pattern as
// every other rule in this codebase). A relative day word ("gisteren")
// written into the note is only ever read correctly on the one day it was
// written; carried into a later day's context (which is the whole point of
// aandachtspunt) it silently means the wrong day. Naming the actual weekday
// survives that carry-over; "gisteren" doesn't.
const AANDACHTSPUNT_ANKER_REGEL =
  '- Verwijst het aandachtspunt naar een gebeurtenis op een specifieke dag (een training, maaltijd, klacht) → noem die dag erbij (bv. "de boksles van donderdag"), nooit de gebeurtenis kaal. Gebruik zelf GEEN relatief dagwoord als "gisteren" of "vandaag" in het aandachtspunt — dit wordt op een latere dag door een ander proces gelezen, waar zo\'n woord een andere dag zou betekenen.'

// The day-close model writes samenvatting/aandachtspunt in the third
// person and otherwise has to guess the user's gender (02-10: "die aanpak
// werkt goed voor haar", corrected by hand — the user is a man). Since
// 2026-11-06 he is named "Mies" in stored text instead of "de gebruiker"
// (every summary used to say "de gebruiker"). Shared by both prompt
// variants; same rule sits in the two field descriptions above.
// vraag_voor_morgen stays in "je": it ends up as direct address on his card.
const GEBRUIKER_VERWIJZING_REGEL =
  '- Verwijs in samenvatting en aandachtspunt naar hem als "Mies" of "hij/hem/zijn" — nooit "de gebruiker", nooit "zij/haar". vraag_voor_morgen spreekt hem juist rechtstreeks aan met "je".'

// Opening line of both prompts: the user's name, so the model has no
// "de gebruiker" in its own instructions to copy into stored text.
const NAAM_REGEL = 'De gebruiker van de app heet Mies (hij/hem/zijn).'

// Tool use is not forced on this model (tool_choice auto) — say it plainly.
const TOOL_REGEL = '- Leg het resultaat ALTIJD vast met één aanroep van het record_summary tool — schrijf geen losse tekst.'

// coach-chat's PERSONA_PROMPT holds the same rule; this model does not
// inherit that prompt, so it has to be stated here too (prompt rule
// propagation — see the "never mention weight" bug).
const STAPPEN_REGEL =
  '- Reken stappen of wandelen NOOIT om naar calorieën of "verbrande energie", in geen enkel veld — ook niet als het in het gesprek ter sprake kwam. Noem ook geen stappendoel.'

function buildRichSystemPrompt(datum: string, workoutSummary: string, mealsText: string, gecaptRegel: string): string {
  return `Je bent een samenvattingsmodel voor de voedingscoach-app "Coach". Je taak: comprimeer één dag naar twee korte velden voor coach_sessions — samenvatting en aandachtspunt. Dit vervangt het bewaren van de losse chatberichten; wat je hier niet vastlegt is morgen weg.

${NAAM_REGEL}

${dagAnchorLine(datum)}

Je krijgt hieronder het volledige gesprek van vandaag, plus de daadwerkelijk gelogde maaltijden en trainingsdata.

Regels:
- samenvatting: 1-2 zinnen, reflectief — wat ging er goed, hoe verliep de dag.
- aandachtspunt: wat de coach morgen moet onthouden — concreet, geen open zin.
${AANDACHTSPUNT_ANKER_REGEL}
${GEBRUIKER_VERWIJZING_REGEL}
${STAPPEN_REGEL}
- Zodra Mies in het gesprek heeft aangegeven vol of klaar te zijn voor die dag: sluit af op wat goed ging. Noem GEEN manieren om het eiwitdoel alsnog te halen en geen "je had nog wat kunnen eten" — dat is precies het gedrag dat de coach zelf ook al vermijdt.
- De caloriewaarden hieronder staan erbij voor nauwkeurigheid, niet om standaard te noemen. Focus zoals gebruikelijk op eiwitten en hoe de dag verliep — noem calorieën alleen als dat al onderdeel was van het gesprek zelf.
- Noem NOOIT gewicht, een gewichtstrend of onderhoudsniveau in samenvatting of aandachtspunt — ook niet als dit in het gesprek zelf ter sprake kwam (bv. een weegmoment). Dit wordt bewust nergens teruggegeven, ook niet hier.
${gecaptRegel ? `${gecaptRegel}\n` : ''}${TOOL_REGEL}

Trainingscontext van vandaag: ${workoutSummary}
Gelogde maaltijden vandaag:
${mealsText}`
}

function buildThinSystemPrompt(datum: string, workoutSummary: string, mealsText: string, gecaptRegel: string): string {
  return `Je bent een samenvattingsmodel voor de voedingscoach-app "Coach". Je taak: schrijf een korte dagsamenvatting voor coach_sessions voor een dag waarin GEEN gesprek beschikbaar is — dit is het automatische vangnet, Mies heeft die dag niet zelf "sluit de dag af" gezegd.

${NAAM_REGEL}

${dagAnchorLine(datum)}

BELANGRIJK: je hebt het gesprek van die dag niet gezien. Verzin GEEN stemming, gevoel of iets dat alleen uit een gesprek af te leiden zou zijn. Blijf feitelijk: alleen wat er gegeten en getraind is.

Regels:
- samenvatting: 1-2 zinnen, feitelijk — gelogde maaltijden/eiwitten en trainingsdata van die dag.
- aandachtspunt: een feitelijke observatie op basis van de cijfers (bv. eiwitdoel wel/niet gehaald), geen gok over intentie of stemming.
${AANDACHTSPUNT_ANKER_REGEL}
${GEBRUIKER_VERWIJZING_REGEL}
${STAPPEN_REGEL}
- De caloriewaarden hieronder staan erbij voor nauwkeurigheid, niet om standaard te noemen — focus zoals gebruikelijk op eiwitten, niet op calorieën.
${gecaptRegel ? `${gecaptRegel}\n` : ''}${TOOL_REGEL}

Trainingscontext van die dag: ${workoutSummary}
Gelogde maaltijden die dag:
${mealsText}`
}

export async function closeDayWithSummary(
  datum: string,
  conversationTranscript: string | null,
): Promise<{ ok: boolean; alreadyClosed?: boolean; error?: string }> {
  const { data: existing } = await supabase.from('coach_sessions').select('id').eq('datum', datum).limit(1)
  if (existing && existing.length > 0) {
    // Already closed (manual + cron race, or a retry) — nothing to do, but
    // say so honestly so the caller doesn't imply this action is what just
    // closed it (see coach-chat/tools.ts + PERSONA_PROMPT's "Dag afsluiten").
    return { ok: true, alreadyClosed: true }
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not set' }
  }

  // This close writes the question for tomorrow's card (X = datum + 1), so
  // the cap is computed for X — capVenster(X) is X-6 .. X-1 = datum-5 ..
  // datum, the same single window definition morning-checkin uses.
  const kaartDatumMorgen = plusDagen(datum, 1)
  const venster = capVenster(kaartDatumMorgen)

  const [mealsRes, workoutSummary, cardsRes] = await Promise.all([
    supabase.from('nutrition_log').select('tijdstip, omschrijving, eiwitten_g, calorieen').eq('datum', datum).order('tijdstip', { ascending: true }),
    resolveWorkoutForDate(datum),
    supabase.from('coach_checkin_card').select('datum, vraag_onderwerp').gte('datum', venster.van).lte('datum', venster.totEnMet),
  ])

  if (cardsRes.error) {
    // Without the window the cap can't be enforced — fail closed for the
    // question only (the summary itself is still written, with no question
    // for tomorrow), never fail open.
    console.error('[summary] coach_checkin_card window query failed — vraag_voor_morgen wordt overgeslagen', cardsRes.error.message)
  }
  const gecapt = cardsRes.error ? null : gecapteOnderwerpen(cardsRes.data ?? [], kaartDatumMorgen)
  const toegestaan = toegestaneOnderwerpen(gecapt ?? [])
  console.log('[summary] vraag_onderwerp', JSON.stringify({ datum, kaartDatumMorgen, venster, gecapt, enum: toegestaan }))

  const meals = sortMealsByActiveDayOrder(mealsRes.data ?? [])
  const mealsText =
    meals.length > 0
      ? meals.map((m) => `- ${m.tijdstip ?? '?'} ${m.omschrijving}: ${m.eiwitten_g}g eiwit, ${m.calorieen}kcal`).join('\n')
      : 'Geen maaltijden gelogd.'

  // Plain SUM over the actual rows — never estimated by Opus, same
  // reasoning as block 3b's fix for today's own total: a re-estimate drifts
  // between asks, a stored sum doesn't. Rounded to 0.1g / whole kcal (the
  // precision nutrition_log's component trigger stores): meal components
  // carry decimals, and a raw float sum (3.1 + 5.6 + 2.1 =
  // 10.799999999999999) would otherwise land in coach_sessions and no
  // longer equal SUM(nutrition_log).
  const eiwitTotaal = Math.round(meals.reduce((sum, m) => sum + (Number(m.eiwitten_g) || 0), 0) * 10) / 10
  const calorieTotaal = Math.round(meals.reduce((sum, m) => sum + (Number(m.calorieen) || 0), 0))

  const gecaptRegel = gecaptFeitRegel(gecapt ?? [], 'morgen')
  const systemPrompt = conversationTranscript
    ? buildRichSystemPrompt(datum, workoutSummary, mealsText, gecaptRegel)
    : buildThinSystemPrompt(datum, workoutSummary, mealsText, gecaptRegel)

  const userMessage = conversationTranscript
    ? `Gesprek van vandaag:\n\n${conversationTranscript}`
    : 'Genereer de samenvatting voor deze dag op basis van de context hierboven.'

  const tool = buildRecordSummaryTool(toegestaan)
  const messages: ClaudeMessage[] = [{ role: 'user', content: userMessage }]

  // tool_choice auto: the model may answer without calling the tool. One
  // retry with a plain nudge (appending its own turn unchanged — thinking
  // blocks included — so the history stays append-only), then fail loudly.
  // An empty or partial summary is never written.
  type SummaryInput = { samenvatting?: string; aandachtspunt?: string; vraag_voor_morgen?: string; vraag_onderwerp?: string }
  let input: SummaryInput | null = null
  const pogingen: { stop_reason: string | null; out_tokens: number | null; probleem: string | null }[] = []
  for (let poging = 1; poging <= 2 && !input; poging++) {
    const result = await callClaude(apiKey, {
      model: SUMMARY_MODEL,
      system: systemPrompt,
      messages,
      tools: [tool],
      toolChoice: { type: 'auto' },
      effort: 'low',
      maxTokens: SUMMARY_MAX_TOKENS,
    })
    if (!result.ok) {
      console.error('closeDayWithSummary: Claude call failed', result.status, result.errorText)
      return { ok: false, error: 'Claude API call failed' }
    }
    const data = result.data!
    const toolUse = data.content.find((b) => b.type === 'tool_use' && b.name === 'record_summary')
    const kandidaat = (toolUse?.input ?? null) as SummaryInput | null
    const probleem = !toolUse
      ? 'geen record_summary-aanroep'
      : !kandidaat?.samenvatting?.trim() || !kandidaat?.aandachtspunt?.trim()
        ? 'samenvatting of aandachtspunt leeg'
        : null
    pogingen.push({ stop_reason: data.stop_reason ?? null, out_tokens: data.usage?.output_tokens ?? null, probleem })
    console.log('[summary] poging', poging, JSON.stringify({ datum, stop_reason: data.stop_reason, usage: data.usage, probleem }))
    if (!probleem) {
      input = kandidaat
      break
    }
    // Nothing to retry on: a refusal, or a turn with no content to append.
    if (data.stop_reason === 'refusal' || !data.content?.length) break
    messages.push({ role: 'assistant', content: data.content })
    messages.push({
      role: 'user',
      content: toolUse
        ? [{ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Ongeldig: ${probleem}. Roep record_summary opnieuw aan met een ingevulde samenvatting en aandachtspunt.` }]
        : 'Je hebt het record_summary tool niet aangeroepen. Leg de samenvatting nu vast met één aanroep van record_summary.',
    })
  }

  if (!input) {
    console.error('[summary] GEEN SAMENVATTING — niets opgeslagen', JSON.stringify({ datum, route: conversationTranscript ? 'chat' : 'cron', pogingen }))
    return { ok: false, error: 'No summary produced' }
  }

  // Topic cap, enforced after the call as well: the enum already excludes
  // capped topics, but the label is the model's own — a protein-timing
  // question labelled as something else is relabelled by the keyword check
  // (bepaalOnderwerp), and a question that then lands on a capped topic, has
  // no topic, or arrives while the window couldn't be read is dropped (the
  // summary itself is kept). Tomorrow's card then falls back to its own
  // maaltijden source.
  let vraagVoorMorgen = input.vraag_voor_morgen?.trim() || null
  let vraagOnderwerp: VraagOnderwerp | null = null
  if (vraagVoorMorgen) {
    const { onderwerp, herlabeld } = bepaalOnderwerp(input.vraag_onderwerp, vraagVoorMorgen)
    const reden = gecapt === null
      ? 'venster onleesbaar'
      : !onderwerp
        ? 'geen onderwerp'
        : gecapt.includes(onderwerp)
          ? `onderwerp ${onderwerp} gecapt`
          : null
    if (reden) {
      console.warn('[summary] vraag geblokkeerd', JSON.stringify({ datum, reden, label: input.vraag_onderwerp ?? null, herlabeld, vraag: vraagVoorMorgen }))
      vraagVoorMorgen = null
    } else {
      vraagOnderwerp = onderwerp
      if (herlabeld) console.warn('[summary] vraag_onderwerp herlabeld', JSON.stringify({ datum, label: input.vraag_onderwerp ?? null, onderwerp }))
    }
  }

  const { error: insertError } = await supabase.from('coach_sessions').insert({
    datum,
    samenvatting: input.samenvatting!.trim(),
    aandachtspunt: input.aandachtspunt!.trim(),
    eiwit_totaal: eiwitTotaal,
    calorieen_totaal: calorieTotaal,
    vraag_voor_morgen: vraagVoorMorgen,
    vraag_onderwerp: vraagOnderwerp,
  })
  if (insertError) {
    return { ok: false, error: insertError.message }
  }

  return { ok: true, alreadyClosed: false }
}
