import { supabase } from '../supabase.js'

const DEFAULT_EIWIT_DOEL_G = 165
const QUERY_TIMEOUT_MS = 3000

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('dayProgress query timed out')), ms)),
  ])
}

async function fetchProteinTotal(date) {
  const { data, error } = await supabase.from('nutrition_log').select('eiwitten_g').eq('datum', date)
  if (error) throw error
  return (data ?? []).reduce((sum, m) => sum + (Number(m.eiwitten_g) || 0), 0)
}

async function fetchProteinGoal(date) {
  const { data, error } = await supabase.from('daily_targets').select('eiwit_doel_g').eq('datum', date).limit(1)
  if (error) throw error
  return data && data.length > 0 ? (data[0].eiwit_doel_g ?? DEFAULT_EIWIT_DOEL_G) : DEFAULT_EIWIT_DOEL_G
}

// Best-effort protein progress for the opening message — a greeting is not
// worth a spinner or an error state, so any failure or slowness (3s budget)
// just falls back to { ok: false }, letting the caller use the generic
// opening instead. yesterdayDate is optional — only passed for a rollover
// transition, where "yesterday you got to Xg" is worth the extra query;
// a normal same-day reopen doesn't need it.
export async function fetchProteinProgress(date, yesterdayDate) {
  try {
    const [eiwitTotaal, eiwitDoel, yesterdayTotaal] = await withTimeout(
      Promise.all([
        fetchProteinTotal(date),
        fetchProteinGoal(date),
        yesterdayDate ? fetchProteinTotal(yesterdayDate) : Promise.resolve(null),
      ]),
      QUERY_TIMEOUT_MS,
    )
    return { ok: true, eiwitTotaal, eiwitDoel, yesterdayTotaal }
  } catch (err) {
    console.error('fetchProteinProgress failed, falling back to generic opening', err)
    return { ok: false }
  }
}
