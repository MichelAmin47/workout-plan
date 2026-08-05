import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

const DAILY_REMINDER_ID = 1001

function nextTrigger(hour, minute) {
  const at = new Date()
  at.setHours(hour, minute, 0, 0)
  if (at <= new Date()) at.setDate(at.getDate() + 1)
  return at
}

// One notification per day, unconditional — local notifications are
// scheduled on-device ahead of time and can't check "has anything been
// logged yet" at fire time, so there's no activity check here by design.
// Scheduling with a fixed id is idempotent (overwrites any existing
// schedule for that id), so this is safe to call on every app boot with no
// "have I already scheduled this" bookkeeping.
export async function scheduleDailyCloseReminder() {
  if (!Capacitor.isNativePlatform()) return // no-op on web/dev server

  try {
    const permission = await LocalNotifications.requestPermissions()
    if (permission.display !== 'granted') return // convenience, not a dependency — app must still work without it

    await LocalNotifications.schedule({
      notifications: [
        {
          id: DAILY_REMINDER_ID,
          title: 'Coach',
          body: 'Tijd om je dag af te sluiten — vertel me nog even wat je hebt gegeten.',
          schedule: { at: nextTrigger(23, 30), repeats: true, every: 'day', allowWhileIdle: true },
        },
      ],
    })
  } catch (err) {
    console.error('scheduleDailyCloseReminder failed', err)
  }
}

// TEMPORARY — remove after block 4 verification
export async function fireTestNotification() {
  if (!Capacitor.isNativePlatform()) return
  const permission = await LocalNotifications.requestPermissions()
  if (permission.display !== 'granted') return
  await LocalNotifications.schedule({
    notifications: [
      {
        id: 9001,
        title: 'Coach (test)',
        body: 'Tijd om je dag af te sluiten — vertel me nog even wat je hebt gegeten.',
        schedule: { at: new Date(Date.now() + 2000) },
      },
    ],
  })
}
