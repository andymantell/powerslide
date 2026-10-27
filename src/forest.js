// Trees. Models come from tools/blender/tree.py (trunk + alpha-tested branch
// cards per variant). Trees near the rider are drawn as full models; the rest
// are camera-facing impostors rendered from those same models at start-up, so
// they match the lighting. Each LOD and variant is one InstancedMesh for the
// whole world, refilled as the rider moves, which keeps draw calls fixed.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundTexture, trackLoad } from './ground.js';
import { ENV } from './sky.js';

// When it's snowing, needles facing the sky carry a layer of snow.
const snowOnTop = () => `
  if (${ENV.snow ? 1 : 0} == 1) {
    float snowUp = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), smoothstep(0.4, 0.85, snowUp) * 0.75);
  }`;

const MODEL = new URL('./assets/models/conifers.glb', import.meta.url).href;
const TWIG = new URL('./assets/textures/spruce_twig.png', import.meta.url).href;
const MAX_FULL = 1200;
const MAX_IMP = 24000;
const IMP_W = 256;
const IMP_H = 512;
const IMP_VIEWS = 4; // baked azimuths per variant

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
  // species: the mesh name prefix in conifers.glb (tools/blender/tree.py SPECIES).
  constructor(scene, renderer, q = {}, species = 'spruce') {
    this.species = species;
    this.scene = scene;
    this.renderer = renderer;
    this.fullRadius = q.treeLodRadius ?? 90;
    this.antialias = !!q.antialias;
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
        '#include <normal_fragment_begin>\n  normal = normalize(vNormal);' + snowOnTop(),
      );
      boostAlpha(s);
    };
    this.foliageMat.customProgramCacheKey = () => `foliage-${ENV.snow}`;
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
    for (let v = 0; byName[`${this.species}${v}_trunk`]; v++) {
      const trunk = byName[`${this.species}${v}_trunk`];
      const fol = byName[`${this.species}${v}_foliage`];
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

  // Side-on renders of each variant from several sides: colour under flat
  // light (with the baked crown AO), plus a matching normal map so the
  // impostor shader can light them like the full trees.
  bakeImpostors() {
    const r = this.renderer;
    const scene = new THREE.Scene();
    // Mipmapped, so distant impostors filter smoothly instead of sparkling.
    // Deliberately plain targets (no multisampling, no sRGB format) and
    // shaders that write every pixel's alpha themselves, background included:
    // on iPad the multisampled sRGB bake came back with solid alpha, which
    // drew distant trees as dark rectangles.
    const cols = this.variants.length * IMP_VIEWS;
    const opts = { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, depthBuffer: true };
    const rt = new THREE.WebGLRenderTarget(IMP_W * cols, IMP_H, opts);
    const rtN = new THREE.WebGLRenderTarget(IMP_W * cols, IMP_H, opts);
    const prev = { target: r.getRenderTarget(), tone: r.toneMapping, clear: r.getClearAlpha(), autoClear: r.autoClear };
    const clearCol = r.getClearColor(new THREE.Color());
    r.toneMapping = THREE.NoToneMapping;
    r.autoClear = false;
    // mode 0: colour (sRGB-encoded by hand), 1: bake-camera-space normal.
    // Foliage is cut out with the same mip-aware alpha boost as in game.
    const bakeMat = (mode, map, vcol, cut) =>
      new THREE.ShaderMaterial({
        defines: { MODE: mode, ...(cut ? { USE_CUT: '' } : {}), ...(vcol ? { USE_VCOL: '' } : {}) },
        uniforms: { map: { value: map } },
        side: THREE.DoubleSide,
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vC;
          #ifdef USE_VCOL
            attribute vec3 color;
          #endif
          void main() {
            vUv = uv; vN = normalize(normalMatrix * normal);
            #ifdef USE_VCOL
              vC = color;
            #else
              vC = vec3(1.0);
            #endif
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vN; varying vec3 vC;
          void main() {
            vec4 t = texture2D(map, vUv);
            #ifdef USE_CUT
              vec2 dt = max(abs(dFdx(vUv)), abs(dFdy(vUv))) * 512.0;
              if (t.a * (1.0 + max(0.0, log2(max(dt.x, dt.y))) * 0.35) < 0.45) discard;
            #endif
            #if MODE == 0
              gl_FragColor = vec4(pow(t.rgb * vC, vec3(1.0 / 2.2)), 1.0);
            #else
              gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0);
            #endif
          }`,
      });
    // A camera-filling quad that writes the background with alpha 0. Its
    // colour bleeds into the mips at the edges, so use foliage green and a
    // viewer-facing normal.
    const bgMat = (rgb) =>
      new THREE.ShaderMaterial({
        depthWrite: false,
        depthTest: false,
        vertexShader: 'void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
        fragmentShader: `void main() { gl_FragColor = vec4(${rgb}, 0.0); }`,
      });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    bg.frustumCulled = false;
    bg.renderOrder = -1;
    const sets = [
      [rt, bakeMat(0, this.foliageMat.map, true, true), bakeMat(0, this.barkMat.map, false, false), bgMat('0.18, 0.26, 0.16')],
      [rtN, bakeMat(1, this.foliageMat.map, false, true), bakeMat(1, this.barkMat.map, false, false), bgMat('0.5, 0.5, 1.0')],
    ];
    for (const [target, mf, mt, mb] of sets) {
      r.setRenderTarget(target);
      bg.material = mb;
      this.variants.forEach((v, i) => {
        scene.clear();
        const tree = new THREE.Group();
        tree.add(new THREE.Mesh(v.foliage.geometry, mf), new THREE.Mesh(v.trunk.geometry, mt));
        scene.add(bg, tree);
        const half = Math.max(v.W * 0.5, v.H * 0.25) * 1.02;
        v.impW = half * 2;
        const cam = new THREE.OrthographicCamera(-half, half, v.H * 1.02, 0, 0.1, 100);
        cam.position.set(0, 0, 40);
        // The same tree from several sides, so impostors don't all show one
        // silhouette and they turn as the rider passes. View a looks from
        // azimuth a * 2pi / IMP_VIEWS in the tree's own frame.
        for (let a = 0; a < IMP_VIEWS; a++) {
          tree.rotation.y = (-a / IMP_VIEWS) * Math.PI * 2;
          const x = (i * IMP_VIEWS + a) * IMP_W;
          // Set the column on the target itself: renderer.setViewport scales
          // by the device pixel ratio even for render targets, which on the
          // iPad (ratio 1.5 to 2) zoomed each tree into its neighbours and
          // drew distant trees as dark rectangles.
          target.viewport.set(x, 0, IMP_W, IMP_H);
          target.scissor.set(x, 0, IMP_W, IMP_H);
          target.scissorTest = true;
          r.setRenderTarget(target);
          r.clearDepth();
          r.render(scene, cam);
        }
      });
    }
    for (const t of [rt, rtN]) {
      t.viewport.set(0, 0, t.width, t.height);
      t.scissor.set(0, 0, t.width, t.height);
      t.scissorTest = false;
    }
    r.setRenderTarget(prev.target);
    r.setViewport(0, 0, r.domElement.width / r.getPixelRatio(), r.domElement.height / r.getPixelRatio());
    r.toneMapping = prev.tone;
    r.setClearColor(clearCol, prev.clear);
    r.autoClear = prev.autoClear;
    for (const set of sets) for (const m of set.slice(1)) m.dispose();
    bg.geometry.dispose();
    this.impTargets = [rt, rtN]; // kept for debugging views

    const n = this.variants.length;
    this.variants.forEach((v, i) => {
      const geo = new THREE.PlaneGeometry(v.impW, v.H * 1.02);
      geo.translate(0, v.H * 0.51, 0);
      const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.5, roughness: 1, alphaToCoverage: this.antialias });
      const halfW = (v.impW / 2).toFixed(3);
      mat.onBeforeCompile = (s) => {
        boostAlpha(s, IMP_H);
        s.uniforms.tImpN = { value: rtN.texture };
        s.fragmentShader = s.fragmentShader
          .replace(
            '#include <map_fragment>',
            `vec4 impT = texture2D(map, vMapUv);
            impT.rgb = pow(impT.rgb, vec3(2.2)); // baked sRGB-encoded by hand
            diffuseColor *= impT;`,
          )
          .replace(
            '#include <alphatest_fragment>',
            // Belt and braces: never draw the card's empty background.
            '#include <alphatest_fragment>\nif (impT.a < 0.02) discard;',
          )
          .replace('#include <common>', '#include <common>\nuniform sampler2D tImpN;\nvarying vec3 vBbR, vBbF;')
          .replace(
            '#include <normal_fragment_maps>',
            `{
              // Baked normal: x right, y up, z towards the viewer.
              vec3 bn = texture2D(tImpN, vMapUv).xyz * 2.0 - 1.0;
              vec3 wn = normalize(vBbR * bn.x + vec3(0.0, bn.y, 0.0) + vBbF * max(bn.z, 0.15));
              // Soften: a flat card can't self-shadow, so full-strength
              // normals read frosty compared with the real trees.
              wn = normalize(mix(vBbF, wn, 0.8));
              normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
            }` + snowOnTop(),
          );
        s.vertexShader = s.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBbR, vBbF;')
          .replace(
            '#include <defaultnormal_vertex>',
            `#include <defaultnormal_vertex>
            vec3 bbC = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            vec3 bbF = cameraPosition - bbC; bbF.y = 0.0; bbF = normalize(bbF);
            vec3 bbR = vec3(bbF.z, 0.0, -bbF.x);
            float bbS = length(instanceMatrix[0].xyz);
            // Pick the baked view nearest the camera's direction in the tree's own frame.
            float bbA = atan(dot(bbF, normalize(instanceMatrix[0].xyz)), dot(bbF, normalize(instanceMatrix[2].xyz)));
            float bbV = mod(floor(bbA / ${(2 * Math.PI / IMP_VIEWS).toFixed(5)} + 0.5) + ${IMP_VIEWS}.0, ${IMP_VIEWS}.0);
            vMapUv.x = (${i * IMP_VIEWS}.0 + bbV + uv.x) / ${n * IMP_VIEWS}.0;
            vBbR = bbR;
            vBbF = bbF;
            transformedNormal = normalize((viewMatrix * vec4(bbF, 0.0)).xyz);`,
          )
          .replace(
            '#include <project_vertex>',
            `vec4 mvPosition = viewMatrix * vec4(bbC + bbR * position.x * bbS + vec3(0.0, position.y * length(instanceMatrix[1].xyz), 0.0), 1.0);
            gl_Position = projectionMatrix * mvPosition;`,
          );
      };
      mat.customProgramCacheKey = () => `impostor-${i}-${halfW}-${ENV.snow}`;
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
          q.setFromAxisAngle(up, arr[i + 4]);
          m.compose(p.set(x, arr[i + 1], z), q, s.set(sc, sc, sc));
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
