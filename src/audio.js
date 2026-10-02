// Sound. Three layers, all driven by the same clock as the picture:
//   1. voice clips — the short quoted lines, generated locally with Breeze TTS 2
//   2. babble — wordless, pitched syllable blips for every other line, so each speech
//      slot is audible with the right speaker, length and intensity
//   3. room — office tone, lobby reverb, crowd murmur, footsteps
import { rng } from './textures.js';

const PITCH = { M: 285, R: 335, H: 320, B: 232, E: 212, G: 124 };

export class Sound {
  constructor(script, voices) {
    this.script = script; this.voices = voices; this.ready = false; this.enabled = { voice: true, babble: true, room: true };
    this.active = new Map(); this.cursor = 0; this.pan = {}; this.zone = 'office';
    // syllable plan for the babble layer (deterministic)
    this.syl = [];
    const voiced = new Set(voices.lines.map((l) => l.id));
    for (const L of script.lines) {
      if (voiced.has(L.id)) continue;
      const r = rng(L.id * 977), rate = L.spk === 'E' ? 4.6 : L.spk === 'M' ? 5.8 : 5.2;
      const n = Math.max(2, Math.round((L.t1 - L.t0) * rate));
      for (let i = 0, t = L.t0; i < n && t < L.t1 - 0.08; i++) {
        const gapy = r() < 0.12;                                   // phrase breaks
        this.syl.push({ t, spk: L.spk, f: PITCH[L.spk] * (1.12 - 0.22 * (i / n) + (r() - 0.5) * 0.3), v: 0.55 + r() * 0.45, f1: 420 + r() * 520, f2: 1100 + r() * 1400, d: 0.07 + r() * 0.06 });
        t += (1 / rate) * (0.75 + r() * 0.5) + (gapy ? 0.22 : 0);
      }
    }
    this.syl.sort((a, b) => a.t - b.t);
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3.5;
    master.connect(comp).connect(ctx.destination);
    // reverb send (generated impulse response)
    const len = ctx.sampleRate * 1.9, ir = ctx.createBuffer(2, len, ctx.sampleRate), r = rng(5);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.1; this.wet.connect(conv).connect(master);
    this.dry = ctx.createGain(); this.dry.connect(master);
    // one panner per speaker
    this.bus = {};
    for (const k of Object.keys(PITCH)) { const p = ctx.createStereoPanner(); p.connect(this.dry); p.connect(this.wet); this.bus[k] = p; }
    // noise bed
    const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), nd = nb.getChannelData(0); let last = 0;
    for (let i = 0; i < nd.length; i++) { last = last * 0.985 + (r() * 2 - 1) * 0.015; nd[i] = last * 12; }
    this.noise = nb;
    const tone = ctx.createBufferSource(); tone.buffer = nb; tone.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    this.roomGain = ctx.createGain(); this.roomGain.gain.value = 0; tone.connect(lp).connect(this.roomGain).connect(master); tone.start();
    const mur = ctx.createBufferSource(); mur.buffer = nb; mur.loop = true; mur.playbackRate.value = 1.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.8;
    this.murGain = ctx.createGain(); this.murGain.gain.value = 0; mur.connect(bp).connect(this.murGain).connect(this.wet); this.murGain.connect(master); mur.start();
    // voice clips
    this.buf = new Map();
    const queue = this.voices.lines.slice();
    const worker = async () => {             // a few at a time: simple dev servers drop bursts
      for (let v; (v = queue.shift());) {
        for (let attempt = 0; attempt < 4; attempt++) {
          try { const a = await (await fetch(v.file)).arrayBuffer(); this.buf.set(v.id, await ctx.decodeAudioData(a)); break; }
          catch (e) { if (attempt === 3) console.warn('voice clip failed', v.file); else await new Promise((r) => setTimeout(r, 150 * (attempt + 1))); }
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.lineById = new Map(this.script.lines.map((l) => [l.id, l]));
    this.ready = true;
  }

  stopAll() { for (const s of this.active.values()) { try { s.stop(); } catch (e) { /* already ended */ } } this.active.clear(); }
  seek(t) { this.stopAll(); this.cursor = t; }

  blip(s, when) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(s.f, when); o.frequency.linearRampToValueAtTime(s.f * 0.93, when + s.d);
    const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
    f1.type = f2.type = 'bandpass'; f1.frequency.value = s.f1; f2.frequency.value = s.f2; f1.Q.value = 5; f2.Q.value = 7;
    const lv = 0.2 * s.v * (s.spk === 'M' ? 1.15 : 0.85);
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(lv, when + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, when + s.d + 0.05);
    o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(this.bus[s.spk]);
    o.start(when); o.stop(when + s.d + 0.08);
  }

  step(heel, gain) {
    if (!this.ready || !this.enabled.room) return;
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), now = ctx.currentTime;
    src.buffer = this.noise; src.playbackRate.value = heel ? 5 : 2.4; f.type = 'bandpass'; f.frequency.value = heel ? 1900 : 520; f.Q.value = 1.6;
    g.gain.setValueAtTime(gain * (heel ? 0.35 : 0.5), now); g.gain.exponentialRampToValueAtTime(0.0006, now + (heel ? 0.05 : 0.09));
    src.connect(f).connect(g); g.connect(this.dry); g.connect(this.wet); src.start(now, Math.random() * 2, 0.12);
  }

  // called every frame while the context is running
  update(t, playing, info) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    this.wet.gain.setTargetAtTime(info.zone === 'lobby' ? 0.42 : 0.1, now, 0.15);
    this.roomGain.gain.setTargetAtTime(playing && this.enabled.room ? (info.zone === 'lobby' ? 0.05 : 0.08) : 0, now, 0.2);
    this.murGain.gain.setTargetAtTime(playing && this.enabled.room ? 0.012 + info.crowd * 0.05 : 0, now, 0.25);
    for (const k of Object.keys(this.bus)) this.bus[k].pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, info.pan[k] ?? 0)), now, 0.08);
    if (!playing) { if (this.active.size) this.stopAll(); this.cursor = t; return; }
    if (this.enabled.voice) {
      for (const v of this.voices.lines) {
        const L = this.lineById.get(v.id), off = t - L.t0;
        if (off >= 0 && off < v.dur - 0.05 && !this.active.has(v.id)) {
          if (!this.buf.has(v.id)) continue;
          const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = this.buf.get(v.id); g.gain.value = v.spk === 'E' ? 1.15 : 1;
          src.connect(g).connect(this.bus[v.spk]); src.start(now, off); this.active.set(v.id, src);
          src.onended = () => { if (this.active.get(v.id) === src) this.active.delete(v.id); };
        } else if ((off < 0 || off > v.dur + 0.3) && this.active.has(v.id)) { this.active.get(v.id).onended = null; this.active.delete(v.id); }
      }
    } else if (this.active.size) this.stopAll();
    if (this.enabled.babble) {
      const until = t + 0.12;
      for (const s of this.syl) { if (s.t <= this.cursor) continue; if (s.t > until) break; this.blip(s, now + Math.max(0, s.t - t)); }
      this.cursor = until;
    } else this.cursor = t;
  }
}
