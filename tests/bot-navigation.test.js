'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseRecoveryWaypoint, findPath } = require('../server/bot-navigation');
const { isPlayerPositionBlocked, movementBlocked } = require('../server/map-collision');

const bot = { id: 'bot-1', x: 0, y: 1.7, z: 0 };
const route = [[0, 0], [8, 0], [0, 8], [-8, 0]];

test('recovery skips a waypoint whose initial path is blocked', () => {
  const selected = chooseRecoveryWaypoint({
    map: 'district', bot, route, currentWaypoint: 0, nearbyPlayers: [],
    movementBlocked: (_map, _from, to) => to.x > 0.1
  });
  assert.equal(selected, 2);
});

test('recovery prefers a less crowded reachable waypoint', () => {
  const selected = chooseRecoveryWaypoint({
    map: 'district', bot, route, currentWaypoint: 0,
    nearbyPlayers: [{ id: 'player-1', alive: true, x: 8, z: 0 }],
    movementBlocked: () => false
  });
  assert.equal(selected, 2);
});

test('recovery advances when every initial path is blocked', () => {
  const selected = chooseRecoveryWaypoint({
    map: 'sublevel', bot, route, currentWaypoint: 1, nearbyPlayers: [],
    movementBlocked: () => true
  });
  assert.equal(selected, 2);
});

test('invalid route data safely preserves the current waypoint', () => {
  assert.equal(chooseRecoveryWaypoint({
    map: 'district', bot, route: [], currentWaypoint: 3, nearbyPlayers: [],
    movementBlocked: () => false
  }), 3);
});


test('A* combat navigation routes around a blocking wall using clear steps', () => {
  const blocked = (x, z) => Math.abs(x) < 1.1 && Math.abs(z) < 5.1;
  const canMove = (from, to) => {
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(distance / .1));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (blocked(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) return false;
    }
    return true;
  };
  const path = findPath({
    map: 'district',
    start: { x: -8, z: 0 },
    goal: { x: 8, z: 0 },
    isBlocked: blocked,
    canMove
  });
  assert.ok(path.length >= 4, 'expected a route around the wall');
  assert.ok(path.some(point => Math.abs(point.z) > 5.1), 'route should go around a wall end');
  for (let i = 1; i < path.length; i++) assert.equal(canMove(path[i - 1], path[i]), true);
});

test('A* does not cut diagonally through blocked corners or closed walls', () => {
  const blocked = (x, z) => Math.abs(x) < 1.1;
  const path = findPath({
    map: 'district',
    start: { x: -8, z: 0 },
    goal: { x: 8, z: 0 },
    isBlocked: blocked
  });
  assert.deepEqual(path, []);
});

test('A* routes through a narrow opening instead of crossing its wall', () => {
  const blocked = (x, z) => Math.abs(x) < 1.1 && Math.abs(z) > 2.1;
  const canMove = (from, to) => {
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(distance / .1));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (blocked(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) return false;
    }
    return true;
  };
  const path = findPath({
    map: 'district',
    start: { x: -8, z: 6 },
    goal: { x: 8, z: 6 },
    isBlocked: blocked,
    canMove
  });
  assert.ok(path.length > 3);
  assert.ok(path.some(point => Math.abs(point.z) <= 2.1), 'route should pass through the doorway');
  for (let i = 1; i < path.length; i++) assert.equal(canMove(path[i - 1], path[i]), true);
});

test('A* can route a Bazaar bot around real server collision to the A-site compound', () => {
  const blocked = (x, z) => isPlayerPositionBlocked('bazaar', x, 1.7, z);
  const canMove = (from, to) => !movementBlocked(
    'bazaar',
    { x: from.x, y: 1.7, z: from.z },
    { x: to.x, y: 1.7, z: to.z }
  );
  const start = { x: 0, z: 5 };
  const goal = { x: 31, z: -31 };
  const gridOnlyPath = findPath({ map: 'bazaar', start, goal, isBlocked: blocked });
  const path = findPath({ map: 'bazaar', start, goal, isBlocked: blocked, canMove });
  console.log('Bazaar navigation diagnostics', {
    gridOnlyLength: gridOnlyPath.length,
    edgeValidatedLength: path.length,
    gridOnlyPath
  });
  assert.ok(gridOnlyPath.length > 2, 'map occupancy grid has no route from mid to A site');
  assert.ok(path.length > 2, 'swept collision checks reject every route from mid to A site');
  for (let i = 1; i < path.length; i++) assert.equal(canMove(path[i - 1], path[i]), true);
});
