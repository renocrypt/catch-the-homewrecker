// The cut: 93 shots matching the source's cut points (seconds).
// Cameras are placed relative to the live positions of the people in the shot, so the
// framing follows the blocking. Each conversation keeps its cameras on one side of the
// eyeline between the two speakers (the 180° rule), as the original does.
import * as THREE from 'three';

const V = THREE.Vector3, rad = Math.PI / 180;

export function buildShots(cast) {
  const head = (who) => (Array.isArray(who) ? new V(who[0], who.length > 2 ? who[1] : 1.5, who[who.length - 1]) : cast[who].headPos(new V()));
  const basis = (a, b) => { const ax = new V(b.x - a.x, 0, b.z - a.z).normalize(); return { ax, n: new V(-ax.z, 0, ax.x) }; };
  const shift = (out, sx = 0, sy = 0) => { const f = new V().subVectors(out.look, out.pos); f.y = 0; f.normalize(); out.look.x += -f.z * sx; out.look.z += f.x * sx; out.look.y += sy; };

  // close-up of A, seen from B's direction, swung th degrees to side s of the eyeline
  const cu = (A, B, s, o = {}) => (t, p, out) => {
    const a = head(A), { ax, n } = basis(a, head(B)), d = o.d ?? 1.5, th = (o.th ?? 24) * rad;
    out.pos.copy(a).addScaledVector(ax, d * Math.cos(th)).addScaledVector(n, s * d * Math.sin(th)); out.pos.y = a.y + (o.h ?? 0);
    out.look.copy(a); shift(out, o.sx ?? 0, o.sy ?? -0.02);
    out.fov = o.fov ?? 25; out.focus = d; out.blur = o.blur ?? 1; out.push = o.push ?? 0.03; out.shake = o.shake ?? 1;
  };
  // over A's shoulder, looking at B
  const ots = (A, B, s, o = {}) => (t, p, out) => {
    const a = head(A), b = head(B), { ax, n } = basis(a, b), back = o.back ?? 0.8, side = o.side ?? 0.42;
    out.pos.copy(a).addScaledVector(ax, -back).addScaledVector(n, s * side); out.pos.y = a.y + (o.h ?? 0.08);
    out.look.copy(b); if (o.to) out.look.lerp(head(o.to), THREE.MathUtils.smoothstep(t, o.t0, o.t1) * (o.mix ?? 1));
    shift(out, o.sx ?? 0, o.sy ?? -0.03);
    out.fov = o.fov ?? 31; out.focus = out.pos.distanceTo(b); out.blur = o.blur ?? 0.8; out.push = o.push ?? 0.02; out.shake = o.shake ?? 1;
  };
  // fixed tripod / dolly: pos and look can be points, people, or [from, to] pairs
  const pt = (x, p) => (typeof x === 'string' ? head(x) : x.length === 2 ? head(x[0]).lerp(head(x[1]), p) : new V(x[0], x[1], x[2]));
  const fix = (pos, look, fov, o = {}) => (t, p, out) => {
    const e = p * p * (3 - 2 * p);
    out.pos.copy(Array.isArray(pos[0]) ? new V(...pos[0]).lerp(new V(...pos[1]), e) : new V(...pos));
    if (o.mid) out.look.copy(head(o.mid[0])).lerp(head(o.mid[1]), 0.5); else out.look.copy(pt(look, e));
    shift(out, o.sx ?? 0, o.sy ?? 0);
    out.fov = fov; out.focus = o.focus ? out.pos.distanceTo(head(o.focus)) : out.pos.distanceTo(out.look); out.blur = o.blur ?? 0.45; out.push = o.push ?? 0; out.shake = o.shake ?? 0.8;
  };
  // camera rides along with a person
  const track = (A, off, fov, o = {}) => (t, p, out) => {
    const a = cast[A].s; out.pos.set(a.x + off[0], off[1], a.z + off[2]); out.look.copy(head(A)); shift(out, o.sx ?? 0, o.sy ?? -0.05);
    out.fov = fov; out.focus = out.pos.distanceTo(out.look); out.blur = o.blur ?? 0.7; out.push = 0; out.shake = o.shake ?? 1.6;
  };

  const eCU = (o) => cu('E', 'M', -1, { d: 1.45, th: 26, sx: -0.1, ...o }), mWide = (o) => ots('E', 'M', -1, { back: 1.3, side: 1.1, fov: 33, h: 0.04, sx: -0.05, sy: -0.25, blur: 0.5, ...o });
  const mSide = (o) => ots('E', 'M', -1, { back: 0.8, side: 0.85, fov: 30, sx: -0.25, sy: -0.12, ...o });
  const lobM = (o) => cu('M', 'E', 1, { d: 1.6, th: 30, sx: 0.14, ...o }), lobE = (o) => cu('E', [6.2, -6.3], -1, { d: 1.6, th: 28, sx: -0.12, ...o });
  const lobOts = (o) => ots('M', 'E', 1, { back: 0.85, side: 0.42, fov: 27, sx: -0.12, ...o });
  const lobWide = (o) => fix([5.5, 1.35, -9.2], [5.4, 1.2, -2.6], 34, { blur: 0.3, focus: 'E', ...o });
  const lobWide2 = (o) => fix([5.3, 1.4, -9.2], [5.5, 1.2, -2.5], 30, { blur: 0.3, focus: 'M', ...o });
  const gallery = (o = {}) => fix([5.9, 1.5, -3.25], 'B', 27, { sx: 0.12, blur: 0.9, ...o });

  // [start time, label, camera]
  const S = [
    [0.0, 'OTS Xue Zhenzhu → receptionist', ots('M', 'R', 1, { back: 0.95, side: 0.55, h: 0.1, fov: 30, sx: -0.35, sy: -0.08 })],
    [1.76, 'CU Xue Zhenzhu', cu('M', 'R', 1, { d: 1.55, sx: 0.16 })],
    [2.84, 'meeting table turns', fix([-1.8, 1.3, 3.0], [-4.4, 1.05, 5.0], 34, { blur: 0.4 })],
    [4.12, 'CU Xue Zhenzhu', cu('M', 'R', 1, { d: 1.2, th: 20, sx: 0.12 })],
    [6.64, 'OTS Xue Zhenzhu → receptionist', ots('M', 'R', 1, { back: 0.95, side: 0.55, h: 0.1, fov: 30, sx: -0.35, sy: -0.08 })],
    [8.32, 'CU Xue Zhenzhu, staff rising behind', cu('M', 'R', 1, { d: 1.7, th: 28, sx: 0.2, blur: 0.7 })],
    [11.4, 'OTS — the wrist grab', ots('M', 'R', 1, { sx: -0.22, sy: -0.14, back: 0.9 })],
    [14.12, 'CU Xue Zhenzhu, crowd gathering', cu('M', 'R', 1, { d: 1.8, th: 30, sx: 0.22, blur: 0.6 })],
    [15.36, 'OTS Xue Zhenzhu → receptionist', ots('M', 'R', 1, { sx: -0.22, sy: -0.12, back: 0.9 })],
    [18.4, 'CU Xue Zhenzhu looks back', cu('M', 'R', 1, { d: 1.35, th: 34, sx: 0.1 })],
    [21.36, 'OTS → pan to Hong', ots('M', 'R', 1, { sx: -0.2, to: 'H', t0: 23.2, t1: 24.4, mix: 0.5, back: 1.1, side: 0.5, fov: 34 })],
    [24.76, 'side two-shot', fix([-1.5, 1.45, 2.6], [-0.65, 1.32, 0.7], 30, { blur: 0.5 })],
    [28.0, 'OTS Xue Zhenzhu → Hong', ots('M', 'H', 1, { back: 0.7, side: 0.36, fov: 28, sx: -0.1 })],
    [29.0, 'Xue Zhenzhu wheels round', fix([1.7, 1.45, 1.5], 'M', 30, { blur: 0.8, shake: 2.5 })],
    [31.2, 'calling the name', fix([0.5, 1.4, 2.35], 'M', 40, { sx: -0.25, sy: -0.08, blur: 0.6 })],
    [33.52, 'OTS Xue Zhenzhu → Xiao Dong', ots('M', 'B', -1, { back: 1.1, side: 0.5, fov: 36, sx: 0.2 })],
    [36.64, 'OTS Xiao Dong → Xue Zhenzhu', ots('B', 'M', 1, { back: 0.75, side: 0.4, fov: 29, sx: 0.12 })],
    [40.52, 'OTS Xue Zhenzhu → Xiao Dong', ots('M', 'B', -1, { back: 0.7, side: 0.38, fov: 28, sx: 0.12 })],
    [43.32, 'OTS Xiao Dong → Xue Zhenzhu', ots('B', 'M', 1, { back: 0.75, side: 0.4, fov: 28, sx: 0.12 })],
    [45.6, 'follow her into the office', fix([[1.7, 1.5, 1.2], [1.0, 1.6, 2.4]], 'M', 34, { blur: 0.4, shake: 2.2, sy: -0.2 })],
    [48.84, 'Ling Ling appears', fix([0.2, 1.45, 8.6], 'E', 20, { blur: 0.9, sx: 0.2 })],
    [51.48, 'tracking, front', track('M', [-0.9, 1.45, 1.95], 32)],
    [55.92, 'OTS Xue Zhenzhu → Ling Ling', ots('M', 'E', 1, { back: 0.9, side: 0.45, fov: 34, sx: -0.2, sy: -0.25 })],
    [59.2, 'wide past Ling Ling', mWide()],
    [60.72, 'CU Ling Ling', eCU()],
    [62.44, 'wide past Ling Ling', mWide()],
    [64.16, 'CU Ling Ling', eCU()],
    [65.4, 'Xue Zhenzhu, glass room behind', mSide()],
    [68.92, 'CU Ling Ling', eCU()],
    [70.08, 'Xue Zhenzhu, glass room behind', mSide()],
    [73.0, 'CU Ling Ling', eCU()],
    [75.16, 'the gallery', fix([0.4, 1.5, 6.8], 'B', 26, { sx: 0.15, blur: 0.9 })],
    [77.12, 'Xue Zhenzhu, glass room behind', mSide()],
    [79.28, 'CU Ling Ling', eCU()],
    [81.04, 'Xue Zhenzhu, glass room behind', mSide()],
    [84.36, 'CU Ling Ling', eCU()],
    [86.32, 'pan across the gallery', fix([0.5, 1.5, 6.9], ['c3', 'B'], 26, { blur: 0.9 })],
    [88.96, 'wide past Ling Ling', mWide({ fov: 42 })],
    [96.72, 'CU Ling Ling', eCU()],
    [98.4, 'the gallery', fix([0.4, 1.5, 6.8], 'B', 26, { sx: 0.15, blur: 0.9 })],
    [100.28, 'CU Ling Ling', eCU()],
    [101.72, 'the lunge', mWide({ fov: 42, shake: 2 })],
    [102.56, 'CU Ling Ling', eCU({ shake: 2.5 })],
    [103.44, 'grabbed', fix([1.6, 1.4, 8.7], null, 30, { mid: ['M', 'E'], shake: 5, blur: 0.6 })],
    [104.52, 'they sweep past the gallery', fix([1.3, 1.5, 7.0], 'B', 30, { blur: 0.8, shake: 2 })],
    [105.8, 'the team looks on', fix([0.2, 1.35, 6.4], [0.4, 1.2, 9.7], 34, { blur: 0.4 })],
    [106.72, 'high wide — out past reception', fix([-1.2, 2.6, 6.4], [2.4, 1.0, -0.2], 40, { blur: 0.2, focus: 'M' })],
    [107.92, 'lobby — through the doors', fix([5.4, 1.3, -9.2], [5.6, 1.15, -2.6], 30, { blur: 0.35, focus: 'M' })],
    [110.88, 'OTS Xue Zhenzhu → Ling Ling', lobOts()],
    [114.88, 'CU Xue Zhenzhu', lobM()],
    [117.24, 'CU Ling Ling', lobE()],
    [120.32, 'faces in the doorway', fix([6.0, 1.5, -3.15], [[4.7, 1.45, -1.6], [5.6, 1.45, -1.7]], 40, { blur: 0.5 })],
    [123.44, 'lobby wide', lobWide()],
    [125.08, 'CU Xue Zhenzhu', lobM()],
    [127.4, 'CU Ling Ling', lobE()],
    [129.44, 'CU Xue Zhenzhu — the ultimatum', lobM({ d: 1.5 })],
    [132.4, 'faces in the doorway', fix([5.6, 1.5, -3.1], [6.4, 1.45, -1.2], 36, { blur: 0.5 })],
    [133.6, 'the gallery', gallery()],
    [134.76, 'CU Xue Zhenzhu', lobM()],
    [135.88, 'CU Ling Ling — the reply', lobE()],
    [139.76, 'CU Xue Zhenzhu', lobM()],
    [141.96, 'CU Ling Ling', lobE()],
    [144.88, 'CU Xue Zhenzhu', lobM()],
    [145.92, 'tight OTS → Ling Ling', lobOts({ fov: 23 })],
    [148.04, 'the gallery', gallery()],
    [149.96, 'CU Xue Zhenzhu', lobM()],
    [151.4, 'tight OTS → Ling Ling', lobOts({ fov: 23 })],
    [154.4, 'CU Xue Zhenzhu — long take', lobM({ push: 0.07 })],
    [164.2, 'OTS Xue Zhenzhu → Ling Ling', lobOts({ fov: 30 })],
    [167.88, 'CU Xue Zhenzhu', lobM()],
    [172.12, 'OTS Xue Zhenzhu → Ling Ling', lobOts({ fov: 30 })],
    [174.84, 'CU Xue Zhenzhu', lobM({ d: 1.5 })],
    [179.92, 'tight OTS → Ling Ling', lobOts({ fov: 22 })],
    [183.64, 'CU Xue Zhenzhu', lobM()],
    [184.88, 'tight OTS → Ling Ling', lobOts({ fov: 22 })],
    [186.92, 'CU Xue Zhenzhu', lobM()],
    [191.56, 'tight OTS → Ling Ling', lobOts({ fov: 23 })],
    [194.84, 'CU Xue Zhenzhu', lobM()],
    [197.36, 'tight OTS → Ling Ling', lobOts({ fov: 23 })],
    [200.08, 'the whole gallery', fix([5.75, 1.45, -4.3], [5.7, 1.2, -1.0], 50, { blur: 0.15 })],
    [201.64, 'lobby wide — she turns on them', fix([6.0, 1.35, -9.2], [5.7, 1.2, -2.6], 34, { blur: 0.3, focus: 'E' })],
    [203.52, 'CU Ling Ling, eyes closing', lobE({ push: 0.06 })],
    [206.84, 'she turns for the door', fix([4.4, 1.45, -2.5], 'E', 24, { blur: 0.8, sx: 0.15 })],
    [211.28, 'OTS Ling Ling → Xue Zhenzhu', ots('E', 'M', 1, { back: 1.0, side: 0.35, fov: 32, sx: 0.1, shake: 2.5 })],
    [213.92, 'hauled back', fix([4.6, 1.5, -2.2], 'E', 26, { blur: 0.8, sx: -0.1, shake: 2.5 })],
    [217.32, 'lobby wide — security', lobWide2()],
    [220.12, 'the guard', fix([4.9, 1.5, -4.3], null, 30, { mid: ['M', 'G1'], blur: 0.9, shake: 3 })],
    [221.04, 'profile — led away behind her', fix([4.55, 1.5, -2.9], 'E', 24, { blur: 0.9, sx: 0.12 })],
    [226.04, 'lobby wide — alone', lobWide2({ focus: 'E' })],
    [230.44, 'back to work', fix([5.62, 1.74, -0.7], 'B', 30, { blur: 0.6, sy: -0.06 })],
    [232.2, 'the crowd breaks', fix([5.5, 1.5, -3.15], [5.6, 1.2, -0.8], 52, { blur: 0.2 })],
    [233.48, 'filing back inside', fix([[5.6, 1.5, -1.2], [5.3, 1.5, -0.4]], [3.4, 1.2, 3.6], 40, { blur: 0.25 })],
    [236.36, 'CU Ling Ling', fix([5.7, 1.55, -5.3], 'E', 22, { blur: 1, push: 0.08, sx: -0.08, sy: -0.02 })],
  ];
  return S.map(([t0, label, fn], i) => ({ n: i + 1, t0, t1: i + 1 < S.length ? S[i + 1][0] : 240, label, fn }));
}

export function shotAt(shots, t) {
  let lo = 0, hi = shots.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (shots[m].t0 <= t) lo = m; else hi = m - 1; }
  return shots[lo];
}
