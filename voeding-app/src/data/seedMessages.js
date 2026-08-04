// Single real opening message the app starts with. Everything after this
// comes from the real coach-chat Edge Function — no more static demo
// content (the old example thread used meal/workout data that could get
// logged as real rows once the coach gets tool use).

let seq = 0
const id = () => `seed-${++seq}`

export const seedMessages = [
  {
    id: id(),
    type: 'coach',
    text: 'Hoi! Ik ben Coach, je voedingscoach. Vertel me gerust wat je hebt gegeten of stel me een vraag — ik help je graag op weg. 🌿',
  },
]

export const quickReplyOptions = ['Niet zo goed', 'Prima!', 'Heel goed 💪']

export function makeMessageId() {
  return id()
}
