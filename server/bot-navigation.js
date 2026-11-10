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



// Grid A* navigation for combat pursuit. The caller supplies the same collision
// model used by the server, so a route never deliberately crosses a blocked edge.
function findPath({ map, start, goal, isBlocked, canMove = () => true, cellSize = 2, maxIterations = 6000 } = {}) {
  if (!start || !goal || typeof isBlocked !== 'function' ||
      !Number.isFinite(start.x) || !Number.isFinite(start.z) ||
      !Number.isFinite(goal.x) || !Number.isFinite(goal.z) ||
      !Number.isFinite(cellSize) || cellSize <= 0) return [];

  const extent = map === 'sublevel' ? 11 : 23;
  const width = extent * 2 + 1;
  const clampCell = value => Math.max(-extent, Math.min(extent, Math.round(value / cellSize)));
  const pointFor = (cx, cz) => ({ x: cx * cellSize, z: cz * cellSize });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  function nearestClear(point) {
    const baseX = clampCell(point.x), baseZ = clampCell(point.z);
    for (let radius = 0; radius <= 4; radius++) {
      let best = null, bestDistance = Infinity;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const cx = baseX + dx, cz = baseZ + dz;
          if (cx < -extent || cx > extent || cz < -extent || cz > extent) continue;
          const candidate = pointFor(cx, cz);
          if (isBlocked(candidate.x, candidate.z) || !canMove(point, candidate)) continue;
          const score = distance(point, candidate);
          if (score < bestDistance) { best = { cx, cz, ...candidate }; bestDistance = score; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  const startCell = nearestClear(start);
  const goalCell = nearestClear(goal);
  if (!startCell || !goalCell) return [];

  const startId = (startCell.cz + extent) * width + startCell.cx + extent;
  const goalId = (goalCell.cz + extent) * width + goalCell.cx + extent;
  const cellPath = [];

  if (startId === goalId) {
    cellPath.push(startCell);
  } else {
    const count = width * width;
    const costs = new Float64Array(count);
    costs.fill(Infinity);
    const parents = new Int32Array(count);
    parents.fill(-1);
    const closed = new Uint8Array(count);
    const heap = [];

    const heuristic = (cx, cz) => {
      const dx = Math.abs(goalCell.cx - cx), dz = Math.abs(goalCell.cz - cz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    const push = entry => {
      let index = heap.length;
      heap.push(entry);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (heap[parent].f <= entry.f) break;
        heap[index] = heap[parent];
        index = parent;
      }
      heap[index] = entry;
    };
    const pop = () => {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        let index = 0;
        while (true) {
          const left = index * 2 + 1, right = left + 1;
          if (left >= heap.length) break;
          let child = left;
          if (right < heap.length && heap[right].f < heap[left].f) child = right;
          if (heap[child].f >= last.f) break;
          heap[index] = heap[child];
          index = child;
        }
        heap[index] = last;
      }
      return first;
    };

    costs[startId] = 0;
    push({ id: startId, cx: startCell.cx, cz: startCell.cz, g: 0, f: heuristic(startCell.cx, startCell.cz) });
    const directions = [
      [1,0,1],[-1,0,1],[0,1,1],[0,-1,1],
      [1,1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,1,Math.SQRT2],[-1,-1,Math.SQRT2]
    ];
    let found = false, iterations = 0;

    while (heap.length && iterations < maxIterations) {
      const current = pop();
      if (closed[current.id] || current.g > costs[current.id] + 1e-9) continue;
      if (current.id === goalId) { found = true; break; }
      closed[current.id] = 1;
      iterations++;

      const from = pointFor(current.cx, current.cz);
      for (const [dx, dz, stepCost] of directions) {
        const cx = current.cx + dx, cz = current.cz + dz;
        if (cx < -extent || cx > extent || cz < -extent || cz > extent) continue;
        const next = pointFor(cx, cz);
        if (isBlocked(next.x, next.z)) continue;
        if (dx && dz &&
            (isBlocked(from.x + dx * cellSize, from.z) ||
             isBlocked(from.x, from.z + dz * cellSize))) continue;
        if (!canMove(from, next)) continue;
        const id = (cz + extent) * width + cx + extent;
        if (closed[id]) continue;
        const nextCost = current.g + stepCost;
        if (nextCost + 1e-9 >= costs[id]) continue;
        costs[id] = nextCost;
        parents[id] = current.id;
        push({ id, cx, cz, g: nextCost, f: nextCost + heuristic(cx, cz) });
      }
    }

    if (!found) return [];
    let cursor = goalId;
    while (cursor !== startId) {
      const cx = cursor % width - extent;
      const cz = Math.floor(cursor / width) - extent;
      cellPath.push({ cx, cz, ...pointFor(cx, cz) });
      cursor = parents[cursor];
      if (cursor < 0) return [];
    }
    cellPath.push(startCell);
    cellPath.reverse();
  }

  const result = [{ x: start.x, z: start.z }];
  const append = point => {
    const last = result[result.length - 1];
    if (distance(last, point) > 0.15) result.push({ x: point.x, z: point.z });
  };
  for (const cell of cellPath) append(cell);
  append({ x: goal.x, z: goal.z });
  for (let i = 1; i < result.length; i++) {
    if (!canMove(result[i - 1], result[i])) return [];
  }
  return result;
}

module.exports = { chooseRecoveryWaypoint, findPath };
