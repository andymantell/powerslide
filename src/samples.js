// Recorded sounds: the MP3s in src/assets/sounds, cut from CC0 recordings by
// tools/sounds/build.py (sources and licences in credits.json). They load
// once when the audio starts and are cached by the service worker with the
// rest of the assets, so they work offline after the first run. A sound with
// variants is saved as name-1.mp3, name-2.mp3...; pick() chooses one.

const URLS = import.meta.glob('./assets/sounds/*.mp3', { eager: true, query: '?url', import: 'default' });

export class Samples {
  constructor(ctx) {
    this.ctx = ctx;
    this.sets = {}; // name -> [AudioBuffer]
  }

  // Resolves when every sound has loaded (or failed: the game plays on
  // without it).
  load() {
    return (this.loading ||= Promise.all(
      Object.entries(URLS).map(async ([path, url]) => {
        try {
          const data = await (await fetch(url)).arrayBuffer();
          // Old Safari only has the callback form.
          const buf = await new Promise((ok, fail) => this.ctx.decodeAudioData(data, ok, fail));
          const file = path.split('/').pop().replace('.mp3', '');
          const name = file.replace(/-\d+$/, '');
          (this.sets[name] ||= []).push(trim(this.ctx, buf));
        } catch (e) {
          console.warn('sound', path, e);
        }
      }),
    ));
  }

  has(name) {
    return !!this.sets[name]?.length;
  }

  get(name) {
    return this.sets[name]?.[0] || null;
  }

  pick(name, r = Math.random) {
    const set = this.sets[name];
    return set?.length ? set[Math.floor(r() * set.length)] : null;
  }
}

// MP3 encoders pad the start and end with silence, which would leave a gap
// in a loop. Decoders that read the padding info drop it already; for the
// rest, cut the silent samples at each end.
function trim(ctx, buf) {
  const d = buf.getChannelData(0);
  let a = 0;
  let b = d.length - 1;
  while (a < b && Math.abs(d[a]) < 1e-4) a++;
  while (b > a && Math.abs(d[b]) < 1e-4) b--;
  if (a === 0 && b === d.length - 1) return buf;
  const out = ctx.createBuffer(1, b - a + 1, buf.sampleRate);
  out.getChannelData(0).set(d.subarray(a, b + 1));
  return out;
}
