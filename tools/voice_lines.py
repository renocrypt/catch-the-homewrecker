#!/usr/bin/env python3
"""Voice the lines in data/script.json with Breeze TTS 2 and verify each take with Qwen3-ASR.

    cd /Users/ac/dev/ai/genai/mlx-speech
    USE_TORCH=0 .venv/bin/python /Users/ac/dev/ai/benchmarks-local/ms-zhenzhu/tools/voice_lines.py            # only lines whose text changed
    USE_TORCH=0 .venv/bin/python /Users/ac/dev/ai/benchmarks-local/ms-zhenzhu/tools/voice_lines.py 3 12 44    # these ids, even if unchanged
    USE_TORCH=0 .venv/bin/python /Users/ac/dev/ai/benchmarks-local/ms-zhenzhu/tools/voice_lines.py --list     # show what would run, no model

Rules: a line is voiced from its "line" field, or "quote" if there is no "line". Delivery comes from
"dir" on the line (optional). The speaker's reference voice is data/refs/ref_<spk>.wav, cut from the source video (tools/extract_refs.py).
Needs Metal, so run outside the sandbox. One process; models load sequentially.
"""
import json, sys, time, warnings, wave, difflib, subprocess, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); P = os.path.dirname(HERE) + "/"
REFD = P + "data/refs/"; WORK = "/tmp/zhenzhu/voice3/"; os.makedirs(WORK, exist_ok=True)   # refs cut from the source video, see extract_refs.py
S = json.load(open(P + "data/script.json", encoding="utf-8")); V = json.load(open(P + "data/voices.json", encoding="utf-8"))
refs = json.load(open(REFD + "manifest.json"))["refs"]
by_id = {l["id"]: l for l in V["lines"]}
DEFAULT_DIR = {"M": "怒气冲冲，嗓门很大，语速很快，咄咄逼人。", "R": "慌张，小声，声音发抖。", "H": "着急，语速快。", "B": "压低声音，克制地劝。", "E": "语速偏快，干脆，不拖；语气克制但清楚、有分量，是当着对方的面回话，不是内心独白。", "G": "粗声呵斥，急促。"}

def text_of(L): return L.get("tts") or L.get("line") or L.get("quote")   # "tts": same words spelt for the synthesizer (e.g. 玲玲 for 凌玲)
args = [a for a in sys.argv[1:] if not a.startswith("--")]; listing = "--list" in sys.argv
todo = []
for L in S["lines"]:
    t = text_of(L)
    if not t: continue
    old = by_id.get(L["id"])
    if args and str(L["id"]) not in args: continue
    if not args and old and old.get("text") == t: continue
    todo.append(L)
print(f"{len(todo)} line(s) to voice:", [l["id"] for l in todo])
if listing or not todo: sys.exit(0)

import mlx_speech
from mlx_speech.audio import write_wav
tts = mlx_speech.tts.load("/Users/ac/dev/ai/genai/mlx-speech/models/breezeblue/breeze_tts_2/mlx-bf16")
asr = mlx_speech.asr.load("/Users/ac/dev/ai/genai/mlx-speech/models/qwen3_asr_1_7b/mlx-int8")
def norm(s):   # what the ASR check compares: no punctuation, particles and homophones of the name folded
    s = "".join(c for c in s if c not in "，。？！、 ,.?!…儿").replace("呀", "啊").replace("哇", "啊")
    for h in ("玲玲", "林玲", "零零", "铃铃", "琳琳", "凌凌", "玲凌"): s = s.replace(h, "凌玲")
    s = s.replace("算了", "散了")   # the ASR hears 散了 (break it up) as 算了
    return s
def voiced(p):
    w = wave.open(p); sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    win = int(sr * 0.02); e = np.sqrt(np.convolve(a * a, np.ones(win) / win, mode="same")); i = np.where(e > 0.02)[0]
    return float((i[-1] - i[0]) / sr) if len(i) else 0.0

for L in todo:
    i, k, txt = L["id"], L["spk"], text_of(L); d = L.get("dir") or DEFAULT_DIR[k]
    slot = L["t1"] - L["t0"]; nxt = min([x["t0"] for x in S["lines"] if x["spk"] == k and x["t0"] > L["t0"]] + [240.0]); room = nxt - L["t0"] - 0.1
    n = len(norm(txt)); best = None
    for sd in [42, 1, 2, 5, 11, 13]:
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            r = tts.generate(txt, max_new_tokens=int(n * 5.5 + 40), seed=sd, reference_audio=REFD + f"ref_{k}.wav", reference_text=refs[k]["text"], instruction=d, guidance_scale=4.0)
            cap = any(issubclass(x.category, RuntimeWarning) for x in w)
        p = WORK + "try.wav"; write_wav(p, r.waveform, sample_rate=r.sample_rate)
        got = asr.generate(p, language="Chinese", max_new_tokens=96).text; v = voiced(p)
        sim = difflib.SequenceMatcher(None, norm(got), norm(txt)).ratio(); ok = (not cap) and sim >= 0.9 and v >= n * 0.085; fits = v <= room * 1.3
        print(f"  {i:02d} seed={sd} sim={sim:.2f} voiced={v:.2f}s fits={fits} <= {got}", flush=True)
        if ok and (best is None or (fits and not best["fits"]) or (fits == best["fits"] and v < best["v"] and not fits)):
            write_wav(WORK + f"line_{i:02d}_{k}.wav", r.waveform, sample_rate=r.sample_rate); best = dict(seed=sd, v=v, fits=fits)
        if ok and fits: break
    if best is None: print(f"  {i:02d} FAILED — kept the previous clip"); continue
    target = min(room, slot + max(0.4, 0.25 * slot)); tempo = max(1.0, min(1.35, best["v"] / max(target, 0.3)))
    f = f"audio/line_{i:02d}_{k}.m4a"
    af = ("silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.12,areverse,"
          + (f"atempo={tempo:.3f}," if tempo > 1.01 else "") + "loudnorm=I=-18:TP=-2:LRA=11,aresample=44100")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", WORK + f"line_{i:02d}_{k}.wav", "-af", af, "-c:a", "aac", "-b:a", "96k", P + f], check=True)
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", P + f]).decode())
    entry = by_id.get(i) or {"id": i, "spk": k, "file": f}
    entry.update(file=f, dur=round(dur, 2), dir=d, seed=best["seed"], tempo=round(tempo, 2), text=txt, written="line" in L)
    by_id[i] = entry
    print(f"  {i:02d} done: {dur:.2f}s tempo {tempo:.2f}", flush=True)
V["lines"] = sorted(by_id.values(), key=lambda l: l["id"])
json.dump(V, open(P + "data/voices.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("voices.json updated")
