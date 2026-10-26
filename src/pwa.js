// Offline support and updates for the installed (home screen) app.
// Production only: in dev the service worker would cache Vite's live modules.

const onMenu = () => ['title', 'crash'].some((id) => {
  const el = document.getElementById(id);
  return el && !el.classList.contains('hidden');
});

function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // A new deploy activates straight away. Reload onto it, but never mid-run:
  // wait until the player is back on the title or crash screen.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    const tryReload = () => (onMenu() ? location.reload() : setTimeout(tryReload, 1000));
    tryReload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      // Installed apps can stay open for days; look for a new build when brought back.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}

registerServiceWorker();
