# PROJECT: ECLIPSE — Prototype 0.37.0

## Prototype 0.37.0 — Combat bot pathfinding
- Added server-side grid A* pathfinding for combat bots pursuing opponents behind map geometry.
- Navigation uses the same map collision volumes and swept movement checks as authoritative player movement.
- Bots periodically refresh paths as opponents move, and return to their existing tactical combat steering when line of sight is clear.
- Existing waypoint roaming, target selection, weapon behavior and squad logic are preserved.
- Ground-level route planning is covered by automated tests; elevated catwalk and ramp navigation remains a separate future milestone.

## Prototype 0.36.0 — BAZAAR connected floorplan
- Rebuilt BAZAAR as an original multi-route desert-city layout with connected courtyards, roofed passages, alleys and objective compounds.
- Mirrored passage doorways and wall collision on the server, updated the minimap, spawns and bot routes, and added route regression tests.


## Prototype 0.34.0 — STARFALL
- Replaced ORBITAL with STARFALL, an original space-station arena built around three distinct route families and several cross-links.
- Added a central transfer hub, west research gallery, east observatory/service gallery, north eclipse-viewing deck and south docking bay.
- Added new collision volumes, spawn points, bot navigation and a dedicated collision regression test.


## Prototype 0.33.0 — ORBITAL
- Added ORBITAL, an abandoned orbital station map set during the eclipse.
- New combat spaces include a central atrium, freight/cargo bay, winding maintenance spine, eclipse-facing observation gallery and engineering bay.
- Added elevated service gantries with walkable ramps for vertical route choices.
- Added station hull, cargo, bulkhead and cover collision volumes, spawn points, bot navigation route and map-selection support.
- Added Orbital collision regression coverage.


## Prototype 0.32.0 — Operator abilities
- Vanguard: Bulwark grants 40 temporary shield points.
- Recon: Sensor Sweep reveals nearby enemy positions on the tactical radar for five seconds.
- Assault: Overdrive increases movement speed for 4.5 seconds.
- Phantom: Phase Veil cloaks the operator from enemy models and radar for four seconds.
- Abilities have a 30-second cooldown and are validated by the multiplayer server. Assault's movement boost also has a higher server movement allowance only while active.
- Added keyboard (F), HUD and mobile controls, ability cooldown feedback, and class-specific descriptions in the deployment menu.

## Prototype 0.31.0 — Explosive ammo compatibility
- Added Explosive ammo as a selectable gunsmith ammo type for all weapons, including the Volt Pistol.
- Explosive ammo trades 15% direct damage for a small server-authoritative splash radius, allowing rapid-fire weapons to deal controlled area damage.
- Kept the RPG-7X and Shard Needler's built-in explosive behavior while allowing the same ammo type to be equipped on other weapons.

## Prototype 0.19.0 — Operator progression and gunsmith
- Added persistent operator profiles identified by a browser-generated profile ID.
- Multiplayer matches award 250 participation XP, 100 XP per elimination and a 200 XP winner bonus.
- Added player levels, career kills/deaths/wins/matches, and the latest 20 match records.
- Unlockable weapons: Nova Handcannon (Level 2), Heavy Arc Rifle (Level 3), Breach Shotgun (Level 4), Vector Burst Rifle (Level 5), Shard Needler (Level 6), and RPG-7X Launcher (Level 8).
- Recon, Assault and Phantom armour configurations unlock at Levels 3, 6 and 9. Weapon camos unlock at Levels 4, 7 and 10.
- Weapon-specific XP unlocks optics, barrels, magazines, stocks and underbarrel parts. The workshop lets players name, save and equip custom builds.
- Attachments affect weapon handling, range, magazine capacity, damage/cooldown and first-person weapon appearance.
- Server validates weapon/operator unlocks and attachment XP requirements before accepting a loadout.

### Progression and storage notes
- A multiplayer match awards XP only when the server ends the match. Training Range sessions do not award XP.
- Operator profiles and match history are written to `server/profiles.json`; the profile ID is stored in browser local storage. This is a lightweight prototype identity system, not a secure account/login system.
- The profile file persists on hosts that retain their filesystem. Free ephemeral hosting can reset local files during redeploys/restarts; durable cloud-wide persistence needs a database-backed store.
- The profile ID should be treated as private because it identifies the local progression profile.

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

The current target is stable small matches (2–4 connected human players). Optional server-authoritative combat bots can fill a lobby; larger lobby limits are present but are not a claim of tested scale.

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
- Server movement and line-of-sight use conservative AABB volumes for major structures. Small decorative props, rounded surfaces and every minor collision detail are not represented; ramps and elevated catwalk traversal still need browser playtesting.
- Movement remains client-predicted. The server rejects swept paths through modeled blockers and the client reconciles large position drift, but this is not a fully server-simulated physics engine.
- Combat bots now use high-accuracy targeting, weapon switching, movement, jumping/crouching, support and respawn. Navigation uses tactical steering over existing waypoints rather than a full navmesh; advanced player actions such as sliding and mantling are not yet fully simulated by bots.
- Ammo/reload inventory remains client-side; production-grade anti-cheat, account authentication and reconnect recovery are not implemented.
- The operator model and animations are procedural Three.js geometry/animation, not a professionally authored skeletal character asset. Remote reload animation and detailed weapon animation replication are future work.
- Automated tests cover four connected clients and bot-vs-player damage, but browser rendering, ramp traversal and live internet multiplayer across separate connections still require manual playtesting.

## Verification
- GitHub Actions runs `npm install`, server/client/map-collision syntax checks, `npm test` and `npm run build`.
- Six automated tests cover map collision, wall-shot blocking, Industrial loading-bay openings, four-client match flow, health regeneration, disconnect cleanup and combat bot damage/elimination.
- The Vite build completes successfully; it still reports a non-blocking JavaScript chunk-size warning above 500 KB.
- Browser rendering, advanced movement and separate-internet hit registration remain unverified.


## Developer testing console (v0.20.0)

Open the in-game developer console with **F2** or **~**. Health, ammo, redeploy and training-target controls are available for local testing. Progression controls (grant XP, max level, max weapon XP, unlock everything and reset profile) require the server environment variable `ECLIPSE_DEV_MODE=true` and an active server connection.

**Security:** developer mode is disabled by default. Only enable it on a private/local test server; anyone who can connect while it is enabled can use the progression commands. Never enable it on a public production server.


## 0.35.0 — BAZAAR map

- Replaced STARFALL with BAZAAR, an original sunlit old-town market district with sandstone architecture, courtyards, stalls, alleys and a central fountain.
- Rebuilt the minimap to show BAZAAR's building footprints, central square, market stalls and raised terrace.
- Added matching server collision, player spawns and bot navigation for the new map.
- Removed the eclipse/space sky treatment while BAZAAR is active.
