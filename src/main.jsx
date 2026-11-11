import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ConfigErrorScreen from './components/ConfigErrorScreen.jsx'
import { supabaseConfigProblems } from './lib/supabaseClient'
import './index.css'

// Without usable connection settings the app is not started at all: a clear
// message is shown instead of a white page (see src/core/config.js).
createRoot(document.getElementById('root')).render(
  <StrictMode>
    {supabaseConfigProblems.length > 0 ? (
      <ConfigErrorScreen problems={supabaseConfigProblems} />
    ) : (
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    )}
  </StrictMode>,
)
