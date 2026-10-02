// Procedural canvas textures — everything in the set is generated, no image assets.
import * as THREE from 'three';

// deterministic PRNG so the set looks identical on every load
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function speckle(g, w, h, r, n, colors, minS, maxS) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(r() * colors.length) | 0];
    const s = minS + r() * (maxS - minS);
    g.globalAlpha = 0.25 + r() * 0.5;
    g.fillRect(r() * w, r() * h, s, s * (0.6 + r() * 0.8));
  }
  g.globalAlpha = 1;
}

function veins(g, w, h, r, n, color, width) {
  g.strokeStyle = color; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = r() * w, y = r() * h, a = r() * Math.PI * 2;
    g.lineWidth = width * (0.4 + r());
    g.globalAlpha = 0.25 + r() * 0.5;
    g.beginPath(); g.moveTo(x, y);
    const steps = 14 + ((r() * 26) | 0);
    for (let k = 0; k < steps; k++) {
      a += (r() - 0.5) * 0.9;
      x += Math.cos(a) * w * 0.022; y += Math.sin(a) * h * 0.022;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}

// grey terrazzo office floor with pale crack lines
export function terrazzo(repeat) {
  const [c, g] = canvas(1024, 1024), r = rng(11);
  g.fillStyle = '#8f9390'; g.fillRect(0, 0, 1024, 1024);
  speckle(g, 1024, 1024, r, 5200, ['#7d827f', '#a3a7a3', '#868b8a', '#b4b6b0', '#70757a'], 2, 9);
  veins(g, 1024, 1024, r, 34, '#d9dbd4', 2.2);
  veins(g, 1024, 1024, r, 20, '#5f6466', 1.2);
  return tex(c, { repeat });
}

// cream marble for the lift lobby floor
export function marble(repeat) {
  const [c, g] = canvas(1024, 1024), r = rng(23);
  g.fillStyle = '#d9d2c4'; g.fillRect(0, 0, 1024, 1024);
  speckle(g, 1024, 1024, r, 2600, ['#cfc7b6', '#e4ded2', '#c6bdaa'], 6, 30);
  veins(g, 1024, 1024, r, 26, '#a59a86', 2.4);
  veins(g, 1024, 1024, r, 16, '#f1ede4', 3);
  g.strokeStyle = 'rgba(120,110,95,.5)'; g.lineWidth = 2; // tile joints
  for (let i = 0; i <= 2; i++) { g.strokeRect(0, 0, 512 * i, 1024); g.strokeRect(0, 0, 1024, 512 * i); }
  return tex(c, { repeat });
}

// travertine wall cladding: horizontal striations + slab joints
export function travertine(repeat) {
  const [c, g] = canvas(512, 1024), r = rng(37);
  g.fillStyle = '#cbbfa9'; g.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = ['#bfb29a', '#d6cbb7', '#b8ab92', '#ddd3c1'][(r() * 4) | 0];
    g.globalAlpha = 0.18 + r() * 0.3;
    g.fillRect(r() * 512, r() * 1024, 30 + r() * 220, 1 + r() * 3);
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(95,84,66,.55)'; g.lineWidth = 3;
  g.strokeRect(0, 0, 512, 512); g.strokeRect(0, 512, 512, 512);
  return tex(c, { repeat });
}

// walnut panelling with vertical grain and panel reveals
export function walnut(repeat) {
  const [c, g] = canvas(512, 1024), r = rng(41);
  g.fillStyle = '#4a3324'; g.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = ['#3d2a1d', '#5a3f2c', '#432e20', '#65482f'][(r() * 4) | 0];
    g.globalAlpha = 0.2 + r() * 0.35;
    g.fillRect(r() * 512, r() * 1024, 1 + r() * 3, 60 + r() * 400);
  }
  g.globalAlpha = 1;
  g.fillStyle = '#20150e';
  g.fillRect(0, 0, 4, 1024); g.fillRect(254, 0, 4, 1024);
  return tex(c, { repeat });
}

// the reception feature wall: white with a regular grid of small recessed squares
export function pixelWall() {
  const W = 2048, H = 1024, [c, g] = canvas(W, H), [bm, gb] = canvas(W, H), r = rng(53);
  g.fillStyle = '#f3f2ef'; g.fillRect(0, 0, W, H);
  gb.fillStyle = '#ffffff'; gb.fillRect(0, 0, W, H);
  const cw = 40, ch = 44, sw = 14, sh = 26;                     // tall slots on a regular grid
  for (let y = 0; y < H / ch; y++) for (let x = 0; x < W / cw; x++) {
    const v = r(), tone = v < 0.55 ? '#b9b7b4' : v < 0.85 ? '#8c8a88' : '#5f5d5b';
    const px = x * cw + (cw - sw) / 2, py = y * ch + (ch - sh) / 2;
    g.fillStyle = tone; g.fillRect(px, py, sw, sh);
    g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(px, py, sw, 3);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(px, py + sh - 2, sw, 2);
    gb.fillStyle = '#3a3a3a'; gb.fillRect(px, py, sw, sh);
  }
  return { map: tex(c), bump: tex(bm, { srgb: false }) };
}

// an original mark for the reception wall: a few thin wing-like arcs with a dot
export function wingLogo() {
  const [c, g] = canvas(512, 256);
  g.strokeStyle = '#3a3c40'; g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    g.lineWidth = 2.2;
    const y = 150 - i * 22, spread = 110 + i * 34;
    g.beginPath();
    g.moveTo(256 - spread, y + 36 + i * 8);
    g.quadraticCurveTo(256 - spread * 0.45, y - 30, 256 - 16, y + 28);
    g.moveTo(256 + spread, y + 36 + i * 8);
    g.quadraticCurveTo(256 + spread * 0.45, y - 30, 256 + 16, y + 28);
    g.stroke();
  }
  g.fillStyle = '#3a3c40'; g.beginPath(); g.arc(256, 184, 5, 0, 7); g.fill();
  return tex(c);
}

// frosted glass: alpha ramps from clear at the edges to milky in the middle band
export function frosted(mark) {
  const [c, g] = canvas(512, 1024);
  const grad = g.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, 'rgba(235,242,244,.10)');
  grad.addColorStop(0.22, 'rgba(235,242,244,.78)');
  grad.addColorStop(0.78, 'rgba(235,242,244,.78)');
  grad.addColorStop(1, 'rgba(235,242,244,.10)');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 1024);
  if (mark) {
    g.fillStyle = 'rgba(120,128,134,.85)';
    g.font = '300 300px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(mark, 256, 470);
  }
  return tex(c);
}

// neighbouring tenant's sign across the lobby — an original abstract chevron mark
export function purpleSign() {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#f4f2f6'; g.fillRect(0, 0, 1024, 512);
  g.fillStyle = '#5b2a86';
  g.fillRect(0, 150, 1024, 210);
  g.fillStyle = '#f4f2f6';
  for (let i = 0; i < 4; i++) {
    const x = 120 + i * 210;
    g.beginPath();
    g.moveTo(x, 150); g.lineTo(x + 90, 255); g.lineTo(x, 360); g.lineTo(x + 50, 360); g.lineTo(x + 140, 255); g.lineTo(x + 50, 150);
    g.closePath(); g.fill();
  }
  return tex(c);
}

// wall display: abstract skyline at dusk
export function displayScreen() {
  const [c, g] = canvas(512, 288), r = rng(71);
  const grad = g.createLinearGradient(0, 0, 0, 288);
  grad.addColorStop(0, '#16345a'); grad.addColorStop(0.6, '#3f7fa8'); grad.addColorStop(1, '#bfd9d6');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 288);
  for (let i = 0; i < 46; i++) {
    const w = 10 + r() * 26, h = 40 + r() * 150;
    g.fillStyle = `rgba(${20 + r() * 30},${40 + r() * 40},${70 + r() * 50},.9)`;
    g.fillRect(i * 11, 288 - h, w, h);
  }
  return tex(c);
}

// venetian blinds over a bright window
export function blinds() {
  const [c, g] = canvas(256, 512);
  for (let y = 0; y < 512; y += 8) {
    g.fillStyle = y % 16 ? '#f6f8f8' : '#dfe6e8';
    g.fillRect(0, y, 256, 8);
  }
  g.fillStyle = 'rgba(120,135,140,.5)';
  g.fillRect(0, 0, 3, 512); g.fillRect(253, 0, 3, 512);
  return tex(c, { repeat: [1, 1] });
}

// soft radial blob used for fake contact shadows under furniture
export function blob() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return tex(c);
}

// embroidered blossoms for the mother's jacket hem
export function blossoms() {
  const [c, g] = canvas(256, 256), r = rng(97);
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = '#2c4a2f'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(30, 250); g.quadraticCurveTo(90, 150, 200, 40); g.stroke();
  g.beginPath(); g.moveTo(90, 170); g.quadraticCurveTo(150, 170, 230, 150); g.stroke();
  for (let i = 0; i < 9; i++) {
    const x = 40 + r() * 180, y = 30 + r() * 200, s = 9 + r() * 9;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      g.fillStyle = r() < 0.5 ? '#d8436a' : '#f08aa2';
      g.beginPath(); g.arc(x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6, s * 0.48, 0, 7); g.fill();
    }
    g.fillStyle = '#f6d36b'; g.beginPath(); g.arc(x, y, s * 0.25, 0, 7); g.fill();
  }
  return tex(c);
}

// simple repeating stripes / florals for crowd clothing
export function stripes(a, b, n = 10, vertical = true) {
  const [c, g] = canvas(128, 128);
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? a : b;
    if (vertical) g.fillRect((i * 128) / n, 0, 128 / n + 1, 128); else g.fillRect(0, (i * 128) / n, 128, 128 / n + 1);
  }
  return tex(c, { repeat: [2, 1] });
}

export function floral(base, seed = 5) {
  const [c, g] = canvas(256, 256), r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = ['#e8eef0', '#5fa7a0', '#d96a7c', '#f3d27a'][(r() * 4) | 0];
    g.beginPath(); g.arc(r() * 256, r() * 256, 5 + r() * 12, 0, 7); g.fill();
  }
  return tex(c, { repeat: [2, 1] });
}

// tweed / knit: flecked base with a fine diagonal weave, used as colour and bump
export function tweed(base, fleck, seed = 3) {
  const [c, g] = canvas(256, 256), r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { g.fillStyle = fleck; g.globalAlpha = 0.12 + r() * 0.3; g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 2); }
  g.globalAlpha = 0.16; g.strokeStyle = '#000'; g.lineWidth = 1;
  for (let i = -256; i < 512; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 256, 256); g.stroke(); }
  g.globalAlpha = 1;
  return tex(c, { repeat: [3, 3] });
}

// fine cloth grain for suits (bump only)
export function wool(seed = 9) {
  const [c, g] = canvas(128, 128), r = rng(seed);
  g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 6000; i++) { const v = 100 + r() * 60; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * 128, r() * 128, 1, 1 + r() * 2); }
  return tex(c, { repeat: [6, 6], srgb: false });
}
