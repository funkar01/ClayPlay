import * as THREE from 'three';

// Run the same invertible flow as maskWarp.js on the GPU. The source mesh
// stays unchanged until commit; neither input nor paint waits for a worker.
export const pullVertexShader = /* glsl */`
uniform float pullEnabled;
uniform vec3 pullCenter;
uniform vec3 pullDelta;
uniform float pullSupport;
uniform float pullFalloff;
uniform int pullSteps;
uniform bool pullSymmetry;

void pullWeight(vec3 p, vec3 c, out float w, out vec3 g) {
  vec3 offset = p - c;
  float distance = length(offset);
  w = 0.0; g = vec3(0.0);
  if (distance >= pullSupport) return;
  float t = max(0.0, (distance / pullSupport - 0.35) / 0.65);
  float base = max(0.0, 1.0 - t * t * (3.0 - 2.0 * t));
  w = pow(base, pullFalloff);
  if (distance > 0.0 && t > 0.0) {
    g = offset * (-6.0 * t * (1.0 - t) * pullFalloff * pow(max(base, 1e-12), pullFalloff - 1.0)
      / (0.65 * pullSupport * distance));
  }
}

bool pullOutside(vec3 p, vec3 center) {
  vec3 offset = p - center;
  float len2 = dot(pullDelta, pullDelta);
  float t = len2 > 0.0 ? clamp(dot(offset, pullDelta) / len2, 0.0, 1.0) : 0.0;
  vec3 d = offset - t * pullDelta;
  return dot(d, d) >= pullSupport * pullSupport;
}

void pullVertex(inout vec3 p, inout vec3 n) {
  if (pullEnabled < 0.5 || pullSteps == 0 || pullSupport <= 0.0) return;
  if (pullOutside(p, pullCenter) && (!pullSymmetry || pullOutside(vec3(-p.x, p.yz), pullCenter))) return;
  vec3 stepDelta = pullDelta / float(pullSteps);
  for (int i = 0; i < pullSteps; i++) {
    vec3 c = pullCenter + stepDelta * float(i);
    float a; vec3 ga;
    pullWeight(p, c, a, ga);
    if (pullSymmetry) {
      float b; vec3 gb;
      pullWeight(vec3(-p.x, p.yz), c, b, gb); gb.x = -gb.x;
      if (a == 0.0 && b == 0.0) continue;
      vec3 g = abs(a - b) < 1e-7 ? (ga + gb) * 0.5 : (a > b ? ga : gb);
      vec3 difference = ga - gb;
      vec3 u = vec3(1.0 + stepDelta.x * difference.x, stepDelta.y * g.x, stepDelta.z * g.x);
      vec3 v = vec3(stepDelta.x * difference.y, 1.0 + stepDelta.y * g.y, stepDelta.z * g.y);
      vec3 w = vec3(stepDelta.x * difference.z, stepDelta.y * g.z, 1.0 + stepDelta.z * g.z);
      n = normalize((cross(v, w) * n.x + cross(w, u) * n.y + cross(u, v) * n.z) / dot(u, cross(v, w)));
      p += vec3(stepDelta.x * (a - b), stepDelta.yz * max(a, b));
    } else {
      if (a == 0.0) continue;
      n = normalize(n - ga * (dot(stepDelta, n) / (1.0 + dot(ga, stepDelta))));
      p += stepDelta * a;
    }
  }
}
`;

export class PullPreview {
  constructor(material) {
    this.uniforms = {
      pullEnabled: { value: 0 }, pullCenter: { value: new THREE.Vector3() },
      pullDelta: { value: new THREE.Vector3() }, pullSupport: { value: 0 },
      pullFalloff: { value: 1 }, pullSteps: { value: 0 }, pullSymmetry: { value: false },
    };
    const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${pullVertexShader}`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 pullPosition = position;\npullVertex(pullPosition, objectNormal);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = pullPosition;');
    };
    material.customProgramCacheKey = () => `${cacheKey}:clay-pull-v1`;
    material.needsUpdate = true;
  }
  begin(warp) { this.target = warp; this.at = null; this.write(warp, warp.delta); }
  update(warp) { this.target = warp; }
  write(warp, delta) {
    const u = this.uniforms;
    u.pullCenter.value.fromArray(warp.center); u.pullDelta.value.fromArray(delta);
    u.pullSupport.value = warp.support; u.pullFalloff.value = warp.falloff;
    u.pullSymmetry.value = warp.symmetry; u.pullEnabled.value = 1;
    u.pullSteps.value = warp.support ? Math.ceil(Math.hypot(...delta) / (warp.support / (warp.symmetry ? 12 : 6))) : 0;
  }
  tick(now) {
    if (!this.target) return;
    const dt = this.at === null ? 1 / 60 : Math.max(0, (now - this.at) / 1000);
    this.at = now;
    // Interpolate toward measured input, with no extrapolation or overshoot.
    // This keeps the surface moving between camera results at display cadence.
    const blend = 1 - Math.exp(-dt / .012), current = this.uniforms.pullDelta.value.toArray();
    const delta = current.map((v, i) => v + (this.target.delta[i] - v) * blend);
    this.write(this.target, delta);
  }
  freeze(warp) { this.write(warp, warp.delta); this.target = null; }
  clear() { this.target = null; this.uniforms.pullEnabled.value = 0; }
}
