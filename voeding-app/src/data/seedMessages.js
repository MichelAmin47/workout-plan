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

// "Late evening" threshold for the closing-day opening, and "morning" for
// greeting-word choice below. Written templates, not model-generated — see
// block 4 plan for why (an Edge Function call on every app open roughly
// doubles daily call volume for one line of text, and a greeting that can
// fail on a 529 is a bad trade). Block 7 adds the client's own data
// (protein progress) to those written templates instead — still no API
// call, but no longer the same sentence every time either.
function isLateEvening() {
  return new Date().getHours() >= 22
}

function isMorning() {
  return new Date().getHours() < 12
}

const GENERIC_GREETING =
  'Hoi! Ik ben Coach, je voedingscoach. Hoe gaat je dag? Vertel me gerust wat je hebt gegeten of stel me een vraag — ik help je graag op weg. 🌿'
const GENERIC_CLOSING_QUESTION = 'Hoi! Voor ik de dag ga samenvatten: is er nog iets dat je vandaag hebt gegeten dat ik nog niet weet? 🌿'

function closingQuestionText(progress) {
  if (!progress?.ok) return GENERIC_CLOSING_QUESTION
  return `Hoi! Je staat op ${Math.round(progress.eiwitTotaal)}g van je ${Math.round(progress.eiwitDoel)}g — is er nog iets dat ik niet weet, zodat ik de dag kan samenvatten? 🌿`
}

function alreadyClosedText() {
  return 'Hoi! Vandaag is al afgesloten — laat het weten als er nog iets is. 🌿'
}

function progressGreetingText(progress) {
  const total = Math.round(progress.eiwitTotaal)
  const goal = Math.round(progress.eiwitDoel)
  const morning = isMorning()
  const greet = morning ? 'Goedemorgen!' : 'Hoi!'

  if (total <= 0) {
    if (morning && progress.yesterdayTotaal != null) {
      return `${greet} Nieuwe dag — gisteren kwam je op ${Math.round(progress.yesterdayTotaal)}g uit. Vandaag sta je nog op 0g van je ${goal}g. Hoe begin je?`
    }
    return morning
      ? `${greet} Je staat op 0g van je ${goal}g — hoe begint je dag?`
      : `${greet} Nog niets gelogd vandaag — wat heb je tot nu toe gegeten?`
  }

  if (total >= goal) {
    return morning
      ? `${greet} Je hebt je eiwitdoel al te pakken (${total}g van je ${goal}g) 💪 Sterk begin van de dag!`
      : `${greet} Je zit al op ${total}g van je ${goal}g — mooi bezig 💪 Hoe gaat de rest van de dag?`
  }

  return morning
    ? `${greet} Je staat al op ${total}g van je ${goal}g. Hoe gaat de dag verder?`
    : `${greet} Je staat op ${total}g van je ${goal}g. Hoe gaat je dag?`
}

// hasSummaryToday gates the closing-day question: if today is already
// closed (coach_sessions row exists), don't ask again even late in the
// evening — open normally instead.
//
// progress is optional — the result of dayProgress.js's fetchProteinProgress,
// or omitted/{ ok: false } entirely. Without it, this falls back to the
// exact same two generic templates the opening always used, so a failed or
// slow query never blocks the UI or changes existing behaviour, it just
// loses the personalization for that one open.
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
export function buildOpeningMessages(hasSummaryToday, progress) {
  const isClosingQuestion = isLateEvening() && !hasSummaryToday

  let text
  if (isClosingQuestion) {
    text = closingQuestionText(progress)
  } else if (hasSummaryToday) {
    text = alreadyClosedText()
  } else if (progress?.ok) {
    text = progressGreetingText(progress)
  } else {
    text = GENERIC_GREETING
  }

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
