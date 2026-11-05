const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3001);
const TICK_MS = 50;
const MATCH_SECONDS = 480;
const MAP_BOUNDS = 49;
const MAX_HEALTH = 100;
const RESPAWN_DELAY_MS = 2800;
const WEAPONS = {
  pulse: { cooldown: 220, damage: 34, range: 42 },
  volt: { cooldown: 90, damage: 18, range: 34 },
  arc: { cooldown: 420, damage: 58, range: 55 }
};
const DIST_DIR = path.join(__dirname, '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// One public HTTP(S) service hosts the built client and its WebSocket endpoint.
// Render (or another Node host) supplies PORT and terminates HTTPS in front of this process.
const httpServer = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'project-eclipse', version: '0.6.0', players: clients.size, rooms: matches.size, uptimeSeconds: Math.floor(process.uptime()) }));
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
wss.on('error', err => console.error('[websocket] server error:', err.message));

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
    x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, score: c.score,
    health: c.health, alive: c.alive, moving: c.moving, crouching: c.crouching, weapon: c.weapon
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

function distanceRayToVerticalCapsule(origin, direction, target) {
  // The remote operator is represented by a vertical capsule. The server owns
  // this hit test; clients never nominate a target ID.
  const feetY = target.y - (target.crouching ? 1.15 : 1.7);
  const lowY = feetY + (target.crouching ? 0.3 : 0.42);
  const highY = feetY + (target.crouching ? 1.35 : 1.55);
  const horizontalLengthSq = direction.x * direction.x + direction.z * direction.z;
  if (horizontalLengthSq < 0.0001) return null;
  const toX = target.x - origin.x;
  const toZ = target.z - origin.z;
  const along = (toX * direction.x + toZ * direction.z) / horizontalLengthSq;
  if (along < 0) return null;
  const rayX = origin.x + direction.x * along;
  const rayY = origin.y + direction.y * along;
  const rayZ = origin.z + direction.z * along;
  const axisY = clamp(rayY, lowY, highY);
  const distance = Math.hypot(target.x - rayX, axisY - rayY, target.z - rayZ);
  return { along, distance };
}

function spawnForSlot(slot) {
  const spawns = [
    [-5, 0], [5, 0], [0, -8], [0, 8],
    [-8, -8], [8, 8], [-8, 8], [8, -8],
    [-12, 0], [12, 0], [0, -14], [0, 14]
  ];
  const point = spawns[slot % spawns.length];
  return { x: point[0], y: 1.7, z: point[1] };
}

function sendRoomState(room, type = 'state') {
  broadcast(room, { type, players: publicPlayers(room) });
}

function resolvePulseHit(shooter, shot) {
  const weaponId = Object.prototype.hasOwnProperty.call(WEAPONS, shot.weapon) ? shot.weapon : 'pulse';
  const weapon = WEAPONS[weaponId];
  const direction = { x: finite(shot.dx), y: finite(shot.dy), z: finite(shot.dz) };
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 0.9 || length > 1.1) return;
  direction.x /= length;
  direction.y /= length;
  direction.z /= length;

  const origin = {
    x: finite(shot.ox, shooter.x),
    y: finite(shot.oy, shooter.y),
    z: finite(shot.oz, shooter.z)
  };
  if (Math.hypot(origin.x - shooter.x, origin.y - shooter.y, origin.z - shooter.z) > 1.25) return;

  let best = null;
  for (const target of members(shooter.room)) {
    if (target.id === shooter.id || !target.alive) continue;
    if (shooter.mode !== 'ffa' && target.team === shooter.team) continue;
    const hit = distanceRayToVerticalCapsule(origin, direction, target);
    if (!hit || hit.along > weapon.range || hit.distance > 0.48) continue;
    if (!best || hit.along < best.along) best = { target, along: hit.along };
  }
  if (!best) return;

  const target = best.target;
  target.health = Math.max(0, target.health - weapon.damage);
  const eliminated = target.health <= 0;
  send(shooter.ws, {
    type: 'hitConfirm', targetId: target.id, targetName: target.name,
    damage: weapon.damage, targetHealth: target.health, weapon: weaponId, eliminated
  });
  send(target.ws, {
    type: 'damaged', sourceId: shooter.id, sourceName: shooter.name,
    damage: weapon.damage, health: target.health, eliminated
  });

  if (eliminated) {
    target.alive = false;
    shooter.score += 1;
    broadcast(shooter.room, {
      type: 'elimination', source: shooter.id, target: target.id,
      sourceName: shooter.name, targetName: target.name,
      players: publicPlayers(shooter.room)
    });
    const room = shooter.room;
    const targetId = target.id;
    setTimeout(() => {
      const current = clients.get(targetId);
      const match = matches.get(room);
      if (!current || current.room !== room || !match?.active) return;
      const spawn = spawnForSlot(Math.floor(Math.random() * 8));
      current.x = spawn.x; current.y = spawn.y; current.z = spawn.z;
      current.health = MAX_HEALTH; current.alive = true;
      current.moving = false; current.crouching = false;
      send(current.ws, { type: 'respawned', x: current.x, y: current.y, z: current.z, health: current.health });
      sendRoomState(room, 'players');
    }, RESPAWN_DELAY_MS);
  } else {
    sendRoomState(shooter.room, 'scoreUpdate');
  }
}

wss.on('connection', ws => {
  const c = {
    ws, id: crypto.randomUUID().slice(0, 8), name: 'OPERATOR',
    mode: 'ffa', map: 'district', room: null, team: null,
    x: 0, y: 1.7, z: 7, yaw: 0, pitch: 0, score: 0, health: MAX_HEALTH, alive: true,
    moving: false, crouching: false, weapon: 'pulse',
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
      const spawn = spawnForSlot(members(room).length);
      c.x = spawn.x; c.y = spawn.y; c.z = spawn.z; c.yaw = 0; c.pitch = 0;
      c.score = 0; c.health = MAX_HEALTH; c.alive = true; c.moving = false; c.crouching = false;
      clients.set(c.id, c);
      c.team = assignTeam(mode, room);
      send(ws, { type: 'welcome', id: c.id, team: c.team, players: publicPlayers(room), self: publicPlayers(room).find(p => p.id === c.id) });
      broadcastPlayers(room);
      return;
    }

    if (!c.room || !clients.has(c.id)) return;

    if (message.type === 'move') {
      if (!c.alive) return;
      const now = Date.now();
      const elapsed = Math.max(0.001, Math.min((now - c.lastMove) / 1000, 0.25));
      const nextX = clamp(finite(message.x, c.x), -MAP_BOUNDS, MAP_BOUNDS);
      const nextZ = clamp(finite(message.z, c.z), -MAP_BOUNDS, MAP_BOUNDS);
      const distance = Math.hypot(nextX - c.x, nextZ - c.z);
      if (distance <= 10.5 * elapsed + 0.35) { c.x = nextX; c.z = nextZ; }
      const nextY = clamp(finite(message.y, c.y), 1.0, 7.5);
      if (Math.abs(nextY - c.y) <= 14 * elapsed + 0.5) c.y = nextY;
      c.yaw = finite(message.yaw, c.yaw);
      c.pitch = clamp(finite(message.pitch, c.pitch), -1.4, 1.4);
      c.moving = Boolean(message.moving);
      c.crouching = Boolean(message.crouching);
      c.weapon = ['pulse', 'volt', 'arc'].includes(message.weapon) ? message.weapon : c.weapon;
      c.lastMove = now;
      return;
    }

    if (message.type === 'shot') {
      if (!matches.get(c.room)?.active || !c.alive) return;
      const weapon = Object.prototype.hasOwnProperty.call(WEAPONS, message.weapon) ? message.weapon : 'pulse';
      const now = Date.now();
      if (now - (c.lastShot[weapon] || 0) < WEAPONS[weapon].cooldown) return;
      c.lastShot[weapon] = now;
      const shot = {
        weapon, dx: finite(message.dx), dy: finite(message.dy), dz: finite(message.dz),
        ox: finite(message.ox, c.x), oy: finite(message.oy, c.y), oz: finite(message.oz, c.z)
      };
      broadcast(c.room, { type: 'shot', id: c.id, x: c.x, y: c.y, z: c.z, ...shot }, ws);
      resolvePulseHit(c, shot);
      return;
    }

    // The server resolves tags from shot direction. Ignore client-supplied target IDs.
    if (message.type === 'tag') return;

    if (message.type === 'respawn') return; // Respawns are scheduled and validated by the server.

    if (message.type === 'startMatch') {
      if (matches.get(c.room)?.active) return;
      const roomPlayers = members(c.room);
      if (roomPlayers.length < 2) return send(ws, { type: 'error', message: 'At least 2 players are required to start' });
      if (c.mode !== 'ffa' && new Set(roomPlayers.map(p => p.team)).size < 2) {
        return send(ws, { type: 'error', message: 'At least two squads are required' });
      }
      for (const player of roomPlayers) { player.score = 0; player.health = MAX_HEALTH; player.alive = true; }
      matches.set(c.room, { active: true, startedAt: Date.now(), duration: MATCH_SECONDS });
      broadcast(c.room, { type: 'matchStart', duration: MATCH_SECONDS, players: publicPlayers(c.room) });
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
