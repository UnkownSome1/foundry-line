// Procedural canvas textures (no image downloads needed).
import * as THREE from 'three';
import { mulberry32 } from '../../shared/math.js';

let maxAniso = 4;
export function setMaxAnisotropy(n) { maxAniso = n; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

function speckle(ctx, w, h, rand, n, colors, rMin = 0.5, rMax = 1.5) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    const r = rMin + rand() * (rMax - rMin);
    ctx.fillRect(rand() * w, rand() * h, r, r);
  }
}

export function concrete() {
  const [c, x] = canvas(512, 512);
  const r = mulberry32(11);
  x.fillStyle = '#8f8c86';
  x.fillRect(0, 0, 512, 512);
  // large soft stains
  for (let i = 0; i < 28; i++) {
    const cx = r() * 512, cy = r() * 512, rad = 20 + r() * 90;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const dark = r() < 0.6;
    g.addColorStop(0, dark ? 'rgba(60,56,50,0.16)' : 'rgba(200,196,188,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  speckle(x, 512, 512, r, 9000, ['#7b7872', '#a19e97', '#6d6a64', '#b0ada6']);
  // hairline cracks
  x.strokeStyle = 'rgba(40,38,34,0.45)';
  x.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let px = r() * 512, py = r() * 512;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 14; k++) { px += (r() - 0.5) * 26; py += (r() - 0.5) * 26; x.lineTo(px, py); }
    x.stroke();
  }
  // saw-cut expansion joints at the tile edges
  x.fillStyle = 'rgba(45,43,40,0.4)';
  x.fillRect(0, 0, 512, 2); x.fillRect(0, 0, 2, 512);
  return tex(c);
}

export function corrugated(base = '#5b7079', { rust = 0.5, rib = 16 } = {}) {
  const [c, x] = canvas(256, 256);
  const r = mulberry32(21);
  x.fillStyle = base;
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += rib) {
    const g = x.createLinearGradient(i, 0, i + rib, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    x.fillStyle = g;
    x.fillRect(i, 0, rib, 256);
  }
  // rust / grime streaks running down from fixings
  for (let i = 0; i < 40 * rust; i++) {
    const sx = r() * 256, len = 30 + r() * 160;
    const g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(${110 + r() * 40},${55 + r() * 20},30,0.35)`);
    g.addColorStop(1, 'rgba(90,50,30,0)');
    x.fillStyle = g;
    x.fillRect(sx, r() < 0.5 ? 0 : 128, 1 + r() * 3, len);
  }
  speckle(x, 256, 256, r, 1500, ['rgba(0,0,0,0.15)', 'rgba(255,255,255,0.08)']);
  return tex(c);
}

export function corrugatedBump(rib = 16) {
  const [c, x] = canvas(64, 64);
  const ribs = 64 / (256 / rib);
  for (let i = 0; i < 64; i++) {
    const v = 128 + 110 * Math.sin((i / ribs) * Math.PI * 2);
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.fillRect(i, 0, 1, 64);
  }
  return tex(c, { srgb: false });
}

export function brick() {
  const [c, x] = canvas(256, 256);
  const r = mulberry32(31);
  x.fillStyle = '#6b6158';
  x.fillRect(0, 0, 256, 256);
  const bh = 16, bw = 48;
  for (let row = 0; row < 256 / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 256 / bw + 1; col++) {
      const t = r();
      const cr = 120 + t * 40, cg = 58 + t * 18, cb = 42 + t * 12;
      x.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`;
      x.fillRect(col * bw + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      if (r() < 0.25) {
        x.fillStyle = 'rgba(30,20,15,0.25)';
        x.fillRect(col * bw + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      }
    }
  }
  speckle(x, 256, 256, r, 2500, ['rgba(0,0,0,0.18)', 'rgba(255,230,210,0.08)']);
  return tex(c);
}

export function planks(base = [150, 112, 70], { stencil = null, frame = true } = {}) {
  const [c, x] = canvas(256, 256);
  const r = mulberry32(41);
  const [R, G, B] = base;
  for (let i = 0; i < 6; i++) {
    const t = 0.85 + r() * 0.25;
    x.fillStyle = `rgb(${R * t | 0},${G * t | 0},${B * t | 0})`;
    x.fillRect(0, i * 43, 256, 43);
    // grain
    x.strokeStyle = 'rgba(60,35,15,0.22)';
    for (let k = 0; k < 7; k++) {
      x.beginPath();
      const y = i * 43 + r() * 43;
      x.moveTo(0, y);
      for (let px = 0; px <= 256; px += 32) x.lineTo(px, y + (r() - 0.5) * 4);
      x.stroke();
    }
    x.fillStyle = 'rgba(40,24,10,0.55)';
    x.fillRect(0, i * 43, 256, 2);
  }
  if (frame) {
    x.fillStyle = `rgb(${R * 0.78 | 0},${G * 0.78 | 0},${B * 0.78 | 0})`;
    x.fillRect(0, 0, 256, 26); x.fillRect(0, 230, 256, 26);
    x.fillRect(0, 0, 26, 256); x.fillRect(230, 0, 26, 256);
    x.strokeStyle = 'rgba(40,24,10,0.6)'; x.lineWidth = 2;
    x.strokeRect(1, 1, 254, 254); x.strokeRect(26, 26, 204, 204);
    // diagonal brace
    x.save(); x.translate(128, 128); x.rotate(-Math.PI / 4);
    x.fillStyle = `rgb(${R * 0.82 | 0},${G * 0.82 | 0},${B * 0.82 | 0})`;
    x.fillRect(-150, -12, 300, 24); x.strokeRect(-150, -12, 300, 24);
    x.restore();
    // nails
    x.fillStyle = '#3b3530';
    for (const [nx, ny] of [[13, 13], [243, 13], [13, 243], [243, 243]]) x.fillRect(nx - 2, ny - 2, 4, 4);
  }
  if (stencil) {
    x.fillStyle = 'rgba(25,20,15,0.72)';
    x.font = 'bold 30px "Barlow Condensed", Impact, sans-serif';
    x.textAlign = 'center';
    x.fillText(stencil[0], 128, 116);
    x.font = 'bold 18px "Barlow Condensed", Impact, sans-serif';
    x.fillText(stencil[1], 128, 150);
  }
  return tex(c);
}

export function hazard(a = '#f2b01e', b = '#1d1d1b', stripes = 4) {
  const [c, x] = canvas(128, 128);
  x.fillStyle = a;
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = b;
  const w = 128 / stripes;
  for (let i = -stripes; i < stripes * 2; i++) {
    x.beginPath();
    x.moveTo(i * w * 2, 0);
    x.lineTo(i * w * 2 + w, 0);
    x.lineTo(i * w * 2 + w + 128, 128);
    x.lineTo(i * w * 2 + 128, 128);
    x.fill();
  }
  const r = mulberry32(51);
  speckle(x, 128, 128, r, 500, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.12)']);
  return tex(c);
}

/** ISO shipping container side: ribs + owner code + check digit stencil. */
export function containerSide(hex, code) {
  const [c, x] = canvas(512, 256);
  const r = mulberry32(parseInt(code.replace(/\D/g, '').slice(0, 6), 10) || 7);
  const col = new THREE.Color(hex);
  x.fillStyle = `#${col.getHexString()}`;
  x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 512; i += 20) {
    const g = x.createLinearGradient(i, 0, i + 20, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.30)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    x.fillStyle = g;
    x.fillRect(i, 0, 20, 256);
  }
  // top/bottom rails
  x.fillStyle = 'rgba(0,0,0,0.35)';
  x.fillRect(0, 0, 512, 12); x.fillRect(0, 244, 512, 12);
  // rust + scrapes
  for (let i = 0; i < 26; i++) {
    x.fillStyle = `rgba(${95 + r() * 40},${48 + r() * 20},26,${0.25 + r() * 0.3})`;
    x.fillRect(r() * 512, r() * 256, 2 + r() * 30, 1 + r() * 5);
  }
  speckle(x, 512, 256, r, 2500, ['rgba(0,0,0,0.18)', 'rgba(255,255,255,0.08)']);
  // owner code
  x.fillStyle = 'rgba(240,238,230,0.9)';
  x.font = 'bold 26px "Barlow Condensed", Impact, sans-serif';
  x.fillText(code.slice(0, -2), 360, 44);
  x.strokeStyle = 'rgba(240,238,230,0.9)'; x.lineWidth = 2;
  x.strokeRect(470, 22, 22, 28);
  x.fillText(code.slice(-1), 475, 44);
  x.font = 'bold 18px "Barlow Condensed", Impact, sans-serif';
  x.fillText('22G1', 360, 70);
  x.font = 'bold 13px "IBM Plex Mono", monospace';
  x.fillText('MAX GROSS 30,480 KG', 22, 212);
  x.fillText('TARE       2,220 KG', 22, 228);
  return tex(c, { repeat: false });
}

export function chainLink() {
  const [c, x] = canvas(64, 64);
  x.clearRect(0, 0, 64, 64);
  x.strokeStyle = '#c9cdd0';
  x.lineWidth = 2.2;
  x.beginPath();
  x.moveTo(0, 32); x.lineTo(32, 0); x.lineTo(64, 32); x.lineTo(32, 64); x.closePath();
  x.moveTo(-32, 32); x.lineTo(0, 64);
  x.stroke();
  x.beginPath(); x.moveTo(0, 0); x.lineTo(0, 0); x.stroke();
  // corners
  x.beginPath(); x.moveTo(0, 32); x.lineTo(-32, 0); x.moveTo(64, 32); x.lineTo(96, 64); x.stroke();
  return tex(c);
}

export function stipple() {
  const [c, x] = canvas(128, 128);
  const r = mulberry32(61);
  x.fillStyle = '#808080';
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1800; i++) {
    const v = r() < 0.5 ? 30 : 230;
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.beginPath();
    x.arc(r() * 128, r() * 128, 0.6 + r() * 1.1, 0, Math.PI * 2);
    x.fill();
  }
  return tex(c, { srgb: false });
}

export function radial(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 64) {
  const [c, x] = canvas(size, size);
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return tex(c, { repeat: false });
}

export function smokePuff() {
  const [c, x] = canvas(128, 128);
  const r = mulberry32(71);
  for (let i = 0; i < 14; i++) {
    const cx = 64 + (r() - 0.5) * 50, cy = 64 + (r() - 0.5) * 50, rad = 18 + r() * 30;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
  }
  return tex(c, { repeat: false });
}

export function muzzleStar() {
  const [c, x] = canvas(128, 128);
  x.translate(64, 64);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,250,225,1)');
  g.addColorStop(0.18, 'rgba(255,214,120,0.95)');
  g.addColorStop(0.5, 'rgba(255,140,40,0.35)');
  g.addColorStop(1, 'rgba(255,100,20,0)');
  x.fillStyle = g;
  for (let i = 0; i < 6; i++) {
    x.rotate(Math.PI / 3);
    x.beginPath();
    x.moveTo(0, -7); x.lineTo(64, 0); x.lineTo(0, 7);
    x.fill();
  }
  x.beginPath(); x.arc(0, 0, 22, 0, Math.PI * 2); x.fill();
  return tex(c, { repeat: false });
}

export function muzzleSide() {
  const [c, x] = canvas(128, 32);
  const g = x.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,245,210,1)');
  g.addColorStop(0.4, 'rgba(255,190,90,0.8)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(0, 8); x.quadraticCurveTo(60, 0, 128, 16); x.quadraticCurveTo(60, 32, 0, 24);
  x.fill();
  return tex(c, { repeat: false });
}

export function bulletHole() {
  const [c, x] = canvas(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(10,9,8,1)');
  g.addColorStop(0.22, 'rgba(18,16,14,0.95)');
  g.addColorStop(0.32, 'rgba(60,56,50,0.7)');
  g.addColorStop(0.6, 'rgba(40,36,32,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return tex(c, { repeat: false });
}

/** Text decal (engraving, signage). */
export function textPlate(lines, { w = 512, h = 128, bg = null, fg = '#e8e4da', font = 'Barlow Condensed', weight = 700, border = null } = {}) {
  const [c, x] = canvas(w, h);
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  if (border) { x.strokeStyle = border; x.lineWidth = h * 0.05; x.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1); }
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((ln, i) => {
    const size = ln.size ?? (h / (n + 0.6)) * 0.8;
    x.font = `${ln.weight ?? weight} ${size}px "${ln.font ?? font}", Impact, sans-serif`;
    if (ln.color) x.fillStyle = ln.color; else x.fillStyle = fg;
    x.fillText(ln.text, w / 2, (h / (n + 1)) * (i + 1) + (ln.dy ?? 0));
  });
  return tex(c, { repeat: false });
}

export function conveyorBelt() {
  const [c, x] = canvas(64, 64);
  x.fillStyle = '#26282a';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#1a1b1c';
  for (let i = 0; i < 64; i += 8) x.fillRect(i, 0, 3, 64);
  return tex(c);
}
