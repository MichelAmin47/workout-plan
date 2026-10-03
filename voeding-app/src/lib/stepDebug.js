// TEMPORARY step-sync diagnostics — remove together with StepDebugPanel.jsx
// once the step sync is confirmed working on the device. Read-only by
// construction: nothing here writes to Supabase or to localStorage.
import { Capacitor } from '@capacitor/core'
import { Health } from '@capgo/capacitor-health'

const MAX_ENTRIES = 50
const entries = []

// Called from syncSteps() at every exit point, so "why did the sync stop"
// is visible both in the in-app panel and via console.warn.
export function stepDebugLog(event, details) {
  const entry = { t: new Date().toLocaleTimeString('nl-NL'), event, details }
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.shift()
  console.warn(`[stepSync] ${event}`, details ?? '')
}

export function getStepDebugLog() {
  return entries.slice()
}

async function capture(fn) {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) }
  }
}

// Same calls syncSteps() makes up to (not including) its first Supabase
// call, plus a read-only Health Connect read for today — never
// requestAuthorization (no prompt) and never anything that writes.
export async function runStepDiagnostics() {
  const report = {
    tijd: new Date().toString(),
    isNativePlatform: Capacitor.isNativePlatform(),
    platform: Capacitor.getPlatform(),
    isPluginAvailable_Health: Capacitor.isPluginAvailable('Health'),
  }
  try {
    report.localStorage_step_permission_decided_v1 = localStorage.getItem('step_permission_decided_v1')
  } catch (err) {
    report.localStorage_step_permission_decided_v1 = `error: ${err?.message ?? err}`
  }
  if (!report.isNativePlatform || !report.isPluginAvailable_Health) return report

  report.isAvailable = await capture(() => Health.isAvailable())
  report.checkAuthorization = await capture(() => Health.checkAuthorization({ read: ['steps'] }))
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  report.queryAggregated_vandaag = await capture(() =>
    Health.queryAggregated({
      dataType: 'steps',
      startDate: start.toISOString(),
      endDate: new Date().toISOString(),
      bucket: 'day',
      aggregation: 'sum',
    })
  )
  return report
}
