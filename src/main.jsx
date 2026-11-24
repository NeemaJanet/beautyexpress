import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { ToastProvider } from './contexts/ToastContext.jsx'
import { isSupabaseConfigured } from './lib/supabase.js'
import SetupNoticePage from './pages/public/SetupNoticePage.jsx'
import './styles/index.css'

const root = createRoot(document.getElementById('root'))

if (!isSupabaseConfigured) {
  // Friendly instructions instead of a blank page when .env is missing.
  root.render(
    <StrictMode>
      <SetupNoticePage />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </StrictMode>,
  )
}
