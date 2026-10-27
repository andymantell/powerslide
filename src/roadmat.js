// Road surface shader. UVs are in metres (x across from the centreline, y
// along the road), so the aggregate texture tiles at real scale and the
// markings are drawn analytically: always crisp, antialiased with fwidth,
// and worn where the aggregate pokes through. A ragged gravel verge is
// blended in past the asphalt edge.
import * as THREE from 'three';
import { groundTexture } from './ground.js';
import { HALF_WIDTH } from './road.js';

// Marking styles. Biomes can pick another, e.g. UK roads use white centre dashes.
export const MARKINGS = {
  alpine: { centre: '#e3bd2c', centreOn: 4, centrePeriod: 12, centreWidth: 0.12, edge: '#e9e7e0', edgeWidth: 0.15 },
  uk: { centre: '#e9e7e0', centreOn: 3, centrePeriod: 12, centreWidth: 0.1, edge: '#e9e7e0', edgeWidth: 0.1 },
};

export function createRoadMaterial(renderer, markings = MARKINGS.alpine) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const uniforms = {
    tAspA: { value: groundTexture('asphalt', 'albedo', renderer) },
    tAspN: { value: groundTexture('asphalt', 'normal', renderer) },
    tGravA: { value: groundTexture('gravel', 'albedo', renderer) },
    uCentre: { value: new THREE.Color(markings.centre) },
    uEdge: { value: new THREE.Color(markings.edge) },
    uMark: { value: new THREE.Vector4(markings.centreOn, markings.centrePeriod, markings.centreWidth, markings.edgeWidth) },
    // Surface look (see setRoadSurface): tone, bump, wet.
    uSurface: { value: new THREE.Vector3(1, 1, 0) },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoad;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tAspA, tAspN, tGravA;
        uniform vec3 uCentre, uEdge;
        uniform vec4 uMark;
        uniform vec3 uSurface;
        varying vec2 vRoad;
        float rHash(float n) { return fract(sin(n) * 43758.5453); }
        float rNoise(float x) { float i = floor(x); float f = fract(x); return mix(rHash(i), rHash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
        float band(float x, float a, float b) {
          float w = fwidth(x) * 0.75;
          return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `
        float ru = vRoad.x;
        float rs = vRoad.y;
        float au = abs(ru);
        vec4 asp = texture2D(tAspA, vec2(ru, rs) * 0.75);
        // Large-scale tone: resurfaced patches and general wear.
        float tone = texture2D(tAspA, vec2(ru * 0.03 + 0.5, rs * 0.011)).r;
        float patchy = smoothstep(0.3, 0.32, rNoise(rs * 0.025 + 3.0)) * smoothstep(0.55, 0.5, rNoise(rs * 0.05 + floor(ru * 0.3) * 7.0));
        vec3 rcol = asp.rgb * (0.82 + tone * 0.7);
        rcol *= mix(1.0, 0.72, patchy * 0.8);
        // Wheel tracks: darker, smoother and slightly polished.
        float lane = abs(au - 1.75);
        float track = smoothstep(0.55, 0.85, lane) * smoothstep(1.15, 0.85, lane);
        rcol *= 1.0 - track * 0.12;
        float rough = 0.93 - track * 0.06 - patchy * 0.03;

        // Markings: paint is missing where the aggregate is low.
        float wear = smoothstep(0.15, 0.45, asp.a + rNoise(rs * 3.1) * 0.25);
        float dash = step(fract(rs / uMark.y), uMark.x / uMark.y);
        float cLine = band(ru, -uMark.z * 0.5, uMark.z * 0.5) * dash;
        float eLine = band(au, ${(HALF_WIDTH - 0.3).toFixed(3)}, ${(HALF_WIDTH - 0.3).toFixed(3)} + uMark.w);
        rcol = mix(rcol, uCentre * (0.85 + asp.a * 0.2), cLine * wear);
        rcol = mix(rcol, uEdge * (0.85 + asp.a * 0.2), eLine * wear);
        rough = mix(rough, 0.6, max(cLine, eLine) * wear);

        // Ragged asphalt edge breaking up into the gravel verge.
        float edgeN = rNoise(rs * 1.7) * 0.25 + rNoise(rs * 7.3) * 0.12;
        float verge = smoothstep(${HALF_WIDTH.toFixed(3)} - 0.05, ${HALF_WIDTH.toFixed(3)} + 0.05, au - edgeN + 0.15);
        vec3 grav = texture2D(tGravA, vec2(ru, rs) * 0.45).rgb;
        rcol = mix(rcol * mix(1.0, 0.85, smoothstep(${(HALF_WIDTH - 0.6).toFixed(3)}, ${HALF_WIDTH.toFixed(3)}, au)), grav, verge);
        rough = mix(rough, 0.95, verge);
        // Fresh or worn tarmac, and a wet road: darker and shiny, most of all
        // where it's smoothest.
        float onRoad = 1.0 - verge;
        rcol *= mix(1.0, uSurface.x, onRoad);
        rcol *= mix(1.0, 0.55, uSurface.z * onRoad);
        rough = mix(rough, 0.28 + (rough - 0.6) * 0.5, uSurface.z * onRoad);
        diffuseColor.rgb *= rcol;
        `,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rough;')
      .replace(
        '#include <normal_fragment_maps>',
        `{
          vec3 tn = texture2D(tAspN, vec2(ru, rs) * 0.75).xyz * 2.0 - 1.0;
          tn.xy *= (1.0 - track * 0.5) * (1.0 - max(cLine, eLine) * wear * 0.7) * mix(1.0, uSurface.y, 1.0 - verge);
          // Tangent frame from screen-space derivatives of the road UVs.
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(vRoad), st1 = dFdy(vRoad);
          vec3 N = normal;
          vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
          vec3 T = q1perp * st0.x + q0perp * st1.x;
          vec3 B = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(T, T), dot(B, B));
          float scale = det == 0.0 ? 0.0 : inversesqrt(det);
          normal = normalize(T * (tn.x * scale) + B * (tn.y * scale) + N * tn.z);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'road';
  return mat;
}

// tone: brightness of the asphalt (fresh tarmac is darker), bump: how coarse
// it looks, wet: 0..1 rain on the road.
export function setRoadSurface(mat, { tone = 1, bump = 1, wet = 0 } = {}) {
  mat.userData.uniforms.uSurface.value.set(tone, bump, wet);
}
