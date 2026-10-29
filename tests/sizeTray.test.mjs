import test from 'node:test';
import assert from 'node:assert/strict';
import { HandUI } from '../src/handUI.js';
import { DockVisibility } from '../src/dockVisibility.js';

function fixture() {
  const ui=Object.create(HandUI.prototype), classes=new Map();
  const panel={offsetWidth:300,offsetHeight:100,attrs:{},contains:target=>target==='slider',setAttribute(key,value){this.attrs[key]=value;}};
  Object.assign(ui,{
    sizeVisibility:new DockVisibility({pinned:false,expanded:false}),sizeControl:panel,
    sizeTab:{attrs:{},setAttribute(key,value){this.attrs[key]=value;}},
    stage:{ownerDocument:{activeElement:null},getBoundingClientRect:()=>({left:0,right:1440,top:0,height:1000}),classList:{toggle:(key,value)=>classes.set(key,value)}},
    getState:()=>({busy:false}),
  });
  return {ui,panel,classes};
}

test('Size tray starts hidden and only the middle right edge reveals it',()=>{
  const {ui,panel,classes}=fixture();
  ui.updateSizeControl(0);assert.equal(panel.inert,true);assert.equal(classes.get('size-collapsed'),true);
  assert.equal(ui.nearSizeControl({x:1400,y:500}),true);
  for(const point of [{x:1100,y:500},{x:1400,y:100},{x:1450,y:500}])assert.equal(ui.nearSizeControl(point),false);
  ui.mouseNearSize=true;ui.updateSizeControl(20);assert.equal(panel.inert,false);
  assert.equal(ui.nearSizeControl({x:1130,y:500}),true,'expanded tray includes the full slider');
  assert.equal(ui.sizeTab.hidden,true);
});

test('Size tray stays open throughout pointer, grip and keyboard adjustments',()=>{
  const {ui,panel}=fixture();
  for(const mode of ['mouse','hand','keyboard']) {
    ui.mouseSizing=mode==='mouse';ui.sizeDrag=mode==='hand'?{target:{id:'tool-size'}}:null;
    ui.keyboardDock=mode==='keyboard';ui.stage.ownerDocument.activeElement=mode==='keyboard'?'slider':null;
    ui.updateSizeControl(5000);assert.equal(panel.inert,false,mode);
  }
  ui.keyboardDock=false;ui.updateSizeControl(6000);assert.equal(panel.inert,false);
  ui.updateSizeControl(6500);assert.equal(panel.inert,true);
  assert.equal(ui.sizeTab.hidden,false);
});

test('Closed or blocked hands cannot reveal the size tray; stale proximity expires',()=>{
  const {ui,panel}=fixture();ui.dockVisibility={};
  ui.nearDock=()=>false;ui.updateDock=(now,blocked)=>ui.updateSizeControl(now,blocked);
  ui.recordDockHand({x:1400,y:500},10,false);assert.equal(panel.inert,true);
  ui.recordDockHand({x:1400,y:500},20,true);assert.equal(panel.inert,false);
  ui.updateSizeControl(100);assert.equal(panel.inert,false);
  ui.updateSizeControl(1600);assert.equal(panel.inert,true);
  ui.getState=()=>({busy:true});ui.recordDockHand({x:1400,y:500},1700,true);assert.equal(panel.inert,true);
});
