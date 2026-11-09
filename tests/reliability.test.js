'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const WebSocket = require('ws');
const path = require('node:path');

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
