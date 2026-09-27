// Minimal RFC 6455 WebSocket server on top of node:http — no npm dependencies, so the
// game server deploys anywhere Node runs (Render's free tier included) with zero install.
// Supports text frames, fragmentation, ping/pong keep-alive and clean close.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 4 * 1024 * 1024; // host saves with big factories stay well under this

export class Socket extends EventEmitter {
  constructor(sock, remote) {
    super();
    this.sock = sock;
    this.remote = remote;
    this.buf = Buffer.alloc(0);
    this.frags = null;
    this.open = true;
    this.lastSeen = Date.now();
    sock.setNoDelay(true);
    sock.on('data', (d) => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }

  send(obj) {
    if (!this.open) return;
    this._frame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(reason);
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this._frame(0x8, p);
    this.open = false;
    setTimeout(() => this.sock.destroy(), 200);
    this.emit('close');
  }

  ping() { if (this.open) this._frame(0x9, Buffer.alloc(0)); }

  _frame(op, payload) {
    const n = payload.length;
    let head;
    if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
    else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    head[0] = 0x80 | op;
    try { this.sock.write(Buffer.concat([head, payload])); } catch (_) { this._closed(); }
  }

  _data(d) {
    this.lastSeen = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_MESSAGE)) return this.close(1009, 'too big'); len = Number(big); off = 10; }
      if (len > MAX_MESSAGE) return this.close(1009, 'too big');
      if (!masked) return this.close(1002, 'client frames must be masked');
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this._op(op, fin, payload);
    }
  }

  _op(op, fin, payload) {
    switch (op) {
      case 0x0: // continuation
        if (!this.frags) return this.close(1002, 'unexpected continuation');
        this.frags.push(payload);
        if (fin) { const all = Buffer.concat(this.frags); this.frags = null; this._message(all); }
        return;
      case 0x1: case 0x2:
        if (fin) this._message(payload); else this.frags = [payload];
        return;
      case 0x8: this.close(1000); return;
      case 0x9: this._frame(0xa, payload); return; // ping → pong
      case 0xa: return; // pong
      default: this.close(1003, 'unsupported');
    }
  }

  _message(buf) {
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch (_) { return; }
    if (msg && typeof msg === 'object') this.emit('message', msg);
  }

  _closed() {
    if (!this.open && this._gone) return;
    this._gone = true;
    const was = this.open;
    this.open = false;
    try { this.sock.destroy(); } catch (_) { /* already gone */ }
    if (was) this.emit('close');
  }
}

/** Attach WebSocket handling for `path` to an http.Server. */
export function attachWebSocket(server, path, onConnection) {
  server.on('upgrade', (req, sock) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
      sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const remote = req.headers['x-forwarded-for'] || sock.remoteAddress;
    onConnection(new Socket(sock, remote), req);
  });
  // keep-alive: ping idle sockets, drop dead ones (proxies close silent connections)
  const sockets = new Set();
  const iv = setInterval(() => {
    const now = Date.now();
    for (const s of sockets) {
      if (!s.open) { sockets.delete(s); continue; }
      if (now - s.lastSeen > 45000) s.close(1001, 'timeout');
      else if (now - s.lastSeen > 15000) s.ping();
    }
  }, 5000);
  iv.unref?.();
  return { track: (s) => sockets.add(s) };
}
