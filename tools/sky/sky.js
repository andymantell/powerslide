// Sky preview: renders only the baked sky for a biome, time and weather, in
// four directions (towards the sun, away from it, and either side), so the
// clouds can be tuned without booting the game.
// /tools/sky/?biome=alpine&time=dusk&weather=cloudy&quality=medium&pitch=18
import * as THREE from 'three';
import { createSky, atmosphereFor, SUN_DIR } from '../../src/sky.js';
import { QUALITY } from '../../src/settings.js';

const params = new URLSearchParams(location.search);
const q = QUALITY[params.get('quality') || 'medium'];
const W = 1280, H = 720;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
createSky(scene, renderer, q, atmosphereFor(params.get('biome') || 'alpine', params.get('time') || 'day', params.get('weather') || 'clear'));
const camera = new THREE.PerspectiveCamera(75, W / 2 / (H / 2), 0.1, 100);
const pitch = (+(params.get('pitch') ?? 18) * Math.PI) / 180;
const az = Math.atan2(SUN_DIR.z, SUN_DIR.x);
renderer.setScissorTest(true);
[0, Math.PI, Math.PI / 2, -Math.PI / 2].forEach((a, i) => {
  const x = (i % 2) * (W / 2), y = (1 - Math.floor(i / 2)) * (H / 2);
  camera.lookAt(Math.cos(az + a) * Math.cos(pitch), Math.sin(pitch), Math.sin(az + a) * Math.cos(pitch));
  renderer.setViewport(x, y, W / 2, H / 2);
  renderer.setScissor(x, y, W / 2, H / 2);
  renderer.render(scene, camera);
});
document.title = 'Sky ready';
