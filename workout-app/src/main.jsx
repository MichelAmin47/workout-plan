import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// "Snel" redesign fonts, self-hosted (latin subset). Only @font-face rules
// land in the CSS bundle; a woff2 is fetched only when rendered text uses the
// family, which only the redesign (feature flag) does.
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import '@fontsource/barlow-condensed/latin-700-italic.css'
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow/latin-600-italic.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
