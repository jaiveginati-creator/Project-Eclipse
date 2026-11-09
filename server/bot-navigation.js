'use strict';

// Pick a nearby route waypoint the bot can begin moving toward without crossing
// a blocked segment. Used only by the non-target roaming recovery path.
function chooseRecoveryWaypoint({ map, bot, route, currentWaypoint, nearbyPlayers, movementBlocked }) {
  if (!Array.isArray(route) || route.length < 2) return currentWaypoint || 0;
  const candidates = [];
  for (let offset = 1; offset < route.length; offset++) {
    const index = (currentWaypoint + offset) % route.length;
    const [x, z] = route[index];
    const dx = x - bot.x, dz = z - bot.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.01) continue;
    const step = Math.min(2.5, distance);
    const next = { x: bot.x + dx / distance * step, y: bot.y, z: bot.z + dz / distance * step };
    if (movementBlocked(map, { x: bot.x, y: bot.y, z: bot.z }, next)) continue;
    const crowdCost = (nearbyPlayers || []).reduce((sum, player) => {
      if (!player.alive || player.id === bot.id) return sum;
      const separation = Math.hypot(player.x - x, player.z - z);
      return sum + Math.max(0, 3.5 - separation);
    }, 0);
    candidates.push({ index, score: distance + crowdCost * 1.6 });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates.length ? candidates[0].index : (currentWaypoint + 1) % route.length;
}

module.exports = { chooseRecoveryWaypoint };
