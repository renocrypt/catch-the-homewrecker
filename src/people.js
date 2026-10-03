// Stylised figures. Each Person is a small procedural rig:
//   root (world x/z + heading)  →  inner (uniform height scale)  →  torso group, limbs, head
// Arms and legs are two-bone IK chains solved every frame, so poses are authored as
// hand targets in the torso frame and "grabs" as world-space points on other people.
//
// People differ in two ways:
//   body  — silhouette: shoulder / chest / waist / hip widths, neck, face shape, limb thickness
//   style — temperament: posture (slouch, chin, shrug, stance, weight shift) and how they move
//           (sway, tempo, how hard they jab when they talk, how much they fidget)
import * as THREE from 'three';
import * as T from './textures.js';
import { loadModel, dimsFor, Actor } from './actors.js';

const DOWN = new THREE.Vector3(0, -1, 0), RING = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const HIP = 0.9, SHO_Y = 0.44;
const UP_ARM = 0.27, FORE = 0.25, THIGH = 0.44, SHIN = 0.42, ANKLE = 0.07, STRIDE = 0.62;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), v5 = new THREE.Vector3(), v6 = new THREE.Vector3(), v7 = new THREE.Vector3(), v8 = new THREE.Vector3();
const m4 = new THREE.Matrix4();

// hand targets in the torso frame: [out (away from centre line), up (from hips), forward], optional elbow-out 0..1
export const HAND = {
  hang: [0.235, -0.07, 0.03, 0],
  clasp: [0.03, 0.03, 0.17, 0.25],
  hip: [0.215, 0.06, -0.01, 1],
  chest: [-0.01, 0.3, 0.15, 0.5],
  point: [0.1, 0.42, 0.56, 0.1],
  pointLow: [0.12, 0.3, 0.5, 0.1],
  pointSide: [0.6, 0.42, 0.1, 0.2],
  pointUp: [0.27, 0.5, 0.22, 0.3],
  open: [0.3, 0.2, 0.3, 0.3],
  openHi: [0.32, 0.4, 0.3, 0.35],
  up: [0.25, 0.5, 0.2, 0.5],
  reach: [0.07, 0.3, 0.5, 0.15],
  reachLow: [0.1, 0.16, 0.42, 0.15],
  cross: [-0.11, 0.22, 0.17, 0.9],
  hair: [0.1, 0.72, 0.03, 0.9],
  back: [0.27, 0.02, -0.24, 0.3],
  high: [0.3, 0.78, 0.12, 0.4],
  held: [0.3, 0.22, 0.1, 1],
  folder: [0.05, 0.22, 0.2, 0.5],
  bag: [0.2, 0.14, 0.17, 0.4],
  palm: [0.16, 0.36, 0.36, 0.3],
  table: [0.16, -0.1, 0.34, 0.3],
  shoo: [0.3, 0.3, 0.4, 0.4],
  guard: [0.04, 0.2, 0.2, 0.6],
};

const BODY_F = { sw: 0.172, chest: 0.138, waist: 0.112, hip: 0.152, depth: 0.74, neck: 0.085, neckR: 0.034, face: [0.94, 1.06], arm: 0.88, leg: 0.064, bust: 0.5, belly: 0, pad: 0, hand: 0.92 };
const BODY_M = { sw: 0.212, chest: 0.168, waist: 0.148, hip: 0.15, depth: 0.78, neck: 0.075, neckR: 0.046, face: [0.99, 1.04], arm: 1.08, leg: 0.07, bust: 0, belly: 0, pad: 0.6, hand: 1.12 };
const STYLE = { slouch: 0, chin: 0, shrug: 0, stance: 0, hipShift: 0, sway: 0.5, tempo: 1, jab: 0.3, fidget: 0, headTilt: 0 };

const matCache = new Map();
function mat(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.62, ...o }));
  return matCache.get(k);
}
const geoCache = new Map();
const geo = (key, make) => { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); };
const capsule = (r, len) => geo(`cap${r.toFixed(4)}_${len}`, () => new THREE.CapsuleGeometry(r, len, 8, 22).translate(0, -len / 2, 0));
const physical = (o) => new THREE.MeshPhysicalMaterial({ roughness: 0.6, ...o });
const SPH = () => geo('sph', () => new THREE.SphereGeometry(1, 32, 24));
// A lathe-like shell whose front opening can change with height: pts = [{x: r, y}] profile, halfGap(y) = half
// opening angle at that height (0 = closed). Same vertex budget as a LatheGeometry with `segs` segments.
function shell(pts, segs, depth, halfGap) {
  const pos = [], uv = [], idx = [], rows = pts.length;
  for (let i = 0; i < rows; i++) {
    const { x: r, y } = pts[i], h = halfGap(y);
    for (let j = 0; j <= segs; j++) { const phi = h + (Math.PI * 2 - 2 * h) * (j / segs); pos.push(r * Math.sin(phi), y, r * Math.cos(phi) * depth); uv.push(j / segs, i / (rows - 1)); }
  }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < segs; j++) { const a = i * (segs + 1) + j, b = a + segs + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals(); return g;
}
// cloth: matte with a soft sheen, so even near-black suits show their folds and edges
const cloth = (c, o = {}) => physical({ color: c, roughness: 0.78, sheen: 0.45, sheenColor: new THREE.Color('#9aa0ad'), sheenRoughness: 0.55, ...o });
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getStyle();

export class Person {
  constructor(spec) {
    this.spec = spec; this.id = spec.id;
    const sc = this.scale = (spec.h || 1.65) / 1.65;
    // skeleton proportions: the defaults fit the primitive body; a rigged model supplies its own (actors.js dimsFor)
    const D = this.dims = { hip: HIP, sho: SHO_Y, up: UP_ARM, fore: FORE, thigh: THIGH, shin: SHIN, ankle: ANKLE, ...(spec.dims || {}) };
    const B = this.body = { ...(spec.female ? BODY_F : BODY_M), ...(spec.body || {}), ...(D.sw ? { sw: D.sw } : {}) };
    this.style = { ...STYLE, ...(spec.style || {}) };
    this.headY = D.headY ?? 0.585 + B.neck;
    // animated state — every number here is a channel on the Anime.js timeline
    this.s = {
      x: 0, z: 0, ry: 0, dist: 0, gait: 0, sit: 0, talk: 0, lean: 0, twist: 0, hx: 0, hp: 0, tilt: 0,
      brow: 0, eye: 0, tear: 0, point: 0, shake: 0, crouch: 0, hide: 0, shrink: 0, recoil: 0,
      lhx: HAND.hang[0], lhy: HAND.hang[1], lhz: HAND.hang[2], lpo: 0, lg: 0,
      rhx: HAND.hang[0], rhy: HAND.hang[1], rhz: HAND.hang[2], rpo: 0, rg: 0,
    };
    this.grab = { l: null, r: null };   // () => world Vector3
    this.lookAt = null;                 // () => world Vector3
    this.seed = [...spec.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 1000 / 100;
    this._yaw = 0; this._pitch = 0;
    this.wrist = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    this.elbow = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    this.knee = { l: new THREE.Vector3(), r: new THREE.Vector3() }; this.ankle = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    this.target = { l: new THREE.Vector3(), r: new THREE.Vector3() };

    const root = this.root = new THREE.Group(); root.name = spec.id;
    const inner = this.inner = new THREE.Group(); inner.scale.setScalar(sc); root.add(inner);
    const mk = (g, m, parent = inner, cast = true) => { const me = new THREE.Mesh(g, m); me.castShadow = cast; me.receiveShadow = true; parent.add(me); return me; };
    const ball = (m, x, y, z, sx, sy, sz, parent, cast = false) => { const me = mk(SPH(), m, parent, cast); me.position.set(x, y, z); me.scale.set(sx, sy ?? sx, sz ?? sx); return me; };

    const skinC = spec.skin || '#efc8a8', skin = physical({ color: skinC, roughness: 0.52, sheen: 0.4, sheenColor: new THREE.Color('#ffb59a'), sheenRoughness: 0.7 });
    const topC = spec.jacket || spec.top, topM = spec.jacket ? cloth(topC) : spec.silk ? physical({ color: topC, roughness: 0.38, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.3, envMapIntensity: 1.1 }) : mat(topC, spec.topMap ? { map: spec.topMap } : {});
    const legM = mat(spec.legs.color, spec.legs.map ? { map: spec.legs.map } : {});
    const sleeveM = spec.sleeve === 'skin' ? skin : spec.jacket ? cloth(topC) : spec.silk ? topM : mat(spec.sleeve || topC);
    const sleeveR = spec.jacket ? 1.17 : 1;

    // ── torso: a lathe through the body's own profile, flattened front-to-back
    const prof = [[B.hip * 0.9, -0.03], [B.hip, 0.03], [(B.hip + B.waist) / 2, 0.11], [B.waist, 0.19], [(B.waist + B.chest) / 2, 0.26], [B.chest, 0.33], [B.chest * 0.97, 0.39], [B.sw * 0.74, 0.44], [B.neckR * 1.5, 0.485], [B.neckR, 0.51]];
    const rAt = (y) => { for (let i = 1; i < prof.length; i++) if (y <= prof[i][1]) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; return r0 + (r1 - r0) * ((y - y0) / (y1 - y0)); } return prof[prof.length - 1][0]; };
    const front = (y) => rAt(y) * B.depth;
    const torso = this.torso = new THREE.Group(); inner.add(torso);
    const tg = new THREE.LatheGeometry(new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(30), 30); tg.scale(1, 1, B.depth); tg.computeVertexNormals();
    this.trunk = mk(tg, topM, torso);
    const capS = B.pad ? [0.064 + 0.012 * B.pad, 0.05, 0.066] : spec.jacket ? [0.056 * Math.sqrt(B.arm) + 0.006, 0.054, 0.06] : [0.044 * Math.sqrt(B.arm), 0.038, 0.048];
    this.caps = [1, -1].map((s) => ball(topM, s * (B.sw - 0.014), SHO_Y - 0.012, 0, capS[0], capS[1], capS[2], torso, true));
    if (B.bust) ball(topM, 0, 0.3, front(0.3) * 0.62, B.chest * 0.84, 0.058 + 0.016 * B.bust, 0.04 + 0.04 * B.bust, torso);
    if (B.belly) ball(topM, 0, 0.14, front(0.14) * 0.55, B.waist * 0.92, 0.12, 0.05 + 0.08 * B.belly, torso);
    const fz = front(0.3) + (B.bust ? 0.012 + 0.02 * B.bust : 0.004);
    if (spec.jacket) { // the body lathe is the shirt; the jacket is a second, larger shell left open at the front
      const inn = mat(spec.inner || '#f2f2f0', spec.innerMap ? { map: spec.innerMap } : {});
      this.trunk.material = inn; this.caps.forEach((c) => (c.material = topM));
      const jl = spec.jacketLen ?? 0.2, gap = spec.gap ?? 0.7, pad = 0.011;
      const jp = [[B.hip * 1.07 + jl * 0.1, -jl], [B.hip * 1.06, -jl * 0.45], ...prof.filter(([, y]) => y > -0.03 && y <= 0.45).map(([r, y]) => [r + pad, y]), [B.sw * 0.6, 0.465]];
      const yb = spec.female ? 0.15 : 0.12;   // first button
      const halfGap = spec.openFront ? () => gap / 2 : (y) => {
        if (y < yb) return jl > 0.3 && y < 0.02 ? 0.1 : 0.05;                     // edges meet below the button (a long coat parts a little at the hem)
        const u = Math.min(1, (y - yb) / (0.465 - yb)); return 0.05 + (gap / 2 - 0.05) * u * (2 - u);   // V opening up to the collar
      };
      const jg = shell(new THREE.SplineCurve(jp.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(34), 44, B.depth, halfGap);
      const jm = spec.jacketMap ? physical({ color: '#ffffff', map: spec.jacketMap, bumpMap: spec.jacketMap, bumpScale: 0.6, roughness: 0.88, sheen: 0.7, sheenColor: new THREE.Color('#b9d6c2'), sheenRoughness: 0.8, side: THREE.DoubleSide }) : cloth(spec.jacket, { bumpMap: T.wool(), bumpScale: 0.25, side: THREE.DoubleSide });
      topM.bumpMap = jm.bumpMap; topM.bumpScale = jm.bumpScale; topM.needsUpdate = true;
      this.jacket = mk(jg, jm, torso);
      // lapels fold back from the front edges down to the first button
      const lapM = cloth(shade(spec.jacket, 0.82), { side: THREE.DoubleSide });
      for (const s of [1, -1]) {
        const sh = new THREE.Shape(); sh.moveTo(0, 0.455); sh.lineTo(s * 0.075, 0.41); sh.lineTo(s * 0.055, 0.3); sh.lineTo(s * 0.012, yb + 0.02); sh.lineTo(0, yb + 0.02); sh.closePath();
        const l = mk(new THREE.ShapeGeometry(sh), lapM, torso, false); const e = Math.sin(halfGap(0.35)) * (rAt(0.35) + pad);
        l.position.set(s * e * 0.6, 0, front(0.3) + pad + 0.01); l.rotation.y = -s * 0.5;
      }
      const btn = mat('#1b1b1e', { roughness: 0.3 });
      ball(btn, 0, yb, front(yb) + pad + 0.004, 0.009, 0.009, 0.004, torso);
      if (jl > 0.3) ball(btn, 0, yb - 0.1, front(yb - 0.1) + pad + 0.004, 0.009, 0.009, 0.004, torso);
      if (!spec.female) {
        for (const s of [1, -1]) { const c = mk(geo('shirtcollar', () => new THREE.BoxGeometry(0.05, 0.03, 0.01)), inn, torso, false); c.position.set(s * 0.03, 0.487, front(0.48) + 0.018); c.rotation.set(-0.4, s * 0.25, s * -0.6); }
        const belt = mk(new THREE.CylinderGeometry(B.hip * 1.0, B.hip * 1.0, 0.03, 24), mat('#1a1512', { roughness: 0.35 }), torso, false); belt.position.y = 0.025; belt.scale.z = B.depth;
        ball(mat('#b9b39a', { metalness: 0.8, roughness: 0.3 }), 0, 0.025, front(0.025) + 0.006, 0.016, 0.011, 0.005, torso);
      }
    } else if (spec.collar) {
      for (const s of [1, -1]) { const c = mk(geo('collar', () => new THREE.BoxGeometry(0.075, 0.035, 0.012)), mat(spec.top), torso, false); c.position.set(s * 0.045, 0.475, front(0.47) + 0.022); c.rotation.set(-0.5, s * 0.3, s * -0.55); }
      const pl = mk(geo('placket', () => new THREE.BoxGeometry(0.016, 0.3, 0.006)), mat(shade(spec.top, 0.9)), torso, false); pl.position.set(0, 0.26, fz + 0.002); pl.rotation.x = -0.06;
    }
    if (spec.tie) { const t = mk(geo('tie', () => new THREE.BoxGeometry(0.04, 0.27, 0.01)), mat(spec.tie, spec.tieMap ? { map: spec.tieMap } : {}), torso, false); t.position.set(0, 0.3, fz + 0.008); t.rotation.x = -0.1; }
    const neck = mk(new THREE.CylinderGeometry(B.neckR, B.neckR * 1.15, B.neck + 0.06, 14), skin, torso, false); neck.position.y = 0.5 + B.neck / 2;
    if (spec.necklace) { const n = mk(geo('necklace', () => new THREE.TorusGeometry(0.05, 0.0024, 6, 28)), mat('#d9bd6a', { metalness: 0.8, roughness: 0.3 }), torso, false); n.position.set(0, 0.478, 0.018); n.rotation.x = Math.PI / 2 - 0.45; }
    if (spec.brooch) ball(mat('#e2c35e', { metalness: 0.8, roughness: 0.25 }), -0.075, 0.37, fz + 0.01, 0.013, 0.013, 0.006, torso);

    // ── pelvis, skirt / jacket hem
    const pelvis = this.pelvis = new THREE.Group(); inner.add(pelvis);
    ball(spec.legs.type === 'pants' ? legM : mat(spec.legs.color), 0, -0.03, 0, B.hip * 1.03, 0.115, B.hip * B.depth * 1.05, pelvis, true);
    if (spec.legs.type !== 'pants') {
      const len = spec.legs.len || 0.5, flare = spec.legs.flare ?? 0.07;
      const sg = new THREE.CylinderGeometry(B.hip * 0.98, B.hip * 0.98 + flare, len, 48, 8, false).translate(0, -len / 2, 0);
      const pa = sg.attributes.position, folds = spec.legs.folds ?? 9;
      for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), a = Math.atan2(z, x), tt = -y / len, k = 1 + 0.045 * tt * tt * Math.sin(folds * a); pa.setXYZ(i, x * k, y, z * k); }
      sg.computeVertexNormals();
      const wb = mk(new THREE.CylinderGeometry(B.hip * 1.0, B.hip * 1.0, 0.028, 24), mat(shade(spec.legs.color, 0.85)), pelvis, false); wb.position.y = 0.05; wb.scale.z = B.depth + 0.08;
      const sk = this.skirt = mk(sg, legM, pelvis); sk.position.y = 0.04; sk.scale.z = B.depth + 0.1;
      if (spec.legs.panel) { const p = mk(new THREE.PlaneGeometry(0.13, len * 0.97).translate(0, -len / 2, 0), mat(spec.legs.panel), pelvis, false); p.position.set(0, 0.035, (B.hip * 0.98 + flare * 0.5) * (B.depth + 0.1) + 0.004); p.rotation.x = -Math.atan(flare * 0.85 / len); }
    }
    if (spec.blossoms) {
      const bm = new THREE.MeshStandardMaterial({ map: T.blossoms(), transparent: true, roughness: 0.8, depthWrite: false });
      const p1 = mk(new THREE.PlaneGeometry(0.2, 0.26), bm, torso, false); p1.position.set(0.1, -0.2, B.hip * B.depth * 1.09 + 0.012); p1.rotation.y = 0.45;
      const p2 = mk(new THREE.PlaneGeometry(0.11, 0.14), bm, torso, false); p2.position.set(0.105, 0.33, fz + 0.002); p2.rotation.y = 0.5;
    }
    // clothed-body cross-section at torso height y: [half width, depth in front, depth behind], used to keep hands and forearms out of the body
    const bumps = [];
    if (B.bust) bumps.push({ y: 0.3, ry: 0.058 + 0.016 * B.bust, dz: Math.max(0, front(0.3) * 0.62 + 0.04 + 0.04 * B.bust - front(0.3)) });
    if (B.belly) bumps.push({ y: 0.14, ry: 0.12, dz: Math.max(0, front(0.14) * 0.55 + 0.05 + 0.08 * B.belly - front(0.14)) });
    const padR = spec.jacket ? 0.011 : 0, padZ = spec.jacket ? 0.021 : 0.004;   // jacket shell + lapels / shirt placket
    this.sleeveR = sleeveR;
    this.section = (y) => {
      const r = rAt(Math.max(-0.03, Math.min(0.5, y))) + padR;
      let f = r * B.depth + padZ;
      for (const b of bumps) { const u = (y - b.y) / b.ry; if (Math.abs(u) < 1) f += b.dz * Math.sqrt(1 - u * u); }
      return [r, f, r * B.depth];
    };

    // ── limbs (re-posed every frame by IK)
    const bare = spec.legs.type !== 'pants';
    const hose = mat(spec.legs.hose || (bare ? skinC : spec.legs.color));
    this.arm = {}; this.leg = {};
    for (const side of ['l', 'r']) {
      const hand = new THREE.Group(); inner.add(hand); const sgn = side === 'l' ? 1 : -1;
      ball(skin, 0, 0, 0, 0.036 * B.hand, 0.05 * B.hand, 0.026 * B.hand, hand, true); ball(skin, sgn * 0.03 * B.hand, 0.012, 0.012, 0.011 * B.hand, 0.019 * B.hand, 0.009, hand);
      const finger = mk(capsule(0.011, 0.075), skin, inner, false);
      const cuff = spec.jacket ? mk(new THREE.CylinderGeometry(0.04 * B.arm * sleeveR + 0.003, 0.04 * B.arm * sleeveR + 0.003, 0.022, 16), mat(spec.inner || '#f2f2f0'), inner, false) : null;
      this.arm[side] = { up: mk(capsule(0.047 * B.arm * sleeveR, UP_ARM), sleeveM), fo: mk(capsule(0.04 * B.arm * sleeveR, FORE - (cuff ? 0.02 : 0)), spec.forearm === 'skin' ? skin : sleeveM), hand, finger, cuff };
      const shoe = new THREE.Group(); inner.add(shoe);
      const shoeM = physical({ color: spec.shoes || '#141416', roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.22 });
      if (spec.female) { ball(shoeM, 0, 0, 0.01, 0.038, 0.024, 0.1, shoe, true); const heel = mk(new THREE.CylinderGeometry(0.009, 0.011, 0.04, 10), shoeM, shoe, false); heel.position.set(0, -0.014, -0.065); }
      else { ball(shoeM, 0, 0.004, 0.012, 0.048, 0.034, 0.125, shoe, true); const sole = mk(new THREE.BoxGeometry(0.09, 0.012, 0.245), mat('#2a2622', { roughness: 0.6 }), shoe, false); sole.position.set(0, -0.027, 0.012); }
      this.leg[side] = { th: mk(capsule(B.leg, THIGH), bare ? hose : legM), sh: mk(capsule(B.leg * 0.76, SHIN), bare ? hose : legM), shoe };
      if (spec.legs.type === 'long') this.leg[side].th.visible = false;
    }

    // ── head
    const head = this.head = new THREE.Group(); head.position.y = this.headY; torso.add(head);
    const [fx, fy] = B.face;
    const skull = mk(geo('skull', () => new THREE.SphereGeometry(0.118, 40, 30)), skin, head); skull.scale.set(fx, fy, 1);
    if (!spec.female) ball(skin, 0, -0.058, 0.004, 0.1 * fx, 0.06, 0.084, head);                 // squarer jaw
    if (spec.jowl) ball(skin, 0, -0.056, 0.0, 0.109 * fx, 0.052, 0.082, head);                  // soft, round lower face
    const e = spec.eye ?? 1, dark = mat('#1a1412', { roughness: 0.2 }), white = mat('#f6f3ee', { roughness: 0.4 });
    this.eyes = [1, -1].map((s) => {
      const g = new THREE.Group(); g.position.set(s * 0.043 * fx, 0.012, 0.1); head.add(g);
      ball(white, 0, 0, 0, 0.0185 * e, 0.0135 * e, 0.009, g); ball(dark, 0, 0, 0.004, 0.0098 * e, 0.0118 * e, 0.007, g);
      const hl = mk(SPH(), new THREE.MeshBasicMaterial({ color: '#ffffff' }), g, false); hl.position.set(-s * 0.0035 * e, 0.004 * e, 0.0105); hl.scale.setScalar(0.0024);
      if (spec.female) { const l = mk(geo('lash', () => new THREE.BoxGeometry(0.04, 0.0042, 0.006)), dark, g, false); l.scale.x = e; l.position.set(s * 0.002, 0.0125 * e, 0.007); l.rotation.z = s * 0.2; }
      if (spec.shadow) { const sh = ball(mat(spec.shadow, { roughness: 0.8 }), 0, 0.017 * e, 0.002, 0.02 * e, 0.008, 0.006, g); sh.rotation.z = s * 0.15; }
      return g;
    });
    const browM = mat(spec.hair?.color || '#1a1412'), bt = spec.browT ?? (spec.female ? 0.85 : 1.25);
    this.brows = [1, -1].map((s) => { const br = mk(geo('brow', () => new THREE.BoxGeometry(0.038, 0.0075, 0.008)), browM, head, false); br.scale.y = bt; br.position.set(s * 0.044 * fx, 0.052, 0.104); br.userData.s = s; return br; });
    this.mw = spec.mouth ?? (spec.female ? 0.9 : 1.05);
    const mouthG = new THREE.Group(); mouthG.position.set(0, -0.055, 0.1); head.add(mouthG);
    this.cavity = ball(mat('#3a1216', { roughness: 0.9 }), 0, 0, 0.0, 0.016, 0.001, 0.006, mouthG);
    this.teeth = mk(geo('teeth', () => new THREE.BoxGeometry(0.02, 0.006, 0.004)), mat('#f4f1ea', { roughness: 0.3 }), mouthG, false); this.teeth.visible = false;
    this.lips = mk(geo('lips', () => new THREE.TorusGeometry(1, 0.2, 8, 30)), physical({ color: spec.lips || (spec.female ? '#a8434c' : '#96564f'), roughness: 0.4, clearcoat: spec.lips ? 0.5 : 0, clearcoatRoughness: 0.3 }), mouthG, false);
    this.lips.position.z = 0.006; this.lips.scale.set(0.02, 0.006, 0.004);
    ball(mat(shade(skinC, 0.93)), 0, -0.014, 0.116, 0.012 * (spec.nose ?? 1), 0.013 * (spec.nose ?? 1), 0.012, head);
    ball(skin, 0.112 * fx, -0.005, 0, 0.018, 0.026, 0.02, head); ball(skin, -0.112 * fx, -0.005, 0, 0.018, 0.026, 0.02, head);
    const blushM = new THREE.MeshBasicMaterial({ color: '#e98c86', transparent: true, opacity: spec.rouge ?? (spec.female ? 0.3 : 0.1), depthWrite: false });
    for (const s of [1, -1]) { const c = mk(geo('blush', () => new THREE.CircleGeometry(0.022, 16)), blushM, head, false); c.position.set(s * 0.072 * fx, -0.03, 0.089); c.rotation.y = s * 0.7; }
    const tearM = this.tearM = new THREE.MeshStandardMaterial({ color: '#cfeaf7', transparent: true, opacity: 0, roughness: 0.05, depthWrite: false });
    for (const s of [1, -1]) ball(tearM, s * 0.05 * fx, -0.014, 0.103, 0.006, 0.014, 0.004, head);
    if (spec.earrings) for (const s of [1, -1]) ball(mat('#f7f3ea', { roughness: 0.2 }), s * 0.117 * fx, -0.034, 0.004, 0.012, 0.012, 0.012, head);
    if (spec.glasses) for (const s of [1, -1]) { const g = mk(geo('glass', () => new THREE.TorusGeometry(0.024, 0.0028, 6, 20)), mat('#2a2a2e', { metalness: 0.6, roughness: 0.3 }), head, false); g.position.set(s * 0.043 * fx, 0.012, 0.113); }
    const hairG = new THREE.Group(); hairG.scale.set(fx / 0.95, 1, 1); head.add(hairG);
    this.buildHair(hairG, spec.hair || { style: 'short', color: '#1a1412' }, mk, ball);
    if (spec.cap) {
      const cm = mat(spec.jacket);
      const crown = mk(new THREE.CylinderGeometry(0.135, 0.122, 0.055, 22), cm, head); crown.position.y = 0.118;
      const band = mk(new THREE.CylinderGeometry(0.123, 0.123, 0.03, 22), mat('#11141f'), head, false); band.position.y = 0.083;
      const visor = mk(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 18, 1, false, -1.1, 2.2), mat('#0c0d12', { roughness: 0.25 }), head, false); visor.position.set(0, 0.07, 0.07); visor.rotation.x = 0.2;
      ball(mat('#d9c06a', { metalness: 0.7, roughness: 0.3 }), 0, 0.105, 0.128, 0.014, 0.014, 0.006, head);
    }

    // ── props
    this.props = [];
    if (spec.bag) { // carried in the crook of the left arm: a ring round the forearm, straps and bag hanging from it
      const bm = physical({ color: spec.bag, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 });
      const ring = mk(new THREE.TorusGeometry(0.064, 0.008, 8, 26), bm, inner, false);
      const g = new THREE.Group(); inner.add(g);
      for (const sx of [1, -1]) { const st = mk(new THREE.BoxGeometry(0.012, 0.13, 0.008), bm, g, false); st.position.set(sx * 0.058, -0.065, 0); }
      const bb = mk(new THREE.BoxGeometry(0.27, 0.19, 0.1), bm, g); bb.position.y = -0.225;
      const flap = mk(new THREE.BoxGeometry(0.27, 0.07, 0.012), bm, g, false); flap.position.set(0, -0.165, 0.056);
      ball(mat('#d9bd6a', { metalness: 0.8, roughness: 0.3 }), 0, -0.19, 0.064, 0.014, 0.012, 0.006, g);
      this.props.push({ g, ring, at: 'bag' });
    }
    if (spec.folder) {
      const g = new THREE.Group(); inner.add(g);
      const f = mk(new THREE.BoxGeometry(0.24, 0.32, 0.012), mat(spec.folder, { roughness: 0.5 }), g); f.position.set(0, 0.06, 0.02);
      this.props.push({ g, at: 'folder' });
    }
    if (spec.ruffle) for (let i = 0; i < 7; i++) ball(mat('#f6f5f1'), (i % 2 ? 1 : -1) * 0.018, 0.455 - i * 0.027, fz + 0.006 + (i % 3) * 0.004, 0.027, 0.02, 0.014, torso);
    // a rigged model takes over the look: the primitive body stays as the (invisible) rig it is posed from
    this.hidden = !!spec.model;
    if (this.hidden) {
      const keep = new Set(); for (const pr of this.props) { pr.g.traverse((o) => keep.add(o)); if (pr.ring) keep.add(pr.ring); }
      inner.traverse((o) => { if (o.isMesh && !keep.has(o)) o.visible = false; });   // the model hangs off root, not inner
    }
    if (spec.badge) { const bd = mk(new THREE.BoxGeometry(0.045, 0.035, 0.006), mat('#c9ccd4', { metalness: 0.6, roughness: 0.3 }), torso, false); bd.position.set(0.085, 0.36, fz + 0.004); for (const s of [1, -1]) { const ep = mk(new THREE.BoxGeometry(0.07, 0.012, 0.04), mat('#11141f'), torso, false); ep.position.set(s * (B.sw - 0.03), 0.47, 0); } const belt = mk(new THREE.CylinderGeometry(B.waist * 1.04, B.waist * 1.04, 0.035, 18), mat('#0d0d10'), torso, false); belt.position.y = 0.08; belt.scale.z = B.depth; }
  }

  buildHair(head, hair, mk, ball) {
    const m = mat(hair.color, { roughness: 0.64 }), r = T.rng(Math.round(this.seed * 100) + 3);
    const cap = (sx = 1, sy = 1, sz = 1, y = 0.014, z = -0.03) => ball(m, 0, y, z, 0.128 * sx, 0.128 * sy, 0.128 * sz, head, true);
    const curls = (n, r0, r1, low, tint, R = 0.108) => {
      for (let i = 0; i < n; i++) {
        const u = r() * 2 - 1, a = r() * Math.PI * 2, y = low + (1 - low) * (0.5 + 0.5 * u);
        const rad = Math.sqrt(Math.max(0, 1 - y * y)), x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        if (z > 0.42 && y < 0.62) continue;                       // keep the face clear
        const s = r0 + r() * (r1 - r0);
        ball(tint && r() < 0.3 ? mat(tint, { roughness: 0.5 }) : m, x * R, y * R * 1.05 + 0.012, z * R - 0.012, s, s, s, head, i % 3 === 0);
      }
    };
    switch (hair.style) {
      case 'perm': cap(0.93, 0.93, 0.93); curls(170, 0.021, 0.031, -0.3); break;
      case 'wavy': cap(0.96, 0.96, 0.96); curls(110, 0.026, 0.038, -0.7, hair.tint, 0.112); break;
      case 'bob': {
        cap(1.02, 1.0, 1.04);
        for (const s of [1, -1]) { ball(m, s * 0.103, -0.055, -0.03, 0.05, 0.115, 0.072, head, true); ball(m, s * 0.098, -0.14, -0.012, 0.045, 0.05, 0.06, head); }
        ball(m, 0, -0.07, -0.075, 0.115, 0.115, 0.07, head, true);
        break;
      }
      case 'pony': cap(1, 0.98, 1); { const p = mk(capsule(0.024, 0.2), m, head); p.position.set(0, 0.03, -0.135); p.rotation.x = -0.3; this.pony = p; ball(m, 0, 0.05, -0.125, 0.04, 0.04, 0.04, head); } break;
      case 'bun': cap(1, 0.98, 1); ball(m, 0, 0.03, -0.14, 0.05, 0.05, 0.045, head, true); break;
      case 'topknot': cap(1, 0.98, 1); ball(m, 0, 0.15, -0.03, 0.05, 0.045, 0.05, head, true); break;
      case 'long': cap(1.02, 1, 1.03); ball(m, 0, -0.15, -0.075, 0.105, 0.2, 0.055, head, true); for (const s of [1, -1]) ball(m, s * 0.1, -0.1, -0.005, 0.04, 0.17, 0.06, head); break;
      case 'crop': cap(0.97, 0.9, 0.97, 0.02, -0.022); break;
      case 'side': cap(0.99, 0.94, 0.99, 0.022, -0.026); ball(m, 0.035, 0.1, 0.045, 0.085, 0.036, 0.065, head); break;
      default: cap(0.98, 0.93, 0.98, 0.022, -0.026); ball(m, 0, 0.1, 0.05, 0.075, 0.035, 0.06, head);
    }
  }

  // nominal head position in world space (no bob), used for camera framing
  headPos(out = new THREE.Vector3()) {
    const s = this.s, y = (this.dims.hip - s.sit * 0.4 - s.crouch * 0.12 + this.headY) * this.scale, f = Math.sin(s.lean + this.style.slouch) * this.headY * this.scale;
    return out.set(s.x + Math.sin(s.ry) * f, y, s.z + Math.cos(s.ry) * f);
  }
  pos(out = new THREE.Vector3()) { return out.set(this.s.x, 0, this.s.z); }
  wristWorld(side, out = new THREE.Vector3()) { return this.inner.localToWorld(out.copy(this.wrist[side])); }
  elbowWorld(side, out = new THREE.Vector3()) { return this.inner.localToWorld(out.copy(this.elbow[side])); }

  // How far a torso-space point sits inside the clothed body inflated by `clear` (0 = outside).
  // The body is an ellipse at each height; hands above the shoulders are left alone.
  inside(p, clear) {
    if (p.y > 0.5) return 0;
    const [a, f, bk] = this.section(p.y), b = (p.z >= 0 ? f : bk) + clear, aa = a + clear;
    const n = Math.hypot(p.x / aa, p.z / b);
    return n < 1 ? (1 - n) * Math.min(aa, b) : 0;
  }

  // Move a torso-space point radially out of the inflated body. Returns true if it moved.
  keepOut(p, clear) {
    const d = this.inside(p, clear);
    if (d <= 0) return false;
    const [a, f, bk] = this.section(p.y), b = (p.z >= 0 ? f : bk) + clear, aa = a + clear;
    const n = Math.max(1e-3, Math.hypot(p.x / aa, p.z / b));
    p.x /= n; p.z /= n;
    return true;
  }

  solve(a, b, len1, len2, start, target, pole, outMid, outEnd) {
    const d = v4.subVectors(target, start); let dist = d.length();
    const max = (len1 + len2) * 0.995; dist = Math.min(Math.max(dist, Math.abs(len1 - len2) + 0.02), max);
    d.normalize();
    const cosA = (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const perp = v5.copy(pole).addScaledVector(d, -pole.dot(d)); if (perp.lengthSq() < 1e-6) perp.set(0, 0, -1); perp.normalize();
    outMid.copy(start).addScaledVector(d, len1 * cosA).addScaledVector(perp, len1 * sinA);
    outEnd.copy(start).addScaledVector(d, dist);
    a.position.copy(start); a.quaternion.setFromUnitVectors(DOWN, v4.subVectors(outMid, start).normalize());
    b.position.copy(outMid); b.quaternion.setFromUnitVectors(DOWN, v4.subVectors(outEnd, outMid).normalize());
  }

  update(t, dt) {
    const s = this.s, sp = this.spec, st = this.style, B = this.body, D = this.dims, root = this.root, torso = this.torso, sd = this.seed;
    const long = sp.legs.type === 'long';
    const ph = (s.dist / (STRIDE * this.scale * (long ? 0.8 : 1))) * Math.PI, g = s.gait;
    const jit = s.shake ? Math.sin(t * 31 + sd) * 0.012 * s.shake : 0;
    root.visible = s.hide < 0.5; root.position.set(s.x, 0, s.z); root.rotation.y = s.ry;
    const still = 1 - Math.min(1, g + s.sit);
    const talk = Math.min(s.talk, 1.7), syl = talk * Math.abs(Math.sin(t * 12.7 + sd * 3) * Math.sin(t * 4.3 + sd));
    const loud = Math.max(0, talk - 1) * 1.6;                                   // how much of this is shouting
    const tight = Math.min(1.2, st.shrug + s.shrink + s.recoil * 0.7);          // shoulders up and in
    const hipX = (st.hipShift * 0.028 + Math.sin(t * st.tempo * 0.5 + sd) * st.sway * 0.012 + Math.sin(t * 1.3 + sd) * 0.008 * st.fidget) * still;
    const hipY = D.hip - s.sit * 0.4 - s.crouch * 0.12 + Math.abs(Math.sin(ph)) * 0.024 * g - Math.abs(st.hipShift) * 0.008 * still, hipZ = -s.sit * 0.06;
    torso.position.set(jit + hipX, hipY, hipZ - s.recoil * 0.03);
    torso.rotation.set(
      s.lean + st.slouch + s.shrink * 0.07 - s.recoil * 0.1 + g * 0.06 + syl * (0.02 + 0.045 * st.jab * (0.5 + loud)),
      s.twist + Math.sin(ph) * 0.07 * g + Math.sin(t * 0.55 * st.tempo + sd) * 0.02 * st.sway,
      Math.sin(ph) * 0.025 * g - st.hipShift * 0.045 * still + Math.sin(t * 0.4 * st.tempo + sd * 2) * 0.012 * st.sway, 'YXZ');
    this.trunk.scale.y = 1 + Math.sin(t * 1.5 * st.tempo + sd) * (0.005 + 0.008 * loud);
    this.pelvis.position.set(hipX * 1.2, hipY, hipZ); this.pelvis.rotation.set(s.sit * 1.25 + (this.skirt ? Math.sin(ph * 2) * 0.03 * g : 0), Math.sin(ph) * -0.05 * g, st.hipShift * 0.05 * still);
    const shoX = B.sw * (1 - 0.1 * tight), shoY = D.sho + 0.03 * tight; this.tight = tight;
    this.caps[0].position.set(shoX - 0.014, shoY - 0.012, 0.012 * tight); this.caps[1].position.set(-shoX + 0.014, shoY - 0.012, 0.012 * tight);
    torso.updateMatrix(); root.updateMatrixWorld(true);

    // head: look target + authored offsets + temperament
    let wantYaw = 0, wantPitch = 0;
    const look = this.lookAt && this.lookAt();
    if (look) {
      const l = this.inner.worldToLocal(v1.copy(look));
      wantYaw = THREE.MathUtils.clamp(Math.atan2(l.x, l.z) - s.twist, -1.25, 1.25);
      wantPitch = THREE.MathUtils.clamp(-Math.atan2(l.y - (hipY + this.headY), Math.hypot(l.x, l.z)) - s.lean, -0.5, 0.5);
    }
    const k = dt > 0.2 ? 1 : 1 - Math.exp(-dt * (5 + 5 * st.tempo));
    this._yaw += (wantYaw - this._yaw) * k; this._pitch += (wantPitch - this._pitch) * k;
    this.head.position.set(0, this.headY - 0.012 * tight, st.slouch * 0.14 + s.shrink * 0.02 + syl * 0.014 * st.jab * (0.5 + loud));
    this.head.rotation.set(
      this._pitch * 0.8 + s.hp + st.slouch * 0.5 - st.chin + s.shrink * 0.16 + s.recoil * 0.05 + syl * 0.05 + Math.sin(t * 0.7 * st.tempo + sd) * 0.012,
      this._yaw * 0.85 + s.hx + s.recoil * 0.25 * (sd % 2 > 1 ? 1 : -1) + Math.sin(t * 2.1 + sd) * 0.03 * talk,
      st.headTilt + s.tilt + Math.sin(t * 0.33 * st.tempo + sd) * 0.02 * st.sway, 'YXZ');
    if (this.pony) this.pony.rotation.z = Math.sin(ph) * 0.25 * g + Math.sin(t * 2.3 + sd) * 0.05 * talk;

    // face
    const blink = (t * (0.26 + 0.12 * st.fidget) + sd) % 1 < 0.035 ? 1 : 0, lid = Math.max(blink, s.eye, s.recoil * 0.95);
    for (const e of this.eyes) e.scale.y = 1 - lid * 0.88;
    const brow = s.brow - s.recoil * 0.5 + (loud > 0.3 && s.brow > 0 ? 0.2 : 0);
    for (const b of this.brows) { const sgn = b.userData.s; b.rotation.z = sgn * brow * 0.42; b.position.y = 0.052 - brow * 0.007 + (brow < 0 ? 0.004 : 0); }
    const open = Math.min(1, syl * (0.55 + 0.45 * Math.min(talk, 1.5)) + s.recoil * 0.25);
    const mw = (0.02 + 0.006 * Math.min(talk, 1.5) - (brow < 0 ? 0.003 : 0)) * this.mw;
    this.lips.scale.set(mw * (1 - open * 0.15), 0.0045 + open * 0.015, 0.0035); this.cavity.scale.set(mw * 0.72, 0.001 + open * 0.014, 0.006);
    this.teeth.visible = !this.hidden && open > 0.2; this.teeth.position.set(0, 0.003 + open * 0.012, 0.004);
    this.tearM.opacity = s.tear;
    this.face = { brow, lid, open, loud, tear: s.tear, recoil: s.recoil };

    // arms
    const inv = m4.copy(torso.matrix).invert();   // inner -> torso space, for the keep-out checks
    for (const side of ['l', 'r']) {
      const sg = side === 'l' ? 1 : -1, A = this.arm[side];
      const sho = v1.set(sg * shoX, shoY, 0.012 * tight).applyMatrix4(torso.matrix);
      const hx = s[side + 'hx'], hy = s[side + 'hy'], hz = s[side + 'hz'], po = s[side + 'po'];
      const idle = Math.max(0, 1 - Math.hypot(hx - HAND.hang[0], hy - HAND.hang[1], hz - HAND.hang[2]) * 6);
      const busy = 1 - idle, ges = talk * (sp.gest ?? 0.5) * (0.35 + busy * 0.65);
      const jab = side === 'r' && s.point > 0.3 ? syl * 0.085 * st.jab * (0.6 + loud) : 0;   // the accusing finger stabs with each syllable
      const loc = v8.set(
        sg * (hx * (1 - 0.25 * tight * idle) + Math.sin(t * 3.1 + sd + sg) * 0.03 * ges + Math.sin(t * 6.1 + sd) * 0.006 * st.fidget),
        hy + Math.sin(t * 5.3 + sd * 2 + sg) * 0.045 * ges + idle * ges * 0.12 + Math.sin(t * 4.3 + sd + sg) * 0.008 * st.fidget + s.recoil * 0.1 * busy,
        hz - Math.sin(ph + (sg > 0 ? 0 : Math.PI)) * 0.15 * g * idle + Math.sin(t * 4.1 + sd) * 0.03 * ges + idle * ges * 0.14 + jab - s.recoil * 0.06,
      );
      const gw = s[side + 'g'];
      // authored targets are the same for every body; stocky figures would otherwise put the hand inside the coat
      if (gw < 0.5) this.keepOut(loc, 0.02);
      const tgt = v2.copy(loc).applyMatrix4(torso.matrix);
      if (gw > 0.001 && this.grab[side]) { const w = this.grab[side](); if (w) tgt.lerp(this.inner.worldToLocal(v3.copy(w)), Math.min(1, gw)); }
      this.target[side].copy(tgt);   // before the reach clamp: a rigged actor may lean and stretch to get there
      const pole = v3.set(sg * (0.35 + po * 0.9 - 0.2 * tight), -0.5 + po * 0.3, -0.8 + po * 0.6);
      this.solve(A.up, A.fo, D.up, D.fore, sho, tgt, pole, this.elbow[side], this.wrist[side]);
      // the forearm itself must clear the body too (arm across the chest): push the target out and re-solve.
      // Only worth checking when the hand is inside the body's width; hanging / on-hip arms skip it.
      if (gw < 0.5 && loc.y < 0.5 && Math.abs(loc.x) < 0.2) {
        const foreR = 0.04 * B.arm * this.sleeveR + 0.006;
        for (let it = 0; it < 2; it++) {
          let worst = 0;
          for (const f of [0.3, 0.55, 0.8]) worst = Math.max(worst, this.inside(v6.copy(this.elbow[side]).lerp(this.wrist[side], f).applyMatrix4(inv), foreR));
          if (worst < 0.002) break;
          const r = Math.max(0.05, Math.hypot(loc.x, loc.z)); loc.x *= 1 + worst / r; loc.z *= 1 + worst / r;
          this.solve(A.up, A.fo, D.up, D.fore, sho, v2.copy(loc).applyMatrix4(torso.matrix), pole, this.elbow[side], this.wrist[side]);
        }
      }
      const dir = v4.subVectors(this.wrist[side], this.elbow[side]).normalize();
      A.hand.position.copy(this.wrist[side]).addScaledVector(dir, 0.035); A.hand.quaternion.copy(A.fo.quaternion);
      if (A.cuff) { A.cuff.position.copy(this.wrist[side]).addScaledVector(dir, -0.012); A.cuff.quaternion.copy(A.fo.quaternion); }
      A.finger.visible = !this.hidden && side === 'r' && s.point > 0.3;
      if (A.finger.visible) { A.finger.position.copy(A.hand.position).addScaledVector(dir, 0.03); A.finger.quaternion.copy(A.fo.quaternion); }
    }

    // legs
    const hj = D.hipX ?? B.hip * 0.52;
    for (const side of ['l', 'r']) {
      const sg = side === 'l' ? 1 : -1, Lg = this.leg[side], off = sg > 0 ? 0 : Math.PI;
      const hip = v1.set(sg * hj + hipX * 1.2, hipY, hipZ);
      const amp = long ? 0.17 : 0.27, free = sg * st.hipShift < 0 ? Math.abs(st.hipShift) * still : 0;   // the unweighted leg relaxes forward
      const foot = v2.set(sg * (hj + 0.004 + st.stance * 0.055 * still + s.sit * 0.02 + free * 0.03), D.ankle + Math.max(0, Math.cos(ph + off)) * 0.1 * g,
        Math.sin(ph + off) * amp * g + s.sit * 0.4 + s.crouch * 0.05 + free * 0.07);
      this.solve(Lg.th, Lg.sh, D.thigh, D.shin, hip, foot, v3.set(sg * (0.12 + st.stance * 0.1), 0.25, 1), v6, v7);
      this.knee[side].copy(v6); this.ankle[side].copy(v7);
      Lg.shoe.position.set(foot.x, 0.035 + (foot.y - D.ankle), foot.z + 0.045); Lg.shoe.rotation.y = sg * st.stance * 0.25;
    }

    // props
    for (const p of this.props) {
      if (p.at === 'bag') {
        p.ring.position.copy(this.wrist.l).lerp(this.elbow.l, 0.66); p.ring.quaternion.copy(this.arm.l.fo.quaternion).multiply(RING);
        p.g.position.copy(p.ring.position); p.g.rotation.set(Math.sin(t * 2.7 + sd) * 0.05 * (g + talk * 0.5), s.ry * 0 + Math.sin(t * 1.1 + sd) * 0.1, Math.sin(t * 3.3 + sd) * 0.06 * (g + talk * 0.5));
      }
      else { p.g.position.copy(this.wrist.r); p.g.rotation.y = 0.25; }
    }
    if (this.actor) this.actor.update(dt);
  }
}

// ───────────────────────── the cast
const hairs = ['#17120f', '#1f1814', '#2a1d16', '#120f0e'];
export async function buildCast(scene) {
  const navy = T.stripes('#1b2a55', '#c9cfdd', 14, false), shirtStripe = T.stripes('#f4f6fa', '#7fa3d6', 16, true), bw = T.stripes('#141414', '#f2f2f0', 8, true);
  const man = (id, suit, tie, o = {}) => ({ id, h: 1.76, jacket: suit, inner: '#f3f3f1', tie, legs: { type: 'pants', color: suit }, hair: { style: 'short', color: hairs[id.length % 4] }, skin: '#e6bd98', gest: 0.2, ...o });
  const specs = [
    // 薛珍珠 — loud and unstoppable: stocky, chest out, chin up, planted feet, everything fast and big
    { id: 'M', name: '薛珍珠', h: 1.57, model: 'models/M.glb', female: true, skin: '#efc6a4', jacket: '#1d5a44', jacketMap: T.tweed('#1c4f3d', '#6fae8a', 3), jacketLen: 0.42, gap: 0.62, openFront: true, inner: '#6b1728', blossoms: true, legs: { type: 'pants', color: '#31121b' }, hair: { style: 'perm', color: '#1b1517' },
      lips: '#c5182f', earrings: true, brooch: true, gest: 1, jowl: true, eye: 0.9, shadow: '#7d6791', browT: 1.2, mouth: 1.2, rouge: 0.42, nose: 1.1,
      body: { sw: 0.186, chest: 0.176, waist: 0.172, hip: 0.18, depth: 0.84, neck: 0.055, neckR: 0.042, face: [1.03, 0.99], arm: 1.1, leg: 0.074, bust: 0.9, belly: 0.5, hand: 1.02 },
      style: { slouch: -0.05, chin: 0.1, stance: 0.9, sway: 0.9, tempo: 1.6, jab: 1, fidget: 0.2 } },
    // 前台 — timid: narrow, hunched, head down, feet together, hands wringing
    { id: 'R', name: '前台', h: 1.65, female: true, jacket: '#16171a', jacketLen: 0.22, gap: 0.9, inner: '#f5f4f0', ruffle: true, legs: { type: 'skirt', color: '#16171a', len: 0.48, flare: 0.03, hose: '#e6bfa0' }, hair: { style: 'pony', color: '#15110f' }, gest: 0.25, eye: 1.22, browT: 0.75, mouth: 0.8,
      body: { sw: 0.156, chest: 0.128, waist: 0.102, hip: 0.142, depth: 0.72, neck: 0.095, neckR: 0.031, face: [0.92, 1.05], arm: 0.8, leg: 0.058, bust: 0.35 },
      style: { slouch: 0.07, chin: -0.07, shrug: 0.55, stance: -0.35, sway: 0.3, tempo: 1.3, jab: 0, fidget: 1 } },
    // 洪 — brisk and upright, quick to step in
    { id: 'H', name: '洪', h: 1.63, female: true, jacket: '#18181b', inner: '#c79d35', legs: { type: 'pants', color: '#151517' }, hair: { style: 'pony', color: '#1a1310' }, gest: 0.75, eye: 1.1,
      body: { sw: 0.168, chest: 0.138, waist: 0.112, hip: 0.15, neck: 0.085, face: [0.95, 1.04], bust: 0.45 },
      style: { chin: 0.03, stance: 0.2, sway: 0.6, tempo: 1.35, jab: 0.6 } },
    // 小董 — senior and composed: structured shoulders, weight on one hip, head cocked, slow
    { id: 'B', name: '小董', h: 1.7, female: true, jacket: '#1d3fbd', jacketLen: 0.24, gap: 0.8, inner: '#101012', legs: { type: 'pants', color: '#131316' }, hair: { style: 'wavy', color: '#2b2626', tint: '#6a6462' }, gest: 0.55, lips: '#a03a48', browT: 1,
      body: { sw: 0.184, chest: 0.142, waist: 0.114, hip: 0.152, depth: 0.72, neck: 0.09, face: [0.93, 1.07], arm: 0.9, bust: 0.45, pad: 1 },
      style: { slouch: -0.02, chin: 0.05, hipShift: 0.9, headTilt: 0.07, stance: 0.3, sway: 0.25, tempo: 0.7, jab: 0.3 } },
    // 凌玲 — slight and contained: long neck, sloping shoulders, slow, folds inward under pressure
    { id: 'E', name: '凌玲', h: 1.69, female: true, top: '#e8e5df', silk: true, collar: true, necklace: true, legs: { type: 'long', color: '#ecebe7', len: 0.8, flare: 0.05, panel: '#141416' }, shoes: '#d9c3a8', hair: { style: 'bob', color: '#241a16' }, lips: '#b5505a', gest: 0.3, eye: 1.16, browT: 0.7, mouth: 0.82, nose: 0.9,
      body: { sw: 0.158, chest: 0.126, waist: 0.098, hip: 0.14, depth: 0.7, neck: 0.108, neckR: 0.03, face: [0.91, 1.08], arm: 0.78, leg: 0.058, bust: 0.4, hand: 0.86 },
      style: { slouch: 0.03, chin: -0.03, shrug: 0.12, stance: -0.2, sway: 0.35, tempo: 0.6, jab: 0, fidget: 0.15, headTilt: -0.04 } },
    man('c1', '#15161a', '#1b2a55', { glasses: true, tieMap: navy, body: { sw: 0.198, chest: 0.154, waist: 0.138, neck: 0.085 }, style: { slouch: 0.05, sway: 0.4, tempo: 0.9, fidget: 0.4 } }),
    man('c2', '#1a2848', '#2d63cc', { h: 1.78, hair: { style: 'side', color: '#17120f' }, body: { sw: 0.226, chest: 0.182, waist: 0.158 }, style: { chin: 0.04, stance: 0.5, hipShift: -0.5, tempo: 0.8 } }),
    man('c3', '#141416', null, { inner: '#e9e9e6', h: 1.83, hair: { style: 'crop', color: '#1b1512' }, body: { sw: 0.204, chest: 0.15, waist: 0.134, neck: 0.09, arm: 0.95, face: [0.95, 1.08] }, style: { slouch: 0.07, sway: 0.5, tempo: 0.7 } }),
    man('c4', '#2b2d33', '#3a3d46', { h: 1.71, hair: { style: 'crop', color: '#3a3836' }, jowl: true, body: { sw: 0.21, chest: 0.182, waist: 0.19, hip: 0.172, belly: 0.9, neck: 0.06, face: [1.04, 1.0] }, style: { slouch: -0.03, stance: 0.6, sway: 0.3, tempo: 0.6 } }),
    { id: 'c5', h: 1.58, female: true, top: '#131114', legs: { type: 'skirt', color: '#62378a', len: 0.46, flare: 0.04, panel: '#e9b6c6' }, hair: { style: 'topknot', color: '#17120f' }, gest: 0.2, eye: 1.15, body: { sw: 0.16, chest: 0.13, waist: 0.104, hip: 0.146, bust: 0.45 }, style: { hipShift: -0.7, headTilt: -0.08, sway: 0.7, tempo: 1.3, fidget: 0.4 } },
    { id: 'c6', h: 1.71, female: true, jacket: '#151518', inner: '#8d8f96', legs: { type: 'skirt', color: '#151518', len: 0.5, flare: 0.05 }, hair: { style: 'long', color: '#1b1411' }, gest: 0.2, body: { sw: 0.17, chest: 0.132, waist: 0.104, neck: 0.1, face: [0.92, 1.08] }, style: { chin: 0.04, hipShift: 0.5, sway: 0.3, tempo: 0.7 } },
    { id: 'c7', h: 1.64, female: true, jacket: '#676b73', inner: '#ececea', legs: { type: 'pants', color: '#2a2b30' }, hair: { style: 'long', color: '#231812' }, gest: 0.2, body: { chest: 0.15, waist: 0.124, hip: 0.172, bust: 0.75, leg: 0.07 }, style: { stance: 0.3, sway: 0.6, tempo: 1.0 } },
    { id: 'c8', h: 1.6, female: true, top: '#d9c8a7', legs: { type: 'long', color: '#dccdb0', len: 0.72, flare: 0.09 }, hair: { style: 'long', color: '#4a2e21' }, folder: '#58cfd0', shoes: '#c9b79a', gest: 0.1, eye: 1.22, body: { sw: 0.155, chest: 0.125, waist: 0.1, hip: 0.14, arm: 0.8, neck: 0.09, bust: 0.35 }, style: { slouch: 0.05, chin: -0.04, shrug: 0.45, stance: -0.3, sway: 0.4, tempo: 1.2, fidget: 0.7 } },
    { id: 'c9', h: 1.67, female: true, top: '#f1f4f8', topMap: shirtStripe, collar: true, legs: { type: 'pants', color: '#8f8f8a' }, hair: { style: 'bun', color: '#19130f' }, gest: 0.2, style: { chin: 0.03, sway: 0.3, tempo: 0.9 } },
    man('c10', '#17171a', null, { inner: '#2a2a2e', h: 1.7, hair: { style: 'crop', color: '#15110f' }, body: { sw: 0.224, chest: 0.188, waist: 0.172, neck: 0.06, arm: 1.2, face: [1.03, 1.0] }, style: { stance: 0.7, hipShift: 0.3, tempo: 0.8 } }),
    { id: 'c11', h: 1.62, female: true, jacket: '#141416', inner: '#f0efeb', legs: { type: 'skirt', color: '#f2f2f0', map: bw, len: 0.5, flare: 0.06 }, hair: { style: 'pony', color: '#1b130f' }, gest: 0.2, eye: 1.1, style: { hipShift: 0.6, headTilt: 0.06, sway: 0.6, tempo: 1.2, fidget: 0.3 } },
    { id: 'c12', h: 1.6, female: true, top: '#8b9069', legs: { type: 'long', color: '#c9bfa7', len: 0.74, flare: 0.07 }, hair: { style: 'long', color: '#1d1512' }, gest: 0.2, jowl: true, body: { sw: 0.178, chest: 0.156, waist: 0.146, hip: 0.178, bust: 0.85, neck: 0.07, face: [1.0, 1.02], arm: 1.0 }, style: { stance: 0.3, sway: 0.5, tempo: 0.8 } },
    { id: 'a1', h: 1.72, female: true, top: '#f1f4f8', topMap: shirtStripe, collar: true, legs: { type: 'pants', color: '#a3a39c' }, hair: { style: 'bun', color: '#16110e' }, gest: 0.2, body: { sw: 0.168, chest: 0.13, waist: 0.102, neck: 0.1 }, style: { chin: 0.05, sway: 0.25, tempo: 0.8 } },
    { id: 'a2', h: 1.57, female: true, top: '#f1f0ea', legs: { type: 'skirt', color: '#121214', len: 0.44, flare: 0.04 }, hair: { style: 'long', color: '#19120f' }, folder: '#ee6a28', gest: 0.1, eye: 1.2, body: { sw: 0.154, chest: 0.126, waist: 0.1, hip: 0.142, arm: 0.8 }, style: { slouch: 0.04, shrug: 0.4, stance: -0.25, tempo: 1.2, fidget: 0.8 } },
    man('a3', '#131315', '#22232a', { h: 1.84, hair: { style: 'side', color: '#120f0e' }, body: { sw: 0.232, chest: 0.182, waist: 0.146, arm: 1.12 }, style: { chin: 0.05, stance: 0.5, sway: 0.2, tempo: 0.6 } }),
    { id: 'a4', h: 1.64, female: true, top: '#131316', legs: { type: 'skirt', color: '#1f3a44', map: T.floral('#1f3a44', 9), len: 0.5, flare: 0.07 }, hair: { style: 'long', color: '#3a241a' }, gest: 0.2, body: { chest: 0.146, waist: 0.118, hip: 0.166, bust: 0.7 }, style: { hipShift: -0.5, sway: 0.6, tempo: 1.1 } },
    { id: 'a5', h: 1.66, female: true, top: '#f3f2ee', legs: { type: 'skirt', color: '#f2f2f0', map: bw, len: 0.5, flare: 0.05 }, hair: { style: 'pony', color: '#1a1310' }, gest: 0.2, style: { hipShift: 0.6, headTilt: 0.05, tempo: 1.0 } },
    man('L1', '#1a2132', '#2a5fc4', { h: 1.77, folder: '#f4f3ee', hair: { style: 'side', color: '#1b1512' }, style: { hipShift: 0.4, tempo: 0.7 } }),
    man('L2', '#141416', '#30323a', { h: 1.8, hair: { style: 'crop', color: '#17120f' }, body: { sw: 0.22, chest: 0.18, waist: 0.17, belly: 0.4 }, style: { stance: 0.5, slouch: 0.03, tempo: 0.6 } }),
    man('G1', '#1c2440', '#141a30', { h: 1.8, cap: true, badge: true, inner: '#9fb4d8', gest: 0.5, hair: { style: 'crop', color: '#15110f' }, body: { sw: 0.238, chest: 0.196, waist: 0.172, arm: 1.26, neck: 0.06, face: [1.03, 1.02] }, style: { chin: 0.06, stance: 0.8, sway: 0.2, tempo: 0.9, jab: 0.6 } }),
    man('G2', '#1c2440', '#141a30', { h: 1.84, cap: true, badge: true, inner: '#9fb4d8', gest: 0.3, hair: { style: 'crop', color: '#1b1512' }, body: { sw: 0.216, chest: 0.168, waist: 0.146, arm: 1.1, neck: 0.085, face: [0.97, 1.07] }, style: { stance: 0.6, sway: 0.2, tempo: 0.8 } }),
  ];
  const cast = {}, list = [];
  const useModels = !new URLSearchParams(location.search).has('nomodels');   // ?nomodels: everyone primitive, for comparison
  const models = await Promise.all(specs.map((sp) => (sp.model && useModels ? loadModel(new URL('../' + sp.model, import.meta.url).href, sp.h || 1.65) : null)));
  specs.forEach((sp, i) => {
    if (models[i]) sp.dims = dimsFor(models[i], (sp.h || 1.65) / 1.65); else delete sp.model;
    const p = new Person(sp); if (models[i]) p.actor = new Actor(p, models[i]);
    cast[sp.id] = p; list.push(p); scene.add(p.root);
  });
  return { cast, list };
}
