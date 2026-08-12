import { useEffect } from 'react'
import Coach from './components/Coach.jsx'
import { scheduleDailyCloseReminder } from './lib/dailyReminder.js'
import { scheduleWeightCheckinReminder } from './lib/weightReminder.js'

export default function App() {
  useEffect(() => {
    scheduleDailyCloseReminder()
    scheduleWeightCheckinReminder()
  }, [])

  return <Coach />
}
