import test from 'node:test';
import assert from 'node:assert/strict';
import { hsvToHex, hexToHsv } from '../src/paintPicker.js';
import { CLAY_COLORS } from '../src/clayAppearance.js';

test('HSV mixing reaches primary colors, black, white and wraps hue',()=>{
  assert.equal(hsvToHex(0,100,100),'#ff0000');
  assert.equal(hsvToHex(120,100,100),'#00ff00');
  assert.equal(hsvToHex(240,100,100),'#0000ff');
  assert.equal(hsvToHex(360,100,100),'#ff0000');
  assert.equal(hsvToHex(60,0,100),'#ffffff');
  assert.equal(hsvToHex(60,100,0),'#000000');
  assert.equal(hsvToHex(60,100,50),'#808000');
});

test('Basic palette colors convert without changing their pigment; grays retain hue for mixing',()=>{
  for(const [,hex]of CLAY_COLORS)assert.equal(hsvToHex(...hexToHsv(hex)),hex);
  assert.equal(hexToHsv('#808080',210)[0],210);
  assert.equal(hexToHsv('#000000',75)[0],75);
});
