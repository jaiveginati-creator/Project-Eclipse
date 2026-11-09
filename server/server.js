const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_VERSION = require('../package.json').version;
const { isPlayerPositionBlocked, movementBlocked, hasLineOfSight } = require('./map-collision');
const { chooseRecoveryWaypoint } = require('./bot-navigation');

const PORT = Number(process.env.PORT || 3001);
// Keep progression-changing developer commands disabled on public servers by default.
const DEV_MODE = process.env.ECLIPSE_DEV_MODE === 'true';
const TICK_MS = 50;
const MATCH_SECONDS = 480;
const MAP_BOUNDS = 47.8;
const MAX_HEALTH = 100;
const HEALTH_REGEN_DELAY_MS = 4000;
const HEALTH_REGEN_PER_SECOND = 12;
const RESPAWN_DELAY_MS = 5000;
const WEAPONS = {
  pulse: { cooldown: 220, damage: 34, range: 42 },
  volt: { cooldown: 105, damage: 18, range: 34 },
  magnum: { cooldown: 260, damage: 42, range: 48 },
  arc: { cooldown: 420, damage: 58, range: 55 },
  needler: { cooldown: 125, damage: 27, range: 38, radius: 3.1 },
  rocket: { cooldown: 900, damage: 78, range: 55, radius: 5.2 },
  shotgun: { cooldown: 680, damage: 44, range: 18, radius: 0.8 },
  burst: { cooldown: 390, damage: 27, range: 44 },
  sniper: { cooldown: 1250, damage: 125, range: 95, hitRadius: 0.42 }
};
const PRIMARY_WEAPONS = new Set(['pulse','arc','needler','rocket','shotgun','burst','sniper']);
const SECONDARY_WEAPONS = new Set(['volt','magnum']);

const PROFILE_FILE = path.join(__dirname, 'profiles.json');
const LEVEL_XP = [0,500,1200,2100,3300,4800,6600,8700,11100,13800,16800,20100,23700,27600,31800];
const WEAPON_LEVELS = {pulse:1,volt:1,magnum:2,arc:3,shotgun:4,burst:5,needler:6,rocket:8,sniper:1};
const OPERATOR_LEVELS = {vanguard:1,recon:3,assault:6,phantom:9};
const ATTACHMENT_LEVELS = {ammoType:{standard:0,incendiary:0,shock:0,rapid:0,heavy:0,explosive:0},barrel:{standard:0,extended:250,heavy:650},magazine:{standard:0,extended:350,quick:550},stock:{standard:0,tactical:450,weighted:750},underbarrel:{none:0,grip:300,laser:700}};
const DEFAULT_BUILD = {name:'FIELD STANDARD',ammoType:'standard',barrel:'standard',magazine:'standard',stock:'standard',underbarrel:'none',camo:'standard'};
let profileStore={};try{profileStore=JSON.parse(fs.readFileSync(PROFILE_FILE,'utf8'));}catch{profileStore={};}
function levelForXP(xp){let level=1;for(let i=1;i<LEVEL_XP.length;i++){if(xp>=LEVEL_XP[i])level=i+1;else break;}return level;}
function newProfile(id){return{id,xp:0,level:1,stats:{matches:0,kills:0,deaths:0,wins:0},weaponXP:{},builds:{},matchHistory:[],createdAt:Date.now(),updatedAt:Date.now(),lastMatchXP:0};}
function getProfile(id){if(!profileStore[id])profileStore[id]=newProfile(id);const p=profileStore[id];p.stats={matches:0,kills:0,deaths:0,wins:0,...(p.stats||{})};p.weaponXP=p.weaponXP||{};p.builds=p.builds||{};p.matchHistory=Array.isArray(p.matchHistory)?p.matchHistory:[];p.level=levelForXP(Number(p.xp)||0);return p;}
function saveProfiles(){try{const temp=PROFILE_FILE+'.tmp';fs.writeFileSync(temp,JSON.stringify(profileStore));fs.renameSync(temp,PROFILE_FILE);}catch(error){console.error('[profiles] save failed:',error.message);}}
function unlockedWeapon(profile,id){return(WEAPON_LEVELS[id]||99)<=profile.level;}
function sanitizeBuild(profile,raw={}){const xp=Number(profile.weaponXP?.[raw.weaponId])||0,result={...DEFAULT_BUILD,name:String(raw.name||'FIELD STANDARD').replace(/[<>]/g,'').slice(0,22)};for(const slot of Object.keys(ATTACHMENT_LEVELS)){const choice=raw[slot];if(Object.prototype.hasOwnProperty.call(ATTACHMENT_LEVELS[slot],choice)&&xp>=ATTACHMENT_LEVELS[slot][choice])result[slot]=choice;}const camoLevels={standard:1,arctic:4,ember:7,void:10};if(camoLevels[raw.camo]&&profile.level>=camoLevels[raw.camo])result.camo=raw.camo;return result;}
function sanitizeBuilds(profile,raw={}){const result={};for(const id of Object.keys(WEAPONS))result[id]=sanitizeBuild(profile,{...(raw[id]||profile.builds?.[id]||{}),weaponId:id});return result;}
function weaponStatsFor(player,id){const stats={...WEAPONS[id]},build=player.weaponBuilds?.[id]||{},ammoType=build.ammoType||'standard';if(build.barrel==='extended')stats.range*=1.18;if(build.barrel==='heavy'){stats.damage=Math.round(stats.damage*1.10);stats.cooldown=Math.round(stats.cooldown*1.12);}if(build.magazine==='quick')stats.cooldown=Math.round(stats.cooldown*.93);if(build.stock==='tactical')stats.cooldown=Math.round(stats.cooldown*.94);if(['rocket','needler'].includes(id)){stats.splashRadius=stats.radius;}if(ammoType==='explosive'){stats.damage=Math.round(stats.damage*.85);stats.splashRadius=Math.max(stats.splashRadius||0,2.8);}if(ammoType==='incendiary'){stats.damage=Math.round(stats.damage*1.12);stats.range*=.9;}if(ammoType==='shock'){stats.damage=Math.round(stats.damage*.92);stats.range*=1.1;}if(ammoType==='rapid'){stats.damage=Math.round(stats.damage*.72);stats.cooldown=Math.max(55,Math.round(stats.cooldown*.72));}if(ammoType==='heavy'){stats.damage=Math.round(stats.damage*1.3);stats.cooldown=Math.round(stats.cooldown*1.22);}return stats;}

const DIST_DIR = path.join(__dirname, '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// One public HTTP(S) service hosts the built client and its WebSocket endpoint.
// Render (or another Node host) supplies PORT and terminates HTTPS in front of this process.
const httpServer = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'project-eclipse', version: APP_VERSION, players: clients.size, rooms: matches.size, uptimeSeconds: Math.floor(process.uptime()) }));
  }
  if (pathname.startsWith('/')) {
    let requested;
    try { requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname); }
    catch { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Bad request'); }
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
const roomBots = new Map();
const BOT_NAMES = ['NOVA-7','ORBIT-3','ECHO-9','COMET-4','LUMEN-2','ASTRA-8','PULSE-6','COSMO-5','ION-1','VEGA-3','SOL-8'];
function botsIn(room) { return roomBots.get(room) || []; }
wss.on('error', err => console.error('[websocket] server error:', err.message));

const VALID_MODES = new Set(['ffa', 'duos', 'trios']);
const roomKey = (mode, map, code = '') => code ? `${mode}:${map}:private:${code}` : `${mode}:${map}`;
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
  const humans = members(room).map(c => ({
    id: c.id, name: c.name, mode: c.mode, map: c.map, team: c.team, isBot: false,
    x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, score: c.score,
    health: c.health, alive: c.alive, moving: c.moving, crouching: c.crouching,
    weapon: c.weapon, operator: c.operator, cloaked: c.operator==='phantom'&&c.cloakedUntil>Date.now(), primary: c.primary, secondary: c.secondary,
    equipment: c.equipment, supportPoints: c.supportPoints || 0, supportShield: c.supportShield || 0
  }));
  const bots = botsIn(room).map(bot => ({
    id: bot.id, name: bot.name, mode: bot.mode, map: bot.map, team: bot.team, isBot: true,
    x: bot.x, y: bot.y, z: bot.z, yaw: bot.yaw, pitch: bot.pitch, score: bot.score,
    health: bot.health, alive: bot.alive, moving: bot.moving, crouching: bot.crouching,
    weapon: bot.weapon, operator: bot.operator, cloaked: false, primary: bot.primary, secondary: bot.secondary,
    equipment: bot.equipment, supportPoints: bot.supportPoints || 0, supportShield: bot.supportShield || 0
  }));
  return [...humans, ...bots];
}
function broadcastPlayers(room) {
  broadcast(room, { type: 'players', players: publicPlayers(room) });
}

// Fill the least-populated squad first, so small local test sessions are balanced.
function assignTeam(mode, room) {
  if (mode === 'ffa') return null;
  const size = teamSize(mode);
  const counts = new Map();
  for (const c of [...members(room), ...botsIn(room)]) {
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
  const match=matches.get(room);if(!match||!match.active)return;match.active=false;
  const roomMembers=members(room);
  const results=[...roomMembers.map(c=>{const shots=c.matchShots||0,hits=c.matchHits||0;return {id:c.id,name:c.name,team:c.team,score:c.score,kills:c.matchKills||0,deaths:c.matchDeaths||0,assists:c.matchAssists||0,shots,hits,accuracy:shots?Math.min(100,Math.round(hits/shots*100)):0};}),...botsIn(room).map(bot=>{const shots=bot.matchShots||0,hits=bot.matchHits||0;return{id:bot.id,name:bot.name,team:bot.team,score:bot.score||0,kills:bot.matchKills||0,deaths:bot.matchDeaths||0,assists:bot.matchAssists||0,shots,hits,accuracy:shots?Math.min(100,Math.round(hits/shots*100)):0,isBot:true};})].sort((a,b)=>b.score-a.score||b.kills-a.kills);
  const winnerId=results[0]?.id,mvpId=results[0]?.id;
  for(const c of roomMembers){
    const profile=c.profile||getProfile(c.profileId),kills=c.matchKills||0,deaths=c.matchDeaths||0,placement=results.findIndex(p=>p.id===c.id)+1;
    const earned=250+kills*100+(c.id===winnerId?200:0)+(c.matchAssists||0)*40;
    profile.xp=(Number(profile.xp)||0)+earned;profile.level=levelForXP(profile.xp);profile.stats.matches++;profile.stats.kills+=kills;profile.stats.deaths+=deaths;if(c.id===winnerId)profile.stats.wins++;
    for(const [weaponId,count] of Object.entries(c.matchWeaponKills||{}))profile.weaponXP[weaponId]=(profile.weaponXP[weaponId]||0)+count*100;
    profile.builds=c.weaponBuilds||profile.builds;profile.lastMatchXP=earned;profile.matchHistory.unshift({date:Date.now(),mode:c.mode,map:c.map,kills,deaths,assists:c.matchAssists||0,score:c.score||0,accuracy:results.find(p=>p.id===c.id)?.accuracy||0,placement,xp:earned});profile.matchHistory=profile.matchHistory.slice(0,20);profile.updatedAt=Date.now();
    send(c.ws,{type:'profileUpdate',profile});
  }
  saveProfiles();broadcast(room,{type:'matchEnd',results,mvpId});
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
  return { along, distance, rayY, lowY, highY };
}

function spawnForSlot(slot, map = 'district') {
  const compactSpawns = [[-17,-17],[17,-17],[-17,17],[17,17],[-17,0],[17,0],[0,-17],[0,17]];
  const industrialSpawns = [[-12,0],[12,0],[0,-15],[0,15],[-12,16],[12,-16],[-12,-16],[12,16],[-20,0],[20,0],[0,-22],[0,22]];
  const districtSpawns = [[-5,0],[5,0],[0,-8],[0,8],[-8,-8],[8,8],[-8,8],[8,-8],[-12,0],[12,0],[0,-14],[0,14]];
  const points = map === 'sublevel' ? compactSpawns : map === 'industrial' ? industrialSpawns : districtSpawns;
  for (let offset = 0; offset < points.length; offset++) {
    const point = points[(Math.max(0, slot) + offset) % points.length];
    if (!isPlayerPositionBlocked(map, point[0], 1.7, point[1])) return { x: point[0], y: 1.7, z: point[1] };
  }
  // A deterministic open-area fallback prevents a blocked spawn if a map volume is added later.
  const fallback = map === 'sublevel' ? [[0,-17],[0,17],[-17,0],[17,0]] : [[-42,-8],[42,8],[-42,8],[42,-8]];
  for (const point of fallback) if (!isPlayerPositionBlocked(map, point[0], 1.7, point[1])) return { x: point[0], y: 1.7, z: point[1] };
  return { x: 0, y: 1.7, z: map === 'industrial' ? 18 : 0 };
}


// Server-authoritative combat bots use the same weapon profiles,
// hit resolver, team rules, health, respawn and match scoring as human operators.
const BOT_LOADOUTS = [
  { primary: 'pulse', secondary: 'volt' },
  { primary: 'arc', secondary: 'magnum' },
  { primary: 'shotgun', secondary: 'volt' },
  { primary: 'sniper', secondary: 'magnum' },
  { primary: 'needler', secondary: 'volt' },
  { primary: 'rocket', secondary: 'magnum' },
  { primary: 'burst', secondary: 'volt' }
];
const BOT_ROUTES = {
  district: [[-42,0],[-22,0],[0,0],[22,0],[42,0],[0,0],[0,42],[0,22],[0,-22],[0,-42],[0,0]],
  industrial: [[-43,0],[-22,0],[0,0],[22,0],[43,0],[0,0],[0,43],[0,22],[0,-22],[0,-43],[0,0]],
  sublevel: [[-16,-16],[-16,0],[-16,16],[0,16],[16,16],[16,0],[16,-16],[0,-16]]
};
function combatants(room) { return [...members(room), ...botsIn(room)]; }
function isEnemy(shooter, target) {
  return target.id !== shooter.id && target.alive &&
    (shooter.mode === 'ffa' || target.team !== shooter.team);
}
function botPreferredRange(weapon) {
  return ({ sniper: 34, rocket: 18, shotgun: 8, needler: 19, arc: 23, burst: 25, magnum: 12, volt: 10, pulse: 22 })[weapon] || 20;
}
function chooseBotWeapon(bot, distance) {
  const primary = bot.primary || 'pulse';
  const secondary = bot.secondary || 'volt';
  if (primary === 'sniper') return distance > 19 ? primary : secondary;
  if (primary === 'shotgun') return distance < 11 ? primary : secondary;
  if (primary === 'rocket') return distance > 7 && distance < 31 ? primary : secondary;
  if (primary === 'needler') return distance < 31 ? primary : secondary;
  if (primary === 'arc') return distance > 9 ? primary : secondary;
  if (primary === 'burst') return distance > 8 ? primary : secondary;
  return distance < 8 ? secondary : primary;
}
function chooseBotTarget(bot, all, now) {
  bot.combat = bot.combat || { targetId: null, nextTargetScan: 0, reactionUntil: 0, nextFire: 0 };
  // Bots deliberately spend several seconds roaming before noticing anyone.
  if (bot.combat.acquireAfter == null) bot.combat.acquireAfter = now + 3500 + Math.random() * 3000;
  const current = all.find(p => p.id === bot.combat.targetId && isEnemy(bot, p));
  if (current && now < bot.combat.nextTargetScan) return current;
  if (!current && bot.combat.targetId) {
    bot.combat.targetId = null;
    bot.combat.acquireAfter = now + 2200 + Math.random() * 2200;
    bot.combat.nextTargetScan = bot.combat.acquireAfter;
    return null;
  }
  if (!current && now < bot.combat.acquireAfter) return null;
  if (!current && now < bot.combat.nextTargetScan) return null;
  bot.combat.nextTargetScan = now + 1100 + Math.random() * 900;
  let best = null, bestScore = Infinity;
  const origin = { x: bot.x, y: bot.y - .25, z: bot.z };
  for (const candidate of all) {
    if (!isEnemy(bot, candidate)) continue;
    const distance = Math.hypot(candidate.x - bot.x, candidate.y - bot.y, candidate.z - bot.z);
    if (distance > 58) continue;
    const aimPoint = { x: candidate.x, y: candidate.y - (candidate.crouching ? .55 : .7), z: candidate.z };
    const visible = hasLineOfSight(bot.map, origin, aimPoint);
    const score = distance - (visible ? 8 : 0) - (candidate.damageContributors?.[bot.id] ? 1 : 0);
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  if (best?.id !== bot.combat.targetId) {
    bot.combat.targetId = best?.id || null;
    bot.combat.reactionUntil = now + 900 + Math.random() * 900;
    bot.combat.nextFire = Math.max(bot.combat.nextFire || 0, now + 900 + Math.random() * 900);
  }
  return best;
}
function stepArcadeBot(bot, nearbyPlayers, deltaSeconds, now, combatTarget = null) {
  if (!bot.nav) {
    const index = Math.max(0, Number(bot.id.slice(4)) - 1);
    const route = BOT_ROUTES[bot.map] || BOT_ROUTES.district;
    bot.nav = {
      route, waypoint: index % route.length,
      nextRouteChoice: now + 1800, nextJump: now + 2800 + (index % 5) * 650,
      jumpUntil: 0, nextCrouch: now + 4200 + (index % 4) * 800,
      crouchUntil: 0, phase: index * 1.73,
      speed: 7.3 + (index % 4) * .28,
      strafeDirection: index % 2 ? 1 : -1, nextStrafe: now + 500,
      lastProgressX: bot.x, lastProgressZ: bot.z, stuckSince: now, lastRecoveryAt: 0
    };
  }
  const nav = bot.nav, route = nav.route;
  let waypoint = route[nav.waypoint];
  let routeX = waypoint[0] - bot.x, routeZ = waypoint[1] - bot.z;
  let routeDistance = Math.hypot(routeX, routeZ);
  if (routeDistance < 1.35) {
    nav.waypoint = (nav.waypoint + 1) % route.length;
    waypoint = route[nav.waypoint];
    routeX = waypoint[0] - bot.x; routeZ = waypoint[1] - bot.z;
    routeDistance = Math.hypot(routeX, routeZ);
  }
  if (!combatTarget && now >= nav.nextRouteChoice) {
    const candidate = route[nav.waypoint];
    const crowded = nearbyPlayers.some(p => p.id !== bot.id && p.alive && Math.hypot(p.x - candidate[0], p.z - candidate[1]) < 3.1);
    if (crowded && route.length > 3) {
      const forward = (nav.waypoint + 1) % route.length, alternate = (nav.waypoint + 2) % route.length;
      const crowdAt = point => nearbyPlayers.reduce((sum,p) => p.id !== bot.id && p.alive ? sum + Math.max(0,4.2-Math.hypot(p.x-point[0],p.z-point[1])) : sum,0);
      nav.waypoint = crowdAt(route[alternate]) < crowdAt(route[forward]) ? alternate : forward;
    }
    nav.nextRouteChoice = now + 1600 + Math.abs(Math.sin(nav.phase)) * 850;
    // The route choice may have changed the waypoint; refresh the steering vector.
    waypoint = route[nav.waypoint];
    routeX = waypoint[0] - bot.x;
    routeZ = waypoint[1] - bot.z;
    routeDistance = Math.hypot(routeX, routeZ);
  }
  let moveX = routeX / Math.max(routeDistance, .001), moveZ = routeZ / Math.max(routeDistance, .001);
  if (combatTarget) {
    const dx = combatTarget.x - bot.x, dz = combatTarget.z - bot.z, distance = Math.hypot(dx, dz) || 1;
    const tx = dx / distance, tz = dz / distance, ideal = botPreferredRange(bot.weapon);
    if (distance > ideal + 2.2) { moveX = tx; moveZ = tz; }
    else if (distance < ideal - 2.0) { moveX = -tx; moveZ = -tz; }
    else {
      if (now >= nav.nextStrafe) { nav.strafeDirection *= -1; nav.nextStrafe = now + 520 + Math.abs(Math.sin(nav.phase)) * 520; }
      const radial = clamp((distance - ideal) / Math.max(ideal, 1), -.24, .24);
      moveX = -tz * nav.strafeDirection + tx * radial;
      moveZ = tx * nav.strafeDirection + tz * radial;
    }
  }
  let avoidX = 0, avoidZ = 0;
  for (const other of nearbyPlayers) {
    if (other.id === bot.id || !other.alive) continue;
    const ox = bot.x - other.x, oz = bot.z - other.z, separation = Math.hypot(ox, oz);
    if (separation > .01 && separation < 2.1) {
      const force = (2.1 - separation) / 2.1;
      avoidX += ox / separation * force; avoidZ += oz / separation * force;
    }
  }
  moveX += avoidX * 1.25; moveZ += avoidZ * 1.25;
  const edgeMargin = bot.map === 'sublevel' ? 21.5 : 45.5;
  if (Math.abs(bot.x) > edgeMargin) moveX += -Math.sign(bot.x) * 1.8;
  if (Math.abs(bot.z) > edgeMargin) moveZ += -Math.sign(bot.z) * 1.8;
  const magnitude = Math.hypot(moveX, moveZ) || 1; moveX /= magnitude; moveZ /= magnitude;
  const speed = nav.speed * deltaSeconds;
  const directions = [[moveX,moveZ]];
  // Roaming bots sample a finer set of steering angles around cover edges.
  // Keep the existing target-following steering unchanged.
  if (!combatTarget) {
    for (let step = 1; step <= 7; step++) {
      const angle = step * Math.PI / 8;
      for (const sign of [-1, 1]) {
        const a = angle * sign;
        directions.push([moveX*Math.cos(a)-moveZ*Math.sin(a),moveX*Math.sin(a)+moveZ*Math.cos(a)]);
      }
    }
  } else {
    for (const angle of [.72,-.72,1.42,-1.42,2.25,-2.25,Math.PI]) {
      directions.push([moveX*Math.cos(angle)-moveZ*Math.sin(angle),moveX*Math.sin(angle)+moveZ*Math.cos(angle)]);
    }
  }
  if (routeDistance > .01) directions.push([routeX/routeDistance,routeZ/routeDistance]);
  let moved = false;
  for (const [vx,vz] of directions) {
    const next = { x: clamp(bot.x + vx*speed, - (bot.map === 'sublevel' ? 23.2 : MAP_BOUNDS-1.5), bot.map === 'sublevel' ? 23.2 : MAP_BOUNDS-1.5), y: bot.y, z: clamp(bot.z + vz*speed, -(bot.map === 'sublevel' ? 23.2 : MAP_BOUNDS-1.5), bot.map === 'sublevel' ? 23.2 : MAP_BOUNDS-1.5) };
    if (!movementBlocked(bot.map, { x: bot.x, y: bot.y, z: bot.z }, next)) { bot.x = next.x; bot.z = next.z; moved = true; break; }
  }
  // Roaming-only recovery: if a bot cannot make progress, select a different
  // reachable waypoint. This branch is deliberately disabled while a target exists.
  if (!combatTarget) {
    const progress = Math.hypot(bot.x - nav.lastProgressX, bot.z - nav.lastProgressZ);
    if (progress > .35) {
      nav.lastProgressX = bot.x;
      nav.lastProgressZ = bot.z;
      nav.stuckSince = now;
    } else if (now - nav.stuckSince > 1600 && now - nav.lastRecoveryAt > 1800) {
      nav.waypoint = chooseRecoveryWaypoint({
        map: bot.map, bot, route, currentWaypoint: nav.waypoint,
        nearbyPlayers, movementBlocked
      });
      nav.stuckSince = now;
      nav.lastRecoveryAt = now;
    }
  }
  bot.moving = moved && (Math.abs(moveX) + Math.abs(moveZ) > .05);
  const desiredYaw = combatTarget ? Math.atan2(combatTarget.x - bot.x, combatTarget.z - bot.z) : Math.atan2(moveX, moveZ);
  const yawDelta = Math.atan2(Math.sin(desiredYaw - bot.yaw), Math.cos(desiredYaw - bot.yaw));
  bot.yaw += clamp(yawDelta, -1.35 * deltaSeconds, 1.35 * deltaSeconds);
  nav.phase += deltaSeconds * 5.5;
  if (now >= nav.nextJump) { nav.jumpUntil = now + 520; nav.nextJump = now + 5600 + Math.abs(Math.sin(nav.phase))*2800; }
  if (now >= nav.nextCrouch) { nav.crouchUntil = now + 620; nav.nextCrouch = now + 7000 + Math.abs(Math.cos(nav.phase))*3500; }
  bot.crouching = now < nav.crouchUntil || Boolean(combatTarget && Math.hypot(combatTarget.x-bot.x,combatTarget.z-bot.z)<10 && Math.sin(now/230 + nav.phase)>0.35);
  const jumpProgress = nav.jumpUntil > now ? 1 - (nav.jumpUntil - now) / 520 : 0;
  bot.y = 1.7 + (nav.jumpUntil > now ? Math.sin(jumpProgress * Math.PI) * 1.05 : 0);
}
function useBotSupport(bot, all, now) {
  if (bot.supportPoints >= 300 && now - bot.lastSupportAt >= 15000) {
    const squad = all.filter(p => p.alive && (bot.mode === 'ffa' ? p.id === bot.id : p.team === bot.team));
    const ability = squad.some(p => p.health < 72) ? 'rally' : 'shield';
    if (ability === 'shield') for (const p of squad) p.supportShield = Math.min(60, (p.supportShield || 0) + 25);
    else for (const p of squad) { p.health = Math.min(MAX_HEALTH, p.health + 25); p.lastDamageAt = now; }
    bot.supportPoints -= 300; bot.supportReady = false; bot.lastSupportAt = now;
    broadcast(bot.room, { type: 'supportUsed', id: bot.id, ability, team: bot.team, players: publicPlayers(bot.room) });
  }
  if (bot.equipment === 'shield' && bot.health < 58 && now - bot.lastEquipmentAt >= 25000) {
    bot.health = Math.min(MAX_HEALTH, bot.health + 35); bot.lastDamageAt = now; bot.lastEquipmentAt = now;
    broadcast(bot.room, { type: 'equipment', id: bot.id, equipment: 'shield' });
    sendRoomState(bot.room, 'state');
  }
}
function stepCombatBot(bot, all, deltaSeconds, now) {
  const target = chooseBotTarget(bot, all, now);
  if (!target) { stepArcadeBot(bot, all, deltaSeconds, now); useBotSupport(bot, all, now); return; }
  const distance = Math.hypot(target.x-bot.x,target.y-bot.y,target.z-bot.z);
  const weapon = chooseBotWeapon(bot, distance);
  if (bot.weapon !== weapon) { bot.weapon = weapon; bot.combat.nextFire = Math.max(bot.combat.nextFire, now + 80); }
  stepArcadeBot(bot, all, deltaSeconds, now, target);
  const origin = { x: bot.x, y: bot.y - .25, z: bot.z };
  const aimPoint = { x: target.x, y: target.y - (target.crouching ? .55 : .7), z: target.z };
  const dx = aimPoint.x-origin.x, dy = aimPoint.y-origin.y, dz = aimPoint.z-origin.z;
  const length = Math.hypot(dx,dy,dz) || 1;
  const range = weaponStatsFor(bot, weapon).range;
  if (distance > range || !hasLineOfSight(bot.map, origin, aimPoint)) { useBotSupport(bot, all, now); return; }
  if (now < bot.combat.reactionUntil || now < bot.combat.nextFire) { useBotSupport(bot, all, now); return; }
  const stats = weaponStatsFor(bot, weapon);
  if (now - (bot.lastShot[weapon] || 0) < stats.cooldown) { useBotSupport(bot, all, now); return; }
  bot.lastShot[weapon] = now;
  bot.combat.nextFire = now + stats.cooldown + Math.random() * 28;
  // Deliberately imperfect arcade aim: bots react slowly and shots become less reliable with distance.
  const spread = .14 + Math.min(.22, distance * .0045);
  const aim = { x: dx/length + (Math.random()-.5)*spread, y: dy/length + (Math.random()-.5)*spread*.55, z: dz/length + (Math.random()-.5)*spread };
  const aimLength = Math.hypot(aim.x,aim.y,aim.z) || 1;
  const shot = { weapon, dx: aim.x/aimLength, dy: aim.y/aimLength, dz: aim.z/aimLength, ox: origin.x, oy: origin.y, oz: origin.z };
  bot.matchShots = (bot.matchShots || 0) + 1;
  broadcast(bot.room, { type: 'shot', id: bot.id, x: bot.x, y: bot.y, z: bot.z, ammoType: 'standard', ...shot });
  resolvePulseHit(bot, shot);
  useBotSupport(bot, all, now);
}


function sendRoomState(room, type = 'state') {
  broadcast(room, { type, players: publicPlayers(room) });
}

function resolvePulseHit(shooter, shot) {
  const weaponId = Object.prototype.hasOwnProperty.call(WEAPONS, shot.weapon) ? shot.weapon : 'pulse';
  const weapon = weaponStatsFor(shooter, weaponId);
  const direction = { x: finite(shot.dx), y: finite(shot.dy), z: finite(shot.dz) };
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 0.9 || length > 1.1) return;
  direction.x /= length; direction.y /= length; direction.z /= length;
  const origin = { x: finite(shot.ox, shooter.x), y: finite(shot.oy, shooter.y), z: finite(shot.oz, shooter.z) };
  if (Math.hypot(origin.x-shooter.x,origin.y-shooter.y,origin.z-shooter.z)>1.25) return;
  const all = combatants(shooter.room);
  const splashRadius = weapon.splashRadius || ((weaponId === 'needler' || weaponId === 'rocket') ? weapon.radius : 0);
  let best = null;
  for (const target of all) {
    if (!isEnemy(shooter, target)) continue;
    const hit = distanceRayToVerticalCapsule(origin, direction, target);
    if (!hit || hit.along > weapon.range) continue;
    const direct = hit.distance <= (weapon.hitRadius || .48);
    const splashProximity = splashRadius > 0 && hit.distance <= splashRadius;
    if (!direct && !splashProximity) continue;
    const targetPoint = { x: target.x, y: target.y - (target.crouching ? .55 : .7), z: target.z };
    if (!hasLineOfSight(shooter.map, origin, targetPoint)) continue;
    if (!best || hit.along < best.along) best = { target, along: hit.along, distance: hit.distance, rayY: hit.rayY, highY: hit.highY, direct };
  }
  if (!best) return;
  const impact = { x: origin.x+direction.x*best.along, y: origin.y+direction.y*best.along, z: origin.z+direction.z*best.along };
  const affected = splashRadius
    ? all.filter(target => {
        if (!isEnemy(shooter,target)) return false;
        const targetPoint = { x: target.x, y: target.y - (target.crouching ? .55 : .7), z: target.z };
        const distance = Math.hypot(target.x-impact.x,target.y-impact.y,target.z-impact.z);
        return distance <= splashRadius && hasLineOfSight(shooter.map, impact, targetPoint);
      }).map(target => ({
        target,
        distance: Math.hypot(target.x-impact.x,target.y-impact.y,target.z-impact.z),
        direct: target.id === best.target.id && best.direct
      }))
    : [{ target: best.target, distance: best.distance || 0, direct: true }];
  if (affected.length) shooter.matchHits = (shooter.matchHits || 0) + 1;
  for (const hit of affected) {
    const target = hit.target;
    const falloff = splashRadius ? Math.max(.25,1-hit.distance/splashRadius*.75) : 1;
    // Bots use a deliberately gentler arcade damage profile so no single hit can one-tap a full-health player.
    const rawDamage = Math.round(weapon.damage * falloff);
    const damage = shooter.isBot ? Math.max(1, Math.min(18, Math.round(rawDamage * 0.35))) : Math.max(1, rawDamage);
    const headshot = hit.direct && best.direct && best.distance <= (weapon.hitRadius||.48) && best.rayY >= best.highY-.22;
    target.damageContributors = target.damageContributors || {};
    target.damageContributors[shooter.id] = Date.now();
    const absorbed = Math.min(target.supportShield||0,damage);
    target.supportShield = Math.max(0,(target.supportShield||0)-absorbed);
    target.health = Math.max(0,target.health-(damage-absorbed));
    target.lastDamageAt = Date.now();
    const eliminated = target.health <= 0;
    if (shooter.ws) send(shooter.ws,{type:'hitConfirm',targetId:target.id,targetName:target.name,damage,targetHealth:target.health,weapon:weaponId,eliminated,headshot});
    if (target.ws) send(target.ws,{type:'damaged',sourceId:shooter.id,sourceName:shooter.name,damage,health:target.health,eliminated,headshot});
    if (eliminated) {
      target.alive = false;
      shooter.score = (shooter.score||0)+1;
      shooter.matchKills = (shooter.matchKills||0)+1;
      shooter.matchWeaponKills = shooter.matchWeaponKills || {};
      shooter.matchWeaponKills[weaponId] = (shooter.matchWeaponKills[weaponId]||0)+1;
      target.matchDeaths = (target.matchDeaths||0)+1;
      for (const [helperId,at] of Object.entries(target.damageContributors||{})) {
        if (helperId !== shooter.id && Date.now()-at < 12000) {
          const helper = all.find(p=>p.id===helperId);
          if (helper) helper.matchAssists = (helper.matchAssists||0)+1;
        }
      }
      shooter.supportPoints = (shooter.supportPoints||0)+100;
      if (shooter.supportPoints>=300 && !shooter.supportReady) {
        shooter.supportReady=true;
        if (shooter.ws) send(shooter.ws,{type:'supportReady',points:shooter.supportPoints});
      }
      broadcast(shooter.room,{type:'elimination',source:shooter.id,target:target.id,sourceName:shooter.name,targetName:target.name,players:publicPlayers(shooter.room)});
      const room = shooter.room, targetId = target.id;
      setTimeout(() => {
        const currentHuman = clients.get(targetId);
        const currentBot = botsIn(room).find(p=>p.id===targetId);
        const match = matches.get(room);
        if (!match?.active) return;
        const current = currentHuman || currentBot;
        if (!current || current.room !== room) return;
        const spawn = spawnForSlot(current.spawnSlot ?? Math.floor(Math.random()*12),current.map);
        current.x=spawn.x;current.y=spawn.y;current.z=spawn.z;
        current.health=MAX_HEALTH;current.lastDamageAt=0;current.alive=true;
        current.supportShield=0;current.speedBoostUntil=0;current.cloakedUntil=0;current.operatorAbilityReadyAt=0;current.damageContributors={};
        current.moving=false;current.crouching=false;
        if (current.isBot) {
          current.nav=null;
          current.combat={targetId:null,nextTargetScan:0,reactionUntil:0,nextFire:0};
          current.lastShot=Object.create(null);
        } else {
          send(current.ws,{type:'respawned',x:current.x,y:current.y,z:current.z,health:current.health});
        }
        sendRoomState(room,'players');
      },RESPAWN_DELAY_MS);
    }
  }
  sendRoomState(shooter.room,'scoreUpdate');
}
wss.on('connection', ws => {
  const c = {
    ws, id: crypto.randomUUID().slice(0, 8), name: 'OPERATOR',
    mode: 'ffa', map: 'district', room: null, team: null,
    x: 0, y: 1.7, z: 7, yaw: 0, pitch: 0, score: 0, health: MAX_HEALTH, alive: true,
    moving: false, crouching: false, weapon: 'pulse', operator: 'vanguard', primary: 'pulse', secondary: 'volt', equipment: 'shield',
    profileId:null, profile:null, weaponBuilds:{}, matchKills:0, matchDeaths:0, matchWeaponKills:{}, matchAssists:0, matchShots:0, matchHits:0, damageContributors:{}, supportPoints:0, supportShield:0, supportReady:false, lastSupportAt:0, operatorAbilityReadyAt:0, speedBoostUntil:0, cloakedUntil:0,
    lastMove: Date.now(), lastDamageAt: 0, lastShot: Object.create(null), lastEquipmentAt: 0
  };

  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'join') {
      if (c.room) return send(ws, { type: 'error', message: 'You are already in a lobby' });
      const mode = VALID_MODES.has(message.mode) ? message.mode : 'ffa';
      const map = ['district','industrial','sublevel'].includes(message.map) ? message.map : 'district';
      const roomCode=String(message.roomCode||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
      const room = roomKey(mode, map, roomCode);
      if (matches.get(room)?.active) return send(ws, { type: 'error', message: 'This match has already started' });
      if (members(room).length + botsIn(room).length >= maxPlayers(mode)) return send(ws, { type: 'error', message: 'Lobby is full' });

      c.mode=mode;c.map=map;c.roomCode=roomCode;
      c.profileId=/^[a-f0-9-]{36}$/i.test(String(message.profileId||''))?String(message.profileId):crypto.randomUUID();
      c.profile=getProfile(c.profileId);
      c.operator=Object.prototype.hasOwnProperty.call(OPERATOR_LEVELS,message.operator)&&OPERATOR_LEVELS[message.operator]<=c.profile.level?message.operator:'vanguard';
      c.primary=PRIMARY_WEAPONS.has(message.primary)&&unlockedWeapon(c.profile,message.primary)?message.primary:'pulse';
      c.secondary=SECONDARY_WEAPONS.has(message.secondary)&&unlockedWeapon(c.profile,message.secondary)?message.secondary:'volt';
      c.weaponBuilds=sanitizeBuilds(c.profile,message.builds||{});c.profile.builds=c.weaponBuilds;saveProfiles();
      c.equipment = ['shield','recon','ammo'].includes(message.equipment) ? message.equipment : 'shield';
      c.room = room;
      c.name = String(message.name || 'OPERATOR').replace(/[<>]/g, '').slice(0, 18) || 'OPERATOR';
      const spawn = spawnForSlot(members(room).length + botsIn(room).length, map);
      c.x = spawn.x; c.y = spawn.y; c.z = spawn.z; c.yaw = 0; c.pitch = 0;
      c.score = 0; c.health = MAX_HEALTH; c.lastDamageAt = 0; c.alive = true; c.moving = false; c.crouching = false;
      clients.set(c.id, c);
      c.team = assignTeam(mode, room);
      if (!roomBots.has(room)) {
        const requested = clamp(Math.floor(finite(message.botCount)), 0, maxPlayers(mode) - 1);
        const bots = [];
        roomBots.set(room, bots);
        for (let i = 0; i < Math.min(requested, maxPlayers(mode) - members(room).length); i++) {
          const point = spawnForSlot(members(room).length + i, map);
          const loadout = BOT_LOADOUTS[i % BOT_LOADOUTS.length];
          const bot = { id:'bot-'+(i+1), name:BOT_NAMES[i % BOT_NAMES.length], mode, map, room, team:null, x:point.x, y:1.7, z:point.z, yaw:0, pitch:0, score:0, health:MAX_HEALTH, alive:true, moving:false, crouching:false, weapon:loadout.primary, operator:'vanguard', primary:loadout.primary, secondary:loadout.secondary, equipment:'shield', supportPoints:0, supportShield:0, isBot:true, spawnSlot:members(room).length+i, weaponBuilds:{}, matchKills:0, matchDeaths:0, matchAssists:0, matchShots:0, matchHits:0, matchWeaponKills:{}, damageContributors:{}, lastDamageAt:0, lastEquipmentAt:0, lastSupportAt:0, lastShot:Object.create(null), nav:null, combat:{targetId:null,nextTargetScan:0,reactionUntil:0,nextFire:0} };
          bot.team = assignTeam(mode, room); bots.push(bot);
        }
      }
      send(ws, { type: 'welcome', id: c.id, team: c.team, roomCode:c.roomCode, profile:c.profile, devMode:DEV_MODE, players: publicPlayers(room), self: publicPlayers(room).find(p => p.id === c.id) });
      broadcastPlayers(room);
      return;
    }

    if (!c.room || !clients.has(c.id)) return;

    if (message.type === 'devAction') {
      if (!DEV_MODE) return send(ws,{type:'error',message:'Developer mode is disabled on this server'});
      const action=String(message.action||'');
      if (action==='grantXp') {
        const amount=clamp(Math.floor(finite(message.amount)),1,50000);
        c.profile.xp=(Number(c.profile.xp)||0)+amount;
      } else if (action==='maxLevel') {
        c.profile.xp=LEVEL_XP[LEVEL_XP.length-1];
      } else if (action==='maxWeaponXP') {
        for (const id of Object.keys(WEAPONS)) c.profile.weaponXP[id]=10000;
      } else if (action==='unlockAll') {
        c.profile.xp=LEVEL_XP[LEVEL_XP.length-1];
        for (const id of Object.keys(WEAPONS)) c.profile.weaponXP[id]=10000;
      } else if (action==='resetProfile') {
        c.profile=newProfile(c.profileId);profileStore[c.profileId]=c.profile;
        c.operator='vanguard';c.primary='pulse';c.secondary='volt';c.weaponBuilds=sanitizeBuilds(c.profile,{});
      } else if (action==='heal') {
        c.health=MAX_HEALTH;c.alive=true;c.lastDamageAt=Date.now();
        send(ws,{type:'devResult',action,message:'HEALTH RESTORED',health:c.health});
        broadcast(c.room,{type:'state',players:publicPlayers(c.room)});
        return;
      } else if (action==='respawn') {
        const spawn=spawnForSlot(members(c.room).indexOf(c),c.map);
        c.x=spawn.x;c.y=spawn.y;c.z=spawn.z;c.health=MAX_HEALTH;c.alive=true;c.lastDamageAt=0;
        send(ws,{type:'devResult',action,message:'OPERATOR REDEPLOYED',health:c.health});
        send(ws,{type:'respawned',x:c.x,y:c.y,z:c.z,health:c.health});
        broadcast(c.room,{type:'state',players:publicPlayers(c.room)});
        return;
      } else {
        return send(ws,{type:'error',message:'Unknown developer action'});
      }
      c.profile.level=levelForXP(c.profile.xp);c.profile.updatedAt=Date.now();
      c.profile.builds=c.weaponBuilds||c.profile.builds;saveProfiles();
      send(ws,{type:'devResult',action,message:'DEV ACTION APPLIED',profile:c.profile});
      return;
    }

    if (message.type === 'move') {
      if (!c.alive) return;
      const now = Date.now();
      const elapsed = Math.max(0.001, Math.min((now - c.lastMove) / 1000, 0.25));
      const bounds = c.map === 'sublevel' ? 23.8 : MAP_BOUNDS;
      const nextX = clamp(finite(message.x, c.x), -bounds, bounds);
      const nextZ = clamp(finite(message.z, c.z), -bounds, bounds);
      const distance = Math.hypot(nextX - c.x, nextZ - c.z);
      const nextY = clamp(finite(message.y, c.y), 1.0, 7.5);
      const candidate = { x: nextX, y: nextY, z: nextZ };
      const speedLimit = c.speedBoostUntil > now ? 14.5 : 10.5;
      const withinSpeed = distance <= speedLimit * elapsed + 0.35 && Math.abs(nextY - c.y) <= 14 * elapsed + 0.5;
      const blocked = withinSpeed && movementBlocked(c.map, { x: c.x, y: c.y, z: c.z }, candidate);
      const accepted = withinSpeed && !blocked;
      if (accepted) {
        c.x = nextX; c.y = nextY; c.z = nextZ;
        c.lastMove = now;
      } else if (blocked) {
        // A collision is a real stop; a timing outlier is not. Preserve elapsed
        // time after speed-check jitter so the next normal packet can catch up.
        c.lastMove = now;
      }
      c.yaw = finite(message.yaw, c.yaw);
      c.pitch = clamp(finite(message.pitch, c.pitch), -1.4, 1.4);
      c.moving = Boolean(message.moving) && accepted;
      c.crouching = Boolean(message.crouching);
      c.weapon = [c.primary,c.secondary].includes(message.weapon) ? message.weapon : c.weapon;
      return;
    }

    if (message.type === 'operatorAbility') {
      const match=matches.get(c.room);if(!match?.active||!c.alive)return send(ws,{type:'operatorAbilityResult',ok:false,message:'ABILITY UNAVAILABLE'});
      const now=Date.now();if(now<c.operatorAbilityReadyAt)return send(ws,{type:'operatorAbilityResult',ok:false,message:'ABILITY RECHARGING',cooldownMs:c.operatorAbilityReadyAt-now});
      const cooldownMs=30000;let ability='';
      if(c.operator==='vanguard'){ability='bulwark';c.supportShield=Math.min(60,(c.supportShield||0)+40);}
      else if(c.operator==='recon'){
        ability='sensor';const contacts=combatants(c.room).filter(p=>isEnemy(c,p)&&Math.hypot(p.x-c.x,p.y-c.y,p.z-c.z)<=45).map(p=>({id:p.id,name:p.name,x:p.x,z:p.z}));
        c.operatorAbilityReadyAt=now+cooldownMs;send(ws,{type:'operatorAbilityResult',ok:true,ability,cooldownMs,contacts});broadcast(c.room,{type:'operatorPulse',id:c.id,x:c.x,z:c.z,operator:c.operator});return;
      }
      else if(c.operator==='assault'){ability='overdrive';c.speedBoostUntil=now+4500;}
      else if(c.operator==='phantom'){ability='phase';c.cloakedUntil=now+4000;}
      else return send(ws,{type:'operatorAbilityResult',ok:false,message:'UNKNOWN OPERATOR'});
      c.operatorAbilityReadyAt=now+cooldownMs;
      send(ws,{type:'operatorAbilityResult',ok:true,ability,cooldownMs,durationMs:ability==='overdrive'?4500:ability==='phase'?4000:0});
      broadcastPlayers(c.room);return;
    }

    if (message.type === 'equipment') {
      if (!matches.get(c.room)?.active || !c.alive) return;
      const equipment = c.equipment; if (message.equipment !== equipment) return;
      const now = Date.now(); if (now - c.lastEquipmentAt < 25000) return; c.lastEquipmentAt = now;
      if (equipment === 'shield') { c.health = Math.min(MAX_HEALTH, c.health + 35); c.lastDamageAt = now; send(ws,{type:'equipmentResult',equipment,health:c.health}); sendRoomState(c.room,'state'); }
      else broadcast(c.room,{type:'equipment',id:c.id,equipment});
      return;
    }

    if (message.type === 'supportAbility') {
      const match=matches.get(c.room);if(!match?.active||!c.alive)return;
      if(!c.supportReady||c.supportPoints<300||Date.now()-c.lastSupportAt<15000)return;
      const ability=message.ability==='shield'?'shield':'rally';
      c.supportPoints-=300;c.supportReady=false;c.lastSupportAt=Date.now();
      const squad=combatants(c.room).filter(p=>p.alive&&(c.mode==='ffa'?p.id===c.id:p.team===c.team));
      if(ability==='shield'){for(const p of squad)p.supportShield=Math.min(60,(p.supportShield||0)+25);}
      else{for(const p of squad)p.health=Math.min(MAX_HEALTH,p.health+25);}
      broadcast(c.room,{type:'supportUsed',id:c.id,ability,team:c.team,players:publicPlayers(c.room)});
      send(c.ws,{type:'supportStatus',points:c.supportPoints});
      return;
    }

    if (message.type === 'shot') {
      if (!matches.get(c.room)?.active || !c.alive) return;
      const weapon = Object.prototype.hasOwnProperty.call(WEAPONS, message.weapon) ? message.weapon : 'pulse';
      if (![c.primary,c.secondary].includes(weapon)) return;
      const now = Date.now();
      const weaponStats=weaponStatsFor(c,weapon);
      if (now - (c.lastShot[weapon] || 0) < weaponStats.cooldown) return;
      c.matchShots=(c.matchShots||0)+1;
      c.lastShot[weapon] = now;
      const shot = {
        weapon, dx: finite(message.dx), dy: finite(message.dy), dz: finite(message.dz),
        ox: finite(message.ox, c.x), oy: finite(message.oy, c.y), oz: finite(message.oz, c.z)
      };
      broadcast(c.room, { type: 'shot', id: c.id, x: c.x, y: c.y, z: c.z, ammoType:c.weaponBuilds?.[weapon]?.ammoType||'standard', ...shot }, ws);
      resolvePulseHit(c, shot);
      return;
    }

    // The server resolves tags from shot direction. Ignore client-supplied target IDs.
    if (message.type === 'tag') return;

    if (message.type === 'respawn') return; // Respawns are scheduled and validated by the server.

    if (message.type === 'startMatch') {
      if (matches.get(c.room)?.active) return;
      const roomPlayers = [...members(c.room), ...botsIn(c.room)];
      if (roomPlayers.length < 2) return send(ws, { type: 'error', message: 'At least 2 players are required to start' });
      if (c.mode !== 'ffa' && new Set(roomPlayers.map(p => p.team)).size < 2) {
        return send(ws, { type: 'error', message: 'At least two squads are required' });
      }
      for (const player of roomPlayers) { player.score=0;player.health=MAX_HEALTH;player.lastDamageAt=0;player.alive=true;player.matchKills=0;player.matchDeaths=0;player.matchWeaponKills={};player.matchAssists=0;player.matchShots=0;player.matchHits=0;player.damageContributors={};player.supportPoints=0;player.supportShield=0;player.supportReady=false;player.lastSupportAt=0;if(player.isBot){player.lastShot=Object.create(null);player.nav=null;player.combat={targetId:null,nextTargetScan:0,reactionUntil:0,nextFire:0};} }
      matches.set(c.room, { active: true, startedAt: Date.now(), duration: MATCH_SECONDS });
      broadcast(c.room, { type: 'matchStart', duration: MATCH_SECONDS, players: publicPlayers(c.room) });
      broadcast(c.room, { type: 'state', players: publicPlayers(c.room) });
      return;
    }
  });

  ws.on('error', err => console.warn('[websocket] client error:', err.message));

  ws.on('close', () => {
    if (!c.room) return;
    const room = c.room;
    clients.delete(c.id);
    if (members(room).length === 0) { matches.delete(room); roomBots.delete(room); }
    broadcastPlayers(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [room, match] of matches) {
    if (match.active && now - match.startedAt >= match.duration * 1000) endMatch(room);
    const all = combatants(room);
    if (match.active) {
      for (const player of all) {
        if (player.alive && player.health < MAX_HEALTH && now - player.lastDamageAt >= HEALTH_REGEN_DELAY_MS) {
          player.health = Math.min(MAX_HEALTH, player.health + HEALTH_REGEN_PER_SECOND * TICK_MS / 1000);
        }
      }
    }
    if (members(room).length) {
      const activePlayers = all.filter(player => player.alive);
      for (const bot of botsIn(room)) {
        if (!match.active || !bot.alive) continue;
        stepCombatBot(bot, activePlayers, TICK_MS / 1000, now);
      }
      broadcast(room, { type: 'state', players: publicPlayers(room) });
    }
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
}, 10000);
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});
wss.on('close', () => clearInterval(heartbeat));
