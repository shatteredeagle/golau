import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { CaptureSurface, MiniSurface, NudgeSurface } from './surfaces'

const surface = location.hash.slice(1) || 'main'
if (surface !== 'main') document.body.classList.add('transparent')

const Root = surface === 'nudge' ? NudgeSurface : surface === 'mini' ? MiniSurface : surface === 'capture' ? CaptureSurface : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
