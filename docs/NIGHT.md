# Night shift notes

All work is local: committed, not pushed, not deployed. The live site still shows the old figures.

## Where things stand

- **Pipeline works end to end.** `tools/characters.py` builds a character in Blender with MPFB (MakeHuman for Blender, CC0
  asset packs) and exports `models/<id>.glb`. `src/actors.js` loads it and poses it from the existing `Person` rig every
  frame, so blocking, gestures, grabs and face channels all carry over unchanged.
- **薛珍珠 (M) is in the scene.** Green tweed coat over a maroon top, tight perm, round face, double chin. Shouts with
  ARKit face units (brows down, squint, sneer, jaw open, teeth showing). Points with her index finger, grabs wrists,
  leans over the counter. Runs at 60 fps.
- `?nomodels` in the URL shows the old primitive figures for comparison; `?debug` exposes `cast` on `window`.

## Screenshots (`.design/`, open via the local server or Finder)

- `scene-005.png` close-up, mid-shout · `scene-012c.png` the wrist grab · `scene-103.png` grabbing Ling Ling
- `actor-point2.png` fitting room: pointing, hand on hip

## Found along the way

- The 0:11 wrist grab never connected, even with the old figures: Xue and the receptionist stand ~0.5 m too far apart
  across the counter. The model now leans in and gets within 0.38 m. Moving one of them closer in `blocking.js`
  would close it; left as is for you to decide.
- The suit's inner lining is painted maroon with the shirt, so a raised arm shows a maroon sliver at the shoulder.

## Next

(filled in as the night goes on)
