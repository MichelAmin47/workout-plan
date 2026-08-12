import { Capacitor } from '@capacitor/core'
import { LocalNotifications, Weekday } from '@capacitor/local-notifications'

const WEIGHT_REMINDER_WEDNESDAY_ID = 1002
const WEIGHT_REMINDER_SUNDAY_ID = 1003

// Sibling to dailyReminder.js rather than folded into it — "dailyReminder"
// would be a misnomer for a twice-weekly schedule. Same shape throughout:
// native-platform guard, inline permission request (convenience, not a
// dependency), unconditional schedule (no "only if not logged yet" — local
// notifications can't query the database at fire time, same reasoning
// already applied to the 23:30 reminder), allowWhileIdle, no
// SCHEDULE_EXACT_ALARM.
//
// Wo/Zo ochtend, na het toilet, vóór het eten (zie voeding-app-v2.md §5) —
// 07:00 as a time that follows a normal wake-before-breakfast routine
// without firing implausibly early; woensdag is thuiswerkdag en zondag
// kent geen haast, zodat een paar minuten drift van de non-exact alarm op
// geen van beide dagen een probleem is.
export async function scheduleWeightCheckinReminder() {
  if (!Capacitor.isNativePlatform()) return // no-op on web/dev server

  try {
    const permission = await LocalNotifications.requestPermissions()
    if (permission.display !== 'granted') return // convenience, not a dependency — app must still work without it

    await LocalNotifications.schedule({
      notifications: [
        {
          id: WEIGHT_REMINDER_WEDNESDAY_ID,
          title: 'Coach',
          body: 'Tijd om te wegen — na het toilet, vóór het ontbijt.',
          schedule: { on: { weekday: Weekday.Wednesday, hour: 7, minute: 0 }, allowWhileIdle: true },
        },
        {
          id: WEIGHT_REMINDER_SUNDAY_ID,
          title: 'Coach',
          body: 'Tijd om te wegen — na het toilet, vóór het ontbijt.',
          schedule: { on: { weekday: Weekday.Sunday, hour: 7, minute: 0 }, allowWhileIdle: true },
        },
      ],
    })
  } catch (err) {
    console.error('scheduleWeightCheckinReminder failed', err)
  }
}
