// Supabase Edge Function: close-day-cron
//
// Scheduled fallback (pg_cron, ~02:00 Europe/Amsterdam) for closing out a
// day the user never explicitly closed in chat. No client caller, no
// conversation access — this is the "thin" path: it can only see
// nutrition_log + workout data for the day that just ended, never the
// chat itself (that lives only in the client's localStorage).
//
// Activity rule: at least one nutrition_log row for that date. Zero rows
// means no summary is written at all — an empty row is worse than no row.

import { supabase } from '../_shared/supabaseClient.ts'
import { amsterdamNow, isoDateString, resolveActiveDate } from '../_shared/today.ts'
import { closeDayWithSummary } from '../_shared/summary.ts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    // Same resolveActiveDate the manual close path uses — the cron always
    // runs within its cutoff window (~02:00-03:00), so this resolves to
    // "yesterday" exactly as before, but now as the same shared reasoning
    // rather than a separately-maintained "-1 day" that could drift from it.
    const datum = isoDateString(resolveActiveDate(amsterdamNow()))

    const { data: meals, error: mealsError } = await supabase.from('nutrition_log').select('id').eq('datum', datum).limit(1)
    if (mealsError) {
      console.error('close-day-cron: failed to check nutrition_log activity', mealsError.message)
      return jsonResponse({ error: mealsError.message }, 500)
    }

    if (!meals || meals.length === 0) {
      return jsonResponse({ skipped: true, reason: 'no activity', datum })
    }

    const result = await closeDayWithSummary(datum, null)
    if (!result.ok) {
      console.error('close-day-cron: closeDayWithSummary failed', result.error)
      return jsonResponse({ ok: false, datum, error: result.error }, 500)
    }

    return jsonResponse({ ok: true, datum })
  } catch (err) {
    console.error('close-day-cron error', err)
    return jsonResponse({ error: 'Er ging iets mis.' }, 500)
  }
})
