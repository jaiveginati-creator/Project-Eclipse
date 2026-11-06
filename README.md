# PROJECT: ECLIPSE — Prototype 0.13.0

## Prototype 0.13.0 — Combat & Atmosphere
- Added pre-deployment primary/secondary weapon selection and three field-equipment choices, saved locally between visits.
- Added the Shard Needler, RPG-7X Launcher, Breach Shotgun and Vector Burst Rifle alongside the Pulse Carbine, Volt Pistol and Heavy Arc Rifle.
- Added server-validated damage profiles for the expanded arsenal, including explosive splash falloff for the Needler and rocket launcher.
- Added drifting dust, procedural surface-detail textures, brighter shadow tuning, projectile impact particles, weapon sound cues and synthesized map ambience.
- Added Q-key equipment activation: Shield Cell restores health in multiplayer, while Recon Pulse and Ammo Pack provide field utility; equipment use is rate-limited by the server.

## Previous Prototype 0.9.0 — Complete Visual Rebuild

A browser-based multiplayer FPS prototype with two rebuilt science-fiction arenas, rounded powered-armor operators, solo training, and a Node.js WebSocket service.

## Prototype 0.9.0 — Complete Visual Rebuild

- Rebuilt DISTRICT as a futuristic orbital settlement with a circular transit plaza, curved illuminated towers, skybridges, habitat modules, landing pads, holographic beacons and new routes.
- Rebuilt INDUSTRIAL as a spacecraft shipyard with massive hangars, twin gantry cranes, a central reactor column, cargo lanes, pipe racks, pressure vessels and walkable catwalks.
- Replaced the angular placeholder operator with rounded powered armour: smooth helmet, gold visor, sculpted chest, curved shoulder pauldrons, articulated gauntlets, greaves and backpack power unit.
- Retained multiplayer protocol, weapons, interpolation, minimap bounds, health regeneration and match flow.

## Previous 0.8.0 visual pass (superseded)

- Expand DISTRICT with storefronts, covered market stalls, rooftop utility details, street furniture, roadside barriers, planters, trees and additional environmental silhouettes.
- Expand INDUSTRIAL with a large gantry landmark, fenced generator compound, more cargo variety, cable spools, loading-area details, stair/ramp access and additional industrial lighting.
- Upgrade remote operator models with layered armor, shoulder protection, helmet modules, backpack/radio, chest rig, forearm guards, knee protection and more detailed boots.
- Preserve the existing two-map selection, movement, collision system, multiplayer state format and minimap coordinate bounds.

## Requirements
- Node.js 20 or newer
- A modern desktop browser with WebGL
- GitHub account and a Node hosting account for public internet matches

## Run locally
```bash
npm install
npm start
```
Open the Vite URL printed in Terminal (normally `http://localhost:5173`). Vite serves the game and the multiplayer WebSocket server runs on port `3001`. Open the Vite URL in two or more browser windows to test a shared local lobby.

If port 3001 is already occupied, find the process with `lsof -i :3001` and stop only that PID with `kill <PID>` before restarting.

## Set up public online multiplayer
The game is configured for a single public web service: the Node process serves the built website and the WebSocket endpoint on the same host. HTTPS websites automatically use secure WebSockets (`wss://`). The included `render.yaml` is a deployment blueprint for Render or a compatible Node host.

### Deploy using GitHub + Render
1. Extract the project ZIP.
2. Create a new GitHub repository named `project-eclipse`.
3. Put the **contents** of this `project-eclipse` folder at the repository root. The root must contain `package.json`, `render.yaml`, `index.html`, `client/`, and `server/`.
4. Commit and push the files to GitHub.
5. Sign in to Render, choose **New → Blueprint**, and connect the repository.
6. Render reads `render.yaml`, installs dependencies, runs `npm run build`, and starts `npm run start:production`.
7. Wait for deployment to finish. Open `https://<your-service>.onrender.com/health`; a healthy response includes `"ok":true`.
8. Open the public HTTPS game URL. The server field auto-detects the same-host secure WebSocket URL. Share that URL with friends.

If your host asks for a start command manually, use `npm run start:production`. It must support long-lived WebSocket connections and set the `PORT` environment variable. Do not use a static-only website host for the multiplayer server.

### How public matchmaking works right now
- Players are placed into an open lobby based on the selected mode and map.
- Everyone must use the same public website URL, mode and map.
- FFA, Duos and Trios are supported; Duos/Trios teams are balanced by the server.
- At least two players are required. A player in the lobby can request the match start.
- The current system has public lobbies, not private invite codes or account-based matchmaking. Players choosing the same mode/map share that room.
- Free hosting may sleep when idle; the first connection after inactivity can take a little while.

## Modes
- **Free-for-All:** individual scoring.
- **Duos:** two-player squads.
- **Trios:** three-player squads.

The current target is stable small matches (2–4 connected players). Larger lobby limits are present in the prototype but are not a claim of tested scale.

## Controls
- WASD: move
- Mouse: look
- Left click: fire fictional energy-pulse tagger
- Space: jump
- Shift: sprint
- Ctrl: crouch
- 1: primary weapon; 2: secondary sidearm\n- Q: activate selected field equipment
- R: reload
- Esc: pause

Click **Enter Solo Training** to explore without connecting to multiplayer.

## 0.5.0 changes
- INDUSTRIAL has been rebuilt as a compact freight and logistics yard with four accessible loading-bay warehouses, interior storage racks, corrugated cladding, loading docks, perimeter fencing, shipping-container lanes, pallet stacks, cable drums, maintenance cabinets, pipe bridges, hazard markings, work lights and service details.
- Added two raised maintenance catwalks with ramp access. Walkway surfaces are included in local floor-height calculation so players can stand on them.
- Multiplayer player snapshots now include vertical position, allowing remote operators to appear at the correct height while jumping or using raised routes.
- Client movement updates are sent at 20 Hz instead of every rendered frame to reduce unnecessary network traffic.
- Improved WebSocket connection timeout/cleanup and health-check reporting.
- The local Vite address on port 5173 automatically selects the local WebSocket service on port 3001; deployed HTTPS uses secure WebSockets on the same host.

## 0.6.0 changes — multiplayer combat and operator presentation
- Server-authoritative pulse hit resolution: clients send shot direction/origin, while the server chooses the target and applies damage. Client-supplied target IDs are ignored.
- Added server-side vertical capsule hit regions that follow remote player height and crouch state.
- Added weapon-specific server cooldowns and damage values for Pulse Carbine, Volt Pistol and Heavy Arc Rifle.
- Added health replication, hit confirmation, damage feedback, elimination scoring and timed server-controlled respawns.
- Added separated initial spawn points so players do not begin at exactly the same coordinates.
- Replaced the placeholder capsule remote player with a multi-part operator model: helmet/visor, armor, vest, backpack, limbs, boots, held weapon, callsign and ground shadow.
- Added remote movement interpolation, walk/run limb animation, crouch scaling and remote firing feedback.
- Replicated movement, vertical position, crouch state and equipped weapon at 20 Hz.

## 0.7.0 changes — recovery and connection cleanup
- Added server-authoritative health regeneration during active multiplayer matches: after 4 seconds without taking damage, living players recover 12 health per second up to 100.
- Health regeneration is replicated through the existing player-state updates, so every client sees the same health value.
- Tightened WebSocket heartbeat checks from 30 seconds to 10 seconds. A connection that misses a heartbeat is terminated sooner, allowing the existing close handler to remove its player from the lobby and refresh the player list.
- Added per-connection WebSocket error logging to help diagnose abnormal disconnects.

- Added a live top-right tactical minimap: the local operator is shown with a facing arrow, opponents appear as red contacts, and squadmates appear cyan in Duos/Trios.
- Added an impassable perimeter boundary on both maps, enforced by client collision and matching server-side movement bounds.

## Current implementation limits
- The server validates shot direction, origin proximity, range, cooldown and player hit regions, but server-side line-of-sight against every map wall/prop is not yet implemented. Some shots may still pass through cover.
- Player movement is not fully server-authoritative against map collision; a modified client could still attempt invalid movement within the broad server bounds.
- Ammo/reload inventory is currently client-side; production-grade anti-cheat, private room codes, accounts, reconnect recovery and persistent stats are not implemented.
- The operator model and animations are procedural Three.js geometry/animation, not a professionally authored skeletal character asset. Remote reload animation and detailed weapon animation replication are future work.
- Browser rendering, actual hit registration under varied latency, and live internet multiplayer must still be tested with two or more clients on separate internet connections.

## Verification
- `node --check server/server.js`: passed.
- `node --check client/src/main.js`: passed.
- `package.json` parse: passed.
- Full Vite production build and browser rendering: pending dependency installation and browser testing.
- Live internet multiplayer and hit registration: not yet independently tested; deploy this build and test with two separate clients before treating combat as verified.
