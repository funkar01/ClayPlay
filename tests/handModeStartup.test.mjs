import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const start=source.indexOf('function setControlMode(');
const code=source.slice(start,source.indexOf('\n}\n',start)+3);
for(const mode of ['palm','index'])for(const camera of ['off','on','tracking-ready'])test(`Mouse to ${mode} starts the needed setup with camera ${camera}`,()=>{
  const calls=[],reset={reset(){}};
  const context=vm.createContext({controlMode:'mouse',stream:camera==='off'?null:{},landmarker:camera==='tracking-ready'?{}:null,
    tryOn:{enabled:false},cancelMouseStroke(){},setResizeMode(){},finishMoveStroke(){},palmControl:reset,handMotion:reset,
    handModel:{visible:false},clearPreview(){},handUI:{reset(){}},
    startCamera:()=>calls.push('camera'),startTracking:()=>calls.push('tracking'),scheduleHandTracking:()=>calls.push('resume'),
    localStorage:{setItem(){}},showToolInstructions(){},
  });
  vm.runInContext(code,context);context.setControlMode(mode);
  assert.equal(context.controlMode,mode);
  assert.deepEqual(calls,[camera==='off'?'camera':camera==='on'?'tracking':'resume']);
});
