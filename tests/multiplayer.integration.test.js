const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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

function waitForMessage(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    const onMessage = raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the expected WebSocket message'));
    }, timeoutMs);
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function connectClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('WebSocket connection timed out'));
    }, 5000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return ws;
}

async function joinClient(ws, name) {
  const welcomeWait = waitForMessage(ws, message => message.type === 'welcome');
  ws.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'district', name }));
  return welcomeWait;
}

async function waitForHealth(port, child, getOutput) {
  const deadline = Date.now() + 8000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early. ${getOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
      lastError = new Error(`Health endpoint returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become healthy: ${lastError?.message || 'unknown error'}\n${getOutput()}`);
}

test('four clients join, start a match, and remove a disconnected player', { timeout: 20000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
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

    const aSeesTwo = waitForMessage(a, message => message.type === 'players' && message.players?.length === 2);
    const b = await connectClient(port); clients.push(b);
    const welcomeB = await joinClient(b, 'TEST-B');
    assert.equal(welcomeB.players.length, 2);
    await aSeesTwo;

    const aSeesThree = waitForMessage(a, message => message.type === 'players' && message.players?.length === 3);
    const bSeesThree = waitForMessage(b, message => message.type === 'players' && message.players?.length === 3);
    const c = await connectClient(port); clients.push(c);
    const welcomeC = await joinClient(c, 'TEST-C');
    assert.equal(welcomeC.players.length, 3);
    await Promise.all([aSeesThree, bSeesThree]);

    const aSeesFour = waitForMessage(a, message => message.type === 'players' && message.players?.length === 4);
    const bSeesFour = waitForMessage(b, message => message.type === 'players' && message.players?.length === 4);
    const cSeesFour = waitForMessage(c, message => message.type === 'players' && message.players?.length === 4);
    const d = await connectClient(port); clients.push(d);
    const welcomeD = await joinClient(d, 'TEST-D');
    assert.equal(welcomeD.players.length, 4);
    await Promise.all([aSeesFour, bSeesFour, cSeesFour]);

    const startMessages = clients.map(ws => waitForMessage(ws, message => message.type === 'matchStart'));
    a.send(JSON.stringify({ type: 'startMatch' }));
    const started = await Promise.all(startMessages);
    assert.ok(started.every(message => message.players.length === 4));

    const activeHealth = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(activeHealth.players, 4);
    assert.equal(activeHealth.rooms, 1);

    const aSeesThreeAfterDisconnect = waitForMessage(a, message =>
      message.type === 'players' && message.players?.length === 3
    );
    d.close();
    const remaining = await aSeesThreeAfterDisconnect;
    assert.equal(remaining.players.length, 3);

    const afterDisconnect = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(afterDisconnect.players, 3);
    assert.equal(afterDisconnect.version, require('../package.json').version);
  } finally {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        setTimeout(resolve, 2000).unref();
      });
    }
  }
});
