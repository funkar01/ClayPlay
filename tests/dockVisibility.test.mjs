import test from 'node:test';
import assert from 'node:assert/strict';
import {DockVisibility} from '../src/dockVisibility.js';
test('Pinned tools remain visible; unpinned tools collapse and reveal near the left edge',()=>{
 const dock=new DockVisibility();assert.equal(dock.update({now:5000}),true);dock.pinned=false;
 assert.equal(dock.update({now:6500}),false);assert.equal(dock.update({now:6600,near:true}),true);
 assert.equal(dock.update({now:7000}),true);assert.equal(dock.update({now:8100}),false);
});
test('Open menus, keyboard focus and dwell hold the dock open',()=>{
 const dock=new DockVisibility({pinned:false});assert.equal(dock.update({now:2000,hold:true}),true);
 assert.equal(dock.update({now:3000}),true);assert.equal(dock.update({now:4000}),false);
});
test('A sculpting grip cannot reveal a collapsed dock or move a visible dock',()=>{
 const dock=new DockVisibility({pinned:false});dock.update({now:2000});
 assert.equal(dock.update({now:2100,near:true,blocked:true}),false);
 dock.reveal(2200);assert.equal(dock.update({now:5000,blocked:true}),true);
});
