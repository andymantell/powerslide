// Rain and snow: one instanced quad per drop or flake in a box that follows
// the camera. Each particle's position is a pure function of time (it falls
// and wraps round the box in the vertex shader), so the CPU only updates a
// few uniforms per frame. Drops are drawn as streaks along their speed
// relative to the camera, so they rush past when the rider is fast.
import * as THREE from 'three';
import { ENV } from './sky.js';

const BOX = { rain: new THREE.Vector3(36, 22, 36), snow: new THREE.Vector3(44, 24, 44) };

export class Precipitation {
  constructor(scene, q = {}) {
    this.mesh = null;
    if (!ENV.precip) return;
    const snow = ENV.snow;
    const count = Math.round((q.precip ?? 4000) * (snow ? 0.8 : 1) * ENV.precip);
    const box = snow ? BOX.snow : BOX.rain;

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = count;

    this.uniforms = {
      uTime: { value: 0 },
      uBox: { value: box },
      uCamVel: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector3(snow ? 0.6 : 1.2, 0, snow ? 0.3 : 0.5) },
      uColor: { value: new THREE.Color(snow ? '#ffffff' : '#c8d2dc').multiplyScalar(0.35 + (1 - ENV.night) * 0.65) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      defines: snow ? { SNOW: 1 } : {},
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uBox, uCamVel, uWind;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          #ifdef SNOW
            float fall = 1.1 + aSeed.w * 0.7;
            vec3 drift = vec3(sin(uTime * 0.9 + aSeed.x * 40.0), 0.0, cos(uTime * 0.7 + aSeed.z * 40.0)) * 0.35;
            float size = 0.025 + aSeed.w * 0.03;
            float shutter = 0.012;
          #else
            float fall = 8.5 + aSeed.w * 2.5;
            vec3 drift = vec3(0.0);
            float size = 0.012 + aSeed.w * 0.01;
            float shutter = 0.03;
          #endif
          vec3 vel = uWind + drift - vec3(0.0, fall, 0.0);
          // Fall, then wrap into the box centred on the camera.
          vec3 p = aSeed.xyz * uBox * 7.0 + vel * uTime;
          p = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 wp = cameraPosition + p;
          // Streak along the motion seen from the moving camera.
          vec3 rel = vel - uCamVel;
          float len = length(rel) * shutter;
          vec3 dir = rel / max(length(rel), 1e-3);
          vec3 toCam = normalize(cameraPosition - wp);
          vec3 side = cross(dir, toCam);
          side = length(side) < 1e-3 ? vec3(1.0, 0.0, 0.0) : normalize(side);
          #ifdef SNOW
            len = max(len, size * 2.0);
          #endif
          wp += side * position.x * size * 2.0 - dir * position.y * len;
          vUv = position.xy + vec2(0.5, 0.0);
          // Fade out at the box edge and right in front of the lens.
          float r = length(p / (uBox * 0.5));
          vFade = smoothstep(1.0, 0.7, r) * smoothstep(0.6, 2.0, length(p));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
          #ifdef SNOW
            float a = smoothstep(0.0, 0.6, across) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y) * 0.9;
          #else
            float a = across * smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.8, vUv.y) * 0.45;
          #endif
          gl_FragColor = vec4(uColor, a * vFade);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }

  // camVel: the camera's velocity (m/s), so streaks lean with the rider.
  update(time, camVel) {
    if (!this.mesh) return;
    this.uniforms.uTime.value = time;
    this.uniforms.uCamVel.value.copy(camVel);
  }
}
