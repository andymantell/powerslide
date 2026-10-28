# Fetches Poly Haven models (1k glTF and textures) plus their info:
#   python tools/props/audition/fetch_polyhaven.py outDir/ph rock_07 rock_09 ...
import json, os, sys, subprocess
O = sys.argv[1]
def get(u): return subprocess.run(['curl', '-sL', '-m', '120', u], capture_output=True).stdout
for n in sys.argv[2:]:
    d = os.path.join(O, n); os.makedirs(d, exist_ok=True)
    f = json.loads(get(f'https://api.polyhaven.com/files/{n}'))
    open(os.path.join(d, 'info.json'), 'wb').write(get(f'https://api.polyhaven.com/info/{n}'))
    g = f['gltf']['1k']['gltf']
    open(os.path.join(d, f'{n}.gltf'), 'wb').write(get(g['url']))
    for rel, inc in g.get('include', {}).items():
        p = os.path.join(d, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'wb').write(get(inc['url']))
    print('ok', n, flush=True)
