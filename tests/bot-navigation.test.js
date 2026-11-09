'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseRecoveryWaypoint } = require('../server/bot-navigation');

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
