// Canvas-generated textures, so the game ships with no binary assets.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const ROAD_TEX_LENGTH = 12; // metres of road per texture repeat

export function makeAsphaltTexture(renderer) {
  const w = 512;
  const h = 1024;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const rand = mulberry32(42);

  ctx.fillStyle = '#4a4a4c';
  ctx.fillRect(0, 0, w, h);
  // Aggregate speckle.
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 38 + (rand() < 0.02 ? 30 : 0);
    d[i] = d[i] + n;
    d[i + 1] = d[i + 1] + n;
    d[i + 2] = d[i + 2] + n + 2;
  }
  ctx.putImageData(img, 0, 0);
  // Wheel-worn darker tracks in each lane.
  const px = (m) => ((m + 4.25) / 8.5) * w;
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#202022';
  for (const lane of [-1.75, 1.75]) {
    for (const off of [-0.8, 0.8]) {
      ctx.fillRect(px(lane + off) - 18, 0, 36, h);
    }
  }
  // A few cracks and tar patches.
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#1c1c1e';
  ctx.lineWidth = 2;
  for (let c = 0; c < 6; c++) {
    let x = rand() * w;
    let y = rand() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rand() - 0.5) * 40;
      y += rand() * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Edge lines (solid white).
  ctx.fillStyle = '#e8e6df';
  ctx.fillRect(px(-3.95), 0, px(-3.8) - px(-3.95), h);
  ctx.fillRect(px(3.8), 0, px(3.95) - px(3.8), h);
  // Centre line: dashed yellow, 4 m on, 8 m off.
  ctx.fillStyle = '#e6c234';
  const dashLen = (4 / ROAD_TEX_LENGTH) * h;
  ctx.fillRect(px(-0.08), 0, px(0.08) - px(-0.08), dashLen);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  return tex;
}

export function makeNoiseTexture(size = 256, base = 128, spread = 60, seed = 3) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rand = mulberry32(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = base + (rand() - 0.5) * spread;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function makeSoftDotTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

// Irregular sandy blotch with soft, noisy edges for grit patches.
export function makeGritTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const rand = mulberry32(77);
  for (let i = 0; i < 6000; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.7) * size * 0.46;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    const g = 170 + rand() * 70;
    ctx.fillStyle = `rgba(${g}, ${g * 0.86}, ${g * 0.66}, ${0.45 + rand() * 0.5})`;
    const s = 1 + rand() * 4;
    ctx.fillRect(x, y, s, s);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
