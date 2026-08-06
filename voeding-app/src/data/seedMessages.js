// Opening message the app starts a fresh thread with. Everything after this
// comes from the real coach-chat Edge Function — no more static demo
// content (the old example thread used meal/workout data that could get
// logged as real rows once the coach gets tool use).

// crypto.randomUUID() rather than a session counter — the thread now
// persists across reloads (threadStorage.js), so ids must stay unique
// across page loads too, not just within one. A per-session counter that
// resets on reload can collide with ids already baked into a resumed
// stored thread from an earlier session.
const id = () => crypto.randomUUID()

// "Late evening" threshold for the closing-day opening. Written variants,
// not model-generated — see block 4 plan for why (an Edge Function call on
// every app open roughly doubles daily call volume for one line of text,
// and the opening doesn't need to reference training data the way the
// coach's first real reply already does via buildDynamicContext).
function isLateEvening() {
  return new Date().getHours() >= 22
}

// hasSummaryToday gates the closing-day question: if today is already
// closed (coach_sessions row exists), don't ask again even late in the
// evening — open normally instead.
//
// isClosingQuestion is stamped onto the message itself (not just decided
// here and forgotten) so anything that appends a *later* closing-question
// message — e.g. the notification-tap handler in Coach.jsx — can check the
// live thread for "has this already been asked" instead of relying on a
// flag that only reflects the state at the moment the thread was built. A
// thread opened fresh at 15:00 is not evening yet, so this returns the
// normal greeting; if the app stays open until 23:30 with that same
// thread, nothing here re-evaluates that decision — a stale "was it fresh"
// check would wrongly treat that thread as "already handled".
export function buildOpeningMessages(hasSummaryToday) {
  const isClosingQuestion = isLateEvening() && !hasSummaryToday
  const text = isClosingQuestion
    ? 'Hoi! Voor ik de dag ga samenvatten: is er nog iets dat je vandaag hebt gegeten dat ik nog niet weet? 🌿'
    : 'Hoi! Ik ben Coach, je voedingscoach. Hoe gaat je dag? Vertel me gerust wat je hebt gegeten of stel me een vraag — ik help je graag op weg. 🌿'
  return [
    {
      id: id(),
      type: 'coach',
      text,
      ...(isClosingQuestion ? { isClosingQuestion: true } : {}),
    },
  ]
}

export const quickReplyOptions = ['Niet zo goed', 'Prima!', 'Heel goed 💪']

export function makeMessageId() {
  return id()
}
