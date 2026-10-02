#!/usr/bin/env python3
"""Cut one reference clip per character out of the source video's audio, for Breeze voice cloning.

Breeze TTS 2 only needs a few seconds of a voice plus its transcript.  REFS lists, per speaker
code, the subtitle windows (data/transcript.json times) in which only that person speaks; the
pieces are cut from the mp4, joined with a short gap, and written as 24 kHz mono WAV to
data/refs/ref_<spk>.wav with the subtitle text as reference_text in data/refs/manifest.json.
A second candidate per speaker goes to ref_<spk>_alt.wav; swap the files if the first sounds worse.

    python3 tools/extract_refs.py
"""
import json
import subprocess
import wave
from array import array
from pathlib import Path

P = Path(__file__).resolve().parent.parent
SRC = P / "薛珍珠抓小三.mp4"
OUT = P / "data/refs"
SR = 24000
LEAD, TAIL, GAP = 0.0, 0.3, 0.15         # seconds: subtitle on-screen -> speech margins, gap between pieces
CODE = {"薛珍珠": "M", "前台": "R", "洪": "H", "小董": "B", "凌玲": "E", "保安": "G", "小董（画外）": "B"}
ROLE = {"M": "薛珍珠", "R": "前台", "H": "洪", "B": "小董", "E": "凌玲", "G": "保安"}

# (start, end) subtitle windows; only this speaker inside, no music sting, no overlap
REFS = {
    "M": {"main": [(112.0, 117.5)], "alt": [(165.0, 169.5)]},          # 我跟你说我这一辈子… / 再说现在多少夫妻…
    # 凌玲 delivers her lines slowly in the source; the clone inherits that pace and then falls behind the
    # cut, so her reference is sped up (pitch kept) before cloning
    "E": {"main": [(136.5, 142.0)], "alt": [(180.0, 184.0)], "tempo": 1.15},   # 阿姨你觉得这种事情… / 我们俩都有孩子…
    "B": {"main": [(33.5, 37.0)], "alt": [(40.5, 43.5)]},              # 阿姨我们这儿办公的地方… / 我不是凌玲阿姨你搞错了…
    "R": {"main": [(0.5, 1.5), (7.5, 8.0), (17.0, 18.5)], "alt": [(0.5, 1.5), (17.0, 18.5)]},   # 12.5-14.0 overlaps 薛珍珠
    "H": {"main": [(22.5, 24.5), (28.0, 29.0)], "alt": [(26.5, 27.0), (28.0, 29.0)]},
    # the guards only speak here, on top of 薛珍珠; the cut starts mid-phrase, so the text is given by hand
    "G": {"main": [(219.3, 221.3)], "alt": [(220.0, 221.3)], "text": {"main": "别在这儿闹，快走，别在这儿闹。", "alt": "快走，别在这儿闹。"}},
}

cues = json.load(open(P / "data/transcript.json", encoding="utf-8"))["lines"]


def text_in(spk, a, b):
    """Subtitle text of this speaker inside [a, b], phrases joined with Chinese commas."""
    parts = []
    for c in cues:
        if CODE[c["speaker"]] == spk and c["start"] >= a - 0.01 and c["end"] <= b + 0.01:
            parts += [p for p in c["text"].split(" ") if p]
    return "，".join(parts)


def trim(pcm, pad=0.06):
    """Drop leading / trailing near-silence (20 ms RMS below 8% of the loudest frame), keep `pad` s around the speech.
    Left in, the pauses get cloned too and the TTS drawls."""
    a = array("h", pcm); n = len(a); win = SR // 50
    rms = [sum(x * x for x in a[i:i + win]) ** 0.5 / win ** 0.5 for i in range(0, n - win + 1, win)]
    thr = max(0.08 * max(rms), 60)
    on = [i for i, r in enumerate(rms) if r > thr]
    if not on:
        return pcm
    lo = max(0, on[0] * win - int(SR * pad)); hi = min(n, (on[-1] + 1) * win + int(SR * pad))
    return a[lo:hi].tobytes()


def cut(a, b, dst):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0, a - LEAD):.2f}", "-t", f"{b + TAIL - a + LEAD:.2f}",
                    "-i", str(SRC), "-vn", "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", str(dst)], check=True)
    with wave.open(str(dst)) as w:
        return trim(w.readframes(w.getnframes()))


OUT.mkdir(parents=True, exist_ok=True)
manifest = {"source": SRC.name, "sample_rate": SR, "refs": {}, "alts": {}}
for spk, cand in REFS.items():
    for kind, windows in cand.items():
        if kind in ("text", "tempo"):
            continue
        pcm = b""
        for i, (a, b) in enumerate(windows):
            if i:
                pcm += b"\x00" * int(SR * GAP) * 2
            pcm += cut(a, b, OUT / "_piece.wav")
        name = f"ref_{spk}.wav" if kind == "main" else f"ref_{spk}_alt.wav"
        with wave.open(str(OUT / name), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm)
        if cand.get("tempo"):   # faster baseline delivery, same pitch
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(OUT / name), "-af", f"atempo={cand['tempo']}", str(OUT / "_t.wav")], check=True)
            (OUT / "_t.wav").replace(OUT / name)
            with wave.open(str(OUT / name)) as w:
                pcm = w.readframes(w.getnframes())
        text = cand.get("text", {}).get(kind) or "。".join(text_in(spk, a, b) for a, b in windows) + "。"
        entry = {"role": ROLE[spk], "text": text, "dur": round(len(pcm) / 2 / SR, 2), "windows": windows}
        manifest["refs" if kind == "main" else "alts"][spk] = entry
        print(f"{name:14s} {entry['dur']:5.2f}s  {text}")
(OUT / "_piece.wav").unlink()
json.dump(manifest, open(OUT / "manifest.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"-> {OUT}/manifest.json")
