// Installs the service worker (public/sw.js) so the game can go on the home
// screen and start offline. Built games only: in dev it would cache stale code.
// New builds are offered by the update prompt in src/version.js.
/* global __BUILD_ID__ */

export function registerOffline() {
  if (__BUILD_ID__ === 'dev' || !('serviceWorker' in navigator)) return;
  const go = () => navigator.serviceWorker.register('sw.js', { scope: './' }).then((reg) => {
    // Browsers only look for a new worker now and then; look whenever the app comes back.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => { /* offline */ });
    });
  }, () => { /* not installable here */ });
  // After the page has loaded, so it doesn't compete with the first download.
  if (document.readyState === 'complete') go();
  else addEventListener('load', go);
}

// Asks the browser not to clear saved progress (best scores, stars) on its own.
// Safari and Chrome mostly grant this to installed home screen apps, so only ask
// there (other browsers may pop up a question).
export function keepSaves() {
  const installed = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
    || navigator.standalone === true;
  if (installed) navigator.storage?.persist?.().catch(() => { /* best effort */ });
}
