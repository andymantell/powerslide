// Shared material for props (tools/blender/props.py) and road structures
// (src/structures.js). Geometry carries a colour (vertex colour) and a surface
// kind in uv.x ((kind + 0.5) / 8). The shader adds detail from one packed
// texture (tools/textures/props.py), projected from the prop's own axes so it
// sticks to the model, and bumps the normal from it:
//   0 paint   1 planks   2 shingles   3 masonry   4 plaster   5 glass   6 metal   7 emissive
//   8 leaves, 9 paving flags, 10 tarmac (street geometry built in src/structures.js;
//   uv.x runs past 1 for these; paving and tarmac use the ground textures),
//   11 windows: city glass, panes 3 m apart along each wall and floors 3.2 m
//   apart; at night about half of them are lit (a hash of the pane and the
//   instance's position)
import * as THREE from 'three';
import { groundTexture } from './ground.js';
import { addLampLights, lampsOn } from './lamps.js';

const DETAIL = new URL('./assets/textures/props_detail.png', import.meta.url).href;
let detailTex = null;

export function createPropMaterial(renderer) {
  if (!detailTex) {
    detailTex = new THREE.TextureLoader().load(DETAIL);
    detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
    detailTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    detailTex.colorSpace = THREE.NoColorSpace;
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const uniforms = {
    tDetail: { value: detailTex },
    uNight: { value: 0 },
    tPave: { value: groundTexture('paving', 'albedo', renderer) },
    tTar: { value: groundTexture('asphalt', 'albedo', renderer) },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPLocal;\nvarying vec3 vPNormal;\nvarying vec3 vPInst;\nvarying float vKind;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vKind = floor(uv.x * 8.0);
        vPLocal = position;
        vPNormal = normal;
        vPInst = vec3(0.0);
        #ifdef USE_INSTANCING
        vPInst = instanceMatrix[3].xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tDetail, tPave, tTar;
        uniform float uNight;
        varying vec3 vPLocal;
        varying vec3 vPNormal;
        varying vec3 vPInst;
        varying float vKind;
        float pHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        // Planar projection from the dominant axis of the model-space normal.
        // Boards and courses run horizontally on walls; roofs project from above.
        vec2 pUv(vec3 p, vec3 n) {
          vec3 a = abs(n);
          if (a.y > a.x && a.y > a.z) return p.xz;
          return a.x > a.z ? vec2(p.z, p.y) : vec2(p.x, p.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `
        float pk = vKind;
        vec2 puv = pUv(vPLocal, normalize(vPNormal));
        float ph = 0.5;
        float pScale = 0.5;
        if (pk > 0.5 && pk < 4.5) {
          vec4 dt;
          if (pk < 1.5) { pScale = 0.5; dt = texture2D(tDetail, puv * 0.5); ph = dt.r; }
          else if (pk < 2.5) {
            // Shingle rows run across the slope: on a roof, rows follow the eaves.
            vec2 ruv = abs(normalize(vPNormal).y) > 0.3 ? vPLocal.zx : puv;
            dt = texture2D(tDetail, ruv * 0.5); ph = dt.g;
          }
          else if (pk < 3.5) { pScale = 0.333; dt = texture2D(tDetail, puv * 0.333); ph = dt.b; }
          else { pScale = 0.25; dt = texture2D(tDetail, puv * 0.25); ph = dt.a; }
          float amt = pk < 3.5 ? 0.95 : 0.22;
          diffuseColor.rgb *= 1.0 + (ph - 0.5) * amt;
        }
        float paneHash = 0.0;
        if (pk > 10.5) {
          // Windows: each pane gets its own blind or curtain shade by day.
          // Panes are 3 m apart along each wall face, floors 3.2 m apart.
          vec3 pn = normalize(vPNormal);
          vec3 cell = abs(pn.x) > abs(pn.z)
            ? vec3(floor(vPLocal.z / 3.0), floor(vPLocal.y / 3.2), sign(pn.x) * 7.0)
            : vec3(floor(vPLocal.x / 3.0), floor(vPLocal.y / 3.2), sign(pn.z) * 11.0);
          paneHash = pHash(cell + floor(vPInst * 0.37));
          diffuseColor.rgb *= 0.6 + 0.8 * fract(paneHash * 7.31);
        } else if (pk > 8.5) {
          // Paving flags (2.4 m per tile) or tarmac (as the road's, 1.33 m):
          // the vertex colour sets the overall shade.
          vec4 gT = pk < 9.5 ? texture2D(tPave, puv / 2.4) : texture2D(tTar, puv * 0.75);
          diffuseColor.rgb *= gT.rgb * (pk < 9.5 ? 1.55 : 2.6);
          ph = gT.a;
        } else if (pk > 7.5) {
          // Leaves: clumps from two scales of the detail texture, with dark
          // gaps between them and lighter tips catching the sky.
          vec2 luv = puv * 1.6;
          float l1 = texture2D(tDetail, luv * 0.9).a;
          float l2 = texture2D(tDetail, luv * 2.7 + 0.31).b;
          ph = l1 * 0.6 + l2 * 0.4;
          diffuseColor.rgb *= 0.45 + smoothstep(0.25, 0.75, ph) * 0.95;
          diffuseColor.rgb *= mix(vec3(0.92, 1.0, 0.85), vec3(1.08, 1.0, 1.1), l2);
        }
        // Ground contact: a little darker near the base of each prop.
        diffuseColor.rgb *= 0.72 + 0.28 * smoothstep(-0.2, 1.6, vPLocal.y);
        float pRough = pk < 0.5 ? 0.6 : pk < 1.5 ? 0.85 : pk < 2.5 ? 0.8 : pk < 3.5 ? 0.92 : pk < 4.5 ? 0.9 : pk < 5.5 ? 0.08 : pk < 6.5 ? 0.38 : pk < 7.5 ? 0.5 : pk < 8.5 ? 0.95 : pk < 9.5 ? 0.85 : pk < 10.5 ? 0.9 : 0.1;
        float pMetal = (pk > 5.5 && pk < 6.5) ? 0.75 : 0.0;
        `,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = pMetal;')
      .replace(
        '#include <normal_fragment_maps>',
        `if ((pk > 0.5 && pk < 4.5) || pk > 7.5) {
          // Bump from the detail height (as three's bumpmap), fading with distance.
          float bump = (pk > 8.5 ? 0.8 : pk > 7.5 ? 2.5 : pk < 3.5 ? 1.2 : 0.3) * smoothstep(80.0, 8.0, length(vViewPosition));
          vec3 sx = normalize(dFdx(-vViewPosition)), sy = normalize(dFdy(-vViewPosition));
          vec2 dh = vec2(dFdx(ph), dFdy(ph)) * bump;
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (pk > 6.5 && pk < 7.5) totalEmissiveRadiance += diffuseColor.rgb * (0.6 + uNight * 2.4);
        else if (pk > 4.5 && pk < 5.5) totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * uNight * 0.9;
        else if (pk > 10.5 && paneHash < 0.45) {
          // Lit panes: mostly warm lamps, some cool office light, some dim.
          vec3 lit = fract(paneHash * 13.7) < 0.25 ? vec3(0.62, 0.78, 1.0) : vec3(1.0, 0.66, 0.32);
          totalEmissiveRadiance += lit * uNight * (0.12 + 0.5 * fract(paneHash * 3.1) * fract(paneHash * 5.3));
        }`,
      );
    addLampLights(shader);
  };
  mat.customProgramCacheKey = () => `prop-${lampsOn()}`;
  return mat;
}
