# Voeding App — v2

Alle blokken van de eerste bouwfase (1 t/m 9, inclusief blok 5) zijn gebouwd,
gepusht en live. Dit document verzamelt twee dingen: restpunten uit die
bouw- en testfase die nog niet afgevinkt zijn, en nieuwe featureideeën voor
een volgende fase. Zie `voeding-app-volledige-documentatie.md` voor de
volledige bouw- en testgeschiedenis van fase 1.

---

## 1. Nog niet live getest (uit het blok 4-testplan)

Deze zes punten stonden als testplan klaar sinds blok 4, maar zijn nooit
afgevinkt — waarschijnlijk ingehaald doordat blok 5 en de dagelijkse
gebruikspraktijk andere dingen prioriteit gaven. Geen van deze heeft een
bekend probleem; ze zijn simpelweg nooit expliciet bevestigd.

- ⬜ **Permissievraag bij eerste start** — weigeren van de notificatie-
  permissie moet de app normaal laten werken, zonder crash of geblokkeerde
  flow.
- ⬜ **Openen overdag** → gewone opening, géén afsluit-vraag.
- ⬜ **Openen ná 22:00** → afsluit-vraag mét reden ("zodat ik de dag kan
  samenvatten").
- ⬜ **Dag afsluiten via chat, daarna heropenen 's avonds** → vraagt **niet**
  opnieuw om af te sluiten.
- ⬜ **Melding vuurt ook op een dag zonder enige activiteit** (onvoorwaardelijk
  — de 23:30-melding hoort altijd te vuren, ongeacht of er die dag gelogd is).
- ⬜ **Wo/Zo-gewichtsherinnering vuurt op de juiste dag** — de `weekday`-
  waarden (Wo=4, Zo=1) zijn geverifieerd tegen de daadwerkelijke Capacitor-
  broncode (`DateMatch.java` + de runtime `Weekday`-enum), maar nooit op een
  echt toestel bevestigd: er was geen adb/emulator beschikbaar in de
  bouwomgeving om `getPending()` te raadplegen. Nodig: een echte woensdag of
  zondag afwachten, óf alsnog on-device `getPending()` checken. Het
  faalpatroon hier is onzichtbaar — een melding die op de verkeerde dag
  vuurt ziet er identiek uit als een werkende melding, dus dit mag niet
  stilzwijgend als "waarschijnlijk goed" blijven staan.

*Wel al bevestigd (ter referentie, geen actie nodig):* de echte 23:30-melding
werkt (5 augustus), en de handmatige dagafsluiting end-to-end werkt (5
augustus, na de 529-storing die dit eerder blokkeerde).

---

## 2. Monitoring-punten (geen bug, wel iets om in de gaten te houden)

- **Lichaamsgewicht staat nergens gestructureerd.** Het zit alleen impliciet
  in de afleiding van het eiwitdoel (114kg × 1.6g/kg). Als gewichtsverloop
  ooit relevant wordt voor de coach, hoort dat een eigen kolom/tabel te
  krijgen — niet een `coach_memory`-rij (feiten ≠ parameters, zie de
  memory-spec).
  - *Update 11 augustus:* gewicht is inmiddels **111kg**. Dit is precies het
    moment waarop dit gat iets begint te kosten — de 114kg in de afleiding is
    nu stale, en er is geen plek waar dat vanzelf opvalt.
  - **Het eiwitdoel blijft desondanks 165g.** Bij het narekenen bleek de
    2,0-2,4 g/kg-richtlijn voor spierbehoud in een tekort te slaan op
    *vetvrije* massa, niet op totaalgewicht. Afgezet tegen een geschatte
    vetvrije massa van ~75-80kg zit 165g al rond 2,1-2,2 g/kg VVM — in het
    optimale bereik. Naar totaalgewicht schalen overschat fors bij een hoger
    vetpercentage. Vastgelegd zodat dit niet elke paar kilo opnieuw ter
    discussie komt: **gewichtsverlies dat vooral vetmassa is, hoort het
    eiwitdoel niet te verlagen.**
  - ➡️ **Dit gat is inmiddels uitgewerkt tot een concrete feature** — zie
    "Gewicht bijhouden" in sectie 5. Daarmee gaat dit punt van "staat nergens"
    naar een ontworpen oplossing; het blijft hier alleen staan als
    monitoringpunt tot die feature gebouwd is.

- **`coach_memory` periodiek controleren op ruis.** Nog niet gedaan sinds de
  laatste check. Staat er onterecht opgeslagen ruis in, dan is dat het
  signaal om de opslag-beslissing (nu `claude-sonnet-5`) naar een sterker
  model te tillen — fout onthouden werkt onzichtbaar door, dus dit moet
  actief gecheckt worden, het valt niet vanzelf op.
  - *Stand 11 augustus:* drie actieve rijen, alle drie correct — het Cardio
    Fitness/Beverwijk-feit (opgeslagen onder de gebruikersterm "Power Hour",
    niet de canonieke doc-term; geen probleem, wel goed om te weten bij het
    lezen van de tabel), het kantoordagen-feit (dinsdag/donderdag, donderdag
    eten meenemen — die ochtend nog verfijnd), en sinds vandaag het
    pindakaas-feit (~10g per boterham-moment, dunne laag). Geen ruis
    aangetroffen.
  - **Bij los/vrij testen:** sinds blok 2 schrijft de coach echt weg. Losse
    testvragen kunnen ongewenste `nutrition_log`- én `coach_memory`-rijen
    opleveren. `nutrition_log` is makkelijk op te ruimen (delete op datum);
    `coach_memory` niet — een fout feit ziet er niet fout uit en blijft
    stilletjes advies sturen. Na elke testsessie dus even controleren wat
    erbij gekomen is.

---

## 3. Staande afspraak — verificatie bij elke Edge Function-deploy

**Vastgelegd 11 augustus, na vier transcriptiefouten in één sessie.**

`deploy_edge_function` neemt letterlijke bestandsinhoud per call; er is geen
build-step die imports resolvet. Elke deploy stuurt dus *alle* gebundelde
bestanden opnieuw mee, ook bestanden die niets met de wijziging te maken
hebben. Zolang die met de hand worden overgetypt, draagt elke deploy het
risico van fouten in ongerelateerde code — en die fouten zijn stil: een
gestripte `summary.ts` crasht niet, hij schrijft alleen niets meer weg, wat
je pas uren later merkt bij de dagafsluiting.

**Sinds v22 in gebruik, en de afspraak voor alle volgende deploys:**
1. Payload genereren met een script dat direct van schijf leest — nooit
   hertypen in de tool-call.
2. Na de deploy: byte-voor-byte diffen van de gedeployde inhoud tegen
   git/schijf. Niet "ziet er goed uit", maar een echte vergelijking.

**Onderstaand blok in elke CC-prompt opnemen die een Edge Function
deployt:**

```
## Deploy verification (required)

Generate the deploy payload with a script that reads the files directly
from disk — do not retype file contents into the tool call. After
deploying, verify git ↔ production parity with a real byte-for-byte diff
of every bundled file, not a visual check and not an assumption that the
deploy landed correctly.

This is a standing requirement for this project: hand-typed payloads have
repeatedly corrupted unrelated shared files (a stubbed summary.ts that
silently stopped writing to coach_sessions, an undefined variable in
today.ts's Monday cross-week path). These fail silently, so the diff is
the only thing that catches them.
```

---

## 4. Staande afspraak — testdata opruimen na elke verificatie

**Vastgelegd 11 augustus, nadat vier testrijen in de echte dagafsluiting
terechtkwamen.**

Verificatie draait tegen de echte database. Elke testconversatie die een
maaltijd logt, schrijft een echte rij naar `nutrition_log` — en als de
dagafsluiting daarna draait, rekent die eroverheen. Op 11 augustus leverde dat
een sessie op met 257g eiwit in plaats van de werkelijke 179g; de vier
testrijen (kwark+whey 40g, eieren 15g, rijstwafel 3g, brood+kipfilet 20g)
waren in het totaal beland. Handmatig gecorrigeerd.

**Waarom dit stil misgaat:** de `SUM` in `coach_sessions` klopte technisch
perfect — hij telde op wat er stond. De samenvattingstekst klopte óók, want
die kwam uit de echte chatthread zonder testberichten. Alleen naast elkaar
gelegd viel het verschil op. Niets crasht, niets meldt iets.

**Afspraak voor alle volgende verificatieruns:**
1. Noteer tijdens de run welke rijen zijn aangemaakt (id's, of het
   tijdvenster).
2. Verwijder ze direct na afloop — niet "later even", want de dagafsluiting
   kan er 's nachts overheen draaien.
3. Controleer achteraf: som van `nutrition_log` voor die datum moet
   overeenkomen met wat er werkelijk gegeten is, en met `eiwit_totaal` /
   `calorieen_totaal` in `coach_sessions` als de dag al afgesloten is.
4. Check ook `coach_memory` — testconversaties kunnen feiten opslaan. Die zijn
   veel lastiger te herkennen dan maaltijdrijen, want een fout feit ziet er
   niet fout uit (zie ook het monitoringpunt hierboven).

**Onderstaand blok in elke CC-prompt opnemen die verificatie tegen de echte
database doet:**

```
## Test data cleanup (required)

Verification runs against the live database, so any test conversation that
logs a meal writes a real row to nutrition_log — and the day-close will sum
over it. This has already corrupted one day's totals (257g protein recorded
instead of the real 179g).

After verification:
1. Delete every row your test run created — track the ids or the time
   window as you go.
2. Verify the cleanup: nutrition_log's SUM for that date must match what
   was actually eaten, and match eiwit_totaal / calorieen_totaal in
   coach_sessions if the day was already closed.
3. Check coach_memory for facts stored during testing and deactivate any
   that shouldn't persist.

Do the cleanup in the same session — not "later." The 23:30 notification
and the 02:00 cron can both close the day before anyone gets back to it.
```

---

## 5. Featureideeën (fase 2, nog niet uitgewerkt of gepland)

Losse ideeën, nog niet in blokken opgedeeld en nog niet ontwerpmatig
uitgedacht (geen calorieën-regels, triggers, of tool-mechanismen bepaald
zoals bij blok 5) — dat is werk voor wanneer een van deze opgepakt wordt.

- **Gewicht bijhouden — registreren, niet tonen.** ⚙️ **Uitgedacht (11-12
  augustus), nog geen CC-prompt geschreven.** Vult het openstaande
  monitoringpunt over lichaamsgewicht uit sectie 2.

  **Waarom dit nodig is.** Het onderhoudsniveau is nu een *schatting* uit een
  formule (Mifflin-St Jeor × activiteitsfactor). Zulke formules zitten er
  makkelijk 10-15% naast — bij 111kg is dat 300-450 kcal, groter dan het hele
  verschil waar het advies over gaat. Met genoeg meetpunten is het werkelijke
  onderhoudsniveau terug te rekenen uit eigen data, en is er geen formule meer
  nodig.

  **Het weegprotocol (vastgesteld, met onderbouwing):**
  **Woensdag- en zondagochtend**, na het eerste toiletbezoek, vóór eten en
  drinken, in ondergoed.
  - **Woensdag** ligt het verst van elke zware sessie: 3 dagen na beendag
    (zondag), 2 dagen na rug & biceps (maandag), met dinsdag (anti-zit-dag)
    ertussen — geen nieuwe belasting
  - **Zondagochtend** is ook schoon: benen worden die dag pás getraind, dus
    's ochtends zit je 7 dagen na de vorige beendag. Alleen schouders van
    vrijdag/zaterdag speelt mee — kleine spiergroep, weinig vochtretentie
  - **Praktische haalbaarheid gaf de doorslag** boven zaterdag+zondag:
    woensdag is thuiswerkdag en zondag kent geen haast, dus op beide dagen kan
    er gewacht worden tot ná het toilet. De theoretisch beste dag is waardeloos
    als het de helft van de keren niet lukt
  - *Geruststelling die erbij hoort:* zelfs áls er wat retentie in zit, valt
    dat weg bij het vergelijken van weken — het effect herhaalt zich elke week
    identiek en zit dus in beide weekgemiddelden even hard. Dit hoeft niet
    perfect

  **Het ontwerpprincipe: registreren, niet tonen.** Dit is dezelfde regel die
  de app al toepast op calorieën, en om dezelfde reden. Een oplopende
  calorieteller werkt verkrampend; een gewicht dat je twee keer per week
  bewust bekijkt en beoordeelt, doet dat net zo goed. Dus:
  - Het losse getal wordt **ingevoerd maar niet teruggetoond** — geen grafiek
    van losse metingen, geen "je zat vorige week op X"
  - Wat wél getoond wordt is een **trend, en alleen wanneer die iets
    betekent** — bijvoorbeeld eens per maand: "je onderhoudsniveau ligt rond
    2950, dat is wat we nu kunnen meten." Een conclusie, geen scorebord
  - Structureel is dit hetzelfde patroon als `calorieen_totaal` in
    `coach_sessions`: een kolom die gevuld wordt en meerekent, maar niet
    standaard in beeld komt

  **Wat de coach er uiteindelijk mee doet.** Twee weekgemiddelden vergelijken
  geeft het werkelijke wekelijkse verlies; dat maal ~7500 kcal/kg, gedeeld
  door zeven, geeft het dagelijkse tekort; opgeteld bij de werkelijke inname
  (die al in `nutrition_log` staat) volgt het werkelijke onderhoudsniveau.
  Met twee metingen per week duurt het 5-6 weken voor die trend betrouwbaar is
  — dat is de prijs van twee in plaats van zeven metingen, en bewust
  geaccepteerd.

  **Nog te bepalen bij de bouw:**
  - Data-model: eigen tabel (`weight_log`: id, datum, gewicht) — expliciet
    *geen* `coach_memory`-rij, want dit is een parameter, geen feit (zie de
    memory-spec)
  - Invoer: via de chat ("ik weeg 110,4") of een klein UI-element? De chat
    ligt voor de hand — het is twee keer per week, dus de frictie die bij
    hydratie het probleem was speelt hier veel minder
  - Herinnering op woensdag/zondagochtend? Zo ja, dan botst dat mogelijk met
    de bestaande ochtend-check-in-kaart — uitzoeken of het dáárin past in
    plaats van als losse melding
  - Bij welke drempel/hoeveelheid meetpunten begint de coach over een trend?
    En hoe vaak mag hij die noemen (voorstel: laag, vergelijkbaar met de
    hydratie- en spreidingsregels)?
  - Moet het weekgemiddelde over kalenderweken lopen, of over een voortschrij-
    dend venster? Bij twee vaste dagen per week is dat verschil niet triviaal

- **Eiwitspreiding over de dag — coach stuurt op timing, niet alleen op het
  dagtotaal.** ⚙️ **Uitgedacht (11 augustus), nog geen CC-prompt geschreven.**

  **Aanleiding — bevestigd met echte data, geen aanname.** Zeven dagen
  `nutrition_log` (5 t/m 11 augustus, 54 rijen) tegen de tijdstip-kolom
  gelegd:

  | Dagdeel | Gemiddeld per dag | Aandeel |
  |---|---|---|
  | Voor 11:00 | ~9g | 5% |
  | 11:00-15:00 | ~49g | 28% |
  | 15:00-18:00 | ~19g | 11% |
  | Vanaf 18:00 | ~100g | 57% |

  Vanaf 21:00 alleen al komt gemiddeld 42g binnen — meer dan de hele ochtend
  en namiddag samen. Het eerste log van de dag ligt op zes van de zeven dagen
  tussen 10:30 en 13:14.

  **Waarom dit een feature verdient en geen losse tip is.** De dagtotalen zijn
  goed: vijf van de zeven dagen op of boven 165g. De coach ziet dus een groene
  dag en zegt niets, terwijl de verdeling eronder suboptimaal is voor
  spieraanmaak. Precies het soort patroon dat over één dag onzichtbaar is en
  alleen bij het optellen over meerdere dagen zichtbaar wordt — dat is werk
  voor de app, niet voor de gebruiker.

  **Geen schemawijziging nodig.** `nutrition_log.tijdstip` bestaat al en wordt
  al gevuld. Dit is puur context-opbouw + prompt-werk. Dat maakt het een
  goedkope feature vergeleken met hydratie (nieuwe tabel + UI).

  **Datakwaliteit — één ding om op te vangen bij de bouw.** Er staan logs op
  00:16 en 00:25 die inhoudelijk bij de vórige avond horen (laat gegeten,
  gelogd na middernacht). Naïef groeperen op `datum` telt die mee als
  "ochtend" en maakt het ochtendcijfer kunstmatig rooskleurig. Voorstel:
  logs vóór ~04:00 toerekenen aan de vorige dag, te bevestigen bij het plan.
  Let op dat dit dezelfde grens raakt als de dagafsluiting/cron van 02:00 —
  uitzoeken of die twee dezelfde definitie van "dag" moeten hanteren.

  **Ontwerpspanning: dit mag geen tweede doel worden.** Vier tijdvensters met
  elk een streefgetal zijn vier kansen per dag om tekort te schieten — precies
  het verkrampende gevoel dat `voeding_tracking_kennis_doc.md` bij het
  calorie-doel wil vermijden. Uitgangspunten daarom:
  - **Geen zichtbare vensterdoelen in de UI**, geen voortgangsbalkjes per
    dagdeel, geen "je loopt achter voor dit tijdvak"
  - **Vooruitkijkend formuleren, nooit terugkijkend.** "Een shake in de auto
    schuift 25g naar voren" mag; "je zat vanochtend op 9g" niet — dat is de
    schuldgevoel-taal die ook als check-in-trigger al bewust is afgevallen
  - Eén doel blijft één doel: 165g per dag. Spreiding is *advies*, geen target

  **Voorgestelde plek: de bestaande `morning-checkin`.** Die functie redeneert
  al over de dag die komt, draait één keer per dag, en heeft al een
  gedwongen tool-call om een kaart te vullen. Een spreidingsadvies is
  inhoudelijk hetzelfde soort uitspraak als de bestaande trainingsnudges. Het
  alternatief — de coach dit tijdens het gesprek laten opmerken — is
  ongeschikt: hij zou het pas 's avonds noemen, wanneer er niets meer aan te
  doen is.

  **Nog te bepalen bij de bouw:**
  - Over hoeveel dagen wordt het patroon berekend? (voorstel: 7, genoeg om
    ruis te dempen zonder traag te reageren op verbetering)
  - Bij welke drempel telt het als patroon en niet als toevallige dag?
  - Hoe vaak mag hij het noemen? Elke ochtend is zeurderig; voorstel is een
    lage frequentie, vergelijkbaar met de hydratie-regel
  - Blijft het advies stil zodra het patroon verbetert? (moet het — anders
    wordt het een vaste zin die niemand meer leest)

  **Twee concrete haakjes uit de data, als de coach iets specifieks moet
  kunnen voorstellen:** ontbijt is vaak onderweg in de auto (dus
  meeneembaar: shake, kwark, reep), en het gat van 15:00-18:00 valt samen met
  de al gedocumenteerde energiedip rond 15:00 — daar snijdt één suggestie aan
  twee kanten.

- **Hydratie loggen — zonder te hoeven typen.** ⚙️ **Uitgedacht, prompt klaar,
  nog niet aan CC gegeven.** Gesplitst in twee fases nadat bleek dat een
  homescreen-widget geen gewone Capacitor-functionaliteit is, maar altijd
  native Android-code (`AppWidgetProvider`/`RemoteViews`) vraagt — een ander
  soort werk dan de rest van deze app (die puur web + kant-en-klare
  Capacitor-plugins gebruikt, zoals Local Notifications).

  **Fase A — knop in de UI (bouwklaar):**
  - Vast glas van 250ml per tik, geen zelf te kiezen hoeveelheid
  - Directe DB-write bij tikken, geen chatbericht, geen LLM-call
  - Klein, onopvallend lopend totaal zichtbaar bij de knop (bv. "🥤 4 glazen
    vandaag") — **geen zichtbaar dagdoel**, puur een teller
  - Data-model: vermoedelijk een nieuwe tabel (`hydration_log`, zelfde vorm
    als `nutrition_log`: id/datum/tijdstip/ml) — te bevestigen door CC bij
    het plan
  - **Coach mag proactief over hydratie beginnen**, in tegenstelling tot
    calorieën — maar alleen onder een smalle, lage-frequentie voorwaarde
    (voorstel: na 18:00 en minder dan 3 glazen gelogd → één keer terloops
    mogen noemen, niet zeurderig), te bevestigen in het bouwplan
  - Coach krijgt hydratiedata in context op dezelfde manier als
    `nutrition_log` nu al binnenkomt

  **Fase B — homescreen-widget (apart, later, groter traject):** vraagt
  bewust een eigen sessie waarin de native-Android-kant wordt ingedoken —
  niet iets wat "erbij" gaat in een normale CC-plan-mode prompt. Nog niet
  uitgewerkt.

- **Coach-header opfrissen.** Het huidige logo + groene "online"-bolletje
  bovenaan de chat oogt saai/generiek. Puur visueel, geen functionele
  impact — kandidaat om samen met wat frontend-polish op te pakken.

- **Chat-inputveld groeit niet mee met lange tekst.** Bij een langere
  boodschap blijft het invoerveld op vaste hoogte staan in plaats van mee te
  schalen (auto-grow textarea), wat lange berichten typen onhandig maakt.
  Losse UI-bug/verbetering, geen backend-impact.

---

## Bijlage — klaarstaande CC-prompt (Hydratie, Fase A)

Nog niet gegeven aan CC. Bewaard hier zodat 'm zo gekopieerd kan worden
wanneer je zover bent.

```
Build the "quick hydration log" feature for the voeding-app (nutrition coach
app) — a fast, no-typing way to log water intake.

START IN PLAN MODE. Investigate first, then present a concrete build plan for
review. Do not write or edit any code until the plan is approved.

## Scope

This is Fase A of a two-phase idea (see voeding-app-v2.md item "Hydratie
functie"). Fase A is UI-only, no widget. A homescreen widget (Fase B) is
explicitly out of scope for this build — do not attempt any native Android
widget work.

## What this should do

1. A quick-log button in the app UI (not in the chat — a persistent UI
   element, e.g. near the header or as a small floating control) that logs
   one glass (250ml) with a single tap. No chat message, no LLM call — this
   is a direct DB write, same spirit as a plain UI action, not a coach
   interaction.
2. A small, unobtrusive running total for today near the button (e.g. "🥤 4
   glazen vandaag" or similar) — not a goal/progress bar, just a count. No
   daily target is displayed anywhere.
3. The coach gets today's (and recent days', if cheap to include) hydration
   data in its context, the same way it already gets nutrition_log rows —
   check today.ts / the context-building code coach-chat already uses and
   follow that existing pattern rather than inventing a new one.
4. Persona prompt: the coach may proactively mention hydration, but only
   under a narrow, low-frequency condition — propose a specific rule (e.g.
   "if it's after 18:00 and fewer than 3 glasses are logged today, you may
   mention it once, casually, not as a nag") and put it in your plan for
   confirmation before implementing. This is deliberately not a hard
   displayed goal — just a soft trigger for the coach's own judgment, same
   category as the existing training-day nudges.

## Data model

Investigate first — don't assume. Propose either a new small table
(hydration_log, mirroring nutrition_log's shape: id, datum, tijdstip, ml)
or another approach if you find a better fit, but a new table is the
expected answer given this is a different unit/purpose than nutrition_log.
Fixed 250ml per tap for now — no custom amounts in this phase.

## Explicitly out of scope

- No homescreen widget (Fase B, separate future work).
- No custom/variable amounts per log — fixed 250ml per tap only.
- No daily goal/target shown in the UI.
- Don't touch nutrition_log, coach_memory, or any existing tool/card logic
  beyond adding hydration context alongside what coach-chat already fetches.

## Deploy verification (required)

Generate the deploy payload with a script that reads the files directly
from disk — do not retype file contents into the tool call. After
deploying, verify git ↔ production parity with a real byte-for-byte diff
of every bundled file, not a visual check and not an assumption that the
deploy landed correctly.

This is a standing requirement for this project: hand-typed payloads have
repeatedly corrupted unrelated shared files (a stubbed summary.ts that
silently stopped writing to coach_sessions, an undefined variable in
today.ts's Monday cross-week path). These fail silently, so the diff is
the only thing that catches them.

## Test data cleanup (required)

Verification runs against the live database, so any test conversation that
logs a meal — or in this case taps the hydration button — writes real rows.
This has already corrupted one day's totals (257g protein recorded instead
of the real 179g).

After verification:
1. Delete every row your test run created, in both nutrition_log and the
   new hydration table — track the ids or the time window as you go.
2. Verify the cleanup: sums for that date must match what was actually
   consumed, and match coach_sessions if the day was already closed.
3. Check coach_memory for facts stored during testing and deactivate any
   that shouldn't persist.

Do the cleanup in the same session — not "later." The 23:30 notification
and the 02:00 cron can both close the day before anyone gets back to it.

## Verification

- Tapping the button logs a row and the on-screen count updates
  immediately, no reload needed.
- Reload the app — today's count persists correctly (reads from DB, not
  just local state).
- Ask the coach directly about water intake → it can answer using real
  logged data.
- Simulate the "few glasses by evening" condition → coach mentions it once,
  casually, not repeatedly across multiple replies in the same
  conversation.
- Simulate a day with plenty of glasses logged → coach does not mention
  hydration unprompted.
- Renders correctly at phone width, no layout overflow.

Give me a plan before building.
```

---
Volledige bouw- en testdocumentatie: `voeding-app-volledige-documentatie.md`
