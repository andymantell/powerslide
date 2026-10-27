// Quality presets, rider tuning, device detection and persistence.

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable (private mode etc.) */
    }
  },
};
export { store };

export const QUALITY = {
  low: {
    label: 'Low', antialias: false, maxPixelRatio: 1, minPixelRatio: 0.6,
    shadows: true, shadowMap: 1024, shadowExtent: 30,
    nearRadius: 3, nearSegs: 40, farRadius: 2, treeSpacing: 11, fog: 0.0007,
    shadowRadius: 1, skySize: 256, treeLodRadius: 50, grassRadius: 18, grassDensity: 0.7, sparks: 48,
  },
  medium: {
    label: 'Medium', antialias: false, maxPixelRatio: 1.5, minPixelRatio: 0.75,
    shadows: true, shadowMap: 1024, shadowExtent: 38,
    nearRadius: 3, nearSegs: 56, farRadius: 3, treeSpacing: 8.5, fog: 0.00045,
    shadowRadius: 2, skySize: 512, groundDetail: true, treeLodRadius: 75, grassRadius: 32, grassDensity: 1.1, sparks: 96,
  },
  high: {
    label: 'High', antialias: true, maxPixelRatio: 2, minPixelRatio: 0.8,
    shadows: true, shadowMap: 2048, shadowExtent: 45,
    nearRadius: 4, nearSegs: 64, farRadius: 4, treeSpacing: 7, fog: 0.00032,
    shadowRadius: 3, skySize: 512, groundDetail: true, bloom: true, treeLodRadius: 110, grassRadius: 48, grassDensity: 1.5, sparks: 160,
  },
  ultra: {
    label: 'Ultra', antialias: true, maxPixelRatio: 2.5, minPixelRatio: 1,
    shadows: true, shadowMap: 4096, shadowExtent: 55,
    nearRadius: 5, nearSegs: 80, farRadius: 5, treeSpacing: 5.5, fog: 0.00026,
    shadowRadius: 3, skySize: 1024, groundDetail: true, bloom: true, ao: true, treeLodRadius: 170, grassRadius: 70, grassDensity: 1.9, sparks: 256,
  },
};
export const QUALITY_ORDER = ['auto', 'low', 'medium', 'high', 'ultra'];

// Rider tuning. muStatic/muKinetic: wheel grip before and after breaking
// away. carveLimit: how close full lock carves to the grip limit. leanRate:
// how quickly the rider can lean into a turn (rad/s natural frequency).
// recover: how hard the rider straightens out an unintended drift. Speed
// wobbles, highsides and grit are always on; levels set how hard a run is.
export const TUNING = {
  muStatic: 0.95, muKinetic: 0.6, carveLimit: 0.9,
  leanRate: 5.5, recover: 9,
  wobble: true, wobbleSpeed: 20, highside: true, highsideSlip: 1.05, highsideSpeed: 13,
  dirtGrip: 0.55,
  railCrashSpeed: 4.5,
};

// Traffic for endless mode; levels set their own.
export const ENDLESS_TRAFFIC = { density: 1.4, speed: 1.2 };

export function detectDevice() {
  const ua = navigator.userAgent || '';
  const touch = navigator.maxTouchPoints > 1;
  if (/Xbox/i.test(ua)) return 'xbox';
  // iPadOS reports a desktop Mac user agent; touch support gives it away.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'ipad';
  if (/iPhone|iPod/.test(ua)) return 'phone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'phone' : 'tablet';
  return 'desktop';
}

export function autoQuality(device) {
  switch (device) {
    case 'phone':
      return 'low';
    case 'ipad':
    case 'tablet':
      return 'medium';
    default:
      return 'high';
  }
}

export function loadSettings() {
  const device = detectDevice();
  const qualityChoice = store.get('powerslide.quality', 'auto');
  const quality = qualityChoice === 'auto' ? autoQuality(device) : qualityChoice;
  return {
    device,
    qualityChoice: QUALITY_ORDER.includes(qualityChoice) ? qualityChoice : 'auto',
    quality: QUALITY[quality] ? quality : 'high',
  };
}
