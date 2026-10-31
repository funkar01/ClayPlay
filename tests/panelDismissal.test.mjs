import test from 'node:test';
import assert from 'node:assert/strict';
import { HandUI } from '../src/handUI.js';
import { DockVisibility } from '../src/dockVisibility.js';

function fixture() {
  const ui=Object.create(HandUI.prototype);let focused=0,paused=0,cancelled=0;
  Object.assign(ui,{
    panel:{hidden:false,contains:target=>target==='panel-input',getBoundingClientRect:()=>({left:130,right:510,top:100,bottom:700})},
    more:{setAttribute(){},focus(){focused++;},getBoundingClientRect:()=>({left:20,right:100,top:400,bottom:460})},
    stage:{ownerDocument:{activeElement:null}},selection:{cancel(){cancelled++;}},onPause(){paused++;},
    panelVisibility:new DockVisibility({pinned:false,delay:1500}),
  });
  return {ui,counts:()=>({focused,paused,cancelled})};
}

test('A side panel closes after 1.5 seconds away without stealing focus',()=>{
  const {ui,counts}=fixture();
  ui.recordPanelPointer({x:300,y:300},0,'mouse');ui.updatePanelVisibility(5000);assert.equal(ui.isOpen,true);
  ui.recordPanelPointer({x:900,y:300},5001,'mouse');ui.updatePanelVisibility(6499);assert.equal(ui.isOpen,true);
  ui.updatePanelVisibility(6500);assert.equal(ui.isOpen,false);
  assert.deepEqual(counts(),{focused:0,paused:1,cancelled:1});
});

test('Returning to the panel or its settings button resets the close delay',()=>{
  const {ui}=fixture();
  ui.recordPanelPointer({x:900,y:300},0,'mouse');ui.updatePanelVisibility(1400);assert.equal(ui.isOpen,true);
  ui.recordPanelPointer({x:300,y:300},1450,'mouse');ui.updatePanelVisibility(1450);
  ui.recordPanelPointer({x:900,y:300},1500,'mouse');ui.updatePanelVisibility(2900);assert.equal(ui.isOpen,true);
  ui.recordPanelPointer({x:60,y:430},2940,'mouse');ui.updatePanelVisibility(2940);
  ui.updatePanelVisibility(6000);assert.equal(ui.isOpen,true,'waiting on Settings must not repeatedly close and reopen it');
});

test('Fresh hand positions retain the panel; lost tracking cannot keep it open forever',()=>{
  const {ui}=fixture();ui.recordPanelPointer({x:300,y:300},0);
  ui.updatePanelVisibility(400);assert.equal(ui.isOpen,true);
  ui.updatePanelVisibility(1000);assert.equal(ui.isOpen,true);
  ui.updatePanelVisibility(1900);assert.equal(ui.isOpen,false);
});

test('Dragging, keyboard focus and touch interaction keep a panel open',()=>{
  for(const mode of ['pointer','hand-slider','keyboard','touch']) {
    const {ui}=fixture();ui.recordPanelPointer({x:900,y:300},0,'mouse');
    ui.panelPointerHeld=mode==='pointer';ui.sizeDrag=mode==='hand-slider'?{target:'panel-input'}:null;
    ui.keyboardDock=mode==='keyboard';ui.stage.ownerDocument.activeElement=mode==='keyboard'?'panel-input':null;
    ui.panelTouchActive=mode==='touch';ui.updatePanelVisibility(5000);assert.equal(ui.isOpen,true,mode);
    ui.panelPointerHeld=false;ui.sizeDrag=null;ui.keyboardDock=false;ui.panelTouchActive=false;
    ui.updatePanelVisibility(6499);assert.equal(ui.isOpen,true);ui.updatePanelVisibility(6500);assert.equal(ui.isOpen,false);
  }
});
