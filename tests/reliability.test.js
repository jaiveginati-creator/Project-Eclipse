'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const WebSocket = require('ws');
const path = require('node:path');
const { isPlayerPositionBlocked, movementBlocked } = require('../server/map-collision');

const root = path.resolve(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ECLIPSE_DEV_MODE: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Server exited early: ' + output);
    }
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health');
      if (response.ok) return { port, child };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error('Server did not become healthy: ' + output);
}

async function connectClient(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('WebSocket connection timed out'));
    }, 5000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return ws;
}

function waitForMessage(ws, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('Timed out waiting for ' + type));
    }, timeoutMs);
    function onMessage(raw) {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type !== type) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    }
    ws.on('message', onMessage);
  });
}

async function joinPrivate(ws, roomCode, name) {
  const welcome = waitForMessage(ws, 'welcome');
  ws.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'district', roomCode, name }));
  return welcome;
}

async function stopServer(server, clients) {
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.close();
  if (server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill('SIGTERM');
    await new Promise(resolve => {
      if (server.child.exitCode !== null || server.child.signalCode !== null) return resolve();
      server.child.once('exit', resolve);
      setTimeout(resolve, 2000).unref();
    });
  }
}

test('malformed encoded request paths return 400 without taking down the service', { timeout: 12000 }, async () => {
  const server = await startServer();
  try {
    const malformed = await fetch('http://127.0.0.1:' + server.port + '/%E0%A4%A');
    assert.equal(malformed.status, 400);
    const health = await (await fetch('http://127.0.0.1:' + server.port + '/health')).json();
    assert.equal(health.ok, true);
  } finally {
    await stopServer(server, []);
  }
});

test('private lobby codes isolate rooms and allow matching guests to join together', { timeout: 15000 }, async () => {
  const server = await startServer();
  const clients = [];
  try {
    const a = await connectClient(server.port); clients.push(a);
    const first = await joinPrivate(a, 'ALPHA1', 'PRIVATE-A');
    assert.equal(first.players.length, 1);

    const b = await connectClient(server.port); clients.push(b);
    const other = await joinPrivate(b, 'BRAVO2', 'PRIVATE-B');
    assert.equal(other.players.length, 1);

    const c = await connectClient(server.port); clients.push(c);
    const second = await joinPrivate(c, 'ALPHA1', 'PRIVATE-C');
    assert.equal(second.players.length, 2);
    assert.ok(second.players.some(player => player.id === first.id));
    assert.ok(!second.players.some(player => player.id === other.id));
  } finally {
    await stopServer(server, clients);
  }
});

test('movement recovers after a transient speed-check timing outlier', { timeout: 15000 }, async () => {
  const server = await startServer();
  const clients = [];
  try {
    const a = await connectClient(server.port); clients.push(a);
    const welcome = waitForMessage(a, 'welcome');
    a.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'district', name: 'MOVEMENT-TEST', profileId: '00000000-0000-4000-8000-000000000051' }));
    const joined = await welcome;
    const observer = await connectClient(server.port); clients.push(observer);
    const observerWelcome = waitForMessage(observer, 'welcome');
    observer.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'district', name: 'MOVEMENT-OBSERVER', profileId: '00000000-0000-4000-8000-000000000052' }));
    await observerWelcome;
    const started = waitForMessage(a, 'matchStart');
    const observerStarted = waitForMessage(observer, 'matchStart');
    a.send(JSON.stringify({ type: 'startMatch' }));
    const [match] = await Promise.all([started, observerStarted]);
    const self = match.players.find(player => player.id === joined.id);
    assert.ok(self);

    // Establish a movement timestamp, then send a deliberately-too-fast
    // packet. The following packet should be accepted after real time passes.
    a.send(JSON.stringify({ type: 'move', x: self.x, y: self.y, z: self.z, yaw: 0, pitch: 0, moving: false }));
    a.send(JSON.stringify({ type: 'move', x: self.x, y: self.y, z: self.z - 0.5, yaw: 0, pitch: 0, moving: true }));
    await new Promise(resolve => setTimeout(resolve, 70));
    const nextState = waitForMessage(a, 'state');
    a.send(JSON.stringify({ type: 'move', x: self.x, y: self.y, z: self.z - 0.5, yaw: 0, pitch: 0, moving: true }));
    const state = await nextState;
    const updated = state.players.find(player => player.id === joined.id);
    assert.ok(updated);
    assert.ok(updated.z < self.z - 0.4, 'server should accept the movement after the timing outlier');
  } finally {
    await stopServer(server, clients);
  }
});

test('operator abilities are server-authoritative and have a cooldown', { timeout: 15000 }, async () => {
  const server = await startServer();
  const clients = [];
  try {
    const a = await connectClient(server.port); clients.push(a);
    const b = await connectClient(server.port); clients.push(b);
    const welcomeA = waitForMessage(a, 'welcome');
    a.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'district', name: 'VANGUARD-TEST', profileId: '00000000-0000-4000-8000-000000000041', operator: 'vanguard' }));
    await welcomeA;
    const welcomeB = waitForMessage(b, 'welcome');
    b.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'district', name: 'OBSERVER-ABILITY', profileId: '00000000-0000-4000-8000-000000000042' }));
    await welcomeB;
    const startedA = waitForMessage(a, 'matchStart');
    const startedB = waitForMessage(b, 'matchStart');
    a.send(JSON.stringify({ type: 'startMatch' }));
    await Promise.all([startedA, startedB]);
    const activated = waitForMessage(a, 'operatorAbilityResult');
    a.send(JSON.stringify({ type: 'operatorAbility' }));
    const result = await activated;
    assert.equal(result.ok, true);
    assert.equal(result.ability, 'bulwark');
    assert.equal(result.cooldownMs, 30000);
    const blocked = waitForMessage(a, 'operatorAbilityResult');
    a.send(JSON.stringify({ type: 'operatorAbility' }));
    const denied = await blocked;
    assert.equal(denied.ok, false);
    assert.equal(denied.message, 'ABILITY RECHARGING');
  } finally {
    await stopServer(server, clients);
  }
});
test('explosive ammo builds are accepted and replicated for non-launcher weapons', { timeout: 15000 }, async () => {
  const server = await startServer();
  const clients = [];
  try {
    const a = await connectClient(server.port); clients.push(a);
    const b = await connectClient(server.port); clients.push(b);
    const welcomeA = waitForMessage(a, 'welcome');
    a.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'district', name: 'EXPLOSIVE-TEST', profileId: '00000000-0000-4000-8000-000000000031', primary: 'pulse', secondary: 'volt', builds: { volt: { ammoType: 'explosive' } } }));
    await welcomeA;
    const welcomeB = waitForMessage(b, 'welcome');
    b.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'district', name: 'OBSERVER-TEST', profileId: '00000000-0000-4000-8000-000000000032' }));
    await welcomeB;
    const started = waitForMessage(a, 'matchStart');
    const startedB = waitForMessage(b, 'matchStart');
    a.send(JSON.stringify({ type: 'startMatch' }));
    await Promise.all([started, startedB]);
    const replicatedShot = waitForMessage(b, 'shot');
    a.send(JSON.stringify({ type: 'shot', weapon: 'volt', dx: 1, dy: 0, dz: 0, ox: 0, oy: 1.6, oz: 0 }));
    const shot = await replicatedShot;
    assert.equal(shot.weapon, 'volt');
    assert.equal(shot.ammoType, 'explosive');
  } finally {
    await stopServer(server, clients);
  }
});


test('Starfall map collision keeps the station enclosed and its three route families open', () => {
  assert.equal(isPlayerPositionBlocked('starfall', 49, 1.7, 0), true, 'outer hull blocks leaving the station');
  assert.equal(isPlayerPositionBlocked('starfall', -31, 1.7, -29), true, 'west research pod blocks movement');
  assert.equal(isPlayerPositionBlocked('starfall', 0, 1.7, 0), true, 'central power core blocks the center');
  assert.equal(isPlayerPositionBlocked('starfall', 0, 1.7, 43), false, 'south deployment approach remains open');
  assert.equal(isPlayerPositionBlocked('starfall', 0, 1.7, -43), false, 'north observation approach remains open');
  assert.equal(movementBlocked('starfall', { x: 8, y: 1.7, z: 0 }, { x: 12, y: 1.7, z: 0 }), false, 'central cross-link remains traversable');
});
