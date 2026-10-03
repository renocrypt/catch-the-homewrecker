// Rigged cast members exported by tools/characters.py (MPFB, game_engine rig, ARKit face units).
//
// A model does not animate itself. Its Person still runs every frame (posture, temperament, hand targets, grabs, the
// face channels) with its own primitive body hidden; Actor then poses the model's bones from that result. Arms and
// legs are re-solved with the model's own bone lengths toward the Person's wrists and ankles, so contacts still land,
// and each limb bends about the hinge it has in the rest pose. Face channels drive the ARKit morph targets on the
// body and on everything fitted to it (brows, lashes, teeth).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);   // models are packed with gltfpack (tools/build_models.sh)
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), qI = new THREE.Quaternion();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), v5 = new THREE.Vector3();
const m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4();
// strand cards (hair, brows, lashes): materials are named "<Kind>.<asset>" by tools/characters.py; older exports are
// "Human.<asset>", recognised by asset name
const CARDS = /^(Hair|Eyebrows|Eyelashes)\.|^Human\.(afro|short0|long0|ponytail|toigo_.*bob|.*hair|eyebrow|eyelash)/i;
const CURL = 1;   // sign of a finger curl about the knuckle line (set by eye in the fitting room)

// load a model, scale it to `height` metres and measure the skeleton in that scale
export async function loadModel(url, height) {
  const gltf = await loader.loadAsync(url), scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene), k = height / (box.max.y - box.min.y);
  scene.scale.setScalar(k); scene.updateMatrixWorld(true);
  const bones = {}, morphs = [];
  scene.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.transparent = false; m.depthWrite = true;
        // cards are cut out at a fixed threshold and smoothed by MSAA (alpha to coverage): stable from frame to frame,
        // where a hashed alpha re-dithers every time anything moves and the hair shimmers
        if (CARDS.test(m.name)) { m.alphaHash = false; m.alphaTest = 0.42; m.alphaToCoverage = true; m.side = THREE.DoubleSide; }
        else { m.alphaTest = 0; m.side = /suit|dress|skirt|coat|shirt|top/i.test(m.name) ? THREE.DoubleSide : THREE.FrontSide; }
        const skin = /body|ears|lips|fingernails/i.test(m.name);
        m.roughnessMap = null; m.metalnessMap = null; m.metalness = 0; m.roughness = skin ? 0.58 : 0.86;   // MakeHuman spec maps arrive as metal/rough
        if (m.isMeshPhysicalMaterial) m.specularIntensity = skin ? 0.6 : 0.35;
        if (m.isMeshPhysicalMaterial && CARDS.test(m.name) && !/brow|lash/i.test(m.name)) {   // strands catch a soft highlight
          m.roughness = 0.62; m.specularIntensity = 0.35; m.sheen = /afro/i.test(m.name) ? 0 : 0.3; m.sheenColor = new THREE.Color('#5a524c'); m.sheenRoughness = 0.5;
        }
        m.needsUpdate = true;
      }
      if (o.morphTargetDictionary) { o.morphTargetInfluences.fill(0); morphs.push(o); }
    }
  });
  const at = (n) => bones[n].getWorldPosition(new THREE.Vector3());   // model at its final scale, root at the origin
  const d = {
    hipY: (at('thigh_l').y + at('thigh_r').y) / 2, hipX: Math.abs(at('thigh_l').x),
    shoY: at('upperarm_l').y, shoX: Math.abs(at('upperarm_l').x),
    up: at('upperarm_l').distanceTo(at('lowerarm_l')), fore: at('lowerarm_l').distanceTo(at('hand_l')),
    thigh: at('thigh_l').distanceTo(at('calf_l')), shin: at('calf_l').distanceTo(at('foot_l')), ankle: at('foot_l').y,
    headY: at('head').y + 0.075 * k, crown: box.max.y * k,
  };
  return { scene, bones, morphs, d, k, section: measureTorso(scene, d) };
}

// The clothed torso's cross-section by height (metres, root space): half width, depth in front, depth behind. Taken from
// vertices that mostly follow the pelvis / spine, so arms and legs don't count. Person.keepOut uses it to keep hands out.
function measureTorso(scene, d) {
  const y0 = d.hipY - 0.25, step = 0.025, n = Math.ceil((d.shoY + 0.08 - y0) / step);
  const hw = new Float32Array(n), fz = new Float32Array(n), bz = new Float32Array(n), v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || /hair|afro|brow|lash|teeth|tongue|low-poly|eye/i.test(o.name + (o.material.name || ''))) return;
    const torso = new Set(o.skeleton.bones.map((b, i) => (/^(pelvis|spine_0[123]|clavicle_[lr]|neck_01)$/.test(b.name) ? i : -1)).filter((i) => i >= 0));
    const pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    for (let i = 0; i < pos.count; i++) {
      let w = 0; for (let c = 0; c < 4; c++) if (torso.has(si.getComponent(i, c))) w += sw.getComponent(i, c);
      if (w < 0.6) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const b = Math.floor((v.y - y0) / step); if (b < 0 || b >= n) continue;
      hw[b] = Math.max(hw[b], Math.abs(v.x)); fz[b] = Math.max(fz[b], v.z); bz[b] = Math.max(bz[b], -v.z);
    }
  });
  const grow = (a) => a.map((_, i) => Math.max(a[Math.max(0, i - 1)], a[i], a[Math.min(n - 1, i + 1)]));   // conservative: widest neighbour
  return { y0, step, hw: grow(hw), fz: grow(fz), bz: grow(bz) };
}

// Person proportions (its inner units, i.e. metres / person scale) from a measured model
export function dimsFor(model, sc) {
  const d = model.d, u = (x) => x / sc;
  return { hip: u(d.hipY), sho: u(d.shoY - d.hipY), up: u(d.up), fore: u(d.fore), thigh: u(d.thigh), shin: u(d.shin), ankle: u(d.ankle), hipX: u(d.hipX), sw: u(d.shoX), headY: u(d.headY - d.hipY) };
}

export class Actor {
  constructor(person, model) {
    this.p = person; this.m = model; this.b = model.bones;
    person.root.add(model.scene);
    // rest pose, in the model's own space (its scene node is the reference frame)
    const inv = m1.copy(model.scene.matrixWorld).invert();
    this.rest = {};
    for (const [n, b] of Object.entries(this.b)) {
      const mw = m2.multiplyMatrices(inv, b.matrixWorld), pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      mw.decompose(pos, q, s); this.rest[n] = { pos, q, local: b.quaternion.clone(), localPos: b.position.clone() };
    }
    const R = this.rest, hinge = (a, b, c) => v1.subVectors(R[b].pos, R[a].pos).cross(v2.subVectors(R[c].pos, R[b].pos)).normalize().clone();
    this.limbs = ['l', 'r'].flatMap((s) => [
      { a: `upperarm_${s}`, b: `lowerarm_${s}`, c: `hand_${s}`, n: hinge(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`), side: s, arm: true },
      { a: `thigh_${s}`, b: `calf_${s}`, c: `foot_${s}`, n: hinge(`thigh_${s}`, `calf_${s}`, `foot_${s}`), side: s, arm: false },
    ]);
    for (const L of this.limbs) { L.l1 = R[L.a].pos.distanceTo(R[L.b].pos); L.l2 = R[L.b].pos.distanceTo(R[L.c].pos); }
    this.pelvisOff = R.pelvis.pos.clone().sub(v1.addVectors(R.thigh_l.pos, R.thigh_r.pos).multiplyScalar(0.5));
    this.mq = {}; this.md = {};   // current model-space rotation and delta-from-rest per bone
    this.lean = 0; this.leanAxis = new THREE.Vector3(1, 0, 0);
    this.shoRel = { l: this.rest.upperarm_l.pos.clone().sub(this.rest.pelvis.pos), r: this.rest.upperarm_r.pos.clone().sub(this.rest.pelvis.pos) };
    this.units = new Map();
    for (const mesh of model.morphs) for (const [name, i] of Object.entries(mesh.morphTargetDictionary)) {
      if (!this.units.has(name)) this.units.set(name, []); this.units.get(name).push([mesh, i]);
    }
    this.toModel = person.scale / model.k;   // Person inner units → model units
    this.decorate(person.spec);
    this.makeup(person.spec);
    const S = model.section, sc = person.scale, hipY = model.d.hipY;
    if (S.hw.some((x) => x > 0)) person.section = (y) => {
      const f = Math.max(0, Math.min(S.hw.length - 1.001, (y * sc + hipY - S.y0) / S.step)), i = Math.floor(f), t = f - i;
      const at = (a) => (a[i] + (a[i + 1] - a[i]) * t) / sc;
      return [at(S.hw), at(S.fz), at(S.bz)];
    };
    // fingers: each curls about the line across the knuckles (index → pinky), joint by joint
    this.fingers = {};
    for (const side of ['l', 'r']) {
      const R = this.rest, across = new THREE.Vector3().subVectors(R[`pinky_01_${side}`].pos, R[`index_01_${side}`].pos).normalize();
      if (side === 'r') across.negate();
      this.fingers[side] = ['thumb', 'index', 'middle', 'ring', 'pinky'].map((f) => ({ f, bones: [1, 2, 3].map((j) => `${f}_0${j}_${side}`), axis: across }));
    }
  }

  // Lip colour from the cast list (Xue's red, Ling Ling's rose); wet, glossy eyes that catch the key light.
  makeup(spec) {
    const lip = spec.lips || (spec.female ? '#c27470' : null);
    this.m.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (/^Human\.(body|ears|lips)$/i.test(m.name)) {   // pores: a faint tiling bump breaks up the plastic sheen of a bare diffuse skin
        m.normalMap = skinBump(); m.normalScale.set(0.22, 0.22); m.roughness = 0.6;
      }
      if (/lips/i.test(m.name) && lip) { m.color.set('#ffffff').lerp(new THREE.Color(lip), spec.lips ? 0.5 : 0.28); m.roughness = 0.38; if (m.isMeshPhysicalMaterial) { m.clearcoat = 0.4; m.clearcoatRoughness = 0.35; } }
      if (/^(Eyes\.|Human\.(low|high)-poly)/i.test(m.name)) { m.roughness = 0.22; m.metalness = 0; if (m.isMeshPhysicalMaterial) { m.specularIntensity = 0.8; m.clearcoat = 0.6; m.clearcoatRoughness = 0.18; } }
    });
  }

  // Small things the MakeHuman assets don't have, fixed to bones at measured bind-pose spots (metres, root space).
  decorate(spec) {
    const k = this.m.k, scene = this.m.scene, at = (n) => this.b[n].getWorldPosition(new THREE.Vector3());
    const pin = (bone, mesh, world) => {   // child of `bone`, placed at a root-space point, sized in metres
      const b = this.b[bone]; mesh.position.copy(b.worldToLocal(world.clone())); mesh.scale.setScalar(1 / k); mesh.castShadow = true; b.add(mesh); return mesh;
    };
    const gold = new THREE.MeshStandardMaterial({ color: '#d9bd6a', metalness: 0.85, roughness: 0.3 });
    const box = (re) => { const bb = new THREE.Box3(); scene.traverse((o) => { if (o.isMesh && re.test(o.material.name || o.name)) bb.expandByObject(o); }); return bb; };
    const front = (y) => { const S = this.m.section, i = Math.max(0, Math.min(S.fz.length - 1, Math.round((y - S.y0) / S.step))); return S.fz[i]; };
    if (spec.earrings) {   // pearls at the lowest point of each ear
      const lobes = { l: null, r: null }, v = new THREE.Vector3();
      scene.traverse((o) => {
        if (!o.isMesh || !/ears/i.test(o.material.name)) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); const s = v.x > 0 ? 'l' : 'r'; if (!lobes[s] || v.y < lobes[s].y) lobes[s] = v.clone(); }
      });
      const pearl = new THREE.MeshPhysicalMaterial({ color: '#f6f1e6', roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.22, sheen: 0.7, sheenColor: new THREE.Color('#ffe9f2') });
      for (const s of ['l', 'r']) if (lobes[s]) pin('head', new THREE.Mesh(new THREE.SphereGeometry(0.0065, 20, 14), pearl), lobes[s].add(new THREE.Vector3(0, -0.006, 0)));
    }
    if (spec.brooch) { const c = at('spine_03'), y = c.y + 0.07; pin('spine_03', new THREE.Mesh(new THREE.SphereGeometry(0.011, 18, 12).scale(1, 1, 0.45), gold), new THREE.Vector3(0.075, y, front(y) + 0.004)); }
    if (spec.necklace) {
      const n = at('neck_01'), ring = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.0016, 6, 40), gold);
      ring.rotation.x = Math.PI / 2 - 0.5; pin('neck_01', ring, n.clone().add(new THREE.Vector3(0, -0.02, 0.02))).rotation.copy(ring.rotation);
    }
    if (spec.cap) {   // peaked uniform cap over the hair
      const hb = box(/hair|short|afro|bob|pony/i), top = hb.max.y, cx = (hb.min.x + hb.max.x) / 2, cz = (hb.min.z + hb.max.z) / 2, r = (hb.max.x - hb.min.x) / 2 + 0.008;
      const g = new THREE.Group(), cm = new THREE.MeshStandardMaterial({ color: spec.jacket || '#1c2440', roughness: 0.7 });
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 0.98, 0.06, 28), cm); crown.position.y = 0.02;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.99, r * 0.99, 0.03, 28), new THREE.MeshStandardMaterial({ color: '#11141f', roughness: 0.6 })); band.position.y = -0.02;
      const visor = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.007, 24, 1, false, -1.1, 2.2), new THREE.MeshStandardMaterial({ color: '#0c0d12', roughness: 0.25 }));
      visor.position.set(0, -0.032, r * 0.45); visor.rotation.x = 0.18;
      const crest = new THREE.Mesh(new THREE.SphereGeometry(0.012, 14, 10).scale(1, 1, 0.4), gold); crest.position.set(0, 0.012, r * 1.05);
      for (const m of [crown, band, visor, crest]) { m.castShadow = true; g.add(m); }
      pin('head', g, new THREE.Vector3(cx, top - 0.035, cz));
    }
    if (spec.glasses) {   // thin dark frames in front of the eyes (measured from the eyeball meshes)
      const eb = box(/low-poly|high-poly|eye(?!brow|lash)/i), cy = (eb.min.y + eb.max.y) / 2, z = eb.max.z + 0.012, half = (eb.max.x - eb.min.x) / 4 + 0.004;
      const frame = new THREE.MeshStandardMaterial({ color: '#2a2a2e', metalness: 0.6, roughness: 0.3 }), g = new THREE.Group();
      for (const sx of [1, -1]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0018, 6, 24), frame); ring.position.x = sx * (half + 0.004); g.add(ring); }
      const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0014, 2 * half - 0.03, 6), frame); bridge.rotation.z = Math.PI / 2; g.add(bridge);
      pin('head', g, new THREE.Vector3((eb.min.x + eb.max.x) / 2, cy, z));
    }
    if (spec.badge) { const c = at('spine_03'), y = c.y + 0.08; pin('spine_03', new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.034, 0.005), new THREE.MeshStandardMaterial({ color: '#c9ccd4', metalness: 0.7, roughness: 0.3 })), new THREE.Vector3(-0.085, y, front(y) + 0.004)); }
  }

  // rotate bone `n` so that its model-space rotation is delta · rest
  setDelta(n, delta) {
    const b = this.b[n]; if (!b) return;
    const want = q1.multiplyQuaternions(delta, this.rest[n].q);
    const parent = b.parent && this.mq[b.parent.name] ? this.mq[b.parent.name] : this.parentRest(b);
    b.quaternion.copy(q2.copy(parent).invert().multiply(want));
    this.mq[n] = want.clone(); this.md[n] = delta.clone();
  }
  parentRest(b) { return b.parent && this.rest[b.parent.name] ? this.rest[b.parent.name].q : qI; }

  // model-space position of a bone's head under the current pose
  headOf(n, out) {
    this.b[n].updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(m2.multiplyMatrices(m1.copy(this.m.scene.matrixWorld).invert(), this.b[n].matrixWorld));
  }

  // two-bone IK toward `target`, bending toward `hint`; aims both bones so the rest hinge maps onto the new one
  limb(L, target, hint) {
    const S = this.headOf(L.a, v1).clone();
    const dir = v2.subVectors(target, S); let dist = dir.length();
    dist = Math.min(Math.max(dist, Math.abs(L.l1 - L.l2) + 0.01), (L.l1 + L.l2) * 0.999); dir.normalize();
    const a = (L.l1 * L.l1 + dist * dist - L.l2 * L.l2) / (2 * dist), h = Math.sqrt(Math.max(0, L.l1 * L.l1 - a * a));
    const perp = v3.subVectors(hint, S); perp.addScaledVector(dir, -perp.dot(dir));
    if (perp.lengthSq() < 1e-8) perp.copy(L.n).cross(dir); perp.normalize();
    const E = v4.copy(S).addScaledVector(dir, a).addScaledVector(perp, h), W = v5.copy(S).addScaledVector(dir, dist);
    const d1 = E.clone().sub(S).normalize(), d2 = W.clone().sub(E).normalize();
    const n = new THREE.Vector3().crossVectors(d1, d2);
    if (n.lengthSq() < 1e-5) n.copy(L.prev || L.n); else n.normalize();   // a straight limb has no hinge of its own: keep last frame's
    L.prev = n.clone();
    const R = this.rest, r1 = v3.subVectors(R[L.b].pos, R[L.a].pos).normalize().clone(), r2 = v3.subVectors(R[L.c].pos, R[L.b].pos).normalize().clone();
    this.setDelta(L.a, frameDelta(r1, L.n, d1, n));
    this.setDelta(L.b, frameDelta(r2, L.n, d2, n));
  }

  update(dt) {
    const p = this.p, k = this.toModel;
    // pelvis: hips where the Person's are, turned as its pelvis is
    const pel = p.pelvis, parent = this.b.pelvis.parent;
    v1.copy(pel.position).multiplyScalar(k).add(v2.copy(this.pelvisOff).applyEuler(pel.rotation));   // model space
    parent.updateWorldMatrix(true, false);
    m2.multiplyMatrices(m1.copy(this.m.scene.matrixWorld).invert(), parent.matrixWorld).invert();
    this.b.pelvis.position.copy(v1.applyMatrix4(m2));
    const P = new THREE.Quaternion().setFromEuler(pel.rotation), T = new THREE.Quaternion().setFromEuler(p.torso.rotation);
    // reaching past arm's length: lean the chest toward the target (smoothed), the clavicle does the rest in reach()
    // (measured from where the shoulder would be without the lean, so leaning doesn't feed back into itself)
    const pelvisAt = v5.copy(pel.position).multiplyScalar(k);
    let over = 0; const dir = v3.set(0, 0, 0);
    for (const L of this.limbs) {
      if (!L.arm) continue;
      const sho = v1.copy(this.shoRel[L.side]).applyQuaternion(T).add(pelvisAt);
      const t = v4.copy(p.target[L.side]).multiplyScalar(k), o = t.distanceTo(sho) - (L.l1 + L.l2) * 0.97 - 0.03;
      if (o > over) { over = o; dir.subVectors(t, sho); }
    }
    dir.y = 0; const want = dir.lengthSq() > 1e-6 ? Math.min(0.38, over / 0.5) : 0;
    this.lean += (want - this.lean) * (!dt || dt > 0.2 ? 1 : 1 - Math.exp(-dt * 6));
    if (this.lean > 1e-3 && dir.lengthSq() > 1e-6) { this.leanAxis.set(0, 1, 0).cross(dir.normalize()); }
    if (this.lean > 1e-3) T.premultiply(q1.setFromAxisAngle(this.leanAxis, this.lean));
    this.mq = {}; this.md = {};
    if (this.b.Root) this.mq.Root = this.rest.Root.q.clone();
    this.setDelta('pelvis', P);
    this.setDelta('spine_01', q1.copy(P).slerp(T, 0.35).clone());
    this.setDelta('spine_02', q1.copy(P).slerp(T, 0.7).clone());
    this.setDelta('spine_03', T);
    const shrug = Math.min(1.2, p.tight || 0) * 0.14;
    this.setDelta('clavicle_l', q1.multiplyQuaternions(T, q2.setFromAxisAngle(v1.set(0, 0, 1), shrug)).clone());
    this.setDelta('clavicle_r', q1.multiplyQuaternions(T, q2.setFromAxisAngle(v1.set(0, 0, 1), -shrug)).clone());
    const H = new THREE.Quaternion().setFromEuler(p.head.rotation);
    this.setDelta('neck_01', q1.multiplyQuaternions(T, q2.copy(qI).slerp(H, 0.35)).clone());
    this.setDelta('head', q1.multiplyQuaternions(T, H).clone());
    // limbs toward the Person's wrists / ankles (inner space → model space is a uniform scale)
    for (const L of this.limbs) {
      const tgt = (L.arm ? p.target[L.side] : p.ankle[L.side]).clone().multiplyScalar(k);
      const hint = (L.arm ? p.elbow[L.side] : p.knee[L.side]).clone().multiplyScalar(k);
      if (L.arm) hint.addScaledVector(v1.subVectors(hint, tgt), 0.5);   // exaggerate so the solve keeps the Person's elbow side
      if (L.arm) this.reach(L, tgt);
      this.limb(L, tgt, hint);
      const end = L.c;
      if (L.arm) { this.setDelta(end, this.md[L.b]); this.hand(L.side); }   // hand carries on from the forearm
      else this.setDelta(end, q1.setFromAxisAngle(v1.set(0, 1, 0), (L.side === 'l' ? 1 : -1) * (p.style.stance || 0) * 0.25).clone());   // feet flat
    }
    this.face(p.face || {});
  }

  // a target past arm's length brings the shoulder forward: the clavicle swings toward it (up to ~20°)
  reach(L, tgt) {
    const clav = `clavicle_${L.side}`, S = this.headOf(L.a, v1).clone(), d = S.distanceTo(tgt), max = (L.l1 + L.l2) * 0.97;
    if (d <= max) return;
    const C = this.headOf(clav, v2).clone(), toS = S.clone().sub(C), toT = tgt.clone().sub(C);
    const axis = toS.clone().cross(toT); if (axis.lengthSq() < 1e-8) return;
    const ang = Math.min(0.35, (d - max) / toS.length());
    this.setDelta(clav, q1.setFromAxisAngle(axis.normalize(), ang).multiply(this.md[clav] || qI).clone());
  }

  // finger curl: relaxed, pointing (right hand), gripping; blended by the Person's channels
  hand(side) {
    const s = this.p.s, point = side === 'r' ? Math.max(0, Math.min(1, (s.point - 0.3) / 0.4)) : 0, grip = Math.max(0, Math.min(1, s[side + 'g'] || 0));
    const pose = (f) => {
      const relaxed = f === 'thumb' ? [0.1, 0.15, 0.1] : f === 'index' ? [0.2, 0.25, 0.15] : f === 'pinky' ? [0.35, 0.4, 0.3] : [0.28, 0.32, 0.22];
      const pointing = f === 'thumb' ? [0.35, 0.5, 0.35] : f === 'index' ? [0.02, 0.03, 0.02] : [1.25, 1.4, 1.0];
      const gripping = f === 'thumb' ? [0.45, 0.55, 0.4] : [0.95, 1.05, 0.75];
      return relaxed.map((r, j) => r + (pointing[j] - r) * point + (gripping[j] - r) * grip * (1 - point));
    };
    const hd = this.md[`hand_${side}`] || qI;
    for (const F of this.fingers[side]) {
      const a = pose(F.f), scale = F.f === 'thumb' ? 0.6 : 1; let acc = 0;
      F.bones.forEach((n, j) => { acc += a[j] * scale * CURL; this.setDelta(n, q1.multiplyQuaternions(hd, q2.setFromAxisAngle(F.axis, acc)).clone()); });
    }
  }

  face(f) {
    const pos = (x) => Math.max(0, Math.min(1, x || 0)), brow = f.brow || 0, open = pos(f.open), loud = pos(f.loud), lid = pos(f.lid), recoil = pos(f.recoil);
    for (const list of this.units.values()) for (const [mesh, i] of list) mesh.morphTargetInfluences[i] = 0;
    const set = (name, v) => { const list = this.units.get(name); if (list) for (const [mesh, i] of list) mesh.morphTargetInfluences[i] = v; };
    const both = (base, v) => { set(base + 'Left', v); set(base + 'Right', v); };
    both('browDown', pos(brow) * 0.9 + loud * 0.15);
    set('browInnerUp', pos(-brow) * 0.85 + pos(f.tear) * 0.4);
    both('browOuterUp', pos(-brow) * 0.25 + recoil * 0.3);
    both('eyeBlink', lid);
    both('eyeSquint', pos(brow) * 0.35 + loud * 0.2);
    both('eyeWide', recoil * 0.6);
    set('jawOpen', open * (0.5 + loud * 0.15));
    set('mouthFunnel', open * 0.18 * (1 - loud));
    both('mouthStretch', open * loud * 0.4);
    both('mouthUpperUp', loud * 0.4 + pos(brow) * 0.12);
    both('mouthLowerDown', open * (0.25 + loud * 0.2));
    both('noseSneer', pos(brow) * 0.3 + loud * 0.25);
    both('mouthFrown', pos(brow) * 0.25 * (1 - open));
    both('mouthPress', pos(brow) * 0.3 * (1 - open));
    both('cheekSquint', loud * 0.3);
    // eyes take up what the head doesn't turn: +yaw is toward the character's left (+x), +pitch is down
    const g = this.p.gaze || { yaw: 0, pitch: 0 }, yaw = Math.max(-1, Math.min(1, g.yaw / 0.55)), pitch = Math.max(-1, Math.min(1, g.pitch / 0.45));
    set('eyeLookOutLeft', pos(yaw)); set('eyeLookInRight', pos(yaw)); set('eyeLookInLeft', pos(-yaw)); set('eyeLookOutRight', pos(-yaw));
    both('eyeLookDown', pos(pitch) * (1 - lid)); both('eyeLookUp', pos(-pitch) * 0.8);
  }
}

// A tiling skin-pore normal map (value noise, two octaves, Sobel to normals), shared by every skin material.
let bump = null;
function skinBump() {
  if (bump) return bump;
  const n = 256, h = new Float32Array(n * n), rnd = (x, y, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
  const noise = (x, y, f, s) => {   // periodic value noise with period n/f
    const p = n / f, xi = Math.floor(x / p), yi = Math.floor(y / p), tx = x / p - xi, ty = y / p - yi, w = (a) => a * a * (3 - 2 * a);
    const g = (i, j) => rnd(((i % f) + f) % f, ((j % f) + f) % f, s);
    return g(xi, yi) * (1 - w(tx)) * (1 - w(ty)) + g(xi + 1, yi) * w(tx) * (1 - w(ty)) + g(xi, yi + 1) * (1 - w(tx)) * w(ty) + g(xi + 1, yi + 1) * w(tx) * w(ty);
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = noise(x, y, 64, 1) * 0.65 + noise(x, y, 128, 2) * 0.35;
  const c = document.createElement('canvas'); c.width = c.height = n; const ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
  const H = (x, y) => h[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 2, dy = (H(x, y + 1) - H(x, y - 1)) * 2, l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  bump = new THREE.CanvasTexture(c); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.repeat.set(18, 18); bump.colorSpace = THREE.NoColorSpace;
  return bump;
}

// rotation taking the frame (dir r, hinge n) onto (dir d, hinge m)
function frameDelta(r, n, d, m) {
  const a = basis(r, n), b = basis(d, m);
  return new THREE.Quaternion().setFromRotationMatrix(m1.multiplyMatrices(b, a.transpose()));
}
function basis(dir, hinge) {
  const x = dir.clone().normalize(), z = hinge.clone().addScaledVector(x, -hinge.dot(x)).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z);
}
