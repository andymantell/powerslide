// Atmosphere: a scattering sky with a cloud layer, rendered once into a cube
// map at start-up (the sun never moves), which then serves as the background
// and, through PMREM, as image-based lighting for every PBR material. Fog is
// replaced globally with height-attenuated aerial perspective that picks up
// the sun's glow, so distant ridges fade into the same sky colour.
import * as THREE from 'three';

// Look of the default biome. Other biomes can pass their own to createSky.
export const ATMOSPHERE = {
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
};

export const SUN_DIR = new THREE.Vector3();
function sunDir(a) {
  const ce = Math.cos(a.sunElevation);
  return new THREE.Vector3(Math.cos(a.sunAzimuth) * ce, Math.sin(a.sunElevation), Math.sin(a.sunAzimuth) * ce).normalize();
}
SUN_DIR.copy(sunDir(ATMOSPHERE));

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
  uniform float uDisc;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
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

    // Cloud layer on a plane above the valley.
    if (d.y > 0.0) {
      vec2 uv = d.xz / (d.y + 0.08) * 1.6;
      float n = fbm(uv + vec2(3.1, 7.7));
      float n2 = fbm(uv * 2.7 + n * 1.3);
      float cov = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.28, n * 0.75 + n2 * 0.35);
      // Self-shadowing: sample towards the sun, thicker cloud is darker.
      float ns = fbm(uv + uSun.xz * 0.12 + vec2(3.1, 7.7));
      float shade = clamp(1.0 - (ns - n) * 3.5, 0.45, 1.25);
      vec3 cc = uCloudCol * shade * mix(vec3(0.82, 0.86, 0.95), vec3(1.0), h);
      // Silver lining near the sun.
      cc += uSunCol * pow(max(mu, 0.0), 12.0) * (1.0 - cov) * 1.4;
      float fade = smoothstep(0.0, 0.18, d.y);
      col = mix(col, cc, cov * fade * 0.92);
    }

    // Sun disc with soft limb.
    float disc = smoothstep(0.99955, 0.99985, mu);
    col += uSunCol * disc * uDisc;
    gl_FragColor = vec4(col, 1.0);
  }`;

export function createSky(scene, renderer, q = {}, atmo = ATMOSPHERE) {
  installFog(atmo);
  const sun3 = sunDir(atmo);
  SUN_DIR.copy(sun3);
  scene.fog = new THREE.FogExp2(new THREE.Color(atmo.haze), q.fog ?? 0.00032);

  const uniforms = {
    uZenith: { value: v3(atmo.zenith) },
    uHorizon: { value: v3(atmo.horizon) },
    uHaze: { value: v3(atmo.haze) },
    uSunHaze: { value: v3(atmo.sunHaze) },
    uSun: { value: sun3 },
    uSunCol: { value: v3(atmo.sunColor).multiplyScalar(30) },
    uCloud: { value: atmo.cloudCover },
    uCloudCol: { value: v3(atmo.cloudColor) },
    uDisc: { value: 1 },
  };
  const skyScene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.BoxGeometry(10, 10, 10),
    new THREE.ShaderMaterial({ uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false }),
  );
  skyScene.add(dome);

  // Background cube (with the sun disc) and a lighting cube without it, since
  // the directional light already carries the sun's energy.
  const bgSize = q.skySize ?? 512;
  const bgRT = new THREE.WebGLCubeRenderTarget(bgSize, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  new THREE.CubeCamera(0.1, 100, bgRT).update(renderer, skyScene);
  uniforms.uDisc.value = 0;
  const envRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
  new THREE.CubeCamera(0.1, 100, envRT).update(renderer, skyScene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(envRT.texture);
  pmrem.dispose();
  envRT.dispose();
  dome.geometry.dispose();
  dome.material.dispose();

  scene.background = bgRT.texture;
  scene.environment = env.texture;
  scene.environmentIntensity = atmo.envIntensity;

  // Fill for the few non-PBR materials; IBL does the real work.
  const hemi = new THREE.HemisphereLight('#cfe0ff', '#4d4636', 0.25);
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
  return { sky, sun, hemi };
}
