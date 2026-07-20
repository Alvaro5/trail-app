import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { track } from './lib/analytics'
import { registerSW } from 'virtual:pwa-register'

// autoUpdate + this helper = the page reloads itself the moment a newly
// deployed service worker takes control, so nobody is ever stuck one deploy
// behind the cached shell. (Without it, updates only landed on the SECOND
// visit after a deploy — the owner hit exactly that.)
registerSW({ immediate: true })

// Minimal error visibility, privacy-stance compatible: crashes surface as a
// truncated `app-error` event in Umami instead of vanishing into consoles we
// never see. Deduped per session and capped so a render-loop crash can't
// flood the stats.
const reportedErrors = new Set<string>()
function reportAppError(kind: string, raw: unknown) {
  const message = String(raw ?? 'unknown').slice(0, 120)
  const key = `${kind}:${message}`
  if (reportedErrors.has(key) || reportedErrors.size >= 5) return
  reportedErrors.add(key)
  track('app-error', { kind, message })
}
window.addEventListener('error', (e) => reportAppError('error', e.message))
window.addEventListener('unhandledrejection', (e) =>
  reportAppError('rejection', e.reason),
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
