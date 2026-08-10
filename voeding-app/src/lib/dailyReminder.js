import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

const DAILY_REMINDER_ID = 1001

// One notification per day, unconditional — local notifications are
// scheduled on-device ahead of time and can't check "has anything been
// logged yet" at fire time, so there's no activity check here by design.
// Scheduling with a fixed id is idempotent (overwrites any existing
// schedule for that id), so this is safe to call on every app boot with no
// "have I already scheduled this" bookkeeping.
//
// Uses `on: { hour, minute }` (a cron-like recurring trigger), not
// `at` + `repeats: true` + `every: 'day'` — on Android, when `at` is set
// alongside `repeats`, the plugin's repeat interval is computed as
// "time from now until `at`" (see LocalNotificationManager.java's
// triggerScheduledNotification), completely ignoring `every`. That made the
// notification repeat every N hours (N = however long before 23:30 the app
// happened to be reopened last), not every 24h, causing extra fires
// overnight. `on` has no such bug: TimedNotificationPublisher re-arms an
// exact alarm for the correct next occurrence every time it fires.
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
          schedule: { on: { hour: 23, minute: 30 }, allowWhileIdle: true },
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
