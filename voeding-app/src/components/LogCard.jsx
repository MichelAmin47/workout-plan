// One logged meal, rendered from the values coach-chat read back from
// nutrition_log after the write (see tools.ts buildKaart) — never from the
// coach's prose. 'geschat' rows are marked on purpose: they are exactly the
// numbers the user should check, which is the point of this card (30-09: an
// estimate ~345 kcal off went unnoticed because no per-line number was ever
// shown). 'product' rows come from the product table; 'gebruiker' rows are a
// value the user gave for this one log, so neither is flagged.
//
// status: undefined (current), 'vervangen' (a later card for the same row
// supersedes this one) or 'verwijderd' (the row was deleted).

function formatEiwit(n) {
  return `${String(Math.round(Number(n) * 10) / 10).replace('.', ',')}g`
}

function formatKcal(n) {
  return `${Math.round(Number(n))}`
}

const STATUS_LABELS = { vervangen: 'vervangen', verwijderd: 'verwijderd' }

export default function LogCard({ titel, tijdstip, rows, totaal, actie, status }) {
  const statusLabel = STATUS_LABELS[status]
  return (
    <div className={`log-card${statusLabel ? ' log-card-inactive' : ''}`}>
      <div className="log-card-header">
        <div className="log-card-title">{titel}</div>
        <div className="log-card-tag">
          {statusLabel ?? (actie === 'aangepast' ? 'Aangepast' : 'Gelogd')}
          {tijdstip ? ` · ${tijdstip}` : ''}
        </div>
      </div>
      {rows.length > 0 && (
        <div className="log-card-rows">
          <div className="log-card-colhead">
            <span />
            <span>eiwit</span>
            <span>kcal</span>
          </div>
          {rows.map((row, i) => (
            <div className={`log-card-row log-card-row-${row.bron}`} key={i}>
              <div className="log-card-name">
                <span>{row.naam}</span>
                {row.bron === 'geschat' && <span className="log-card-chip log-card-chip-geschat">geschat</span>}
                {row.bron === 'product' && <span className="log-card-chip log-card-chip-product">product</span>}
                {row.hoeveelheid && <div className="log-card-amount">{row.hoeveelheid}</div>}
              </div>
              <span className="log-card-num">{formatEiwit(row.eiwit)}</span>
              <span className="log-card-num">{formatKcal(row.kcal)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="log-card-total">
        <span>Totaal</span>
        <span className="log-card-num">{formatEiwit(totaal.eiwit)}</span>
        <span className="log-card-num">{formatKcal(totaal.kcal)}</span>
      </div>
    </div>
  )
}
