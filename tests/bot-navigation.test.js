'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseRecoveryWaypoint } = require('../server/bot-navigation');

test('recovery skips a waypoint whose initial path is blocked', () => {
  const route = [[0, 0], [8, 0], [0, 8]];
  const selected = chooseRecoveryWaypoint({
    map: 'district',
    bot: { id: 'bot-1', x: 0, y: 1.7, z: 0 },
    route,
    currentWaypoint: 0,
    nearbyPlayers: [],
    movementBlocked: (_map, _from, to) => to.x > 0.1
  });
  assert.equal(selected, 2);
});

test('recovery prefers a less crowded reachable waypoint', () => {
  const route = [[0, 0], [8, 0], [0, 8]];
  const selected = chooseRecoveryWaypoint({
    map: 'district',
    bot: { id: 'bot-1', x: 0, y: 1.7, z: 0 },
    route,
    currentWaypoint: 0,
    nearbyPlayers: [{ id: 'player-1', alive: true, x: 8, z: 0 }],
    movementBlocked: () => false
  });
  assert.equal(selected, 2);
});

test('recovery falls forward when every initial path is blocked', () => {
  const selected = chooseRecoveryWaypoint({
    map: 'sublevel',
    bot: { id: 'bot-1', x: 0, y: 1.7, z: 0 },
    route: [[0, 0], [5, 0], [0, 5]],
    currentWaypoint: 1,
    nearbyPlayers: [],
    movementBlocked: () => true
  });
  assert.equal(selected, 2);
});
