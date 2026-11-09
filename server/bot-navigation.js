'use strict';

// Select a reachable waypoint for a roaming bot that has stopped progressing.
// A short swept-path probe avoids choosing a route point directly behind a wall.
function chooseRecoveryWaypoint({ map, bot, route, currentWaypoint, nearbyPlayers, movementBlocked }) {
  if (!Array.isArray(route) || route.length < 2) return currentWaypoint || 0;
  const candidates = [];
  for (let offset = 1; offset < route.length; offset++) {
    const index = (currentWaypoint + offset) % route.length;
    const [x, z] = route[index];
    const dx = x - bot.x, dz = z - bot.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.01) continue;
    const probeDistance = Math.min(2.75, distance);
    const next = {
      x: bot.x + dx / distance * probeDistance,
      y: bot.y,
      z: bot.z + dz / distance * probeDistance
    };
    if (movementBlocked(map, { x: bot.x, y: bot.y, z: bot.z }, next)) continue;
    const crowdCost = (nearbyPlayers || []).reduce((sum, player) => {
      if (!player.alive || player.id === bot.id) return sum;
      const separation = Math.hypot(player.x - x, player.z - z);
      return sum + Math.max(0, 4.5 - separation);
    }, 0);
    candidates.push({ index, score: distance + crowdCost * 1.8 });
  }
  candidates.sort((a, b) => a.score - b.score);
  // If every route probe is blocked, advance the route index so the bot does
  // not remain permanently pinned to the same waypoint.
  return candidates.length ? candidates[0].index : (currentWaypoint + 1) % route.length;
}

module.exports = { chooseRecoveryWaypoint };
