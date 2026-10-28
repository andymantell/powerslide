"""Builds src/assets/sounds from the recipes in tools/sounds/sounds.json.

For each recipe it downloads the source (once, into tools/sounds/.cache),
checks the licence on the sound's own page (CC0, or CC BY 4.0 where the
recipe says "licence": "CC-BY-4.0" because Andy agreed to it), cuts the loop or the
one-shots, filters, normalises and saves a mono MP3. It records where each
file came from in tools/sounds/sources.json and in credits.json's "assets".

    python3 tools/sounds/build.py            # build what's missing or changed
    python3 tools/sounds/build.py --all      # rebuild every file
    python3 tools/sounds/build.py roll wind-grass

Needs numpy, scipy and ffmpeg (with libmp3lame). Sources:
- Freesound (https://freesound.org/people/<user>/sounds/<id>/): the page must
  link the CC0 deed; we download its high-quality preview MP3.
- BigSoundBank (https://bigsoundbank.com/<slug>-s<id>.html): the page must say
  "License CC0"; we download its OGG.
- kenney:<pack>/<path glob>: a Kenney pack unzipped into .cache/kenney/<pack>
  (download it from https://kenney.nl/assets/<pack>); its License.txt must say
  CC0. A glob matching several files makes variants.
"""
import datetime
import fnmatch
import hashlib
import html
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfiltfilt

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'tools' / 'sounds'
CACHE = HERE / '.cache'
OUT = ROOT / 'src' / 'assets' / 'sounds'
LOCK = HERE / 'sources.json'
CREDITS = ROOT / 'credits.json'
RATE = 44100
CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/'
CC_BY = 'https://creativecommons.org/licenses/by/4.0/'


def fetch(url):
    # Freesound turns away quick bursts of requests now and then; wait and retry.
    for i in range(8):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (403, 429, 503) or i == 7:
                sys.exit(f'{url}: {e}')
            time.sleep(15 * (i + 1))


def page_info(src, licence='CC0-1.0'):
    """Title, author, licence and download URL from a sound's own page."""
    if src.startswith('kenney:'):
        pack = src[7:].split('/')[0]
        lic = (CACHE / 'kenney' / pack / 'License.txt').read_text(errors='replace')
        if 'CC0' not in lic and 'Creative Commons Zero' not in lic:
            sys.exit(f'{src}: License.txt is not CC0')
        title = re.search(r'^\s*(.+?)\s*\(\d', lic, re.M)
        return {'title': title.group(1) if title else pack, 'author': 'Kenney', 'page': f'https://kenney.nl/assets/{pack}'}
    page = fetch(src).decode('utf8', 'replace')
    if 'freesound.org' in src:
        lics = set(re.findall(r'creativecommons\.org/(publicdomain/zero|licenses/[a-z-]+)/([0-9.]+)', page))
        want = {'CC0-1.0': ('publicdomain/zero', '1.0'), 'CC-BY-4.0': ('licenses/by', '4.0')}[licence]
        if lics != {want}:
            sys.exit(f'{src}: licence is {sorted(lics)}, not {licence}')
        title = html.unescape(re.search(r'<title>Freesound - (.*?) by [^<]*</title>', page, re.S).group(1)).strip()
        author = re.search(r'freesound\.org/people/([^/]+)/', src).group(1)
        prev = re.search(r'https://cdn\.freesound\.org/previews/[^"]*-hq\.mp3', page).group(0)
        return {'title': title, 'author': urllib.parse.unquote(author), 'page': src, 'download': prev, 'licence': licence}
    if 'bigsoundbank.com' in src:
        text = re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', ' ', page))
        if 'License CC0 (public domain): Free and royalty-free' not in text:
            sys.exit(f'{src}: the page does not say "License CC0"')
        title = html.unescape(re.search(r"<h1[^>]*>([^<]*)", page).group(1)).strip()
        author = re.search(r'Author : (.+?) Sound number', text)
        num = re.search(r'-s(\d+)\.html', src).group(1)
        return {'title': title, 'author': html.unescape(author.group(1)).title() if author else 'Joseph Sardin', 'page': src,
                'download': f'https://bigsoundbank.com/UPLOAD/ogg/{num}.ogg'}
    sys.exit(f'{src}: unknown source')


def source_files(src, info):
    if src.startswith('kenney:'):
        pack, pattern = src[7:].split('/', 1)
        base = CACHE / 'kenney' / pack
        files = sorted(p for p in base.rglob('*') if fnmatch.fnmatch(str(p.relative_to(base)), pattern))
        if not files:
            sys.exit(f'{src}: no files match')
        return files
    path = CACHE / (hashlib.sha1(info['download'].encode()).hexdigest()[:12] + Path(info['download']).suffix)
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(fetch(info['download']))
    return [path]


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def filt(x, r):
    if r.get('hp'):
        x = sosfiltfilt(butter(2, r['hp'], 'highpass', fs=RATE, output='sos'), x)
    if r.get('lp'):
        x = sosfiltfilt(butter(2, r['lp'], 'lowpass', fs=RATE, output='sos'), x)
    return x


def envelope(x, win=0.05):
    n = max(1, int(RATE * win))
    frames = len(x) // n
    return np.sqrt(np.mean(x[: frames * n].reshape(frames, n) ** 2, axis=1) + 1e-12), n


def make_loop(x, r):
    """The steadiest stretch of `loop` seconds, crossfaded into itself."""
    secs = min(r['loop'], (len(x) / RATE - 0.7) / 1.25)
    if secs < r['loop']:
        print(f"  {r['name']}: source is short, so the loop is {secs:.1f} s")
    L = int(secs * RATE)
    xf = int(min(1.0, secs * 0.25) * RATE)
    if 'at' in r:
        start = int(r['at'][0] * RATE)
    else:
        env, n = envelope(x)
        db = 20 * np.log10(env)
        w = (L + xf) // n + 1
        edge = int(0.3 * RATE) // n
        best, start = None, 0
        for i in range(edge, max(edge + 1, len(db) - w - edge)):
            seg = db[i:i + w]
            # Steady (small spread), loud, no gaps and no clipping.
            score = np.std(seg) - 0.5 * np.mean(seg) + 10 * np.mean(seg < np.max(db) - 30) + (50 if np.max(np.abs(x[i * n:i * n + L + xf])) > 0.99 else 0)
            if best is None or score < best:
                best, start = score, i * n
    seg = x[start:start + L + xf]
    if len(seg) < L + xf:
        sys.exit(f"{r['name']}: source too short for a {r['loop']} s loop")
    out = seg[:L].copy()
    t = np.linspace(0, np.pi / 2, xf)
    out[:xf] = seg[:xf] * np.sin(t) + seg[L:L + xf] * np.cos(t)
    return [level(out)], f'a {secs:.3g} s loop from {start / RATE:.1f} s, crossfaded'


def level(x, db=-20):
    """Brings a loop to `db` RMS, softly limiting peaks (rain drops, gravel
    clicks) rather than leaving the whole loop quiet."""
    x = x * min(10 ** (db / 20) / np.sqrt(np.mean(x ** 2)), 4 * 0.89 / np.max(np.abs(x)))
    a = np.abs(x)
    knee = 0.6
    over = a > knee
    x[over] = np.sign(x[over]) * (knee + 0.38 * np.tanh((a[over] - knee) / 0.38))
    return x


def fade(x, fin=0.005, fout=0.05):
    a, b = int(fin * RATE), int(min(fout, len(x) / RATE * 0.3) * RATE)
    x = x.copy()
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b) ** 2
    return x


def peak(x, db=-1):
    return x * (10 ** (db / 20) / max(np.max(np.abs(x)), 1e-9))


def make_shots(x, r):
    """The loudest `shots` separate events, each at most `max` seconds."""
    env, n = envelope(x, 0.01)
    floor = np.percentile(env, 20)
    thr = max(np.max(env) * 0.12, floor * 3)
    on = env > thr
    # Join bursts closer than 0.15 s into one event.
    events, i = [], 0
    gap = int(0.3 / 0.01)
    while i < len(on):
        if not on[i]:
            i += 1
            continue
        j = i
        while j < len(on) and (on[j] or on[j:j + gap].any()):
            j += 1
        # Keep the decay: run on until the sound falls 30 dB below its peak
        # (or to the background).
        tail = max(np.max(env[i:j]) * 0.03, floor * 1.5)
        while j < len(env) and env[j] > tail:
            j += 1
        events.append((i, j))
        i = j
    events.sort(key=lambda e: -np.max(env[e[0]:e[1]]))
    events = sorted(events[: r.get('shots', 1)])
    mx = int(r.get('max', 3) * RATE)
    outs = []
    for a, b in events:
        s = max(0, a * n - int(0.02 * RATE))
        e = min(len(x), b * n + int(0.15 * RATE), s + mx)
        outs.append(peak(fade(x[s:e])))
    return outs, f'cut {len(outs)} event(s) of up to {r.get("max", 3)} s'


def make_chunks(x, r):
    """`chunks` stretches of `len` seconds where the sound is loudest, for
    sounds that never stop (a herd's bells, a skylark, waves)."""
    L = int(r['len'] * RATE)
    env, n = envelope(x, 0.05)
    w = max(1, L // n)
    energy = np.convolve(env ** 2, np.ones(w), 'valid')
    outs, taken = [], []
    for i in np.argsort(-energy):
        if len(taken) == r['chunks']:
            break
        if any(abs(i - t) < w for t in taken):
            continue
        taken.append(i)
    for i in sorted(taken):
        outs.append(peak(fade(x[i * n:i * n + L], 0.15, 0.6)))
    return outs, f'cut {len(outs)} stretch(es) of {r["len"]} s'


def make_whole(x, r):
    if 'at' in r:
        x = x[int(r['at'][0] * RATE):int(r['at'][1] * RATE)]
        how = f'cut {r["at"][0]}-{r["at"][1]} s'
    else:
        nz = np.nonzero(np.abs(x) > 10 ** (-50 / 20))[0]
        x = x[nz[0]:nz[-1] + 1] if len(nz) else x
        x = x[: int(r.get('max', 5) * RATE)]
        how = 'trimmed'
    return [peak(fade(x, 0.002, 0.03))], how


def encode(x, path, loop):
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    # Beds and loops get a little more bitrate: noisy sounds smear at low rates.
    q = '4' if loop else '5'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', '-',
                    '-c:a', 'libmp3lame', '-q:a', q, '-map_metadata', '-1', str(path)], input=pcm, check=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    rebuild = '--all' in sys.argv
    recipes = json.loads((HERE / 'sounds.json').read_text())['sounds']
    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    OUT.mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().isoformat()
    # Names with several recipes or shots become numbered variants.
    variants = {}
    for r in recipes:
        variants.setdefault(r['name'], []).append(r)
    made = {}
    for r in recipes:
        key = r['name'] + '#' + str(r.get('first', 1))
        numbered = len(variants[r['name']]) > 1 or r.get('shots', 1) > 1 or r.get('chunks', 1) > 1 or ('*' in r['src'])
        src = r['src']
        info = lock.get(src)
        if not info:
            info = {**page_info(src, r.get('licence', 'CC0-1.0')), 'downloaded': today}
            lock[src] = info
            LOCK.write_text(json.dumps(lock, indent=1, ensure_ascii=False) + '\n')
        stamp = hashlib.sha1(json.dumps(r, sort_keys=True).encode()).hexdigest()[:10]
        prev = info.get('built', {}).get(key)
        files = [OUT / f for f in prev['files']] if prev else []
        if prev and prev['stamp'] == stamp and all(f.exists() for f in files) and not rebuild and r['name'] not in args:
            made[key] = (src, prev['files'], prev['how'])
            continue
        if args and r['name'] not in args and prev:
            made[key] = (src, prev['files'], prev['how'])
            continue
        outs, hows = [], []
        for p in source_files(src, info):
            x = filt(decode(p), r)
            if 'loop' in r:
                o, how = make_loop(x, r)
            elif 'shots' in r:
                o, how = make_shots(x, r)
            elif 'chunks' in r:
                o, how = make_chunks(x, r)
            else:
                o, how = make_whole(x, r)
            outs += o
            hows.append(how)
        names = []
        for i, o in enumerate(outs):
            name = f"{r['name']}-{r.get('first', 1) + i}.mp3" if numbered else f"{r['name']}.mp3"
            encode(o, OUT / name, 'loop' in r)
            names.append(name)
        how = hows[0] + (', filtered' if r.get('hp') or r.get('lp') else '') + ', mono, normalised, MP3'
        info.setdefault('built', {})[key] = {'stamp': stamp, 'files': names, 'how': how}
        made[key] = (src, names, how)
        LOCK.write_text(json.dumps(lock, indent=1, ensure_ascii=False) + '\n')
        print(f"{r['name']}: {', '.join(names)} ({how})")
    # Drop files no recipe makes any more.
    keep = {f for _, files, _ in made.values() for f in files}
    for f in OUT.glob('*.mp3'):
        if f.name not in keep:
            f.unlink()
            print('removed', f.name)
    for src in list(lock):
        lock[src]['built'] = {k: v for k, v in lock[src].get('built', {}).items() if k in made}
        if not lock[src]['built']:
            del lock[src]
    LOCK.write_text(json.dumps(lock, indent=1, ensure_ascii=False) + '\n')
    write_credits(lock)
    total = sum(f.stat().st_size for f in OUT.glob('*.mp3'))
    print(f'{len(keep)} files, {total / 1e6:.1f} MB')


def write_credits(lock):
    credits = json.loads(CREDITS.read_text())
    entries = [a for a in credits['assets'] if not all(f.startswith('src/assets/sounds/') for f in a['files'])]
    for src, info in lock.items():
        files = sorted({f for b in info['built'].values() for f in b['files']})
        hows = sorted({b['how'] for b in info['built'].values()})
        licence = info.get('licence', 'CC0-1.0')
        entry = {
            'title': f"{info['title']} by {info['author']}",
            'files': [f'src/assets/sounds/{f}' for f in files],
            'source': info['page'],
            'author': info['author'],
            'licence': licence,
            'licenceUrl': CC0 if licence == 'CC0-1.0' else CC_BY,
            'downloaded': info['downloaded'],
            'changes': '; '.join(hows) + ' (tools/sounds/build.py)',
        }
        if licence != 'CC0-1.0':
            entry['attribution'] = f'"{info["title"]}" by {info["author"]} (freesound.org), CC BY 4.0, cut and normalised'
        entries.append(entry)
    credits['assets'] = entries
    CREDITS.write_text(json.dumps(credits, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
