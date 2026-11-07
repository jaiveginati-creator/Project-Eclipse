const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

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

async function joinClient(ws, name) {
  const welcome = waitForMessage(ws, message => message.type === 'welcome');
  ws.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'industrial', name }));
  return welcome;
}

async function waitForHealth(port, child, getOutput) {
  const deadline = Date.now() + 8000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Server exited early. ' + getOutput());
    }
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health');
      if (response.ok) return response.json();
      lastError = new Error('Health endpoint returned HTTP ' + response.status);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not become healthy: ' + (lastError?.message || 'unknown') + '\n' + getOutput());
}

test('four clients join, start a match, regenerate health and clean up disconnects', { timeout: 20000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ECLIPSE_DEV_MODE: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const clients = [];

  try {
    const initialHealth = await waitForHealth(port, child, () => output);
    assert.equal(initialHealth.ok, true);
    assert.equal(initialHealth.players, 0);
    assert.equal(initialHealth.version, require('../package.json').version);

    const a = await connectClient(port); clients.push(a);
    const welcomeA = await joinClient(a, 'TEST-A');
    assert.equal(welcomeA.players.length, 1);

    const b = await connectClient(port); clients.push(b);
    const welcomeB = await joinClient(b, 'TEST-B');
    assert.equal(welcomeB.players.length, 2);

    const c = await connectClient(port); clients.push(c);
    const welcomeC = await joinClient(c, 'TEST-C');
    assert.equal(welcomeC.players.length, 3);

    const aSeesFour = waitForMessage(a, message =>
      message.type === 'players' && message.players?.length === 4
    );
    const d = await connectClient(port); clients.push(d);
    const welcomeD = await joinClient(d, 'TEST-D');
    assert.equal(welcomeD.players.length, 4);
    await aSeesFour;

    const startMessages = clients.map(ws =>
      waitForMessage(ws, message => message.type === 'matchStart')
    );
    a.send(JSON.stringify({ type: 'startMatch' }));
    const started = await Promise.all(startMessages);
    assert.ok(started.every(message => message.players.length === 4));

    const activeHealth = await (await fetch('http://127.0.0.1:' + port + '/health')).json();
    assert.equal(activeHealth.players, 4);
    assert.equal(activeHealth.rooms, 1);

    const damagedWait = waitForMessage(b, message => message.type === 'damaged');
    a.send(JSON.stringify({
      type: 'shot', weapon: 'pulse',
      dx: 1, dy: 0, dz: 0,
      ox: -5, oy: 1.7, oz: 0
    }));
    const damaged = await damagedWait;
    assert.ok(damaged.health < 100, 'server should apply shot damage');

    const regenerated = await waitForMessage(a, message => {
      if (message.type !== 'state') return false;
      const target = message.players?.find(player => player.id === welcomeB.id);
      return target && target.health > damaged.health;
    }, 9000);
    const regeneratedTarget = regenerated.players.find(player => player.id === welcomeB.id);
    assert.ok(regeneratedTarget.health > damaged.health, 'server should regenerate health after the delay');

    const aSeesThree = waitForMessage(a, message =>
      message.type === 'players' && message.players?.length === 3
    );
    d.close();
    await aSeesThree;
    const afterDisconnect = await (await fetch('http://127.0.0.1:' + port + '/health')).json();
    assert.equal(afterDisconnect.players, 3);
    assert.equal(afterDisconnect.version, require('../package.json').version);
  } finally {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('exit', resolve);
        setTimeout(resolve, 2000).unref();
      });
    }
  }
});

test('Industrial hangars use the walk-in warehouse builder', () => {
  const source = fs.readFileSync(path.join(root, 'client/src/main.js'), 'utf8');
  const start = source.indexOf('function buildIndustrial(){');
  const end = source.indexOf('\nfunction buildSublevel(){', start);
  assert.ok(start >= 0 && end > start, 'Industrial map builder should exist');
  const builder = source.slice(start, end);
  assert.match(builder, /const hangars=\[\[-34,-31,22,25,13\],\[34,-31,22,25,14\],\[-34,31,22,25,12\],\[34,31,22,25,13\]\]/);
  assert.match(builder, /makeWarehouse\(x,z,w,d,h,face,/);
  assert.doesNotMatch(builder, /box\(x,h\/2,z,w,h,d/);
});