const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3001);
const TICK_MS = 50;
const MATCH_SECONDS = 480;
const MAP_BOUNDS = 49;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// One public HTTP(S) service hosts the built client and its WebSocket endpoint.
// Render (or another Node host) supplies PORT and terminates HTTPS in front of this process.
const httpServer = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'project-eclipse', players: clients.size }));
  }
  if (pathname.startsWith('/')) {
    const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
    const file = path.resolve(DIST_DIR, `.${requested}`);
    if (!file.startsWith(DIST_DIR + path.sep) && file !== path.join(DIST_DIR, 'index.html')) {
      res.writeHead(403); return res.end('Forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('Build not found. Run npm run build before production start.');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});
const wss = new WebSocket.Server({ server: httpServer, maxPayload: 16 * 1024 });
const clients = new Map();
const matches = new Map();

const VALID_MODES = new Set(['ffa', 'duos', 'trios']);
const roomKey = (mode, map) => `${mode}:${map}`;
const maxPlayers = mode => mode === 'trios' ? 12 : 8;
const teamSize = mode => mode === 'trios' ? 3 : mode === 'duos' ? 2 : 1;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function members(room) {
  return [...clients.values()].filter(c => c.room === room);
}
function broadcast(room, obj, except = null) {
  for (const c of members(room)) if (c.ws !== except) send(c.ws, obj);
}
function publicPlayers(room) {
  return members(room).map(c => ({
    id: c.id, name: c.name, mode: c.mode, map: c.map, team: c.team,
    x: c.x, z: c.z, yaw: c.yaw, pitch: c.pitch, score: c.score, alive: c.alive
  }));
}
function broadcastPlayers(room) {
  broadcast(room, { type: 'players', players: publicPlayers(room) });
}

// Fill the least-populated squad first, so small local test sessions are balanced.
function assignTeam(mode, room) {
  if (mode === 'ffa') return null;
  const size = teamSize(mode);
  const counts = new Map();
  for (const c of members(room)) {
    if (c.team !== null) counts.set(c.team, (counts.get(c.team) || 0) + 1);
  }
  const teamCount = Math.ceil(maxPlayers(mode) / size);
  let selected = 0;
  let smallest = Infinity;
  for (let team = 0; team < teamCount; team++) {
    const count = counts.get(team) || 0;
    if (count < size && count < smallest) {
      selected = team;
      smallest = count;
    }
  }
  return selected;
}

function endMatch(room) {
  const match = matches.get(room);
  if (!match || !match.active) return;
  match.active = false;
  const results = members(room)
    .map(c => ({ id: c.id, name: c.name, team: c.team, score: c.score }))
    .sort((a, b) => b.score - a.score);
  broadcast(room, { type: 'matchEnd', results });
}

function distancePointToRay(origin, direction, point) {
  const vx = point.x - origin.x;
  const vy = point.y - origin.y;
  const vz = point.z - origin.z;
  const along = vx * direction.x + vy * direction.y + vz * direction.z;
  if (along < 0) return { along, distance: Infinity };
  const px = origin.x + direction.x * along;
  const py = origin.y + direction.y * along;
  const pz = origin.z + direction.z * along;
  return { along, distance: Math.hypot(point.x - px, point.y - py, point.z - pz) };
}

function resolvePulseHit(shooter, shot) {
  const direction = { x: finite(shot.dx), y: finite(shot.dy), z: finite(shot.dz) };
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 0.9 || length > 1.1) return;
  direction.x /= length;
  direction.y /= length;
  direction.z /= length;

  const origin = {
    x: finite(shot.ox, shooter.x),
    y: finite(shot.oy, 1.7),
    z: finite(shot.oz, shooter.z)
  };
  if (Math.hypot(origin.x - shooter.x, origin.z - shooter.z) > 1.8 || origin.y < 0.8 || origin.y > 2.4) return;

  let best = null;
  for (const target of members(shooter.room)) {
    if (target.id === shooter.id || !target.alive) continue;
    if (shooter.mode !== 'ffa' && target.team === shooter.team) continue;
    const center = { x: target.x, y: 1.35, z: target.z };
    const hit = distancePointToRay(origin, direction, center);
    if (hit.along > 36 || hit.distance > 0.62) continue;
    if (!best || hit.along < best.along) best = { target, along: hit.along };
  }
  if (!best) return;

  const target = best.target;
  shooter.score += 1;
  send(shooter.ws, { type: 'tag', source: shooter.id, target: target.id, point: true, sourceName: shooter.name, targetName: target.name });
  send(target.ws, { type: 'tag', source: shooter.id, target: target.id, point: false, sourceName: shooter.name, targetName: target.name });
  broadcast(shooter.room, { type: 'scoreUpdate', players: publicPlayers(shooter.room) });
}

wss.on('connection', ws => {
  const c = {
    ws, id: crypto.randomUUID().slice(0, 8), name: 'OPERATOR',
    mode: 'ffa', map: 'district', room: null, team: null,
    x: 0, z: 7, yaw: 0, pitch: 0, score: 0, alive: true,
    lastMove: Date.now(), lastShot: Object.create(null)
  };

  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'join') {
      if (c.room) return send(ws, { type: 'error', message: 'You are already in a lobby' });
      const mode = VALID_MODES.has(message.mode) ? message.mode : 'ffa';
      const map = message.map === 'industrial' ? 'industrial' : 'district';
      const room = roomKey(mode, map);
      if (matches.get(room)?.active) return send(ws, { type: 'error', message: 'This match has already started' });
      if (members(room).length >= maxPlayers(mode)) return send(ws, { type: 'error', message: 'Lobby is full' });

      c.mode = mode;
      c.map = map;
      c.room = room;
      c.name = String(message.name || 'OPERATOR').replace(/[<>]/g, '').slice(0, 18) || 'OPERATOR';
      c.x = 0; c.z = 7; c.yaw = 0; c.pitch = 0; c.score = 0; c.alive = true;
      clients.set(c.id, c);
      c.team = assignTeam(mode, room);
      send(ws, { type: 'welcome', id: c.id, team: c.team, players: publicPlayers(room) });
      broadcastPlayers(room);
      return;
    }

    if (!c.room || !clients.has(c.id)) return;

    if (message.type === 'move') {
      const now = Date.now();
      const elapsed = Math.max(0.001, Math.min((now - c.lastMove) / 1000, 0.25));
      const nextX = clamp(finite(message.x, c.x), -MAP_BOUNDS, MAP_BOUNDS);
      const nextZ = clamp(finite(message.z, c.z), -MAP_BOUNDS, MAP_BOUNDS);
      const distance = Math.hypot(nextX - c.x, nextZ - c.z);
      if (distance <= 10.5 * elapsed + 0.35) { c.x = nextX; c.z = nextZ; }
      c.yaw = finite(message.yaw, c.yaw);
      c.pitch = clamp(finite(message.pitch, c.pitch), -1.4, 1.4);
      c.lastMove = now;
      return;
    }

    if (message.type === 'shot') {
      if (!matches.get(c.room)?.active) return;
      const now = Date.now();
      const weapon = ['pulse','volt','arc'].includes(message.weapon) ? message.weapon : 'pulse';
      const cooldown = weapon === 'volt' ? 85 : weapon === 'arc' ? 390 : 220;
      if (now - (c.lastShot[weapon] || 0) < cooldown) return;
      c.lastShot[weapon] = now;
      const shot = {
        weapon,
        dx: finite(message.dx), dy: finite(message.dy), dz: finite(message.dz),
        ox: finite(message.ox, c.x), oy: finite(message.oy, 1.7), oz: finite(message.oz, c.z)
      };
      broadcast(c.room, { type: 'shot', id: c.id, x: c.x, z: c.z, ...shot }, ws);
      resolvePulseHit(c, shot);
      return;
    }

    // The server resolves tags from shot direction. Ignore client-supplied target IDs.
    if (message.type === 'tag') return;

    if (message.type === 'respawn') {
      if (!matches.get(c.room)?.active) return;
      c.alive = true;
      c.x = clamp((Math.random() - 0.5) * 24, -MAP_BOUNDS, MAP_BOUNDS);
      c.z = clamp((Math.random() - 0.5) * 24, -MAP_BOUNDS, MAP_BOUNDS);
      broadcastPlayers(c.room);
      return;
    }

    if (message.type === 'startMatch') {
      if (matches.get(c.room)?.active) return;
      const roomPlayers = members(c.room);
      if (roomPlayers.length < 2) return send(ws, { type: 'error', message: 'At least 2 players are required to start' });
      if (c.mode !== 'ffa' && new Set(roomPlayers.map(p => p.team)).size < 2) {
        return send(ws, { type: 'error', message: 'At least two squads are required' });
      }
      for (const player of roomPlayers) { player.score = 0; player.alive = true; }
      matches.set(c.room, { active: true, startedAt: Date.now(), duration: MATCH_SECONDS });
      broadcast(c.room, { type: 'matchStart', duration: MATCH_SECONDS });
      broadcast(c.room, { type: 'state', players: publicPlayers(c.room) });
      return;
    }
  });

  ws.on('close', () => {
    if (!c.room) return;
    const room = c.room;
    clients.delete(c.id);
    if (members(room).length === 0) matches.delete(room);
    broadcastPlayers(room);
  });
});

setInterval(() => {
  for (const [room, match] of matches) {
    if (match.active && Date.now() - match.startedAt >= match.duration * 1000) endMatch(room);
    if (members(room).length) broadcast(room, { type: 'state', players: publicPlayers(room) });
  }
}, TICK_MS);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`PROJECT: ECLIPSE online service listening on port ${PORT}`);
});

// Drop dead sockets so public rooms do not retain disconnected operators.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});
wss.on('close', () => clearInterval(heartbeat));
