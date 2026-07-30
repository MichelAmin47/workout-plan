// Seeded example thread the app opens with. Coach replies to new messages
// are real (via the coach-chat Edge Function) — only this initial history
// is static.

let seq = 0
const id = () => `seed-${++seq}`

export const seedMessages = [
  { id: id(), type: 'day-marker', label: 'Gisteren' },
  {
    id: id(),
    type: 'checkin-card',
    eyebrow: '☀️ Ochtend check-in',
    question: 'Goedemorgen! Je hebt gisteren flink getraind — hoe voel je je vandaag?',
    contextLabel: 'Gisteren zag ik:',
    contextText: 'krachtraining 58 min · 4 sets squats · hoge intensiteit. Je lichaam heeft nu herstel én brandstof nodig.',
  },
  {
    id: id(),
    type: 'user',
    text: 'Beetje stijf in mijn benen maar verder goed! Heb al een ei gegeten 😅',
    time: '08:02',
  },
  {
    id: id(),
    type: 'user',
    text: "Wat moet ik dan eten na zo'n training? Ik heb geen idee 😅",
    time: '08:04',
  },
  {
    id: id(),
    type: 'coach',
    text: 'Na zo’n zware squat-sessie heeft je lichaam écht eiwitten en koolhydraten nodig om te herstellen. Dit vind ik perfect voor jou vandaag:',
    time: '08:05',
  },
  {
    id: id(),
    type: 'meal-card',
    title: 'Herstel ontbijt',
    tag: 'Aanbevolen',
    items: [
      { name: 'Griekse yoghurt', detail: '200g · vol' },
      { name: 'Havermout', detail: '60g droog' },
      { name: 'Banaan', detail: '1 stuks · rijp' },
      { name: 'Amandelboter', detail: '1 el' },
    ],
    macros: [
      { val: '520', label: 'kcal' },
      { val: '34g', label: 'eiwit' },
      { val: '68g', label: 'koolh.' },
      { val: '12g', label: 'vet' },
    ],
  },
  {
    id: id(),
    type: 'coach',
    text: 'Die banaan is hier de sleutel — snelle koolhydraten voor je spieren. Je had al een ei, dus je bent al goed op weg! 💪',
    time: '08:05',
  },
  { id: id(), type: 'day-marker', label: 'Einde van de dag' },
  {
    id: id(),
    type: 'user',
    text: 'Heb vanavond pasta gegeten, misschien iets te veel?',
    time: '20:28',
  },
  {
    id: id(),
    type: 'coach',
    text: "Na zo'n zware training? Pasta is precies goed! Je lichaam heeft die koolhydraten écht nodig voor morgen.",
    time: '20:29',
  },
  {
    id: id(),
    type: 'summary-card',
    eyebrow: '🌙 Dagafsluiting',
    text: 'Vandaag was een sterke dag. Je hebt goed gegeten rondom je training en goed geluisterd naar je lichaam.',
    note: 'Je voelde je stijf na de squats. We bouwen morgen rustig op — focussen op eiwitten bij het ontbijt en wat minder intensief.',
    streak: '🔥 5 dagen op rij check-in gedaan',
  },
  {
    id: id(),
    type: 'coach',
    text: 'Slaap lekker! Morgen om 07:30 check ik weer in. 🌙',
    time: '20:30',
  },
  { id: id(), type: 'day-marker', label: 'Vandaag' },
  {
    id: id(),
    type: 'checkin-card',
    eyebrow: '☀️ Ochtend check-in',
    question: 'Goedemorgen! Hoe voel je je vandaag na gisteren?',
    contextLabel: 'Gisteren zag ik:',
    contextText: 'goed hersteld gegeten rondom je training, sterke dag afgesloten met 5 dagen streak.',
  },
]

// The final checkin-card above is intentionally left unanswered — it's the
// "current moment" the quick-reply row and input are meant to respond to.
// Everything before it is prior history, already resolved.

export const quickReplyOptions = ['Niet zo goed', 'Prima!', 'Heel goed 💪']

export function makeMessageId() {
  return id()
}
