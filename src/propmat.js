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
//   instance's position),
//   12 rock and 13 snow/ice: the ground's rock and snow textures, projected
//   three ways in model space (structures are built in world space), with
//   the vertex colour tinting them
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
    tRockT: { value: groundTexture('rock', 'albedo', renderer) },
    tSnowT: { value: groundTexture('snow', 'albedo', renderer) },
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
        uniform sampler2D tDetail, tPave, tTar, tRockT, tSnowT;
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
        }
        // Interior mapping: a lit room behind a window, faked by casting the
        // view ray into a box (one cell of the wall grid wide and tall, depth
        // deep) and shading whichever wall, floor or ceiling it hits. h picks
        // the room's colours and furnishings. Returns the room's light.
        vec3 pRoom(vec3 pl, vec3 pn, vec3 nV, vec2 cell, float depth, float h, bool shop) {
          vec3 tM = normalize(cross(vec3(0.0, 1.0, 0.0), pn));
          vec2 f = fract(vec2(dot(pl, tM), pl.y) / cell);
          vec3 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
          vec3 tV = normalize(cross(up, nV));
          vec3 bV = cross(nV, tV);
          vec3 rd = normalize(-vViewPosition);
          vec3 d = vec3(dot(rd, tV) / cell.x, dot(rd, bV) / cell.y, min(dot(rd, nV), -0.05) / depth);
          d.xy += sign(d.xy) * 1e-4;
          vec2 txy = (step(0.0, d.xy) - f) / d.xy;
          float tz = -1.0 / d.z;
          float t = min(min(txy.x, txy.y), tz);
          vec3 hit = vec3(f, 0.0) + d * t;
          vec3 wall = mix(vec3(0.95, 0.82, 0.62), vec3(0.7, 0.8, 0.85), step(0.6, fract(h * 17.3)));
          vec3 c;
          if (t == tz) {
            c = wall;
            // Furniture against the back wall: a sofa, a desk or shelves.
            float fx = abs(hit.x - 0.3 - fract(h * 5.7) * 0.4);
            if (fx < 0.22 && hit.y < 0.25 + fract(h * 9.1) * 0.2) c *= 0.35;
            // A picture or a poster.
            if (abs(hit.x - 0.5 - (fract(h * 3.3) - 0.5) * 0.3) < 0.1 && abs(hit.y - 0.62) < 0.09) c = mix(c, vec3(0.5, 0.3, 0.25) + fract(h * vec3(7.1, 3.7, 5.3)) * 0.4, 0.8);
          } else if (t == txy.y) {
            c = d.y > 0.0 ? vec3(1.2) : vec3(0.3, 0.2, 0.13) * (0.6 + 0.8 * fract(h * 2.9));
          } else {
            c = wall * 0.6;
            // A doorway in one side wall.
            if (abs(hit.z + 0.55) < 0.14 && hit.y < 0.7 && hit.x > 0.5 == fract(h * 4.3) > 0.5) c *= 0.3;
          }
          if (shop && hit.y < 0.78 && t != txy.y) {
            // Shelves of goods round a shop: bands of mixed colour.
            float row = floor(hit.y * 5.0), sy = fract(hit.y * 5.0);
            float along = t == tz ? hit.x : hit.z;
            vec3 goods = 0.35 + 0.55 * fract(h * vec3(7.1, 3.7, 5.3) + floor(along * 9.0) * vec3(0.37, 0.61, 0.23) + row * 0.29);
            c = mix(c, goods, step(0.25, sy) * 0.75);
            c *= 0.6 + 0.4 * step(0.12, sy);
          }
          // Light from a ceiling lamp, falling off towards the floor and back.
          float lamp = 0.45 + 0.75 * hit.y * hit.y;
          lamp *= 1.0 - 0.5 * smoothstep(0.0, 1.0, -hit.z);
          return c * lamp;
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
        float pIce = 0.0;
        if (pk > 11.5) {
          vec3 tn = normalize(vPNormal);
          vec3 tw = pow(abs(tn), vec3(4.0));
          tw /= tw.x + tw.y + tw.z;
          if (pk < 12.5) {
            // Rock: the ground's rock at two scales so big faces don't tile.
            vec4 r1 = texture2D(tRockT, vPLocal.zy * 0.16) * tw.x + texture2D(tRockT, vPLocal.xz * 0.16) * tw.y + texture2D(tRockT, vPLocal.xy * 0.16) * tw.z;
            vec4 r2 = texture2D(tRockT, vPLocal.zy * 0.037 + 0.3) * tw.x + texture2D(tRockT, vPLocal.xz * 0.037 + 0.3) * tw.y + texture2D(tRockT, vPLocal.xy * 0.037 + 0.3) * tw.z;
            // The vertex colour tints the rock and only shades it a little,
            // so neighbouring facets don't read as flat patches.
            // (Vertex colours are multiplied in after this, so divide out
            // most of their brightness here.)
            float vl = 1.0;
            #ifdef USE_COLOR
            vl = max(dot(vColor.rgb, vec3(0.333)), 0.02);
            #endif
            diffuseColor.rgb *= r1.rgb * (0.6 + dot(r2.rgb, vec3(0.5))) * mix(1.0, vl / 0.16, 0.3) / vl;
            ph = mix(r1.a, r2.a, 0.35);
          } else {
            // Snow and ice: soft drifts of brightness, and on steep faces the
            // faint horizontal layers of each winter's snowfall.
            vec4 s1 = texture2D(tSnowT, vPLocal.zy * 0.25) * tw.x + texture2D(tSnowT, vPLocal.xz * 0.25) * tw.y + texture2D(tSnowT, vPLocal.xy * 0.25) * tw.z;
            float steep = 1.0 - tw.y;
            float layers = sin(vPLocal.y * 3.1 + s1.a * 3.0 + sin(vPLocal.y * 0.7) * 2.0) * 0.5 + 0.5;
            // Where a blower cut the wall: curved scoops a metre or so across.
            vec3 tM = normalize(cross(vec3(0.0, 1.0, 0.0), tn + vec3(0.0, 0.0, 1e-4)));
            vec2 sc = vec2(dot(vPLocal, tM), vPLocal.y) / vec2(1.3, 1.1);
            vec2 sf = fract(sc + vec2(0.5 * floor(sc.y), 0.0)) - 0.5;
            float scoop = smoothstep(0.1, 0.5, length(sf * vec2(1.0, 1.4)));
            diffuseColor.rgb *= (0.74 + s1.a * 0.42) * (1.0 - steep * (0.16 * layers * layers + 0.12 * scoop));
            ph = s1.a * 0.5 + steep * (layers * 0.25 + scoop * 0.5);
            // Bare glacier ice (greyer than snow): a web of blue-grey cracks
            // and meltwater runnels across its upper surface.
            // (Vertex colours are applied after this, so look at them directly.)
            float ice = 0.0;
            #ifdef USE_COLOR
            ice = smoothstep(0.8, 0.6, dot(vColor.rgb, vec3(0.333))) * smoothstep(0.5, 0.8, tw.y);
            #endif
            pIce = ice;
            if (ice > 0.01) {
              float c2 = texture2D(tSnowT, vPLocal.xz * 0.043 + 0.2).a;
              float c3 = texture2D(tSnowT, vPLocal.zx * 0.11 + 0.7).a;
              float crack = (1.0 - smoothstep(0.0, 0.08, abs(c2 - 0.5))) * 0.8 + (1.0 - smoothstep(0.0, 0.06, abs(c3 - 0.5))) * 0.5;
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.66, 0.8), min(crack, 1.0) * ice);
              // Ice soaks up more light than snow does.
              diffuseColor.rgb *= 1.0 - 0.3 * ice;
              ph -= crack * ice * 0.4;
            }
          }
        } else if (pk > 10.5) {
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
        float pRough = pk < 0.5 ? 0.6 : pk < 1.5 ? 0.85 : pk < 2.5 ? 0.8 : pk < 3.5 ? 0.92 : pk < 4.5 ? 0.9 : pk < 5.5 ? 0.08 : pk < 6.5 ? 0.38 : pk < 7.5 ? 0.5 : pk < 8.5 ? 0.95 : pk < 9.5 ? 0.85 : pk < 10.5 ? 0.9 : pk < 11.5 ? 0.1 : pk < 12.5 ? 0.9 : mix(0.85, 0.95, pIce);
        float pMetal = (pk > 5.5 && pk < 6.5) ? 0.75 : 0.0;
        `,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = pMetal;')
      .replace(
        '#include <normal_fragment_maps>',
        `if ((pk > 0.5 && pk < 4.5) || pk > 7.5) {
          // Bump from the detail height (as three's bumpmap), fading with distance.
          float bump = (pk > 12.5 ? 2.6 : pk > 11.5 ? 1.4 : pk > 8.5 ? 0.8 : pk > 7.5 ? 2.5 : pk < 3.5 ? 1.2 : 0.3) * smoothstep(80.0, 8.0, length(vViewPosition));
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
        else if (uNight > 0.01 && ((pk > 4.5 && pk < 5.5) || (pk > 10.5 && pk < 11.5 && paneHash < 0.45))) {
          vec3 pn = normalize(vPNormal);
          // Shop and cottage glass (5) shows a wider, deeper room than city
          // panes, and is always lit.
          bool shop = pk < 5.5;
          vec2 cell = shop ? vec2(4.0, 3.2) : vec2(3.0, 3.2);
          vec3 tM = normalize(cross(vec3(0.0, 1.0, 0.0), pn));
          float h = shop ? pHash(vec3(floor(dot(vPLocal, tM) / 4.0), floor(vPLocal.y / 3.2), 3.0) + floor(vPInst * 0.37)) : paneHash;
          // Mostly warm lamps, some cool office light, some dim.
          vec3 lit = fract(h * 13.7) < 0.25 ? vec3(0.62, 0.78, 1.0) : vec3(1.0, 0.66, 0.32);
          float k = shop ? 1.1 : 0.25 + 0.75 * fract(h * 3.1) * fract(h * 5.3);
          vec3 room = abs(pn.y) < 0.5 ? pRoom(vPLocal, pn, normalize(nonPerturbedNormal), cell, shop ? 5.0 : 4.0, h, shop) : vec3(0.5);
          totalEmissiveRadiance += room * lit * uNight * k;
        }`,
      );
    addLampLights(shader);
  };
  mat.customProgramCacheKey = () => `prop-${lampsOn()}`;
  return mat;
}
