import { useState } from 'react'

// "Snel loggen": pick an eating time, tap a favourite. The favourite is
// logged by coach-chat from its stored record (see tools.ts logFavoriet) —
// this sheet only sends the favourite's id and the chosen time.

const TIME_OPTIONS = [
  { key: 'nu', label: 'Nu' },
  { key: 'ontbijt', label: 'Ontbijt', time: '09:00' },
  { key: 'lunch', label: 'Lunch', time: '12:30' },
  { key: 'middag', label: 'Middag', time: '15:30' },
  { key: 'avond', label: 'Avond', time: '18:30' },
  { key: 'anders', label: 'Anders…' },
]

function clockTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatEiwit(n) {
  return `${String(Math.round(Number(n) * 10) / 10).replace('.', ',')}g`
}

// selection: { key, custom } — custom is the <input type="time"> value for
// 'anders'. "Nu" is resolved at tap time, not when the sheet opened.
export function resolveTime(selection) {
  if (selection.key === 'nu') return clockTime()
  if (selection.key === 'anders') return selection.custom || clockTime()
  return TIME_OPTIONS.find((o) => o.key === selection.key).time
}

export default function QuickLogSheet({ favorieten, loadError, onClose, onPick }) {
  const [selection, setSelection] = useState({ key: 'nu', custom: '' })
  const shownTime = resolveTime(selection)

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Snel loggen" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <div className="sheet-title">Snel loggen</div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Sluiten">
            ✕
          </button>
        </div>

        <div className="sheet-section-label">Wanneer gegeten?</div>
        <div className="sheet-pills">
          {TIME_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`quick-reply${selection.key === option.key ? ' is-selected' : ''}`}
              onClick={() => setSelection((s) => ({ ...s, key: option.key, custom: option.key === 'anders' && !s.custom ? clockTime() : s.custom }))}
            >
              {option.label}
              {option.time ? ` ${option.time}` : ''}
            </button>
          ))}
        </div>
        {selection.key === 'anders' && (
          <input
            type="time"
            className="sheet-time-input"
            value={selection.custom}
            onChange={(e) => setSelection((s) => ({ ...s, custom: e.target.value }))}
          />
        )}
        <div className="sheet-time-line">Wordt gelogd om {shownTime}</div>

        <div className="sheet-section-label">Favorieten</div>
        <div className="sheet-favorites">
          {favorieten === null && !loadError && <div className="sheet-empty">Laden…</div>}
          {loadError && favorieten === null && <div className="sheet-empty">Favorieten konden niet geladen worden.</div>}
          {favorieten?.length === 0 && <div className="sheet-empty">Nog geen favorieten.</div>}
          {favorieten?.map((fav) => (
            <button key={fav.id} type="button" className="fav-item" onClick={() => onPick(fav, resolveTime(selection))}>
              <div className="fav-item-text">
                <div className="fav-item-name">{fav.naam}</div>
                <div className="fav-item-parts">{fav.onderdelen.join(' · ')}</div>
              </div>
              <div className="fav-item-protein">
                <span className="fav-item-protein-val">{formatEiwit(fav.eiwit)}</span>
                <span className="fav-item-protein-label">eiwit</span>
              </div>
            </button>
          ))}
        </div>

        <div className="sheet-footer">Nieuwe favoriet? Zeg in de chat: “sla dit op als favoriet”.</div>
      </div>
    </div>
  )
}
