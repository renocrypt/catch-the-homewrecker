#!/usr/bin/env python3
"""Transcribe every reference clip in data/refs with Qwen3-ASR and compare with its manifest text.

    cd /Users/ac/dev/ai/genai/mlx-speech && USE_TORCH=0 .venv/bin/python <project>/tools/check_refs.py

Needs Metal, so run outside the sandbox.  A low similarity means the cut caught another speaker
or missed words: adjust the window in extract_refs.py and cut again.
"""
import difflib
import json
import os

import mlx_speech

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/"
man = json.load(open(P + "data/refs/manifest.json", encoding="utf-8"))
asr = mlx_speech.asr.load("/Users/ac/dev/ai/genai/mlx-speech/models/qwen3_asr_1_7b/mlx-int8")
norm = lambda s: "".join(c for c in s if c not in "，。？！、 ,.?!…儿").replace("玲玲", "凌玲").replace("林玲", "凌玲")
for kind, suffix in (("refs", ""), ("alts", "_alt")):
    for spk, e in man[kind].items():
        f = P + f"data/refs/ref_{spk}{suffix}.wav"
        got = asr.generate(f, language="Chinese", max_new_tokens=128).text
        sim = difflib.SequenceMatcher(None, norm(got), norm(e["text"])).ratio()
        print(f"ref_{spk}{suffix:4s} {e['dur']:4.1f}s sim={sim:.2f}  heard: {got}", flush=True)
