import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installErrorReporting } from '../data/diagnostics'
import { installNativeContextMenuPolicy } from './nativeContextMenu'

installErrorReporting()
const removeContextMenuPolicy = installNativeContextMenuPolicy()
import.meta.hot?.dispose(removeContextMenuPolicy)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
