const assert = require('node:assert/strict');

module.exports = async function(page) {
  const shaderErrors = [];
  page.on('console', message => { if (message.type()==='error' && /shader|WebGLProgram/i.test(message.text())) shaderErrors.push(message.text()); });
  await page.addInitScript(() => {
    window.pullJobs = [];
    const RealWorker = window.Worker;
    window.Worker = class extends RealWorker {
      constructor(url, options) { super(url, options); this.isPull = String(url).includes('pullWorker'); }
      postMessage(data, ...args) { if(this.isPull) window.pullJobs.push({type:data.type,final:data.final}); super.postMessage(data,...args); }
      set onmessage(callback) { super.onmessage = this.isPull ? event => setTimeout(()=>callback(event),500) : callback; }
    };
  });
  await page.goto(process.env.CLAYPLAY_TEST_URL || 'http://127.0.0.1:5174/?diagnostics');
  await page.waitForFunction(()=>window.clayPlayDebug&&!window.clayPlayDebug.getState().pending);
  const gpu = await page.evaluate(async () => {
    const {pullVertexShader} = await import('/src/pullPreview.js');
    const {makeWarp,warpVertex} = await import('/src/maskWarp.js');
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw Error('WebGL2 unavailable');
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const program=gl.createProgram();
    gl.attachShader(program,shader(gl.VERTEX_SHADER,'#version 300 es\nprecision highp float;\nprecision highp int;\n'+pullVertexShader+'\nin vec3 testPosition; in vec3 testNormal; out vec3 resultPosition; out vec3 resultNormal; void main(){resultPosition=testPosition; resultNormal=testNormal; pullVertex(resultPosition,resultNormal);gl_Position=vec4(0,0,0,1);}'));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1);}'));
    gl.transformFeedbackVaryings(program,['resultPosition','resultNormal'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    gl.bindVertexArray(gl.createVertexArray());
    const input=gl.createBuffer(), output=gl.createBuffer();
    const tf=gl.createTransformFeedback();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,tf);
    gl.enable(gl.RASTERIZER_DISCARD);
    let positionError=0,normalError=0,count=0;
    for(const symmetry of [false,true])for(const radius of [.014,.042,.336])for(const delta of [[.18,.12,.02],[-.22,.05,0],[0,0,0]]) {
      const warp=makeWarp([.4,.6,.3],delta,radius,.55,symmetry);
      const points=Array.from({length:40},(_,i)=>[(i%2?-1:1)*(.4+radius*((i%5)-2)/3),.6+radius*((i%7)-3)/4,.3+radius*((i%3)-1)/3]);
      const values=new Float32Array(points.flatMap(p=>[...p,0,0,1]));
      gl.bindBuffer(gl.ARRAY_BUFFER,input);gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);
      for(const [name,offset] of [['testPosition',0],['testNormal',12]]){const at=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,3,gl.FLOAT,false,24,offset);}
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,values.byteLength,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);
      for(const [name,value]of[['pullEnabled',1],['pullSupport',radius],['pullFalloff',warp.falloff]])gl.uniform1f(gl.getUniformLocation(program,name),value);
      for(const[name,value]of[['pullSteps',warp.steps.length],['pullSymmetry',symmetry?1:0]])gl.uniform1i(gl.getUniformLocation(program,name),value);
      gl.uniform3fv(gl.getUniformLocation(program,'pullCenter'),warp.center);gl.uniform3fv(gl.getUniformLocation(program,'pullDelta'),warp.delta);
      gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,points.length);gl.endTransformFeedback();
      const result=new Float32Array(values.length);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,result);
      for(let i=0;i<points.length;i++) {
        const p=Array.from(values.slice(i*6,i*6+3)), expected=warpVertex(...p,[0,0,1],warp);
        for(let a=0;a<3;a++) {positionError=Math.max(positionError,Math.abs(expected.point[a]-result[i*6+a]));normalError=Math.max(normalError,Math.abs(expected.normal[a]-result[i*6+3+a]));}
        count++;
      }
    }
    gl.disable(gl.RASTERIZER_DISCARD);
    const error=gl.getError();gl.getExtension('WEBGL_lose_context')?.loseContext();
    return{positionError,normalError,count,error};
  });
  console.log('GPU versus worker flow:',gpu);
  assert.equal(gpu.error,0);assert.ok(gpu.positionError<.0002);assert.ok(gpu.normalError<.003);
  const stats=()=>page.evaluate(()=>{let n=0,sum=0;for(const {mesh}of window.clayPlayDebug.objects.active.volume.bricks.values())for(const v of mesh.geometry.attributes.position.array)sum+=v*(++n%31+1);return{n,sum};});
  const original=await stats();
  await page.evaluate(()=>{
    const d=window.clayPlayDebug,p=d.objects.active.group.localToWorld(new d.camera.position.constructor(.65,.65,.5)).project(d.camera);
    window.pinchTarget={x:(1-p.x)/2,y:(1-p.y)/2};
    window.feedContinuous=(offset,held,delay=230,relaxed=false)=>{
      const {x:base,y}=window.pinchTarget,x=base+offset,p=Array.from({length:21},()=>({x,y:y+.08,z:0}));
      p[0]={x,y:y+.2,z:0};p[5]={x:x-.05,y:y+.1,z:0};p[9]={x,y:y+.09,z:0};p[17]={x:x+.08,y:y+.12,z:0};
      for(const[joint,tip,dx]of[[6,8,0],[10,12,.025],[14,16,.06],[18,20,.095]]){p[joint]={x:x+dx,y:y+.06,z:0};p[tip]={x:x+dx,y,z:0};}
      p[4]={x:x+(held?.003:-.08),y,z:0};
      if(relaxed)for(const tip of [16,20])p[tip].y=y+.14;
      const now=performance.now();d.feedHands([p],now,{sampleAt:now-delay});return d.getState();
    };
    // Hide all cues for the pixel comparison of GPU preview and CPU commit.
    for(const child of d.objects.scene.children)if(child!==d.objects.active.group&&!child.isLight)child.layers.disable(0);
  });
  await page.evaluate(()=>window.feedContinuous(0,false));
  const first=await page.evaluate(()=>window.feedContinuous(0,true));
  assert.equal(first.grabbed,true,'Clear pinch grabs on the first measured image');
  const dropoutStart=first.dropouts;
  const live = await page.evaluate(async()=>{
    const samples=[];
    for(let i=0;i<8;i++) {
      window.feedContinuous(-.02-i*.004,true,230,i>3);
      for(let f=0;f<3;f++){await new Promise(requestAnimationFrame);const d=window.clayPlayDebug;samples.push({delta:d.objects.active.volume.pullPreview.uniforms.pullDelta.value.toArray(),grabbed:d.getState().grabbed});}
    }
    return{samples,state:window.clayPlayDebug.getState(),jobs:window.pullJobs};
  });
  assert.equal(live.state.grabbed,true);assert.equal(live.state.dropouts,dropoutStart,'Stable 230 ms delay does not pause a grab');
  assert.ok(live.samples.every(s=>s.grabbed),'A held stroke survives relaxed outer fingers');
  assert.equal(live.jobs.filter(j=>j.type==='preview').length,0,'Live shape never waits for worker preview jobs');
  assert.ok(live.samples.slice(1).some((s,i)=>Math.hypot(...s.delta)>Math.hypot(...live.samples[i].delta)+.001),'Shape advances between measured results');
  const held=await page.evaluate(()=>window.clayPlayDebug.objects.active.volume.surfacePull.lastWarp);
  await page.evaluate(()=>window.feedContinuous(-.14,false));
  assert.equal(await page.evaluate(()=>window.clayPlayDebug.getState().grabbed),false);
  assert.deepEqual(await page.evaluate(()=>window.clayPlayDebug.objects.active.volume.pullPreview.uniforms.pullDelta.value.toArray()),held.delta);
  const frozen=await page.locator('#three-scene canvas').screenshot();
  await page.waitForFunction(()=>!window.clayPlayDebug.getState().pulling,{},{timeout:15000});
  const committed=await stats();assert.notDeepEqual(committed,original);
  assert.deepEqual(await page.evaluate(()=>window.clayPlayDebug.objects.active.volume.pullWarp),held);
  assert.equal(await page.evaluate(()=>window.clayPlayDebug.objects.active.volume.pullPreview.uniforms.pullEnabled.value),0);
  const finalImage=await page.locator('#three-scene canvas').screenshot();
  require('node:fs').mkdirSync('artifacts',{recursive:true});
  require('node:fs').writeFileSync('artifacts/continuous-pinch-live.png',frozen);
  require('node:fs').writeFileSync('artifacts/continuous-pinch-committed.png',finalImage);
  const pixels=await page.evaluate(async({a,b})=>{
    const load=async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
    const first=await load(a),last=await load(b);let sum=0,changed=0,count=0;
    // Compare the mask region, excluding changing toolbar text and hand cues.
    const width=1600,height=1100;
    for(let y=height*.24|0;y<height*.8;y++)for(let x=width*.35|0;x<width*.65;x++){
      const i=(y*width+x)*4,d=Math.abs(first[i]-last[i])+Math.abs(first[i+1]-last[i+1])+Math.abs(first[i+2]-last[i+2]);sum+=d;count++;if(d>15)changed++;
    }return{mean:sum/(count*3),changed};
  },{a:frozen.toString('base64'),b:finalImage.toString('base64')});
  console.log('Preview/commit pixels:',pixels);assert.ok(pixels.mean<.05,'GPU preview and committed surface agree without a visible shape pop');
  await page.locator('#sculpt-undo').click();assert.deepEqual(await stats(),original);
  await page.locator('#sculpt-redo').click();assert.deepEqual(await stats(),committed);
  assert.deepEqual(shaderErrors,[]);
  console.log('Continuous pinch: immediate grab; display-rate deformation without worker previews; 230 ms camera delay; relaxed outer fingers; release freezes input; matching GPU/CPU geometry and normals; exact Undo/Redo passed.');
};

// Optional browser regression: run against the Vite dev server with Playwright
// installed, or provide its module path through PLAYWRIGHT_MODULE_PATH.
if (require.main === module) {
  (async () => {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
    const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge'});
    try {
      const page = await browser.newPage({viewport:{width:1600,height:1100}}), errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      await module.exports(page); assert.deepEqual(errors,[]);
    } finally { await browser.close(); }
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
