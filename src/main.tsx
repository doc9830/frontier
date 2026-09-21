import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { isAndroidShell } from './platform/android.ts';
import './ui/styles.css';

/** Entry point: mount the shell and let the store own the simulation. */

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(<App />);

// PWA: the offline shell only matters in a browser build. Inside the Android app the
// game is served from local files, and a leftover service worker would only fight the
// in-app updater, so any old registration is removed instead.
if (isAndroidShell()) {
  void navigator.serviceWorker
    ?.getRegistrations?.()
    .then((registrations) => registrations.forEach((registration) => void registration.unregister()))
    .catch(() => {
      /* nothing to clean up */
    });
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* the game runs fine online without the offline cache */
    });
  });
}
