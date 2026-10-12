import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { Showcase } from './showcase/Showcase.tsx';
import { isAppRoute } from './showcase/router.ts';
import './index.css';

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && typeof event.reason.message === 'string' && event.reason.message.includes('WebSocket')) {
    event.preventDefault();
  }
});

// Route split: `/app` (and any sub-path) loads the authenticated product; every
// other path renders the public marketing showcase. The Express catch-all
// serves index.html for all routes in production, so this is purely a
// client-side decision made once at mount.
const Root = isAppRoute() ? App : Showcase;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
