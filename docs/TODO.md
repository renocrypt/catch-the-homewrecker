# TODO

## English dubbing (next)
Breeze TTS 2 speaks English and Chinese with one model (see
`models/breezeblue/breeze_tts_2/original/README.md`). Every voiced slot in `data/script.json`
already has a `quote_en`, and the reference clips in `data/refs/ref_<spk>.wav` can be cloned
across languages.
- [ ] `tools/voice_lines.py --lang en`: voice `quote_en`, write `audio_en/line_NN_X.m4a`, record
      takes in `data/voices_en.json`. Round-trip check with Qwen ASR `language="English"` and an
      English `norm()` (strip punctuation, lower-case, fold numbers / contractions).
- [ ] `src/audio.js`: pick the track by `st.lang`; stop the current track and re-queue when the
      中/EN button is pressed.
- [ ] Listen to a few cross-language takes first (M's Shanghai delivery, E's low, even tone). If the
      accent is off, cut separate English reference clips or adjust the per-speaker `dir` prompt.
- [ ] English lines run longer than the Chinese ones; watch `tempo` hitting its 1.35 cap and either
      widen `room` or tighten the `quote_en` wording.

## Timing
- [ ] Slot `t0/t1` still come from ASR commit timestamps (~0.6 s later than the subtitles). Each slot
      now records `sub_t0/sub_t1` (subtitle on/off screen); shift the slots back in one pass and
      re-voice. Check what `blocking.js` / `shots.js` derive from `t0` before changing it.
- [ ] 0:14 "那是谁？谁？" is voiced entirely by Xue Zhenzhu; the second "谁" may be the receptionist's.
      Decide from the audio and split the slot if so.

## Picture
Everyone is a rigged MPFB model now (`tools/characters.py` → `tools/build_models.sh` → `models/`,
posed by `src/actors.js`); the primitive figures only remain as the invisible rig and as a fallback.
- [ ] Props: swap the hexagon plants, chairs, laptops, sofa and mug for the Sketchfab shortlist
      (all CC BY, see the night notes); needs a logged-in Sketchfab session to download.
- [ ] Xue's perm (`afro01`) sits like a cap with a high hairline; nothing in hair01 reads closer.
      A custom curl cap would.
- [ ] `toigo_female_suit_2`'s lining is painted with the shirt, so a raised arm shows a maroon
      sliver at the shoulder.
- [ ] The 0:11 wrist grab never connects: Xue and the receptionist stand ~0.5 m too far apart across
      the counter (true of the old figures too). Move one of them in `blocking.js`.
- [ ] Models total 22 MB; the crowd could load after the principals.
- [ ] Depth of field (BokehPass) is heavy and costs two full-screen passes while playing (paused
      frames are no longer rendered): lower `maxblur` per shot or add a toggle.
- [ ] The 2048 shadow map could drop to 1024, or be skipped on wide shots.
- [ ] `Person.keepOut` now uses the model's measured clothed torso; if a pose still clips, fix the
      `forward` value of that gesture in `HAND` first.

## Data / pipeline
- [ ] `data/refs/*_alt.wav` are untested alternative reference clips per character; if a main
      reference sounds wrong, rename the alt over it and rerun `voice_lines.py`.
- [ ] `tools/ocr.swift` must be compiled and run outside the sandbox (Vision's XPC service is blocked
      inside); steps are in the header of `tools/build_cues.py`.
- [ ] `data/asr_merged.json` only exists to restore the small 的 the OCR drops; it can go once the
      subtitles are final.
