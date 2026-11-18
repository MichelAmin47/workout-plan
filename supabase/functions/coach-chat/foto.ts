// Photo-based protein estimation (2026-11-17): everything about a plate
// photo that can be decided without a database or a model call.
//
// Pure, no imports — unit-tested in foto.test.ts.
//
// How a photo travels: the client sends it ONCE, as body.foto next to the
// (string-only) message list, in the request for the message it belongs to.
// That message's history text starts with a line that is exactly FOTO_MARKER.
// injectFoto turns only that last user message into [image, text] for this
// one request. Every later turn, the manual day-close and the stored thread
// only ever see the marker line — never image data.
//
// The client renders one photo message in one of three forms (voeding-app/
// src/lib/fotoMarker.js — the strings must stay identical):
//   "📷 foto"                                 open: proposal not logged yet
//   "📷 foto (gelogd)"                        a log card with herkomst 'foto'
//                                             follows it in the thread
//   "📷 foto (niet aangekomen bij de coach)"  the request failed; the coach
//                                             never saw this photo
// Only the first two count as "a photo in this conversation"; only the first
// counts as an open proposal. The client also sends a notice line
// ("📷 eerdere foto niet meer zichtbaar, niet gelogd") when a day boundary
// dropped an unconfirmed photo — it matches neither.

export const FOTO_MARKER = '📷 foto'
export const FOTO_MARKER_GELOGD = '📷 foto (gelogd)'

export const FOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
// Base64 characters, not bytes. The client sends ~1.15 MP JPEG (~200-470k
// chars); 2M chars (~1.5 MB decoded) is a guard, not a target.
export const FOTO_MAX_BASE64_CHARS = 2_000_000

type Message = { role: 'user' | 'assistant'; content: unknown }

export interface Foto {
  mediaType: (typeof FOTO_MEDIA_TYPES)[number]
  data: string
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: 'text'; text: string } => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

function userLines(messages: Message[]): string[] {
  return messages.filter((m) => m.role === 'user').flatMap((m) => textOf(m.content).split('\n').map((l) => l.trim()))
}

// A photo (open or already logged) is in the conversation the client sent —
// the current day only, chatApi.js trims history at the day-marker. Decides
// whether nutrition_log_add has a herkomst field at all.
export function fotoInGesprek(messages: Message[]): boolean {
  return userLines(messages).some((l) => l === FOTO_MARKER || l === FOTO_MARKER_GELOGD)
}

// A photo whose proposal has not been logged yet.
export function fotoVoorstelOpen(messages: Message[]): boolean {
  return userLines(messages).some((l) => l === FOTO_MARKER)
}

export type FotoValidatie = { ok: true; foto: Foto } | { ok: false; error: string }

// Checked before anything else happens in the request — a bad photo request
// writes nothing and makes no model call.
export function valideerFoto(raw: unknown, messages: Message[], quickLog: unknown): FotoValidatie {
  if (quickLog) return { ok: false, error: 'Een foto en snel loggen kunnen niet in hetzelfde bericht.' }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'De foto ontbreekt of is ongeldig.' }
  const { mediaType, data } = raw as { mediaType?: unknown; data?: unknown }
  if (typeof mediaType !== 'string' || !(FOTO_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return { ok: false, error: 'Dit fotoformaat wordt niet ondersteund.' }
  }
  if (typeof data !== 'string' || data.length === 0) return { ok: false, error: 'De foto is leeg.' }
  if (data.length > FOTO_MAX_BASE64_CHARS) return { ok: false, error: 'De foto is te groot.' }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { ok: false, error: 'De foto is ongeldig gecodeerd.' }
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user' || typeof last.content !== 'string') {
    return { ok: false, error: 'Het laatste bericht is geen gebruikersbericht.' }
  }
  if (!last.content.split('\n').some((l) => l.trim() === FOTO_MARKER)) {
    return { ok: false, error: 'Het fotobericht mist de fotomarkering.' }
  }
  return { ok: true, foto: { mediaType: mediaType as Foto['mediaType'], data } }
}

// The last user message becomes [image, text] for this request only. The
// text block keeps the full original string, marker included, so a
// transcript built from these messages (buildTranscript, which skips
// non-text blocks) still shows that a photo was sent and every word typed
// next to it. Nothing is appended, so user/assistant alternation is intact.
export function injectFoto<M extends Message>(messages: M[], foto: Foto): M[] {
  const last = messages[messages.length - 1]
  const content = [
    { type: 'image', source: { type: 'base64', media_type: foto.mediaType, data: foto.data } },
    { type: 'text', text: textOf(last.content) },
  ]
  return [...messages.slice(0, -1), { ...last, content }]
}

// ── herkomst on nutrition_log_add ──

export interface HerkomstContext {
  // A photo (open or logged) is in this conversation: the tool schema has a
  // required herkomst field.
  fotoInGesprek: boolean
  // This request carries the image itself: a photo meal is proposed, never
  // logged, in the same turn.
  fotoTurn: boolean
}

export type HerkomstBesluit = { ok: true; herkomst: 'foto' | null } | { ok: false; error: string }

const NIETS = ' Er is niets opgeslagen.'

// herkomst is set by the server from the model's explicit choice, never
// inferred, and a missing choice in a photo conversation is an error the
// model retries on — never a silent NULL.
export function beoordeelHerkomst(raw: unknown, ctx: HerkomstContext): HerkomstBesluit {
  const value = raw === undefined || raw === null || raw === '' ? null : raw
  if (!ctx.fotoInGesprek) {
    if (value === 'foto') {
      return { ok: false, error: 'Er staat geen foto in dit gesprek, dus herkomst "foto" kan niet. Log deze maaltijd zonder herkomst.' + NIETS }
    }
    return { ok: true, herkomst: null }
  }
  if (value === 'geen') return { ok: true, herkomst: null }
  if (value === 'foto') {
    if (ctx.fotoTurn) {
      return {
        ok: false,
        error: 'Een maaltijd van een foto log je nooit in dezelfde beurt als de foto: doe eerst een voorstel met bereiken en vraag of hij alles heeft opgegeten. Log pas na zijn bevestiging.' + NIETS,
      }
    }
    return { ok: true, herkomst: 'foto' }
  }
  return {
    ok: false,
    error: 'Er staat een foto in dit gesprek: geef bij nutrition_log_add altijd herkomst mee — "foto" als je een bevestigd fotovoorstel logt, anders "geen".' + NIETS,
  }
}

// ── Components of a photo meal ──

// Applied by tools.ts resolveComponent to every component of a photo log
// (herkomst 'foto') and of a later correction to that row. The amount came
// from a photo, so it is an estimate even when the component is a known
// product: protein/kcal still come from the product's own values (computed
// before this runs), but bron becomes 'geschat' — product_id is kept, so it
// can be recomputed — and the amount on the log card gets a "~" instead of
// reading as weighed ("~140g bereid", "~2,5 sneeën"). A value the user
// stated himself (bron 'gebruiker' on a non-product component) stays his.
export function alsFotoSchatting<C extends { hoeveelheid: string; bron: 'product' | 'geschat' | 'gebruiker'; product_id: string | null }>(c: C): C {
  if (c.bron === 'gebruiker' && !c.product_id) return c
  const hoeveelheid = /^\d/.test(c.hoeveelheid) ? `~${c.hoeveelheid}` : c.hoeveelheid
  return { ...c, bron: 'geschat', hoeveelheid }
}

// ── Sub-mechanism B (coach-chat/index.ts) ──

// A protein figure in a reply without a nutrition write this turn — the
// 13 August shape (a meal narrated as logged, nothing written).
export const EIWIT_CLAIM_PATTERN = /\d+\s*g\s*eiwit/i

// While a photo proposal is open, protein figures are the proposal itself
// ("zo'n 35-45g eiwit", or an adjusted range after "nee, de helft laten
// staan"), so the figure check would flag every proposal turn. Then only a
// claim of having logged counts. Negations ("nog niet gelogd", "niets
// opgeslagen") are not claims.
const LOG_CLAIM_PATTERN = /\b(gelogd|genoteerd|opgeslagen|bijgeschreven|ingevoerd)\b/i
const LOG_CLAIM_NEGATION = /\bniets?\s+(?:\S+\s+){0,2}?(gelogd|genoteerd|opgeslagen|bijgeschreven|ingevoerd)\b/gi

export function eiwitClaimDisclaimer(args: { reply: string; nutritionToolCalled: boolean; favorietTurn: boolean; fotoVoorstelOpen: boolean }): boolean {
  if (args.nutritionToolCalled || args.favorietTurn) return false
  if (args.fotoVoorstelOpen) return LOG_CLAIM_PATTERN.test(args.reply.replace(LOG_CLAIM_NEGATION, ''))
  return EIWIT_CLAIM_PATTERN.test(args.reply)
}
