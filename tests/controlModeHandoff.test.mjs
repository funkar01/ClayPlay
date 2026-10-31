import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the actual frame and pointer handlers without booting the camera,
// renderer, or network-dependent tracking model.
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const start=source.indexOf('function processHandResult(');
const frame=source.slice(start,source.indexOf('\n}\n',start)+3);
const pointerStart=source.indexOf("sceneHost.addEventListener('pointermove',");
const pointer=source.slice(pointerStart,source.indexOf('\n});',pointerStart)+4);

for(const initialMode of ['palm','index'])test(`${initialMode} selection hands ownership to the mouse before the selecting frame resumes`,()=>{
  const moves=[],context=vm.createContext({
    controlMode:initialMode,stream:{},tryOn:{enabled:false},clayVolume:{},
    trackingTrace:{record(){}},previousPullPoint:null,cutStroke:null,palmMove:{active:false},twoHandScale:{active:false},pinchActive:false,moveIntent:false,
    palmCenter:()=>({}),video:{videoWidth:640,videoHeight:480},comfortSetup:{active:false},closedFist:()=>false,
    resizeAutoPaused:false,editingPaused:false,diagnostics:{},handUICaptured:true,
    handModel:{visible:false},brushCue:{visible:false},mirroredBrush:{visible:false},
    usableHandSample:()=>true,mousePointerId:null,mousePinching:false,mouseSculptPoint:null,
    sceneHost:{addEventListener(type,handler){context.pointerMove=handler;}},
    cancelMouseStroke(){context.handUICaptured=true;},setResizeMode(){},
  });
  context.handUI={isOpen:false,receive(){
    // setControlMode resets ownership during the synchronous selection click.
    context.controlMode='mouse';context.handUICaptured=false;
    return {owns:true,index:0,needsOpen:false,changed:false};
  }};
  context.cursorInputEnabled=()=>context.controlMode==='mouse';
  context.updateMouseTarget=()=>{context.mouseSculptPoint={x:0,y:0,z:0};};
  context.processSculptPoint=(point,held)=>{
    if(!context.handUICaptured)moves.push({point,held});
  };
  vm.runInContext(frame+'\n'+pointer,context);
  vm.runInContext('processHandResult({landmarks:[[]]},100)',context);
  assert.equal(context.handUICaptured,false,'the selecting frame must not restore hand ownership');
  context.pointerMove({pointerId:1});
  context.mousePinching=true;context.pointerMove({pointerId:1});
  assert.deepEqual(moves.map(move=>move.held),[false,true],'mouse hover and held deformation both reach the tool');
  vm.runInContext('processHandResult({landmarks:[[]]},110)',context);
  assert.equal(context.handUICaptured,false,'late tracking results cannot reclaim mouse input');
});
