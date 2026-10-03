import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { animate } from 'animejs';
import { buildSet, PLAN } from './set.js';
import { buildCast } from './people.js';
import { buildBlocking } from './blocking.js';
import { buildShots, shotAt } from './shots.js';
import { Sound } from './audio.js';

const $ = (s) => document.querySelector(s);
const DUR = 240, q = new URLSearchParams(location.search);
const SPK = { M: '#2f9c77', R: '#c9ccd4', H: '#d0a43a', B: '#3f66ff', E: '#f0ede6', G: '#5f73c9' };
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

async function main() {
  const [script, voices] = await Promise.all([fetch('data/script.json').then((r) => r.json()), fetch('data/voices.json').then((r) => r.json())]);

  // ───────────────────────── renderer / scene
  const stage = $('#stage'), canvas = $('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#dfe6ea');
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.32;
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.15, 80);
  const set = buildSet(scene);
  const { cast, list } = await buildCast(scene);
  if (q.get('debug')) Object.assign(window, { cast, list, THREE, camera, scene, renderer });   // poke at the cast from the console
  const blocking = buildBlocking(cast, list, set.seats);
  const shots = buildShots(cast);
  const sound = new Sound(script, voices);

  // ───────────────────────── post
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  // screen-space ambient occlusion: contact shadows under feet, in folds, along wall bases
  const gtao = new GTAOPass(scene, camera, 2, 2);
  gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.9;
  gtao.updateGtaoMaterial({ radius: 0.3, distanceExponent: 1.2, thickness: 1.0, scale: 1.25, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
  const gtaoRender = gtao.render.bind(gtao);
  gtao.render = (...a) => { set.glass.visible = false; gtaoRender(...a); set.glass.visible = true; };
  composer.addPass(gtao);
  const bokeh = new BokehPass(scene, camera, { focus: 2, aperture: 0.004, maxblur: 0.014 });
  const bokehRender = bokeh.render.bind(bokeh);
  bokeh.render = (...a) => { set.glass.visible = false; bokehRender(...a); set.glass.visible = true; };   // glass must not write focus depth
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(640, 360), 0.2, 0.65, 1.6); composer.addPass(bloom);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time, amount; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5;
        float v = smoothstep(0.9, 0.32, length(d * vec2(1.0, 0.82)));
        vec3 x = c.rgb * mix(1.0, 0.58 + 0.42 * v, amount);
        float l = dot(x, vec3(0.299, 0.587, 0.114));
        vec3 toned = mix(x * vec3(0.93, 0.99, 1.09), x * vec3(1.05, 1.0, 0.93), smoothstep(0.08, 0.9, l));   // cool shadows, warm highlights
        toned = pow(max(toned, 0.0), vec3(1.06)) * 1.04 + vec3(0.004, 0.004, 0.006);                            // gentle contrast, lifted toe
        c.rgb = mix(x, toned, amount);
        c.rgb += (h(vUv * 900.0) - 0.5) * 0.02 * amount;
        gl_FragColor = c; }`,
  });
  composer.addPass(grade); composer.addPass(new OutputPass());

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight, pr = Math.min(window.devicePixelRatio || 1, q.get('pr') ? +q.get('pr') : 1.5);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false); composer.setPixelRatio(pr); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage); resize();

  // ───────────────────────── state
  const st = { t: Math.max(0, Math.min(DUR, +(q.get('t') || 0))), playing: false, mode: 'cut', speed: 1, map: false, lang: 'zh', lastShot: -1, lastLine: -2 };
  const orbit = new OrbitControls(camera, canvas); orbit.enabled = false; orbit.enableDamping = true; orbit.maxPolarAngle = 1.5;
  const out = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 30, focus: 2, blur: 1, push: 0, shake: 1 };
  const stepCount = new Map();
  const crowdIds = ['B', 'H', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'];

  function pose(t, dt) {
    blocking.apply(t);
    for (const p of list) p.update(t, dt);
    for (const p of list) if (p.grab.l || p.grab.r) p.update(t, 0);   // settle hand-to-hand contacts
    for (const p of list) if (p.grab.l || p.grab.r) p.update(t, 0);
  }

  function frameCamera(t) {
    const sh = shotAt(shots, t), p = (t - sh.t0) / (sh.t1 - sh.t0);
    if (st.mode === 'cut') {
      sh.fn(t, p, out);
      out.pos.lerp(out.look, out.push * p);
      const a = out.shake * 0.0035 * Math.max(1, out.focus);
      out.look.x += (Math.sin(t * 1.7) + Math.sin(t * 2.9 + 1)) * a; out.look.y += (Math.sin(t * 2.3 + 2) + Math.sin(t * 3.7)) * a * 0.8;
      out.pos.y += Math.sin(t * 1.3 + 0.5) * a * 0.6;
      camera.position.copy(out.pos); camera.fov = out.fov; camera.updateProjectionMatrix(); camera.lookAt(out.look);
      bokeh.enabled = true; bokeh.uniforms.focus.value = out.focus; bokeh.uniforms.aperture.value = 0.0064 * out.blur * (30 / out.fov);
      grade.uniforms.amount.value = 1;
    } else {
      bokeh.enabled = false; grade.uniforms.amount.value = 0.35; gtao.enabled = true;
      if (st.mode === 'free') { const m = cast.M.s; orbit.target.lerp(new THREE.Vector3(m.x, 1.1, m.z), 0.06); orbit.update(); }
    }
    return sh;
  }

  function setMode(m) {
    st.mode = m; orbit.enabled = m === 'free';
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (m === 'free') { const s = cast.M.s; camera.fov = 42; camera.position.set(s.x + 6, 5.5, s.z + 7); orbit.target.set(s.x, 1.1, s.z); camera.updateProjectionMatrix(); }
    if (m === 'plan') { camera.fov = 38; camera.position.set(1.6, 39, 2.6); camera.up.set(0, 0, -1); camera.lookAt(1.6, 0, 2.6); camera.updateProjectionMatrix(); } else camera.up.set(0, 1, 0);
    dirty = true;
    set.root.traverse((o) => { if (o.userData.ceiling) o.visible = m === 'cut'; });
  }

  // ───────────────────────── timeline UI
  const tlc = $('#timeline'), tg = tlc.getContext('2d'), lanes = ['M', 'R', 'H', 'B', 'E', 'G'];
  let tlBack = null;
  function drawTimelineBack() {
    const w = tlc.width = tlc.clientWidth * 2, h = tlc.height = tlc.clientHeight * 2;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    const X = (t) => (t / DUR) * w, top = 26, lane = (h - top - 8) / lanes.length;
    g.fillStyle = '#14161a'; g.fillRect(0, 0, w, h);
    const zc = (t) => (t < 45.6 ? '#2b3a31' : t < 57 ? '#2f3540' : t < 104.5 ? '#3a3340' : t < 110.9 ? '#40382c' : '#2c3640');
    shots.forEach((s, i) => { g.fillStyle = zc(s.t0); g.globalAlpha = i % 2 ? 0.95 : 0.6; g.fillRect(X(s.t0), 0, X(s.t1) - X(s.t0) - 1, top - 6); });
    g.globalAlpha = 1; g.font = '18px ui-monospace, monospace'; g.fillStyle = '#7d848f';
    for (let t = 0; t <= DUR; t += 30) { g.fillRect(X(t), top - 6, 1, h); g.fillText(`${t / 60 | 0}:${String(t % 60).padStart(2, '0')}`, X(t) + 6, h - 6); }
    lanes.forEach((_, i) => { g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(0, top + i * lane, w, lane - 3); });
    const voiced = new Set(voices.lines.map((v) => v.id));
    for (const L of script.lines) {
      const i = lanes.indexOf(L.spk); g.fillStyle = SPK[L.spk]; g.globalAlpha = voiced.has(L.id) ? 1 : 0.5;
      g.fillRect(X(L.t0), top + i * lane + 2, Math.max(3, X(L.t1) - X(L.t0)), lane - 7);
    }
    g.globalAlpha = 1; tlBack = c;
  }
  function drawTimeline(t) {
    if (!tlBack || tlBack.width !== tlc.clientWidth * 2) drawTimelineBack();
    tg.drawImage(tlBack, 0, 0); const x = (t / DUR) * tlc.width;
    tg.fillStyle = '#ffd24a'; tg.fillRect(x - 1.5, 0, 3, tlc.height); tg.beginPath(); tg.moveTo(x - 9, 0); tg.lineTo(x + 9, 0); tg.lineTo(x, 12); tg.fill();
  }
  const seekFromEvent = (e) => { const r = tlc.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * DUR); };
  let dragging = false;
  tlc.addEventListener('pointerdown', (e) => { dragging = true; tlc.setPointerCapture(e.pointerId); seekFromEvent(e); });
  tlc.addEventListener('pointermove', (e) => dragging && seekFromEvent(e));
  tlc.addEventListener('pointerup', () => (dragging = false));

  // ───────────────────────── minimap
  const mm = $('#map'), mg = mm.getContext('2d');
  function drawMap(sh) {
    const W = mm.width, H = mm.height, s = W / 23, ox = 9.2, oz = 10.2, X = (x) => (x + ox) * s, Z = (z) => (z + oz) * s;
    mg.clearRect(0, 0, W, H); mg.fillStyle = 'rgba(14,16,19,.86)'; mg.fillRect(0, 0, W, H);
    const O = PLAN.office, L = PLAN.lobby;
    mg.fillStyle = '#23272d'; mg.fillRect(X(O.x0), Z(O.z0), (O.x1 - O.x0) * s, (O.z1 - O.z0) * s); mg.fillStyle = '#2b2824'; mg.fillRect(X(L.x0), Z(L.z0), (L.x1 - L.x0) * s, (L.z1 - L.z0) * s);
    mg.strokeStyle = '#59616b'; mg.lineWidth = 2; mg.strokeRect(X(O.x0), Z(O.z0), (O.x1 - O.x0) * s, (O.z1 - O.z0) * s); mg.strokeRect(X(L.x0), Z(L.z0), (L.x1 - L.x0) * s, (L.z1 - L.z0) * s);
    mg.fillStyle = '#3f6b2a'; mg.fillRect(X(-3.6), Z(-1.6), 0.25 * s, 3.2 * s);
    mg.fillStyle = '#e9e7e1'; mg.fillRect(X(-3.4), Z(-1.7), 6.8 * s, 0.14 * s);
    mg.fillStyle = '#3a2c25'; mg.fillRect(X(-1.7), Z(-0.5), 3.4 * s, 0.6 * s); mg.fillRect(X(-5.05), Z(3.2), 1.3 * s, 4 * s);
    mg.fillStyle = '#23272d'; mg.fillRect(X(PLAN.door.x0), Z(-1.75), (PLAN.door.x1 - PLAN.door.x0) * s, 0.3 * s);
    mg.strokeStyle = '#8fd0d8'; mg.lineWidth = 1.5; mg.beginPath();
    for (const [a, b, c, d] of [[-1.9, 4.2, -1.9, 9], [2.7, 4.6, 2.7, 9.6], [2.7, 4.6, 7.4, 4.6], [7.4, 4.6, 7.4, 9.6], [2.7, 9.9, 7.4, 9.9]]) { mg.moveTo(X(a), Z(b)); mg.lineTo(X(c), Z(d)); }
    mg.stroke();
    for (const p of list) {
      const id = p.id, main = id in SPK || id === 'G1' || id === 'G2';
      mg.fillStyle = id === 'G1' || id === 'G2' ? SPK.G : SPK[id] || '#6d737c'; mg.beginPath(); mg.arc(X(p.s.x), Z(p.s.z), main ? 5.5 : 3.2, 0, 7); mg.fill();
      if (main) { mg.strokeStyle = mg.fillStyle; mg.beginPath(); mg.moveTo(X(p.s.x), Z(p.s.z)); mg.lineTo(X(p.s.x + Math.sin(p.s.ry) * 0.6), Z(p.s.z + Math.cos(p.s.ry) * 0.6)); mg.stroke(); }
    }
    if (st.mode === 'cut') { // camera wedge
      const f = new THREE.Vector3(); camera.getWorldDirection(f); const a = Math.atan2(f.x, f.z), hw = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect), r = 3.2;
      const cx = X(camera.position.x), cz = Z(camera.position.z);
      mg.fillStyle = 'rgba(255,210,74,.22)'; mg.strokeStyle = '#ffd24a'; mg.lineWidth = 1.5; mg.beginPath(); mg.moveTo(cx, cz);
      mg.lineTo(cx + Math.sin(a - hw) * r * s, cz + Math.cos(a - hw) * r * s); mg.lineTo(cx + Math.sin(a + hw) * r * s, cz + Math.cos(a + hw) * r * s); mg.closePath(); mg.fill(); mg.stroke();
      mg.fillStyle = '#ffd24a'; mg.beginPath(); mg.arc(cx, cz, 4, 0, 7); mg.fill();
    }
    mg.fillStyle = '#aab1bb'; mg.font = '13px ui-monospace, monospace'; mg.fillText('LIFT LOBBY', X(1.3), Z(-8.7)); mg.fillText('RECEPTION', X(-3.1), Z(1.6)); mg.fillText('CORRIDOR', X(-1.4), Z(8.6)); mg.fillText('N ↑', W - 40, 18);
    void sh;
  }

  // ───────────────────────── captions / slate
  const cap = $('#cap'), slate = $('#slate');
  const voicedIds = new Set(voices.lines.map((v) => v.id));
  function hud(t, sh) {
    if (sh.n !== st.lastShot) { st.lastShot = sh.n; slate.querySelector('b').textContent = `S${String(sh.n).padStart(2, '0')}`; slate.querySelector('span').textContent = sh.label; }
    slate.querySelector('i').textContent = fmt(t);
    let cur = null; for (const L of script.lines) if (t >= L.t0 - 0.05 && t <= L.t1 + 0.5) cur = L;
    const id = cur ? cur.id : -1;
    if (id !== st.lastLine) {
      st.lastLine = id;
      if (!cur) cap.classList.remove('show');
      else {
        const sp = script.speakers[cur.spk];
        cap.innerHTML = `<div class="who" style="--c:${SPK[cur.spk]}">${st.lang === 'zh' ? sp.role : sp.role_en}${voicedIds.has(cur.id) ? '<em>voiced</em>' : ''}</div>` +
          (cur.quote ? `<div class="quote">${st.lang === 'zh' ? cur.quote : (cur.quote_en || cur.quote)}</div>` : '');   // the subtitle is exactly the voiced line (or its English); no commentary
        cap.classList.add('show'); animate(cap, { opacity: [0, 1], translateY: [8, 0], duration: 220, ease: 'outQuad' });
      }
    }
    $('#time').textContent = `${fmt(t)} / 4:00.0`;
  }

  // ───────────────────────── transport
  function seek(t) { st.t = Math.max(0, Math.min(DUR - 0.01, t)); sound.seek(st.t); if (!st.playing) tick(0, true); }
  async function play(on) {
    st.playing = on; $('#play').textContent = on ? '❚❚' : '▶'; $('#start').classList.add('gone'); dirty = true;
    if (on) { if (!sound.ctx) await sound.init().catch((e) => console.warn('audio unavailable', e)); sound.ctx?.resume(); if (st.t >= DUR - 0.05) st.t = 0; sound.seek(st.t); }
  }
  const toggle = (k, el) => { sound.enabled[k] = !sound.enabled[k]; el.classList.toggle('on', sound.enabled[k]); if (!sound.enabled[k]) sound.stopAll(); };
  $('#play').onclick = () => play(!st.playing); $('#start').onclick = () => play(true);
  document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $('#bVoice').onclick = (e) => toggle('voice', e.currentTarget); $('#bBabble').onclick = (e) => toggle('babble', e.currentTarget); $('#bRoom').onclick = (e) => toggle('room', e.currentTarget);
  $('#bMap').onclick = (e) => { st.map = !st.map; mm.classList.toggle('show', st.map); e.currentTarget.classList.toggle('on', st.map); dirty = true; };
  $('#bLang').onclick = (e) => { st.lang = st.lang === 'zh' ? 'en' : 'zh'; e.currentTarget.textContent = st.lang === 'zh' ? '中' : 'EN'; st.lastLine = -2; };
  $('#speed').onchange = (e) => (st.speed = +e.target.value);
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase(), sh = shotAt(shots, st.t);
    if (k === ' ') { e.preventDefault(); play(!st.playing); }
    else if (k === 'arrowright') seek(st.t + 5); else if (k === 'arrowleft') seek(st.t - 5);
    else if (k === '.') seek(sh.t1 + 0.01); else if (k === ',') seek((st.t - sh.t0 > 0.6 ? sh : shots[Math.max(0, sh.n - 2)]).t0 + 0.01);
    else if (k === 'c') setMode('cut'); else if (k === 'f') setMode('free'); else if (k === 'p') setMode('plan'); else if (k === 'm') $('#bMap').click();
  });

  // ───────────────────────── frame
  const pv = new THREE.Vector3(), info = { zone: 'office', crowd: 0, pan: {} };
  let last = performance.now(), frames = 0, fpsT = 0;
  function tick(dt, force) {
    if (st.playing) { st.t += dt * st.speed; if (st.t >= DUR) { st.t = DUR - 0.01; play(false); } }
    const t = st.t;
    pose(t, force ? 1 : dt);
    const sh = frameCamera(t);
    const zone = st.mode !== 'cut' ? 'office' : (camera.position.z + out.look.z) / 2 < -1.9 ? 'lobby' : 'office';
    set.setZone(zone); info.zone = zone;
    // footsteps + stereo placement + crowd agitation for the sound layer
    if (st.playing) for (const id of ['M', 'E', 'B', 'G1', 'G2', 'H']) { const p = cast[id], n = Math.floor(p.s.dist / 0.62); if (stepCount.get(id) !== n) { if (stepCount.has(id) && p.s.gait > 0.4) sound.step(id === 'E' || id === 'B', 0.5); stepCount.set(id, n); } }
    for (const k of ['M', 'R', 'H', 'B', 'E']) { cast[k].headPos(pv).project(camera); info.pan[k] = pv.z < 1 ? pv.x * 0.7 : 0; }
    cast.G1.headPos(pv).project(camera); info.pan.G = pv.z < 1 ? pv.x * 0.7 : 0;
    info.crowd = Math.min(1, crowdIds.reduce((a, id) => a + cast[id].s.gait, 0) / 5 + Math.max(cast.R.s.shake, cast.H.s.shake, cast.E.s.shake, cast.M.s.shake) * 0.6);
    sound.update(t, st.playing, info);
    grade.uniforms.time.value = t;
    composer.render();
    hud(t, sh); drawTimeline(t); if (st.map) drawMap(sh);
  }
  // Paused, the picture only changes when something is touched (seek, mode, camera, resize, map),
  // so a frame is rendered on demand instead of ~100 times a second.
  let dirty = true;
  const invalidate = () => { dirty = true; };
  const minFrame = 1000 / (+q.get('fps') || 60) - 2;   // playback cap: a 120 Hz display would otherwise draw twice as much for nothing
  function loop(now) {
    if (st.playing && !dirty && now - last < minFrame) { requestAnimationFrame(loop); return; }
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (st.playing || dirty) { dirty = false; tick(st.playing ? dt : 0, !st.playing); frames++; }
    if (now - fpsT > 1000) { $('#fps').textContent = st.playing ? `${frames} fps` : 'paused'; frames = 0; fpsT = now; }
    requestAnimationFrame(loop);
  }
  orbit.addEventListener('change', invalidate);
  new ResizeObserver(invalidate).observe(stage);

  // ───────────────────────── debug hooks (used for shot-by-shot checks against the source)
  window.__scene = {
    st, cast, shots, blocking, seek, setMode, play, sound, renderer, scene, camera,
    info: () => ({ shots: shots.length, people: list.length, keys: blocking.nKeys, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    // render a contact sheet of the cut at the given times into #sheet
    sheet(times, cols = 4, tw = 640) {
      const th = (tw * 9) / 16, rows = Math.ceil(times.length / cols), c = $('#sheet'); c.width = cols * tw; c.height = rows * th; c.classList.add('show');
      const g = c.getContext('2d'); g.font = '22px Helvetica'; const was = st.t;
      times.forEach((t, i) => {
        st.t = t; pose(t, 1); pose(t, 1); const sh = frameCamera(t); const zone = (camera.position.z + out.look.z) / 2 < -1.9 ? 'lobby' : 'office'; set.setZone(zone); grade.uniforms.time.value = t; composer.render();
        const x = (i % cols) * tw, y = Math.floor(i / cols) * th; g.drawImage(canvas, x, y, tw, th);
        const lab = `S${sh.n} t=${t.toFixed(1)}`; g.fillStyle = '#000'; g.fillRect(x, y, g.measureText(lab).width + 10, 28); g.fillStyle = '#ff0'; g.fillText(lab, x + 5, y + 22);
      });
      st.t = was; return times.length;
    },
    hideSheet() { $('#sheet').classList.remove('show'); },
  };

  setMode('cut'); tick(0, true); $('#boot').remove();
  if (q.get('map')) $('#bMap').click();
  if (q.get('autoplay')) play(true);
  requestAnimationFrame((n) => { last = n; loop(n); });
}

main().catch((e) => { console.error(e); const b = document.querySelector('#boot'); if (b) b.textContent = 'Failed to start: ' + e.message; });
