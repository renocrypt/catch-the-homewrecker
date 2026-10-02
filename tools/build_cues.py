#!/usr/bin/env python3
"""Turn per-frame OCR of the burned-in subtitles into timed cues, repair the
OCR with the ASR script, and diff the two.

Inputs:
  data/subs_ocr_raw.tsv  one line per 2-fps frame: "f_NNNN.png<TAB>text | text"
      made with:  ffmpeg -i 薛珍珠抓小三.mp4 -vf "fps=2,crop=1920:150:0:885" strips/f_%04d.png
                  swiftc -O -o ocr tools/ocr.swift && ./ocr strips > data/subs_ocr_raw.tsv
      (Vision OCR must run outside the sandbox; its XPC service is blocked inside)
  data/asr_merged.json   ASR transcript, only used to put back the small 的 the OCR drops
Output:
  data/subs.json         [{start, end, text}] cleaned subtitle cues
"""
import difflib
import json
import re
import sys
from collections import Counter
from pathlib import Path

D = Path(__file__).resolve().parent.parent / "data"
FPS = 2.0
PUNCT = set("，。？！、：；…“”‘’（）()「」' \n")

# Vision OCR confusions seen in this clip (burned-in white text, 1080p).
OCR_FIX = [
    ("啊姨", "阿姨"), ("罗子看", "罗子君"), ("罗子君齁妈妈", "罗子君的妈妈"), ("妈妈一", "妈妈"),
    ("陈俊生前丈母娘", "陈俊生的丈母娘"), ("陈俊生钓文母娘", "陈俊生的丈母娘"),
    ("打死眗呀", "打死的呀"), ("这几讲", "这儿讲"), ("己经", "已经"), ("我不是我", "我不是 我"),
]
# Cues the OCR returned nothing for (busy background); verified by eye.
MISSED = [
    {"start": 232.0, "end": 233.0, "text": "散了 散了 散了"},
]


def clean(t):
    # drop ASCII-only watermark fragments ("CI", "Chen>", "er")
    parts = [p.strip() for p in t.split("|")]
    parts = [p for p in parts if re.search(r"[一-鿿]", p)]
    t = " ".join(parts)
    t = re.sub(r"[^一-鿿　-〿！-～ ]", "", t)   # OCR stray marks (apostrophes, latin)
    # fix known misreads per frame, so garbled frames merge with their neighbours
    for old, new in OCR_FIX:
        t = t.replace(old, new)
    return t


def similar(a, b):
    return a == b or a in b or b in a or difflib.SequenceMatcher(None, a, b).ratio() > 0.8


def mmss(t):
    return f"{int(t) // 60:02d}:{t % 60:04.1f}"


frames = []
for line in open(D / "subs_ocr_raw.tsv", encoding="utf-8"):
    name, _, text = line.rstrip("\n").partition("\t")
    idx = int(re.search(r"(\d+)", name).group(1))
    frames.append((idx / FPS, clean(text)))

cues = []
for t, text in frames:
    if not text:
        continue
    if cues and t - cues[-1]["end"] <= 1 / FPS and similar(cues[-1]["variants"][-1], text):
        cues[-1]["end"] = t
        cues[-1]["variants"].append(text)
    else:
        cues.append({"start": t, "end": t, "variants": [text]})
for c in cues:
    cnt = Counter(c["variants"])
    modal = max(cnt, key=lambda v: (cnt[v], len(v)))
    # OCR drops a character now and then: take the longest variant that
    # still contains the modal reading
    c["text"] = max((v for v in cnt if modal in v), key=len)
    c["end"] = round(c["end"] + 1 / FPS, 1)
    del c["variants"]
cues.extend(MISSED)
cues.sort(key=lambda c: c["start"])

# --- align against the ASR-based script, by character, punctuation ignored
rows = json.load(open(D / "asr_merged.json"))
s_chars = [ch for r in rows for ch in r["text"] if ch not in PUNCT]
c_chars, c_pos = [], []          # c_pos: (cue index, offset in cue text)
for ci, c in enumerate(cues):
    for off, ch in enumerate(c["text"]):
        if ch not in PUNCT:
            c_chars.append(ch)
            c_pos.append((ci, off))

sm = difflib.SequenceMatcher(None, c_chars, s_chars, autojunk=False)
print(f"{len(cues)} cues; subtitle chars {len(c_chars)}, script chars {len(s_chars)}, "
      f"identical {sm.ratio():.1%}")

# The OCR loses the small 的 systematically; put it back where the ASR has it.
patches = []
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    ins = "".join(s_chars[j1:j2])
    if tag == "insert" and set(ins) == {"的"}:
        if i1 < len(c_pos) and c_pos[i1][1] > 0:      # inside a cue
            patches.append((c_pos[i1][0], c_pos[i1][1], ins))
        else:                                          # at a cue boundary: suffix of the previous cue
            ci = c_pos[i1 - 1][0]
            patches.append((ci, len(cues[ci]["text"]), ins))
for ci, off, ins in sorted(patches, reverse=True):
    t = cues[ci]["text"]
    cues[ci]["text"] = t[:off] + ins + t[off:]
print(f"restored 的 in {len(patches)} places: " + ", ".join(mmss(cues[ci]['start']) for ci, _, _ in sorted(patches)))

json.dump(cues, open(D / "subs.json", "w"), ensure_ascii=False, indent=1)
print(f"-> {D / 'subs.json'}")

