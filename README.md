# Foundry Line — build 0.4 (co-op update)

Co-op factory shooter: three.js browser client + a dependency-free Node game server.

## What's in 0.4
- **Two-player co-op.** The host picks one of their companies; a friend joins with a
  4-letter code. The factory runs on the server (authoritative), each client predicts
  its own movement and reconciles with the server, and the other player is drawn from
  interpolated snapshots with their shots, reloads and name tag.
- **Host's save.** The server sends the host's browser a save every 10 s and when the
  session ends; the guest's inventory and wallet are kept in that save under their name.
- **Main menu:** live 3D plant behind it with camera shots per screen, company save
  slots (3), co-op host/join, profile (name + suit colour with a 3D preview), settings
  (sensitivity, aiming sensitivity, invert Y, FOV, resolution, shadows, view bob, FPS
  counter, master/effects/music volume, crosshair style/colour, hints, damage numbers),
  career stats, patch notes, tips, procedural menu music. Esc opens a pause/session menu
  with the invite code.
- **Progression:** company levels (XP = money from selling goods you made + contract
  bonuses) with a cash grant each level, +5 % sale price per level, free delivery (Lv 3),
  faster van (Lv 4), better scrap price (Lv 5), 3 contract slots (Lv 6); 15 goals that pay
  cash. Easier start ($900), better prices for made goods, faster crafting.
- **Saves keep goods in transit:** undelivered orders, floor items and cage stacks the van
  hasn't loaded yet.

## Run it
- **Online (co-op):** see [DEPLOY.md](DEPLOY.md) — GitHub + Render's free plan, no build.
- **Locally:** `node server/server.js` → open `http://localhost:8080` (Node 20+).
- `index.html` alone (e.g. the claude.ai artifact) runs solo; co-op needs the server.

## Controls
WASD move · Shift sprint · C crouch · Space jump · LMB fire · RMB aim · R reload ·
E interact / pick up · Tab or I inventory · B build (R rotate, LMB place, B next kit,
Q cancel) · F inspect · V third person · H help · Esc menu.

## Layout
- `src/shared/` — pure JS, no DOM or three.js; the server runs it unchanged.
  - `World.js`, `mapLayout.js`, `PlayerMovement.js` (bunny-hop capped), `vehiclePush.js`
  - `WeaponState.js`, `weapons.js` (recoil + kick tuning), `hitscan.js`
  - `factory/FactorySim.js` authoritative factory; `factory/items.js` all balancing;
    `factory/progression.js` levels, perks, goals; `factory/truck.js`, `factory/layout.js`, `factory/Inventory.js`
  - `net/protocol.js` wire format, snapshot/replica encoders shared by server and client
- `server/` — `server.js` (static files + rooms, 60 Hz), `Room.js` (one co-op session),
  `ws.js` (RFC 6455 WebSocket, no dependencies)
- `src/client/` — rendering, animation, audio, UI
  - `main.js` game loop, sessions, prediction/reconciliation, menu camera
  - `net/Session.js` LocalSession / NetSession; `net/RemotePlayers.js`
  - `ui/Menu.js` main + pause menu; `ui/Panels.js` inventory/terminal/machine panels; `ui/HUD.js`
  - `Storage.js` company slots, settings, career (localStorage, all guarded)
  - `factory/*` machine/item/vehicle models, build mode, factory view; `models/*`, `fp/*`, `fx/*`, `world/*`, `gfx/*`
- `render.yaml` Render Blueprint · `DEPLOY.md` setup guide

## Tests
`npm test` runs:
- `test/shared.test.mjs` — world, movement (incl. bunny-hop cap), weapons, hitboxes
- `test/factory.test.mjs` — factory loop, placement, belts, van 80/20, contracts,
  reset exploit, progression rules, saves with goods in transit
- `test/net.test.mjs` — starts the server; host + guest over WebSocket: joining, full
  session, prediction vs server, speed-hack guard, commands, cheat guards, save hand-back

Also: `node test/load.mjs` (server CPU/bandwidth), `python3 test/coop.py` (two headless
browsers playing together), `python3 test/game.py <scenario.json>` (single-browser scenarios).
