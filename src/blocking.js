// Blocking: who stands where, when they move, what their hands do, who they look at.
// Everything is authored through a small DSL that records keyframes per channel and then
// compiles them into ONE Anime.js timeline (property keyframes), so the whole four minutes
// can be scrubbed deterministically with timeline.seek().
import * as THREE from 'three';
import { createTimeline } from 'animejs';
import { HAND } from './people.js';

const PI = Math.PI, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function buildBlocking(cast, list, seats) {
  const K = new Map(), now = new Map(), base = new Map();
  for (const p of list) { K.set(p, {}); now.set(p, { ...p.s }); p.lookTrack = []; p.grabTrack = { l: [], r: [] }; }
  const P = (id) => (typeof id === 'string' ? cast[id] : id);

  // ── primitives
  const key = (p, prop, t0, t1, v, ease = 'inOutSine') => { p = P(p); (K.get(p)[prop] ||= []).push({ t0, t1: Math.max(t1, t0 + 0.02), v, ease }); now.get(p)[prop] = v; };
  const place = (p, x, z, ry = 0, extra = {}) => { p = P(p); Object.assign(p.s, { x, z, ry }, extra); Object.assign(now.get(p), { x, z, ry }, extra); };
  const posAt = (p, t) => {
    p = P(p); const out = {};
    for (const prop of ['x', 'z']) {
      let v = base.get(p)?.[prop] ?? p.s[prop];
      const ks = (K.get(p)[prop] || []).slice().sort((a, b) => a.t0 - b.t0);
      for (const k of ks) { if (t >= k.t1) v = k.v; else if (t > k.t0) { v += (k.v - v) * ((t - k.t0) / (k.t1 - k.t0)); break; } else break; }
      out[prop] = v;
    }
    return out;
  };
  const angTo = (p, target, t) => {
    const n = now.get(P(p));
    if (typeof target === 'number') return target;
    const q = Array.isArray(target) ? { x: target[0], z: target[1] } : posAt(target, t);
    return Math.atan2(q.x - n.x, q.z - n.z);
  };
  const turn = (p, t, dur, target, ease) => { p = P(p); const n = now.get(p); key(p, 'ry', t, t + dur, n.ry + wrap(angTo(p, target, t + dur) - n.ry), ease); };
  const gaitEnv = (p, t0, t1, lv) => { const m = (t0 + t1) / 2; key(p, 'gait', t0, Math.min(t0 + 0.25, m), lv, 'linear'); key(p, 'gait', Math.max(t1 - 0.25, m), t1, 0, 'linear'); };
  // walk through timed waypoints [[t, x, z], …]; turns to face travel unless keep
  const path = (p, t0, pts, o = {}) => {
    p = P(p); const n = now.get(p); let t = t0;
    pts.forEach(([t1, x, z], i) => {
      const len = Math.hypot(x - n.x, z - n.z);
      if (!o.keep && len > 0.05) turn(p, Math.max(0, t - (i ? 0.18 : 0.1)), 0.42, Math.atan2(x - n.x, z - n.z));
      const ease = pts.length === 1 ? (o.ease || 'inOutSine') : i === 0 ? 'inSine' : i === pts.length - 1 ? 'outSine' : 'linear';
      const d = n.dist + len;
      key(p, 'x', t, t1, x, ease); key(p, 'z', t, t1, z, ease); key(p, 'dist', t, t1, d, ease);
      t = t1;
    });
    gaitEnv(p, t0, t, o.run ? 1.3 : 1);
    if (o.face !== undefined) turn(p, t - 0.12, 0.5, o.face);
  };
  const hands = (p, t, dur, l, r, ease = 'outCubic') => {
    p = P(p);
    for (const [side, h] of [['l', l], ['r', r]]) {
      if (h == null) continue;
      const a = typeof h === 'string' ? HAND[h] : h;
      key(p, side + 'hx', t, t + dur, a[0], ease); key(p, side + 'hy', t, t + dur, a[1], ease); key(p, side + 'hz', t, t + dur, a[2], ease); key(p, side + 'po', t, t + dur, a[3] ?? 0, ease);
    }
  };
  const set = (p, t, dur, obj, ease) => { for (const [k, v] of Object.entries(obj)) key(p, k, t, t + dur, v, ease); };
  const say = (p, t0, t1, lv = 1) => { key(p, 'talk', t0 - 0.03, t0 + 0.06, lv, 'linear'); key(p, 'talk', t1, t1 + 0.12, 0, 'linear'); };
  const grab = (p, side, t0, t1, fn, wIn = 0.22, wOut = 0.3) => {
    // eased at both ends: an outCubic start flung the hand
    p = P(p); key(p, side + 'g', t0, t0 + wIn, 1, 'inOutSine'); key(p, side + 'g', t1, t1 + wOut, 0, 'inOutSine');
    p.grabTrack[side].push({ t0: t0 - 0.05, t1: t1 + wOut + 0.05, fn });
  };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const look = (p, t, target) => {
    p = P(p);
    const fn = target == null ? null : Array.isArray(target) ? (() => tmp.set(...target)) : (() => P(target).headPos(tmp));
    p.lookTrack.push({ t, fn });
  };
  const wristOf = (id, side) => () => P(id).wristWorld(side, new THREE.Vector3());
  const elbowOf = (id, side) => () => P(id).elbowWorld(side, new THREE.Vector3());

  // ═════════════════════════ STAGING ═════════════════════════
  const { M, R, H, B, E, G1, G2, L1, L2 } = cast;
  const CROWD = ['B', 'H', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'];
  const TEAM = ['a1', 'a2', 'a3', 'a4', 'a5'];

  // ── opening positions
  place(M, -0.15, 0.62, PI); place(R, 0.15, -1.0, 0);
  place(B, seats[3].x, seats[3].z, seats[3].ry, { sit: 1 });
  place('c1', seats[2].x, seats[2].z, seats[2].ry, { sit: 1 });
  place('c6', seats[5].x, seats[5].z, seats[5].ry, { sit: 1 });
  place('c3', seats[4].x, seats[4].z, seats[4].ry, { sit: 1 });
  place('c7', seats[1].x, seats[1].z, seats[1].ry, { sit: 1 });
  place(H, -4.4, 2.55, 0.2); place('c2', -5.9, 2.5, 2.0); place('c4', -2.6, 6.4, 2.6); place('c5', -6.0, 7.4, 1.6);
  place('c8', 1.5, 5.6, PI); place('c9', -0.9, 9.6, PI); place('c10', 1.9, 6.3, PI); place('c11', 4.6, 1.5, -2.6); place('c12', 3.3, 0.9, -1.9);
  place(E, 4.5, 11.5, -1.2); place('a1', 3.5, 11.0, 1.4); place('a2', 0.9, 10.7, PI); place('a3', -0.9, 11.0, PI); place('a4', -1.9, 10.3, 2.6); place('a5', -1.4, 11.4, 2.9);
  place(L1, 3.7, -2.9, -1.2); place(L2, 3.0, -3.3, 1.9); place(G1, 15.6, -5.4, -PI / 2, { hide: 1 }); place(G2, 15.6, -6.2, -PI / 2, { hide: 1 });
  for (const p of list) base.set(p, { ...p.s });
  const pose0 = (p, l, r) => { p = P(p); for (const [side, h] of [['l', l], ['r', r]]) { if (!h) continue; const a = HAND[h]; Object.assign(p.s, { [side + 'hx']: a[0], [side + 'hy']: a[1], [side + 'hz']: a[2], [side + 'po']: a[3] }); Object.assign(now.get(p), p.s); } base.set(p, { ...p.s }); };
  pose0(M, 'bag', 'hang'); pose0(R, 'clasp', 'clasp'); pose0('c8', 'folder', 'folder'); pose0('a2', 'folder', 'folder'); pose0(L1, 'hang', 'folder');
  for (const id of ['B', 'c1', 'c6', 'c3', 'c7']) pose0(id, 'table', 'table');
  for (const id of ['c5', 'c11', 'a4', 'c12']) pose0(id, 'clasp', 'clasp');
  M.s.brow = 0.7; base.get(M).brow = 0.7; now.get(M).brow = 0.7;

  // ── 0:00  RECEPTION — Xue Zhenzhu at the desk
  look(M, 0, R); look(R, 0, M);
  say(R, 0.9, 2.4); say(M, 2.5, 3.9, 1.3); say(M, 4.3, 7.3, 1.2); say(R, 8.5, 9.3, 0.7); say(M, 9.4, 10.7, 1.2); say(M, 10.8, 13.2, 1.4);
  say(R, 13.2, 14.2, 1.1); say(M, 14.3, 17.9, 1.4); say(R, 18.0, 19.9, 0.9); say(M, 20.0, 22.8, 1.3);
  hands(M, 2.4, 0.35, null, 'point'); set(M, 2.4, 0.3, { point: 1 }); set(M, 2.4, 0.4, { lean: 0.1 });
  hands(M, 4.2, 0.4, null, 'open'); set(M, 4.2, 0.3, { point: 0 });
  hands(M, 7.5, 0.5, null, 'hip'); set(M, 7.5, 0.5, { lean: 0 });
  set(R, 8.3, 0.4, { brow: -0.4 }); set(M, 9.3, 0.3, { lean: 0.14 }); hands(M, 9.3, 0.3, null, 'pointLow');
  // grabs the receptionist's wrist across the counter: both hands go to one point above the counter top (they used to
  // reach for each other, fall short and sink into it), and the pull drags that point toward Xue as she leans back
  const overCounter = () => tmp2.set(0.05, 1.2, -0.26 + (0.2 - M.s.lean) * 0.6);
  hands(R, 11.2, 0.4, null, 'reach'); set(R, 11.3, 0.5, { lean: 0.36, brow: -0.8, shake: 0.6 });
  key(M, 'z', 10.85, 11.25, 0.44, 'outCubic'); key(M, 'z', 20.6, 21.1, 0.62, 'inOutSine');   // steps up to the counter for it, back after
  hands(M, 11.0, 0.3, null, 'reach'); grab(M, 'r', 11.25, 20.5, overCounter, 0.35, 0.6); grab(R, 'r', 11.3, 20.5, overCounter, 0.35, 0.6); set(M, 11.1, 0.4, { lean: 0.2 });
  set(M, 12.4, 0.5, { lean: 0.08 }); set(R, 12.4, 0.5, { lean: 0.46 });        // …and pulls
  look(M, 18.3, 'c1'); set(M, 18.3, 0.5, { twist: 0.5 }); look(M, 21.2, R); set(M, 21.2, 0.4, { twist: 0 });
  hands(M, 20.5, 0.4, null, 'hang'); set(M, 20.5, 0.4, { lean: 0 }); hands(R, 20.7, 0.6, null, 'clasp'); set(R, 20.7, 0.7, { lean: 0, shake: 0 }); set(R, 22, 1, { brow: -0.3 });

  // staff at the meeting table notice, rise and drift over
  for (const id of ['B', 'c1', 'c6', 'c3', 'c7', 'H', 'c2', 'c5']) look(id, 2.9 + Math.random() * 0, M);
  set(H, 2.9, 0.5, { twist: 0.6 }); turn(H, 3.6, 0.6, M);
  const rise = (id, t, t1, x, z) => { set(id, t, 0.7, { sit: 0 }); hands(id, t, 0.6, 'hang', 'hang'); path(id, t + 0.6, [[t1, x, z]], { face: M }); };
  rise('B', 9.9, 13.4, 1.0, 2.9); rise('c1', 11.6, 15.0, 0.3, 3.3); rise('c7', 12.2, 16.8, 2.0, 3.9); rise('c6', 13.2, 17.2, -2.3, 1.9); rise('c3', 14.0, 18.6, -2.6, 2.9);
  path('c2', 9.4, [[12.6, -0.5, 3.4]], { face: M }); path(H, 12.8, [[15.8, -1.7, 2.2]], { face: M }); path('c5', 12.0, [[16.2, 2.0, 2.9]], { face: M });
  path('c4', 15, [[19.4, -1.0, 4.6]], { face: M }); path('c10', 17, [[21.6, 2.6, 3.6]], { face: M }); path('c9', 19, [[25.5, -2.0, 4.7]], { face: M });
  path('c11', 9, [[11.2, 2.9, 2.2]], { face: M }); path('c12', 12, [[13.4, 3.2, 1.3]], { face: M }); path('c8', 24, [[28.5, 1.6, 4.7]], { face: M });
  for (const id of ['c4', 'c10', 'c9', 'c11', 'c12', 'c8', ...TEAM]) look(id, 9, M);

  // ── 0:23  Colleague Hong steps in and is taken for the mistress
  path(H, 22.5, [[24.3, -1.15, 0.8]], { face: [0, 0.75] }); say(H, 23.0, 25.2); hands(H, 23.2, 0.4, 'palm', 'palm');
  turn(M, 22.9, 0.6, -PI / 2); look(M, 22.9, H); look(R, 23, H);
  say(M, 25.2, 27.2, 1.4); hands(M, 24.9, 0.3, null, 'point'); set(M, 24.9, 0.3, { point: 1 });
  hands(M, 25.5, 0.25, 'reach', 'reach'); set(M, 25.5, 0.2, { point: 0 }); grab(M, 'r', 25.6, 28.85, wristOf('H', 'l')); grab(M, 'l', 25.7, 28.85, wristOf('H', 'r'));
  hands(H, 25.5, 0.3, 'reachLow', 'reachLow'); set(H, 25.6, 0.3, { shake: 1, brow: -0.6, lean: -0.08 });
  say(H, 27.2, 27.6, 1.2); say(M, 27.5, 28.5, 1.4); say(H, 28.6, 29.4, 1.5); set(M, 26, 0.4, { lean: 0.12 });
  // lets go, wheels round on the room
  say(M, 29.4, 32.0, 1.4); hands(M, 28.9, 0.35, 'bag', 'high'); set(M, 28.9, 0.4, { lean: 0 });
  turn(M, 28.9, 0.8, 1.0, 'outCubic'); hands(M, 29.9, 0.5, null, 'open');
  set(H, 28.9, 0.4, { shake: 0, lean: 0 }); hands(H, 28.9, 0.5, 'hang', 'hang'); path(H, 29.5, [[30.8, -2.6, 0.45]], { keep: true });
  path(M, 30.9, [[31.6, -0.2, 1.0]], { keep: true }); turn(M, 30.9, 0.6, 0.12);
  say(M, 32.2, 34.6, 1.6); hands(M, 31.3, 0.35, null, 'pointSide'); set(M, 31.3, 0.3, { point: 1 }); look(M, 31.2, [-6, 1.4, 3]); look(M, 33.0, 'c1');

  // ── 0:34  The Xiao Dong tries to move it outside
  path(B, 33.0, [[35.5, 0.2, 2.1]], { face: M }); say(B, 34.6, 37.4, 0.9); hands(B, 34.7, 0.5, 'palm', 'palm'); look(M, 34.4, B); look(B, 33, M);
  hands(M, 34.9, 0.5, null, 'open'); set(M, 34.9, 0.3, { point: 0 }); turn(M, 34.6, 0.5, B);
  hands(B, 36.0, 0.4, 'reachLow', 'reach');
  say(M, 37.4, 38.5, 1.3); hands(M, 37.2, 0.25, 'reach', 'reach'); grab(M, 'r', 37.3, 44.1, wristOf('B', 'l')); grab(M, 'l', 37.35, 44.1, wristOf('B', 'r'));
  hands(B, 37.3, 0.3, 'reachLow', 'reachLow'); set(M, 37.3, 0.3, { lean: 0.1 });
  say(B, 38.5, 39.3, 0.9); say(M, 39.3, 41.3, 1.3); say(B, 41.4, 44.0, 1.0); set(B, 41.4, 0.4, { lean: 0.08 });
  say(M, 44.0, 46.2, 1.4); hands(M, 44.1, 0.3, 'bag', 'shoo'); set(M, 44.2, 0.3, { lean: 0 }); hands(B, 44.2, 0.4, 'open', 'open'); set(B, 44.2, 0.4, { lean: 0 });
  path(B, 44.5, [[45.2, -0.5, 2.15]], { keep: true });

  // ── 0:45  She marches into the open office calling the name
  hands(M, 45.0, 0.5, null, 'open'); look(M, 45.2, [0.5, 1.4, 12]);
  path(M, 45.1, [[45.7, 0.4, 1.9], [47.3, 0.9, 3.1], [49.6, 0.6, 4.4]]);
  say(M, 46.3, 47.0, 1.5); say(B, 47.0, 48.3, 1.0); say(B, 48.3, 49.6, 0.9); say(M, 49.7, 51.0, 1.5);
  set(M, 48.4, 0.6, { hx: -0.6 }); set(M, 50.0, 0.7, { hx: 0.55 }); set(M, 51.4, 0.5, { hx: 0 });
  path(M, 51.4, [[55.8, 0.5, 7.0]], { ease: 'inOutSine' }); turn(M, 55.6, 0.4, 0);
  hands(B, 45.6, 0.5, 'hang', 'reach'); path(B, 45.7, [[47.5, -0.3, 2.4], [49.9, -0.3, 3.7]]); hands(B, 49.5, 0.6, 'hang', 'palm');
  path(B, 51.6, [[55.6, -0.35, 6.2]]); hands(B, 55, 0.6, 'hang', 'hang'); path(B, 57.0, [[58.6, -0.75, 5.35]], { keep: true });
  // the crowd trails after her and forms a line across the corridor
  const line = { H: [-0.1, 5.2], c5: [-1.5, 5.4], c6: [1.35, 5.3], c11: [2.05, 5.5], c2: [-1.2, 4.5], c1: [-0.45, 4.4], c3: [1.25, 4.4], c7: [1.9, 4.6], c4: [-1.55, 4.65], c9: [0.3, 3.8], c12: [2.3, 4.0], c8: [1.55, 6.35], c10: [2.05, 6.0] };
  Object.entries(line).forEach(([id, [x, z]], i) => { const t0 = 47.2 + (i % 5) * 0.7 + Math.floor(i / 5) * 0.5; path(id, t0, [[t0 + 5.2 + (i % 3) * 0.6, x, z]], { face: 0 }); look(id, 57, M); });

  // Ling Ling comes out of her office
  path(E, 47.3, [[49.4, 2.0, 10.7], [53.4, 0.7, 9.6], [56.7, 0.5, 8.5]], { face: PI }); look(E, 49, M); set(E, 55, 1, { brow: 0.25 });
  path('a1', 47.8, [[50.4, 2.1, 11.0], [56.4, 1.6, 9.75]], { face: PI }); path('a2', 53.0, [[56.2, 2.25, 10.2]], { face: PI });
  path('a3', 52.4, [[56.0, -1.7, 9.0]], { face: [0.5, 7.5] }); path('a4', 53.2, [[55.6, -2.1, 10.2]], { face: [0.5, 7.5] }); path('a5', 53.6, [[56.4, -1.5, 11.0]], { face: [0.5, 7.5] });
  look(M, 55.6, E); look(R, 46, M); look(B, 52, M);

  // ── 0:57  THE STAND-OFF
  for (const id of ['B']) hands(id, 59.0, 0.7, 'cross', 'cross');
  say(M, 59.3, 61.2, 1.2); hands(M, 59.0, 0.4, null, 'chest'); say(M, 61.5, 62.8, 1.1);
  say(M, 63.2, 65.0, 1.3); hands(M, 62.9, 0.4, null, 'openHi'); set(M, 63.0, 0.4, { twist: 0.35 }); set(M, 64.6, 0.4, { twist: 0 });
  say(E, 64.9, 66.3, 0.9); set(E, 64.6, 0.3, { brow: 0.5 });
  say(M, 66.8, 68.0, 1.3); hands(M, 65.3, 0.4, 'hip', 'hip'); set(M, 65.3, 0.4, { lean: -0.07 });
  say(M, 69.0, 70.5, 1.4); hands(M, 68.2, 0.3, null, 'point'); set(M, 68.2, 0.3, { point: 1, lean: 0.08 });
  say(M, 70.5, 73.8, 1.3); hands(M, 70.5, 0.4, null, 'chest'); set(M, 70.5, 0.3, { point: 0, lean: 0 });
  say(M, 74.0, 77.0, 1.3); hands(M, 74.0, 0.4, null, 'open');
  say(M, 77.2, 79.8, 1.5); hands(M, 77.0, 0.3, null, 'point'); set(M, 77.0, 0.3, { point: 1, lean: 0.1 });
  say(M, 80.0, 85.0, 1.4); hands(M, 80.2, 0.4, null, 'openHi'); set(M, 80.2, 0.3, { point: 0 }); hands(M, 82.2, 0.35, null, 'pointUp'); hands(M, 83.6, 0.35, null, 'openHi');
  say(M, 85.0, 88.8, 1.3); hands(M, 85.0, 0.4, null, 'pointLow'); set(M, 85, 0.3, { point: 1 }); set(M, 88.6, 0.4, { point: 0, lean: 0 });
  say(M, 90.2, 97.4, 1.3); hands(M, 89.0, 0.5, 'hip', 'pointUp'); set(M, 89.6, 0.3, { point: 1 });
  set(M, 93.3, 0.6, { twist: -0.65, hx: -0.45 }); hands(M, 93.3, 0.5, null, 'open'); set(M, 93.3, 0.3, { point: 0 });   // plays to the gallery
  set(M, 95.5, 0.6, { twist: 0, hx: 0 }); hands(M, 95.6, 0.5, null, 'hip');
  say(M, 98.2, 101.3, 1.3); hands(M, 98.0, 0.4, 'bag', 'openHi'); set(M, 98.0, 0.5, { twist: 0.3 }); set(M, 100.6, 0.5, { twist: 0 });
  set(E, 76, 2, { brow: 0.1 }); set(E, 96, 2, { brow: -0.2 });

  // ── 1:42  The lunge, and the drag out through reception
  hands(M, 101.5, 0.3, null, 'reach'); set(M, 101.6, 0.4, { lean: 0.28, crouch: 0.35 });
  path(M, 101.7, [[102.5, 0.5, 7.75]], { keep: true, run: true });
  grab(M, 'r', 102.3, 110.4, wristOf('E', 'l'), 0.18, 0.4); say(M, 102.4, 104.4, 1.6);
  set(E, 102.3, 0.3, { brow: -0.7, lean: -0.1, shake: 0.8 }); hands(E, 102.3, 0.25, 'reach', 'open');
  const behindM = () => { const m = M.s; return new THREE.Vector3(m.x - Math.sin(m.ry) * 0.32 - Math.cos(m.ry) * 0.2, 1.02, m.z - Math.cos(m.ry) * 0.32 + Math.sin(m.ry) * 0.2); };
  grab(E, 'l', 102.5, 110.3, behindM, 0.3, 0.5);
  set(M, 102.7, 0.5, { lean: 0.2, crouch: 0.1 });
  path(M, 102.7, [[104.6, 0.6, 5.7], [106.6, 1.5, 1.5], [107.5, 3.5, 0.15], [108.6, 5.6, -1.75], [110.2, 6.05, -5.6]], { run: true });
  path(E, 102.85, [[104.75, 0.6, 6.6], [106.75, 1.4, 2.4], [107.65, 3.1, 0.7], [108.75, 5.2, -0.9], [110.5, 5.6, -4.9]], { run: true });
  say(M, 108.4, 109.2, 1.4); say(M, 112.4, 113.2, 1.3);
  path(M, 110.2, [[110.8, 6.2, -6.3]], { keep: true }); turn(M, 110.15, 0.6, E); turn(E, 110.45, 0.5, [6.2, -6.3]);
  set(M, 110.2, 0.5, { lean: 0, crouch: 0 }); hands(M, 110.4, 0.5, null, 'hip'); hands(E, 110.4, 0.6, 'hang', 'hang'); set(E, 110.5, 0.6, { lean: 0, shake: 0, brow: -0.3 });
  hands(B, 101.9, 0.5, 'hang', 'hang');
  // crowd parts, then follows to the doorway
  for (const id of ['B', 'H', 'c1', 'c5', 'c2']) set(id, 102.0, 0.4, { lean: -0.06 });
  const door = { B: [5.5, -1.85], H: [4.9, -1.7], c5: [6.1, -1.75], c1: [6.65, -1.6], c2: [4.7, -1.2], c6: [5.3, -1.25], c3: [5.9, -1.2], c7: [6.5, -1.15], c4: [5.0, -0.5], c9: [5.6, -0.45], c10: [6.2, -0.5], c11: [6.8, -0.4], c12: [4.5, -0.3], c8: [5.4, 0.35] };
  Object.entries(door).forEach(([id, [x, z]], i) => {
    const t0 = 104.9 + i * 0.28;
    path(id, t0, [[t0 + 2.6, 1.4 + (i % 4) * 0.5, 2.4 + (i % 3) * 0.5], [t0 + 5.2 + i * 0.25, x, z]], { face: [6, -5.5] });
    set(id, t0 - 0.2, 0.3, { lean: 0 }); look(id, 104, M);
  });
  look(R, 104, M); turn(R, 106.6, 0.8, [5.6, -1.6]);
  for (const id of TEAM) look(id, 104, M);
  path('a1', 105, [[107.5, 1.2, 8.6]], { face: [1.5, 1] }); path('a2', 105.4, [[107.8, 1.9, 9.0]], { face: [1.5, 1] });
  turn(L1, 108.6, 0.6, [5.8, -5.5]); turn(L2, 108.9, 0.6, [5.8, -5.5]); look(L1, 108.5, M); look(L2, 108.8, M);

  // ── 1:51  LIFT LOBBY — the tirade
  hands(B, 111.5, 0.7, 'cross', 'cross'); look(M, 110.4, E); look(E, 110.4, M);
  say(M, 113.3, 119.0, 1.3); hands(M, 113.2, 0.4, null, 'chest'); hands(M, 115.0, 0.3, null, 'pointUp'); set(M, 115.0, 0.3, { point: 1 });
  say(M, 119.2, 123.8, 1.3); hands(M, 119.2, 0.4, null, 'open'); set(M, 119.2, 0.3, { point: 0 }); hands(M, 121.4, 0.3, null, 'openHi');
  say(M, 124.6, 125.8, 1.5); hands(M, 124.3, 0.3, null, 'up');
  say(M, 126.0, 128.2, 1.4); hands(M, 126.0, 0.4, null, 'chest');
  say(M, 128.4, 134.0, 1.4); hands(M, 128.4, 0.4, null, 'pointUp'); set(M, 128.4, 0.3, { point: 1 }); hands(M, 130.2, 0.3, null, 'point'); set(M, 130.2, 0.3, { twist: -0.5 });
  say(M, 134.2, 136.6, 1.5); hands(M, 134.2, 0.3, null, 'pointUp'); set(M, 134.2, 0.3, { twist: 0, lean: 0.08 });
  hands(M, 137.0, 0.6, null, 'hip'); set(M, 137.0, 0.5, { point: 0, lean: 0 });
  // the reply
  say(E, 137.8, 140.8, 0.8); say(E, 141.2, 143.2, 0.8); say(E, 143.4, 146.3, 0.9); say(E, 146.4, 148.9, 0.9); say(E, 149.2, 150.6, 0.9); say(E, 151.0, 155.0, 0.9);
  hands(E, 143.4, 0.5, null, 'reachLow'); hands(E, 149.0, 0.6, null, 'hang'); set(E, 137.5, 1, { brow: -0.35 });
  set(M, 140, 0.5, { hx: 0.2 }); set(M, 149.5, 0.5, { hx: 0, lean: -0.05 });
  say(M, 155.6, 157.6, 1.5); hands(M, 155.4, 0.3, null, 'chest'); set(M, 155.4, 0.3, { lean: 0.06 });
  say(M, 158.0, 162.2, 1.3); hands(M, 158.0, 0.4, null, 'palm'); say(M, 162.6, 165.2, 1.4); hands(M, 162.5, 0.3, null, 'openHi');
  say(M, 166.4, 170.3, 1.3); hands(M, 166.2, 0.4, null, 'open'); say(M, 170.6, 172.8, 1.4); hands(M, 170.5, 0.3, null, 'openHi');
  say(M, 174.2, 180.4, 1.3); hands(M, 174.0, 0.4, 'up', 'up'); hands(M, 176.6, 0.3, 'openHi', 'openHi'); hands(M, 178.0, 0.3, 'up', 'up'); hands(M, 179.4, 0.4, 'clasp', 'clasp');
  say(E, 180.5, 184.8, 0.9); say(E, 185.2, 187.6, 0.8); set(E, 180, 1, { brow: -0.7, eye: 0.15 }); hands(M, 181.0, 0.6, 'bag', 'hip');
  set(M, 187.6, 0.6, { hx: 0.45, hp: -0.12 }); set(M, 190.0, 0.4, { hx: 0, hp: 0 });
  say(M, 190.4, 192.4, 1.2); say(M, 192.5, 195.6, 1.2); hands(M, 192.4, 0.4, null, 'open');
  say(M, 195.8, 198.0, 1.4); hands(M, 195.6, 0.3, null, 'pointUp'); set(M, 195.6, 0.3, { point: 1 });
  say(M, 199.0, 201.0, 0.9); set(M, 198.8, 0.5, { hp: -0.25 }); hands(M, 198.6, 0.5, null, 'hip'); set(M, 198.6, 0.3, { point: 0 });
  // turns on the audience
  set(M, 201.0, 0.3, { hp: 0 }); path(M, 201.0, [[202.2, 6.7, -5.0]], { face: [5.7, -1.6] }); look(M, 201, B); look(E, 201.0, [5.9, 1.3, -9.4]);
  say(M, 201.2, 204.6, 1.5); hands(M, 201.3, 0.4, null, 'high'); say(M, 204.8, 207.6, 1.4); hands(M, 204.0, 0.5, null, 'openHi');
  set(E, 203.4, 1.2, { eye: 0.9, hp: 0.14 }); set(E, 206.6, 0.5, { eye: 0.2 });
  // she walks off; Xue Zhenzhu hauls her back
  // she turns back toward the office door; Xue Zhenzhu runs round in front of her and hauls on her arm
  look(E, 206.9, [5.8, 1.2, 1]); path(E, 207.2, [[209.0, 5.8, -4.2], [211.0, 5.9, -3.6]]);
  say(M, 207.9, 209.6, 1.5); look(M, 207.6, E); turn(M, 207.6, 0.6, [5.9, -3.6]); hands(M, 207.7, 0.3, null, 'point'); set(M, 207.7, 0.3, { point: 1 });
  say(E, 211.0, 212.3, 0.7);
  set(M, 209.6, 0.3, { point: 0 }); path(M, 209.6, [[210.5, 6.65, -3.9], [211.4, 5.4, -2.75]], { run: true, face: [5.9, -3.6] }); hands(M, 211.0, 0.3, 'reach', 'reach');
  grab(M, 'r', 211.5, 217.1, wristOf('E', 'l')); grab(M, 'l', 211.65, 217.1, elbowOf('E', 'l')); set(M, 211.5, 0.4, { lean: -0.12 });
  hands(E, 211.5, 0.3, 'reachLow', null); set(E, 211.5, 0.4, { shake: 0.8, hp: 0, lean: -0.06 }); look(E, 211.6, M);
  say(M, 212.6, 216.4, 1.6); say(M, 216.8, 218.2, 1.7); say(M, 218.4, 219.9, 1.5);
  hands(M, 217.1, 0.3, 'bag', 'pointUp'); set(M, 217.1, 0.3, { point: 1, lean: 0.06 }); hands(E, 217.2, 0.6, 'hang', 'hang'); set(E, 217.2, 0.6, { shake: 0, brow: -0.8, lean: 0 });

  // ── 3:36  Security
  set(G1, 213.4, 0.04, { hide: 0 }); set(G2, 213.4, 0.04, { hide: 0 });
  path(G1, 213.6, [[216.0, 12.0, -5.4], [219.2, 6.05, -2.8]], { run: true, face: M }); path(G2, 213.8, [[216.2, 12.0, -6.0], [218.0, 6.8, -4.9], [218.8, 5.0, -4.3], [219.6, 4.8, -2.7]], { run: true, face: M });
  look(G1, 214, M); look(G2, 214, M);
  hands(G1, 219.2, 0.3, 'reach', 'hang'); hands(G2, 219.6, 0.3, 'hang', 'reach');
  grab(G1, 'l', 219.4, 229.6, elbowOf('M', 'r')); grab(G2, 'r', 219.8, 229.6, elbowOf('M', 'l'));
  say(G1, 220.2, 222.7, 1.3);
  hands(M, 219.7, 0.4, 'held', 'held'); set(M, 219.7, 0.4, { point: 0, shake: 1, lean: -0.1 });
  say(M, 222.7, 223.6, 1.5); say(M, 223.7, 227.8, 1.7);
  turn(M, 221.0, 0.8, -PI / 2 - 0.5); look(M, 221, E);
  path(M, 221.2, [[223.6, 7.4, -3.5], [226.2, 10.6, -5.2], [229.6, 14.8, -5.7]], { keep: true });
  path(G1, 221.2, [[223.6, 7.85, -4.05], [226.2, 11.0, -5.75], [229.6, 15.1, -6.2]]); path(G2, 221.2, [[223.6, 7.5, -2.9], [226.2, 10.9, -4.65], [229.6, 15.1, -5.2]]);
  set(M, 229.0, 0.5, { shake: 0 });
  // left alone
  look(E, 221.2, [5.9, 0.9, -1]); set(E, 221, 1.5, { hp: 0.16, eye: 0.35 });
  turn(E, 225.2, 1.8, PI - 0.25); look(E, 225.2, [9, 1.3, -6]); set(E, 226, 1, { hp: 0.05 });
  look(E, 231, [5.6, 0.8, -9]); set(E, 234.5, 1.5, { hp: 0.22, eye: 0.55, brow: -1, tear: 1 });
  hands(E, 238.0, 0.9, null, 'hair', 'inOutSine'); set(E, 238.2, 1.0, { eye: 0.85 });

  // ── 3:50  "Back to work" — the crowd breaks up
  for (const id of CROWD) { look(id, 137.6, E); look(id, 155.4, M); look(id, 180.4, E); look(id, 190.2, M); }
  hands(B, 230.3, 0.5, 'hang', 'hang'); turn(B, 230.2, 0.5, 0); path(B, 230.5, [[231.3, 5.5, -2.55]], { keep: true }); look(B, 230.4, 'c3');
  say(B, 231.0, 232.4, 1.2); say(B, 232.4, 234.8, 1.1); say(B, 235.0, 238.6, 0.9);
  hands(B, 230.9, 0.3, 'shoo', 'shoo'); hands(B, 232.3, 0.3, 'openHi', 'openHi'); hands(B, 233.4, 0.3, 'shoo', 'shoo'); hands(B, 234.9, 0.5, 'hang', 'shoo');
  const home = { H: [1.0, 5.2], c5: [-0.6, 6.4], c1: [-3.2, 4.4], c2: [-2.4, 7.6], c6: [0.4, 7.9], c3: [1.8, 3.6], c7: [3.0, 5.8], c4: [-1.0, 9.6], c9: [0.2, 4.2], c10: [2.0, 8.6], c11: [-2.2, 3.0], c12: [1.2, 9.8], c8: [0.9, 6.6] };
  Object.entries(home).forEach(([id, [x, z]], i) => {
    const row = id in { H: 1, c5: 1, c1: 1 } ? 2 : id in { c2: 1, c6: 1, c3: 1, c7: 1 } ? 1 : 0, t0 = 231.9 + row * 0.75 + (i % 4) * 0.22;
    look(id, 231.2, B); look(id, t0, null);
    path(id, t0, [[t0 + 2.2, 4.9 + (i % 4) * 0.5, 0.7 + (i % 3) * 0.4], [t0 + 7.5, x, z]]);
  });
  path(B, 236.0, [[239.8, 5.6, 0.6]]);
  turn(L1, 231, 1.0, [8, -9]); turn(L2, 230.5, 1.0, L1); look(L1, 229, E); look(L2, 229, E);

  // ═════════════════════════ ACTING PASS — reactions layered over the blocking
  // recoil = a quick flinch (eyes shut, shoulders up, weight back); shrink = sustained folding-in under pressure
  const flinch = (p, t, amt = 0.8, hold = 0.25) => { key(p, 'recoil', t, t + 0.12, amt, 'outCubic'); key(p, 'recoil', t + 0.12 + hold, t + 0.9 + hold, 0, 'inOutSine'); };
  const press = (p, t, dur, v) => key(p, 'shrink', t, t + dur, v);
  const gasp = (t, ids, amt = 0.6) => ids.forEach((id, i) => flinch(id, t + (i % 4) * 0.05, amt * (0.7 + (i % 3) * 0.15), 0.15));
  const focusAt = (t) => ((t >= 137.6 && t < 155.4) || (t >= 180.4 && t < 190.2) ? E : M);
  const whisper = (a, b, t0, t1) => { look(a, t0, b); look(b, t0 + 0.2, a); say(a, t0 + 0.4, t1 - 0.3, 0.3); set(a, t0, 0.4, { tilt: 0.12 }); set(a, t1, 0.4, { tilt: 0 }); look(a, t1, focusAt(t1)); look(b, t1 + 0.15, focusAt(t1)); };
  const step = (p, t, x, z, dur = 0.5) => { key(p, 'x', t, t + dur, x, 'outCubic'); key(p, 'z', t, t + dur, z, 'outCubic'); };

  // the receptionist: startled, then terrified, never quite recovers
  press(R, 2.5, 0.3, 0.35); flinch(R, 2.6, 0.6); flinch(R, 9.5, 0.5); press(R, 11.3, 0.3, 0.9); flinch(R, 11.35, 1, 0.5); flinch(R, 14.4, 0.6); press(R, 20.8, 1.0, 0.45); press(R, 30, 2, 0.3);
  // Hong walks in confident and is shaken out of it
  press(H, 25.6, 0.3, 0.6); flinch(H, 25.65, 0.9, 0.4); press(H, 29.0, 0.8, 0.15);
  flinch(B, 37.4, 0.5);

  // Ling Ling: composure eroding beat by beat; she only straightens to answer back
  flinch(E, 59.4, 0.25); press(E, 66, 2, 0.1); press(E, 77, 1, 0.22); flinch(E, 77.3, 0.5); flinch(E, 83.0, 0.4); press(E, 85, 2, 0.3); flinch(E, 98.3, 0.3);
  press(E, 102.3, 0.4, 0.6); flinch(E, 102.32, 1, 0.6);
  press(E, 110.6, 1.5, 0.3); flinch(E, 115.1, 0.55); flinch(E, 124.7, 0.6); press(E, 128.4, 2, 0.45); flinch(E, 130.7, 0.7); flinch(E, 134.3, 0.6);
  press(E, 137.2, 0.8, 0.1);                                                    // gathers herself
  flinch(E, 155.7, 0.4); press(E, 156, 2, 0.3); flinch(E, 162.7, 0.45); flinch(E, 170.7, 0.5); press(E, 172, 3, 0.42);
  press(E, 180.2, 0.6, 0.2); set(E, 180, 1, { tilt: -0.08 });
  press(E, 190.4, 2, 0.5); flinch(E, 195.9, 0.5); press(E, 201.5, 2, 0.65);
  press(E, 207.0, 0.5, 0.45); press(E, 211.5, 0.4, 0.8); flinch(E, 211.55, 1, 0.5); flinch(E, 216.9, 0.6);
  press(E, 221, 2, 0.7); press(E, 234, 3, 0.95);

  // Xue Zhenzhu closes the distance when she goes for the throat; Ling Ling gives ground
  step(M, 76.9, 0.5, 7.22); step(M, 88.9, 0.5, 7.05, 0.8);
  step(M, 128.3, 6.12, -6.05); step(M, 134.2, 6.05, -5.85, 0.4); step(E, 134.5, 5.52, -4.72, 0.6); step(M, 137.0, 6.15, -6.12, 0.7);
  step(M, 155.6, 6.05, -5.9, 0.4); step(M, 174.2, 6.0, -5.8); step(E, 176.0, 5.5, -4.6, 0.6);

  // the gallery: gasps at every physical moment, whispers in between
  const others = CROWD.filter((id) => id !== 'B');
  gasp(11.45, ['B', 'c2', 'c11', 'c12'], 0.5); gasp(25.7, ['B', 'c1', 'c2', 'c5', 'c6', 'c3', 'c7', 'c11', 'c12', 'c4'], 0.5); gasp(37.45, ['H', 'c1', 'c2', 'c5', 'c6', 'c7'], 0.4);
  gasp(77.3, ['c5', 'c8', 'c11', 'H'], 0.35); gasp(102.35, [...others, ...TEAM], 0.8); flinch(B, 102.4, 0.4);
  gasp(130.7, ['c8', 'c5', 'c9'], 0.3); gasp(211.6, [...CROWD, 'L1', 'L2'], 0.6); gasp(219.8, CROWD, 0.5);
  whisper('c1', 'c2', 62.6, 65.2); whisper('a1', 'a2', 70, 73); whisper('c6', 'c11', 84.0, 87.0); whisper('c3', 'c7', 92.0, 95.0);
  whisper('H', 'c5', 118.0, 121.0); whisper('c2', 'c6', 142.0, 145.0); whisper('L1', 'L2', 150, 153); whisper('c9', 'c10', 160.0, 163.0);
  whisper('c4', 'c12', 172.5, 175.5); whisper('c1', 'H', 186.0, 189.0);
  // and between gasps a held look, different on each face: worried, disapproving, curious; sharper after the lunge
  const mood = [-0.25, 0.12, -0.35, 0, -0.15, 0.2, -0.2];
  [...CROWD.filter((id) => id !== 'B' && id !== 'H'), ...TEAM].forEach((id, i) => {
    const m = mood[i % mood.length];
    set(id, 10 + (i % 6) * 1.3, 2, { brow: m }); set(id, 103 + (i % 4) * 0.4, 1.5, { brow: m * 1.5 - 0.1 });
  });

  // ═════════════════════════ compile → Anime.js
  const tl = createTimeline({ autoplay: false, defaults: { ease: 'linear' } });
  let nKeys = 0;
  for (const p of list) {
    const props = {}, b = base.get(p);
    for (const [prop, keys] of Object.entries(K.get(p))) {
      keys.sort((a, c) => a.t0 - c.t0);
      let end = 0; const frames = [{ to: b[prop], duration: 0 }];
      for (const k of keys) {
        const t0 = Math.max(k.t0, end), t1 = Math.max(k.t1, t0 + 0.02);
        frames.push({ to: k.v, duration: (t1 - t0) * 1000, delay: (t0 - end) * 1000, ease: k.ease }); end = t1; nKeys++;
      }
      props[prop] = frames;
    }
    if (Object.keys(props).length) tl.add(p.s, props, 0);
    p.lookTrack.sort((a, c) => a.t - c.t);
  }
  tl.add({ v: 0 }, { v: 1, duration: 240000 }, 0);

  const apply = (t) => {
    tl.seek(Math.max(0, Math.min(240, t)) * 1000);
    for (const p of list) {
      let fn = null; for (const l of p.lookTrack) { if (l.t <= t) fn = l.fn; else break; }
      p.lookAt = fn;
      for (const side of ['l', 'r']) { let g = null; for (const tr of p.grabTrack[side]) if (t >= tr.t0 && t <= tr.t1) g = tr.fn; p.grab[side] = g; }
    }
  };
  return { timeline: tl, apply, nKeys };
}
