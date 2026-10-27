// Traffic models from vehicles.glb (tools/blender/vehicles.py), drawn with
// instancing: every vehicle type is a few InstancedMeshes per level of detail
// (one per material), and all wheels of a style share one, so a road full of
// traffic costs a handful of draw calls. Paint, trim and rim colours come per
// car through the instance colour; lamps read theirs as light levels.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { trackLoad } from './ground.js';

const MODEL = new URL('./assets/models/vehicles.glb', import.meta.url).href;
const PARTS = ['paint', 'trim', 'glass', 'detail', 'lamp'];
const CAP = 12; // instances per type and LoD
const WHEEL_CAP = 96;

// Lamps: the vertex colour says what kind (head lamps have green > 0.8, tail
// lamps green < 0.2, amber in between) and the instance colour carries the
// levels: r = head, g = tail, b = amber/beacon.
function lampMaterial() {
  // Unlit, a lamp is clear glass over a mirror-like reflector.
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.12, metalness: 0.6, vertexColors: true, emissive: '#ffffff' });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampC;\nvarying vec3 vLampK;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        vLampC = color.rgb;
        #ifdef USE_INSTANCING_COLOR
          vLampK = instanceColor.rgb;
        #else
          vLampK = vec3(1.0);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampC;\nvarying vec3 vLampK;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vLampC * 0.45 + 0.06;')
      .replace('#include <emissivemap_fragment>', `
        float lampK = vLampC.g > 0.8 ? vLampK.r : (vLampC.g < 0.2 ? vLampK.g : vLampK.b);
        totalEmissiveRadiance = vLampC * lampK;`);
  };
  m.customProgramCacheKey = () => 'vehicle-lamp';
  return m;
}

function materials(q) {
  const fancy = q.vehicleDetail >= 2;
  const paint = fancy
    ? new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, vertexColors: true })
    : new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.4, roughness: 0.26, vertexColors: true });
  return {
    paint,
    trim: new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.35, vertexColors: true }),
    // Dark dielectric: reflections come from the Fresnel term, strongest at grazing angles.
    glass: new THREE.MeshStandardMaterial({ color: '#06090c', metalness: 0, roughness: 0.04, envMapIntensity: 1.6, vertexColors: true }),
    detail: new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.15, roughness: 0.72, vertexColors: true }),
    lamp: lampMaterial(),
  };
}

// The file is quantised (positions rescaled by the node transform): unpack
// the attributes to floats, bake the transform in, and keep RGB colours.
function unpack(mesh) {
  const g = mesh.geometry;
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3]]) {
    const a = g.attributes[name];
    if (!a) continue;
    const out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      out[i * size] = a.getX(i);
      out[i * size + 1] = a.getY(i);
      out[i * size + 2] = a.getZ(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  mesh.updateWorldMatrix(true, false);
  g.applyMatrix4(mesh.matrixWorld);
  if (g.attributes.normal) g.normalizeNormals();
  return g;
}

const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const ONE = new THREE.Vector3(1, 1, 1);

export class VehicleFleet {
  // q: the quality preset (vehicleLod: LoD switch distance, vehicleDetail).
  constructor(scene, q) {
    this.scene = scene;
    this.q = q;
    this.types = {}; // name -> { meta, lods: [[InstancedMesh per part]] }
    this.wheels = {}; // style -> [[InstancedMesh per part] per lod]
    this.mats = materials(q);
    this.makeExtras(q);
    this.ready = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(MODEL).then((gltf) => this.build(gltf));
    trackLoad(this.ready);
  }

  build(gltf) {
    const nodes = {};
    gltf.scene.traverse((o) => {
      const m = /^(.+)_lod(\d)$/.exec(o.name);
      if (m && (o.isMesh || o.isGroup) && !nodes[o.name]) nodes[o.name] = { o, base: m[1], lod: +m[2] };
    });
    for (const { o, base, lod } of Object.values(nodes)) {
      const meshes = o.isMesh ? [o] : o.children.filter((c) => c.isMesh);
      const wheel = base.startsWith('wheel_');
      const parts = meshes.map((mesh) => {
        const part = PARTS.includes(mesh.material.name) ? mesh.material.name : 'detail';
        const im = new THREE.InstancedMesh(unpack(mesh), this.mats[part], wheel ? WHEEL_CAP : CAP);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = lod === 0 || part === 'paint' || part === 'trim';
        im.receiveShadow = lod === 0 && part !== 'lamp';
        if (part !== 'glass' && part !== 'detail') {
          im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((wheel ? WHEEL_CAP : CAP) * 3).fill(1), 3);
          im.instanceColor.setUsage(THREE.DynamicDrawUsage);
        }
        im.userData.part = part;
        im.visible = false;
        this.scene.add(im);
        return im;
      });
      if (wheel) {
        const style = base.slice(6);
        (this.wheels[style] ||= [])[lod] = parts;
      } else {
        const t = (this.types[base] ||= { name: base, lods: [] });
        t.lods[lod] = parts;
        const metaSrc = o.userData.meta || o.parent?.userData?.meta;
        if (metaSrc) t.meta = JSON.parse(metaSrc);
      }
    }
  }

  // Soft contact shadows under every vehicle, and for night: light pools on
  // the road ahead of the headlamps, lamp glows, and a few real spot lights.
  makeExtras(q) {
    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(
      flat,
      new THREE.MeshBasicMaterial({ map: blobTexture(), color: '#000000', transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      CAP * 4,
    );
    this.pools = new THREE.InstancedMesh(
      flat.clone().translate(0, 0, -0.5), // reaches forward (-z) from the lamps
      new THREE.MeshBasicMaterial({ map: beamTexture(), color: '#fff0d0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true }),
      CAP * 4,
    );
    this.pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 12).fill(1), 3);
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 16 * 3), 3));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CAP * 16 * 3), 3));
    this.glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: 0.8, map: glowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (const m of [this.shadows, this.pools, this.glow]) {
      m.frustumCulled = false;
      m.renderOrder = 2;
      m.visible = false;
      this.scene.add(m);
    }
    this.spots = [];
    this.spotCount = q.carLights ?? 1;
  }

  // Turns on the night extras (lights 0..1); call once the scene's darkness is known.
  setNight(lights) {
    this.night = lights;
    if (lights < 0.3 || this.spots.length) return;
    for (let i = 0; i < this.spotCount; i++) {
      const s = new THREE.SpotLight('#fff1d6', 0, 70, 0.6, 0.7, 1.3);
      s.castShadow = false;
      this.scene.add(s, s.target);
      this.spots.push(s);
    }
  }

  // Sizes for the traffic code before the model has loaded.
  meta(type) {
    return this.types[type]?.meta;
  }

  // Draws every car this frame. A car carries: type, x, y, z, yaw, pitch,
  // roll, paint/trim/rim (THREE.Color), spin (wheel angle) and lamps
  // ({ head, tail, amber }).
  update(cars, camera) {
    this.drawExtras(cars, camera);
    for (const t of Object.values(this.types)) for (const l of t.lods) if (l) for (const im of l) im.count = 0;
    for (const w of Object.values(this.wheels)) for (const l of w) if (l) for (const im of l) im.count = 0;
    const lodDist2 = (this.q.vehicleLod ?? 60) ** 2;
    const cp = camera.position;
    for (const c of cars) {
      const t = this.types[c.type];
      if (!t || !t.meta) continue;
      const d2 = (c.x - cp.x) ** 2 + (c.z - cp.z) ** 2;
      const lod = d2 < lodDist2 ? 0 : 1;
      _e.set(c.pitch || 0, -c.yaw, c.roll || 0);
      _q.setFromEuler(_e);
      _p.set(c.x, c.y, c.z);
      _w.compose(_p, _q, ONE);
      const parts = t.lods[lod] || t.lods[0];
      for (const im of parts) {
        const i = im.count++;
        if (i >= im.instanceMatrix.count) {
          im.count--;
          continue;
        }
        im.setMatrixAt(i, _w);
        const part = im.userData.part;
        if (part === 'paint') im.setColorAt(i, c.paint);
        else if (part === 'trim') im.setColorAt(i, c.trim);
        else if (part === 'lamp') im.setColorAt(i, _c.setRGB(c.lamps.head, c.lamps.tail, c.lamps.amber));
      }
      // Wheels: unit meshes scaled to radius and width, spun about the axle.
      for (const wh of t.meta.wheels) {
        const ws = this.wheels[c.wheelStyle?.[wh.style] || wh.style];
        if (!ws) continue;
        const wparts = ws[lod] || ws[0];
        for (const sx of wh.centre ? [0] : [-1, 1]) {
          _p.set(sx * wh.x, wh.y, wh.z);
          _q.setFromAxisAngle(_axis, c.spin / wh.r);
          _s.set(wh.w, wh.r, wh.r);
          _m.compose(_p, _q, _s).premultiply(_w);
          for (const im of wparts) {
            const i = im.count++;
            if (i >= im.instanceMatrix.count) {
              im.count--;
              continue;
            }
            im.setMatrixAt(i, _m);
            if (im.userData.part === 'trim') im.setColorAt(i, c.rim);
          }
        }
      }
    }
    const flush = (im) => {
      im.visible = im.count > 0;
      if (!im.visible) return;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    };
    for (const t of Object.values(this.types)) for (const l of t.lods) if (l) l.forEach(flush);
    for (const w of Object.values(this.wheels)) for (const l of w) if (l) l.forEach(flush);
  }
}

const _axis = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();

VehicleFleet.prototype.drawExtras = function drawExtras(cars, camera) {
  const night = this.night || 0;
  const sh = this.shadows;
  const pools = this.pools;
  const pos = this.glow.geometry.attributes.position;
  const col = this.glow.geometry.attributes.color;
  let ns = 0, np = 0, ng = 0;
  // Real lights go to the nearest vehicles coming towards the camera.
  const cp = camera.position;
  const lit = new Set();
  if (this.spots.length && night >= 0.3) {
    const near = cars
      .filter((c) => this.types[c.type]?.meta?.head)
      .map((c) => ({ c, d: (c.x - cp.x) ** 2 + (c.z - cp.z) ** 2 }))
      .sort((a, b) => a.d - b.d);
    this.spots.forEach((s, i) => {
      const e = near[i];
      if (!e || e.d > 150 * 150) {
        s.intensity = 0;
        return;
      }
      const c = e.c;
      const h = this.types[c.type].meta.head;
      _e.set(c.pitch || 0, -c.yaw, c.roll || 0);
      _q.setFromEuler(_e);
      s.position.set(0, h.y, h.z).applyQuaternion(_q).add(_p.set(c.x, c.y, c.z));
      _fwd.set(0, -0.3, -1).applyQuaternion(_q);
      s.target.position.copy(s.position).addScaledVector(_fwd, 20);
      s.intensity = 500 * night;
      lit.add(c);
    });
  }
  for (const c of cars) {
    const meta = this.types[c.type]?.meta;
    if (!meta) continue;
    _e.set(c.pitch || 0, -c.yaw, c.roll || 0);
    _q.setFromEuler(_e);
    // Contact shadow: a soft rectangle just bigger than the footprint.
    if (ns < sh.instanceMatrix.count) {
      _p.set(c.x, c.y + 0.02, c.z);
      _s.set(meta.W * 1.15 + 0.2, 1, meta.L * 1.05 + 0.3);
      _m.compose(_p, _q, _s);
      sh.setMatrixAt(ns++, _m);
    }
    if (night < 0.05) continue;
    const head = meta.head;
    if (head && np < pools.instanceMatrix.count) {
      // A pool of light on the road ahead, unless a real lamp lights it.
      _p.set(0, 0.03, head.z).applyQuaternion(_q).add(_v.set(c.x, c.y, c.z));
      const reach = c.cls === 'bike' ? 16 : 22;
      _s.set(c.cls === 'bike' ? 4.5 : 7, 1, reach);
      _m.compose(_p, _q, _s);
      pools.setMatrixAt(np, _m);
      const k = lit.has(c) ? 0.6 : 1;
      pools.setColorAt(np++, _c.setRGB(night * k, night * k, night * k));
    }
    // Lamp glows: two heads and two tails (one each on a bike).
    const pairs = [];
    if (head) pairs.push([head, 1, 0.95, 0.85, c.lamps.head / 3.5]);
    if (meta.tail) pairs.push([meta.tail, 1, 0.08, 0.04, c.lamps.tail / 2.6]);
    for (const [l, r, g, b, k] of pairs) {
      for (const sx of c.cls === 'bike' ? [0] : [-1, 1]) {
        if (ng >= pos.count) break;
        _v.set(sx * l.x, l.y, l.z + (l === head ? -0.05 : 0.05)).applyQuaternion(_q);
        pos.setXYZ(ng, c.x + _v.x, c.y + _v.y, c.z + _v.z);
        col.setXYZ(ng++, r * k * night, g * k * night, b * k * night);
      }
    }
  }
  sh.count = ns;
  sh.visible = ns > 0;
  sh.instanceMatrix.needsUpdate = true;
  pools.count = np;
  pools.visible = np > 0;
  pools.instanceMatrix.needsUpdate = true;
  pools.instanceColor.needsUpdate = true;
  this.glow.geometry.setDrawRange(0, ng);
  this.glow.visible = ng > 0;
  pos.needsUpdate = true;
  col.needsUpdate = true;
};

function canvasTexture(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft-edged rectangle (alpha) for contact shadows.
function blobTexture() {
  return canvasTexture(64, (g, n) => {
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = Math.abs((x + 0.5) / n * 2 - 1), v = Math.abs((y + 0.5) / n * 2 - 1);
        const d = Math.max(0, Math.hypot(Math.max(0, u - 0.55) / 0.45, Math.max(0, v - 0.7) / 0.3));
        const a = Math.max(0, 1 - d) ** 1.6 * (1 - 0.25 * Math.max(u, v));
        img.data.set([0, 0, 0, a * 255], (y * n + x) * 4);
      }
    }
    g.putImageData(img, 0, 0);
  });
}

// A headlamp beam on the road: bright near the car, spreading and fading out.
function beamTexture() {
  return canvasTexture(128, (g, n) => {
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      // y = 0 is the far end (texture v = 1 at the top maps to -z, ahead).
      const t = 1 - (y + 0.5) / n; // 0 at the car, 1 far ahead
      const width = 0.25 + 0.75 * Math.sqrt(t);
      for (let x = 0; x < n; x++) {
        const u = Math.abs((x + 0.5) / n * 2 - 1) / width;
        const side = Math.max(0, 1 - u * u);
        const along = Math.min(1, t * 6) * (1 - t) ** 1.4;
        const a = side * along;
        img.data.set([255 * a, 255 * a, 255 * a, 255], (y * n + x) * 4);
      }
    }
    g.putImageData(img, 0, 0);
  });
}

function glowTexture() {
  return canvasTexture(64, (g, n) => {
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.15, 'rgba(255,255,255,0.7)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
  });
}
