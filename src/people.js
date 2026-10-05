// The cast. Each person is a rigged model (actors.js) moved by a Person: the procedural animation that turns the
// timeline's channels (blocking.js) into a pose every frame. A Person has no body of its own, only transforms:
//   root (world x/z + heading)  →  inner (uniform height scale)  →  torso, pelvis, head
// plus hand and foot targets. Hands are authored as targets in the torso frame and grabs as points on other people;
// arms and legs are solved here as two-bone chains for the elbow and knee directions, and the Actor re-solves them on
// the model's own bones.
//
// People differ in temperament (style): posture (slouch, chin, shrug, stance, weight shift) and how they move (sway,
// tempo, how hard they jab when they talk, how much they fidget). How they look is the model (tools/characters.py).
import * as THREE from 'three';
import { loadModel, dimsFor, Actor } from './actors.js';
import { PLAN } from './set.js';

const STRIDE = 0.62;
// The reception desk is solid: a hand aimed into the counter, or into the receptionist's worktop, rests on top of it.
// Boxes in world space: half width about the desk's x, z range, and the height range that counts as inside.
const DESK = (() => {
  const K = PLAN.desk;
  return [{ hx: K.w / 2 + 0.05, z0: K.z - K.d / 2 - 0.06, z1: K.z + K.d / 2 + 0.06, y0: 0, top: 1.1 },   // counter and its top
    { hx: K.w / 2 - 0.15, z0: K.z - 0.92, z1: K.z - 0.32, y0: 0.6, top: 0.78 }];                           // worktop behind it
})();
const vDesk = new THREE.Vector3();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), v5 = new THREE.Vector3(), v6 = new THREE.Vector3(), v7 = new THREE.Vector3(), v8 = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const FOLDER = new THREE.BoxGeometry(0.24, 0.32, 0.012);

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

const STYLE = { slouch: 0, chin: 0, shrug: 0, stance: 0, hipShift: 0, sway: 0.5, tempo: 1, jab: 0.3, fidget: 0, headTilt: 0 };

export class Person {
  // spec.dims: the model's proportions in this Person's units (actors.js dimsFor)
  constructor(spec) {
    this.spec = spec; this.id = spec.id;
    this.scale = spec.h / 1.65;
    this.dims = spec.dims;
    this.style = { ...STYLE, ...(spec.style || {}) };
    this.headY = this.dims.headY;
    // animated state — every number here is a channel on the Anime.js timeline
    this.s = {
      x: 0, z: 0, ry: 0, dist: 0, gait: 0, sit: 0, talk: 0, lean: 0, twist: 0, hx: 0, hp: 0, tilt: 0,
      brow: 0, eye: 0, tear: 0, point: 0, fist: 0, lpalm: 0, rpalm: 0, lflat: 0, rflat: 0, shake: 0, crouch: 0, hide: 0, shrink: 0, recoil: 0,
      lhx: HAND.hang[0], lhy: HAND.hang[1], lhz: HAND.hang[2], lpo: 0, lg: 0,
      rhx: HAND.hang[0], rhy: HAND.hang[1], rhz: HAND.hang[2], rpo: 0, rg: 0,
    };
    this.grab = { l: null, r: null };   // (grabber, side) => world Vector3
    this.lookAt = null;                 // () => world Vector3
    this.seed = [...spec.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 1000 / 100;
    this._yaw = 0; this._pitch = 0; this._talkB = 0;
    this.wrist = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    this.elbow = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    this.knee = { l: new THREE.Vector3(), r: new THREE.Vector3() }; this.ankle = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    this.target = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    this.handFrame = new THREE.Matrix4();   // the torso's frame without the syllable bob, for hand targets (see update)
    this.gait = { l: { swing: false, u: 0, g: 0 }, r: { swing: false, u: 0, g: 0 } };   // per-leg step phase, for the model's feet
    // set by the Actor from the model: the clothed torso's cross-section, and each forearm's clothed radius
    this.section = null; this.foreR = { l: 0.045, r: 0.045 };

    const root = this.root = new THREE.Group(); root.name = spec.id;
    const inner = this.inner = new THREE.Group(); inner.scale.setScalar(this.scale); root.add(inner);
    this.torso = new THREE.Group(); inner.add(this.torso);
    this.pelvis = new THREE.Group(); inner.add(this.pelvis);
    this.head = new THREE.Group(); this.head.position.y = this.headY; this.torso.add(this.head);
    if (spec.folder) {   // a folder carried in the right hand (placed on the model's hand in update)
      const f = new THREE.Mesh(FOLDER, new THREE.MeshStandardMaterial({ color: spec.folder, roughness: 0.5 }));
      f.position.set(0, 0.06, 0.02); f.castShadow = f.receiveShadow = true;
      this.folder = new THREE.Group(); this.folder.add(f); inner.add(this.folder);
    }
  }

  // nominal head position in world space (no bob), used for camera framing
  headPos(out = new THREE.Vector3()) {
    const s = this.s, y = (this.dims.hip - s.sit * 0.4 - s.crouch * 0.12 + this.headY) * this.scale, f = Math.sin(s.lean + this.style.slouch) * this.headY * this.scale;
    return out.set(s.x + Math.sin(s.ry) * f, y, s.z + Math.cos(s.ry) * f);
  }

  // How far a torso-space point sits inside the clothed body inflated by `clear` (0 = outside).
  // The body is an ellipse at each height; hands above the shoulders are left alone.
  inside(p, clear) {
    if (p.y > 0.5 || !this.section) return 0;
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

  // two-bone chain from `start` toward `target`, bending toward `pole`: the middle joint and the reachable end
  solve(len1, len2, start, target, pole, outMid, outEnd) {
    const d = v4.subVectors(target, start); let dist = d.length();
    const max = (len1 + len2) * 0.995; dist = Math.min(Math.max(dist, Math.abs(len1 - len2) + 0.02), max);
    d.normalize();
    const cosA = (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const perp = v5.copy(pole).addScaledVector(d, -pole.dot(d)); if (perp.lengthSq() < 1e-6) perp.set(0, 0, -1); perp.normalize();
    outMid.copy(start).addScaledVector(d, len1 * cosA).addScaledVector(perp, len1 * sinA);
    outEnd.copy(start).addScaledVector(d, dist);
  }

  update(t, dt) {
    const s = this.s, sp = this.spec, st = this.style, D = this.dims, root = this.root, torso = this.torso, sd = this.seed;
    const long = sp.skirt === 'long';   // a long skirt shortens the stride
    const ph = (s.dist / (STRIDE * this.scale * (long ? 0.8 : 1))) * Math.PI, g = s.gait;
    root.visible = s.hide < 0.5; root.position.set(s.x, 0, s.z); root.rotation.y = s.ry;
    const still = 1 - Math.min(1, g + s.sit);
    // syllables: |sin·sin| rounded off at zero (√(x²+ε²)−ε, rescaled to 0..1); the bare |x| turned sharply at every zero
    // crossing, and everything driven by it (chest, head, mouth, the jabbing finger) jerked once a syllable
    const sx = Math.sin(t * 12.7 + sd * 3) * Math.sin(t * 4.3 + sd), env = (Math.sqrt(sx * sx + 0.0025) - 0.05) / 0.951;
    const talk = Math.min(s.talk, 1.7), syl = talk * env;
    const loud = Math.max(0, talk - 1) * 1.6;                                   // how much of this is shouting
    // The face keeps up with the voice; the body (bob, head, gestures) follows the same talk through a 0.12 s lag. A line
    // starts and stops within 90 ms, and gestures several centimetres wide used to switch on and off in that time.
    // (dt 0 is a settle pass within a frame: no change; a seek, dt 1, snaps.)
    this._talkB += (talk - this._talkB) * (dt > 0.2 ? 1 : 1 - Math.exp(-dt * 8));
    const talkB = this._talkB, sylB = talkB * env, loudB = Math.max(0, talkB - 1) * 1.6;
    const tight = Math.min(1.2, st.shrug + s.shrink + s.recoil * 0.7);          // shoulders up and in
    const hipX = (st.hipShift * 0.028 + Math.sin(t * st.tempo * 0.5 + sd) * st.sway * 0.012 + Math.sin(t * 1.3 + sd) * 0.008 * st.fidget) * still;
    const hipY = D.hip - s.sit * 0.4 - s.crouch * 0.12 + Math.abs(Math.sin(ph)) * 0.024 * g - Math.abs(st.hipShift) * 0.008 * still, hipZ = -s.sit * 0.06;
    torso.position.set(hipX, hipY, hipZ - s.recoil * 0.03);
    const nod = sylB * (0.02 + 0.045 * st.jab * (0.5 + loudB));   // the chest bobs forward with each syllable
    torso.rotation.set(
      s.lean + st.slouch + s.shrink * 0.07 - s.recoil * 0.1 + g * 0.06 + nod,
      s.twist + Math.sin(ph) * 0.07 * g + Math.sin(t * 0.55 * st.tempo + sd) * 0.02 * st.sway,
      Math.sin(ph) * 0.025 * g - st.hipShift * 0.045 * still + Math.sin(t * 0.4 * st.tempo + sd * 2) * 0.012 * st.sway, 'YXZ');
    this.pelvis.position.set(hipX * 1.2, hipY, hipZ); this.pelvis.rotation.set(s.sit * 1.25 + (sp.skirt ? Math.sin(ph * 2) * 0.03 * g : 0), Math.sin(ph) * -0.05 * g, st.hipShift * 0.05 * still);
    const shoX = D.sw * (1 - 0.1 * tight), shoY = D.sho + 0.03 * tight; this.tight = tight;
    // Hands are placed in the torso's frame without the syllable bob: chest and head nod with each syllable, the hands keep
    // their own path. Riding the bob, every hand moved with every syllable, a held or holding one included.
    torso.rotation.x -= nod; torso.updateMatrix(); this.handFrame.copy(torso.matrix); torso.rotation.x += nod;
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
    this.gaze = { yaw: wantYaw - this._yaw * 0.85 - s.hx, pitch: wantPitch - this._pitch * 0.8 };   // what the head leaves to the eyes
    this.head.position.set(0, this.headY - 0.012 * tight, st.slouch * 0.14 + s.shrink * 0.02 + sylB * 0.014 * st.jab * (0.5 + loudB));
    this.head.rotation.set(
      this._pitch * 0.8 + s.hp + st.slouch * 0.5 - st.chin + s.shrink * 0.16 + s.recoil * 0.05 + sylB * 0.05 + Math.sin(t * 0.7 * st.tempo + sd) * 0.012,
      this._yaw * 0.85 + s.hx + s.recoil * 0.25 * (sd % 2 > 1 ? 1 : -1) + Math.sin(t * 2.1 + sd) * 0.03 * talkB,
      st.headTilt + s.tilt + Math.sin(t * 0.33 * st.tempo + sd) * 0.02 * st.sway, 'YXZ');

    // face channels, for the model's face units (Actor.face)
    const blink = (t * (0.26 + 0.12 * st.fidget) + sd) % 1 < 0.035 ? 1 : 0, lid = Math.max(blink, s.eye, s.recoil * 0.95);
    const brow = s.brow - s.recoil * 0.5 + (loud > 0.3 && s.brow > 0 ? 0.2 : 0);
    const open = Math.min(1, syl * (0.55 + 0.45 * Math.min(talk, 1.5)) + s.recoil * 0.25);
    this.face = { brow, lid, open, loud, tear: s.tear, recoil: s.recoil };

    // arms
    const inv = m4.copy(torso.matrix).invert();   // inner -> torso space, for the keep-out checks
    for (const side of ['l', 'r']) {
      const sg = side === 'l' ? 1 : -1;
      const sho = v1.set(sg * shoX, shoY, 0.012 * tight).applyMatrix4(torso.matrix);
      const hx = s[side + 'hx'], hy = s[side + 'hy'], hz = s[side + 'hz'], po = s[side + 'po'];
      const idle = Math.max(0, 1 - Math.hypot(hx - HAND.hang[0], hy - HAND.hang[1], hz - HAND.hang[2]) * 6);
      const busy = 1 - idle, ges = talkB * (sp.gest ?? 0.5) * (0.35 + busy * 0.65);
      const jab = side === 'r' && s.point > 0.3 ? sylB * 0.085 * st.jab * (0.6 + loudB) : 0;   // the accusing finger stabs with each syllable
      const loc = v8.set(
        sg * (hx * (1 - 0.25 * tight * idle) + Math.sin(t * 3.1 + sd + sg) * 0.03 * ges + Math.sin(t * 6.1 + sd) * 0.006 * st.fidget),
        hy + Math.sin(t * 5.3 + sd * 2 + sg) * 0.045 * ges + idle * ges * 0.12 + Math.sin(t * 4.3 + sd + sg) * 0.008 * st.fidget + s.recoil * 0.1 * busy,
        hz - Math.sin(ph + (sg > 0 ? 0 : Math.PI)) * 0.15 * g * idle + Math.sin(t * 4.1 + sd) * 0.03 * ges + idle * ges * 0.14 + jab - s.recoil * 0.06,
      );
      const gw = s[side + 'g'];
      // authored targets are the same for every body; stocky figures would otherwise put the hand inside the coat
      if (gw < 0.5) this.keepOut(loc, 0.02);
      const tgt = v2.copy(loc).applyMatrix4(this.handFrame);
      if (gw > 0.001 && this.grab[side]) { const w = this.grab[side](this, side); if (w) tgt.lerp(this.inner.worldToLocal(v3.copy(w)), Math.min(1, gw)); }
      this.inner.localToWorld(vDesk.copy(tgt));
      for (const b of DESK) {   // full lift inside; within 20 cm outside it eases off, so a hand clears the edge and settles
        const d = Math.min(b.hx - Math.abs(vDesk.x - PLAN.desk.x), vDesk.z - b.z0, b.z1 - vDesk.z, vDesk.y - b.y0), top = b.top + 0.035;
        if (d > -0.2 && vDesk.y < top) { const w = Math.min(1, 1 + d / 0.2); vDesk.y += (top - vDesk.y) * w * w * (3 - 2 * w); tgt.copy(this.inner.worldToLocal(vDesk)); }
      }
      this.target[side].copy(tgt);   // before the reach clamp: the actor may lean and stretch to get there
      const pole = v3.set(sg * (0.35 + po * 0.9 - 0.2 * tight), -0.5 + po * 0.3, -0.8 + po * 0.6);
      this.solve(D.up, D.fore, sho, tgt, pole, this.elbow[side], this.wrist[side]);
      // the forearm itself must clear the body too (arm across the chest): push the target out and re-solve.
      // Only worth checking when the hand is inside the body's width; hanging / on-hip arms skip it.
      if (gw < 0.5 && loc.y < 0.5 && Math.abs(loc.x) < 0.2) {
        const foreR = this.foreR[side] + 0.006;
        for (let it = 0; it < 2; it++) {
          let worst = 0;
          for (const f of [0.3, 0.55, 0.8]) worst = Math.max(worst, this.inside(v6.copy(this.elbow[side]).lerp(this.wrist[side], f).applyMatrix4(inv), foreR));
          if (worst < 0.002) break;
          const r = Math.max(0.05, Math.hypot(loc.x, loc.z)); loc.x *= 1 + worst / r; loc.z *= 1 + worst / r;
          this.solve(D.up, D.fore, sho, v2.copy(loc).applyMatrix4(this.handFrame), pole, this.elbow[side], this.wrist[side]);
        }
      }
    }

    // legs
    const hj = D.hipX;
    for (const side of ['l', 'r']) {
      const sg = side === 'l' ? 1 : -1, off = sg > 0 ? 0 : Math.PI;
      const hip = v1.set(sg * hj + hipX * 1.2, hipY, hipZ);
      const free = sg * st.hipShift < 0 ? Math.abs(st.hipShift) * still : 0;   // the unweighted leg relaxes forward
      // Gait. The planted foot travels back at exactly the body's speed, one stride per half cycle, so it stays put on the
      // floor; the lifted foot swings forward eased. a in [0, π) is swing, [π, 2π) stance. Late in stance the heel rises.
      const half = STRIDE * (long ? 0.8 : 1) / 2, a = (((ph + off + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const swing = a < Math.PI, u = swing ? a / Math.PI : a / Math.PI - 1;
      const z = swing ? -half + 2 * half * u * u * (3 - 2 * u) : half - 2 * half * u;
      const lift = swing ? Math.sin(Math.PI * u) * 0.085 : Math.max(0, (u - 0.7) / 0.3) * 0.045;
      this.gait[side].swing = swing; this.gait[side].u = u; this.gait[side].g = g;
      // a crouch at rest is a lunge: the right foot steps in, the left braces behind, feet closer, knees over the toes
      const lunge = Math.min(1, s.crouch * 2.5) * still;
      const foot = v2.set(sg * (hj + 0.004 + st.stance * 0.055 * still * (1 - lunge) + s.sit * 0.02 + free * 0.03), D.ankle + lift * g,
        z * g + s.sit * 0.4 + s.crouch * 0.05 + free * 0.07 + lunge * (sg < 0 ? 0.24 : -0.16));
      this.solve(D.thigh, D.shin, hip, foot, v3.set(sg * (0.12 + st.stance * 0.1) * (1 - 0.6 * Math.min(1, s.crouch * 2.5)), 0.25, 1), v6, v7);
      this.knee[side].copy(v6); this.ankle[side].copy(v7);
    }

    this.actor.update(dt);
    if (this.folder) { this.inner.worldToLocal(this.actor.b.hand_r.getWorldPosition(this.folder.position)); this.folder.rotation.y = 0.25; }
  }
}

// ───────────────────────── the cast
export async function buildCast(scene, progress = () => {}) {
  const man = (id, o = {}) => ({ id, h: 1.76, gest: 0.2, ...o });
  const specs = [
    // 薛珍珠 — loud and unstoppable: chest out, chin up, planted feet, everything fast and big
    { id: 'M', name: '薛珍珠', h: 1.57, perm: true, lips: '#c5182f', lipAmt: 0.85, earrings: true, brooch: true, gest: 1,
      style: { slouch: -0.05, chin: 0.1, stance: 0.9, sway: 0.9, tempo: 1.6, jab: 1, fidget: 0.2 } },
    // 前台 — timid: hunched, head down, feet together, hands wringing
    { id: 'R', name: '前台', h: 1.65, skirt: 'short', gest: 0.25,
      style: { slouch: 0.07, chin: -0.07, shrug: 0.55, stance: -0.35, sway: 0.3, tempo: 1.3, jab: 0, fidget: 1 } },
    // 洪 — brisk and upright, quick to step in
    { id: 'H', name: '洪', h: 1.63, gest: 0.75, style: { chin: 0.03, stance: 0.2, sway: 0.6, tempo: 1.35, jab: 0.6 } },
    // 小董 — senior and composed: weight on one hip, head cocked, slow
    { id: 'B', name: '小董', h: 1.7, gest: 0.55, lips: '#a03a48',
      style: { slouch: -0.02, chin: 0.05, hipShift: 0.9, headTilt: 0.07, stance: 0.3, sway: 0.25, tempo: 0.7, jab: 0.3 } },
    // 凌玲 — slight and contained: slow, folds inward under pressure
    { id: 'E', name: '凌玲', h: 1.69, skirt: 'long', necklace: true, lipAmt: 0, rest: { browInnerUp: 0.22 }, gest: 0.3,
      style: { slouch: 0.03, chin: -0.03, shrug: 0.12, stance: -0.2, sway: 0.35, tempo: 0.6, jab: 0, fidget: 0.15, headTilt: -0.04 } },
    man('c1', { glasses: true, style: { slouch: 0.05, sway: 0.4, tempo: 0.9, fidget: 0.4 } }),
    man('c2', { h: 1.78, style: { chin: 0.04, stance: 0.5, hipShift: -0.5, tempo: 0.8 } }),
    man('c3', { h: 1.83, style: { slouch: 0.07, sway: 0.5, tempo: 0.7 } }),
    man('c4', { h: 1.71, style: { slouch: -0.03, stance: 0.6, sway: 0.3, tempo: 0.6 } }),
    { id: 'c5', h: 1.58, skirt: 'short', gest: 0.2, style: { hipShift: -0.7, headTilt: -0.08, sway: 0.7, tempo: 1.3, fidget: 0.4 } },
    { id: 'c6', h: 1.71, skirt: 'short', gest: 0.2, style: { chin: 0.04, hipShift: 0.5, sway: 0.3, tempo: 0.7 } },
    { id: 'c7', h: 1.64, gest: 0.2, style: { stance: 0.3, sway: 0.6, tempo: 1.0 } },
    { id: 'c8', h: 1.6, skirt: 'long', folder: '#58cfd0', gest: 0.1, style: { slouch: 0.05, chin: -0.04, shrug: 0.45, stance: -0.3, sway: 0.4, tempo: 1.2, fidget: 0.7 } },
    { id: 'c9', h: 1.67, gest: 0.2, style: { chin: 0.03, sway: 0.3, tempo: 0.9 } },
    man('c10', { h: 1.7, style: { stance: 0.7, hipShift: 0.3, tempo: 0.8 } }),
    { id: 'c11', h: 1.62, skirt: 'short', gest: 0.2, style: { hipShift: 0.6, headTilt: 0.06, sway: 0.6, tempo: 1.2, fidget: 0.3 } },
    { id: 'c12', h: 1.6, skirt: 'long', gest: 0.2, style: { stance: 0.3, sway: 0.5, tempo: 0.8 } },
    { id: 'a1', h: 1.72, gest: 0.2, style: { chin: 0.05, sway: 0.25, tempo: 0.8 } },
    { id: 'a2', h: 1.57, skirt: 'short', folder: '#ee6a28', gest: 0.1, style: { slouch: 0.04, shrug: 0.4, stance: -0.25, tempo: 1.2, fidget: 0.8 } },
    man('a3', { h: 1.84, style: { chin: 0.05, stance: 0.5, sway: 0.2, tempo: 0.6 } }),
    { id: 'a4', h: 1.64, skirt: 'short', gest: 0.2, style: { hipShift: -0.5, sway: 0.6, tempo: 1.1 } },
    { id: 'a5', h: 1.66, skirt: 'short', gest: 0.2, style: { hipShift: 0.6, headTilt: 0.05, tempo: 1.0 } },
    man('L1', { h: 1.77, folder: '#f4f3ee', style: { hipShift: 0.4, tempo: 0.7 } }),
    man('L2', { h: 1.8, style: { stance: 0.5, slouch: 0.03, tempo: 0.6 } }),
    man('G1', { h: 1.8, cap: true, badge: true, gest: 0.5, style: { chin: 0.06, stance: 0.8, sway: 0.2, tempo: 0.9, jab: 0.6 } }),
    man('G2', { h: 1.84, cap: true, badge: true, gest: 0.3, style: { stance: 0.6, sway: 0.2, tempo: 0.8 } }),
  ];
  // every person is a rigged model, models/<id>.glb (tools/build_models.sh)
  let loaded = 0;
  const models = await Promise.all(specs.map((sp) => loadModel(new URL(`../models/${sp.id}.glb`, import.meta.url).href, sp.h)
    .finally(() => progress(++loaded, specs.length))));
  const cast = {}, list = [];
  specs.forEach((sp, i) => {
    sp.dims = dimsFor(models[i], sp.h / 1.65);
    const p = new Person(sp); p.actor = new Actor(p, models[i]);
    cast[sp.id] = p; list.push(p); scene.add(p.root);
  });
  return { cast, list };
}
