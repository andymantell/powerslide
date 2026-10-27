// Backs up progress and moves it between copies of the game that don't share
// storage, like Safari and the home screen app on an iPad. One copy turns its
// saved keys into a code, the other merges the code in, keeping the better of
// each. Ported from push-pump-pop.

const PREFIX = 'powerslide.';
const TAG = 'POWERSLIDE:';
// Per-device bookkeeping (and the graphics level, which suits one device) that shouldn't travel.
const LOCAL = ['last-build', 'reload-tries', 'quality'];

function saved(store) {
  const out = {};
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k?.startsWith(PREFIX)) continue;
    const name = k.slice(PREFIX.length);
    if (LOCAL.includes(name)) continue;
    const v = store.getItem(k);
    if (v !== null) out[name] = v;
  }
  return out;
}

const parse = (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

// True once any level has been finished or an endless run scored.
export function hasProgress(store) {
  const s = saved(store);
  return Object.keys(parse(s.levels) || {}).length > 0 || Object.keys(s).some((k) => k.startsWith('best.') && Number(parse(s[k])) > 0);
}

// Base64 of UTF-8, since a road code could hold any character.
const encode = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

export function exportCode(store) {
  return TAG + encode(JSON.stringify(saved(store)));
}

// The better of two saves of one level: stars earned in either, best time and score.
function mergeLevel(a, b) {
  if (!a || typeof a !== 'object') return b;
  if (!b || typeof b !== 'object') return a;
  const times = [a.bestTime, b.bestTime].filter((t) => typeof t === 'number');
  return {
    stars: [0, 1, 2].map((i) => !!(a.stars?.[i] || b.stars?.[i])),
    bestTime: times.length ? Math.min(...times) : null,
    bestScore: Math.max(Number(a.bestScore) || 0, Number(b.bestScore) || 0),
  };
}

// Merges a code into `store`. Returns how many levels it had stars on, or -1 if it isn't a code.
export function importCode(store, text) {
  const at = text.indexOf(TAG);
  if (at < 0) return -1;
  let data;
  try {
    data = JSON.parse(decode(text.slice(at + TAG.length).trim().split(/\s/)[0]));
  } catch {
    return -1;
  }
  if (!data || typeof data !== 'object') return -1;
  let levels = 0;
  for (const [name, v] of Object.entries(data)) {
    if (typeof v !== 'string' || LOCAL.includes(name) || (parse(v) === null && v !== 'null')) continue;
    const k = PREFIX + name;
    const have = store.getItem(k);
    let next = v;
    if (name === 'levels') {
      const mine = parse(have) || {};
      const theirs = parse(v) || {};
      levels = Object.values(theirs).filter((l) => l?.stars?.some(Boolean)).length;
      const out = { ...mine };
      for (const [id, l] of Object.entries(theirs)) out[id] = mergeLevel(mine[id], l);
      next = JSON.stringify(out);
    } else if (name.startsWith('best.')) {
      next = JSON.stringify(Math.max(Number(parse(have)) || 0, Number(parse(v)) || 0));
    } else if (have !== null) {
      next = have; // settings keep this copy's
    }
    store.setItem(k, next);
  }
  return levels;
}
