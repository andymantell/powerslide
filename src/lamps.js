// Street lights at night: the nearest lampposts light the road, pavements,
// props and ground around them. Each frame the closest few lamp heads are
// moved into view space and handed to every material that calls
// addLampLights() in its onBeforeCompile, which adds their warm light as
// extra diffuse lighting (no shadows). Compiled out entirely by day.
import * as THREE from 'three';
import { ENV } from './sky.js';

const MAX = 12;
const RANGE = 17; // m: light falls to nothing this far from a lamp head
const uniforms = {
  uLampV: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
  uLampCol: { value: new THREE.Color('#ffc983').multiplyScalar(30) },
};
const on = () => ENV.night > 0.4;

// For a material's onBeforeCompile(shader). Also add `lamps-${lampsOn()}` to
// its program cache key.
export function addLampLights(shader) {
  if (!on()) return;
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      uniform vec4 uLampV[${MAX}];
      uniform vec3 uLampCol;`,
    )
    .replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      {
        vec3 lampIrr = vec3(0.0);
        for (int i = 0; i < ${MAX}; i++) {
          vec3 lv = uLampV[i].xyz + vViewPosition;
          float ld = length(lv);
          float fall = clamp(1.0 - ld / ${RANGE.toFixed(1)}, 0.0, 1.0);
          lampIrr += uLampV[i].w * fall * fall / (1.0 + ld * ld * 0.05) * max(dot(normal, lv / max(ld, 1e-3)), 0.0);
        }
        reflectedLight.directDiffuse += lampIrr * uLampCol * BRDF_Lambert(diffuseColor.rgb);
      }`,
    );
}

export const lampsOn = () => (on() ? 1 : 0);

const tmp = new THREE.Vector3();

// Moves the nearest lamp heads into the camera's view space.
export function updateLamps(props, camera, px, pz) {
  if (!on()) return;
  const arr = props.items.get('lamppost');
  const L = uniforms.uLampV.value;
  const best = [];
  if (arr) {
    for (let i = 0; i < arr.length; i += 5) {
      const s = arr[i + 4], yaw = arr[i + 3];
      // The head hangs 1.6 m out on the arm, 7.86 m up (props_suburbs.py).
      const x = arr[i] + Math.sin(yaw) * 1.6 * s, z = arr[i + 2] + Math.cos(yaw) * 1.6 * s;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d > 140 * 140) continue;
      best.push([d, x, arr[i + 1] + 7.8 * s, z]);
    }
    best.sort((a, b) => a[0] - b[0]);
  }
  for (let k = 0; k < MAX; k++) {
    const b = best[k];
    if (!b) {
      L[k].set(0, 0, 0, 0);
      continue;
    }
    tmp.set(b[1], b[2], b[3]).applyMatrix4(camera.matrixWorldInverse);
    L[k].set(tmp.x, tmp.y, tmp.z, 1);
  }
}
