# PROJECT: ECLIPSE — Prototype 0.4.0

A browser-based atmospheric multiplayer FPS prototype with Free-for-All, Duos and Trios, two procedural maps, solo training, and a Node.js WebSocket service.

## Requirements
- Node.js 20 or newer
- A modern desktop browser with WebGL

## Run locally
```bash
npm install
npm start
```
Open the Vite URL printed in the terminal (usually `http://localhost:5173`). The server runs on port `3001`; the client auto-connects to it. For a local multiplayer test, open the Vite URL in multiple browser windows.

## Deploy online multiplayer
The project includes `render.yaml` for a single-service Render deployment. The same Node process serves the built website over HTTPS and the WebSocket multiplayer endpoint over secure WebSockets (`wss://`).

1. Push the complete project folder to a GitHub repository.
2. Sign in to Render and choose **New → Blueprint**.
3. Connect the repository containing `render.yaml` and deploy the `project-eclipse` service.
4. Wait for the service health check at `/health` to pass.
5. Open the public `https://...onrender.com` address. The client automatically selects `wss://` on the same host.
6. Share that public URL with friends. Everyone selects the same mode and map, deploys, and joins the same lobby.

Render's free service may sleep when inactive and can take a short time to wake. This prototype currently uses open public lobbies keyed by mode and map; it does not yet have accounts, private invite codes, persistent matchmaking, or production-grade anti-cheat. For a real public launch, add room codes, rate limiting, authoritative collision/line-of-sight checks, and persistent hosting.

## Modes and small-match testing
- **Free-for-All:** individual scoring.
- **Duos:** squads of two.
- **Trios:** squads of three.

The server balances Duos/Trios into the least-populated squads. Small 2–4 player sessions are the current target; larger caps are not a claim of tested scale.

## Controls
- WASD: move
- Mouse: look
- Left click: fire fictional energy-pulse tagger
- Space: jump (with gravity and ramp elevation)
- Shift: sprint
- Ctrl: crouch
- 1 / 2 / 3: switch weapons
- R: reload active weapon
- Esc: pause

Click **Enter Solo Training** to explore without connecting to multiplayer.

## Current implementation notes
- The maps have a tighter block layout, additional low cover and hiding pockets, and walkable ramps for vertical routes.
- First-person weapon view models are attached to the camera, with movement sway and firing recoil.
- Three fictional energy weapons: balanced Pulse Carbine, rapid-fire Volt Pistol, and slower Heavy Arc Rifle. Use 1/2/3 to switch. Weapon-specific firing cooldowns are also checked by the server.
- DISTRICT now has road markings, pavements, planted areas, trees, street furniture, lit facade details, AC units and drain details.
- INDUSTRIAL now has warehouse lighting, loading-bay details, safety markings, cable trays, vents and container details.
- The eclipse halo/corona and atmospheric lighting remain part of the scene.
- The server validates pulse-tag hits from shot direction, enforces a fire cooldown, rejects client-supplied target IDs, applies basic movement-speed bounds, balances small Duos/Trios sessions and validates match starts.
- Multiplayer is still a prototype: player movement is not fully server-authoritative against map collision, and server-side line-of-sight/occlusion validation is not implemented. Hit detection is simplified and does not yet model all map geometry.
- Persistent accounts, private matchmaking, advanced animations, final audio, full team-based victory logic, and production-grade anti-cheat are not implemented.

## Verification status for 0.4.0
- Client/server syntax and package JSON checks pass.
- Vite production build could not be run in this environment because dependencies are not installed (`vite: not found`); run `npm install` before testing.
- Browser rendering, jump/ramp feel, weapon view-model alignment, and live multiplayer weapon sync still need an in-browser test.
- `node --check server/server.js`: passed.
- `node --check client/src/main.js`: passed.
- `package.json` JSON parse: passed.
- Dependency installation/build: not verified in this environment; `npm install` timed out.
- Browser rendering and live internet multiplayer: not verified. Deploy to a Node host and test with at least two separate internet connections before calling online play functional.
