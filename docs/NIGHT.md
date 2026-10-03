# Night shift notes

All work is local: committed, not pushed, not deployed. The live site still shows the old figures.

## Where things stand

- **Pipeline works end to end.** `tools/characters.py` builds a character in Blender with MPFB (MakeHuman for Blender, CC0
  asset packs) and `tools/build_models.sh` exports and packs it (gltfpack, meshopt) into `models/<id>.glb`.
  `src/actors.js` loads it and poses it from the existing `Person` rig every frame, so blocking, gestures, grabs and face
  channels all carry over unchanged. Anyone without a model file falls back to the old primitive figure.
- **Principals and guards:** 薛珍珠 (M), 凌玲 (E), 前台 (R), 洪 (H), 小董 (B), both guards (G1, G2). 1.2–2.1 MB each.
  - M: green tweed coat over a maroon top, tight perm, round face, double chin, pearl earrings and brooch.
  - E: ivory top, long cream skirt, dark bob, thin gold necklace.
  - R: black jacket and skirt, white ruffle blouse, ponytail. H: black suit over mustard. B: royal blue jacket.
  - Guards: navy uniform, pale blue shirt, peaked cap and badge.
- **Faces act:** ARKit face units for brows, squint, sneer, jaw, lips; brows, lashes and teeth move with the face. Eyes
  now take up whatever the head doesn't turn toward the look target (eyeLook units).
- **Hands:** index finger points, fingers curl round a grabbed wrist, relaxed otherwise. Chest leans and the shoulder
  comes forward when a grab is past arm's length.
- **Crowd (19 people):** being built with lighter settings (512 px textures, no teeth, eight face units).
- Plays at 60 fps with the principals in. `?nomodels` shows the old figures for comparison; `?debug` exposes `cast`.

## How to rebuild a character

    tools/build_models.sh M            # needs Blender + MPFB in ~/.cache/blender-mpfb, run outside the sandbox
    PREVIEW=1 tools/build_models.sh M  # also renders .design/mpfb/M-{full,face,side}.png

Everything about a person (body sliders, face sliders, hair, garments and their colours) is one entry in `CAST` in
`tools/characters.py`.

## Screenshots (`.design/`, open via the local server or Finder)

- `scene-005.png` M close-up, mid-shout · `scene-012c.png` the wrist grab · `scene-103.png` grabbing Ling Ling
- `scene-061.png` Ling Ling close-up · `lineup.png` the seven principals side by side

## Found along the way

- The 0:11 wrist grab never connected, even with the old figures: Xue and the receptionist stand ~0.5 m too far apart
  across the counter. The model now leans in and gets within 0.38 m. Moving one of them closer in `blocking.js`
  would close it; left as is for you to decide.
- The suit's inner lining is painted maroon with the shirt, so a raised arm shows a maroon sliver at the shoulder.
- Iris textures read reddish in Blender's preview renders; in the scene they look dark brown.

## Next

(filled in as the night goes on)
