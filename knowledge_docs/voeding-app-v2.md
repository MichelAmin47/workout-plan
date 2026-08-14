# Voeding App — v2

Alle blokken van de eerste bouwfase (1 t/m 9, inclusief blok 5) zijn gebouwd,
gepusht en live. Dit document verzamelt twee dingen: restpunten uit die
bouw- en testfase die nog niet afgevinkt zijn, en nieuwe featureideeën voor
een volgende fase. Zie `voeding-app-volledige-documentatie.md` voor de
volledige bouw- en testgeschiedenis van fase 1.

---

## 1. Nog niet live getest (uit het blok 4-testplan)

Deze punten stonden als testplan klaar sinds blok 4, maar zijn nooit
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

*Wel al bevestigd (ter referentie, geen actie nodig):* de echte 23:30-melding
werkt (5 augustus), de handmatige dagafsluiting end-to-end werkt (5 augustus,
na de 529-storing die dit eerder blokkeerde), en de Wo/Zo-gewichtsherinnering
staat on-device correct gepland (13 augustus, bevestigd via een screenshot
van `LocalNotifications.getPending()` op een echt toestel — id 1002 op
`weekday:4`/07:00 en id 1003 op `weekday:1`/07:00, exact overeenkomend met
`weightReminder.js`'s bedoelde Wednesday/Sunday-mapping en de Capacitor
`Weekday`-enum, `id` 1001 op 23:30 voor de dagelijkse afsluit-melding was ook
zichtbaar. Dit bevestigt dat de meldingen correct *gepland* staan; of ze ook
altijd zichtbaar vuren hangt af van toestelgedrag (batterij-optimalisatie,
Do Not Disturb) — dat is losstaand van deze code-verificatie).

- ✅ **Opgelost (14 augustus).** Coach beweerde te loggen zonder te loggen (13
  augustus, 23:07) — bij een overzichtsvraag toonde de coach de hamburger in
  de lijst, maar de tool-call werd niet uitgevoerd — pas op expliciet verzoek
  vijf minuten later belandde hij echt in `nutrition_log`. **Eerste geval in
  dit project waarbij data stil verloren gaat**, in plaats van zichtbaar
  verkeerd wordt gepresenteerd. Volledige analyse, fix en verificatie in
  sectie 9.

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
  - ✅ **Opgelost (12 augustus).** Gewicht heeft nu een eigen tabel
    (`weight_log`) en wordt via de chat gelogd — zie de bouwgeschiedenis in
    `voeding-app-volledige-documentatie.md`. Dit monitoringpunt is daarmee
    afgerond; de vaststelling hierboven over het eiwitdoel blijft staan als
    referentie, want die verandert niet mee met het gewicht.

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
  - **Sinds 13 augustus: categorie `vaste_gewoonte`.** Vijf rijen zijn bewust
    geseed vanuit `prompt.ts` (zie §6) — deze zien er bij een noise-check
    "stabieler"/ouder uit dan een net geleerd feit omdat ze niet uit één
    gesprek zijn afgeleid. Dat is geen ruis-signaal op zich; beoordeel ze op
    dezelfde drie criteria als elk ander feit, niet op hoe "vers" ze aanvoelen.

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

Also: when you change a file under _shared/, identify EVERY function that
bundles it and redeploy all of them — then diff all of them, not just the
ones you deployed. A correct file on disk that never reached one of its
functions is invisible to a diff scoped to what you deployed.
```

### Tweede faalvorm (13 augustus): de niet-gedeployde functie

**De afspraak hierboven bestond al en heeft dit niet gevangen — daarom apart
benoemd.**

Op 12 augustus werd een gewicht-uitsluiting toegevoegd aan
`_shared/summary.ts`, dat door **twee** functies gebundeld wordt. Er werd
gerapporteerd dat beide byte-gedift waren, maar in werkelijkheid had alleen
`close-day-cron` de fix gekregen; `coach-chat` draaide nog de versie ervóór.
Omdat de handmatige dagafsluiting ("sluit de dag af" in de chat) juist via
`coach-chat` loopt, lekte het gewicht daar gewoon door.

**Waarom dit een andere fout is dan het hertypte-payload-probleem:** de
bestandsinhoud op schijf was volledig correct. Er was niets beschadigd. Wat
faalde was de deploy-en-verificatiestap zelf — en de bestaande diff-afspraak
kán dit per definitie niet vangen, want die vergelijkt alleen wat er
gedeployed is. Een functie die had moeten worden bijgewerkt maar overgeslagen
werd, valt buiten het blikveld.

**Voorgestelde mechanische oplossing (uitgewerkt, nog niet gebouwd):** zie
sectie 8, "Vervolgtaak 1".

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

## 5. Staande afspraak — gedragsregels gelden niet automatisch voor de dagafsluiting

**Vastgelegd 12 augustus, gevonden tijdens de bouw van de gewichtsfeature.**

De dagafsluiting draait een **eigen model met een eigen prompt** uit
`_shared/summary.ts` — die kent `coach-chat`'s `PERSONA_PROMPT` niet. Een
gedragsregel die in `prompt.ts` wordt toegevoegd, geldt daar dus níet.

**Hoe dit concreet misging:** de regel "noem gewicht nooit uit jezelf" werd
netjes in `coach-chat` gezet en werkte daar ook. Maar het
dagafsluitingsmodel wist er niets van en verwerkte een weging gewoon in het
aandachtspunt voor de volgende dag — waarmee het gewicht alsnog dagelijks in
beeld zou komen en het hele "registreren, niet tonen"-principe stilletjes
ondergraven werd. Gevonden tijdens verificatie, gefixt met een expliciete
uitsluiting in `summary.ts`.

**Waarom dit een staand risico is:** niets waarschuwt hiervoor. De twee
prompts staan los van elkaar, er is geen gedeelde basis en geen check die
signaleert dat een regel maar op één plek staat. Elke volgende "de coach mag
X nooit noemen"-regel loopt dezelfde fout in als er niet actief aan gedacht
wordt.

**Let op:** `_shared/summary.ts` wordt gebundeld in **zowel `coach-chat` als
`close-day-cron`** — beide moeten opnieuw gedeployed worden bij een wijziging
daar.

**Onderstaand blok opnemen in elke CC-prompt die een gedragsregel toevoegt of
wijzigt:**

```
## Prompt rule propagation (required)

Any behavioural rule of the form "the coach should never mention X" or
"the coach should always say Y" must be applied in BOTH places:

1. coach-chat's PERSONA_PROMPT (prompt.ts) — the conversational model
2. _shared/summary.ts — the day-close model, which runs its own separate
   prompt and does NOT inherit PERSONA_PROMPT

This has already caused a real bug: a "never mention weight" rule was
added to coach-chat only, and the day-close model happily summarised a
weigh-in into the next day's aandachtspunt.

Note that _shared/summary.ts is bundled into both coach-chat and
close-day-cron — changing it means redeploying both functions.

Verify the rule holds in both paths before treating the change as done:
test it in conversation AND trigger a day-close.
```

---

## 6. Bevinding — hardcoded voorkeuren voelen als een sjabloon

**⚠️ Deels opgelost (13 augustus) — migratie geslaagd, herkadering niet
effectief gebleken.** Elke regel in "Vaste voorkeuren" en "Bekende vaste
producten" is geclassificeerd als Schattingskennis / Gewoonte / Beide, met
een aparte flag voor absolute regels (alcohol) en voor gewoontes met een
asymmetrisch faalrisico (ontbijt onderweg, plantaardig/Alpro — bij beide
bleek het risico van stil verdwijnen groter dan het risico van een
sjabloonmatige suggestie, dus die blijven hardcoded, alleen herschreven als
randvoorwaarde/open categorie in plaats van gewoonte-beschrijving).

Vijf gewoontes zijn gemigreerd naar `coach_memory` onder een nieuwe categorie
**`vaste_gewoonte`** (baseline-gewoontes, bewust geseed, niet live geleerd —
zie de addendum in `PERSONA_PROMPT`'s "Langetermijngeheugen"-sectie voor hoe
dit verschilt van een gewoon `gewoonte`-feit): de energiedip rond 15:00, de
kwark+ei-voor-het-slapen-pairing (het productfeit zelf — kwark bevat caseïne
— bleef apart hardcoded, alleen losgekoppeld van "voor het slapen"), nuchter
trainen, de lichte snack vóór training, en de shake-dan-maaltijd-volgorde na
training. Dit deel is structureel geslaagd: getest door de coach te vertellen
dat de kwark+ei-gewoonte verleden tijd is → hij riep `memory_update` aan op
precies de juiste geseede rij, geen conflicterende tweede rij, geen genegeerd
verzoek.

**De herkadering ("## Achtergrond, geen menu"-sectie + no-repeat-regel) hield
in de praktijk niet stand.** Twee tests, beide met "wat kan ik voor het
slapen eten?":
- **Sterke case** (gisteren expliciet gemarkeerd als "kwark met ei gegeten,
  zoals gebruikelijk"): coach stelde opnieuw kwark+ei voor, met de tekst "Dit
  is jouw vaste avondroutine en werkt goed" — een expliciete herhaling, niet
  een gemiste kans om het te zien, maar een bewuste keuze om de gewoonte te
  bevestigen in plaats van te variëren.
- **Zwakke case** (twee losse, verse gesprekken, geen enkel signaal over
  kwark/ei/shake in de zichtbare dagafsluitingen): beide keren onafhankelijk
  "Kwark met ei" als suggestie.

Beide cases faalden, inclusief de case die de instructie het makkelijkst zou
moeten kunnen vangen. De promptinstructie leunt volledig op het model dat
'm volgt, en dat bleek hier niet voldoende: het productfeit (kwark = eiwitrijk
+ caseïne) en de `vaste_gewoonte`-herinnering blijven zo dominant in de
context dat de "varieer"-instructie er niet tegenop weegt. Dit is een reëel,
niet-opgelost restpunt — het oorspronkelijke sjabloon-probleem (dezelfde
avondsuggestie, ongeacht de dag) bestaat na deze wijziging nog steeds. Enige
verandering: het is nu tenminste corrigeerbaar via de chat (zie hierboven),
wat vóór deze wijziging niet kon.

**Volgende stap, nog niet uitgevoerd:** een instructie alleen volstaat niet;
dit vraagt vermoedelijk een structurele aanpak (bv. de laatste N suggesties
expliciet in de context meegeven in plaats van impliciet uit dagsamenvattingen
laten afleiden), vergelijkbaar met hoe `eiwitTotaal`/`calorieTotaal` al als
berekende waarden worden meegegeven in plaats van aan het model overgelaten.
Niet uitgewerkt in deze sessie.

**Beperking van die volgende stap, vooraf al zichtbaar:** dit lost hooguit de
sterke case op. De zwakke case had helemaal geen signaal nodig om te falen —
twee onafhankelijke, verse gesprekken zonder enige vermelding van kwark/ei/
shake kwamen allebei zelfstandig op "Kwark met ei" uit. Er was dus niets om
expliciet door te geven dat het verschil zou hebben gemaakt; de trek komt uit
de inhoud zelf (het productfeit + de `vaste_gewoonte`-herinnering), niet uit
het model dat een herhaling niet opmerkt. Een "laatste N suggesties"-context
zou de sterke case dichten, maar de zwakke case vraagt om iets anders —
vermoedelijk een andere aanpak dan meer/betere context, nog te bepalen.

**Origineel, ter referentie:**

De vaste voorkeuren staan **hardcoded in de system prompt** (`prompt.ts`), niet
in `coach_memory`. Dat was een bewuste keuze uit het oorspronkelijke ontwerp —
`coach_memory` kwam pas later, voor wat de coach *tijdens* gesprekken leert.

**Het probleem in de praktijk:** "voor het slapen: vaak kwark + ei" gaat bij
élk gesprek mee, ongeacht de dag of het onderwerp. Daardoor komt het elke dag
terug als suggestie, wat sjabloonmatig aanvoelt — de coach put uit een vast
lijstje in plaats van te kijken wat er die dag past.

**De onderliggende spanning:** deze regels doen twee dingen tegelijk, en die
vragen om verschillende behandeling.
1. **Als schattingshulp** zijn ze nuttig — "een bakje kwark" hoeft dan geen
   navraag, de coach weet welk product bedoeld wordt.
2. **Als suggestiebron** worden ze een sjabloon — het lijstje wordt de default
   in plaats van een van de mogelijkheden.

**Tweede probleem: ze zijn niet corrigeerbaar via de chat.** De coach kan
alleen `coach_memory`-rijen bijwerken of intrekken. Zeg je "ik eet geen kwark
meer voor het slapen", dan gebeurt er waarschijnlijk één van twee dingen: hij
slaat een `coach_memory`-feit op dat de hardcoded regel tegenspreekt (twee
bronnen die botsen, zonder dat iets bewaakt welke wint), of hij slaat niets op
omdat het op een tijdelijke stemming lijkt — en blijft het gewoon voorstellen.
Wijzigen kan alleen via `prompt.ts` + een nieuwe deploy.

**Zelfde categorie als de `summary.ts`-bevinding hierboven:** informatie die op
meerdere plekken kan leven zonder dat iets bewaakt dat ze overeenkomen.

**Mogelijke richtingen (nog niet uitgewerkt, geen keuze gemaakt):**
- De voorkeuren splitsen naar hun functie: productkennis (voor schatten) blijft
  hardcoded, gewoontes (voor suggesties) verhuizen naar `coach_memory` zodat ze
  via de chat aanpasbaar worden
- De prompt-instructie aanscherpen: vaste producten zijn *achtergrondkennis*,
  geen voorstellenlijst — alleen noemen als het gesprek er echt om vraagt
- Variatie afdwingen: niet twee dagen achter elkaar dezelfde avondsuggestie
- Combinatie van bovenstaande

Te bespreken voordat er een CC-prompt van gemaakt wordt.

---

## 7. Featureideeën (fase 2, nog niet uitgewerkt of gepland)

Losse ideeën, nog niet in blokken opgedeeld en nog niet ontwerpmatig
uitgedacht (geen calorieën-regels, triggers, of tool-mechanismen bepaald
zoals bij blok 5) — dat is werk voor wanneer een van deze opgepakt wordt.

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

- **Systeemprompt wordt bij élk bericht volledig opnieuw verstuurd.**
  **Gevonden 14 augustus** tijdens het meten van context-omvang voor sectie 9
  (de "lange thread"-hypothese voor de 23:07-bug). De ~5.000-token
  systeemprompt (PERSONA_PROMPT + dynamische context) is vrijwel constant per
  dag, maar wordt bij elke request opnieuw meegestuurd — een dag met 14
  beurten verstuurt zo'n ~70.000 systeemprompt-tokens, tegenover slechts
  ~6.700 tokens aan incrementele threadgroei over diezelfde dag. Kosten/
  snelheidskwestie, geen correctheidsprobleem — niet onderzocht op een
  oplossing (bv. prompt caching), puur genoteerd als bevinding uit de meting.

---

## 8. Vervolgtaken — uitgewerkt, bewust nog niet gebouwd

Beide zijn tijdens ander werk onderzocht en voorgesteld, maar apart gehouden
omdat ze te groot waren om erbij te doen. Hier staat genoeg detail om er een
CC-prompt van te maken zonder de oorspronkelijke sessie terug te lezen.

### Vervolgtaak 1 — bundel-afgeleide deploy-verificatie

**Aanleiding:** de niet-gedeployde-functie fout uit sectie 3. De bestaande
diff-afspraak vergelijkt alleen wat er gedeployed is, en kan een overgeslagen
functie dus per definitie niet zien.

**Waarom "beter opletten" hier niet volstaat:** de afspraak bestond al en de
verificatie werd ook gerapporteerd als uitgevoerd. Wat ontbrak was niet de
zorgvuldigheid maar een controle die niet afhangt van een correct mentaal
model van "welke functies bundelen dit bestand".

**Voorgestelde opzet (vier stappen):**
1. Voor elke functiemap onder `supabase/functions/*`: parse recursief de
   relatieve imports van `index.ts` (`from '../_shared/X.ts'`,
   `from './Y.ts'`) om de werkelijke bundelset af te leiden. Dit vervangt
   meteen de handmatig onderhouden bestandslijsten in de ad-hoc
   deploy-scripts, die hun eigen driftrisico hebben (een nieuw geïmporteerd
   shared-bestand dat niemand aan de lijst toevoegt).
2. Haal per functie de live gedeployde bestanden op via `get_edge_function`.
3. Byte-diff live tegen schijf voor élk bestand in de afgeleide bundel, voor
   **élke** functie — niet afhankelijk van welke functies je denkt te hebben
   aangeraakt.
4. Rapporteer per functie geslaagd/gefaald, met vermelding van welk bestand
   precies afwijkt.

Stap 3 is de kern: onvoorwaardelijk over alle functies draaien maakt het
ongevoelig voor een onvolledig beeld van de afhankelijkheden. Was dit na de
`summary.ts`-wijziging één keer gedraaid, dan was `coach-chat` er direct
uitgerold.

**Omvang:** echt werk (import-parsing, niet alleen een diff-loop), vandaar
apart.

### Vervolgtaak 2 — transcript-filtering om gewichtslekkage structureel te blokkeren

**Het probleem, scherp geformuleerd:** bij calorieën bestaat een *structurele*
barrière — `calorieTotaal` is een apart berekend getal dat de prompt simpelweg
kan weglaten. Bij gewicht bestaat die niet. Het getal zit in het ruwe
gespreks-transcript (`buildTranscript` in `coach-chat/tools.ts`), dat het
dagafsluitingsmodel integraal leest, inclusief "ik weeg 111,1" en de
bevestiging erop.

**Gevolg:** de uitsluitingsinstructie in de prompt is op dit moment de
*enige* verdediging. Dat is zwakker dan het calorie-precedent waar de
gewichtsfeature op gemodelleerd is, en het is de reden dat deze vervolgtaak
meer is dan een verbetering-voor-later: één instructie die niet aankomt (zoals
op 12 augustus letterlijk gebeurde) betekent direct een lek.

**Wat onderzocht is:** identificeer assistent-beurten met een
`weight_log_add`/`_update` tool-call, en sluit die beurt plus het uitlokkende
gebruikersbericht uit vóórdat het transcript gebouwd wordt.

**Waarom dat niet zomaar werkt:** een gebruikersbericht kan gewicht mengen met
andere inhoud — "ik weeg 111,1 en heb net ontbeten". Op berichtniveau
wegfilteren betekent dan dat de maaltijdvermelding óók verdwijnt. Er is dus
een fijnmaziger aanpak nodig dan bericht-granulariteit, en dat is precies wat
deze taak moet uitzoeken.

**Raakt de dagafsluitingsflow** (`coach-chat/tools.ts`,
`close_day_summary`-afhandeling) — daarom apart gehouden.

---

## 9. Bevinding — coach beweert te loggen zonder te loggen, én noemt verouderde totalen

**✅ Opgelost (14 augustus).** Drie delen, elk met een eigen aanpak:

1. **Verouderd dagtotaal (probleem 2) — structureel gefixt.**
   `nutrition_log_add`/`_update`/`_delete` geven nu een vers herberekend
   `eiwitTotaal`/`calorieTotaal` terug in het tool-resultaat (`computeDayTotals`
   in `tools.ts`), en `PERSONA_PROMPT` instrueert de coach om ALTIJD dat
   teruggegeven getal te gebruiken voor de lopende-totaal-bevestiging, nooit
   het contexttotaal plus een eigen optelling. Dit sluit de dubbeltelling
   structureel af — er is geen stale snapshot meer om per ongeluk bovenop te
   tellen.
2. **Stil wegvallende tool-call (probleem 1) — twee losse detectiemechanismen,
   verschillend qua risico.** Sub-mechanisme A (een write die wél is
   aangeroepen maar het dagtotaal niet veranderde) krijgt één automatische
   herkansing — veilig, want het herhaalt een actie die al is gevraagd.
   Sub-mechanisme B (de tekst noemt een eiwitgetal, maar er is helemaal geen
   nutrition_log_add/_update aangeroepen — de daadwerkelijke 13-augustus-vorm)
   krijgt bewust GEEN herkansing met tool-toegang: een foutieve trigger zou
   dan een ongevraagde rij kunnen wegschrijven, en een fantoom-maaltijd die
   het dagtotaal ophoogt en er legitiem uitziet is erger dan een zichtbaar
   ontbrekende. B voegt alleen een vaste, deterministische disclaimerzin toe
   — nooit een tool-call. Geverifieerd met een echte "vals-positieve" vraag
   ("hoeveel eiwit zit er in een ei?") — de disclaimer verscheen, er kwam geen
   rij bij.
3. **Verzonnen oorzaak (probleem 3) — prompt-instructie.** De coach mag nooit
   meer een verklaring verzinnen voor een mislukte actie (geen "technisch
   hikje" meer) — bij een tool-resultaat met een `error`-veld moet hij dat
   eerlijk erkennen, verder niets.

**Reproductie getest en bevestigd gefixt** — de exacte 13-augustus-vorm
(overzichtsvraag + nieuwe maaltijd in hetzelfde bericht) is herhaald tegen
zowel een korte als een deliberately lange thread (87 berichten, om de
oorspronkelijke omstandigheid na te bootsen): in beide gevallen bestond de rij
en klopte het genoemde totaal exact met `SUM(eiwitten_g)`. Volledige
verificatie-uitkomsten (8 gevallen, inclusief een whole-run reconciliatie die
bevestigt dat geen van beide detectiemechanismen zelf een fantoomrij
veroorzaakte) in de sessie van 14 augustus.

**Onderzoek naar de "lange thread"-hypothese: uitgesloten, niet open
gelaten.** Zie de meting hieronder — het volledige verzoek (systeemprompt +
context + thread) blijft op de zwaarste realistische dag rond de 5.400 tokens,
twee ordegroottes onder een moderne Claude-contextvenster. Context-venster-
afkapping is dus geen aannemelijke directe verklaring voor de 23:07-fout. De
werkelijke, apart genoteerde bevinding: niet de thread-omvang, maar het
opnieuw versturen van de volledige (~5.000 token) systeemprompt bij élk
bericht domineert het datavolume over een dag heen (~70.000 tokens/dag bij 14
beurten, tegenover ~6.700 tokens aan incrementele thread-hertransmissie) —
een kosten/snelheidskwestie, geen correctheidskwestie, genoteerd als los
vervolgpunt in sectie 7, niet opgepakt in deze taak.

**Gevonden 13 augustus, 23:07, in dagelijks gebruik. Twee problemen in één
antwoord — het tweede is het ernstigst.**

### Wat er gebeurde

Bij een overzichtsvraag laat op de avond toonde de coach een lijst van negen
items, waaronder als laatste "Net — Hamburger (50g brood, 160g runder patty):
39g". Daarbij schreef hij: *"Totaal: 171g eiwit (nog niet bijgewerkt met de
laatste hamburger in de tellerweergave hierboven, maar in het systeem staat
het nu op ~186g na deze toevoeging)."*

Controle in de database wees uit:
- Er staan **7 rijen** voor 13-08, samen **132g** — niet 9 items en niet 171g
- De hamburger **staat er helemaal niet in**, op geen enkele datum, met geen
  enkele omschrijving
- Ook het plakje kaas (18:45, 7g) uit de lijst ontbreekt

### Probleem 1 (ernstig): de coach beweerde te loggen, maar deed het niet

De hamburger uit de getoonde lijst bestond niet in `nutrition_log`. De coach
presenteerde 'm als gelogd — inclusief tijdstip en eiwitwaarde — terwijl de
tool-call niet is uitgevoerd.

**De tijdlijn, want die is veelzeggend:**

| Tijd | Gebeurtenis |
|---|---|
| 23:06 | Gebruiker meldt de burger |
| 23:07 | Coach toont overzicht mét burger in de lijst — **maar logt niet** |
| 23:12 | Gebruiker vraagt te checken → nu logt hij wél, in één keer goed |
| 23:13 | Coach verzint een oorzaak ("technisch hikje") |

**Het patroon: het ging mis bij een overzichtsvraag, niet bij gewoon loggen.**
Diezelfde dag waren zeven maaltijden probleemloos gelogd. En toen er expliciet
om gevraagd werd (23:12), werkte het meteen. Het verschil bij 23:07: de coach
moest tegelijk een lange, opgemaakte lijst produceren én een tool aanroepen.
De tekst kwam er wel, de tool-call niet — maar de tekst beschreef 'm alsof hij
er wel was.

Dat het foute dagtotaal (186 i.p.v. 171, met een dubbeltelling) in datzelfde
bericht zat, versterkt het beeld: het model was op dat moment vooral aan het
*vertellen*, niet aan het *doen*.

**Concreet aanknopingspunt voor onderzoek:** kijk of tool-calls vaker wegvallen
wanneer er in dezelfde beurt een lange gestructureerde tekst gegenereerd wordt
(overzichten, opsommingen, samenvattingen) — in tegenstelling tot een korte
bevestiging na een gewone log. Als dat zo is, is de mitigatie mogelijk om
loggen en overzicht-genereren niet in dezelfde beurt te laten samenvallen.

**Waarom dit zwaarder weegt dan andere bevindingen deze week:** juist bij een
lang overzichtsbericht controleer je mínder — het ziet er compleet en verzorgd
uit. En het risico is het grootst laat op de avond, vlak vóór de afsluiting,
wanneer correctie niet meer lukt. Op 13 augustus was er vijf minuten speling;
was de vraag om 23:28 gesteld, dan was de dag afgesloten met een totaal dat
39g te laag was, zonder enig signaal dat er iets miste.

**Nog uit te zoeken:** faalde de tool-call, werd hij niet aangeroepen, of werd
hij aangeroepen na het schrijven van het antwoord? Ook checken of dit vaker is
gebeurd — een steekproef over eerdere dagen waarbij de chat-lijst tegen de
database wordt gelegd.

### Probleem 3: de coach verzint oorzaken voor eigen fouten

Gevraagd waarom het niet gelogd was, antwoordde de coach: *"dat kwam door een
technisch hikje net toen ik reageerde op je vraag naar het overzicht."*

Dat is gefabriceerd. Het model heeft geen enkele toegang tot informatie over
waarom een eerdere tool-call niet is uitgevoerd — het construeert een
plausibel klinkende verklaring. De wáárneming klopte ("de log-actie is er niet
doorheen gekomen"), de oorzaak niet.

**Waarom dit los vermeld wordt:** een verzonnen oorzaak die geloofwaardig
klinkt, maakt het minder waarschijnlijk dat je verder kijkt — "technisch
hikje" klinkt als iets incidenteels dat vanzelf voorbijgaat. Hier hoort de
coach te zeggen dat hij niet kan zien wat er misging. Kandidaat voor een
prompt-regel, met de kanttekening uit sectie 6 dat instructies het kunnen
verliezen van wat het model denkt te weten.

### Probleem 2: het lopende totaal komt uit een momentopname van vóór de tool-calls

`buildDynamicContext()` draait **één keer**, aan het begin van de request. Alles
wat daarna in dezelfde beurt gelogd wordt, zit niet in dat getal. De coach
werkt dus met een totaal van vóór zijn eigen logacties.

In dit geval leidde dat tot drie verschillende getallen in één bericht: 171
(optelling van de getoonde lijst), ~186 (een schatting), en 132 (de
werkelijkheid). De coach merkte de discrepantie zelf op en probeerde 'm te
verklaren — maar de 186 was een gok: het lijkt 147 + 39, waarbij de
kippendij-maaltijd dubbel geteld is.

**Structureel gezien** is dit dezelfde klasse als het probleem uit blok 3b
(calorietotaal dat telkens anders uitviel omdat het uit omschrijvingen werd
herberekend). Het verschil: dáár was de oplossing een echte `SUM`; hier is het
getal wél berekend, maar op het verkeerde moment.

**Mogelijke richtingen (nog niet uitgewerkt):**
- Het lopende totaal opnieuw ophalen ná de tool-loop, vóór het finale antwoord
- Of: het totaal meegeven als tool-resultaat bij `nutrition_log_add`, zodat de
  coach het bijgewerkte getal terugkrijgt op het moment dat hij logt
- Of: de coach instrueren nooit een dagtotaal te noemen in dezelfde beurt
  waarin hij logt — zwakste optie, en na de ervaring met de
  voorkeuren-herkadering (sectie 6) is duidelijk dat een instructie het kan
  verliezen van wat het model zelf denkt te weten

### Nasleep: het foute getal plantte zich voort naar de dagafsluiting

De dagafsluiting van 13-08 (23:33) schreef **172g** in `eiwit_totaal` — correct,
want dat is een echte `SUM`. Maar de samenvattingstékst noemde **~187g**: het
model nam de 186 uit het chatgesprek over en telde er het ijsje van 23:32 bij
op.

Dus de fout uit één chatbericht belandde in de permanente samenvatting van de
dag, die vervolgens weer als context meegaat naar volgende dagen. De kolom
klopt, de tekst niet — en bij het terugkijken is de tekst wat je leest.

### Waarom deze problemen samen erger zijn dan apart

Probleem 2 alleen geeft een verwarrend maar corrigeerbaar getal. Probleem 1
alleen geeft ontbrekende data. Probleem 3 zorgt ervoor dat je stopt met
zoeken. Samen vertelt de chat een consistent ogend verhaal dat niet klopt met
de database, mét een geruststellende verklaring erbij — en heeft de gebruiker
geen enkele aanwijzing welk getal te vertrouwen.

**Prioriteit:** probleem 1 hoort boven aan de lijst. Dit is de eerste bevinding
in deze app waarbij data stil verloren gaat in plaats van verkeerd
gepresenteerd wordt. Alle eerdere bevindingen deze week (lekkend gewicht,
sjabloonsuggesties, genegeerd aandachtspunt) waren zichtbaar zodra je keek;
deze niet.

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
