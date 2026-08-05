import { useEffect } from 'react'
import Coach from './components/Coach.jsx'
import { scheduleDailyCloseReminder } from './lib/dailyReminder.js'

export default function App() {
  useEffect(() => {
    scheduleDailyCloseReminder()
  }, [])

  return <Coach />
}
