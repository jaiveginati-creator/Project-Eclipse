'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
 const points = [[31,-19],[42,-31],[-40.5,25],[-32,39.5],[-6.5,-39],[18,-16]];
 for (const [x,z] of points) assert.equal(isPlayerPositionBlocked('bazaar',x,1.7,z),false,'doorway blocked at '+x+','+z);
 assert.equal(movementBlocked('bazaar',{x:31,y:1.7,z:-19},{x:31,y:1.7,z:-23}),false,'A connector does not reach the A courtyard');
});
