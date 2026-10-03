# Night shift notes

Everything is committed locally. **Nothing is pushed to GitHub and nothing is deployed**: the live site still shows the
old figures until you say so.

## Start here

- `.design/before-after.jpg`: three shots, old figures on the left, new on the right.
- Run the page: `python3 tools/serve.py 8765` in the project folder, then open `http://127.0.0.1:8765/`. Use this
  rather than `python3 -m http.server`, which lets the browser keep stale copies of rebuilt models. `?nomodels` shows
  the old figures, `?debug` puts `cast`, `camera`, `scene` on `window`, `?pr=2` pins the pixel ratio (no automatic quality steps).

## What changed

- **All 26 people are rigged MakeHuman models** (MPFB in Blender, CC0 asset packs). `tools/characters.py` holds each
  person as one `CAST` entry (body and face sliders, skin, hair, garments and their colours); `tools/build_models.sh`
  exports and packs them into `models/<id>.glb`. Principals 2.2–3.7 MB, crowd 0.5–0.8 MB, 28 MB in all.
- **The old animation system drives them unchanged.** `src/actors.js` poses each model from its `Person` every frame:
  spine and head from the posture, arms and legs re-solved with the model's own bone lengths toward the Person's wrists
  and ankles, fingers per gesture (point, grip, relax), a lean and a shoulder reach when a grab is past arm's length.
  Blocking, grabs, looks and timing are as before. 60 fps with everyone on screen.
- **Faces act.** ARKit face units drive brows, squint, sneer, jaw, lips; brows, lashes and teeth move with them. Eyes
  take up whatever the head doesn't turn toward the look target.
- **The look of each principal:** 薛珍珠 green tweed coat over maroon, tight perm, round face, double chin, pearl earrings;
  凌玲 ivory knit, long cream skirt, brown bob, gold necklace; 前台 black suit and ruffle blouse; 洪 black suit over
  mustard; 小董 royal blue jacket; guards in navy with peaked caps and badges. Garments are MakeHuman clothes with their
  textures repainted per person (`suit2`, `fsuit`, `msuit3`, `twotone`, `flat`, `stripes` in `characters.py`).
- **Social card** (`og.jpg`) re-shot with the new 薛珍珠, same line. Live site still has the old one.
- `docs/CREDITS.md` lists the assets. `docs/TODO.md`'s Picture section is rewritten for the new pipeline.

## Morning round

- **The flicker** was two things. Eye and pearl highlights blew up to infinity in the half-float buffer, and bloom smeared
  them into black squares that came and went; a scrub pass now clamps every pixel before the effects run, and eyes and
  pearls are less glossy. Separately, the shadow map was redrawn three times a frame (once per effect pass) and alpha-cut
  hair shimmered; it is now drawn once per frame, and hair edges use alpha-to-coverage under MSAA.
- **Performance:** 2722 draw calls a frame came down to 350–1230 depending on the shot, and the shadow camera now frames
  each shot instead of the whole office. The page also steps its resolution down if it can't hold 48 fps and back up
  when it can. With all 26 people it runs at 100–120 fps here. Depth of field now reuses the depth the ambient
  occlusion pass already draws instead of drawing the whole scene again: about 5 ms and 500 draw calls a frame less.
- **Walking:** feet stay planted. The stance foot moves back at exactly the walking speed (it used to slide about 13% of
  a stride, now about 2 cm), the swing foot eases through, and the heel lifts and the toe rolls off.
- **Hands at rest** curl and close up instead of hanging flat with splayed fingers; thumbs tuck in.
- **Faces and clothes:** skin, hair and brows are 2048 textures on the principals; tweed is a crisper, smaller weave;
  trouser hems carry the trouser colour; the tie is a flat colour.
- **薛珍珠's perm:** about 180 small curl tufts over the cap break the hard hairline and the helmet outline, so it reads as
  a tight set perm.
- **凌玲 no longer sulks.** The stock female mouth (full lips, drooping corners) looked like a pout in every close-up.
  凌玲, the receptionist and 洪 now have slimmer, level lips; 凌玲 also gets a natural lip colour and a faint resting
  smile (`rest` in her entry in `people.js`), so she reads as composed. It eases off when she shouts.
- **No neckties.** The suit 薛珍珠, 洪 and 小董 wear came with a tie that still showed as a tie after repainting; it is cut
  out of the mesh now, leaving open-necked tops.
- **The lunge at 1:42** was a bow-legged squat with both feet side by side. Now the right foot steps in, the left braces
  behind and the knees point forward.

## Needs you

1. **Look at the people.** If someone's wrong (face, build, hair, colours), say so: it's one entry in `CAST` and a
   one-minute rebuild.
2. **Deploy and push?** Say the word and I'll push to `renocrypt/catch-the-homewrecker` and redeploy Pages. 28 MB of
   models is fine for Pages; first load is a few seconds on a normal connection.
3. **Props** (plants, Eames chairs, sofa, laptop, mug, all CC BY): the shortlist is in the chat. Downloading needs your
   logged-in Sketchfab, so I left it for when you're around.
4. **The 0:11 wrist grab** never connected, old figures included: Xue and the receptionist stand ~0.5 m too far apart
   across the counter. Moving one of them in `blocking.js` fixes it; your call on which.

## Known small things

- A raised arm in the green coat shows a maroon sliver at the shoulder (the lining is painted with the shirt).
- Iris textures look reddish in Blender's preview renders only; in the scene they're dark brown.

## Rebuilding

    tools/build_models.sh M            # needs Blender + MPFB in ~/.cache/blender-mpfb, run outside the sandbox
    PREVIEW=1 tools/build_models.sh M  # also renders .design/mpfb/M-{full,face,side}.png
    ... characters.py -- M --hair <folder> --preview <dir>   # try another hairstyle
