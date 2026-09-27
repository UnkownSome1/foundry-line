// Foundry Line game server: serves the game and runs co-op rooms over WebSocket.
//   node server/server.js            (PORT env, default 8080)
// One address does everything, which is what Render's free web service gives you.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocket } from './ws.js';
import { Room, makeCode } from './Room.js';
import { PROTO, MAX_PLAYERS } from '../src/shared/net/protocol.js';
import { SIM_DT } from '../src/shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const VERSION = '0.4';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };

// index.html is written for the claude.ai artifact host (which adds the document
// skeleton); wrap it into a normal page here so the same file serves both.
let playPage = null;
async function page() {
  if (playPage && process.env.NODE_ENV === 'production') return playPage;
  const body = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  // FOUNDRY_LOCAL_THREE=1 (tests / offline LAN play) serves three.js from test/vendor instead of the CDN
  const src = process.env.FOUNDRY_LOCAL_THREE ? body.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@[^"]+/, '/vendor/three.module.js') : body;
  playPage = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    + '<meta name="foundry-server" content="1"></head><body>\n' + src + '\n</body></html>';
  return playPage;
}

const rooms = new Map();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (p === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ server: 'foundry-line', version: VERSION, proto: PROTO, rooms: rooms.size, maxPlayers: MAX_PLAYERS }));
    return;
  }
  if (p === '/' || p === '/index.html' || p === '/play') {
    res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
    res.end(await page());
    return;
  }
  if (p === '/vendor/three.module.js' && process.env.FOUNDRY_LOCAL_THREE) {
    try { res.writeHead(200, { 'content-type': TYPES['.js'] }); res.end(await fs.readFile(path.join(ROOT, 'test/vendor/three.module.js'))); } catch (_) { res.writeHead(404); res.end(); }
    return;
  }
  // only the browser code is public
  if (!p.startsWith('/src/') || p.includes('..')) { res.writeHead(404); res.end('Not found'); return; }
  const file = path.join(ROOT, p);
  if (!file.startsWith(path.join(ROOT, 'src'))) { res.writeHead(404); res.end(); return; }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (_) { res.writeHead(404); res.end('Not found'); }
});

const ws = attachWebSocket(server, '/ws', (sock) => {
  ws.track(sock);
  let placed = false;
  const onFirst = (m) => {
    if (placed) return;
    if (m.t === 'host') {
      placed = true;
      sock.off('message', onFirst);
      const code = makeCode(rooms);
      const room = new Room(code, sock, m, log);
      rooms.set(code, room);
      log(`room ${code} opened by ${room.players.get('local')?.name} (${rooms.size} rooms)`);
    } else if (m.t === 'join') {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = rooms.get(code);
      if (!room || room.closed) { sock.send({ t: 'err', msg: `No co-op session with code ${code || '—'}. Check the code with the host.` }); return; }
      if (room.size >= MAX_PLAYERS) { sock.send({ t: 'err', msg: `That session is full (${MAX_PLAYERS} players).` }); return; }
      placed = true;
      sock.off('message', onFirst);
      room.add(sock, m);
    } else if (m.t === 'ping') {
      sock.send({ t: 'pong', ts: m.ts, st: 0 });
    }
  };
  sock.on('message', onFirst);
});

// Fixed 60 Hz simulation for every room, with catch-up if the event loop stalls.
let last = process.hrtime.bigint();
let acc = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9;
  last = now;
  let n = 0;
  while (acc >= SIM_DT && n < 6) {
    for (const [code, room] of rooms) {
      if (room.closed) { rooms.delete(code); continue; }
      room.tick();
    }
    acc -= SIM_DT;
    n++;
  }
  if (n === 6) acc = 0;
}, 4);

server.listen(PORT, '0.0.0.0', () => log(`Foundry Line server ${VERSION} on :${PORT} — open http://localhost:${PORT}/`));
