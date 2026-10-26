// Trees. Models come from tools/blender/tree.py (trunk + alpha-tested branch
// cards per variant). Trees near the rider are drawn as full models; the rest
// are camera-facing impostors rendered from those same models at start-up, so
// they match the lighting. Each LOD and variant is one InstancedMesh for the
// whole world, refilled as the rider moves, which keeps draw calls fixed.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundTexture, trackLoad } from './ground.js';

const MODEL = new URL('./assets/models/conifers.glb', import.meta.url).href;
const TWIG = new URL('./assets/textures/spruce_twig.png', import.meta.url).href;
const MAX_FULL = 1200;
const MAX_IMP = 24000;
const IMP_W = 256;
const IMP_H = 512;

// Mipmapping averages alpha away, so distant cards would thin out and
// vanish under alpha testing; scale alpha back up with the mip level.
export function boostAlpha(shader, size = 512) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <alphatest_fragment>',
    `{
      vec2 dt = max(abs(dFdx(vMapUv)), abs(dFdy(vMapUv))) * vec2(${size.toFixed(1)}, ${size.toFixed(1)});
      diffuseColor.a *= 1.0 + max(0.0, log2(max(dt.x, dt.y))) * 0.35;
    }
    #include <alphatest_fragment>`,
  );
}

// Bakes soft self-occlusion into vertex colours: needles deep inside the
// crown and low down are darker. Also bends normals outward from the trunk so
// the cards shade as one volume rather than as flat planes.
function shapeFoliage(geo, H) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  let maxR = 0.01;
  for (let i = 0; i < pos.count; i++) maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getZ(i)));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const crownR = maxR * Math.max(0.08, 1 - y / H); // conical envelope
    const outer = Math.min(1, r / crownR);
    const ao = (0.4 + 0.6 * outer ** 1.5) * (0.7 + 0.3 * (y / H));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
    v.set(x, Math.max(0.35, 0.9 - y / H) * crownR * 0.6, z).normalize();
    v.y += 0.35;
    v.normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

export class Forest {
  constructor(scene, renderer, q = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.fullRadius = q.treeLodRadius ?? 90;
    this.variants = [];
    this.ready = false;
    this.lastX = Infinity;
    this.lastZ = Infinity;
    this.dirty = true;
    this.sources = new Set(); // Float32Arrays of [x, y, z, scale, yaw, variant, tint]

    let twigLoaded;
    const twig = new THREE.TextureLoader().load(TWIG, () => twigLoaded());
    const twigReady = new Promise((res) => (twigLoaded = res));
    twig.colorSpace = THREE.SRGBColorSpace;
    twig.anisotropy = 4;
    this.foliageMat = new THREE.MeshStandardMaterial({
      map: twig,
      vertexColors: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 1,
      alphaToCoverage: !!q.antialias,
    });
    // Keep the bent normals on both faces (no back-face flip) and add a touch
    // of light through the needles when looking towards the sun.
    this.foliageMat.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n  normal = normalize(vNormal);',
      );
      boostAlpha(s);
    };
    this.foliageMat.customProgramCacheKey = () => 'foliage';
    this.barkMat = new THREE.MeshStandardMaterial({
      map: groundTexture('bark', 'albedo', renderer),
      normalMap: groundTexture('bark', 'normal', renderer),
      roughness: 0.95,
    });

    trackLoad(
      // The impostor bake needs the twig texture, so wait for both.
      Promise.all([new GLTFLoader().loadAsync(MODEL), twigReady]).then(([gltf]) => this.build(gltf)),
    );
  }

  build(gltf) {
    const byName = {};
    gltf.scene.traverse((o) => {
      if (o.isMesh) byName[o.name] = o.geometry;
    });
    for (let v = 0; byName[`spruce${v}_trunk`]; v++) {
      const trunk = byName[`spruce${v}_trunk`];
      const fol = byName[`spruce${v}_foliage`];
      fol.computeBoundingBox();
      const H = fol.boundingBox.max.y;
      shapeFoliage(fol, H);
      const t = new THREE.InstancedMesh(trunk, this.barkMat, MAX_FULL);
      const f = new THREE.InstancedMesh(fol, this.foliageMat, MAX_FULL);
      for (const m of [t, f]) {
        m.count = 0;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        this.scene.add(m);
      }
      f.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FULL * 3), 3);
      const w = Math.max(fol.boundingBox.max.x - fol.boundingBox.min.x, fol.boundingBox.max.z - fol.boundingBox.min.z);
      this.variants.push({ trunk: t, foliage: f, H, W: w, imp: null });
    }
    this.bakeImpostors();
    this.ready = true;
    this.dirty = true;
  }

  // Side-on renders of each variant under flat light: the impostor shader
  // relights them with fanned normals so they still read as round crowns.
  bakeImpostors() {
    const r = this.renderer;
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight('#ffffff', Math.PI));
    const rt = new THREE.WebGLRenderTarget(IMP_W * this.variants.length, IMP_H, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prev = { target: r.getRenderTarget(), tone: r.toneMapping, clear: r.getClearAlpha() };
    const clearCol = r.getClearColor(new THREE.Color());
    r.setRenderTarget(rt);
    r.toneMapping = THREE.NoToneMapping;
    r.setClearColor('#2e4228', 0);
    r.clear();
    const basicF = new THREE.MeshBasicMaterial({ map: this.foliageMat.map, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide });
    basicF.onBeforeCompile = (s) => boostAlpha(s);
    const basicT = new THREE.MeshBasicMaterial({ map: this.barkMat.map });
    this.variants.forEach((v, i) => {
      scene.clear();
      scene.add(new THREE.AmbientLight('#ffffff', Math.PI));
      scene.add(new THREE.Mesh(v.foliage.geometry, basicF), new THREE.Mesh(v.trunk.geometry, basicT));
      const half = Math.max(v.W * 0.5, v.H * 0.25) * 1.02;
      v.impW = half * 2;
      const cam = new THREE.OrthographicCamera(-half, half, v.H * 1.02, 0, 0.1, 100);
      cam.position.set(0, 0, 40);
      r.setViewport(i * IMP_W, 0, IMP_W, IMP_H);
      r.setScissor(i * IMP_W, 0, IMP_W, IMP_H);
      r.setScissorTest(true);
      r.render(scene, cam);
    });
    r.setScissorTest(false);
    r.setRenderTarget(prev.target);
    r.setViewport(0, 0, r.domElement.width / r.getPixelRatio(), r.domElement.height / r.getPixelRatio());
    r.toneMapping = prev.tone;
    r.setClearColor(clearCol, prev.clear);
    basicF.dispose();
    basicT.dispose();
    rt.texture.generateMipmaps = true;

    const n = this.variants.length;
    this.variants.forEach((v, i) => {
      const geo = new THREE.PlaneGeometry(v.impW, v.H * 1.02);
      geo.translate(0, v.H * 0.51, 0);
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / n);
      const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.5, roughness: 0.9, alphaToCoverage: false });
      const halfW = (v.impW / 2).toFixed(3);
      mat.onBeforeCompile = (s) => {
        boostAlpha(s, IMP_H);
        s.vertexShader = s.vertexShader
          .replace(
            '#include <defaultnormal_vertex>',
            `#include <defaultnormal_vertex>
            vec3 bbC = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            vec3 bbF = cameraPosition - bbC; bbF.y = 0.0; bbF = normalize(bbF);
            vec3 bbR = vec3(bbF.z, 0.0, -bbF.x);
            float bbS = length(instanceMatrix[0].xyz);
            vec3 bbN = normalize(bbR * (position.x / ${halfW}) * 0.9 + bbF * 0.6 + vec3(0.0, 0.35, 0.0));
            transformedNormal = normalize((viewMatrix * vec4(bbN, 0.0)).xyz);`,
          )
          .replace(
            '#include <project_vertex>',
            `vec4 mvPosition = viewMatrix * vec4(bbC + bbR * position.x * bbS + vec3(0.0, position.y * length(instanceMatrix[1].xyz), 0.0), 1.0);
            gl_Position = projectionMatrix * mvPosition;`,
          );
      };
      mat.customProgramCacheKey = () => `impostor-${halfW}`;
      const m = new THREE.InstancedMesh(geo, mat, MAX_IMP);
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_IMP * 3), 3);
      this.scene.add(m);
      v.imp = m;
    });
  }

  add(arr) {
    this.sources.add(arr);
    this.dirty = true;
  }

  remove(arr) {
    this.sources.delete(arr);
    this.dirty = true;
  }

  update(px, pz) {
    if (!this.ready) return;
    if (!this.dirty && Math.hypot(px - this.lastX, pz - this.lastZ) < 8) return;
    this.dirty = false;
    this.lastX = px;
    this.lastZ = pz;
    const r2 = this.fullRadius * this.fullRadius;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    const nv = this.variants.length;
    const full = new Array(nv).fill(0);
    const imp = new Array(nv).fill(0);
    for (const arr of this.sources) {
      for (let i = 0; i < arr.length; i += 7) {
        const x = arr[i], z = arr[i + 2];
        const v = this.variants[arr[i + 5] % nv];
        const k = arr[i + 5] % nv;
        const sc = arr[i + 3];
        const tint = arr[i + 6];
        c.setRGB(0.85 + tint * 0.3, 0.9 + tint * 0.2, 0.85 + (1 - tint) * 0.2);
        const d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 < r2 && full[k] < MAX_FULL) {
          q.setFromAxisAngle(up, arr[i + 4]);
          m.compose(p.set(x, arr[i + 1], z), q, s.set(sc, sc, sc));
          v.trunk.setMatrixAt(full[k], m);
          v.foliage.setMatrixAt(full[k], m);
          v.foliage.setColorAt(full[k], c);
          full[k]++;
        } else if (imp[k] < MAX_IMP) {
          m.compose(p.set(x, arr[i + 1], z), q.identity(), s.set(sc, sc, sc));
          v.imp.setMatrixAt(imp[k], m);
          v.imp.setColorAt(imp[k], c);
          imp[k]++;
        }
      }
    }
    this.variants.forEach((v, k) => {
      for (const mesh of [v.trunk, v.foliage]) {
        mesh.count = full[k];
        mesh.instanceMatrix.needsUpdate = true;
      }
      v.foliage.instanceColor.needsUpdate = true;
      v.imp.count = imp[k];
      v.imp.instanceMatrix.needsUpdate = true;
      v.imp.instanceColor.needsUpdate = true;
    });
  }
}
