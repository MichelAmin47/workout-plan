// TEMPORARY step-sync diagnostics panel — opened by tapping the coach
// avatar. Remove together with lib/stepDebug.js once the sync is confirmed.
import { useEffect, useState } from 'react'
import { runStepDiagnostics, getStepDebugLog } from '../lib/stepDebug.js'

export default function StepDebugPanel({ onClose }) {
  const [text, setText] = useState('Bezig…')
  const [copied, setCopied] = useState(false)

  function load() {
    return runStepDiagnostics().then((report) =>
      JSON.stringify({ diagnose: report, syncLog: getStepDebugLog() }, null, 2)
    )
  }

  function refresh() {
    setText('Bezig…')
    setCopied(false)
    load().then(setText)
  }

  useEffect(() => {
    let cancelled = false
    load().then((t) => {
      if (!cancelled) setText(t)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="step-debug-overlay">
      <div className="step-debug-panel">
        <div className="step-debug-title">Stappen-sync debug (tijdelijk)</div>
        <pre className="step-debug-text">{text}</pre>
        <div className="step-debug-actions">
          <button type="button" onClick={refresh}>Opnieuw</button>
          <button type="button" onClick={copy}>{copied ? 'Gekopieerd ✓' : 'Kopieer'}</button>
          <button type="button" onClick={onClose}>Sluiten</button>
        </div>
      </div>
    </div>
  )
}
