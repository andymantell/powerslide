// Atmosphere: a scattering sky with a cloud layer, rendered once into a cube
// map at start-up (the sun never moves), which then serves as the background
// and, through PMREM, as image-based lighting for every PBR material. Fog is
// replaced globally with height-attenuated aerial perspective that picks up
// the sun's glow, so distant ridges fade into the same sky colour.
import * as THREE from 'three';
import { cloudNoise } from './clouds.js';

// Each biome's look, keyed by the name in its biomes.js `look.atmosphere`.
export const ATMOSPHERE = {
  alpine: {
    sunAzimuth: -2.22, // radians, measured in the xz plane from +X
    sunElevation: 0.43, // radians above the horizon
    zenith: '#1f56b0',
    horizon: '#bcd0e6',
    haze: '#b9c6d3', // fog colour away from the sun
    sunHaze: '#f2cf9c', // fog colour towards the sun
    sunColor: '#fff0d8',
    sunIntensity: 3.2,
    cloudCover: 0.42,
    cloudColor: '#ffffff',
    envIntensity: 0.55,
  },
  // Overcast, soft and misty, with a low sun breaking through.
  dartmoor: {
    sunAzimuth: -2.0,
    sunElevation: 0.36,
    zenith: '#5f7690',
    horizon: '#c3c9cc',
    haze: '#b3b9b9',
    sunHaze: '#ddd3c0',
    sunColor: '#f4ead8',
    sunIntensity: 2.1,
    cloudCover: 0.78,
    cloudColor: '#e4e6e8',
    envIntensity: 0.75,
    fogScale: 2.2, // thicker mist than the alpine air
  },
};

// Time of day and weather, applied on top of a biome's atmosphere by
// atmosphereFor(). Colours are mixed towards the preset's by `mix`; sun, env
// and fog strengths multiply; sunElevation and cloudCover replace.
export const TIME = {
  day: {},
  dawn: {
    mix: 0.75, zenith: '#3b5a90', horizon: '#f2c4ad', haze: '#c4b2b6', sunHaze: '#ffbe8c',
    sunColor: '#ffcf9c', cloudColor: '#f7cbbc', sunElevation: 0.11, sunIntensity: 0.8, envIntensity: 0.8, night: 0.3, cloudAmb: 0.6, cloudSun: 0.8,
  },
  dusk: {
    mix: 0.8, zenith: '#2a3a6c', horizon: '#d0907c', haze: '#9c8088', sunHaze: '#ff9244',
    sunColor: '#ffaa62', cloudColor: '#f3a984', sunElevation: 0.08, sunIntensity: 0.75, envIntensity: 0.7, night: 0.5, cloudAmb: 0.5, cloudSun: 0.65,
  },
  // Moonlit: the sun light becomes the moon, and the sky is dark with stars.
  night: {
    mix: 1, zenith: '#040a1c', horizon: '#1a2842', haze: '#121b2b', sunHaze: '#283656',
    sunColor: '#a9bde6', cloudColor: '#262e3f', sunElevation: 0.7, sunIntensity: 0.13, envIntensity: 1.6,
    exposure: 1.35, night: 1, moon: true, cloudAmb: 0.6, cloudSun: 0.3,
  },
};
export const WEATHER = {
  clear: {},
  cloudy: { cloudCover: 0.86, sunIntensity: 0.45, envIntensity: 1.35, grey: 0.45, fogScale: 1.4, cloudSun: 0.75 },
  mist: { cloudCover: 0.8, sunIntensity: 0.5, envIntensity: 1.3, grey: 0.7, fogScale: 11, cloudAmb: 1.5, cloudSun: 0.6, cloudHaze: 5 },
  rain: { cloudCover: 0.97, sunIntensity: 0.22, envIntensity: 1.15, grey: 0.75, dim: 0.72, fogScale: 2.6, wet: 1, precip: 1, cloudSun: 0.3, cloudAmb: 0.85 },
  snow: { cloudCover: 0.93, sunIntensity: 0.3, envIntensity: 1.4, grey: 0.8, fogScale: 3, precip: 1, snow: true, cloudSun: 0.45 },
};

// The time and weather this page was built with, set by atmosphereFor().
// Read-only for everything else: props read `night` (0..1) for lit windows,
// traffic for headlights, the road for `wet`, and the particles for `precip`.
export const ENV = { time: 'day', weather: 'clear', night: 0, wet: 0, precip: 0, snow: false };

const COLOURS = ['zenith', 'horizon', 'haze', 'sunHaze', 'sunColor', 'cloudColor'];

// A biome's ATMOSPHERE entry (alpine if unknown) with a time of day and
// weather applied. Also fills in ENV.
export function atmosphereFor(biomeId, time = 'day', weather = 'clear') {
  const base = ATMOSPHERE[biomeId] || ATMOSPHERE.alpine;
  const t = TIME[time] || TIME.day;
  const w = WEATHER[weather] || WEATHER.clear;
  const a = { ...base };
  const c = new THREE.Color();
  for (const k of COLOURS) {
    const col = new THREE.Color(base[k]);
    if (t[k]) col.lerp(c.set(t[k]), t.mix ?? 1);
    if (w.grey) {
      // Overcast: drain the colour, keeping the brightness.
      const l = col.r * 0.3 + col.g * 0.55 + col.b * 0.15;
      col.lerp(c.setRGB(l * 0.97, l, l * 1.03), w.grey);
    }
    if (w.dim && k !== 'sunColor') col.multiplyScalar(w.dim);
    a[k] = `#${col.getHexString()}`;
  }
  if (t.sunElevation !== undefined) a.sunElevation = t.sunElevation;
  if (w.cloudCover !== undefined) a.cloudCover = Math.max(base.cloudCover, w.cloudCover);
  a.sunIntensity = base.sunIntensity * (t.sunIntensity ?? 1) * (w.sunIntensity ?? 1);
  a.envIntensity = base.envIntensity * (t.envIntensity ?? 1) * (w.envIntensity ?? 1);
  a.fogScale = (base.fogScale ?? 1) * (w.fogScale ?? 1);
  a.exposure = t.exposure ?? 1;
  a.moon = !!t.moon;
  a.cloudAmb = (t.cloudAmb ?? 1) * (w.cloudAmb ?? 1);
  a.cloudSun = (t.cloudSun ?? 1) * (w.cloudSun ?? 1);
  a.cloudHaze = w.cloudHaze ?? 1;
  Object.assign(ENV, {
    time: TIME[time] ? time : 'day',
    weather: WEATHER[weather] ? weather : 'clear',
    night: t.night ?? 0,
    wet: w.wet ?? 0,
    precip: w.precip ?? 0,
    snow: !!w.snow,
  });
  return a;
}

export const SUN_DIR = new THREE.Vector3();
function sunDir(a) {
  const ce = Math.cos(a.sunElevation);
  return new THREE.Vector3(Math.cos(a.sunAzimuth) * ce, Math.sin(a.sunElevation), Math.sin(a.sunAzimuth) * ce).normalize();
}
SUN_DIR.copy(sunDir(ATMOSPHERE.alpine));

const smoothstep01 = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

const v3 = (c) => {
  const col = new THREE.Color(c);
  return new THREE.Vector3(col.r, col.g, col.b);
};

// Aerial perspective. Density falls off with height above the camera, so the
// valley below stays hazier than the peaks; colour shifts towards the sun.
// The fog colour and density uniforms are the scene fog's; the sun direction
// and glow colour are baked in, which keeps every built-in material working.
function installFog(a) {
  const s = sunDir(a);
  const g = new THREE.Color(a.sunHaze);
  const f = (n) => n.toFixed(5);
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
    varying vec3 vFogRay;
  #endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
    vFogRay = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
  #endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor;
    varying vec3 vFogRay;
    uniform float fogDensity;
  #endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
    float fogDist = length(vFogRay);
    vec3 fogDir = vFogRay / max(fogDist, 1e-4);
    float fogK = 0.0035; // 1 / height scale (m)
    float fogDy = fogDir.y * fogDist * fogK;
    float fogH = abs(fogDy) > 1e-3 ? (1.0 - exp(-fogDy)) / fogDy : 1.0;
    float fogFactor = 1.0 - exp(-fogDensity * fogDist * fogH);
    float fogSun = pow(max(dot(fogDir, vec3(${f(s.x)}, ${f(s.y)}, ${f(s.z)})), 0.0), 6.0);
    vec3 fogCol = mix(fogColor, vec3(${f(g.r)}, ${f(g.g)}, ${f(g.b)}), fogSun * 0.75);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, clamp(fogFactor, 0.0, 1.0));
  #endif`;
}

const skyVert = `varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;

const skyFrag = `varying vec3 vDir;
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHaze; uniform vec3 uSunHaze;
  uniform vec3 uSun; uniform vec3 uSunCol; uniform float uCloud; uniform vec3 uCloudCol;
  uniform float uDisc; uniform float uStars; uniform float uMoon; uniform float uLining;
  uniform sampler3D tCloud; uniform vec3 uSunLight; uniform vec2 uCloudSteps; uniform vec3 uCloudLight;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  // Cloud density at a point in the shell; hf is the height fraction (0 base, 1 top).
  float cloudDensity(vec3 p, float hf, float cov) {
    vec3 q = vec3(p.x, p.y - 6371000.0, p.z);
    vec4 sh = texture(tCloud, q / 9000.0 + vec3(0.13, 0.0, 0.71));
    // Large-scale weather: where clouds can form at all.
    float wx = texture(tCloud, vec3(q.xz / 60000.0, 0.37).xzy).r;
    float c = clamp(cov + (wx - 0.5) * 0.3, 0.0, 1.0);
    // Cumulus: rounded tops, flat bases; overcast flattens into a sheet.
    float prof = smoothstep(0.0, 0.08, hf) * smoothstep(1.0, mix(0.35, 0.75, c), hf);
    float base = sh.r * prof;
    float th = 1.0 - c * 0.74;
    float dn = clamp((base - th) / max(1.0 - th, 0.05), 0.0, 1.0);
    if (dn <= 0.0) return 0.0;
    float det = texture(tCloud, q / 1700.0).g;
    dn = clamp((dn - (1.0 - det) * mix(0.4, 0.18, hf)) / 0.6, 0.0, 1.0);
    return dn * mix(1.0, 2.5, c * c);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 7; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    float mu = dot(d, uSun);
    // Rayleigh-ish gradient: deep blue overhead, pale near the horizon.
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
    // Brighter, warmer band around the sun (Mie forward scattering).
    float mie = pow(max(mu, 0.0), 5.0) * 0.45 + pow(max(mu, 0.0), 48.0) * 0.6;
    col += uSunHaze * mie * (1.0 - h * 0.6);
    // Below the horizon: fade to the fog colour so terrain gaps never show a seam.
    float below = smoothstep(0.02, -0.08, d.y);
    vec3 haze = mix(uHaze, uSunHaze, pow(max(mu, 0.0), 6.0) * 0.75);
    col = mix(col, haze, max(below, smoothstep(0.12, 0.0, d.y) * 0.6));

    // Night: stars in a jittered grid on the sphere, and a faint Milky Way.
    if (uStars > 0.0 && d.y > 0.0) {
      vec3 sp = d * 150.0;
      vec3 cell = floor(sp);
      float hs = hash3(cell);
      vec3 cen = cell + 0.5 + (vec3(hash3(cell + 7.1), hash3(cell + 3.3), hash3(cell + 5.9)) - 0.5) * 0.5;
      float star = step(0.965, hs) * smoothstep(0.3, 0.0, length(sp - cen));
      float tw = pow(hash3(cell + 1.7), 6.0) * 3.0 + 0.25;
      vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash3(cell + 9.2));
      float band = exp(-pow(dot(d, normalize(vec3(0.45, 0.35, 0.82))) * 4.0, 2.0));
      float dust = fbm(d.xz / (d.y + 0.3) * 3.0 + d.y * 4.0);
      vec3 sky = sc * star * tw + vec3(0.55, 0.6, 0.8) * band * smoothstep(0.35, 0.8, dust) * 0.05;
      col += sky * uStars * smoothstep(0.02, 0.25, d.y);
    }

    // Volumetric clouds: march through a shell of sky 1.3 to 3.4 km up
    // (on a curved earth, so the layer meets the horizon) and integrate
    // light scattered from the sun and the sky, with self-shadowing.
    float trans = 1.0;
    vec3 cloudLight = vec3(0.0);
    if (d.y > -0.02) {
      const float R = 6371000.0, BASE = 1300.0, TOP = 3400.0;
      vec3 o = vec3(0.0, R + 20.0, 0.0);
      float b = dot(o, d);
      float c0 = dot(o, o);
      float t0 = -b + sqrt(b * b - c0 + (R + BASE) * (R + BASE));
      float t1 = -b + sqrt(b * b - c0 + (R + TOP) * (R + TOP));
      t1 = min(t1, t0 + 14000.0);
      float steps = uCloudSteps.x;
      float dt = (t1 - t0) / steps;
      // Jitter the start to hide banding (the bake is static, so this is a
      // fixed fine grain, not flicker).
      float t = t0 + dt * hash3(floor(d * 2048.0));
      float cov = uCloud;
      // Two-lobe Henyey-Greenstein: bright forward glow and a little back-scatter.
      float g1 = 0.65, g2 = -0.25;
      float ph = mix((1.0 - g2 * g2) / pow(1.0 + g2 * g2 - 2.0 * g2 * mu, 1.5), (1.0 - g1 * g1) / pow(1.0 + g1 * g1 - 2.0 * g1 * mu, 1.5), 0.6) / (4.0 * 3.14159);
      float sigmaK = mix(0.045, 0.03, cov);
      for (int i = 0; i < 160; i++) {
        if (float(i) >= steps || trans < 0.01) break;
        vec3 p = o + d * t;
        float alt = length(p) - R;
        float hf = clamp((alt - BASE) / (TOP - BASE), 0.0, 1.0);
        float dens = cloudDensity(p, hf, cov);
        if (dens > 0.001) {
          // Light march towards the sun: a few growing steps.
          float od = 0.0;
          float ls = 70.0;
          vec3 lp = p;
          for (int j = 0; j < 6; j++) {
            if (float(j) >= uCloudSteps.y) break;
            lp += uSun * ls;
            float la = length(lp) - R;
            od += cloudDensity(lp, clamp((la - BASE) / (TOP - BASE), 0.0, 1.0), cov) * ls;
            ls *= 1.8;
          }
          float sig = dens * sigmaK;
          // Multiple scattering, approximated by octaves with less extinction.
          float lt = exp(-od * sigmaK * 0.3) * 0.65 + exp(-od * sigmaK * 0.07) * 0.35;
          // Beer-powder: dark edges facing the sun, as in real cumulus.
          float powder = 1.0 - exp(-od * sigmaK * 2.0 - dens * 2.0);
          vec3 amb = mix(uHorizon * 0.5, uZenith * 0.7 + uHorizon * 0.35, hf) * uCloudCol * mix(0.55, 1.1, hf) * uCloudLight.x;
          vec3 S = (uSunLight * ph * lt * mix(0.5, 1.0, powder) * 20.0 * uCloudLight.y + amb) * sig;
          float stepT = exp(-sig * dt);
          cloudLight += trans * (S - S * stepT) / max(sig, 1e-5);
          trans *= stepT;
        }
        t += dt;
      }
      // Distant clouds fade into the horizon haze.
      float far = 1.0 - exp(-t0 * uCloudLight.z / 26000.0);
      float horizonFade = smoothstep(-0.02, 0.06, d.y);
      cloudLight = mix(cloudLight, haze * (1.0 - trans), far);
      trans = mix(1.0, trans, horizonFade);
      cloudLight *= horizonFade;
    }
    col = col * trans + cloudLight;

    // Sun disc with soft limb, or the moon with its darker seas, both hidden
    // behind thick cloud.
    float disc = smoothstep(0.99955, 0.99985, mu);
    if (uMoon > 0.0) {
      vec3 mt = normalize(cross(uSun, vec3(0.0, 1.0, 0.0)));
      vec2 mp = vec2(dot(d, mt), dot(d, cross(mt, uSun))) * 60.0;
      disc *= 0.75 + 0.25 * smoothstep(0.35, 0.7, fbm(mp * 1.3 + 4.0));
    }
    col += uSunCol * disc * uDisc * trans;
    gl_FragColor = vec4(col, 1.0);
  }`;

export function createSky(scene, renderer, q = {}, atmo = ATMOSPHERE.alpine) {
  installFog(atmo);
  renderer.toneMappingExposure = atmo.exposure ?? 1;
  const night = atmo.moon ? 1 : 0;
  const sun3 = sunDir(atmo);
  SUN_DIR.copy(sun3);
  const fogDensity = (q.fog ?? 0.00032) * (atmo.fogScale ?? 1);
  scene.fog = new THREE.FogExp2(new THREE.Color(atmo.haze), fogDensity);

  const uniforms = {
    uZenith: { value: v3(atmo.zenith) },
    uHorizon: { value: v3(atmo.horizon) },
    uHaze: { value: v3(atmo.haze) },
    uSunHaze: { value: v3(atmo.sunHaze) },
    uSun: { value: sun3 },
    uSunCol: { value: v3(atmo.sunColor).multiplyScalar(30) },
    uCloud: { value: atmo.cloudCover },
    uCloudCol: { value: v3(atmo.cloudColor) },
    tCloud: { value: cloudNoise(q.cloudNoise ?? 64) },
    uSunLight: { value: v3(atmo.sunColor).multiplyScalar(atmo.sunIntensity) },
    uCloudLight: { value: new THREE.Vector3(atmo.cloudAmb ?? 1, atmo.cloudSun ?? 1, atmo.cloudHaze ?? 1) },
    uCloudSteps: { value: new THREE.Vector2(q.cloudSteps ?? 64, q.cloudLightSteps ?? 4) },
    uDisc: { value: night ? 0.07 : 1 },
    uStars: { value: night * (1 - smoothstep01((atmo.cloudCover - 0.5) / 0.45)) },
    uMoon: { value: night },
    uLining: { value: night ? 0.02 : 1 },
  };
  const skyScene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.BoxGeometry(10, 10, 10),
    new THREE.ShaderMaterial({ uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false }),
  );
  skyScene.add(dome);

  // Background cube (with the sun disc) and a lighting cube without it, since
  // the directional light already carries the sun's energy. A clear sky
  // goes up at once; the clouds are raymarched afterwards, a strip at a time
  // over several frames (see bakeClouds), because baking them in one go can
  // stall a phone GPU long enough for the browser to drop the context.
  const bgSize = q.skySize ?? 512;
  // No mipmaps: the sky is smooth enough without, and some Android GPUs
  // sampled mismatched mip levels across cube faces, which showed as a seam.
  const cubeOpts = { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter };
  const steps = uniforms.uCloudSteps.value.x;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const bakeEnv = () => {
    uniforms.uDisc.value = 0;
    const envRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    new THREE.CubeCamera(0.1, 100, envRT).update(renderer, skyScene);
    const env = pmrem.fromCubemap(envRT.texture);
    envRT.dispose();
    scene.environment?.dispose();
    scene.environment = env.texture;
    uniforms.uDisc.value = night ? 0.07 : 1;
  };
  uniforms.uCloudSteps.value.x = 0;
  let bgRT = new THREE.WebGLCubeRenderTarget(bgSize, cubeOpts);
  new THREE.CubeCamera(0.1, 100, bgRT).update(renderer, skyScene);
  bakeEnv();
  scene.background = bgRT.texture;
  scene.environmentIntensity = atmo.envIntensity;

  // Cloud bake state: the next face and row, into a second cube that
  // replaces the clear one when it's finished.
  let job = steps > 0 ? { rt: new THREE.WebGLCubeRenderTarget(bgSize, cubeOpts), face: 0, row: 0, cam: null } : null;
  const finish = () => {
    if (uniforms.tCloud.value) uniforms.tCloud.value.dispose();
    dome.geometry.dispose();
    dome.material.dispose();
    pmrem.dispose();
    job = null;
  };
  if (!job) finish();
  // Bakes up to `budget` pixels of cloud this frame; true once done.
  const bakeClouds = (budget = 32768) => {
    if (!job) return true;
    const prevTarget = renderer.getRenderTarget();
    try {
      uniforms.uCloudSteps.value.x = steps;
      if (!job.cam) {
        job.cam = new THREE.CubeCamera(0.1, 100, job.rt);
        job.cam.coordinateSystem = renderer.coordinateSystem;
        job.cam.updateCoordinateSystem();
        job.cam.updateMatrixWorld(true);
      }
      const rows = Math.max(8, Math.min(bgSize, Math.floor(budget / bgSize)));
      let left = budget;
      while (job.face < 6 && left > 0) {
        const h = Math.min(rows, bgSize - job.row);
        const rt = job.rt;
        rt.viewport.set(0, 0, bgSize, bgSize);
        rt.scissor.set(0, job.row, bgSize, h);
        rt.scissorTest = true;
        renderer.setRenderTarget(rt, job.face);
        renderer.render(skyScene, job.cam.children[job.face]);
        left -= h * bgSize;
        job.row += h;
        if (job.row >= bgSize) {
          job.row = 0;
          job.face++;
        }
      }
      if (job.face < 6) return false;
      job.rt.scissorTest = false;
      const old = bgRT;
      bgRT = job.rt;
      scene.background = bgRT.texture;
      old.dispose();
      bakeEnv();
      finish();
      return true;
    } catch (e) {
      // Keep the clear sky rather than break the game.
      console.warn('Cloud bake failed', e);
      job.rt.dispose();
      finish();
      return true;
    } finally {
      uniforms.uCloudSteps.value.x = 0;
      renderer.setRenderTarget(prevTarget);
    }
  };

  // Fill for the few non-PBR materials; IBL does the real work.
  const hemi = new THREE.HemisphereLight('#cfe0ff', '#4d4636', night ? 0.06 : 0.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(atmo.sunColor, atmo.sunIntensity);
  sun.castShadow = q.shadows ?? true;
  const size = q.shadowMap ?? 2048;
  sun.shadow.mapSize.set(size, size);
  const ext = q.shadowExtent ?? 45;
  const sc = sun.shadow.camera;
  sc.left = -ext;
  sc.right = ext;
  sc.top = ext;
  sc.bottom = -ext;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = q.shadowRadius ?? 1;
  scene.add(sun, sun.target);
  // No separate sky mesh any more; kept in the return for callers.
  const sky = new THREE.Object3D();
  return { sky, sun, hemi, fogDensity, bakeClouds };
}
