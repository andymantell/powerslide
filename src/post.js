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
      // Only genuinely bright things (sun, glints, lamps) should bloom.
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.5, 2.0));
    }
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setSize(w, h) {
    this.composer?.setSize(w, h);
  }

  setPixelRatio(r) {
    this.composer?.setPixelRatio(r);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
