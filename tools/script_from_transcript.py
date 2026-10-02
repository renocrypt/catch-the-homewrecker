#!/usr/bin/env python3
"""Fill the 80 slots of data/script.json with the verbatim lines from data/transcript.json.

Slots keep their id / t0 / t1 / zone / gist (blocking and shots depend on them); only the
text changes: every slot gets a `quote` built from the subtitle cues that fall into it, and
the paraphrased `line` fields go away.  Subtitles appear ~0.6 s before the slot times (which
came from ASR commit timestamps), so cues are shifted by SHIFT before matching.

    python3 tools/script_from_transcript.py          # rewrite data/script.json, reset voices.json
    python3 tools/script_from_transcript.py --dry    # just print the assignment
"""
import json
import re
import shutil
import sys
from pathlib import Path

P = Path(__file__).resolve().parent.parent
CODE = {"薛珍珠": "M", "前台": "R", "洪": "H", "小董": "B", "凌玲": "E", "保安": "G", "小董（画外）": "B"}
SHIFT = 0.6        # subtitle cue -> slot time offset
TOL = 0.2          # slack around a slot when measuring overlap
PUNCT = "，。？！、 "


def strip(s):
    return "".join(c for c in s if c not in PUNCT)


def mmss(t):
    return f"{int(t) // 60:02d}:{t % 60:04.1f}"


def overlap(a0, a1, b0, b1):
    return max(0.0, min(a1, b1) - max(a0, b0))


S = json.load(open(P / "data/script.json", encoding="utf-8"))
T = json.load(open(P / "data/transcript.json", encoding="utf-8"))["lines"]
slots = S["lines"]
for s in slots:
    s["_cues"] = []

unassigned = []
for ci, c in enumerate(T):
    c0, c1, spk = c["start"] + SHIFT, c["end"] + SHIFT, CODE[c["speaker"]]
    cands = [(overlap(c0, c1, s["t0"] - TOL, s["t1"] + TOL), s) for s in slots]
    cands = [(o, s) for o, s in cands if o > 0]
    same = [(o, s) for o, s in cands if s["spk"] == spk]
    mid = (c0 + c1) / 2
    gap_to = lambda s: 0 if s["t0"] <= mid <= s["t1"] else min(abs(mid - s["t0"]), abs(mid - s["t1"]))
    near = min((s for s in slots if s["spk"] == spk), key=gap_to)
    if same:                                   # a slot of this speaker under the cue
        best = max(same, key=lambda x: x[0])[1]
    elif gap_to(near) <= 1.0:                  # ... or one right next to it
        best = near
    elif cands:                                # only another speaker's slot there: the slot's spk is probably wrong
        best = max(cands, key=lambda x: x[0])[1]
        best.setdefault("_spk_conflict", []).append(spk)
    elif gap_to(near) <= 1.5:
        best = near
    else:
        unassigned.append(c)
        continue
    best["_cues"].append(c)

# a very short slot whose cue runs on into the next slot of the same speaker: hand the cue over
for i, s in enumerate(slots[:-1]):
    nxt = slots[i + 1]
    if s["_cues"] and (s["t1"] - s["t0"]) < 1.2 and nxt["spk"] == s["spk"] and nxt["t0"] - s["t1"] < 0.5:
        last = s["_cues"][-1]
        if last["end"] + SHIFT > nxt["t0"] + 0.3:
            nxt["_cues"].insert(0, s["_cues"].pop())


Q = re.compile(r"(吗|呢|是吧|得吧|了吧|不好|不知道|谁|什么|怎么|为什么)$")


def punct(text, old, spk):
    if old and strip(old) == strip(text) and old[-1] in "。？！":
        return old[-1]
    if old and old[-1] == "？" and strip(text) in strip(old):
        return "？"
    if Q.search(text):
        return "？"
    return "！" if spk in ("M", "G") else "。"


def join(cues):
    parts = [p for c in cues for p in c["text"].split(" ") if p]
    out = ""
    for p in parts[:-1]:
        out += p + ("？" if Q.search(p) else "，")
    return out + parts[-1]


changed = []
for s in slots:
    old = s.get("quote") or s.get("line") or ""
    cues = s.pop("_cues")
    conflict = s.pop("_spk_conflict", None)
    if conflict and not any(CODE[c["speaker"]] == s["spk"] for c in cues):
        s["spk"] = conflict[0]
    if cues:
        text = join(cues)
        s["quote"] = text + punct(text, old, s["spk"])
        s["sub_t0"], s["sub_t1"] = cues[0]["start"], cues[-1]["end"]
    else:
        s.pop("quote", None)
        s.pop("sub_t0", None); s.pop("sub_t1", None)
    s.pop("line", None)
    if strip(old) != strip(s.get("quote", "")):
        s.pop("quote_en", None)        # English (tools/add_english.py) belongs to the old wording
    new = s.get("quote", "")
    mark = "" if strip(old) == strip(new) else ("NEW " if old else "FILL")
    if conflict: mark += " SPK->" + s["spk"]
    changed.append((s, old, new, mark))

for s, old, new, mark in changed:
    print(f"{s['id']:2d} {s['spk']} {mmss(s['t0'])}-{mmss(s['t1'])} {mark:12s} {old[:22]:<24s} -> {new}")
print(f"\n{sum(1 for _, o, n, _ in changed if strip(o) != strip(n))} slots changed, "
      f"{sum(1 for s in slots if not s.get('quote'))} empty, {len(unassigned)} cues unassigned")
for c in unassigned:
    print(f"  unassigned {mmss(c['start'])} {c['speaker']}: {c['text']}")

if "--dry" in sys.argv:
    sys.exit(0)

shutil.copy(P / "data/script.json", P / "data/script.prev.json")
S["meta"]["timing"] = ("Slot times from Confucius4-R2T2 streaming commit timestamps, cross-checked against Qwen3-ASR, "
                       "burned-in subtitles and shot cuts. sub_t0/sub_t1 = when the subtitle for the slot is on screen.")
S["meta"]["content"] = ("quote = the line verbatim from the burned-in subtitles (data/transcript.json, Vision OCR, checked); "
                        "gist / gist_en = summary of the beat. Slots without a quote are silent.")
json.dump(S, open(P / "data/script.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

V = json.load(open(P / "data/voices.json", encoding="utf-8"))
shutil.copy(P / "data/voices.json", P / "data/voices.prev.json")
V["lines"] = []          # every slot is re-voiced from the verbatim text
json.dump(V, open(P / "data/voices.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote data/script.json (backup script.prev.json), cleared voices.json lines (backup voices.prev.json)")
