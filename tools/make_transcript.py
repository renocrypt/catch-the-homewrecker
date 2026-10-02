#!/usr/bin/env python3
"""Verbatim transcript: subtitle cues (data/subs.json, from build_cues.py) + speakers.

Speakers were identified from the video frames (see CAST).  SPEAKERS gives,
by cue start time, who speaks from that moment until the next entry.  SPLIT
lists cues in which two people speak (the subtitle joins them with a space):
the cue is cut at its first space and the halves get the two speakers.

Writes data/transcript.json and data/transcript.md.
"""
import json
from pathlib import Path

D = Path(__file__).resolve().parent.parent / "data"

CAST = {
    "薛珍珠": "罗子君的妈妈、陈俊生的丈母娘（剧中写作薛甄珠）；墨绿外套、卷发",
    "凌玲": "陈俊生的同事、第三者；白衬衫、短发",
    "前台": "公司前台；黑西装，坐在前台",
    "洪": "女同事，自称“我姓洪”；黑西装、长发，第一个被错抓的",
    "小董": "女同事；蓝西装，第二个被错抓、一路劝阻，最后驱散围观的人",
    "保安": "两名保安，把薛珍珠拉走",
}

# (cue start time, speaker) — applies until the next entry
SPEAKERS = [
    (0.0, "前台"), (2.0, "薛珍珠"), (7.5, "前台"), (8.5, "薛珍珠"), (12.5, "前台"),
    (14.0, "薛珍珠"),
    (17.0, "前台"),             # 他们说是凌玲 — the receptionist gives up the name
    (19.0, "薛珍珠"), (22.5, "洪"), (24.5, "薛珍珠"), (26.5, "洪"), (27.0, "薛珍珠"),
    (28.0, "洪"), (29.0, "薛珍珠"), (33.5, "小董"), (37.0, "薛珍珠"), (37.5, "小董"),
    (38.5, "薛珍珠"), (40.5, "小董"), (43.5, "薛珍珠"),
    (45.5, "薛珍珠"),            # "凌玲 阿姨 您别这样" / "凌玲 这不方便" split below
    (48.0, "小董"), (49.0, "薛珍珠"), (64.5, "凌玲"), (66.5, "薛珍珠"),
    (136.5, "凌玲"), (154.5, "薛珍珠"), (180.0, "凌玲"), (189.5, "薛珍珠"),
    (210.0, "凌玲"), (211.5, "薛珍珠"), (218.5, "保安"), (221.5, "薛珍珠"),
    (230.5, "小董"), (237.5, "小董（画外）"),
]
SPLIT = {45.5: ("薛珍珠", "小董"), 47.0: ("薛珍珠", "小董")}


def speaker_at(t):
    name = SPEAKERS[0][1]
    for start, who in SPEAKERS:
        if t >= start:
            name = who
    return name


def mmss(t):
    return f"{int(t) // 60:02d}:{t % 60:04.1f}"


cues = json.load(open(D / "subs.json"))
lines = []
for c in cues:
    if c["start"] in SPLIT and " " in c["text"]:
        a, b = c["text"].split(" ", 1)
        s1, s2 = SPLIT[c["start"]]
        mid = round((c["start"] + c["end"]) / 2, 2)   # first speaker gets the first half of the cue
        lines.append({"start": c["start"], "end": mid, "speaker": s1, "text": a})
        lines.append({"start": mid, "end": c["end"], "speaker": s2, "text": b})
    else:
        lines.append({"start": c["start"], "end": c["end"], "speaker": speaker_at(c["start"]), "text": c["text"]})

json.dump({"cast": CAST, "lines": lines}, open(D / "transcript.json", "w"), ensure_ascii=False, indent=1)

md = ["# 薛珍珠抓小三（0:00–4:00）台本", "",
      "台词以视频硬字幕为准（Vision OCR，已校对），时间为字幕出现/消失时刻；说话人按画面标注。", "",
      "## 人物", ""]
md += [f"- **{k}**：{v}" for k, v in CAST.items()]
md += ["", "## 台词", ""]
for ln in lines:
    md.append(f"[{mmss(ln['start'])}–{mmss(ln['end'])}] **{ln['speaker']}**：{ln['text']}")
(D / "transcript.md").write_text("\n".join(md) + "\n", encoding="utf-8")

from collections import Counter
cnt = Counter(ln["speaker"] for ln in lines)
print(f"{len(lines)} lines -> {D / 'transcript.md'}, {D / 'transcript.json'}")
print("lines per speaker:", dict(cnt))
