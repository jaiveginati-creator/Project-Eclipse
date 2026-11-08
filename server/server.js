const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

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
const ATTACHMENT_LEVELS = {ammoType:{standard:0,incendiary:0,shock:0,rapid:0,heavy:0},barrel:{standard:0,extended:250,heavy:650},magazine:{standard:0,extended:350,quick:550},stock:{standard:0,tactical:450,weighted:750},underbarrel:{none:0,grip:300,laser:700}};
const DEFAULT_BUILD = {name:'FIELD STANDARD',ammoType:'standard',barrel:'standard',magazine:'standard',stock:'standard',underbarrel:'none',camo:'standard'};
let profileStore={};try{profileStore=JSON.parse(fs.readFileSync(PROFILE_FILE,'utf8'));}catch{profileStore={};}
function levelForXP(xp){let level=1;for(let i=1;i<LEVEL_XP.length;i++){if(xp>=LEVEL_XP[i])level=i+1;else break;}return level;}
function newProfile(id){return{id,xp:0,level:1,stats:{matches:0,kills:0,deaths:0,wins:0},weaponXP:{},builds:{},matchHistory:[],createdAt:Date.now(),updatedAt:Date.now(),lastMatchXP:0};}
function getProfile(id){if(!profileStore[id])profileStore[id]=newProfile(id);const p=profileStore[id];p.stats={matches:0,kills:0,deaths:0,wins:0,...(p.stats||{})};p.weaponXP=p.weaponXP||{};p.builds=p.builds||{};p.matchHistory=Array.isArray(p.matchHistory)?p.matchHistory:[];p.level=levelForXP(Number(p.xp)||0);return p;}
function saveProfiles(){try{const temp=PROFILE_FILE+'.tmp';fs.writeFileSync(temp,JSON.stringify(profileStore));fs.renameSync(temp,PROFILE_FILE);}catch(error){console.error('[profiles] save failed:',error.message);}}
function unlockedWeapon(profile,id){return(WEAPON_LEVELS[id]||99)<=profile.level;}
function sanitizeBuild(profile,raw={}){const xp=Number(profile.weaponXP?.[raw.weaponId])||0,result={...DEFAULT_BUILD,name:String(raw.name||'FIELD STANDARD').replace(/[<>]/g,'').slice(0,22)};for(const slot of Object.keys(ATTACHMENT_LEVELS)){const choice=raw[slot];if(Object.prototype.hasOwnProperty.call(ATTACHMENT_LEVELS[slot],choice)&&xp>=ATTACHMENT_LEVELS[slot][choice])result[slot]=choice;}const camoLevels={standard:1,arctic:4,ember:7,void:10};if(camoLevels[raw.camo]&&profile.level>=camoLevels[raw.camo])result.camo=raw.camo;return result;}
function sanitizeBuilds(profile,raw={}){const result={};for(const id of Object.keys(WEAPONS))result[id]=sanitizeBuild(profile,{...(raw[id]||profile.builds?.[id]||{}),weaponId:id});return result;}
function weaponStatsFor(player,id){const stats={...WEAPONS[id]},build=player.weaponBuilds?.[id]||{},ammoType=build.ammoType||'standard';if(build.barrel==='extended')stats.range*=1.18;if(build.barrel==='heavy'){stats.damage=Math.round(stats.damage*1.10);stats.cooldown=Math.round(stats.cooldown*1.12);}if(build.magazine==='quick')stats.cooldown=Math.round(stats.cooldown*.93);if(build.stock==='tactical')stats.cooldown=Math.round(stats.cooldown*.94);if(['rocket','needler'].includes(id)){stats.splashRadius=stats.radius;}if(ammoType==='explosive'){stats.damage=Math.round(stats.damage*.85);}if(ammoType==='incendiary'){stats.damage=Math.round(stats.damage*1.12);stats.range*=.9;}if(ammoType==='shock'){stats.damage=Math.round(stats.damage*.92);stats.range*=1.1;}if(ammoType==='rapid'){stats.damage=Math.round(stats.damage*.72);stats.cooldown=Math.max(55,Math.round(stats.cooldown*.72));}if(ammoType==='heavy'){stats.damage=Math.round(stats.damage*1.3);stats.cooldown=Math.round(stats.cooldown*1.22);}return stats;}

const DIST_DIR = path.join(__dirname, '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// One public HTTP(S) service hosts the built client and its WebSocket endpoint.
// Render (or another Node host) supplies PORT and terminates HTTPS in front of this process.
const httpServer = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'project-eclipse', version: '0.26.0', players: clients.size, rooms: matches.size, uptimeSeconds: Math.floor(process.uptime()) }));
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
  return [...members(room).map(c => ({
    id: c.id, name: c.name, mode: c.mode, map: c.map, team: c.team, isBot:false,
    x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, score: c.score,
    health: c.health, alive: c.alive, moving: c.moving, crouching: c.crouching, weapon: c.weapon, operator: c.operator, primary: c.primary, secondary: c.secondary, equipment: c.equipment, supportPoints:c.supportPoints||0, supportShield:c.supportShield||0
  })), ...botsIn(room).map(bot => ({ ...bot }))];
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
  const results=[...roomMembers.map(c=>{const shots=c.matchShots||0,hits=c.matchHits||0;return {id:c.id,name:c.name,team:c.team,score:c.score,kills:c.matchKills||0,deaths:c.matchDeaths||0,assists:c.matchAssists||0,shots,hits,accuracy:shots?Math.min(100,Math.round(hits/shots*100)):0};}),...botsIn(room).map(bot=>({id:bot.id,name:bot.name,team:bot.team,score:bot.score||0,kills:0,deaths:0,assists:0,shots:0,hits:0,accuracy:0,isBot:true}))].sort((a,b)=>b.score-a.score||b.kills-a.kills);
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
  if (map === 'sublevel') { const point = compactSpawns[slot % compactSpawns.length]; return { x: point[0], y: 1.7, z: point[1] }; }
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
  const weapon = weaponStatsFor(shooter,weaponId);
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

  const splashRadius=weapon.splashRadius||((weaponId==='needler'||weaponId==='rocket')?weapon.radius:0);
  let best = null;
  for (const target of members(shooter.room)) {
    if (target.id === shooter.id || !target.alive) continue;
    if (shooter.mode !== 'ffa' && target.team === shooter.team) continue;
    const hit = distanceRayToVerticalCapsule(origin, direction, target);
    if (!hit || hit.along > weapon.range) continue;
    const direct=hit.distance <= (weapon.hitRadius || 0.48);
    // Rockets can detonate on a close pass, not only on a perfect capsule hit.
    const rocketProximity=weaponId==='rocket'&&hit.distance<=splashRadius;
    if (!direct&&!rocketProximity) continue;
    if (!best || hit.along < best.along) best = { target, along: hit.along, distance: hit.distance, rayY: hit.rayY, highY: hit.highY, direct };
  }
  if (!best) return;

  // Built-in explosive weapons apply server-authoritative splash damage.
  const impact = {
    x: origin.x + direction.x * best.along,
    y: origin.y + direction.y * best.along,
    z: origin.z + direction.z * best.along
  };
  const affected = splashRadius
    ? members(shooter.room).filter(target => {
        if (target.id === shooter.id || !target.alive) return false;
        if (shooter.mode !== 'ffa' && target.team === shooter.team) return false;
        return Math.hypot(target.x - impact.x, target.y - impact.y, target.z - impact.z) <= splashRadius;
      }).map(target => ({
        target,
        distance: Math.hypot(target.x - impact.x, target.y - impact.y, target.z - impact.z),
        direct: target.id === best.target.id && best.direct
      }))
    : [{ target: best.target, distance: best.distance || 0, direct: true }];

  if(affected.length)shooter.matchHits=(shooter.matchHits||0)+1;
  for (const hit of affected) {
    const target = hit.target;
    const falloff = splashRadius ? Math.max(.25, 1 - hit.distance / splashRadius * .75) : 1;
    const damage = Math.max(1, Math.round(weapon.damage * falloff));
    const headshot = hit.direct && best.direct && best.distance <= (weapon.hitRadius || 0.48) && best.rayY >= best.highY - .22;
    target.damageContributors=target.damageContributors||{};target.damageContributors[shooter.id]=Date.now();
    const absorbed=Math.min(target.supportShield||0,damage);target.supportShield=Math.max(0,(target.supportShield||0)-absorbed);
    target.health = Math.max(0, target.health - (damage-absorbed));
    target.lastDamageAt = Date.now();
    const eliminated = target.health <= 0;
    send(shooter.ws, {
      type: 'hitConfirm', targetId: target.id, targetName: target.name,
      damage, targetHealth: target.health, weapon: weaponId, eliminated, headshot
    });
    send(target.ws, {
      type: 'damaged', sourceId: shooter.id, sourceName: shooter.name,
      damage, health: target.health, eliminated, headshot
    });

    if (eliminated) {
      target.alive = false;
      shooter.score += 1;
      shooter.matchKills=(shooter.matchKills||0)+1;shooter.matchWeaponKills=shooter.matchWeaponKills||{};shooter.matchWeaponKills[weaponId]=(shooter.matchWeaponKills[weaponId]||0)+1;target.matchDeaths=(target.matchDeaths||0)+1;
      for(const [helperId,at] of Object.entries(target.damageContributors||{})){if(helperId!==shooter.id&&Date.now()-at<12000){const helper=members(shooter.room).find(p=>p.id===helperId);if(helper)helper.matchAssists=(helper.matchAssists||0)+1;}}
      shooter.supportPoints=(shooter.supportPoints||0)+100;if(shooter.supportPoints>=300&&!shooter.supportReady){shooter.supportReady=true;send(shooter.ws,{type:'supportReady',points:shooter.supportPoints});}
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
        const spawn = spawnForSlot(Math.floor(Math.random() * 8), current.map);
        current.x = spawn.x; current.y = spawn.y; current.z = spawn.z;
        current.health = MAX_HEALTH; current.lastDamageAt = 0; current.alive = true; current.supportShield=0; current.damageContributors={};
        current.moving = false; current.crouching = false;
        send(current.ws, { type: 'respawned', x: current.x, y: current.y, z: current.z, health: current.health });
        sendRoomState(room, 'players');
      }, RESPAWN_DELAY_MS);
    }
  }
  sendRoomState(shooter.room, 'scoreUpdate');
}

wss.on('connection', ws => {
  const c = {
    ws, id: crypto.randomUUID().slice(0, 8), name: 'OPERATOR',
    mode: 'ffa', map: 'district', room: null, team: null,
    x: 0, y: 1.7, z: 7, yaw: 0, pitch: 0, score: 0, health: MAX_HEALTH, alive: true,
    moving: false, crouching: false, weapon: 'pulse', operator: 'vanguard', primary: 'pulse', secondary: 'volt', equipment: 'shield',
    profileId:null, profile:null, weaponBuilds:{}, matchKills:0, matchDeaths:0, matchWeaponKills:{}, matchAssists:0, matchShots:0, matchHits:0, damageContributors:{}, supportPoints:0, supportShield:0, supportReady:false, lastSupportAt:0,
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
          const bot = { id:'bot-'+(i+1), name:BOT_NAMES[i % BOT_NAMES.length], mode, map, team:null, x:point.x, y:1.7, z:point.z, yaw:0, pitch:0, score:0, health:MAX_HEALTH, alive:true, moving:true, crouching:false, weapon:'', operator:'vanguard', primary:'', secondary:'', equipment:'', supportPoints:0, supportShield:0, isBot:true, phase:i*1.7, anchorX:point.x, anchorZ:point.z };
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
      if (distance <= 10.5 * elapsed + 0.35) { c.x = nextX; c.z = nextZ; }
      const nextY = clamp(finite(message.y, c.y), 1.0, 7.5);
      if (Math.abs(nextY - c.y) <= 14 * elapsed + 0.5) c.y = nextY;
      c.yaw = finite(message.yaw, c.yaw);
      c.pitch = clamp(finite(message.pitch, c.pitch), -1.4, 1.4);
      c.moving = Boolean(message.moving);
      c.crouching = Boolean(message.crouching);
      c.weapon = [c.primary,c.secondary].includes(message.weapon) ? message.weapon : c.weapon;
      c.lastMove = now;
      return;
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
      const squad=members(c.room).filter(p=>p.alive&&(c.mode==='ffa'?p.id===c.id:p.team===c.team));
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
      for (const player of roomPlayers) { player.score=0;player.health=MAX_HEALTH;player.lastDamageAt=0;player.alive=true;player.matchKills=0;player.matchDeaths=0;player.matchWeaponKills={};player.matchAssists=0;player.matchShots=0;player.matchHits=0;player.damageContributors={};player.supportPoints=0;player.supportShield=0;player.supportReady=false;player.lastSupportAt=0; }
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
    if (match.active) {
      for (const player of members(room)) {
        if (player.alive && player.health < MAX_HEALTH && now - player.lastDamageAt >= HEALTH_REGEN_DELAY_MS) {
          player.health = Math.min(MAX_HEALTH, player.health + HEALTH_REGEN_PER_SECOND * TICK_MS / 1000);
        }
      }
    }
    if (members(room).length) {
      for (const bot of botsIn(room)) {
        if (!match.active) continue;
        bot.phase += TICK_MS / 1000 * (0.45 + (Number(bot.id.slice(4)) % 4) * 0.08);
        const radius = bot.map === 'sublevel' ? 2.2 : 3.2;
        bot.x = clamp(bot.anchorX + Math.cos(bot.phase) * radius, -MAP_BOUNDS + 2, MAP_BOUNDS - 2);
        bot.z = clamp(bot.anchorZ + Math.sin(bot.phase) * radius, -MAP_BOUNDS + 2, MAP_BOUNDS - 2);
        bot.yaw = bot.phase + Math.PI / 2;
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
