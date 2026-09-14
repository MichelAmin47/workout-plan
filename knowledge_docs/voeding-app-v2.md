# Voeding App — v2

Openstaande bevindingen, features en beslissingen. Alle blokken van de eerste
bouwfase (1 t/m 9) zijn gebouwd en live.

**Dit document is op 1 september 2026 gesplitst.** Het was 3131 regels geworden
en ruim een derde ging over afgerond werk, waardoor "wat staat er nog open?"
niet meer te beantwoorden was zonder alles door te lezen. De verdeling nu:

| Document | Inhoud |
|---|---|
| `voeding-app-v2.md` (dit) | Alles wat openstaat of nog beslist moet worden |
| `voeding-app-afspraken.md` | De vier staande afspraken (§3, §4, §5, §12) — de blokken die letterlijk in CC-prompts gaan |
| `voeding-app-archief.md` | Afgeronde bevindingen, ongewijzigd en met dezelfde nummers |
| `voeding-app-datachecks.md` | Vaste leesqueries op de database, met interpretatie per check |
| `voeding-app-volledige-documentatie.md` | Bouw- en testgeschiedenis van fase 1 |

**Sectienummers zijn nergens hernummerd.** Ze worden overal in de documentatie
genoemd, dus §14 blijft §14, ook nu die in het archief staat.

---

## Statusoverzicht

Bijgewerkt 11 september 2026.

### ⬜ Openstaand

| § | Onderwerp | Stand |
|---|---|---|
| 1 | Vier testpunten uit blok 4 | Nooit afgevinkt, geen bekend probleem |
| 1 | `hasNotableSignal`-tak op signaalloze dag | Half beantwoord; `v: 3` legt de kaarttekst nu vast |
| 2 | Draait de dagafsluitcron op de bedoelde lokale tijd? | Te toetsen tegen de crondefinitie |
| 2 | `coach_memory` op ruis controleren | Gedaan 2 en 11 sept; één fout feit gevonden en gecorrigeerd (§25) |
| 6 | Sjabloonmatige suggesties | Migratie geslaagd, herkadering niet; geen richting |
| 8 | Vervolgtaak 2 — transcript-filtering gewichtslek | Onderzocht, niet gebouwd |
| 15b | Vraagdetectie mist 2 van de 3 aandachtspunten | **Volgende taak**; gestructureerde vlag i.p.v. regex |
| 16 | Meer zien tijdens het laden van de ochtendkaart | Uitgedacht, geen CC-prompt |
| 19a | Antwoordopties worden afgekeurd op `label_te_lang` | Labels worden gelogd sinds 8 sept; ~3 datapunten nodig |
| 20 | Dev-omgeving schrijft naar productie | Vier voorvallen; geen richting gekozen |
| 20a | Onvolledige `files`-array voorkomen | Zichtbaar gemaakt, niet voorkomen |
| 21a | Gereconstrueerde dagen zijn niet ijkbaar | Heuristiek gemeten zwakker dan aangenomen; drempel niet verdedigbaar |
| 23 | Weging niet als onbetrouwbaar te markeren | Ontwerpvraag over incomplete weken eerst |

### ⚙️ Uitgedacht, klaar om op te pakken

| § | Onderwerp | Voorwaarde vooraf |
|---|---|---|
| 7 | Eiwitspreiding over de dag | Alleen §21a nog; datavenster is gehaald |
| 7 | Hydratie fase A | CC-prompt staat klaar in de bijlage |
| 7 | Coach-header opfrissen | Puur visueel |
| 7 | Systeemprompt wordt bij elk bericht opnieuw verstuurd | Kosten, geen correctheid |
| 17 | Eiwit schatten uit een foto | Kalibratiemeting eerst |

### ✅ Afgerond — volledige tekst in `voeding-app-archief.md`

| § | Onderwerp | Opgelost |
|---|---|---|
| 8 | Vervolgtaak 1 — bundel-afgeleide deploy-verificatie | 27 aug |
| 9 | Coach beweert te loggen zonder te loggen | 14 aug, `coach-chat` v26 |
| 10 | Check-in kaart: niet-getoetste overname + verkeerde knoppen | 17 aug, `morning-checkin` v4 |
| 11 | Dagafsluiting schakelt te snel door | 19 aug, client-side |
| 13 | Check-in gemist door netwerk-hik | 18 aug |
| 14 | Check-in trigger faalt op "gisteren getraind" | 25 aug, v5 |
| 15 | Aandachtspunt noemt verkeerd relatief dagwoord | 25 aug, prompt-only |
| 18 | Check-in-kaart niet te controleren | 26 aug, v10 + `checkin_diag` |
| 19 | Keuzevraag krijgt geen antwoordknoppen | 27 aug, v11 |
| 21 | Nachtelijke maaltijden sorteren vooraan | 31 aug, `_shared/today.ts` |
| 22 | Twee tellers in de Coach-header | 28 aug, `coach-chat` v30 |

**Ook afgerond, maar met een openstaande staart:** §19 → §19a, §21 → §21a. Die
staarten staan hieronder in volle lengte; de opgeloste helft in het archief.

Deze zijn gebouwd maar staan **nog wél volledig in dit document**, omdat er
metingen aan vasthangen die nog moeten gebeuren:

| § | Onderwerp | Gebouwd | Waarom nog hier |
|---|---|---|---|
| 15a | Aandachtspunt-filter: annoteren i.p.v. droppen | 2 sept | Effect gemeten, oorzaak nog open |
| 19a | `v: 3`, plus labellogging | 2 en 8 sept | Meetinstrument; ~3 datapunten nodig |
| 24 | Promptregel tegen Engelse bezitsvorm | 8 sept | Effect nog niet waargenomen |
| 25 | `coach_memory` naar de ochtendkaart | 11 sept | Eén testaanroep; nog geen echte kaart |

### Stand van de ontwikkeling — 11 september 2026

**Vier deploys op `morning-checkin` in tien dagen, alle vier één functie,
byte-gedift, verificatiescript exitcode 0:**

| Datum | Versie | Wat |
|---|---|---|
| 2 sept | — | §15a annoteren i.p.v. droppen + §19a `v: 3` (vraagtekst en kaarttekst) |
| 8 sept | — | §19a labellogging + §24 promptregel tegen Engelse bezitsvorm |
| 11 sept | v20 | §25 `coach_memory` naar de ochtendkaart + donderdagblok ontdubbeld |

Daarnaast op 11 september buiten de code om: een **fout feit in `coach_memory`**
gecorrigeerd via de chat (Power Hour was beschreven als een boksles). Zie §25.

**Wat er in tien dagen boven water kwam.** Drie van de vier deploys komen voort
uit iets wat vóór 2 september niet zichtbaar was, omdat de kaarttekst nergens
bewaard werd. §19a bleek omgekeerd te liggen (het model lévert antwoordopties,
de validatie keurt ze af), §24 was een taalfout in de zichtbare tekst, en §25
kwam boven doordat de kaart zichzelf binnen één scherm tegensprak.

**Wat nu openstaat, in volgorde:**

| Prioriteit | Onderwerp | Stand |
|---|---|---|
| 1 | §19a labelmeting | Loopt; ~1 datapunt per week, 3 nodig |
| 2 | §24 taalregel | Effect nog niet waargenomen op een echte kaart |
| 3 | §15b vraagdetectie | Blijft waar, maar minder blokkerend dan gedacht |
| 4 | §3 derde faalvorm | Deploydiscipline lekt op de kopieerstap — zie `voeding-app-afspraken.md` |

De eiwitspreiding (§7) is qua data niet meer geblokkeerd; alleen §21a moet nog
bijgesteld met de gemeten verdeling.

*Scope: dit document gaat alleen over de voeding-app. Workout-app en
trainingsschema's worden elders geregeld.*

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
- ⬜ **`hasNotableSignal`-tak van de ochtendkaart op een écht signaalloze dag**
  (toegevoegd 25 augustus bij punt 14). De tak die een vlakke opening en
  `vraag_type: "geen"` afdwingt wanneer er niets noemenswaardigs is, kon niet
  live met een echte modelcall getest worden. Alleen mechanisch geverifieerd
  dat de instructie in de gedeployde prompt zit — niet wat het model ermee
  doet.

  **Waarom dit lastig te plannen is:** in het standaardschema bestaat er geen
  signaalloze dag. Rustdagen vallen alleen op dinsdag (Anti-zit) en zaterdag
  (Vrije dag), en beide worden voorafgegaan door een trainingsdag (maandag
  resp. vrijdag), dus "gisteren getraind" vuurt. Donderdag vuurt op zichzelf
  (Power Hour). De tak is dus alleen bereikbaar als een override **twee
  rustdagen achter elkaar** oplevert — dat is toeval, geen wekelijks moment.
  *(Let op: vrijdag 28-08 is hiervoor géén geschikte dag, ondanks een eerdere
  inschatting — week 35 heeft alleen overrides op maandag en woensdag, dus
  vrijdag valt terug op het standaardschema en is daar een trainingsdag,
  Schouders.)*

  **Aanbevolen aanpak:** bewust uitlokken met een tijdelijke rust-override op
  een dag ná een rustdag, kaart één keer laten genereren, override daarna
  terugzetten — hetzelfde patroon als bij de 08-23-reproductie (origineel
  vastleggen, herstellen, verifiëren).

  **Wat te beoordelen:** leest de kaart als een normale rustige opening zonder
  gezochte trainingsverwijzing, en staat er géén vraag met antwoordpillen
  onder (`questionType` = `'geen'`/`none`).

  **⚠️ Half beantwoord, per ongeluk (vastgesteld 31 augustus).** Er staan twee
  `checkin_diag`-rijen op 28-08 om 15:29 (lokaal, één seconde uit elkaar) met
  **`hasNotableSignal: false`** — de tak waarvan hierboven staat dat hij niet te
  plannen was. Ze komen uit de dev-app tijdens de bouw van §22, en de reden dat
  alle vier de condities op false staan terwijl de ochtendrij van diezelfde dag
  `vandaagTrainingsdag: true` heeft, is dat de trainingsdag ná de ochtendkaart
  handmatig naar een rustdag is omgezet. De resolutie las dus gewoon de nieuwe
  stand — geen bug, en een bevestiging dat er nergens gecachet wordt.

  **Wat dit wél oplost:** de tak is een keer met een echte modelcall gedraaid en
  het model gaf `vraag_type: "geen"` terug, precies zoals bedoeld. Dat deel
  hoeft niet meer uitgelokt te worden.

  **Wat dit níet oplost:** of de kaart*tekst* vlak was zonder gezochte
  trainingsverwijzing. `checkin_diag` slaat de tekst niet op, dus dat blijft
  onbeantwoord — zelfde observatiegat als in §19 hieronder, en dezelfde
  oplossing (tekst meelogggen) zou beide dichten.

- ✅ **Verschijnen er nog wél vragen op signaaldagen? — AFGEROND (31 augustus),
  het vermoeden houdt geen stand.** Zie de uitkomst onderaan dit blok; de
  observaties hieronder blijven staan omdat ze laten zien hoe de hypothese zich
  ontwikkelde. (Los aandachtspunt,
  25 augustus.) De "niets bijzonders"-regel dwingt `vraag_type: "geen"` af
  zónder signaal, maar dwingt omgekeerd geen vraag af mét signaal. Op 25-08
  (rustdag ná training) kwam er een inhoudelijk correcte kaart zonder vraag —
  op zichzelf verdedigbaar. Worden kaarten echter structureel mededelingen in
  plaats van vragen, dan trekt de nieuwe regel breder dan bedoeld. Eén
  observatie zegt nog niets; een week meekijken volstaat.

  **Observatie 2 van 7 — woensdag 26-08, 08:09.** Opnieuw een kaart zónder
  vraag, nu op een trainingsdag (Rug & Biceps). Daarmee twee dagen op rij, op
  twee verschillende takken: 25-08 was rustdag-ná-training, 26-08 is
  trainingsdag-ná-rustdag. In beide gevallen stond `hasNotableSignal` op true,
  dus de vlakke-openingstak is níet de verklaring. Het model kiest zelf om
  niets te vragen, binnen de vrijheid die het heeft. Nog steeds geen bewijs —
  wel het patroon dat je zou zien als de "niets bijzonders"-regel breder
  resoneert dan de conditie waaronder hij hoort te gelden.

  **Aangescherpt 26 augustus, na de instrumentatie uit §18.** De eerste
  `checkin_diag`-rij toont `hasNotableSignal: true` mét `vraag_type: "geen"`.
  Daarmee is één van de twee kandidaat-bugs uitgesloten: er komt géén vraag
  terug die niet rendert — het model kiest zelf om niets te vragen. De
  observatie is dus niet langer "stelt hij een vraag die verdwijnt", maar
  **"stelt hij te weinig vragen"**, en dat is een promptvraag, geen renderbug.

  **Wat de reeks nu moet uitwijzen:** hoe vaak `vraag_type` op `"geen"` staat
  terwijl `hasNotableSignal` true is. Dat is voortaan direct te tellen in
  `checkin_diag` in plaats van af te lezen van kaarten. De reeks begint bij
  **27-08**; de rij van 26-08 is een verificatie-invocatie (10:04 lokaal, ná de
  v10-deploy) en niet de kaart die die ochtend getoond is. Let bij het
  beoordelen ook op **ontbrekende datums** — zie §18.

  **Observatie 3 — donderdag 27-08.** Hier stelde de coach wél een vraag:
  `vraag_type: "anders"`, bij twee actieve signalen (`gisterenGetraind: true`,
  `vandaagPowerHour: true`) én een doorgekomen aandachtspunt
  (`gedroptReden: null`). Dat verzwakt het vermoeden dat de "niets
  bijzonders"-regel breed doorlekt: op een dag met veel signaal komt er gewoon
  een vraag. De reeks blijft lopen, maar de hypothese verschuift naar "hoeveel
  signaal is er nodig" in plaats van "de regel lekt".

  Nog vast te leggen: bij de twee dagen zonder vraag was er telkens één signaal
  actief (`vandaagTrainingsdag`), bij de dag mét vraag drie. Als dat patroon
  aanhoudt, is dit geen bug maar een kalibratievraag over de drempel.

  **Observatie 4 — vrijdag 28-08.** Opnieuw `vraag_type: "geen"`. Stand: drie
  dagen zonder vraag, één met. Dit is tevens de eerste rij met `payload.v: 2`
  (zie §19); `antwoordOpties` staat terecht op `nvt` met nul aangeboden, want
  zonder vraag zijn er geen opties te leveren. Oude `v: 1`- en nieuwe
  `v: 2`-rijen staan zonder migratie naast elkaar, zoals ontworpen.

  **Observaties 5 t/m 7 en de uitkomst (uitgelezen 31 augustus).** De reeks is
  in één keer uit `checkin_diag` opgehaald in plaats van van kaarten afgelezen —
  precies waarvoor §18 gebouwd is. Alle vijf de echte ochtendrijen hadden
  `hasNotableSignal: true` en `modelOk: true`:

  | Datum | `vraag_type` |
  |---|---|
  | do 27-08 | `anders` |
  | vr 28-08 | `geen` |
  | za 29-08 | `anders` |
  | zo 30-08 | `stemming` |
  | ma 31-08 | `geen` |

  **Drie van de vijf mét vraag.** Het vermoeden dat de "niets bijzonders"-regel
  breder resoneert dan zijn conditie, houdt daarmee geen stand. De stand van
  observatie 4 ("drie zonder, één met") was een momentopname die de verkeerde
  kant op wees; de dagen erna draaiden het beeld om. Dit is normale variatie in
  modeloordeel, geen bug en ook geen kalibratievraag over een drempel.

  **Geen ontbrekende datums** tussen 27-08 en 31-08 — de controle waar §18 om
  vraagt, uitgevoerd en schoon. De functie draait dus elke dag zoals bedoeld
  sinds de poort in §14 verdween.

  **Waarom dit hier stopt en niet doorloopt tot zeven observaties.** De vraag
  was of er een patroon zichtbaar werd dat op een lekkende regel wees. Dat
  patroon is er niet, en drie extra dagen gaan dat niet veranderen. Doorgaan zou
  betekenen dat de reeks bestaat omdat hij bestaat.

  **Correctie op een detail hierboven:** de rij van 26-08 staat in de database
  op **09:10:11 UTC** (11:10 lokaal), niet op 08:04 UTC / 10:04 lokaal zoals
  §18 en de tekst hierboven vermelden. De conclusie verandert niet — het blijft
  een verificatie-invocatie ná de v10-deploy en geen observatiedatum — maar het
  getal in de documentatie klopte niet met de data.

  **Kleine drift tussen documentatie en implementatie:** de vierde conditie heet
  in de payload `aandachtspuntGeeftSignaal`, terwijl de CC-prompt in §18
  `aandachtspuntAanwezig` voorschreef als vaste sleutelnaam. Geen functioneel
  gevolg, wel het soort afwijking dat bij een volgende uitlezing verwarring
  geeft als niemand het opgeschreven heeft.

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

- **Draait de dagafsluit-cron op de bedoelde lokale tijd?** In de function-logs
  van 26-08 staat een `POST | 200` op `close-day-cron` om **01:00:02 UTC**, wat
  in zomertijd 03:00 lokaal is — terwijl in dit document consequent van een
  02:00-cron gesproken wordt. Waarschijnlijk is de cron in UTC ingesteld en
  klopte 02:00 in wintertijd; dan schuift hij elk zomerseizoen een uur op.
  Geen bekend probleem (de dag is dan toch al lang voorbij), maar wel het
  soort stille tijdzone-afwijking dat later verwarring geeft bij het
  reconstrueren van afsluitmomenten. Zie ook §12 over UTC vs. lokaal.
  Te verifiëren tegen de daadwerkelijke cron-definitie, niet aannemen.

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

### Praktijkobservaties (14 augustus) — één bevestiging, één verbreding

**De migratiewinst is bevestigd in echt gebruik.** De gebruiker gaf aan
's avonds geen kwark meer te eten ("te zwaar, niet lekker, red het doel ook
zonder"). De coach werkte de juiste geseede rij bij — geen tweede rij, geen
genegeerd verzoek — en verwerkte in dezelfde rij ook een vervolgnuance uit het
gesprek erna: *"Meestal pakt hij 's avonds nog wel gewoon een gekookt ei als
lichte aanvulling, per dag wisselend."* Reden én nuance zijn dus meegenomen.
Ook het gesprek zelf verliep goed: geen aandringen, wel een open vraag naar wat
er dan wél past, geen alternatievenlijstje. Vóór de migratie was dit
structureel onmogelijk.

**Maar de faalmodus is breder dan de tests lieten zien.** De verificatie ging
over expliciete suggestievragen. In dagelijks gebruik kwam het ook
**ongevraagd** langs, midden in een gewoon bevestigingsbericht:

> *"...en straks nog ruimte voor een shake of je vaste kwark+ei, ligt dat doel
> prima binnen bereik."*

Twee dingen daaraan:
- Het was niet gevraagd — het lekt dus ook in bevestigingen, waar je er veel
  minder op let dan bij een suggestievraag
- De formulering *"je vaste kwark+ei"* is precies de framing die de herkadering
  moest wegnemen: niet "een optie" maar "wat jij doet"

Verzachtend: het werd genoemd als één van twee opties en paste bij de situatie
(training om 20u, doel nog niet gehaald). Minder sjabloonmatig dan een kale
"neem kwark met ei", maar de trek naar het bekende patroon is onmiskenbaar.

*Let op bij het beoordelen of dit ooit opgelost is:* het kwark-voorbeeld is
inmiddels uitgezet, dus dit specifieke geval keert niet terug. Dat zegt niets
over het onderliggende patroon — bij een volgende gewoonte (snack vooraf,
shake na training) kan hetzelfde gebeuren, en dan zonder dat er een eerdere
klacht ligt om het aan te herkennen.

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

  > ⚠️ **Deze meting valt vóór de tijdstip-fix van 22-08 en is geen geldige
  > nulmeting.** De cijfers hieronder bevatten deels het *logmoment* in plaats
  > van het *eetmoment* (zie de datumgrens verderop in dit blok). Bewaard als
  > aanleiding en richting, niet als referentiewaarde — opnieuw meten op data
  > vanaf 22-08 vóór er advies op gebaseerd wordt.

  | Dagdeel | Gemiddeld per dag | Aandeel |
  |---|---|---|
  | Voor 11:00 | ~9g | 5% |
  | 11:00-15:00 | ~49g | 28% |
  | 15:00-18:00 | ~19g | 11% |
  | Vanaf 18:00 | ~100g | 57% |

  Vanaf 21:00 alleen al komt gemiddeld 42g binnen — meer dan de hele ochtend
  en namiddag samen. Het eerste log van de dag ligt op zes van de zeven dagen
  tussen 10:30 en 13:14. *(Dat laatste cijfer is juist het meest verdacht: het
  "eerste log" was vóór 22-08 vaak het moment van loggen, niet van eten — op
  25-08 werd een ontbijt van 08:00 pas om 10:33 gelogd.)*

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
  Let op dat dit dezelfde grens raakt als de dagafsluiting/cron (die op
  `0 1 * * *` UTC staat = 03:00 lokaal in zomertijd, 02:00 in wintertijd) —
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

  ---

  ### Voorwaarde vooraf — `tijdstip` moet het eetmoment zijn, niet het logmoment ✅ OPGELOST (22 augustus, coach-chat v27 + v28)

  **Gevonden 22 augustus, vóór de bouw.** De hele spreidingsanalyse bucket
  eiwitten per tijdvak op basis van `nutrition_log.tijdstip`. Maar de
  systeemprompt vult dat veld met de **huidige klok** wanneer de gebruiker
  geen tijd noemt ("net gegeten"). Op kantoordagen wordt het ontbijt soms pas
  in de middag gelogd — dan komt 13:00 in de database te staan, niet 08:00.

  **Waarom dit de feature ondermijnt vóórdat hij bestaat:** ontbijt-eiwit
  verschuift dan systematisch van het ochtendvak naar het middagvak. De
  gemeten 9g vóór 11:00 en 49g in 11:00-15:00 kunnen dus deels een **artefact
  van het logmoment** zijn in plaats van het eetmoment. Dezelfde categorie
  fout als de middernacht-caveat hierboven, andere oorzaak — en hij duwt
  precies de kant op die het advies zou aansturen. Advies geven op basis van
  vertekende invoer is erger dan geen advies geven.

  **Gekozen oplossing:** de coach vraagt actief naar het eetmoment wanneer dat
  niet vanzelfsprekend is. Geen UI-wijziging, geen schemawijziging — past bij
  de bestaande chat-first opzet. (Alternatief — de gebruiker zelf altijd de
  tijd laten noemen — werkt technisch al, maar leunt volledig op zijn
  initiatief en is dus geen structurele oplossing.)

  **Belangrijke consequentie voor de planning:** dit repareert alleen data
  vanaf het moment dat het live staat. Bestaande rijen zijn niet met
  terugwerkende kracht te herstellen — hetzelfde argument als bij blok 3b
  (calorieën meeloggen), waar precies daarom niet gewacht werd. Daarom eerst
  dit, dan pas de spreidingsfeature bouwen op data die wél klopt.

  > ### ⚠️ Harde datumgrens voor de spreidingsanalyse: **vanaf 22-08-2026**
  >
  > `nutrition_log.tijdstip` is pas vanaf **22 augustus 2026** het werkelijke
  > **eetmoment**. Alles daarvóór bevat voor een deel het **logmoment** — en
  > dat verschuift structureel één kant op (later op de dag), dus het is geen
  > ruis die uitmiddelt maar een systematische bias precies in de richting
  > die het advies zou aansturen.
  >
  > **Elke query, analyse of feature die op `tijdstip` bucket, moet filteren
  > op `datum >= '2026-08-22'`.** Geen uitzonderingen voor "even snel een
  > indruk krijgen" — een vertekende indruk is hier erger dan geen indruk.
  >
  > De 7-daagse basismeting van 5-11 augustus in dit document valt dus
  > vóór de grens en is **niet bruikbaar als nulmeting**. De hoofdconclusie
  > (zwaartepunt na 18:00) blijft waarschijnlijk staan — logvertraging
  > verklaart geen 57% 's avonds — maar de exacte ochtend- en middagcijfers
  > moeten opnieuw gemeten worden op data ná de grens.
  >
  > *Eerste volledige venster van 7 schone dagen: vanaf 29 augustus 2026.*

  **Bevestigd in echt gebruik (24-25 augustus, anderhalve dag na livegang):**
  van 12 gelogde items hadden er 5 een reëel verschil tussen eetmoment en
  logmoment (+51 tot +154 minuten); de overige 7 waren binnen een minuut
  real-time gelogd, waar de coach terecht niets vroeg. Concreet effect: de
  eiwitshake van 24-08 (29g) is om 14:30 gedronken maar pas 16:42 gelogd —
  vóór deze fix was die in het vak 15:00-18:00 beland in plaats van
  11:00-15:00. Precies de vertekening waar het om ging. Ook de
  middernachtgrens werkt: iets om 23:59 gegeten en 00:10 gelogd kwam correct
  onder datum 24-08 terecht.

  **Uitgevoerd 22 augustus — in twee stappen, beide richtingen afgedekt.**

  **v27 — vooruit (vragen vóór het loggen).** De regel staat in de
  `tijdstip`-veldbeschrijving binnen het schema van `nutrition_log_add`, niet
  in het persona-blok — het inmiddels drie keer bewezen point-of-use patroon
  (calorietotaal-annotatie, maaltijdlijst-regel, nu deze). De coach gebruikt
  een genoemde tijd of een duidelijk "net/zojuist" direct zonder te vragen,
  en stelt één korte vraag bij een echt signaal van afwijking: een
  vroeger-moment-woord ("ontbijt", "lunch", "vanochtend", "tussen de
  middag") tegen een klok die daar ruim voorbij is, of meerdere maaltijden in
  één bericht.

  *Propagatie gecontroleerd, niet aangenomen:* volledige read van
  `_shared/summary.ts` bevestigt dat die de regel niet nodig heeft — hij
  SELECT'eert `tijdstip` alleen uit al gelogde rijen om het transcript op te
  bouwen, roept nooit `nutrition_log_add` aan en schrijft `tijdstip` nooit
  zelf, in geen van beide afsluitroutes. Daar dus niets gewijzigd.

  **v28 — achteraf (corrigeren nadat de rij bestaat).** Bij de verificatie van
  v27 bleek een gat: `nutrition_log_update` had geen `tijdstip`-parameter, dus
  een tijd die pas ná het loggen ter sprake kwam ("dat ontbijt was trouwens om
  8 uur") was onherstelbaar. Optionele `tijdstip` toegevoegd aan schema én
  handler, meeliftend op de bestaande partial-patch vorm — geen
  herstructurering. Vooraf geverifieerd dat de handler écht een partial patch
  bouwt (`tools.ts:235-244`) en dat de maaltijdcontext per rij al zowel `id`
  als `tijdstip` toont (`prompt.ts:331`), zodat de coach weet waarnaar hij
  verwijst en waarvandaan hij corrigeert.

  **Verificatie (live, tegen de echt gedeployde functie):** expliciete tijd →
  direct gebruikt zonder vraag; "net gegeten" → huidige klok, geen vraag;
  "mijn ontbijt was…" om 13:xx → coach vraagt, antwoord "rond half 8" wordt
  07:30; twee maaltijden in één bericht → één vraag, apart opgeslagen als
  07:00 en 12:30. Voor v28: tijd-alleen correctie wijzigt `tijdstip` en laat
  omschrijving/eiwitten/calorieën ongemoeid; een portiecorrectie zonder
  tijdvermelding laat `tijdstip` exact staan (het grootste regressierisico);
  beide in één bericht landen samen; dag-SUM 90,6g/745kcal vóór én na een
  tijd-alleen correctie — ongewijzigd. Regressietest bevestigt dat de
  v27-vraaglogica intact bleef, dus de twee schema's in dezelfde array zijn
  niet gaan interfereren.

  Beide keren gedeployed met alle 7 gebundelde bestanden vers van schijf
  gelezen en byte-diff geverifieerd. Testdata na afloop volledig verwijderd,
  `nutrition_log` teruggebracht naar de echte staat, geen `coach_sessions`- of
  `coach_memory`-rijen achtergebleven.

  **Bekende grens (geaccepteerd):** de maaltijdcontext bevat alleen de rijen
  van vandáág mét `id`. Een fout tijdstip dat pas de volgende dag opvalt, kan
  de coach dus niet meer corrigeren. Geen bug, wel een grens om te kennen —
  correcties moeten dezelfde dag gebeuren.

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

- **Chat-inputveld groeit niet mee met lange tekst.** ✅ **OPGELOST (19
  augustus, client-only).** `<input type="text">` vervangen door
  `<textarea rows={1}>` met een `useEffect` die de hoogte eerst terugzet naar
  `'auto'` en daarna op `scrollHeight` zet bij elke wijziging — die
  reset-eerst-stap is wat het veld ook laat *krimpen*, niet alleen groeien.
  CSS (`max-height: 30vh; overflow-y: auto; resize: none`) is de echte cap;
  JS voedt alleen de natuurlijke inhoudshoogte. `.input-bar` ging van
  `align-items: center` naar `flex-end` zodat de verzendknop onderaan blijft
  zitten terwijl het veld omhoog groeit.

  **Enter-gedrag, bewust gekozen:** Enter verstuurt nog steeds (geen breuk
  met bestaande gewoonte), Shift+Enter voegt een nieuwe regel toe — standaard
  chat-UI-conventie (WhatsApp/Slack/ChatGPT), en noodzakelijk omdat een
  groeiend veld anders alleen via automatisch afbreken kon groeien.

  Geverifieerd op desktop én een mobiele viewport (390×844): 42px
  basishoogte bij korte tekst, soepel groeien bij lange/meerregelige tekst
  zonder de berichtenlijst te verdringen, exacte clamp op 30vh met interne
  scroll (414px inhoud vs. 216px gerenderd), krimpt terug bij verwijderen,
  Shift+Enter/Enter werken zoals besloten, geen layout-problemen op smalle
  breedte. Build-verificatie bevestigt de fix in de bundel. Geen Edge
  Function geraakt.

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

### Vervolgtaak 1 — bundel-afgeleide deploy-verificatie ✅ GEBOUWD (27 augustus)

Gebouwd als `supabase/scripts/verify-edge-function-bundles.ts`. Leidt de
bundelset per functie af uit de importgraaf in plaats van uit een handmatige
lijst, en vergelijkt onvoorwaardelijk élke functie tegen een verse snapshot van
productie. De staande afspraak om het na elke deploy te draaien staat in
`voeding-app-afspraken.md`; de bouwgeschiedenis en de gemeten basislijn in
`voeding-app-archief.md`.

---

## 15a. Bevinding — het aandachtspunt-filter kijkt naar trefwoorden, niet naar dagtypes ✅ GEMETEN EN GEREPAREERD (26 augustus gevonden, 2 september gefixt)

**Gevonden door `morning-checkin/index.ts:126-133` te lezen**, tijdens het werk
aan punt 18. Punt 15 beschrijft het symptoom (een verkeerd relatief dagwoord op
de kaart); dit is het mechanisme eronder, en het is iets anders dan iedereen
aannam.

**Wat `aandachtspuntDayTypeMismatch` werkelijk doet.** Het vergelijkt *niet*
gisterens dagtype met dat van vandaag. Het scant de aandachtspunt-tékst met twee
regexes: `train(t|en)?|training|sessie|workout` → `assumesTraining`, en
`rustdag` → `assumesRest`. Alleen als die uit de tekst afgeleide aanname botst
met het opgeloste dagtype van vandaag, valt de notitie weg.

**Twee faalvormen, allebei uit echte data:**

- **Vals-negatief (22-08).** De boksles-notitie van 21-08 bevatte geen enkel
  trefwoord — "de boksles" matcht niets — dus het filter vuurde nooit en de
  notitie kwam ongefilterd op een rustdagkaart terecht. Dít is waarom punt 15
  kon gebeuren; de reconstructie daar klopte, maar de reden was niet bekend.
- **Vals-positief (26-08).** Het aandachtspunt van 25-08 bevat "op de rustdag
  van dinsdag" → `assumesRest` → gedropt omdat vandaag een trainingsdag is. Maar
  die notitie *beschrijft* dinsdag, ze *veronderstelt* niets over vandaag. Het
  inzicht erin (eiwitdoel gehaald via veel kleine momenten onderweg, werkt goed
  op drukke autodagen) is juist dagtype-onafhankelijk en had prima door mogen
  komen.

**De onderliggende fout:** het filter verwart *"noemt een rustdag"* met *"gaat
ervan uit dat het vandaag een rustdag is"*. Trefwoorden in vrije tekst kunnen dat
onderscheid niet dragen.

**Hoe erg is dit?** Niet zichtbaar, en dat is het probleem. Bij een onterechte
drop verschijnt er gewoon een kaart met het generieke daganker — er is geen
foutmelding en geen leeg vlak. Zonder `checkin_diag` (punt 18) was dit ook niet
meetbaar geweest. Hoe váák het misgaat is nu een empirische vraag: de velden
`ruwAanwezig` / `effectiefAanwezig` / `gedroptReden` beantwoorden hem over de
observatieperiode.

**Richting voor een fix — bewust nog niet gebouwd.** Meer regexes toevoegen
verergert het: elk extra trefwoord vergroot de kans op vals-positieven zoals
26-08. De structurele route staat al in §7 en geldt hier ook: het
dagafsluitmodel de gebeurtenis-datum als **gestructureerd veld** laten meegeven,
in plaats van achteraf proza terugscannen. Dan hoeft er niets geraden te worden
uit tekst. Dat raakt de dagafsluitingsflow en is dus een echt blok werk, geen
patch.

**Volgorde:** eerst meten met `checkin_diag`. Blijkt het zelden mis te gaan, dan
is dit een documentatiepunt en geen bouwtaak. Blijkt het vaak mis te gaan, dan is
de meting meteen de onderbouwing voor het grotere blok. Niet nu bouwen op één
vals-positief en één vals-negatief.

### Uitkomst van de meting — vaker mis dan gedacht, maar goedkoper dan gedacht (2 september)

Over de zeven gemeten dagen (26-08 t/m 01-09) sloeg het filter **drie keer** toe:
26-08 (`verwacht_rust`), 31-08 en 01-09 (beide `verwacht_training`). Ruim 40%.

**De twee nieuwe vals-positieven, met de tekst erbij.** Beide gaan over de
boksles, die buiten het formele schema valt:

- **31-08.** Het aandachtspunt van 30-08 kondigt de boksles van maandagavond aan
  met concreet advies (overdag normaal eten, niet nuchter). Het schema noemt
  maandag geen trainingsdag, dus het filter zag tegenspraak waar die niet was.
  Grensgeval: het schema kent de activiteit niet.
- **01-09.** Het aandachtspunt van 31-08 zegt **letterlijk** *"dinsdag is een
  kantoordag zonder training"* en werd gedropt wegens het veronderstellen van
  training. Het filter matchte op "boksles" in de terugblik en las de ontkenning
  in dezelfde zin niet. Geen grensgeval maar een regelrechte fout, en niet op te
  lossen met een betere trefwoordlijst.

**Wat de drops níet gekost hebben, tegen de verwachting in.** Op alle drie de
dagen bevatte de **ruwe** tekst geen vraag, dus `aandachtspuntGeeftSignaal` was
ook zonder filter op `false` uitgekomen. Het filter heeft dus **nul vragen**
gekost. Wat het wél kostte is concreet, bruikbaar advies dat niet op de kaart
kwam — dat is genoeg reden om het te repareren, maar het is een kleinere schade
dan aanvankelijk vermoed. Zie §15b: de echte kosten zaten ergens anders.

### De fix — annoteren in plaats van droppen ✅ GEBOUWD (2 september, `morning-checkin`)

`aandachtspuntDropReason` verdwijnt. Het aandachtspunt gaat voortaan **altijd**
mee naar het model, samen met het opgeloste dagtype van vandaag en een instructie
om die twee zelf te verzoenen. Het risico waarvoor het filter ooit bedoeld was
blijft afgedekt, alleen door het model in plaats van door een regex.

Dat is dezelfde keuze als hierboven al werd voorgesteld ("niet meer regexes"),
maar goedkoper dan de daar geschetste route: het model kríjgt het dagtype al in
dezelfde prompt, dus er hoeft geen gestructureerd veld door de
dagafsluitingsflow gebouwd te worden. Wijziging blijft binnen
`morning-checkin/index.ts`, dus één functie deployen.

`gedroptReden` en `effectiefAanwezig` blijven in de payload staan en worden
voortaan altijd `null` respectievelijk gelijk aan `ruwAanwezig`. Bewust niet
verwijderd: de historische rijen gebruiken ze en het schema blijft zo stabiel.

**Meegenomen in dezelfde deploy:** de ontkoppeling van het signaal (het
signaal wordt nu aantoonbaar op de ruwe tekst berekend, met een commentaarcontract
op beide rekenplekken dat dit nooit door een gefilterde variabele vervangen mag
worden) en `v: 3` uit §19a.

**Verificatie.** Payload via script vers van schijf, byte-diff identiek,
verificatiescript exitcode 0 voor alle drie de functies. Live aangeroepen tegen
de gedeployde functie: `v: 3`, `vraagTekst` null passend bij `vraag_type: "geen"`,
`kaart` gevuld en veld-voor-veld gelijk aan het HTTP-antwoord, `gedroptReden`
null, `effectiefAanwezig` gelijk aan `ruwAanwezig`. Testrij op vooraf
vastgelegde id verwijderd; de id-set van 02-09 daarna aantoonbaar terug bij de
uitgangsstand van één echte rij. Onafhankelijk nagerekend via `execute_sql`.

**Wat bewust níet geclaimd wordt.** Deze fix is niet aangetoond de vragen terug
te brengen — de causale keten die dat zou verklaren is weerlegd (zie de meting
hierboven). Gebouwd omdat het een echte onderdrukkingsbug is, niet omdat het
bewezen iets herstelt.

**Eerste tegenbewijs, dezelfde dag.** De echte ochtendkaart van 02-09 (nog
`v: 2`, want van vóór de deploy) had het aandachtspunt aanwezig, niets
gefilterd, `hasNotableSignal: true` uit de trainingscondities — en tóch
`vraag_type: "geen"`. Vierde dag op rij zonder vraag, en de eerste waarop geen
van beide verdachten iets verklaart. Dat versterkt §15b en wijst verder door
naar de schrijfkant.

---

## 15b. Bevinding — de vraagdetectie mist twee van de drie aandachtspunten ⬜ OPENSTAAND (2 september, volgende taak)

**Gevonden bij het onderzoek naar §15a**, en het bleek groter dan de bevinding
waar het onderzoek over ging.

`aandachtspuntGeeftSignaal` is de enige conditie in `hasNotableSignal` die niet
uit het trainingsschema komt. De andere drie (gisteren getraind, vandaag
trainingsdag, vandaag Power Hour) zijn kalenderfeiten. **Dit is dus de enige plek
waar inhoud het signaal binnenkomt.**

De implementatie (`morning-checkin/index.ts:117-120`):

```ts
function aandachtspuntHasQuestion(text: string | null): boolean {
  if (!text) return false
  return /\?/.test(text) || /\bvraag\b/i.test(text)
}
```

Alleen een letterlijk vraagteken, of het losse woord "vraag".

### De meting — over alle 28 dagen

| | Dagen | Aandeel |
|---|---|---|
| Matcht de regex (`?` of `vraag`) | 5 van 28 | **18%** |
| Bevat werkelijk vraagintentie (ook `navragen`, `check of`, `peil`, `informeer`) | 15 van 28 | **54%** |

**Twee van de drie aandachtspunten met een echte vraag worden gemist.** Twee
concrete voorbeelden uit de reeks:

- 26-08: *"navragen of dat late eetmoment op trainingsavonden goed bevalt of dat
  het eten iets naar voren kan"* — onmiskenbaar een vraag, geen match. `navragen`
  bevat het token `vragen`, niet `vraag`, en de woordgrens ontbreekt sowieso.
- 27-08: *"Check of de eetmomenten weer op normale tijden liggen"* — ander
  werkwoord, geen match.

Dit zijn geen gekunstelde randgevallen maar de gewone Nederlandse manier om een
indirecte vraag op te schrijven.

### Waarom dit de grotere bron is

| Oorzaak | Frequentie | Gekoste vragen |
|---|---|---|
| Het filter uit §15a | 3 van 7 dagen | **0** |
| Deze detector | mist 10 van de 15 dagen met vraagintentie | structureel |

Het filter is het kleine probleem, deze detector het grote. Dat is precies
omgekeerd aan de volgorde waarin ze gevonden zijn.

### Richting — geen bredere regex

Het verbreden van het patroon verplaatst het probleem alleen. Nederlands heeft
te veel manieren om indirect iets te vragen, en elk extra trefwoord vergroot de
kans op vals-positieven — dezelfde val als in §15a.

De route die wél sluit staat al in een comment in het bestand zelf
(`morning-checkin/index.ts:113-116`): **het dagafsluitmodel een gestructureerde
vlag laten meeschrijven** bij het aandachtspunt, zodat het model dat de tekst
formuleert ook aangeeft of er iets na te vragen valt. Geen terugscannen van
proza.

**Kosten:** dit raakt de tool-schema van `_shared/summary.ts`, dus alle drie de
Edge Functions moeten opnieuw gedeployed en byte-gedift worden. Duurder dan de
fix van §15a, die binnen één functie bleef.

### Volgorde — bewust ná de fix van §15a

Niet meebouwen in dezelfde deploy. Dan verander je filterlogica, payload en
signaaldetectie tegelijk, en weet je achteraf niet waardoor de kaarten beter
werden. Bovendien is `v: 3` (§19a) juist het instrument om déze fix mee te
beoordelen, en dat instrument moet er eerst zijn.

### Losse observatie om in de gaten te houden

De laatste drie aandachtspunten (30-08, 31-08, 01-09) bevatten **helemaal geen**
vraagintentie, ook niet in de brede zin. Dat is de langste reeks in de hele
historie van 28 dagen. Bij drie dagen kan dat toeval zijn. Houdt het aan ná de
fixen hierboven, dan ligt de oorzaak bij het afsluitmodel dat de aandachtspunten
schrijft, en niet bij de ochtendkaart die ze leest.

---

## 16. Wens — meer zien tijdens het laden van de ochtendkaart ⬜ OPENSTAAND (uitgedacht, nog geen CC-prompt)

**Gevraagd 24 augustus.** Bij het openen van de app 's ochtends duurt het even
voordat de check-in kaart verschijnt. Niet storend, maar als enige gebruiker
is er geen bezwaar tegen meer informatie tijdens het wachten dan alleen een
spinner.

**Eerst de aanname gecorrigeerd — het model praat niet met de database.**
`morning-checkin` is bewust een geïsoleerde functie met één *gedwongen*
tool-call, geen gesprekslus, geen andere tools. De volgorde is: de Edge
Function haalt zelf eerst alle data op (dagtype-resolutie via
`schemas`/`week_overrides`/`completed_days`, aandachtspunt uit
`coach_sessions`, eiwitvoortgang uit `nutrition_log`), bouwt daarmee de
prompt, en doet dán één modelcall. De DB-queries zijn milliseconden;
**vrijwel de hele wachttijd is die ene modelcall.** Zichtbaar in het
timeoutbudget: 8s per poging, 1,5s pauze vóór de retry — worst case ~17,5s
voordat er teruggevallen wordt op het sjabloon.

**Waarom echte stapsgewijze voortgang niet gratis is.** Het is één request en
één response; de client kan niet zien wat er ín de functie gebeurt. Stappen
tonen zoals "trainingsdata ophalen… coach schrijft…" vraagt streaming (SSE)
vanuit de Edge Function — een reëel stuk werk, geen tekstwijziging.

**Bewust afgevallen: nepstappen op een timer.** De goedkope variant is die
stappen client-side afspelen op een timer. Afgeraden en niet gekozen: dan
tonen we labels die informatief ogen maar niets meten. Dezelfde categorie als
de al gedocumenteerde bevinding waarbij de coach een plausibel klinkende
oorzaak verzon voor zijn eigen fout — het ziet eruit als informatie en is het
niet. In een app waar het vertrouwen in de getallen het hele punt is, is dat
een slechte ruil voor wat visuele geruststelling.

**Gekozen richting — alleen tonen wat werkelijk bekend is:**
1. **Echte client-side status.** De client wéét of dit poging 1 of de retry
   is, en of de timeout verlopen is. "Poging 2 van 2…" is echte informatie,
   geen decor.
2. **Meelopende secondenteller** bij één eerlijk label ("Coach stelt je
   ochtendkaart samen… 4s"). Geeft gevoel voor traag versus vastgelopen.
3. **Timingregel achteraf onder de kaart.** De functie geeft mee hoeveel tijd
   de DB-fase en de modelcall kostten ("DB 140ms · model 4,2s"). Voor één
   gebruiker die wil zien wat er gebeurt waarschijnlijk het nuttigst: je ziet
   direct of een trage ochtend aan het model lag of aan iets anders.

Punt 3 vraagt een kleine wijziging aan de Edge Function (timings meesturen in
de response); 1 en 2 zijn puur client-side. Ze kunnen los van elkaar gebouwd
worden.

**Afhankelijkheid:** dit raakt dezelfde functie als punt 14 (elke dag een
check-in). Punt 14 eerst afronden, anders worden twee wijzigingen aan
`morning-checkin` door elkaar geverifieerd. Na punt 14 draait de functie
bovendien élke dag, waardoor de laadtijd elke ochtend zichtbaar wordt in
plaats van alleen op triggerdagen — wat deze wens juist relevanter maakt.


---

## 17. Feature — eiwit schatten uit een foto ⚙️ UITGEDACHT (26 augustus, nog geen CC-prompt gegeven)

**Aanleiding, uit dagelijks gebruik.** Buiten de deur eten — bij familie, op
kantoor — betekent geen weegschaal en geen verpakking met een etiket. De
gebruiker geeft aan zelf slecht te zijn in schatten. Op die momenten wordt er
óf niet gelogd, óf gelogd met een getal waarvan niemand weet hoe ver het
ernaast zit. Beide ondermijnen het dagtotaal, en het tweede stilletjes.

---

### De kernbevinding: identificatie ≠ portiegrootte

Dit onderscheid bepaalt het hele ontwerp.

**Wat goed gaat:** herkennen *wat* er op het bord ligt. Kip, rijst, saus,
aantal stukken vlees, welke componenten er zijn. Hier is een foto duidelijk
beter dan een schatting uit het hoofd.

**Wat niet goed gaat:** hoevéél er ligt. De Claude-documentatie noemt
ruimtelijk redeneren en het tellen van objecten expliciet als benaderend, en
een gewichtsschatting uit een 2D-foto is precies zo'n taak — er is geen
dieptedata. Reken op grofweg 20-40% afwijking op de hoeveelheid, groter bij
gelaagde of gemengde gerechten (stamppot, ovenschotel, saus over rijst).

**Waarom dat hier toch werkbaar is.** De vergelijking is niet "foto versus
weegschaal", maar "foto versus een schatting waarvan de gebruiker zelf zegt
dat hij er slecht in is". Bovendien valt de fout op eiwit gunstiger uit dan op
calorieën: eiwit zit geconcentreerd in één identificeerbaar component (het
vlees, de vis, de kwark), en dáárvan is de portie beter in te schatten dan van
olie of saus. 30% ernaast op een kipfilet is ~8-10g eiwit — onder de
~15g-drempel die dit project al hanteert als grens voor doorvragen.

### Twee foto's: onderzocht, bewust afgevallen

Overwogen om een tweede foto (zijaanzicht) mee te sturen voor diepte-inschatting.
Meerdere afbeeldingen worden gezamenlijk geanalyseerd in één verzoek, maar dat
is **geen stereovisie** — er wordt geen dispariteit berekend en geen 3D
gereconstrueerd. De winst komt puur uit het feit dat een zijaanzicht toont wat
een bovenaanzicht verbergt, en die winst haal je grotendeels al binnen met één
goed gekozen schuine foto.

**Doorslaggevend tegenargument:** meer beeld levert vrijwel zeker meer
*stelligheid* op, niet automatisch meer nauwkeurigheid. Het model kan niet
merken dat het nog steeds gokt, en de gebruiker aan tafel ook niet. Precies het
patroon uit sectie 9, waar juist het uitgebreide, verzorgde bericht het minst
gecontroleerd werd.

*Besluit: één foto. Instructie in de prompt om schuin te fotograferen met een
maatreferentie in beeld (hand, vork, standaard bord) — dat scheelt meer dan een
tweede opname.*

---

### Voorwaarde vooraf — kalibratiemeting (dóén vóór de bouw)

Zelfde patroon als de `tijdstip`-fix: niet aannemen dat het beter is, maar het
faalpatroon zichtbaar maken vóór er advies of data op gebouwd wordt.

**Opzet:** 5 tot 10 maaltijden thuis, waar de weegschaal wél beschikbaar is.
Weeg het eiwitcomponent, maak één schuine foto, laat de coach schatten, noteer
beide. Geen code nodig — dit kan in een gewone chat.

**Wat je eruit wilt halen:**
- De typische afwijking in **gram eiwit**, niet in procenten — dat is de eenheid
  waarin de beslissing valt (boven of onder de 15g-drempel).
- Of de afwijking **systematisch één kant op** gaat. Structurele onderschatting
  is erger dan ruis, want die middelt niet uit over een week.
- Of de gebruiker de bandbreedte in de praktijk vertrouwt of alsnog gaat
  corrigeren.

**Afbreekcriterium, vooraf vastleggen:** wijkt de schatting structureel meer dan
~20g eiwit af op normale maaltijden, dan is dit geen feature maar een bron van
stille fouten en gaat hij niet door.

---

### Ontwerpkeuzes

#### 1. Een foto logt nooit direct

De coach doet een voorstel, de gebruiker bevestigt, dan pas de
`nutrition_log_add`. Dit volgt de bestaande regel "alleen loggen wat al gegeten
is", en er is hier een extra reden: **een foto wordt bijna altijd vóór het eten
gemaakt.** Wat op het bord ligt is niet automatisch wat er naar binnen is
gegaan.

De doorvraag die er werkelijk toe doet is dus niet "hoeveel gram denk je" maar
**"heb je het opgekregen?"** — dat weet de gebruiker wél zonder weegschaal, en
het beweegt het getal meer dan een portieverfijning.

#### 2. Geen schijnprecisie

"180g kip, 42g eiwit" uit een foto suggereert een meting die er niet is. Zelfde
categorie als de verzonnen oorzaak uit sectie 9: het ziet eruit als informatie
en is het niet.

**Regel:** in het gesprek een bandbreedte ("zo'n 35-45g eiwit"), in
`nutrition_log` het middelpunt. Eén getal in de database, want het dagtotaal
moet een `SUM` blijven — bandbreedtes optellen levert een bereik op waar niemand
iets aan heeft en dat de bestaande totaal-logica breekt.

#### 3. Nieuwe kolom `bron` op `nutrition_log`

Nullable tekstkolom, waarde `'foto'` bij een fotoschatting, leeg bij de rest.

**Waarom dit een schemawijziging waard is** terwijl de rest van deze feature
prompt-werk is: zonder markering zijn fotoschattingen onzichtbaar in
`nutrition_log`. Je kunt dan nooit achteraf vaststellen of ze systematisch
afwijken, en de eiwitspreidingsanalyse kan ze niet apart bekijken. Hetzelfde
argument als bij de datumgrens van 22-08 — je wilt kunnen filteren op
databetrouwbaarheid, en dat kan alleen als de herkomst is vastgelegd op het
moment van schrijven.

Een markering in het `omschrijving`-veld is het goedkope alternatief, maar dat
is vrije tekst die het model formuleert — dus niet betrouwbaar te queryen.

#### 4. Foto's worden niet bewaard

Afbeeldingen zijn ephemeral in het API-verzoek en worden na verwerking
verwijderd. Geen storage bucket, geen bewaartermijn, geen extra tabel.

**Geaccepteerde grens:** een schatting die er later verdacht uitziet, kun je niet
terugkijken. Dat is een reële beperking, maar een bucket + opruimbeleid is
substantieel meer werk dan de rest van deze feature bij elkaar. Herzien als de
kalibratiemeting aanleiding geeft.

---

### Technische aandachtspunten (te onderzoeken door CC, niet aannemen)

**A. De invoerknop — mogelijk zónder nieuwe APK.** Het voor de hand liggende
antwoord is de Capacitor Camera-plugin, maar dat is native laag: nieuwe
permissies, nieuwe APK-build, en daarmee ineens een heel ander soort traject
dan de rest van deze app. Een gewone `<input type="file" accept="image/*"
capture="environment">` in de webview opent op Android ook de camera en zou de
hele wijziging in de web-laag houden — dus live via Vercel, zonder installatie.

Of dat in déze Capacitor-webview betrouwbaar werkt, is niet iets om aan te
nemen; de file-chooser-afhandeling in een WebView is historisch een bron van
gedoe. Eerst uitzoeken, en pas de plugin-route kiezen als de eenvoudige route
aantoonbaar niet werkt.

**B. `buildTranscript` en de dagafsluiting — echt regressierisico.** Zodra een
gebruikersbericht een afbeelding bevat, is `content` geen string meer maar een
array van blokken. Elke plek die aanneemt dat er tekst staat, kan stil breken of
de tekst laten vallen — en de dagafsluiting is precies zo'n plek. Een
transcript dat een maaltijdvermelding kwijtraakt, geeft geen foutmelding; het
geeft een iets armere samenvatting die niemand als fout herkent.

Zelfde categorie als het punt uit sectie 5: `_shared/summary.ts` heeft zijn
eigen aannames en erft niets. Expliciet lezen en testen, in beide afsluitroutes.

**C. Threadopslag.** De opgeslagen chatthread overleeft een herstart. Een
base64-afbeelding daarin zetten laat die opslag ontploffen. Voorstel: alleen een
tekstmarkering bewaren ("📷 foto"), niet het beeld zelf.

**D. Formaat vóór verzenden.** Client-side verkleinen naar ~1,15 megapixel houdt
tokens en latency laag zonder relevant detailverlies bij een bordfoto.

**E. Propagatiecheck.** Nieuwe gedragsregels (bandbreedte, geen schijnprecisie)
horen in `prompt.ts` én — indien de dagafsluiting fotoschattingen kan noemen —
in `_shared/summary.ts`. Bewust bepalen, niet vergeten.

---

### Openstaand, te beslissen bij het plan

- Mag de coach uit zichzelf om een foto vragen wanneer een omschrijving vaag is
  en buitenshuis lijkt? Neiging: nee, dat wordt snel zeurderig — de gebruiker
  weet zelf wanneer hij de weegschaal mist.
- Wat gebeurt er bij een onherkenbare of te donkere foto? Moet expliciet
  afgevangen worden: één keer om een betere foto vragen, daarna terugvallen op
  de gewone gesprekschatting. Niet gokken op een slecht beeld.
- Telt een fotoschatting mee in de eiwitspreidingsanalyse, of wordt hij
  gefilterd? Beantwoordbaar zodra `bron` bestaat; niet nu beslissen.

---

### CC-prompt (nog niet gegeven)

```
Add photo-based protein estimation to the voeding-app (nutrition coach app).

START IN PLAN MODE. Investigate first, then present a concrete build plan for
review. Do not write or edit any code until the plan is approved.

## What this should do

The user often eats where they cannot weigh anything (at family, at the
office) and is not good at estimating portions. They should be able to attach
one photo of their plate to a chat message and have the coach identify the
components and propose a protein estimate.

Single photo only. A second photo was considered and deliberately rejected:
multiple images are analysed jointly but there is no stereo depth
reconstruction, so the added confidence would outrun the added accuracy.

## Behavioural rules (these are the point of the feature, not decoration)

1. A photo NEVER logs directly. The coach proposes, the user confirms, only
   then nutrition_log_add runs. A photo is usually taken BEFORE eating, so
   the single most valuable follow-up question is "did you finish it?" — not
   a portion refinement. Ask that one question, not a list.
2. No false precision. In conversation, give a RANGE ("roughly 35-45g
   protein"). Never state a gram weight of the food itself as if measured
   ("180g of chicken"). Store the midpoint as a single number in
   nutrition_log — the day total must remain a real SUM.
3. If the photo is unusable (too dark, unrecognisable), ask once for a better
   one, then fall back to normal conversational estimation. Do not guess from
   a bad image.
4. The coach does not proactively ask for photos.
5. Photos are not stored anywhere. No storage bucket, no retention.

## Schema change (one, deliberate)

Add a nullable text column `bron` to nutrition_log, set to 'foto' for
photo-derived rows and left null otherwise. Rationale: without it,
photo estimates are indistinguishable from weighed or well-known entries, so
their accuracy can never be audited afterwards and the planned
protein-distribution analysis cannot filter on data reliability. A marker
inside the free-text `omschrijving` field is not acceptable — that text is
model-written and not reliably queryable.

## Investigate before planning — do not assume

- INPUT CONTROL: prefer a plain `<input type="file" accept="image/*"
  capture="environment">` in the webview over the Capacitor Camera plugin. The
  plugin is native-layer work: new permissions, new APK build, a different
  kind of change than everything else in this app, which ships web-layer
  changes live via Vercel. Verify whether the simple file input actually works
  in this Capacitor WebView (file chooser handling in Android WebViews is
  historically fragile). Only propose the plugin route if you can show the
  simple one does not work.
- TRANSCRIPT REGRESSION: once a user message contains an image, its `content`
  is an array of blocks rather than a string. Read buildTranscript in
  coach-chat/tools.ts AND _shared/summary.ts in full and determine exactly
  what they do with a non-string content value. A transcript that silently
  drops the text alongside an image produces a poorer day summary with no
  error — the exact silent-failure class this project has been bitten by
  before. Test both day-close routes (manual and cron), not just one.
- THREAD STORAGE: the persisted chat thread survives an app restart. Do not
  put base64 image data in it. Propose storing a text marker only.
- Resize client-side to roughly 1.15 megapixels before sending.

## Prompt rule propagation (required)

Any behavioural rule of the form "the coach should never mention X" or
"the coach should always say Y" must be applied in BOTH places:

1. coach-chat's PERSONA_PROMPT (prompt.ts) — the conversational model
2. _shared/summary.ts — the day-close model, which runs its own separate
   prompt and does NOT inherit PERSONA_PROMPT

This has already caused a real bug: a "never mention weight" rule was added to
coach-chat only, and the day-close model happily summarised a weigh-in into
the next day's aandachtspunt. Decide explicitly whether the no-false-precision
rule needs to hold in the day-close path too, and say so in your plan.

Note that _shared/summary.ts is bundled into both coach-chat and
close-day-cron — changing it means redeploying both functions.

## Deploy verification (required)

Generate the deploy payload with a script that reads the files directly from
disk — do not retype file contents into the tool call. After deploying, verify
git ↔ production parity with a real byte-for-byte diff of every bundled file,
not a visual check and not an assumption that the deploy landed correctly.

This is a standing requirement for this project: hand-typed payloads have
repeatedly corrupted unrelated shared files (a stubbed summary.ts that
silently stopped writing to coach_sessions, an undefined variable in today.ts's
Monday cross-week path). These fail silently, so the diff is the only thing
that catches them.

Also: when you change a file under _shared/, identify EVERY function that
bundles it and redeploy all of them — then diff all of them, not just the ones
you deployed.

## Test data cleanup (required)

Verification runs against the live database, so any test conversation that
logs a meal writes a real row to nutrition_log — and the day-close will sum
over it. This has already corrupted one day's totals (257g protein recorded
instead of the real 179g).

After verification:
1. Delete every row your test run created — track the ids or the time window
   as you go.
2. Verify the cleanup: nutrition_log's SUM for that date must match what was
   actually eaten, and match eiwit_totaal / calorieen_totaal in coach_sessions
   if the day was already closed.
3. Check coach_memory for facts stored during testing and deactivate any that
   shouldn't persist.

Do the cleanup in the same session — not "later." The 23:30 notification and
the 02:00 cron can both close the day before anyone gets back to it.

## Verification

- Send a plate photo → coach names the components and gives a protein RANGE,
  and does not claim a measured gram weight of the food.
- Nothing is written to nutrition_log until the user confirms.
- After confirming, the row exists with bron = 'foto' and a single midpoint
  protein value; the running day total comes back from the tool result and
  matches SUM(eiwitten_g).
- A partially eaten plate: the coach asks whether it was finished and adjusts.
- An unusable photo: one request for a better one, then a graceful fallback,
  no invented estimate.
- Send a message with BOTH a photo and text ("this, and I also had a shake at
  3pm") → both are handled, nothing is dropped.
- Trigger a day-close after a photo conversation → the summary text is intact
  and reflects the meal. Test the manual route and the cron route.
- Restart the app → the thread restores without bloat and without a broken
  image placeholder.
- Renders correctly at phone width.

Give me a plan before building.
```

---

### Volgorde ten opzichte van het overige openstaande werk

Dit blok is **niet urgent** en hoort achter het al geplande werk. Voorstel:

1. Vervolgtaak 1 (deploy-verificatie) — nog openstaand, en sinds §20a
   steviger onderbouwd
2. **Kalibratiemeting fotoschatting** — kost geen bouwtijd, kan parallel lopen
   terwijl er toch op schone `tijdstip`-data gewacht wordt
3. Eiwitspreiding — vanaf 29 augustus
4. Fotoschatting bouwen, mits de kalibratie groen is
5. Hydratie fase A

*Uitgedacht 26 augustus 2026. Nog geen CC-prompt gegeven.*

---

## 19a. Bevinding — de antwoordopties hebben in de praktijk nog nooit gevuurd ⬜ OPENSTAAND (31 augustus; meetinstrument `v: 3` live sinds 2 september)

*Vervolg op §19; de bouwgeschiedenis daarvan staat in `voeding-app-archief.md`.*

**Gevonden bij het uitlezen van de reeks voor §1.** Op **elke** `v: 2`-rij sinds
de deploy staat `antwoordOpties: {aangeboden: 0, validatie: "nvt",
afkeurReden: null}`. Er is dus geen enkele keer een optieset aangeboden, en de
validatie heeft nooit iets hoeven afkeuren.

Bij `vraag_type: "geen"` of `"stemming"` is dat correct gedrag — daar horen geen
opties. **Het geval dat telt is 29-08**, waar het model `vraag_type: "anders"`
koos en toch nul opties meegaf. Dat is precies de situatie waarvoor deze feature
op 27-08 gebouwd is.

**Eén waarneming, en die is niet interpreteerbaar zonder de vraagtekst.**
`checkin_diag` legt `vraag_type` vast maar niet wát er gevraagd is. Nul opties
betekent daardoor twee volstrekt verschillende dingen:

- De vraag was **gesloten** (zoals die van 27-08: "bevalt dat late tijdstip, of
  mag het eten iets naar voren?") → het model liet een kans liggen, en dat is
  een promptvraag.
- De vraag was **echt open** ("hoe ging de training?") → nul opties is exact het
  bedoelde gedrag en er is niets aan de hand.

**Dit is hetzelfde observatiegat als in §18, één niveau hoger.** Daar was de
vraag "gaf het model `geen` terug of rendert er iets niet"; hier is het "was er
iets te leveren of niet". In beide gevallen is de ruwe telling ambigu zonder een
extra veld, en in beide gevallen is de juiste volgorde: eerst meetbaar maken,
dan pas concluderen. Niet nu een promptregel toevoegen op basis van één rij.

**Volgende stap — `payload.v` naar 3, met de vraagtekst erin.** Klein, geen
gedragswijziging, raakt alleen `morning-checkin` (geen `_shared/`-wijziging, dus
één functie deployen in plaats van drie). Daarna is over een week te tellen hoe
vaak een gesloten vraag zonder opties langskomt.

**Als de vraagtekst er toch komt, dicht die meteen een tweede gat:** §1's
`hasNotableSignal`-tak is nu half beantwoord omdat de kaarttekst nergens
bewaard wordt. Eén veld, twee openstaande vragen.

**Nog te achterhalen zonder code:** wat vroeg de kaart van zaterdag 29-08? Als
die thread nog niet gewist is, staat het antwoord er nog. Eén gesloten vraag
zonder opties is al een sterker signaal dan wat er nu ligt.

### `v: 3` ✅ GEBOUWD (2 september, meegelift op de fix van §15a)

`payload.v` staat op 3 en de payload bevat nu twee velden erbij:

- **`vraagTekst`** — de tekst van de gestelde vraag, `null` bij
  `vraag_type: "geen"`. Er bestaat geen apart vraagveld in de modeloutput;
  `boodschap` fungeert als de vraag zodra er één gesteld wordt. `vraagTekst`
  benoemt dat expliciet in het diagnostiekrecord in plaats van het te laten
  afleiden.
- **`kaart`** — het volledige kaartobject (`eyebrow`, `boodschap`,
  `contextLabel`, `contextTekst`, `vraagType`, `antwoordOpties`), opgebouwd uit
  exact dezelfde variabelen als het HTTP-antwoord, zodat de twee niet uit elkaar
  kunnen lopen. `null` op elk vroeg-afbreekpad (geen API-sleutel, mislukte call,
  geen `tool_use`, ongeldige modeloutput) — daar bestaat nog geen kaart.

Geen migratie. `v: 1`, `v: 2` en `v: 3` staan naast elkaar zoals ontworpen;
lezers filteren op `payload->>'v'`.

**De eerste `v: 3`-rij ontstaat op 3 september**, want de kaart van 02-09 vuurde
vóór de deploy. Die eerste rij is meteen de controle of `kaart` en `vraagTekst`
ook bij een spontane aanroep gevuld binnenkomen; de verificatie van 2 september
gebeurde met een handmatige invocatie.

**Wat dit wél en niet oplost.** Het maakt de kaarttekst en de vraag achteraf
leesbaar, dus de ambiguïteit hierboven (nul opties = correct of gemist) is
vanaf nu te beslissen. Het zegt niets over de aandachtspunten zelf: die worden
door de dagafsluiting geschreven en die schrijft geen `checkin_diag`-rij. Die
kant lees je in `coach_sessions`, waarvoor niets nieuws nodig is.

### ⚠️ De premisse van deze sectie is weerlegd — het model gebruikt het veld wél (8 september)

**Op zondag 6 september leverde het model voor het eerst antwoordopties aan.
Twee stuks. Ze zijn afgekeurd:**

```
antwoordOpties: { aangeboden: 2, validatie: "afgekeurd", afkeurReden: "label_te_lang" }
```

De conclusie hierboven — "het model gebruikt het optionele veld niet" — klopt
dus niet. Het model gebruikt het; de **validatie** gooit het weg. Een heel
ander probleem, met een heel andere oplossing.

De vraag van die dag was een keurige gesloten vraag met twee heldere
antwoorden: *"Zaterdag is Borst & Triceps blijven liggen — wil je die vandaag
nog inhalen of gewoon doorschuiven naar je vaste beendag van zondag?"* Precies
waar deze feature voor bestaat. En er verschenen geen pillen.

**Dit was alleen zichtbaar dankzij `v: 3`.** Zonder de vraagtekst was dit
opnieuw een rij met `aangeboden: 0`-achtige ruis geweest.

### Waarom de grens van 20 waarschijnlijk te krap is

`validateAntwoordOpties` eist 2 of 3 labels, getrimd, niet leeg, **maximaal
20 code points**, geen duplicaten. De grens is destijds onderbouwd op het
langste vaste stemmingslabel ("Niet zo goed", 12 tekens).

**Die ijking is op handgeschreven labels gedaan, niet op modeloutput.** Dat is
een aanname die tot 6 september nooit tegen echte output is getoetst.

Nederlands werkt bovendien tegen die grens: samenstellingen zijn lang. Bij de
vraag hierboven zijn de natuurlijke antwoorden iets als "Vandaag inhalen"
(15, past) en "Doorschuiven naar zondag" (24, past niet). Alleen het woord
"doorschuiven" is al 12.

**Het model kende de grens.** De constante `ANTWOORD_OPTIE_MAX_LENGTH = 20`
voedt zowel de tool-schemabeschrijving als de promptregel, en rendert in beide
als de letterlijke tekst "max 20 tekens". Het wist het en overschreed het toch —
een aanwijzing dat 20 onnatuurlijk krap is, niet dat de instructie ontbrak.

### Belangrijk bij het lezen van toekomstige afkeuringen

`validateAntwoordOpties` **stopt bij de eerste regel die faalt**. De volgorde is:
array → niet leeg → alles strings → minstens 2 → hoogstens 3 → geen lege labels
→ geen label te lang → geen duplicaten.

`afkeurReden: "label_te_lang"` betekent dus *"minstens één label was te lang"* en
sluit niets anders uit — de duplicatencheck draaide nooit. Nooit lezen als
enkelvoudige oorzaak.

### De meting — labels meeloggen ✅ GEBOUWD (8 september, `morning-checkin`)

**Het gat:** de payload legde vast dát er twee labels waren en dát er één te
lang was, maar niet wát er stond. Het verschil tussen 21 en 45 tekens bepaalt of
je de grens iets verruimt of dat er iets anders speelt. Precies dezelfde
classificatie-zonder-inhoud als vóór `v: 3`.

**Gebouwd:** `diagnoseAntwoordOptieLabels()` logt per optie de getrimde waarde
en de lengte in code points, op **elk** pad — ook bij een geslaagde validatie.
Een grens die alleen op mislukkingen wordt geijkt, is op de halve verdeling
geijkt; zonder de geslaagde labels weet je niet hoe dicht die tegen het plafond
zaten.

De lengte hergebruikt letterlijk `[...label].length` uit de validator zelf, niet
`.length`. Daardoor kunnen het gelogde en het afgedwongen getal per constructie
niet uiteenlopen — ook niet bij tekens buiten het basisbereik.

Misvormde invoer blijft onderscheidbaar: `ruwType: 'geen_array'` als de hele
waarde geen array is, `typeof` als een element binnen de array geen string is.
In de eerste opzet vielen die twee samen tot dezelfde uitvoer; dat is vóór de
bouw gecorrigeerd.

**Bleef op `v: 3`.** Een nieuwe zustersleutel binnen een bestaand object,
afwezig op elke oudere rij. Een lezer die erop controleert krijgt `undefined`,
en dat betekent correct "deze rij is van vóór de labellogging". Geen bestaand
veld verandert van betekenis, dus een versiebump zou niets toevoegen. Dat
gedrag is na de deploy in de data bevestigd.

**Niet aangeraakt:** de grens van 20, en het dichtfalen (één slecht label doodt
de hele set). Dat laatste is een bewuste keuze en afkappen zou
"Doorschuiven naar zon..." opleveren. De kosten zijn nu wel zichtbaar. Een
mogelijke verzachting voor later — bij drie labels de twee geldige tonen — is
een beslissing voor ná de meetdata, niet ervoor.

### Verwachting: dit gaat lang duren

Sinds `v: 2` live ging zijn er **drie** `vraag_type: "anders"`-vragen geweest:
29-08 (nul opties), 04-09 (nul opties), 06-09 (twee, afgekeurd). Eén op de drie
leverde opties, en een `anders`-vraag komt ongeveer eens per drie à vier dagen.

**Reken op één bruikbaar datapunt per week à tien dagen, en op minstens drie
punten voordat de grens van 20 met enige zekerheid herzien kan worden.** Eén
afkeuring blijft één waarneming, ook een volledig gediagnosticeerde.

*Een stille tabel de komende dagen betekent niet dat de logging stuk is. Hij
wacht tot het model het veld weer gebruikt.*

---

## 20. Bevinding — de dev-omgeving schrijft naar de productiedatabase ⬜ OPENSTAAND (27 augustus)

**Gezien tijdens de bouw van punt 19.** Bij het lokaal testen van de
client-weergave werd de dev-server tegen **productie-Supabase** gedraaid. Gevolg:
vier echte `morning-checkin`-aanroepen die niemand bedoeld had, met vier echte
rijen in `checkin_diag` — een tabel die op dat moment een lopende
observatiereeks bevatte.

Ze zijn allemaal netjes opgeruimd. Dat is niet het punt.

**Dit is dezelfde vorm als een eerdere, duurdere fout.** Tijdens een eerdere
verificatiesessie kwamen testmaaltijden in `nutrition_log` terecht en werd een
dagtotaal vervuild (257g eiwit vastgelegd waar het er 179 waren). Toen was de
conclusie "testdata opruimen in dezelfde sessie", en die afspraak staat sindsdien
in elke CC-prompt. Die afspraak werkt, maar hij is een *herstelmaatregel*: hij
gaat ervan uit dat er naar productie geschreven wórdt en dat iemand het daarna
terugdraait.

**Waarom opruimen hier principieel tekortschiet.** Zolang lokaal ontwikkelen en
productie dezelfde database delen, is een schrijfactie van de dev-app niet te
onderscheiden van een echte gebruikersactie zodra de sessie voorbij is. De
borging die punt 19 gebruikte — vooraf de ids van echte rijen vastleggen, achteraf
op id verwijderen — dekt alleen rijen die er *vóór* het testen al waren. Een
échte invocatie die tijdens de sessie ontstaat, valt buiten die bescherming en
is achteraf niet meer als echt te herkennen.

Bij `checkin_diag` kost dat een datapunt. Bij `nutrition_log` kost het de
juistheid van een dagtotaal, en daarmee de invoer van de dagafsluiting én van de
geplande eiwitspreidingsanalyse.

**Richting — nog niet uitgewerkt, bewust.** De kern is dat de dev-build tegen een
andere Supabase-URL moet praten dan de productiebuild. Wat daarvoor nodig is
(een tweede Supabase-project, of alleen gescheiden omgevingsvariabelen met een
duidelijke visuele indicatie in de app wanneer je tegen productie draait) is een
ontwerpvraag, geen CC-prompt. Een tweede project betekent ook een tweede
schema-migratiepad, en dat is een reële prijs voor een app met één gebruiker.

**Wat dit niet is:** een reden om de opruimafspraak te laten vallen. Die blijft
staan tot er scheiding is, en ook daarna voor werk dat bewust tegen productie
draait.

### Tellerstand — vier voorvallen, waarvan één niet opgeruimd (bijgewerkt 31 augustus)

- **27-08** (bouw §19): vier onbedoelde aanroepen, op id opgeruimd.
- **28-08** (bouw §22): **twee rijen om 15:29, nooit opgeruimd** — ze staan er
  nog steeds. Gevonden op 31 augustus bij het uitlezen van de reeks voor §1.
- **31-08** (bouw §21): twee rijen, in dezelfde sessie opgeruimd; de echte
  ochtendrij van 08:53 is aantoonbaar blijven staan.

**Wat de twee overgebleven rijen van 28-08 kosten.** Ze zitten in de reeks van
§1 en zijn daar op het eerste gezicht niet van echte invocaties te
onderscheiden. Herkenbaar zijn ze alleen aan het tijdstip (15:29, midden op de
middag) en aan het feit dat ze één seconde uit elkaar liggen. Dat is precies wat
deze sectie voorspelde: *een schrijfactie van de dev-app is niet te
onderscheiden van een echte gebruikersactie zodra de sessie voorbij is.*

**Onverwachte bijvangst:** juist doordat ze niet opgeruimd zijn, leverden ze de
enige bestaande meting van de `hasNotableSignal: false`-tak op (zie §1). Dat
maakt de bevinding niet minder waar — het is toeval, geen argument om rijen te
laten staan.

---

## 20a. Bevinding — de bundelset hangt volledig aan een handmatig getypte bestandslijst ⬜ OPENSTAAND (27 augustus)

**Beantwoord tijdens punt 19**, op een vraag die eigenlijk over iets kleins ging
(mag een testbestand naast `index.ts` staan zonder mee te deployen?).

Het antwoord: **ja, want dit project deployt met een expliciete bestandslijst.**
Er is geen `supabase/config.toml`, geen CI-workflow, en nergens een
`supabase functions deploy`. De enige deployroute is `deploy_edge_function`, dat
letterlijke bestandsinhoud per aanroep meekrijgt zonder build-step die imports
resolvet.

**Waarom dat groter is dan de vraag die het beantwoordde.** Het betekent dat de
bundelset van elke functie precies gelijk is aan wat er op dat moment in de
`files`-array getypt wordt. Er is geen enkel mechanisme dat controleert of die
lijst compleet is. Een nieuw geïmporteerd `_shared/`-bestand dat niemand aan de
lijst toevoegt, wordt stil niet gedeployed — en de bestaande byte-diff ziet dat
niet, want die vergelijkt alleen de bestanden die je wél hebt meegestuurd.

Dit was de exacte blootstelling die **vervolgtaak 1** moest afdekken. Die is op
27 augustus gebouwd en werkt: de bundelset wordt nu afgeleid uit de importgraaf
vanaf `index.ts` in plaats van met de hand onderhouden. Zie sectie 8,
vervolgtaak 1, voor de uitkomst en de gemeten basislijn.

**Wat hiermee níet is opgelost:** het script controleert of de *deploy* klopt.
Het voorkomt niet dat iemand een onvolledige `files`-array samenstelt — het
maakt zichtbaar dát die onvolledig was. Dat is de juiste volgorde (eerst
zichtbaar maken, dan eventueel voorkomen), maar het onderscheid is het
onthouden waard.

**Bijkomend, ter aanmoediging:** de byte-diff-afspraak heeft in twee opeenvolgende
sessies iets gevangen — een hertypte `_shared/today.ts`, en daarvoor al twee
stille corrupties. Dit punt gaat over de fout die diezelfde diff *niet* kan
vangen.


---

## 21a. Bevinding — gereconstrueerde dagen zijn niet ijkbaar ⬜ OPENSTAAND (27 augustus)

*Tweede helft van §21. De sorteerfix zelf is opgelost (zie `voeding-app-archief.md`);
dit deel blijft open en hoort in de CC-prompt voor de eiwitspreiding.*

Op 25-08 staan **7 van de 9** regels op een heel of half uur (08:00, 12:00,
16:00, 18:00, 19:00, 21:30, 23:00). Op de omliggende dagen zijn dat er 0 tot 3.
Dat wijst op geschatte tijden: die dag is achteraf gereconstrueerd in plaats van
gaandeweg gelogd.

Zulke dagen zijn prima voor totalen — het eiwit is gegeten, ongeacht het genoteerde
uur — maar niet om spreidingsadvies op te baseren. Je zou dan adviseren over een
verdeling die de gebruiker zelf heeft ingevuld, en die daarna terugkrijgen als
observatie. Een ronde-tijden-verhouding is een bruikbaar, goedkoop signaal om
zo'n dag te herkennen.

**Dit deel is met de fix van 31 augustus níet opgelost** en hoort nog steeds in
de CC-prompt voor de eiwitspreiding, vóór de bouw.

### ⚠️ Correctie na meting — de heuristiek is zwakker dan hierboven aangenomen (1 september)

De bewering *"op de omliggende dagen zijn dat er 0 tot 3"* is nagemeten over
10 t/m 31 augustus (22 dagen met ≥4 regels) en houdt alleen stand voor de
directe buren van 25-08. Breder gemeten is het onderscheid **gradueel, niet
binair**:

| Datum | % op heel uur |
|---|---|
| 25-08 | 67% |
| 19-08 | 50% |
| 29-08 | 50% |
| 31-08 | 50% |
| mediaan over alle dagen | 13% |
| acht van de 22 dagen | 0% |

**Wat dit betekent voor een drempel.** Op ~70% vang je alleen 25-08 en is de
regel bijna zonder werking. Op 50% vallen er vier dagen extra af, waaronder
**29-08 — dat zit in het venster 22-08 t/m 28-08 dat de reden is dat de feature
überhaupt kan starten.** Zeven schone dagen worden dan zes, of minder.

**Wel een verbetering gevonden.** Tel alleen **hele uren**, niet hele én halve:

| Maat | Mediaan | Hoogste dag |
|---|---|---|
| heel uur | 13% | 67% |
| heel of half uur | 25% | 78% |
| minuut deelbaar door 5 | 44% | 88% |

Halve uren en vijfvouden komen ook op gewoon gelogde dagen zo vaak voor dat ze
het signaal verdunnen. De oorspronkelijke formulering hierboven ("heel of half
uur") is dus de zwakkere van de twee.

**Gevolg voor de CC-prompt:** een harde drempel is niet verdedigbaar op deze
data. Realistischer is de verhouding **als zwak signaal meegeven** in plaats van
als filter — bijvoorbeeld door een dag met een hoog aandeel hele uren minder
zwaar te laten wegen, of door bij advies over zo'n dag een slag om de arm te
houden. Dat past ook beter bij de aard van de feature: spreiding is advies, geen
tweede doel.

**Waarom dit hier staat en niet stilletjes is aangepast.** De oorspronkelijke
observatie is niet fout — 25-08 ís de meest verdachte dag, en de redenering
waarom zo'n dag ongeschikt is als ijkmateriaal klopt onverkort. Alleen de
aanname dat er een duidelijke scheidslijn bestaat, is door meting weerlegd. De
query staat als check 5 in `voeding-app-datachecks.md`.

### Gevolg voor de planning

Van de twee blokkades op de eiwitspreiding is er nu één weg:

1. ~~Nachtrijen moeten in de analyse achteraan gesorteerd worden, niet vooraan.~~
   ✅ Opgelost — `sortMealsByActiveDayOrder()` is beschikbaar in
   `_shared/today.ts` en kan door de spreidingsfeature hergebruikt worden in
   plaats van nagebouwd.
2. ⬜ Gereconstrueerde dagen horen niet als ijkmateriaal gebruikt te worden.

Punt 2 hoort in de CC-prompt voor die feature. Afvangen ná de eerste adviezen
betekent adviezen intrekken die de gebruiker al gezien heeft.

Het venster van zeven schone `tijdstip`-dagen (22-08 t/m 28-08) is inmiddels
gehaald, dus de feature is qua data niet langer geblokkeerd — alleen nog qua
punt 2 hierboven.

---

## 23. Bevinding — een weging kan niet als onbetrouwbaar gemarkeerd worden ⬜ OPENSTAAND (1 september)

**Gevonden doordat het advies en de app uit elkaar liepen, niet doordat er iets
kapotging.**

Op vrijdag 28-08 luidde het advies voor de weging van zondag 30-08: *weeg
gewoon, maar noteer er "jicht + diclofenac" bij.* De onderbouwing was dat er
maar twee meetpunten per week zijn, dat een ontbrekende meting net zoveel kost
als een vervuilde, en dat je van een **gelabelde** uitschieter tenminste weet
wat je ermee moet.

De weging is uiteindelijk overgeslagen. En dat is geen afwijking van het advies
maar het enige uitvoerbare alternatief: **de app kent geen manier om een meting
te labelen.** `weight_log` heeft de kolommen `id`, `datum`, `gewicht`,
`created_at`, en er zijn twee tools (`weight_log_add`, `weight_log_update`).
Er is geen markering, en er is ook geen delete.

Het advies vroeg dus om iets wat niet bestaat. De keuze die overbleef was
binair: vervuilen of overslaan. Beide kosten iets.

### Waarom dit meer is dan één gemiste meting

**Week 35 heeft één meting in plaats van twee** (wo 26-08 wel, zo 30-08 niet).
De trendberekening groepeert per kalenderweek juist omdát elke week normaal
precies één woensdag en één zondag bevat — dat is de expliciete reden waarom er
niet voor een voortschrijdend venster is gekozen (zie de bouwnotitie van
12 augustus). Een week met één meting ondermijnt die aanname, en het weekgemiddelde
leunt dan volledig op één waarde.

**Wat de berekening met een incomplete week doet, is nergens gedefinieerd.**
Drempel is 6 weken, vergelijking is eerste-2 versus laatste-2 weekgemiddelden.
Of een week met één meting daarin volwaardig meetelt, is niet vastgelegd en niet
onderzocht. Sinds week 35 is dat geen theoretische vraag meer.

**En het valt niet op.** Losse metingen worden per ontwerp nooit teruggetoond,
dus een ontbrekende of vervuilde meting is onzichtbaar tot iemand de tabel
opvraagt. Dit gat is dan ook niet in de app gevonden maar bij een handmatige
`weight_log`-query op 1 september. Zelfde categorie als de `SUM` die perfect
klopte over vervuilde testrijen, en als de nachtrijen uit §21: technisch
correct, inhoudelijk verkeerd, geen foutmelding.

### Waarom dit terugkeert

Dit is geen eenmalig geval. De aanleiding was een jichtaanval met een korte
diclofenac-kuur, en:

- NSAID's geven vochtretentie die op de weegschaal 1 tot 2 kg kan schelen, met
  een naijling van drie tot vijf dagen na de laatste tablet.
- Een calorietekort is zelf een bekende trigger voor een aanval (ketonen
  concurreren met urinezuur om uitscheiding via de nieren), en er staan dagen
  van 1640-1960 kcal in de data tegen een doel van 2300-2400.

De combinatie van die twee maakt herhaling waarschijnlijk. Zonder markering
betekent elke herhaling opnieuw dezelfde binaire keuze, en opnieuw een gat in de
reeks dat achteraf niet te duiden is. *(Voor de medische kant is de huisarts of
apotheker het adres — hier staat het alleen als reden waarom dit structureel is
en niet incidenteel.)*

### Richting — dezelfde vorm als `bron` bij fotoschattingen

Een nullable kolom op `weight_log` die vastlegt dat een meting onbetrouwbaar is,
plus een korte reden. Zelfde argument als de `bron`-kolom uit §17: zonder
markering zijn onbetrouwbare metingen niet te onderscheiden van gewone, kan de
trendberekening er niet op filteren, en is achteraf niet vast te stellen of een
afwijking echt was. Een aantekening in een vrij tekstveld is het goedkope
alternatief en om dezelfde reden ongeschikt: niet betrouwbaar te queryen.

Wat dat meteen meeneemt:
- De coach moet de markering kunnen zetten bij het loggen ("weeg 111,2, maar ik
  slik nog diclofenac") én achteraf, net als bij `tijdstip` in v28.
- De trendberekening moet gemarkeerde metingen uitsluiten, en er moet bepaald
  worden wat er dan met de weekgroepering gebeurt — een week die daardoor op één
  meting uitkomt, is hetzelfde probleem als hierboven.
- Er is nog steeds geen delete. Bij een gewicht is dat verdedigbaar (er is geen
  redundantie, zie de reden waarom `weight_log_update` destijds is toegevoegd),
  maar uitsluiten via een markering vervangt de behoefte aan een delete
  grotendeels.

**Bewust nog niet gebouwd.** Dit is één kolom plus promptwerk en raakt
`coach-chat`, maar de vraag wat de trendberekening met incomplete weken doet is
een ontwerpbeslissing die vóór de bouw genomen moet worden, niet erin.

### Ingetrokken bewering — week 36 is níet geraakt (correctie 2 september)

Hier stond dat de weging van woensdag 02-09 minder zuiver zou zijn, omdat de
beendag verschoven zou zijn van zondag 30-08 naar maandag 31-08 en de meting
daardoor twee in plaats van drie dagen na de sessie viel.

**Dat klopt niet. De benen zijn gewoon op zondag getraind.** Het aandachtspunt
van 30-08 zegt het letterlijk ("de beensessie van zondag"), dus dit was
weerlegbaar met tekst die al gelezen was. Week 36 is een normale week met twee
metingen op de gebruikelijke afstand van de zware sessie.

**Alleen week 35 is geraakt**, op aantal: één meting in plaats van twee, doordat
zondag 30-08 bewust is overgeslagen wegens de jichtaanval. Dat is precies het
geval waarvoor de markering in deze sectie bedoeld is.

*De ingetrokken bewering blijft hier staan in plaats van weggepoetst te worden:
een correctie die nergens meer te zien is, kan bij een volgende analyse opnieuw
worden bedacht.*

---

## 24. Bevinding — Engelse bezitsvorm in de kaarttekst ✅ GEREPAREERD (8 september, promptregel)

**Gevonden door `kaart.boodschap` terug te lezen, wat vóór `v: 3` niet kon.**
Twee opeenvolgende dagen stond er een Engelse bezitsvorm op een Nederlands
bijwoord in de tekst die op het scherm kwam:

- **04-09:** "eiwitrijk eten helpt je herstel, ook profiterend van
  **gisteren se** rustdag"
- **05-09:** "en met **gisteren's** Rug & Biceps sessie mag je eiwitinname ook
  vandaag nog stevig zijn"

Nederlands kent geen apostrof-s op een bijwoord of dagnaam. Correct is "de
rustdag van gisteren" of "gisteren was een rustdag". *"Profiterend van"* is
daarnaast stijf, maar niet fout.

**Waarom dit hier staat en niet als futiliteit is afgedaan.** Dit is de eerste
klacht over kwaliteit die met bewijs onderbouwd kon worden in plaats van met een
herinnering. De kaarttekst werd tot 2 september nergens bewaard, dus zulke
fouten verdwenen zodra de kaart van het scherm was. Ze zaten mee in het
algemene gevoel dat de kaart achteruitging.

**De fix:** één regel toegevoegd aan de `Regels:`-lijst in `buildSystemPrompt`,
naast de bestaande regel over dagwoorden omdat beide over natuurlijke
dagverwijzing gaan. Verboden om een bezitsvorm te maken door `'s` of `se` aan
een dagnaam of bijwoord te plakken, met beide echte fouten als voorbeeld en
twee correcte alternatieven.

**Meegelift op de labellogging van §19a.** Die twee kunnen elkaar niet
vertroebelen: de logging raakt niets wat het model ziet, de promptregel raakt
niets wat gelogd wordt. Elk is los in de data te beoordelen.

**Nog niet waargenomen.** De testaanroep van 8 september gaf
`vraag_type: "geen"` en produceerde dus geen kaarttekst die de nieuwe regel op
de proef stelde. Of de fout weg is, blijkt uit de eerste echte kaarten — na te
lezen in `kaart.boodschap`, waarvoor niets extra's nodig is.

**Bewust niet verbreed** tot een algemene toon- of stijlherziening. Eén
gerichte regel.

---

## 25. Bevinding — de ochtendkaart las `coach_memory` niet ✅ GEREPAREERD (11 september, `morning-checkin` v20)

**Gevonden doordat de kaart zichzelf binnen één scherm tegensprak.**

Op vrijdag 11 september, een werkvrije dag:

| Veld | Tekst |
|---|---|
| `boodschap` | "Blijf ook op deze **kantoordag** rond 15:00 alert op de dip..." |
| `contextTekst` | "**Vrije dag** — mooi moment om te herstellen van de Power Hour van gisteren." |

De bron was het aandachtspunt van donderdagavond, dat het **correct
voorwaardelijk** formuleerde: *"deze aanpak blijven aanhouden **op
kantoordagen**."* Het model liet die voorwaarde vallen.

### De oorzaak — geen promptprobleem maar een ontbrekende bron

`morning-checkin` las `coach_memory` niet. Geen query, nergens in het bestand.
De kaart kreeg alleen de dagfeiten uit het trainingsschema, `isThursday`, en de
tekst van het aandachtspunt.

De feiten dat kantoordagen dinsdag en donderdag zijn en dat vrijdag tot en met
zondag werkvrij is, staan gewoon in `coach_memory` en gaan bij **elke**
chatbeurt letterlijk mee naar de coach. De kaart had er geen enkel pad naartoe.

**Daarom was een promptregel nooit de oplossing geweest.** De
verzoeningsregel uit §15a zegt dat het model moet toetsen aan de
"Vandaag is..."-feiten, en die set kent maar vier waarden: `training`, `rust`,
`power_hour`, `boksen`. Er ís geen kantoordagwaarde om tegen te vergelijken.
Ook een breder geformuleerde regel had hier niets kunnen doen. Het model kon
"op kantoordagen" onmogelijk verwerpen, want het wist niet welke dagen dat
waren; het gokte en het gokte mis.

**Eén feit was letterlijk voor deze plek geschreven** en kwam er nooit aan:
*"Op kantoordagen (dinsdag en donderdag) is er vaak een energiedip rond 15:00 —
**mag proactief benoemd worden, bijvoorbeeld tijdens de ochtend check-in**."*

### Een fout feit in `coach_memory`, eerst gecorrigeerd

Bij het uitzoeken bleek de `definitie`-regel over Power Hour onjuist: hij
beschreef het als een intensieve boksles bij een externe bokssportschool in
Beverwijk. Het is een trainer-geleide les met HIIT, kracht en cardio op een
externe locatie.

**Waarom dit ernstiger is dan één verkeerd woord.** Dit feit ging bij elke
chatbeurt mee en was als fout niet herkenbaar. Het is doorgesijpeld naar drie
aandachtspunten in `coach_sessions` (21-08, 30-08, 31-08), die permanent zijn,
en naar deze documentatie. Een fout feit ziet er niet fout uit.

**Volgorde bewust aangehouden:** eerst het feit corrigeren via de chat, pas
daarna de kaart eraan koppelen. Andersom zou de kaart een *fout* feit krijgen
in plaats van een *ontbrekend* feit, en dat zou doorwerken in nieuwe
aandachtspunten. De correctie is geverifieerd: dezelfde rij bijgewerkt (geen
tweede rij ernaast), en "boks" komt nergens meer voor in `coach_memory`.

De drie historische aandachtspunten zijn bewust niet hersteld. Ze vallen buiten
het venster van vijf dagsamenvattingen en aanpassen zou teruggrijpen op
afgesloten dagen. *Komt "boksles" toch terug in een nieuw aandachtspunt, dan
komt het ergens anders vandaan.*

### De fix

**Alle actieve `coach_memory`-feiten gaan mee**, op precies dezelfde manier als
bij `coach-chat`: geen categoriefilter, geen trefwoordfilter. Tien rijen,
ongeveer 1900 tekens.

**Bewust geen filter.** Een filter op categorie zou filteren op een grens die
niemand kan uitleggen — de werkdagen staan onder `gewoonte`, de eetgewoontes
onder `vaste_gewoonte`. Elke selectie die vandaag gemaakt wordt, is een gok die
misgaat zodra er een elfde feit bij komt, en het feit dat speciaal voor deze
plek geschreven was laat zien hoe die fout eruitziet.

**En de categorie wordt niet meegestuurd in de prompt.** Dat onderscheid is
niet alleen onverklaarbaar maar hier actief misleidend: de twee feiten die deze
bug veroorzaakten staan onder `gewoonte`, terwijl een zachte, optionele
gewoonte ("na training vaak eerst een shake") onder `vaste_gewoonte` staat. Een
model dat die labels leest, kan redelijkerwijs concluderen dat het tweede harder
is dan het eerste. Dat is omgekeerd.

**Achtergrondkennis, geen suggestielijst.** Het sjabloonrisico uit §6 is bij een
kaart van drie zinnen groter dan bij een chat: "banaan of een handje noten" en
"na training vaak eerst een shake" worden een vast menu als het model ze als
voorstellen leest. Dat is opgelost in de framing bij de feiten zelf, niet met
een extra regel elders:

> Achtergrondkennis over de gebruiker (langetermijngeheugen) — gebruik dit om
> aannames te toetsen en tegenspraken te voorkomen, NIET als een lijst om
> suggesties uit te putten: noem een van deze feiten alleen als de dag van
> vandaag daar zelf om vraagt.

**Plaatsing:** achteraan bij "Feiten om op te baseren", direct na het
aandachtspunt en vóór de verzoeningsinstructies. Daardoor staan de
kantoordagfeiten al in beeld op het moment dat het model "op kantoordagen"
tegen vandaag afweegt.

### Het donderdagblok ontdubbeld

De prompt bevatte een hardcoded blok dat zowel beschreef **wat** Power Hour is
als **hoe** je eromheen eet, afgeschermd door `isThursday`. De beschrijving
stond óók in `coach_memory` — en de twee spraken elkaar al tegen ("HIIT, kracht
en cardio" tegenover "boksles"). Zodra de kaart het geheugen meekrijgt, staan
beide beschrijvingen in dezelfde prompt, wat slechter is dan elk apart. Dit kon
dus niet uitgesteld worden.

**De werkverdeling:** `coach_memory` beschrijft wat er in de week gebeurt, de
prompt beschrijft hoe de coach erover adviseert.

- **Weg uit de prompt:** de beschrijving van de activiteit.
- **Blijft:** niet nuchter, snack rond 17:30, hoofdmaaltijd na de training. Dat
  staat nergens anders.
- **Blijft ook:** "Zondag is de vaste beendag, altijd nuchter." Dat is een
  schemafeit, geen chatgeleerd feit, en hoort niet in `coach_memory`.

**De poort gaat nu op `today.dayType === 'power_hour'` in plaats van
`isThursday`.** Het schema levert dat dagtype zelf sinds de hernoeming van
"Cardio Fitness" naar "Power Hour", en een `week_overrides`-rij wordt daarin wél
gevolgd door `resolveWeekPlan` en niet door kalenderrekenkunde.

**Bewust achtergelaten asymmetrie:** `hasNotableSignal` en het
diagnostiekveld `cond.vandaagPowerHour` blijven op `isThursday`. Verplaatst
Power Hour ooit naar een andere dag, dan volgt de kaarttekst het schema en die
twee niet. Buiten scope gehouden omdat `hasNotableSignal` de lopende vraagmeting
raakt; met een comment in de code gemarkeerd.

**Klein, niet opgelost:** het advies over 17:30 hoort bij een sessie die om
19:00 begint. De poort is nu schemagebaseerd, het tijdstip blijft hardcoded.

### Verificatie — sterke opzet, eerlijk gerapporteerd

De testaanroep draaide op **hetzelfde, ongewijzigde aandachtspunt** van 10-09
dat 's ochtends de foute kaart opleverde. Zelfde invoer, alleen andere code:

| | `boodschap` |
|---|---|
| v18, 11:28 | "Blijf ook op deze **kantoordag** rond 15:00 alert op de dip..." |
| v20, testcall | "Fijne **rustdag** vandaag — mooi moment om te herstellen van de Power Hour van gisteren, zonder verder iets te moeten." |

De fout reproduceerde niet, en het geheugenblok is de enige nieuwe invoer.

**Wat er níet geclaimd wordt:** dat het model aantoonbaar heeft geredeneerd
"vrijdag is werkvrij volgens feit X". De redeneerstap is niet zichtbaar. Dat de
kaart het feit niet noemt, past bij de eigen weegregels: zonder vraag in het
aandachtspunt valt de kaart terug op een korte boodschap zodra het kantooradvies
terecht is verworpen.

Testrij op vooraf vastgelegde id verwijderd, id-set van de dag daarna
onafhankelijk gecontroleerd en terug bij de uitgangsstand.

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

---
Staande afspraken: `voeding-app-afspraken.md`
Afgeronde bevindingen: `voeding-app-archief.md`
Volledige bouw- en testdocumentatie fase 1: `voeding-app-volledige-documentatie.md`
