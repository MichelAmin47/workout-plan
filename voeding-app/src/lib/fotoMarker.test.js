// Run with: node --test voeding-app/src/lib/fotoMarker.test.js
// Pure modules only (no Supabase client, no DOM).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FOTO_MARKER,
  FOTO_MARKER_GELOGD,
  FOTO_MARKER_MISLUKT,
  FOTO_VERLOPEN_REGEL,
  fotoBerichtTekst,
  fotoStatussen,
  heeftOpenFoto,
} from './fotoMarker.js'
import { doelAfmetingen, FOTO_MAX_PIXELS } from './fotoResize.js'

const foto = (id, extra = {}) => ({ id, type: 'user', text: 'mijn bord', foto: true, ...extra })
const kaart = (logId, extra = {}) => ({ id: `k-${logId}-${Math.random()}`, type: 'log-card', logId, herkomst: 'foto', ...extra })
const coach = (id) => ({ id, type: 'coach', text: 'voorstel' })

test('marker strings match coach-chat/foto.ts exactly', () => {
  assert.equal(FOTO_MARKER, '📷 foto')
  assert.equal(FOTO_MARKER_GELOGD, '📷 foto (gelogd)')
  assert.equal(FOTO_MARKER_MISLUKT, '📷 foto (niet aangekomen bij de coach)')
  assert.equal(FOTO_VERLOPEN_REGEL, '📷 eerdere foto niet meer zichtbaar, niet gelogd')
})

test('a photo without a following photo log card is open', () => {
  const s = fotoStatussen([foto('f1'), coach('c1')])
  assert.equal(s.get('f1'), 'open')
})

test('a photo log card closes the photo before it', () => {
  const s = fotoStatussen([foto('f1'), coach('c1'), { id: 'u2', type: 'user', text: 'ja' }, kaart('L1'), coach('c2')])
  assert.equal(s.get('f1'), 'gelogd')
})

test('a non-photo log card (shake, herkomst null) does not close a photo', () => {
  const s = fotoStatussen([foto('f1'), kaart('L1', { herkomst: null }), coach('c1')])
  assert.equal(s.get('f1'), 'open')
})

test('two photos: a card closes the most recent open one; a second card for the same row counts once', () => {
  const s = fotoStatussen([foto('f1'), coach('c1'), foto('f2'), coach('c2'), kaart('L2', { status: 'vervangen' }), kaart('L2')])
  assert.equal(s.get('f2'), 'gelogd')
  assert.equal(s.get('f1'), 'open')
})

test('a deleted photo log card reopens the photo', () => {
  const s = fotoStatussen([foto('f1'), kaart('L1', { status: 'verwijderd' })])
  assert.equal(s.get('f1'), 'open')
})

test('a failed photo is "mislukt" and never open', () => {
  const s = fotoStatussen([foto('f1', { foto: 'mislukt' })])
  assert.equal(s.get('f1'), 'mislukt')
  assert.equal(heeftOpenFoto([foto('f1', { foto: 'mislukt' })]), false)
})

test('fotoBerichtTekst: marker line first, then the text; photo-only message is just the marker', () => {
  assert.equal(fotoBerichtTekst('dit, en om 15:00 een shake', 'open'), '📷 foto\ndit, en om 15:00 een shake')
  assert.equal(fotoBerichtTekst('', 'open'), '📷 foto')
  assert.equal(fotoBerichtTekst('x', 'gelogd'), '📷 foto (gelogd)\nx')
  assert.equal(fotoBerichtTekst('x', 'mislukt'), '📷 foto (niet aangekomen bij de coach)\nx')
})

test('heeftOpenFoto: only the current day segment counts', () => {
  assert.equal(heeftOpenFoto([foto('f1'), coach('c1')]), true)
  assert.equal(heeftOpenFoto([foto('f1'), coach('c1'), { id: 'd', type: 'day-marker' }, coach('c2')]), false)
  assert.equal(heeftOpenFoto([foto('f1'), kaart('L1')]), false)
})

test('doelAfmetingen: large photos scale to ≤ 1.15 MP keeping the aspect ratio; small ones are untouched', () => {
  const groot = doelAfmetingen(4000, 3000)
  assert.ok(groot.width * groot.height <= FOTO_MAX_PIXELS)
  assert.ok(groot.width * groot.height > FOTO_MAX_PIXELS * 0.99)
  assert.ok(Math.abs(groot.width / groot.height - 4 / 3) < 0.01)
  assert.ok(Math.max(groot.width, groot.height) < 1568)
  const staand = doelAfmetingen(3000, 4000)
  assert.ok(staand.height > staand.width)
  assert.deepEqual(doelAfmetingen(800, 600), { width: 800, height: 600 })
})
