// Post-processing chain, scaled by the quality preset. Low and Medium render
// straight to the screen (tone mapping happens in each material); High adds
// bloom on a multisampled HDR target, Ultra adds ground-truth ambient
// occlusion as well.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ENV } from './sky.js';

export class Post {
  constructor(renderer, scene, camera, q) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    if (!q.bloom && !q.ao) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: q.antialias ? 4 : 0,
    });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      const ao = new GTAOPass(scene, camera, size.x, size.y);
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 2, scale: 1.2 });
      ao.blendIntensity = 0.85;
      composer.addPass(ao);
      this.ao = ao;
    }
    if (q.bloom) {
      // Only genuinely bright things should bloom: the sun and glints by day
      // (sunlit cloud is bright enough to fog the whole screen at a lower
      // threshold), lamps and headlights at night.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.5, 12);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    // A composer given its own target takes that target's size in device
    // pixels as its CSS size with a pixel ratio of 1, so the first
    // setPixelRatio() from the dynamic resolution would scale it up again
    // (four times the pixels at a ratio of 2). Size it in CSS pixels instead.
    const r = renderer.getPixelRatio();
    composer.setSize(size.x / r, size.y / r);
    composer.setPixelRatio(r);
    this.composer = composer;
  }

  setSize(w, h) {
    this.composer?.setSize(w, h);
  }

  setPixelRatio(r) {
    this.composer?.setPixelRatio(r);
  }

  render() {
    if (this.bloom) this.bloom.threshold = ENV.night > 0.4 ? 1.5 : 12;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
