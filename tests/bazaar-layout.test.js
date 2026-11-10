'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isPlayerPositionBlocked, movementBlocked } = require('../server/map-collision');

test('Bazaar open streets and plaza spawn points remain clear', () => {
 const points = [[0,20],[0,-20],[20,20],[-20,-20],[20,-20],[-20,20],[0,32],[0,-32],[32,0],[-32,0]];
 for (const [x,z] of points) assert.equal(isPlayerPositionBlocked('bazaar',x,1.7,z),false,'open street blocked at '+x+','+z);
});

test('Bazaar perimeter building walls block movement', () => {
 const points = [[-39,-47],[-47.5,-37],[-17,-48],[12,-48],[39,-47],[-40,46],[-49,37],[40,46],[48,37]];
 for (const [x,z] of points) assert.equal(isPlayerPositionBlocked('bazaar',x,1.7,z),true,'building or perimeter wall failed to block at '+x+','+z);
});

test('Bazaar shop entrances remain open', () => {
 const points = [[-39,-26.5],[-17,-29.5],[12,-29.5],[39,-26.5],[-40,27.5],[-15,30.5],[14,30.5],[40,27.5]];
 for (const [x,z] of points) assert.equal(isPlayerPositionBlocked('bazaar',x,1.7,z),false,'shop entrance blocked at '+x+','+z);
});

test('Bazaar market dressing remains solid while streets stay connected', () => {
 assert.equal(isPlayerPositionBlocked('bazaar',0,1.7,0),true,'central fountain should block its footprint');
 assert.equal(movementBlocked('bazaar',{x:0,y:1.7,z:20},{x:0,y:1.7,z:24}),false,'north-south street should remain traversable');
});
