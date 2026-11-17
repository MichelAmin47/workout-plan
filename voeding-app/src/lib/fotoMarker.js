// Plate photos in the chat thread (2026-11-17) — what a photo message looks
// like in the history sent to coach-chat, and whether a photo proposal is
// still open. Pure, no imports: tested with `node --test` (fotoMarker.test.js).
//
// The image itself is never stored: a photo message is
// { type: 'user', text, foto: true | 'mislukt' }, and the image travels once,
// as askCoach's `foto` argument, in the request for that message. Every
// later turn — and the day-close transcript — only sees one of these lines.
// The strings must stay identical to supabase/functions/coach-chat/foto.ts:
// the server decides from them whether herkomst 'foto' may be set at all.

export const FOTO_MARKER = '📷 foto'
export const FOTO_MARKER_GELOGD = '📷 foto (gelogd)'
export const FOTO_MARKER_MISLUKT = '📷 foto (niet aangekomen bij de coach)'
// Sent as a user line for a 'foto-verlopen' notice (see below). Matches
// neither marker on purpose: it never enables herkomst 'foto'.
export const FOTO_VERLOPEN_REGEL = '📷 eerdere foto niet meer zichtbaar, niet gelogd'

// Per photo message id: 'open' | 'gelogd' | 'mislukt'.
//
// A photo is 'gelogd' once a log card with herkomst 'foto' follows it.
// Pairing: each such card (counted once per logId — a corrected row gets a
// second card with the same logId) closes the most recent photo before it
// that is still open. A card whose row was deleted (status 'verwijderd')
// closes nothing, so that photo is open again.
export function fotoStatussen(messages) {
  const statussen = new Map()
  const open = []
  const getelde = new Set()
  for (const m of messages) {
    if (m.type === 'user' && m.foto) {
      if (m.foto === 'mislukt') {
        statussen.set(m.id, 'mislukt')
      } else {
        statussen.set(m.id, 'open')
        open.push(m.id)
      }
    } else if (m.type === 'log-card' && m.herkomst === 'foto' && m.status !== 'verwijderd' && !getelde.has(m.logId)) {
      getelde.add(m.logId)
      const id = open.pop()
      if (id !== undefined) statussen.set(id, 'gelogd')
    }
  }
  return statussen
}

// The history text of a photo message: the marker line, then what was typed.
export function fotoBerichtTekst(text, status) {
  const regel = status === 'mislukt' ? FOTO_MARKER_MISLUKT : status === 'gelogd' ? FOTO_MARKER_GELOGD : FOTO_MARKER
  return text ? `${regel}\n${text}` : regel
}

// An unconfirmed photo in the current day's part of the thread (after the
// last day-marker) — checked right before that part stops being sent:
// rollover, cron-invalidated thread, "Start nieuwe dag". The photo and the
// coach's proposal leave the outgoing history together at that point, so
// the app says so instead of letting a later "ja, log die" silently become
// a guess (Coach.jsx inserts a 'foto-verlopen' notice).
export function heeftOpenFoto(messages) {
  let start = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'day-marker') {
      start = i + 1
      break
    }
  }
  const statussen = fotoStatussen(messages)
  return messages.slice(start).some((m) => m.type === 'user' && statussen.get(m.id) === 'open')
}
