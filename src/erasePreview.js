import * as THREE from 'three';

// Fixed-size coverage texture: stroke length never increases shader work.
export class ErasePreview {
  constructor(material, size = 256) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.generateMipmaps = false;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.uniforms = {
      erasePreviewEnabled:{value:0}, eraseCoverage:{value:this.texture},
      eraseEye:{value:new THREE.Vector3()}, erasePlane:{value:0},
      eraseBounds:{value:new THREE.Vector4()}, eraseMirror:{value:false},
    };
    const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader,renderer) => {
      compile.call(material,shader,renderer);
      Object.assign(shader.uniforms,this.uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 eraseLocalPosition;')
        .replace('#include <project_vertex>', 'eraseLocalPosition = transformed;\n#include <project_vertex>');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 eraseLocalPosition;
uniform float erasePreviewEnabled;
uniform sampler2D eraseCoverage;
uniform vec3 eraseEye;
uniform float erasePlane;
uniform vec4 eraseBounds;
uniform bool eraseMirror;
float eraseSample(vec3 p) {
  float t = (erasePlane-eraseEye.z)/(p.z-eraseEye.z);
  vec2 projected = eraseEye.xy+(p.xy-eraseEye.xy)*t;
  vec2 uv = (projected-eraseBounds.xy)/eraseBounds.zw;
  if (any(lessThan(uv,vec2(0.0))) || any(greaterThan(uv,vec2(1.0)))) return 0.0;
  return texture2D(eraseCoverage,uv).a;
}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (erasePreviewEnabled > 0.5) {
  float coverage = eraseSample(eraseLocalPosition);
  if (eraseMirror) coverage = max(coverage,eraseSample(vec3(-eraseLocalPosition.x,eraseLocalPosition.yz)));
  if (coverage > 0.5) discard;
}`);
    };
    material.customProgramCacheKey = () => `${key}:erase-preview-v1`;
    material.needsUpdate = true;
  }
  begin(radius,eye,planeZ,symmetry,bounds) {
    const boxes = bounds.flatMap(b => symmetry ? [b.direct,b.mirror] : [b.direct]);
    const minX = Math.min(...boxes.map(b=>b[0]))-radius;
    const minY = Math.min(...boxes.map(b=>b[1]))-radius;
    const maxX = Math.max(...boxes.map(b=>b[2]))+radius;
    const maxY = Math.max(...boxes.map(b=>b[3]))+radius;
    if (![minX,minY,maxX,maxY].every(Number.isFinite)) return;
    this.box = [minX,minY,maxX-minX,maxY-minY];
    this.radius = Math.max(0,radius-.0125); // Leave the final rim to real geometry.
    this.last = null;
    this.context.clearRect(0,0,this.size,this.size);
    const u = this.uniforms;
    u.eraseEye.value.fromArray(eye); u.erasePlane.value = planeZ;
    u.eraseBounds.value.fromArray(this.box); u.eraseMirror.value = symmetry;
    u.erasePreviewEnabled.value = 1; this.texture.needsUpdate = true;
  }
  update(point) {
    if (!this.uniforms.erasePreviewEnabled.value) return;
    const [x,y,w,h] = this.box, c = this.context;
    // Canvas Y grows downwards; CanvasTexture flips Y during upload.
    const map = p => [(p[0]-x)/w*this.size,(1-(p[1]-y)/h)*this.size];
    const a = map(this.last ?? point), b = map(point);
    c.save(); c.scale(this.size/w,this.size/h);
    c.strokeStyle = c.fillStyle = '#ffffff'; c.lineWidth = this.radius*2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(a[0]*w/this.size,a[1]*h/this.size); c.lineTo(b[0]*w/this.size,b[1]*h/this.size); c.stroke();
    c.beginPath(); c.arc(b[0]*w/this.size,b[1]*h/this.size,this.radius,0,Math.PI*2); c.fill();
    c.restore(); this.last = [...point]; this.texture.needsUpdate = true;
  }
  clear() { this.uniforms.erasePreviewEnabled.value = 0; this.last = null; }
  dispose() { this.clear(); this.texture.dispose(); }
}
