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

test('two clients join, start a match, and remove a disconnected player', { timeout: 20000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  let a;
  let b;
  try {
    const initialHealth = await waitForHealth(port, child, () => output);
    assert.equal(initialHealth.ok, true);
    assert.equal(initialHealth.players, 0);
    assert.equal(initialHealth.version, require('../package.json').version);

    a = await connectClient(port);
    const welcomeAWait = waitForMessage(a, message => message.type === 'welcome');
    a.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'district', name: 'TEST-A' }));
    const welcomeA = await welcomeAWait;
    assert.equal(welcomeA.players.length, 1);

    const twoPlayerUpdate = waitForMessage(a, message =>
      message.type === 'players' && message.players?.length === 2
    );
    b = await connectClient(port);
    const welcomeBWait = waitForMessage(b, message => message.type === 'welcome');
    b.send(JSON.stringify({ type: 'join', mode: 'ffa', map: 'district', name: 'TEST-B' }));
    const welcomeB = await welcomeBWait;
    assert.equal(welcomeB.players.length, 2);
    await twoPlayerUpdate;

    const matchStartA = waitForMessage(a, message => message.type === 'matchStart');
    const matchStartB = waitForMessage(b, message => message.type === 'matchStart');
    a.send(JSON.stringify({ type: 'startMatch' }));
    const [startedA, startedB] = await Promise.all([matchStartA, matchStartB]);
    assert.equal(startedA.players.length, 2);
    assert.equal(startedB.players.length, 2);

    const activeHealth = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(activeHealth.players, 2);
    assert.equal(activeHealth.rooms, 1);

    const onePlayerUpdate = waitForMessage(a, message =>
      message.type === 'players' && message.players?.length === 1
    );
    b.close();
    const remaining = await onePlayerUpdate;
    assert.equal(remaining.players.length, 1);

    const afterDisconnect = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(afterDisconnect.players, 1);
    assert.equal(afterDisconnect.version, require('../package.json').version);
  } finally {
    if (a && a.readyState === WebSocket.OPEN) a.close();
    if (b && b.readyState === WebSocket.OPEN) b.close();
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
