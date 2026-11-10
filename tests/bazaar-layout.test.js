'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isPlayerPositionBlocked, movementBlocked } = require('../server/map-collision');

test('Bazaar spawn locations are clear', () => {
 const spawns = [[-34,-39],[39,41],[31,-31],[-43,13],[-30,30],[0,5],[0,-5],[18,-8],[-19,15],[-42,25],[31,-45],[45,-18]];
 for (const [x,z] of spawns) assert.equal(isPlayerPositionBlocked('bazaar',x,1.7,z),false,'spawn blocked at '+x+','+z);
});

test('Bazaar keeps its covered routes traversable', () => {
 const points = [[-14.75,-39],[8,-40],[18,-28],[24.5,-18],[45,-20],[-19,15],[-34.5,15],[-42,25],[-32,39],[1,42],[-15,27],[31,9],[39.5,-1]];
 for (const [x,z] of points) assert.equal(isPlayerPositionBlocked('bazaar',x,1.7,z),false,'route blocked at '+x+','+z);
});

test('Bazaar corridor walls and building walls block movement', () => {
 const points = [[-34,-46.5],[25,-40.5],[42,-35],[-40.5,30],[14.5,-28],[-19,12],[-44.8,19]];
 for (const [x,z] of points) assert.equal(isPlayerPositionBlocked('bazaar',x,1.7,z),true,'wall failed to block at '+x+','+z);
});

test('Bazaar doorways remain open between connected areas', () => {
 const points = [[31,-19.5],[42,-31],[-40.5,25],[-32,39.5],[-6.5,-39],[18,-16.5]];
 for (const [x,z] of points) assert.equal(isPlayerPositionBlocked('bazaar',x,1.7,z),false,'doorway blocked at '+x+','+z);
 assert.equal(movementBlocked('bazaar',{x:31,y:1.7,z:-19.5},{x:31,y:1.7,z:-23}),false,'A connector does not reach the A courtyard');
});


test('Bazaar mid-to-A underpass is continuous through both doorway layers', () => {
 const route = [
  [{x:18,y:1.7,z:-14},{x:18,y:1.7,z:-18}],
  [{x:18,y:1.7,z:-18},{x:22,y:1.7,z:-18}],
  [{x:22,y:1.7,z:-18},{x:31,y:1.7,z:-18}],
  [{x:31,y:1.7,z:-18},{x:31,y:1.7,z:-23}],
  [{x:31,y:1.7,z:-23},{x:31,y:1.7,z:-31}]
 ];
 for (const [from,to] of route) {
  assert.equal(movementBlocked('bazaar',from,to),false,'route segment blocked: '+JSON.stringify(from)+' -> '+JSON.stringify(to));
 }
});

test('Bazaar visual passage and minimap match the server-side connector', () => {
 const source = fs.readFileSync(path.join(__dirname,'../client/src/main.js'),'utf8');
 assert.match(source,/tunnel\(18,-28,7,24,\{n:18,s:18,e:-18\}/);
 assert.match(source,/passage\(45,-32,45,-8,6\)/);
});
