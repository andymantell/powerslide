// Gradient sky dome with a sun glow, plus matching lights and fog.
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();

export function createSky(scene) {
  const horizon = new THREE.Color('#e9c9a3');
  const zenith = new THREE.Color('#3f6fb3');
  scene.fog = new THREE.FogExp2(horizon.clone().lerp(new THREE.Color('#b9c6d6'), 0.55), 0.00032);
  scene.background = horizon;

  const geo = new THREE.SphereGeometry(9000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: horizon },
      uZenith: { value: zenith },
      uFogCol: { value: scene.fog.color },
      uSun: { value: SUN_DIR },
    },
    vertexShader: `varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // keep at far plane
      }`,
    fragmentShader: `varying vec3 vDir;
      uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uFogCol; uniform vec3 uSun;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
        col = mix(col, uFogCol, smoothstep(0.08, -0.05, h));
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.8, 0.55) * (pow(s, 8.0) * 0.35 + pow(s, 900.0) * 3.0);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight('#cfe0ff', '#5a4a36', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe2b8', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45;
  sc.right = 45;
  sc.top = 45;
  sc.bottom = -45;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  return { sky, sun, hemi };
}
