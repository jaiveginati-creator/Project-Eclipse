const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const WebSocket = require('ws');
const {
  isPlayerPositionBlocked,
  movementBlocked,
  hasLineOfSight
} = require('../server/map-collision');

const root = require('node:path').resolve(__dirname, '..');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function waitForMessage(ws, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
      ws.off('close', onClose);
    };
    const onMessage = raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = error => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('Socket closed before expected message')); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for expected WebSocket message'));
    }, timeoutMs);
    ws.on('message', onMessage);
    ws.on('error', onError);
    ws.on('close', onClose);
  });
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

async function joinClient(ws, name, map = 'district', primary = 'pulse', botCount = 0) {
  const welcome = waitForMessage(ws, message => message.type === 'welcome');
  ws.send(JSON.stringify({ type: 'join', mode: 'ffa', map, primary, botCount, name }));
  return welcome;
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
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Server exited early: ' + output);
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health');
      if (response.ok) return { port, child, output: () => output };
      lastError = new Error('Health endpoint returned HTTP ' + response.status);
    } catch (error) { lastError = error; }
    await delay(100);
  }
  child.kill('SIGTERM');
  throw new Error('Server did not become healthy: ' + (lastError?.message || 'unknown') + '\n' + output);
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

test('map collision blocks wall traversal and wall shots while preserving intended openings', () => {
  assert.equal(isPlayerPositionBlocked('sublevel', -10, 1.7, -9.5), true);
  assert.equal(movementBlocked('sublevel',
    { x: -10, y: 1.7, z: -11 },
    { x: -10, y: 1.7, z: -8 }), true);
  assert.equal(hasLineOfSight('sublevel',
    { x: -10, y: 1.7, z: -11 },
    { x: -10, y: 1.7, z: -8 }), false);
  assert.equal(hasLineOfSight('sublevel',
    { x: -16, y: 1.7, z: -11 },
    { x: -16, y: 1.7, z: -8 }), true);
  assert.equal(isPlayerPositionBlocked('district', -5, 1.7, 0), false);
});

test('Industrial hangars have open loading bays and solid side walls', () => {
  assert.equal(isPlayerPositionBlocked('industrial', 0, 1.7, -2), true, 'reactor should block its footprint');
  assert.equal(isPlayerPositionBlocked('industrial', -34, 1.7, -18.5), false, 'center loading bay should remain open');
  assert.equal(isPlayerPositionBlocked('industrial', -34, 1.7, -23), false, 'interior service lane should remain traversable');
  assert.equal(hasLineOfSight('industrial',
    { x: -34, y: 1.7, z: -17 },
    { x: -34, y: 1.7, z: -23 }), true, 'shot through loading bay should be clear');
  assert.equal(hasLineOfSight('industrial',
    { x: -46, y: 1.7, z: -23 },
    { x: -34, y: 1.7, z: -23 }), false, 'side wall should block shots');
});

test('four clients join, start a match, deal damage, regenerate health and clean up disconnects', { timeout: 20000 }, async () => {
  const server = await startServer();
  const clients = [];
  try {
    const initialHealth = await (await fetch('http://127.0.0.1:' + server.port + '/health')).json();
    assert.equal(initialHealth.ok, true);
    assert.equal(initialHealth.players, 0);
    assert.equal(initialHealth.version, require('../package.json').version);

    const a = await connectClient(server.port); clients.push(a);
    const welcomeA = await joinClient(a, 'TEST-A');
    assert.equal(welcomeA.players.length, 1);

    const b = await connectClient(server.port); clients.push(b);
    const welcomeB = await joinClient(b, 'TEST-B');
    assert.equal(welcomeB.players.length, 2);

    const c = await connectClient(server.port); clients.push(c);
    const welcomeC = await joinClient(c, 'TEST-C');
    assert.equal(welcomeC.players.length, 3);

    const aSeesFour = waitForMessage(a, message => message.type === 'players' && message.players?.length === 4);
    const d = await connectClient(server.port); clients.push(d);
    const welcomeD = await joinClient(d, 'TEST-D');
    assert.equal(welcomeD.players.length, 4);
    await aSeesFour;

    const startMessages = clients.map(ws => waitForMessage(ws, message => message.type === 'matchStart'));
    a.send(JSON.stringify({ type: 'startMatch' }));
    const started = await Promise.all(startMessages);
    assert.ok(started.every(message => message.players.length === 4));

    const damagedWait = waitForMessage(b, message => message.type === 'damaged');
    a.send(JSON.stringify({
      type: 'shot', weapon: 'pulse',
      dx: 1, dy: 0, dz: 0,
      ox: -5, oy: 1.7, oz: 0
    }));
    const damaged = await damagedWait;
    assert.ok(damaged.health < 100, 'clear line of sight should allow server damage');

    const regenerated = await waitForMessage(a, message => {
      if (message.type !== 'state') return false;
      const target = message.players?.find(player => player.id === welcomeB.id);
      return target && target.health > damaged.health;
    }, 9000);
    const regeneratedTarget = regenerated.players.find(player => player.id === welcomeB.id);
    assert.ok(regeneratedTarget.health > damaged.health, 'server should regenerate health after the delay');

    const aSeesThree = waitForMessage(a, message => message.type === 'players' && message.players?.length === 3);
    d.close();
    await aSeesThree;
    const afterDisconnect = await (await fetch('http://127.0.0.1:' + server.port + '/health')).json();
    assert.equal(afterDisconnect.players, 3);
    assert.equal(afterDisconnect.version, require('../package.json').version);
  } finally {
    await stopServer(server, clients);
  }
});

test('server does not damage a Sublevel target through the segmented cross-wall', { timeout: 12000 }, async () => {
  const server = await startServer();
  const clients = [];
  try {
    const a = await connectClient(server.port); clients.push(a);
    const welcomeA = await joinClient(a, 'WALL-SHOOTER', 'sublevel', 'sniper');
    const b = await connectClient(server.port); clients.push(b);
    await joinClient(b, 'WALL-SECOND', 'sublevel', 'pulse');
    const c = await connectClient(server.port); clients.push(c);
    await joinClient(c, 'WALL-THIRD', 'sublevel', 'pulse');
    const d = await connectClient(server.port); clients.push(d);
    const welcomeD = await joinClient(d, 'WALL-TARGET', 'sublevel', 'pulse');
    assert.equal(welcomeA.players.length, 1);
    assert.equal(welcomeD.players.length, 4);

    const starts = clients.map(ws => waitForMessage(ws, message => message.type === 'matchStart'));
    a.send(JSON.stringify({ type: 'startMatch' }));
    await Promise.all(starts);

    let damageCount = 0;
    const onDamage = raw => {
      try { if (JSON.parse(raw.toString()).type === 'damaged') damageCount++; } catch {}
    };
    d.on('message', onDamage);
    a.send(JSON.stringify({
      type: 'shot', weapon: 'sniper',
      dx: Math.SQRT1_2, dy: 0, dz: Math.SQRT1_2,
      ox: -17, oy: 1.7, oz: -17
    }));
    await delay(700);
    d.off('message', onDamage);
    assert.equal(damageCount, 0, 'wall must stop server-authoritative damage');
  } finally {
    await stopServer(server, clients);
  }
});

test('Industrial map builder uses the walk-in warehouse function for all four hangars', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require('node:path').join(root, 'client/src/main.js'), 'utf8');
  const start = source.indexOf('function buildIndustrial(){');
  const end = source.indexOf('\nfunction buildSublevel(){', start);
  assert.ok(start >= 0 && end > start, 'Industrial map builder should exist');
  const builder = source.slice(start, end);
  assert.match(builder, /makeWarehouse\(x,z,w,d,h,face,/);
  assert.doesNotMatch(builder, /box\(x,h\/2,z,w,h,d/);
});


test('combat bot can damage a human and can be eliminated by a human player', { timeout: 18000 }, async () => {
  const server = await startServer();
  const clients = [];
  try {
    const human = await connectClient(server.port); clients.push(human);
    const welcome = await joinClient(human, 'BOT-TEST', 'district', 'sniper', 1);
    const bot = welcome.players.find(player => player.isBot);
    assert.ok(bot, 'one lobby bot should be created');
    assert.ok(bot.primary && bot.secondary, 'bot should receive a usable primary and secondary weapon');
    assert.equal(bot.alive, true);
    assert.equal(bot.moving, false, 'bots should wait in the lobby instead of running in place');

    const started = waitForMessage(human, message => message.type === 'matchStart');
    human.send(JSON.stringify({ type: 'startMatch' }));
    await started;

    const botDamage = await waitForMessage(human, message => message.type === 'damaged' && message.sourceId === bot.id, 9000);
    assert.ok(botDamage.health < 100, 'combat bot should deal server-authoritative damage');

    let latest = null;
    const onState = raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'state' || message.type === 'players' || message.type === 'scoreUpdate') {
          const current = message.players?.find(player => player.id === bot.id);
          if (current) latest = current;
        }
      } catch {}
    };
    human.on('message', onState);
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline && !latest) await delay(60);
    assert.ok(latest, 'bot state should be replicated');
    const origin = { x: welcome.self.x, y: welcome.self.y, z: welcome.self.z };
    const target = latest;
    const aim = { x: target.x-origin.x, y: target.y-.7-origin.y, z: target.z-origin.z };
    const length = Math.hypot(aim.x,aim.y,aim.z);
    const eliminated = waitForMessage(human, message => message.type === 'elimination' && message.source === welcome.id && message.target === bot.id, 4000);
    human.send(JSON.stringify({
      type: 'shot', weapon: 'sniper',
      dx: aim.x/length, dy: aim.y/length, dz: aim.z/length,
      ox: origin.x, oy: origin.y, oz: origin.z
    }));
    const result = await eliminated;
    human.off('message', onState);
    assert.ok(result.players.some(player => player.id === bot.id && player.alive === false), 'bot should enter its elimination state');
  } finally {
    await stopServer(server, clients);
  }
});
