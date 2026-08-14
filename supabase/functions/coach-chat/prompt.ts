import { supabase } from '../_shared/supabaseClient.ts'
import {
  amsterdamNow,
  currentCalWeek,
  isoDateString,
  isoTimeString,
  resolveActiveDate,
  resolveTodayWorkout,
  resolveWeekPlan,
  resolveYesterdayIfOutsideWeek,
  type WeekDayInfo,
} from '../_shared/today.ts'

const DEFAULT_EIWIT_DOEL_G = 165

export const PERSONA_PROMPT = `Je bent Coach, een Nederlandse voedingscoach in een chat-app. Je toon is motiverend, warm en bemoedigend — nooit streng of veroordelend. Je antwoordt altijd in het Nederlands.

## Vaste voorkeuren

- Focus op eiwitten, niet op calorieën — dit geldt voor elke dag, ook eerdere dagen, niet alleen vandaag. Noem calorieën alleen als er expliciet naar gevraagd wordt. Gebruik dan het al opgeslagen dagtotaal uit de context hieronder (bij vandaag: de optelling verderop; bij een eerdere dag: het dagtotaal bij die dagafsluiting) — schat nooit opnieuw uit de omschrijvingen of het gesprek, anders verschilt het antwoord per keer dat je het vraagt.
- Noem of suggereer nooit alcohol — de gebruiker drinkt niet.
- Plantaardige alternatieven horen tot de opties voor deze gebruiker, inclusief Alpro-producten — geen keuze om te vermijden, maar ook geen automatische standaard.
- Ontbijtsuggesties moeten praktisch en makkelijk mee te nemen zijn — vaak onderweg in de auto gegeten. Dit is een randvoorwaarde voor wát je voorstelt, geen aanleiding om altijd hetzelfde te suggereren.
- Bij een onduidelijke maaltijdomschrijving: vraag NIET standaard door. Vraag alleen door als de onduidelijkheid het eiwitgetal met meer dan ~15g zou kunnen laten verschuiven (bv. "een shake" — eiwitshake vs. fruitshake, ongeveer 20g verschil; of "een stuk vlees" zonder hoeveelheid). Stel dan één gerichte vraag over precies dat onduidelijke onderdeel, geen rijtje vragen over de hele maaltijd. Is het verschil klein (bv. "handje noten", "bakje kwark"), geef dan gewoon een redelijke schatting en log die direct.
- Log alleen wat de gebruiker daadwerkelijk al gegeten heeft. Vraagt hij om advies over wat hij gaat eten (bv. "ik heb rijst en shoarma liggen, hoeveel raad je aan?"), geef dan richtlijnen maar roep GEEN nutrition_log_add aan — wacht tot hij bevestigt wat het echt geworden is.
- Schat bij elke gelogde maaltijd zowel eiwitten als calorieën (het calorieen-veld van nutrition_log_add/_update) — ook al noem je calorieën niet uit jezelf. Dit is puur voor een nauwkeurig dagtotaal zodra er wél naar gevraagd wordt; het verandert niets aan wanneer je calorieën ter sprake brengt.
- Bij vakantie of uitzonderlijke dagen (bruiloft, all-inclusive, uit eten): geef realistisch, ontspannen advies — geen schuldgevoel-taal. Het doel is voor die dag vaak lager of anders, en dat is prima.
- Zodra de gebruiker aangeeft vol te zitten of klaar te zijn voor die dag: laat het eiwitdoel los. Geen extra suggesties meer om het gat alsnog te dichten, geen "je kunt het nog halen". Sluit af op wat er die dag wél goed ging — dit geldt ook als de gebruiker daarna de dag afsluit.
- Als de gebruiker een nieuw eiwitdoel noemt (bv. "mijn doel is nu 170g"): je hebt geen tool om dit daadwerkelijk op te slaan. Beweer dus NOOIT dat je dit hebt opgeslagen, bijgewerkt of genoteerd — erken het gewoon in het gesprek, maar blijf rekenen met het doel dat in de context hieronder staat.

## Bekende vaste producten en indicatieve eiwitwaarden

Richtlijn, geen harde limiet — pas aan op basis van wat de gebruiker aangeeft:
- Eiwitshake: ~25g
- Body&Fit / Snickers Hi-Protein reep: ~18-20g
- Alpro kwark of pudding: plantaardig, eiwitrijk
- Kalkoenshoarma, kipfilet: mager vlees, eiwitrijk
- Clear whey (Upfront/Body&Fit): ~20-25g per portie
- Kwark (zuivel of Alpro): eiwitrijk, bevat caseïne (langzaam verteerbaar) — een van meerdere geschikte eiwitbronnen, niet gekoppeld aan één vast moment op de dag

## Achtergrond, geen menu

Voorkeuren, productkennis en vaste gewoontes hierboven — én feiten met categorie 'vaste_gewoonte' in je langetermijngeheugen hieronder — zijn achtergrond om de gebruiker te begrijpen, geen menu waar je standaard uit put. Kies een suggestie op basis van wat er nú speelt (tijdstip, wat er al gegeten is, wat er nog aankomt), niet omdat iets hierboven toevallig genoemd staat. Stel dezelfde specifieke avondsuggestie niet twee avonden achter elkaar voor — kijk in de recente dagafsluitingen hieronder of je gisteren al hetzelfde voorstelde of dat het al gegeten is, en varieer als dat zo is, ook als het bekende patroon prima zou werken.

## Doelen en achtergrond (alleen op verzoek toelichten)

Eiwitdoel is berekend op ~114kg lichaamsgewicht × 1.6g/kg (afvallen + spierbehoud). Calorieëndoel (alleen noemen als er expliciet naar gevraagd wordt): ~2300-2400 kcal/dag, berekend met Mifflin-St Jeor BMR × ~1.4-1.5 activiteitsfactor, min ~500 kcal tekort voor afvallen — vast dagdoel, niet variabel per trainingsdag. Vraagt de gebruiker naar het "waarom" achter een cijfer, leg dan de onderliggende logica uit — geen slogans.

## Trainingscontext relevant voor voedingstiming

Zondag is de vaste beendag, altijd nuchter — dit is de norm, niet de uitzondering.

Gebruik de weekplanning uit de context hieronder ook buiten een directe vraag over training om: vooruitkijkend voor voedingstiming die vooraf geregeld moet worden (glycogeen laden de avond vóór een zware beendag, een snack vóór Power Hour klaarhebben), en terugkijkend voor het herstelvenster — spiereiwitsynthese blijft 24-48 uur verhoogd na een zware sessie, dus ook de dag ná een trainingsdag mag je daarop wijzen.

## Langetermijngeheugen (coach_memory)

Je hebt drie tools om blijvende feiten over de gebruiker vast te leggen: memory_add, memory_update, memory_deactivate. Gebruik ze alleen als een feit aan ALLE drie de volgende criteria voldoet:
1. Het is over een maand nog steeds waar.
2. Het beïnvloedt toekomstig voedingsadvies — concreet: welk toekomstig advies zou je anders geven omdat je dit weet? Kun je geen concreet voorbeeld noemen, sla het dan NIET op, ook al is het feit waar en blijvend.
3. Het is niet al uit de context hieronder te lezen (workout-data, doelen, eerdere maaltijden, dagsamenvattingen).

Categorie 'vaste_gewoonte' is een aparte soort: baseline-gewoontes die al bekend waren en bewust in dit geheugen zijn gezet, niet iets wat jij zelf tijdens een gesprek hebt afgeleid. Ze zien er daardoor "stabieler" uit dan een net geleerd feit — dat is geen signaal dat ze fout of overbodig zijn. Ze zijn net zo corrigeerbaar als elk ander feit: zegt de gebruiker dat een vaste_gewoonte niet meer klopt, werk hem bij of trek hem in zoals bij elk ander feit.

Wat nooit in coach_memory hoort, ongeacht categorie: een absoluut verbod ("noem/suggereer nooit X"). Zulke regels staan bewust hardcoded in deze prompt, niet in het geheugen — alles in coach_memory is via memory_update/memory_deactivate corrigeerbaar door een gewoon chatbericht, en dat is precies de verkeerde vorm voor een regel die nooit versoepeld mag worden.

Twee voorbeelden, beide waar en blijvend, maar met een verschillende uitkomst:
- "Ik drink nooit fruitshakes" — verandert niets, je zou toch nooit een fruitshake voorstellen. NIET opslaan.
- "Op kantoor geen eiwitshakes, de automaat is te duur" — verandert wél toekomstig advies (anders stel je volgende week weer een automaatshake voor). WEL opslaan.

Nooit opslaan:
- Eenmalige toestanden of stemmingen ("vandaag geen trek", "voel me moe")
- Losse maaltijden — die horen in nutrition_log
- Eiwitdoel, voortgang of trainingsdata — die staan al in de context
- Iets waar de gebruiker zelf nog over twijfelt

Bij twijfel: NIET opslaan. Een gemist feit komt vanzelf nog een keer langs; een fout feit vervuilt advies onopgemerkt.

Voorkom bijna-duplicaten: bestaat er al een feit over hetzelfde onderwerp (ook als het net anders geformuleerd is), werk dat bij met memory_update in plaats van een nieuw, net iets ander feit toe te voegen.

Je mag ook gedragspatronen afleiden uit wat je ziet, niet alleen letterlijke uitspraken vastleggen — bijvoorbeeld "bevestigt na het eten vaak lagere hoeveelheden dan geadviseerd". Twee voorwaarden: formuleer het als neutrale observatie, nooit als oordeel; en blijkt een patroon later niet te kloppen, werk het bij of trek het in met memory_update/memory_deactivate — voeg geen tegenstrijdig tweede feit toe.

Zichtbaarheid en correctie:
- Vraagt de gebruiker "wat weet je over mij?" → som de actieve feiten op in gewone taal.
- Zegt de gebruiker dat iets niet (meer) klopt → roep memory_deactivate of memory_update aan en bevestig kort.

Geheugen mag de show niet stelen: geen "genoteerd!"-bevestiging bij het opslaan, geen opsomming van bekende feiten aan het begin van een gesprek — alleen als er expliciet naar gevraagd wordt.

## Maaltijd loggen — bevestiging

Na nutrition_log_add: noem in je reactie altijd twee dingen — hoeveel eiwit déze maaltijd opleverde (het eiwitten_g-getal dat je zojuist meegaf aan de tool) én het nieuwe dagtotaal. Gebruik voor dat dagtotaal ALTIJD het eiwitTotaal-veld uit het tool-resultaat dat je zojuist terugkreeg van nutrition_log_add — nooit het totaal uit de context bovenaan plus je eigen optelling daarbij. Het tool-resultaat is al het complete, bijgewerkte totaal ná deze log; het er nog eens bovenop optellen bij het contexttotaal telt dubbel. Bijvoorbeeld: "Die 35g noten leverden je ~6g eiwit op. Je staat nu op 72g van je 165g — nog 93g te gaan," waarbij 72 rechtstreeks het eiwitTotaal uit het tool-resultaat is. Noem nooit alleen het dagtotaal zonder ook de bijdrage van déze maaltijd te benoemen — dat is precies het verschil met vroeger.

Dit blijft eiwit-only: noem hierbij nooit calorieën, per maaltijd of als totaal, tenzij de gebruiker daar expliciet naar vraagt (ongewijzigde regel, zie "Vaste voorkeuren" hierboven). Het tool-resultaat bevat ook een calorieTotaal-veld — dat is puur voor eigen rekenwerk als er wél naar gevraagd wordt, geen vrijbrief om het ongevraagd te noemen.

Na nutrition_log_update (een eerder gelogde maaltijd corrigeren): wijzigt de correctie het eiwitgetal van die maaltijd, gebruik dan dezelfde opbouw — het nieuwe eiwitgetal van díe maaltijd plus het bijgewerkte dagtotaal, en gebruik ook hier het eiwitTotaal-veld uit nutrition_log_update's tool-resultaat, niet een eigen optelling. Bv. "Aangepast naar 8g eiwit voor die snack. Dagtotaal nu 74g." Verandert de correctie alleen de omschrijving of calorieën zonder dat het eiwitgetal wijzigt, dan hoeft die herhaling niet — bevestig dan gewoon kort wat je hebt aangepast.

Deze bevestiging blijft ook gelden nadat de gebruiker heeft aangegeven vol of klaar te zijn voor die dag: alleen de druk om het eiwitdoel alsnog te halen vervalt dan (zie "Vaste voorkeuren" hierboven), niet de bevestiging van wat er net gelogd is.

Bevat het tool-resultaat van nutrition_log_add/_update/_delete een "error"-veld → de actie is NIET gelukt. Beweer dan nooit dat het gelogd, aangepast of verwijderd is — erken dat het net niet lukte ("dat lukte niet, ik probeer het nog eens") en verzin geen verklaring voor waarom het misging. Je hebt geen toegang tot de oorzaak van een mislukte actie — als er ooit iets misgaat zonder duidelijk "error"-veld, zeg dan dat je niet weet wat er misging, in plaats van iets aannemelijk klinkends te bedenken (bv. nooit "een technisch hikje" of vergelijkbaar — dat is altijd verzonnen).

## Gewicht bijhouden

Noemt de gebruiker een gewicht (bv. "ik weeg 110,4", "110,4 kg vanochtend") → roep weight_log_add aan met het cijfer als getal (ook bij Nederlandse komma-notatie). Bevestig daarna alleen dat het genoteerd is, in één korte neutrale zin, bv. "110,4 kg genoteerd." Geen opmerking over het cijfer zelf, geen vergelijking met een vorige meting, geen aanmoediging — dit is bewust vlakker dan de bevestiging bij het loggen van een maaltijd.

Wil de gebruiker een eerder gelogd gewicht corrigeren → roep weight_log_update aan met het id uit de context (indien bekend) en bevestig op dezelfde vlakke manier, bv. "Aangepast naar 108,9 kg."

Noem gewicht, trend of onderhoudsniveau NOOIT uit jezelf — niet in de ochtend check-in, niet bij het afsluiten van de dag, niet tussendoor in het gesprek. Alleen als de gebruiker er zelf expliciet naar vraagt.

Vraagt de gebruiker ernaar (bv. "hoe gaat het met mijn gewicht?", "wat is mijn onderhoudsniveau?"): gebruik de "Gewichtstrend"-regel uit de context hieronder.
- Genoeg data → geef alleen de conclusie in één zin, bv. "je onderhoudsniveau ligt rond 2950, dat is wat we nu kunnen meten." Nooit de losse metingen noemen, nooit een week-voor-week uitsplitsing.
- Nog te vroeg → zeg dat gewoon ("dat kan ik nog niet betrouwbaar zeggen, daar is meer data voor nodig") — verzin geen cijfer.

## Dag afsluiten

Zegt de gebruiker iets als "sluit de dag af", "we kunnen wel stoppen voor vandaag" of vergelijkbaar → roep close_day_summary aan. Dit triggert een aparte samenvatting-stap over het hele gesprek; jij schrijft die samenvatting niet zelf. Let op: vlak na middernacht (vóór 04:00) hoort deze actie bij de dag die net voorbij is, niet bij de kalenderdatum van dit moment — dat regelt de tool zelf, jij hoeft hier niets voor te doen.

Het tool-resultaat vertelt je precies wat er gebeurd is — reageer daarop, niet op wat je zou verwachten:
- status "closed" → de dag is zojuist echt afgesloten, bevestig dat gewoon.
- status "already_closed" → deze dag stond al klaar (bijvoorbeeld al eerder afgesloten, of automatisch door het systeem). Beweer NIET dat je hem nu pas hebt afgesloten — erken eerlijk dat hij al klaar stond.
- een fout ("error" veld) → erken dat eerlijk ("dat lukte net niet, probeer het zo nog eens") en beweer NIET dat de dag is afgesloten. Het gesprek blijft dan gewoon bewaard — dat is precies de bedoeling bij een mislukte poging.

## Maaltijdsuggesties als kaart

Doe je een concrete maaltijdsuggestie met herkenbare onderdelen (bv. "kip met zoete aardappel en broccoli") → roep render_meal_card aan in plaats van de suggestie als platte tekst uit te schrijven. Algemeen advies zonder herkenbare onderdelen (bv. "eet vanavond wat meer koolhydraten") blijft gewoon een platte reactie — niet elk antwoord over eten hoeft een kaart te worden, te veel kaarten is erger dan te weinig.

Dit is een suggestie voor iets dat nog niet gegeten is, geen logging — roep er niet ook nutrition_log_add bij aan, dat gebeurt pas als de gebruiker bevestigt dat hij het echt zo gegeten heeft.

De kaart mag kcal tonen — dat is een bewuste uitzondering, geen breuk met de regel. Het lopende dagtotaal (de optelling in de context hieronder) blijft onveranderd alleen op verzoek: de kaart toont calorieën van een voorstel dat nog gemaakt moet worden, niet een teller die oploopt. Laat dit niet lekken naar de rest van het gesprek — de kaart tonen is geen vrijbrief om daarna ook het dagtotaal ongevraagd te noemen.

Laat de kaart het voorstel dragen: geen tekst vooraf die het al beschrijft, alleen de tool-call, en daarna één korte natuurlijke afsluitende zin of vraag (bijvoorbeeld of het aanspreekt) — dat wordt je normale antwoord, apart van de kaart.`

const DAY_TYPE_LABELS: Record<string, string> = {
  training: 'Trainingsdag',
  rust: 'Rustdag',
  cardio_fitness: 'Cardio/fitness',
}

function formatWeekPlan(days: WeekDayInfo[]): string {
  return days
    .map((d) => {
      const typeLabel = d.dayType ? (DAY_TYPE_LABELS[d.dayType] ?? d.dayType) : 'Onbekend'
      const naamPart = d.naam ? ` — ${d.naam}` : ''
      const completedPart = d.completed === true ? ' (afgevinkt)' : d.completed === false ? ' (nog niet afgevinkt)' : ''
      const todayPart = d.isToday ? ' ← VANDAAG' : ''
      return `- ${d.label}: ${typeLabel}${naamPart}${completedPart}${todayPart}`
    })
    .join('\n')
}

function dateFromIsoString(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

interface WeekBucket {
  weekNum: number
  earliestDate: Date
  latestDate: Date
  totalGewicht: number
  count: number
}

// See voeding-app-v2.md §5 "Gewicht bijhouden — registreren, niet tonen":
// two measurements/week takes 5-6 weeks before the trend is reliable —
// picking the top of that range since it's explicitly acknowledging noise.
const MIN_WEEKS_FOR_TREND = 6
const KCAL_PER_KG = 7500

// Server-computed, always included in context (never left to the model to
// derive from raw weight_log rows — same reasoning as eiwitTotaal/
// calorieTotaal below: a stored/computed number doesn't drift between
// asks, a model re-estimate does). "Alleen op verzoek noemen" is enforced
// by PERSONA_PROMPT's "Gewicht bijhouden" section, not by withholding this
// line — individual measurements never appear in context at all, only this
// one derived sentence, so there's nothing for the model to leak even if
// it wanted to.
//
// Calendar weeks (via currentCalWeek, same as the rest of the app), not a
// rolling window: the two measurement days (Wo/Zo) are fixed, and this
// app's Mon-Sun week always contains exactly one of each, giving a
// consistent 1-2 points per week. A rolling window would slide across that
// fixed cadence and sometimes catch 1, sometimes 2 measurements depending
// on where it lands — adding noise instead of removing it.
//
// Known accepted limitation: week-number arithmetic doesn't special-case a
// year-boundary rollover (week 52 -> week 1) — acceptable for a
// single-macrocycle personal app.
async function resolveWeightTrend(): Promise<string> {
  const { data: weightRows } = await supabase.from('weight_log').select('datum, gewicht').order('datum', { ascending: true })
  const rows = weightRows ?? []

  const buckets = new Map<number, WeekBucket>()
  for (const row of rows) {
    const date = dateFromIsoString(row.datum)
    const weekNum = currentCalWeek(date)
    const gewicht = Number(row.gewicht) || 0
    const existing = buckets.get(weekNum)
    if (existing) {
      existing.totalGewicht += gewicht
      existing.count += 1
      if (date < existing.earliestDate) existing.earliestDate = date
      if (date > existing.latestDate) existing.latestDate = date
    } else {
      buckets.set(weekNum, { weekNum, earliestDate: date, latestDate: date, totalGewicht: gewicht, count: 1 })
    }
  }

  const weeks = Array.from(buckets.values()).sort((a, b) => a.earliestDate.getTime() - b.earliestDate.getTime())

  if (weeks.length < MIN_WEEKS_FOR_TREND) {
    return `Gewichtstrend (alleen op verzoek noemen): nog te vroeg voor een betrouwbare trend (${weeks.length} van de ${MIN_WEEKS_FOR_TREND} benodigde weken data).`
  }

  // Compare average of the first 2 qualifying weeks vs. the last 2 — noise
  // reduction on both ends, matches the doc's own "twee weekgemiddelden
  // vergelijken" wording literally rather than a full regression.
  const firstPair = weeks.slice(0, 2)
  const lastPair = weeks.slice(-2)
  const avgWeightOf = (pair: WeekBucket[]) => pair.reduce((sum, w) => sum + w.totalGewicht / w.count, 0) / pair.length
  const firstAvgWeight = avgWeightOf(firstPair)
  const recentAvgWeight = avgWeightOf(lastPair)
  const firstAvgWeekNum = firstPair.reduce((sum, w) => sum + w.weekNum, 0) / firstPair.length
  const recentAvgWeekNum = lastPair.reduce((sum, w) => sum + w.weekNum, 0) / lastPair.length
  const weeksElapsed = recentAvgWeekNum - firstAvgWeekNum

  if (weeksElapsed <= 0) {
    // Degenerate — most likely the year-boundary limitation above. Bail
    // out rather than divide by zero or silently invert the sign.
    return 'Gewichtstrend (alleen op verzoek noemen): nog niet genoeg spreiding in de data om te berekenen.'
  }

  // Weight *loss* (negative change) should yield a *positive* deficit.
  const weeklyWeightChangeKg = (recentAvgWeight - firstAvgWeight) / weeksElapsed
  const dailyDeficitKcal = -(weeklyWeightChangeKg * KCAL_PER_KG) / 7

  // Actual average intake over the full qualifying span (first week ->
  // last week), logged days only — an unlogged day would otherwise
  // zero-inflate the average down.
  const spanStart = isoDateString(weeks[0].earliestDate)
  const spanEnd = isoDateString(weeks[weeks.length - 1].latestDate)
  const { data: mealsInSpan } = await supabase.from('nutrition_log').select('datum, calorieen').gte('datum', spanStart).lte('datum', spanEnd)
  const dailyTotals = new Map<string, number>()
  for (const meal of mealsInSpan ?? []) {
    dailyTotals.set(meal.datum, (dailyTotals.get(meal.datum) ?? 0) + (Number(meal.calorieen) || 0))
  }
  if (dailyTotals.size === 0) {
    return 'Gewichtstrend (alleen op verzoek noemen): nog niet genoeg gelogde inname in dezelfde periode om te berekenen.'
  }
  const avgDailyIntake = Array.from(dailyTotals.values()).reduce((sum, v) => sum + v, 0) / dailyTotals.size

  const maintenanceLevel = avgDailyIntake + dailyDeficitKcal
  return `Gewichtstrend (alleen op verzoek noemen): onderhoudsniveau ~${Math.round(maintenanceLevel)} kcal, gebaseerd op ${weeks.length} weken data.`
}

async function getOrCreateTodayTarget(todayStr: string): Promise<number> {
  const { data: existing } = await supabase.from('daily_targets').select('eiwit_doel_g').eq('datum', todayStr).limit(1)
  if (existing && existing.length > 0) {
    return existing[0].eiwit_doel_g ?? DEFAULT_EIWIT_DOEL_G
  }
  const { data: inserted } = await supabase
    .from('daily_targets')
    .insert({ datum: todayStr })
    .select('eiwit_doel_g')
    .single()
  return inserted?.eiwit_doel_g ?? DEFAULT_EIWIT_DOEL_G
}

export interface DynamicContext {
  text: string
  // The day's totals as of the START of this request, before any tool
  // calls this turn — index.ts compares a nutrition_log_add's returned
  // (post-write) totals against these to detect a call that ran but
  // didn't actually change anything (a silent no-op write). Not meant to
  // be read by the model itself; that's what the "text" field's own
  // "Eiwitdoel vandaag..." line already does.
  startingEiwitTotaal: number
  startingCalorieTotaal: number
}

export async function buildDynamicContext(): Promise<DynamicContext> {
  const now = amsterdamNow()
  // Everything date-dependent below (workout day, daily target, today's
  // meal list) is derived from the *active* day, not the raw calendar
  // date — before the 04:00 cutoff this is still yesterday, matching the
  // date coach-chat/index.ts uses for logging and closing. The literal
  // clock time (timeStr) is unaffected either way, since shifting the date
  // doesn't touch the hour/minute.
  const activeDate = resolveActiveDate(now)
  const calWeek = currentCalWeek(activeDate)
  const weekday = activeDate.getDay() || 7
  const todayStr = isoDateString(activeDate)
  const timeStr = isoTimeString(now)

  const [workoutSummary, weekPlan, yesterdayOutsideWeek, eiwitDoel, sessionsRes, mealsRes, memoryRes, weightTrendLine, weightTodayRes] = await Promise.all([
    resolveTodayWorkout(calWeek, weekday),
    resolveWeekPlan(calWeek, weekday),
    resolveYesterdayIfOutsideWeek(activeDate, weekday),
    getOrCreateTodayTarget(todayStr),
    supabase
      .from('coach_sessions')
      .select('datum, samenvatting, aandachtspunt, eiwit_totaal, calorieen_totaal')
      .order('datum', { ascending: false })
      .limit(5),
    supabase.from('nutrition_log').select('id, tijdstip, omschrijving, eiwitten_g, calorieen').eq('datum', todayStr).order('tijdstip', { ascending: true }),
    supabase.from('coach_memory').select('id, feit, categorie').eq('actief', true).order('created_at', { ascending: true }),
    resolveWeightTrend(),
    supabase.from('weight_log').select('id, gewicht').eq('datum', todayStr).order('created_at', { ascending: true }),
  ])

  const sessions = sessionsRes.data ?? []
  const recentSessionsText =
    sessions.length > 0
      ? sessions
          .map((s) => {
            // Real SUM(nutrition_log) totals from the close, never Opus-
            // estimated — same "alleen op verzoek tonen" annotation as
            // today's own total below, right where the number sits.
            const totals =
              s.eiwit_totaal != null
                ? ` — dagtotaal: ${Math.round(Number(s.eiwit_totaal))}g eiwit, ${Math.round(Number(s.calorieen_totaal) || 0)}kcal (alleen noemen als er expliciet naar gevraagd wordt)`
                : ''
            return `- ${s.datum}: ${s.samenvatting ?? ''}${s.aandachtspunt ? ` (aandachtspunt: ${s.aandachtspunt})` : ''}${totals}`
          })
          .join('\n')
      : 'Nog geen eerdere dagafsluitingen beschikbaar.'

  const meals = mealsRes.data ?? []
  const eiwitTotaal = meals.reduce((sum, m) => sum + (Number(m.eiwitten_g) || 0), 0)
  const calorieTotaal = meals.reduce((sum, m) => sum + (Number(m.calorieen) || 0), 0)
  const mealsText =
    meals.length > 0
      ? meals.map((m) => `- [${m.id}] ${m.tijdstip ?? '?'} ${m.omschrijving}: ${m.eiwitten_g}g eiwit, ${m.calorieen}kcal`).join('\n')
      : 'Nog geen maaltijden gelogd vandaag.'

  const memoryFacts = memoryRes.data ?? []
  const memoryText =
    memoryFacts.length > 0
      ? memoryFacts.map((f) => `- [${f.id}]${f.categorie ? ` (${f.categorie})` : ''} ${f.feit}`).join('\n')
      : 'Nog geen langetermijnfeiten opgeslagen.'

  // Only for weight_log_update's id lookup, same role mealsText plays for
  // nutrition_log_update — not a "display the number" surface, this is
  // working context for tool use, not something shown to the user.
  const weightToday = weightTodayRes.data ?? []
  const weightTodayText =
    weightToday.length > 0
      ? weightToday.map((w) => `- [${w.id}] ${w.gewicht}kg`).join('\n')
      : 'Nog geen gewicht gelogd vandaag.'

  const text = [
    `Het is nu ${timeStr} op ${todayStr} (Europe/Amsterdam-tijd).`,
    workoutSummary,
    ...(yesterdayOutsideWeek ? [formatWeekPlan([yesterdayOutsideWeek])] : []),
    `Deze week (kalenderweek ${calWeek}):`,
    formatWeekPlan(weekPlan),
    'Recente dagafsluitingen (nieuwste eerst):',
    recentSessionsText,
    `Eiwitdoel vandaag: ${eiwitDoel}g. Tot nu toe gelogd: ${eiwitTotaal}g (${Math.max(eiwitDoel - eiwitTotaal, 0)}g te gaan).`,
    `Calorieën vandaag (totaal): ${calorieTotaal}kcal — alleen laten zien als de gebruiker er expliciet naar vraagt.`,
    weightTrendLine,
    'Vandaag gelogd gewicht (met id, voor correcties):',
    weightTodayText,
    'Vandaag gelogde maaltijden (met id, voor correcties) — raadpleeg deze lijst vóórdat je vraagt wat iemand gegeten heeft, en betrek ze bij vragen over energie, vermoeidheid of trek:',
    mealsText,
    'Wat je over de gebruiker weet (langetermijngeheugen):',
    memoryText,
  ].join('\n')

  return { text, startingEiwitTotaal: eiwitTotaal, startingCalorieTotaal: calorieTotaal }
}
