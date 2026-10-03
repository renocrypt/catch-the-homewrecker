// The set. World axes: +x east, +z south, +y up. Units are metres.
//
//   LOBBY (lift lobby, marble)        z -9.5 .. -1.6
//   ---- pixel wall / glass doors ----  z = -1.6
//   RECEPTION  desk at x 0, green wall on the west
//   CORRIDOR   between two glass partitions, x -1.9 .. 2.7, z 4 .. 9.6  (the stand-off)
//   OPEN OFFICE meeting table south-west, executive office south-east
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';

export const PLAN = {
  office: { x0: -8.2, x1: 10, z0: -1.6, z1: 15 },
  lobby: { x0: 1, x1: 12.5, z0: -9.5, z1: -1.6 },
  door: { x0: 4.3, x1: 7.1, z: -1.6 },
  desk: { x: 0, z: -0.2, w: 3.4, d: 0.6 },
  pixelWall: { x0: -3.4, x1: 3.4, z: -1.6 },
  greenWall: { x: -3.4, z0: -1.6, z1: 1.6 },
  table: { x: -4.4, z: 5.2, w: 1.3, d: 4.0 },
  glassW: { x: -1.9, z0: 4.2, z1: 9.0 },
  glassE: { x: 2.7, z0: 4.6, z1: 9.6 },
  execDoor: { x: 2.7, z0: 10.2, z1: 11.2 },
};

const mats = new Map();
function M(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o }));
  return mats.get(key);
}

export function buildSet(scene) {
  const root = new THREE.Group(); root.name = 'set';
  scene.add(root);
  const glass = new THREE.Group(); glass.name = 'glass';
  root.add(glass);
  const r = T.rng(7);

  const add = (mesh, parent = root, cast = false, receive = true) => {
    mesh.castShadow = cast; mesh.receiveShadow = receive; parent.add(mesh); return mesh;
  };
  const box = (w, h, d, mat, x, y, z, o = {}) => {
    const m = new THREE.Mesh(o.round ? new RoundedBoxGeometry(w, h, d, 3, o.round) : new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); if (o.ry) m.rotation.y = o.ry;
    return add(m, o.parent || root, o.cast ?? true, o.receive ?? true);
  };
  // vertical plane spanning (x0,z0)-(x1,z1), y0..y1, facing the left-hand normal of its direction
  const wall = (x0, z0, x1, z1, y0, y1, mat, o = {}) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, y1 - y0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.rotation.y = Math.atan2(-(z1 - z0), x1 - x0) + (o.flip ? Math.PI : 0);
    return add(m, o.parent || root, false, true);
  };
  const floor = (x0, z0, x1, z1, y, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    return add(m, root, false, true);
  };

  const O = PLAN.office, L = PLAN.lobby;
  const white = M('#ecebe7', { roughness: 0.9 });
  const chrome = M('#9aa0a4', { roughness: 0.25, metalness: 0.9 });
  const darkFrame = M('#2b2e31', { roughness: 0.4, metalness: 0.6 });
  const dbl = { side: THREE.DoubleSide };

  // ───────────────────────── floors & ceilings
  floor(O.x0, O.z0, O.x1, O.z1, 0, M('#ffffff', { map: T.terrazzo([7, 6.5]), roughness: 0.32, metalness: 0.05 }));
  floor(L.x0 - 1, L.z0, L.x1 + 4, L.z1, 0, M('#ffffff', { map: T.marble([5, 3]), roughness: 0.4, metalness: 0.0 }));
  const carpet = M('#6d8f47', { roughness: 1 });
  [[-6.3, 2.5, -2.5, 7.9], [-1.7, 5.9, 2.5, 7.7], [-7.6, 9.8, -2.2, 13.6], [3.3, 13.4, 9, 14.8]].forEach(([a, b, c, d]) => floor(a, b, c, d, 0.006, carpet));

  const ceil = (x0, z0, x1, z1, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), M('#f4f3ef', { roughness: 1 }));
    m.rotation.x = Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    add(m, root, false, false);
  };
  ceil(O.x0, O.z0, O.x1, O.z1, 3.0);
  ceil(L.x0 - 1, L.z0, L.x1 + 4, L.z1, 3.2);
  const glow = new THREE.MeshBasicMaterial({ color: '#fffaf0' }); glow.color.multiplyScalar(3.2);
  for (const x of [-6.6, -4.2, -0.6, 1.6, 4.4, 6.8, 8.9]) box(0.1, 0.02, 15.4, glow, x, 2.985, 6.7, { cast: false, receive: false }).userData.ceiling = true;
  for (const z of [1.9, 8.0]) box(16, 0.02, 0.1, glow, 0.9, 2.985, z, { cast: false, receive: false }).userData.ceiling = true;
  const disc = new THREE.CircleGeometry(0.11, 20);
  for (let x = 2.2; x < 12.4; x += 1.7) for (let z = -8.6; z < -2; z += 1.7) {
    const d = new THREE.Mesh(disc, glow); d.rotation.x = Math.PI / 2; d.position.set(x, 3.19, z); d.userData.ceiling = true; root.add(d);
  }

  // ───────────────────────── office shell
  const winMat = new THREE.MeshBasicMaterial({ map: T.blinds() }); winMat.color.multiplyScalar(1.4);
  const windowWall = (x0, z0, x1, z1, flip) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 1.5);
    wall(x0, z0, x1, z1, 0, 0.5, white, { flip });
    wall(x0, z0, x1, z1, 2.8, 3, white, { flip });
    wall(x0, z0, x1, z1, 0.5, 2.8, winMat, { flip }).material.map.repeat.set(n, 1);
    winMat.map.wrapS = THREE.RepeatWrapping;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      box(0.07, 2.3, 0.07, darkFrame, x0 + (x1 - x0) * t, 1.65, z0 + (z1 - z0) * t, { cast: false });
    }
  };
  windowWall(O.x0, O.z1, O.x0, O.z0, false);             // west windows
  windowWall(O.x1, O.z1, O.x0, O.z1, false);             // south windows
  wall(O.x1, O.z0, O.x1, O.z1, 0, 3, white);             // east wall
  for (const z of [2.2, 5.4]) box(0.04, 0.9, 1.3, M('#b9c4c0', { roughness: 0.5 }), O.x1 - 0.03, 1.7, z, { cast: false });

  // north wall, west part + wall display
  wall(O.x0, O.z0, -3.4, O.z0, 0, 3, white);
  const screenMat = new THREE.MeshBasicMaterial({ map: T.displayScreen() });
  box(3.0, 1.5, 0.06, M('#17191c', { roughness: 0.3 }), -5.9, 1.9, O.z0 + 0.05, { cast: false });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.86, 1.38), screenMat); scr.position.set(-5.9, 1.9, O.z0 + 0.085); root.add(scr);

  // the pixel feature wall behind reception (thick, so the lobby side can be stone)
  const px = T.pixelWall();
  wall(-3.4, O.z0 + 0.02, 3.4, O.z0 + 0.02, 0, 3, M('#ffffff', { map: px.map, bumpMap: px.bump, bumpScale: 2.5, roughness: 0.8 }));
  for (const x of [-1.6, 0.1, 1.8]) { // wall washers over the desk
    const s = new THREE.SpotLight('#fff1dc', 3.2, 6, 0.75, 0.8, 1.6); s.position.set(x, 2.95, -0.5); s.target.position.set(x, 1.0, -1.4);
    root.add(s, s.target);
  }

  // ───────────────────────── entrance: frosted glass + open glass doors
  const frost = (mark) => new THREE.MeshStandardMaterial({ map: T.frosted(mark), transparent: true, roughness: 0.25, depthWrite: false, ...dbl });
  const clear = new THREE.MeshStandardMaterial({ color: '#d6e6e8', transparent: true, opacity: 0.13, roughness: 0.04, metalness: 0.1, envMapIntensity: 2.2, depthWrite: false, ...dbl });
  const D = PLAN.door;
  wall(3.4, O.z0, D.x0, O.z0, 0, 3, frost('&'), { parent: glass });
  wall(D.x1, O.z0, 9.2, O.z0, 0, 3, frost(), { parent: glass });
  wall(9.2, O.z0, O.x1, O.z0, 0, 3, white);
  box(D.x1 - D.x0, 0.5, 0.12, darkFrame, (D.x0 + D.x1) / 2, 2.75, O.z0, { cast: false }).userData.ceiling = true;
  for (const x of [3.4, D.x0, D.x1, 9.2]) box(0.07, 3, 0.1, chrome, x, 1.5, O.z0, { cast: false });
  for (const [x, s] of [[D.x0 + 0.05, 1], [D.x1 - 0.05, -1]]) { // leaves swung into the office
    wall(x, O.z0 + 0.05, x, O.z0 + 1.4, 0, 2.5, clear, { parent: glass });
    box(0.03, 0.9, 0.03, chrome, x + 0.06 * s, 1.1, O.z0 + 1.2, { cast: false });
  }

  // ───────────────────────── living wall (west of reception)
  const G = PLAN.greenWall;
  box(0.12, 3, G.z1 - G.z0, M('#2e4423', { roughness: 1 }), G.x - 0.06, 1.5, (G.z0 + G.z1) / 2, { cast: false });
  wall(G.x - 0.12, G.z1, G.x - 0.12, G.z0, 0, 3, white, { flip: true });
  box(0.16, 3, 0.06, white, G.x - 0.06, 1.5, G.z1 + 0.03, { cast: false });
  {
    const N = 3400, leaf = new THREE.IcosahedronGeometry(1, 0);
    const im = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const greens = ['#3f6b2a', '#4f8232', '#6a9a3a', '#2f5626', '#85ad45', '#5b8f3b', '#3a6f3a'];
    let i = 0;
    const put = (x, y, z, sc, tint) => {
      if (i >= N) return;
      e.set(r() * 3, r() * 3, r() * 3); q.setFromEuler(e); p.set(x, y, z); s.set(sc, sc * (0.45 + r() * 0.4), sc);
      im.setMatrixAt(i, m4.compose(p, q, s)); c.set(tint || greens[(r() * greens.length) | 0]).multiplyScalar(0.8 + r() * 0.45); im.setColorAt(i, c); i++;
    };
    for (let k = 0; k < 2500; k++) put(G.x + 0.03 + r() * 0.15, r() * 3, G.z0 + 0.05 + r() * (G.z1 - G.z0 - 0.1), 0.05 + r() * 0.08);
    for (let f = 0; f < 60; f++) { // hanging fern strands
      const z = G.z0 + 0.1 + r() * (G.z1 - G.z0 - 0.2), top = 1.2 + r() * 1.8, n = 6 + ((r() * 9) | 0);
      for (let k = 0; k < n; k++) put(G.x + 0.14 + k * 0.022 + r() * 0.04, top - k * 0.075, z + (r() - 0.5) * 0.08, 0.035 + r() * 0.03, k % 2 ? '#86b84a' : '#6fa63f');
    }
    im.count = i; im.receiveShadow = true; root.add(im);
  }

  // ───────────────────────── reception desk
  const K = PLAN.desk;
  const lacquer = M('#241d1a', { roughness: 0.18, metalness: 0.2, envMapIntensity: 1.4 });
  box(K.w, 1.06, K.d, lacquer, K.x, 0.53, K.z);
  box(K.w + 0.1, 0.04, K.d + 0.12, M('#15110f', { roughness: 0.12, metalness: 0.3, envMapIntensity: 1.6 }), K.x, 1.08, K.z);
  box(K.w - 0.3, 0.04, 0.6, M('#e7e4dc', { roughness: 0.5 }), K.x, 0.76, K.z - 0.62);          // receptionist's worktop
  box(0.05, 0.75, 0.6, lacquer, K.x - K.w / 2 + 0.17, 0.375, K.z - 0.62);
  box(0.05, 0.75, 0.6, lacquer, K.x + K.w / 2 - 0.17, 0.375, K.z - 0.62);
  const paper = M('#f7f6f1', { roughness: 0.9 });
  box(0.36, 0.006, 0.26, paper, -0.25, 1.105, -0.14, { ry: 0.12, cast: false });
  box(0.3, 0.008, 0.22, M('#2d2d30', { roughness: 0.4 }), 0.22, 1.106, -0.1, { ry: -0.2, cast: false });
  box(0.3, 0.004, 0.22, paper, 0.55, 1.104, -0.18, { ry: 0.3, cast: false });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 16), chrome); cup.position.set(0.82, 1.145, -0.22); add(cup, root, true);
  box(0.56, 0.36, 0.03, M('#c9ccce', { roughness: 0.3, metalness: 0.7 }), 1.32, 1.36, -0.32, { ry: 0.35 });
  box(0.05, 0.16, 0.05, chrome, 1.32, 1.17, -0.32);
  box(0.2, 0.012, 0.14, chrome, 1.32, 1.106, -0.32, { ry: 0.35 });

  // ───────────────────────── furniture helpers
  const tan = M('#b9864f', { roughness: 0.55 }), tanShell = M('#8b5f3a', { roughness: 0.5 });
  const chair = (x, z, ry, mat = tan, shell = tanShell) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; root.add(g);
    const b = (w, h, d, m, px, py, pz, o = {}) => { const me = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, o.round ?? 0.03), m); me.position.set(px, py, pz); if (o.rx) me.rotation.x = o.rx; me.castShadow = true; me.receiveShadow = true; g.add(me); };
    b(0.5, 0.09, 0.48, mat, 0, 0.47, 0.02);
    b(0.5, 0.68, 0.07, mat, 0, 0.85, -0.22, { rx: -0.14 });
    b(0.53, 0.5, 0.03, shell, 0, 0.8, -0.265, { rx: -0.14, round: 0.012 });
    b(0.05, 0.03, 0.34, shell, 0.27, 0.66, 0.0, { round: 0.012 }); b(0.05, 0.03, 0.34, shell, -0.27, 0.66, 0.0, { round: 0.012 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 10), chrome); stem.position.y = 0.24; g.add(stem);
    for (let i = 0; i < 5; i++) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.3), chrome); leg.position.set(Math.sin(i * 1.2566) * 0.15, 0.045, Math.cos(i * 1.2566) * 0.15); leg.rotation.y = i * 1.2566; leg.castShadow = true; g.add(leg); }
    return g;
  };
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  const plant = (x, z, h = 1.1, spread = 0.3) => {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.36, 16), M('#d9d7d0', { roughness: 0.6 })); pot.position.set(x, 0.18, z); add(pot, root, true);
    const n = 46, im = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = r() * 6.28, rad = r() * spread, y = 0.4 + r() * (h - 0.4);
      e.set(r() * 3, r() * 3, r() * 3); q.setFromEuler(e); p.set(x + Math.cos(a) * rad, y, z + Math.sin(a) * rad); const sc = 0.06 + r() * 0.07; s.set(sc, sc * 0.5, sc);
      im.setMatrixAt(i, m4.compose(p, q, s)); im.setColorAt(i, c.set(['#3f6b2a', '#4f8232', '#6a9a3a'][(r() * 3) | 0]).multiplyScalar(0.8 + r() * 0.4));
    }
    im.castShadow = true; root.add(im);
  };
  const laptop = (x, y, z, ry) => {
    box(0.32, 0.015, 0.22, chrome, x, y, z, { ry, cast: false });
    const lid = box(0.32, 0.21, 0.012, chrome, x - Math.sin(ry) * -0.1, y + 0.1, z - Math.cos(ry) * 0.1, { ry, cast: false }); lid.rotation.x = -0.25;
  };

  // ───────────────────────── meeting table (south-west of reception)
  const TB = PLAN.table;
  box(TB.w, 0.06, TB.d, M('#3a2a20', { roughness: 0.3, envMapIntensity: 1.2 }), TB.x, 0.745, TB.z);
  for (const dz of [-1.4, 1.4]) box(0.9, 0.72, 0.08, M('#2a2a2c', { roughness: 0.5 }), TB.x, 0.36, TB.z + dz);
  const seats = [];
  [3.7, 4.7, 5.7, 6.7].forEach((z, i) => {
    seats.push({ x: TB.x - 0.98, z, ry: Math.PI / 2 }); seats.push({ x: TB.x + 0.98, z, ry: -Math.PI / 2 });
    chair(TB.x - 0.98 - (i % 2) * 0.1, z, Math.PI / 2 + (r() - 0.5) * 0.5);
    chair(TB.x + 0.98 + (i % 2) * 0.12, z + 0.05, -Math.PI / 2 + (r() - 0.5) * 0.6);
  });
  chair(TB.x, TB.z + 2.6, Math.PI);
  laptop(TB.x - 0.25, 0.785, 4.2, Math.PI / 2); laptop(TB.x + 0.25, 0.785, 5.3, -Math.PI / 2); laptop(TB.x - 0.25, 0.785, 6.3, Math.PI / 2);
  for (const [x, z] of [[-4.2, 3.9], [-4.6, 4.9], [-4.3, 5.9], [-4.55, 6.6]]) {
    const btl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10), new THREE.MeshStandardMaterial({ color: '#dff0ee', transparent: true, opacity: 0.55, roughness: 0.1 })); btl.position.set(x, 0.875, z); root.add(btl);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 10), M('#3f9a55')); cap.position.set(x, 0.985, z); root.add(cap);
    box(0.21, 0.004, 0.3, paper, x + 0.25, 0.778, z + 0.2, { ry: r(), cast: false });
  }

  // ───────────────────────── glass partitions (the corridor of the stand-off)
  const partition = (x0, z0, x1, z1, h = 2.7) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 1.2));
    wall(x0, z0, x1, z1, 0, h, clear, { parent: glass });
    const band = new THREE.MeshStandardMaterial({ color: '#eef4f4', transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false, ...dbl });
    for (const y of [1.0, 1.16, 1.32, 1.48]) wall(x0, z0, x1, z1, y, y + 0.09, band, { parent: glass });
    for (let i = 0; i <= n; i++) { const t = i / n; box(0.035, h, 0.035, chrome, x0 + (x1 - x0) * t, h / 2, z0 + (z1 - z0) * t, { cast: false }); }
    const top = box(len, 0.04, 0.05, chrome, (x0 + x1) / 2, h, (z0 + z1) / 2, { cast: false }); top.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
    const bot = box(len, 0.06, 0.05, chrome, (x0 + x1) / 2, 0.03, (z0 + z1) / 2, { cast: false }); bot.rotation.y = top.rotation.y;
  };
  const W = PLAN.glassW, E = PLAN.glassE;
  partition(W.x, W.z0, W.x, W.z1);
  partition(E.x, E.z0, E.x, E.z1);
  partition(E.x, E.z0, 7.4, E.z0);
  partition(7.4, E.z0, 7.4, E.z1);
  // small meeting room inside the east glass box
  box(2.4, 0.05, 1.1, M('#e9e7e1', { roughness: 0.4 }), 5.0, 0.74, 7.1); box(0.1, 0.72, 0.1, chrome, 5.0, 0.36, 7.1);
  for (const [x, z, ry] of [[4.3, 6.3, 0], [5.6, 6.3, 0], [4.3, 7.9, Math.PI], [5.6, 7.9, Math.PI]]) chair(x, z, ry, M('#8fa08f', { roughness: 0.7 }), M('#5c6a61'));
  box(0.5, 3, 0.5, white, W.x, 1.5, W.z1 + 0.3, { cast: false });
  box(0.5, 3, 0.5, white, E.x, 1.5, E.z0 - 0.3, { cast: false });

  // ───────────────────────── executive office (south-east): dark wood wall with a doorway
  const X = PLAN.execDoor, wood = M('#ffffff', { map: T.walnut([2, 1]), roughness: 0.45 });
  box(0.12, 3, X.z0 - 9.9, wood, X.x, 1.5, (9.9 + X.z0) / 2, { cast: false });
  box(0.12, 3, 13.6 - X.z1, wood, X.x, 1.5, (X.z1 + 13.6) / 2, { cast: false });
  box(0.12, 0.7, X.z1 - X.z0, wood, X.x, 2.65, (X.z0 + X.z1) / 2, { cast: false });
  partition(X.x, 9.9, 7.4, 9.9);
  box(1.9, 0.05, 0.9, M('#2f2622', { roughness: 0.3 }), 5.6, 0.75, 12.0); box(1.7, 0.7, 0.05, M('#2f2622'), 5.6, 0.36, 12.0);
  chair(5.6, 12.8, Math.PI, M('#3b3b3f', { roughness: 0.5 }), M('#232326'));
  box(0.4, 2.1, 2.6, M('#dcd8cf', { roughness: 0.7 }), 9.75, 1.05, 11.6, { cast: false }); // shelving
  for (let i = 0; i < 9; i++) box(0.3, 0.26, 0.05 + r() * 0.06, M(['#8e3b3b', '#2f4d6b', '#c9b27c', '#3c5a45'][i % 4]), 9.62, 0.55 + ((i / 3) | 0) * 0.5, 10.7 + (i % 3) * 0.75 + r() * 0.2, { cast: false });

  // ───────────────────────── lounge by the entrance
  const sofaM = M('#b8a98f', { roughness: 0.9 }), sofaB = M('#7b6a55', { roughness: 0.8 });
  const sofa = (x, z, w, ry) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; root.add(g);
    const b = (ww, h, d, m, px, py, pz) => { const me = new THREE.Mesh(new RoundedBoxGeometry(ww, h, d, 3, 0.05), m); me.position.set(px, py, pz); me.castShadow = me.receiveShadow = true; g.add(me); };
    b(w, 0.22, 0.85, sofaB, 0, 0.13, 0); b(w - 0.06, 0.2, 0.78, sofaM, 0, 0.34, 0.02); b(w, 0.42, 0.2, sofaM, 0, 0.5, -0.36);
  };
  sofa(4.3, 2.5, 2.1, 0); sofa(5.75, 3.6, 1.6, -Math.PI / 2);
  box(0.9, 0.04, 0.6, M('#40332a', { roughness: 0.25 }), 4.3, 0.36, 3.7); box(0.7, 0.34, 0.4, M('#2c2420'), 4.3, 0.17, 3.7);
  plant(3.75, -1.05, 1.5, 0.3); plant(7.9, -0.9, 1.3, 0.28); plant(-7.6, 0.6, 1.2, 0.26); plant(-2.3, 9.7, 1.35, 0.3); plant(9.2, 4.0, 1.5, 0.3);

  // ───────────────────────── workstations
  const deskTop = M('#f2f1ec', { roughness: 0.5 }), seatG = M('#8a9a86', { roughness: 0.8 }), seatS = M('#59645a');
  const station = (x, z, ry) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; root.add(g);
    const b = (w, h, d, m, px, py, pz, cast = true) => { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(px, py, pz); me.castShadow = cast; me.receiveShadow = true; g.add(me); return me; };
    b(1.5, 0.04, 0.72, deskTop, 0, 0.74, 0); b(0.04, 0.72, 0.66, chrome, -0.7, 0.36, 0); b(0.04, 0.72, 0.66, chrome, 0.7, 0.36, 0);
    b(0.56, 0.34, 0.03, M('#18191b', { roughness: 0.3 }), 0, 1.07, -0.2);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.3), new THREE.MeshBasicMaterial({ color: ['#9fc4d6', '#c7d9c2', '#e8e4d2'][(r() * 3) | 0] })); s.position.set(0, 1.07, -0.183); g.add(s);
    b(0.05, 0.16, 0.05, chrome, 0, 0.84, -0.2); b(0.42, 0.012, 0.14, M('#d8d8d8'), 0, 0.767, 0.12, false);
    b(1.5, 0.36, 0.03, M('#cfd6cf', { roughness: 0.9 }), 0, 0.94, -0.36);
  };
  for (const z of [10.7, 12.7]) for (const x of [-6.7, -5.0, -3.3]) { station(x, z, Math.PI); chair(x + (r() - 0.5) * 0.2, z - 0.75, 0.2 * (r() - 0.5), seatG, seatS); }
  for (const x of [4.2, 5.9, 7.6]) { station(x, 14.2, Math.PI); chair(x, 13.5, 0, seatG, seatS); }
  box(0.6, 3, 0.6, white, -8.2 + 0.3, 1.5, 8.6, { cast: false });

  // ───────────────────────── lift lobby
  const trav = (rep) => M('#ffffff', { map: T.travertine(rep), roughness: 0.55 });
  const wal = (rep) => M('#ffffff', { map: T.walnut(rep), roughness: 0.38, envMapIntensity: 1.2 });
  const bronze = M('#7a6248', { roughness: 0.28, metalness: 0.85 });
  // a run of alternating stone pilasters and timber bays along a wall
  const bays = (x0, z0, x1, z1, flip, lift) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const nx = flip ? uz : -uz, nz = flip ? -ux : ux; // room-side normal
    let d = 0, i = 0;
    while (d < len - 0.01) {
      const stone = i % 2 === 0, w = Math.min(stone ? 0.95 : 2.7, len - d), a = d, b = d + w;
      wall(x0 + ux * a, z0 + uz * a, x0 + ux * b, z0 + uz * b, 0, 3.2, stone ? trav([w / 1.2, 2]) : wal([w / 1.35, 1]), { flip });
      if (stone) box(Math.abs(ux) * w + Math.abs(uz) * 0.08, 3.2, Math.abs(uz) * w + Math.abs(ux) * 0.08, trav([0.8, 2]), x0 + ux * (a + w / 2) + nx * 0.04, 1.6, z0 + uz * (a + w / 2) + nz * 0.04, { cast: false });
      else if (lift && i !== 5) {
        const cx = x0 + ux * (a + w / 2), cz = z0 + uz * (a + w / 2);
        box(Math.abs(ux) * 1.25 + 0.03, 2.25, Math.abs(uz) * 1.25 + 0.03, bronze, cx + nx * 0.015, 1.125, cz + nz * 0.015, { cast: false });
        box(Math.abs(ux) * 0.012 + Math.abs(uz) * 0.035, 2.2, Math.abs(uz) * 0.012 + Math.abs(ux) * 0.035, M('#2a2018'), cx + nx * 0.035, 1.1, cz + nz * 0.035, { cast: false });
        box(0.07, 0.16, 0.07, chrome, cx + ux * 0.85 + nx * 0.04, 1.15, cz + uz * 0.85 + nz * 0.04, { cast: false });
      }
      d += w; i++;
    }
  };
  bays(L.x0, L.z0, L.x1, L.z0, false, true);        // north wall, with lift doors
  bays(L.x0, L.z1, L.x0, L.z0, false, false);       // west wall
  bays(L.x1, L.z0, L.x1, -7.0, false, false);       // east wall, north of the opening
  bays(L.x1, -4.4, L.x1, L.z1, false, false);       // east wall, south of the opening
  box(0.12, 0.7, 2.6, trav([2, 0.5]), L.x1, 2.85, -5.7, { cast: false });
  wall(L.x1 + 4, -7, L.x1, -7, 0, 3.2, trav([3, 2]), { flip: true });
  wall(L.x1, -4.4, L.x1 + 4, -4.4, 0, 3.2, trav([3, 2]), { flip: true });
  // lobby face of the office front
  wall(3.4, O.z0 - 0.02, L.x0, O.z0 - 0.02, 0, 3.2, trav([2, 2]));
  wall(L.x1, O.z0 - 0.02, 9.2, O.z0 - 0.02, 0, 3.2, trav([2.6, 2]));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: T.purpleSign() }));
  sign.position.set(10.6, 1.8, L.z0 + 0.03); root.add(sign);
  plant(1.6, -2.2, 1.6, 0.3); plant(11.9, -2.2, 1.6, 0.3);

  // ───────────────────────── light rig
  const hemi = new THREE.HemisphereLight('#d7e4f2', '#9e8c76', 0.62); scene.add(hemi);
  const key = new THREE.DirectionalLight('#ffe9cf', 2.6);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 40 });
  key.shadow.bias = -0.0005; key.shadow.normalBias = 0.035; key.shadow.radius = 5;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#dfeaff', 0.55); scene.add(fill, fill.target);
  let zone = '';
  // The key light's shadow covers the shot rather than the whole floor: fewer casters to draw and finer texels. It is
  // framed once per shot (the cut hides the change) and re-centred only if the subject walks out of it, so it never
  // swims with a moving camera. Without a shot (free / plan view) it falls back to the zone's full ±9 m box.
  const zoneAim = { pos: new THREE.Vector3(), target: new THREE.Vector3() }, shadowAt = new THREE.Vector3();
  let shadowShot = null, shadowR = 9;
  const frameShadow = (shot, look, cam) => {
    const box = (r) => { Object.assign(key.shadow.camera, { left: -r, right: r, top: r, bottom: -r }); key.shadow.camera.updateProjectionMatrix(); };
    if (shot == null) {
      if (shadowShot !== 'zone') { shadowShot = 'zone'; key.position.copy(zoneAim.pos); key.target.position.copy(zoneAim.target); key.target.updateMatrixWorld(); shadowR = 9; box(9); }
      return;
    }
    const r = Math.min(9, Math.max(4, Math.ceil(look.distanceTo(cam) * 1.1 + 2.5)));
    if (shot === shadowShot && look.distanceTo(shadowAt) < shadowR * 0.45 && r <= shadowR) return;
    shadowShot = shot; shadowR = r; shadowAt.copy(look).lerp(cam, 0.35); shadowAt.y = 0;
    key.target.position.copy(shadowAt); key.position.copy(shadowAt).add(zoneAim.pos).sub(zoneAim.target); key.target.updateMatrixWorld(); box(r);
  };
  const setZone = (z) => {
    if (z === zone) return; zone = z;
    if (z === 'lobby') {
      key.target.position.set(6, 0, -5); key.position.set(9.5, 8, 0.5); key.color.set('#ffe6c6'); key.intensity = 2.0;
      fill.target.position.set(6, 0, -5); fill.position.set(2, 5, -9); fill.intensity = 0.45; hemi.intensity = 0.6;
    } else {
      key.target.position.set(0.5, 0, 5); key.position.set(-10, 6.5, 10); key.color.set('#ffe9cf'); key.intensity = 2.7;
      fill.target.position.set(0.5, 0, 4); fill.position.set(8, 5, -2); fill.intensity = 0.4; hemi.intensity = 0.62;
    }
    key.target.updateMatrixWorld(); fill.target.updateMatrixWorld();
    zoneAim.pos.copy(key.position); zoneAim.target.copy(key.target.position); shadowShot = null;
  };
  setZone('office');

  return { root, glass, seats, setZone, frameShadow };
}
