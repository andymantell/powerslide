// Spots a newer deploy and offers a reload, listing what's new. The build writes
// version.json next to index.html with the same ID and changelog that are baked
// into this bundle (see vite.config.js), so any changelog line we don't have is news.
// Ported from push-pump-pop.
/* global __BUILD_ID__, __BUILD_TIME__, __CHANGELOG__ */

const POLL_MS = 60_000;
// How soon to look again when a new build is out but the CDN still hands back the old page.
const RETRY_MS = 15_000;
const MAX_NOTES = 4;
// sessionStorage key holding how many reloads we've tried to reach the latest build.
const TRIES_KEY = 'powerslide.reload-tries';
const MAX_TRIES = 3;
// localStorage key remembering the last build this device ran, to tell what's new since.
const LAST_KEY = 'powerslide.last-build';
const MAX_UPDATES = 12;

// Whether version.json describes a build newer than this one. Comparing build times
// as well as IDs means a stale copy (from a cache or the offline service worker)
// can never pass for an update.
function newer(v) {
  return !!v && typeof v.id === 'string' && v.id !== __BUILD_ID__ && typeof v.time === 'string' && v.time > __BUILD_TIME__;
}

async function fetchVersion() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null; // offline or mid-deploy: try again later
  }
}

// Reloads onto `id`, clearing anything that could hand back the old page first.
async function reloadTo(id, tries) {
  try {
    sessionStorage.setItem(TRIES_KEY, String(tries));
  } catch { /* storage unavailable */ }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch { /* nothing to clear */ }
  // A fresh query string makes iOS Safari and the GitHub Pages CDN fetch a new
  // index.html instead of a cached one that points at the old bundle.
  const next = new URL(location.href);
  next.searchParams.set('v', `${id}-${tries}-${Date.now().toString(36)}`);
  location.replace(next);
}

// Which build a fresh copy of index.html would give us right now (from its build-id meta tag).
async function servedBuild() {
  try {
    const res = await fetch(`./?v=probe-${Date.now().toString(36)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.text()).match(/<meta name="build-id" content="([^"]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function readTries() {
  try {
    return Number(sessionStorage.getItem(TRIES_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Starts polling. Hooks:
 *  inRun()     whether a run is on: then the prompt is a small chip, and tapping it
 *              calls leaveRun() so the notes show on the menu before reloading
 *  leaveRun()  end the run and go back to the title screen
 *  showNews()  / hideNews()  open and close the What's New panel (#whatsnew)
 *  onMenu()    whether the title screen is up, so What's New can wait for it
 */
export function watchForUpdates({ inRun, leaveRun, showNews, hideNews, onMenu }) {
  // Drop the cache-busting ?v= left by a previous reload so the URL stays clean.
  const url = new URL(location.href);
  if (url.searchParams.has('v')) {
    url.searchParams.delete('v');
    history.replaceState(null, '', url);
  }

  // Small version label on the title screen, so you can tell which build you have.
  const label = document.createElement('div');
  label.id = 'buildinfo';
  const built = new Date(__BUILD_TIME__);
  label.textContent = `Version ${__BUILD_ID__.slice(0, 7)} · ${built.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  const title = document.getElementById('title');

  // Which updates are new since the build this device last ran.
  let last = null;
  try {
    last = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null');
    localStorage.setItem(LAST_KEY, JSON.stringify({ id: __BUILD_ID__, time: __BUILD_TIME__ }));
  } catch { /* storage unavailable */ }
  const changed = !!last?.time && last.id !== __BUILD_ID__;
  const fresh = changed ? __CHANGELOG__.filter((u) => u.time > last.time).length : 0;

  // "What's new" lists the latest updates, one section per update, newest first,
  // with the ones you've just got marked NEW.
  const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const news = document.getElementById('whatsnew');
  news.innerHTML = '<h2>WHAT’S NEW</h2>'
    + (fresh ? `<p class="since">You just got ${fresh === 1 ? '1 new update' : `${fresh} new updates`}!</p>` : '')
    + '<div class="guide">'
    + __CHANGELOG__.slice(0, Math.max(MAX_UPDATES, fresh)).map((u, i) => `<section${i < fresh ? ' class="fresh"' : ''}><h3>${i < fresh ? '<em>NEW</em> ' : ''}Update · ${esc(when(u.time))}</h3><ul>${u.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`).join('')
    + '</div><button class="secondary">BACK</button>';
  // What's New only opens over the title screen; until the game gets there, hold it.
  let pending = false;
  const openNews = () => {
    if (onMenu()) showNews();
    else pending = true;
  };
  news.querySelector('button').addEventListener('click', hideNews);
  const newsBtn = document.createElement('button');
  newsBtn.className = 'secondary';
  newsBtn.id = 'newsbtn';
  newsBtn.textContent = 'WHAT’S NEW';
  newsBtn.addEventListener('click', showNews);
  title?.querySelector('.btns')?.append(newsBtn);
  title?.append(label);
  // Got a new version (by the update button or any other reload): show what came in.
  if (fresh) openNews();

  const known = new Set(__CHANGELOG__.flatMap((e) => e.items));
  let latest = null;
  let notes = [];
  let shown = '';
  let collapsed = false;

  const box = document.createElement('div');
  box.id = 'update';
  box.className = 'hidden';
  box.addEventListener('click', (e) => {
    const action = e.target.closest('[data-act]')?.getAttribute('data-act');
    if (inRun()) {
      collapsed = false;
      leaveRun();
      render();
      return;
    }
    if (action === 'later') {
      collapsed = true;
      render();
      return;
    }
    if (action !== 'reload') {
      collapsed = false;
      render();
      return;
    }
    box.innerHTML = '<b>Reloading…</b>';
    reloadTo(latest ?? 'latest', 1);
  });
  document.body.appendChild(box);

  // In a run: a small chip up top. On menus: the notes with Reload and Later, or
  // after Later, a small pill at the bottom that opens them again.
  const render = () => {
    if (pending && onMenu()) {
      pending = false;
      showNews();
    }
    box.classList.toggle('hidden', !latest);
    const compact = inRun();
    const key = `${compact}|${collapsed}|${notes.join('\n')}`;
    if (key === shown) return;
    shown = key;
    box.classList.toggle('compact', compact);
    box.classList.toggle('pill', !compact && collapsed);
    if (compact || collapsed) {
      box.innerHTML = `<button><b>↻ ${notes.length ? 'What’s new?' : 'Update'}</b></button>`;
      return;
    }
    const more = notes.length - MAX_NOTES;
    box.innerHTML = '<b>New version!</b>'
      + (notes.length ? `<ul>${notes.slice(0, MAX_NOTES).map((n) => `<li>${esc(n)}</li>`).join('')}${more > 0 ? `<li class="more">and ${more} more</li>` : ''}</ul>` : '')
      + '<div class="acts"><button data-act="reload">RELOAD</button><button data-act="later" class="alt">LATER</button></div>';
  };
  // Cheap check so the prompt follows runs starting and ending.
  setInterval(render, 500);
  if (__BUILD_ID__ === 'dev') return;

  let checking = false;
  let retry = 0;
  const check = async () => {
    if (checking) return;
    checking = true;
    clearTimeout(retry);
    try {
      const v = await fetchVersion();
      // The live build is this one after all: take down any prompt.
      if (v?.id === __BUILD_ID__) {
        latest = null;
        return;
      }
      if (!newer(v) || v.id === latest) return;
      // Only offer it once a reload would really load it, so the button never shows
      // for a build we can't get yet. Until then look again soon, not at the next poll.
      if ((await servedBuild()) !== v.id) {
        retry = setTimeout(check, RETRY_MS);
        return;
      }
      latest = v.id;
      if (Array.isArray(v.changelog)) {
        notes = v.changelog
          .flatMap((e) => (Array.isArray(e.items) ? e.items : []))
          .filter((s) => typeof s === 'string' && !known.has(s));
      }
    } finally {
      checking = false;
    }
  };

  // Just reloaded for an update: make sure it took. If we still have an old build,
  // try again with a new URL; if it worked, say so.
  const tries = readTries();
  if (tries > 0) {
    fetchVersion().then((v) => {
      const id = typeof v?.id === 'string' ? v.id : null;
      if (newer(v) && tries < MAX_TRIES) {
        reloadTo(v.id, tries + 1);
        return;
      }
      try {
        sessionStorage.removeItem(TRIES_KEY);
      } catch { /* storage unavailable */ }
      if (id === __BUILD_ID__) {
        if (!fresh) openNews();
        const done = document.createElement('div');
        done.id = 'updated';
        done.textContent = '✓ Updated to the latest version';
        document.body.appendChild(done);
        setTimeout(() => done.remove(), 4000);
      }
    });
  }
  check();
  setInterval(check, POLL_MS);
  // Timers sleep while the app is in the background (an iPad home screen app can sit
  // there for days), so look the moment it comes back.
  const wake = () => {
    if (!document.hidden) check();
  };
  document.addEventListener('visibilitychange', wake);
  addEventListener('pageshow', wake);
  addEventListener('focus', wake);
  addEventListener('online', wake);
}
