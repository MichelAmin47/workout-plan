// Single real opening message the app starts with. Everything after this
// comes from the real coach-chat Edge Function — no more static demo
// content (the old example thread used meal/workout data that could get
// logged as real rows once the coach gets tool use).

// crypto.randomUUID() rather than a session counter — the thread now
// persists across reloads (threadStorage.js), so ids must stay unique
// across page loads too, not just within one. A per-session counter that
// resets on reload can collide with ids already baked into a resumed
// stored thread from an earlier session.
const id = () => crypto.randomUUID()

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
