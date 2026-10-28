// Alpha-tested foliage cards for things built in code rather than grown
// with ez-tree: hedges on the hedge banks, the ferns and grass on their
// faces, and gorse bushes. Each card is a quad textured with a twig or
// tuft (tools/textures/gen.py) whose normal points out of the whole bush,
// so a mass of cards shades as one rounded shape.
import * as THREE from 'three';
import { trackLoad } from './ground.js';
import { boostAlpha } from './forest.js';

const URLS = {
  hawthorn_leaves: new URL('./assets/textures/hawthorn_leaves.png', import.meta.url).href,
  gorse_twig: new URL('./assets/textures/gorse_twig.png', import.meta.url).href,
  fern_tuft: new URL('./assets/textures/fern_tuft.webp', import.meta.url).href,
  grass_tuft: new URL('./assets/textures/grass_tuft.webp', import.meta.url).href,
};

// One material per texture, made on first use.
const mats = {};
export function cardMaterial(name, antialias = false) {
  if (!mats[name]) {
    let tex;
    trackLoad(new Promise((res) => (tex = new THREE.TextureLoader().load(URLS[name], res, undefined, res))));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, alphaToCoverage: !!antialias });
    // Keep the bent normals on both faces.
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);');
      boostAlpha(sh);
    };
    mats[name] = mat;
  }
  return mats[name];
}

// Leaf cards: quads textured with a twig, stem inwards, whose normals all
// point out from their bush so the bush shades as one rounded mass.
export class Cards {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.u = [];
  }

  twig(p, out, size, col, rand) {
    // Grow outwards and a little upwards, wobbled, from just inside the dome.
    const g = new THREE.Vector3(out.x + (rand() - 0.5) * 0.9, out.y + 0.3 + (rand() - 0.5) * 0.6, out.z + (rand() - 0.5) * 0.9).normalize();
    const side = new THREE.Vector3().crossVectors(g, new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5)).normalize();
    const base = p.clone().addScaledVector(g, -size * 0.45);
    const tip = base.clone().addScaledVector(g, size);
    const hw = size * 0.5;
    const corners = [
      [base.clone().addScaledVector(side, -hw), 0, 0],
      [base.clone().addScaledVector(side, hw), 1, 0],
      [tip.clone().addScaledVector(side, hw), 1, 1],
      [tip.clone().addScaledVector(side, -hw), 0, 1],
    ];
    this.quad(corners, out, col);
  }

  // A clump of fern or grass: two crossed cards standing on a sloping face
  // and leaning out from it. `half` picks the left or right clump of the
  // texture.
  tuft(p, along, out, w, h, half, col, rand) {
    const n = new THREE.Vector3(out.x, 1.2, out.z).normalize();
    const lean = new THREE.Vector3(out.x * 0.4, 0.9, out.z * 0.4);
    for (const turn of [0.7, -0.7]) {
      const a = turn + (rand() - 0.5) * 0.4;
      const ax = along.clone().multiplyScalar(Math.cos(a)).addScaledVector(out, Math.sin(a)).normalize();
      const base = p.clone().addScaledVector(lean, -0.12);
      const top = base.clone().addScaledVector(lean, h);
      const u0 = half * 0.5;
      this.quad([
        [base.clone().addScaledVector(ax, -w / 2), u0, 0],
        [base.clone().addScaledVector(ax, w / 2), u0 + 0.5, 0],
        [top.clone().addScaledVector(ax, w / 2), u0 + 0.5, 1],
        [top.clone().addScaledVector(ax, -w / 2), u0, 1],
      ], n, col);
    }
  }

  quad(corners, nrm, col) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [v, s, t] = corners[i];
      this.p.push(v.x, v.y, v.z);
      this.n.push(nrm.x, nrm.y, nrm.z);
      this.c.push(col.r, col.g, col.b);
      this.u.push(s, t);
    }
  }

  build() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// A gorse bush for the props (types gorse and gorse_big): a few overlapping
// spiny domes of flowering twig cards, about 1.8 m across and 1.1 m tall at
// s = 1, standing on the origin.
export function gorseGeometry(s, seed) {
  let a = seed * 9301 + 49297;
  const rand = () => ((a = (a * 9301 + 49297) % 233280) / 233280);
  const cards = new Cards();
  const tint = new THREE.Color();
  for (let k = 0; k < 5; k++) {
    const cx = (rand() - 0.5) * 0.9 * s, cz = (rand() - 0.5) * 0.9 * s;
    const r = (0.45 + rand() * 0.2) * s, h = (0.75 + rand() * 0.35) * s;
    const n = Math.round(40 * s * s);
    for (let i = 0; i < n; i++) {
      const ang = rand() * Math.PI * 2;
      const el = Math.asin(rand() * 1.15 - 0.15);
      const d = 0.6 + rand() * 0.45;
      const out = new THREE.Vector3(Math.cos(ang) * Math.cos(el), Math.sin(el), Math.sin(ang) * Math.cos(el)).normalize();
      const p = new THREE.Vector3(cx + Math.cos(ang) * Math.cos(el) * r * d, Math.max(0.05, Math.sin(el) * h * d), cz + Math.sin(ang) * Math.cos(el) * r * d);
      tint.setScalar(0.5 + 0.35 * (Math.sin(el) * 0.5 + 0.5) + (rand() - 0.5) * 0.1);
      cards.twig(p, out, (0.45 + rand() * 0.25) * Math.sqrt(s), tint.clone(), rand);
    }
  }
  return cards.build();
}
