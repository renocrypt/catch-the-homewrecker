"""Build cast members with MPFB (MakeHuman for Blender): render previews and export glTF for the web scene.

    export BLENDER_USER_RESOURCES=~/.cache/blender-mpfb/user      # MPFB + asset packs live here, not in your Blender config
    B=/Applications/Blender.app/Contents/MacOS/Blender
    $B -b --python tools/characters.py -- M --preview .design/mpfb              # full / face / side renders
    $B -b --python tools/characters.py -- M --preview .design/mpfb --expr angry # with an expression
    $B -b --python tools/characters.py -- M --glb models/M.glb                  # export for the scene

Needs Metal, so run outside the sandbox. Asset packs (CC0, static.makehumancommunity.org): makehuman_system_assets, hair01,
suits01, shirts01, pants01, dress01, shoes01, eyebrows01, eyelashes01, skins01/02, faceunits01 — unzipped into MPFB's
user data dir (Blender's extension user path for mpfb, then data/).

Every recolour is painted into a copy of the garment's texture (no shader tricks), so what the preview shows is what the
glTF carries. Body and face sliders are baked into the mesh on export; only the ARKit face units in FACE_UNITS survive as
morph targets.
"""
import bpy, sys, os, argparse, json
import numpy as np
from mathutils import Vector
from bl_ext.user_default.mpfb.services import HumanService, TargetService, FaceService, LocationService, ExportService

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
DATA = LocationService.get_user_data()
TARGETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(sys.modules[HumanService.__module__].__file__))), "data", "targets")

# ARKit face units the scene drives (src/actors.js); everything else is baked or dropped
FACE_UNITS = ["browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "eyeBlinkLeft", "eyeBlinkRight",
              "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight", "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker",
              "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight", "mouthStretchLeft", "mouthStretchRight",
              "mouthUpperUpLeft", "mouthUpperUpRight", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight",
              "noseSneerLeft", "noseSneerRight", "cheekSquintLeft", "cheekSquintRight", "cheekPuff",
              "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeLookDownLeft", "eyeLookDownRight"]

def rgb(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])

# ── texture painters: (h, w, 4) sRGB floats, row 0 = bottom → new pixels. Factories return a painter for one garment's layout.
def _parts(px):
    h, w = px.shape[:2]; c = px[..., :3]; mx = c.max(-1); sat = (mx - c.min(-1)) / np.maximum(mx, 1e-4)
    ys, xs = np.mgrid[0:h, 0:w]
    hue = np.degrees(np.arctan2(np.sqrt(3) * (c[..., 1] - c[..., 2]), 2 * c[..., 0] - c[..., 1] - c[..., 2])) % 360
    return c, mx, sat, hue, xs / w, 1 - ys / h          # t runs top-down, as in an image viewer

def _shade(mx, m, lo=0.0, hi=9.0):
    return np.clip(mx / max(np.median(mx[m]), 1e-3), lo, hi)[..., None] if m.any() else 1

def _tweed(h, w, base, light, dark, seed=3, block=4):
    """Flecks in `block`-pixel cells: garment textures are halved on export, so 4 px here are crisp 2 px in the scene."""
    n = np.random.default_rng(seed).random((h // block + 1, w // block + 1)).repeat(block, 0).repeat(block, 1)[:h, :w]
    return np.where((n > 0.94)[..., None], rgb(light), np.where((n < 0.05)[..., None], rgb(dark), rgb(base)))

def suit2(jacket, pants, shirt, buttons="#17161a", tweed=None):
    """toigo_female_suit_2: magenta jacket and trouser panels (trousers are the left quarter), a white shirt with a floral
    tie and pocket square in the same texture. tweed=(light, dark) flecks the jacket."""
    def f(px):
        c, mx, sat, hue, u, t = _parts(px); h, w = px.shape[:2]
        suit = (sat > 0.3) & (c[..., 1] < c[..., 0]) & (c[..., 1] < c[..., 2]); white = (sat < 0.2) & (mx > 0.55)
        tie = (sat > 0.2) & ((hue < 270) | (hue > 340)) & (u > 0.7) & (t < 0.5)
        btn = (u > 0.555) & (u < 0.705) & (t > 0.03) & (t < 0.105)
        legs = (u < 0.245) | ((u > 0.31) & (u < 0.52) & (t > 0.16) & (t < 0.225))   # trouser panels, and the two hem facings
        jk = suit & ~legs & ~btn; out = px.copy()
        cloth = _tweed(h, w, jacket, *tweed) if tweed else rgb(jacket)
        out[..., :3] = np.where(jk[..., None], cloth * _shade(mx, jk), out[..., :3])
        out[..., :3] = np.where((suit & legs)[..., None], rgb(pants) * _shade(mx, suit & legs), out[..., :3])
        out[..., :3] = np.where((white & ~legs)[..., None], rgb(shirt) * _shade(mx, white, 0.6, 1.25), out[..., :3])
        tie_island = ((u > 0.86) & (u < 0.945) & (t < 0.28)) | ((u > 0.825) & (u < 0.9) & (t > 0.43) & (t < 0.47))   # tie and pocket square, flowers and all
        out[..., :3] = np.where(((tie & ~legs) | tie_island)[..., None], rgb(shirt) * 0.92, out[..., :3])   # the tie vanishes into the top
        out[..., :3] = np.where(btn[..., None], rgb(buttons) * _shade(mx, btn), out[..., :3])
        return np.clip(out, 0, 1)
    f.__name__ = f"suit2-{jacket[1:]}"; return f

def fsuit(cloth, blouse):
    """toigo_female_suit: dark pinstripe jacket and skirt, a white ruffled blouse front; the cameo and its gold frame stay."""
    def f(px):
        c, mx, sat, hue, u, t = _parts(px); out = px.copy()
        cameo = (u > 0.72) & (t > 0.25) & (t < 0.92)
        dark = (mx < 0.45) & ~cameo; light = (mx > 0.7) & (sat < 0.15) & ~cameo
        out[..., :3] = np.where(dark[..., None], rgb(cloth) * _shade(mx, dark, 0.5, 1.6), out[..., :3])
        out[..., :3] = np.where(light[..., None], rgb(blouse) * _shade(mx, light, 0.75, 1.1), out[..., :3])
        return np.clip(out, 0, 1)
    f.__name__ = f"fsuit-{cloth[1:]}"; return f

def msuit3(cloth, shirt, tie):
    """toigo_male_suit_3: navy jacket and trousers, a pale shirt front and collar, a red tie."""
    def f(px):
        c, mx, sat, hue, u, t = _parts(px); out = px.copy()
        red = (sat > 0.35) & ((hue < 30) | (hue > 330)); pale = (mx > 0.6) & (sat < 0.35) & ~red
        cloth_m = ~red & ~pale & ((hue > 190) & (hue < 260) | (mx < 0.35))
        out[..., :3] = np.where(cloth_m[..., None], rgb(cloth) * _shade(mx, cloth_m, 0.5, 1.6), out[..., :3])
        out[..., :3] = np.where(pale[..., None], rgb(shirt) * _shade(mx, pale, 0.75, 1.1), out[..., :3])
        out[..., :3] = np.where(red[..., None], rgb(tie) * _shade(mx, red, 0.6, 1.4), out[..., :3])
        return np.clip(out, 0, 1)
    f.__name__ = f"msuit3-{cloth[1:]}"; return f

def flat(color, keep=0.25):
    """A plain fabric: the original's weave flattened to `keep` of its light and shade (silk, crepe)."""
    def f(px):
        c, mx, sat, hue, u, t = _parts(px); out = px.copy(); cloth = mx > 0.03
        s = 1 + (_shade(mx, cloth) - 1) * keep
        out[..., :3] = np.where(cloth[..., None], rgb(color) * s, out[..., :3])
        return np.clip(out, 0, 1)
    f.__name__ = f"flat-{color[1:]}"; return f

def stripes(base, line, period=40, width=0.3):
    """A shirting stripe: lines of `line` on `base` every `period` texture pixels, keeping a little of the weave's shade."""
    def f(px):
        c, mx, sat, hue, u, t = _parts(px); h, w = px.shape[:2]; out = px.copy(); cloth = mx > 0.03
        on = ((u * w / period) % 1 < width)[..., None]
        s_ = 1 + (_shade(mx, cloth) - 1) * 0.25
        out[..., :3] = np.where(cloth[..., None], np.where(on, rgb(line), rgb(base)) * s_, out[..., :3])
        return np.clip(out, 0, 1)
    f.__name__ = f"stripes-{line[1:]}"; return f

def twotone(top, skirt, split=0.5):
    """toigo_shift_dress as a top and a skirt: its two panels painted `top` above `split` (down the panel) and `skirt` below."""
    def f(px):
        c, mx, sat, hue, u, t = _parts(px); out = px.copy()
        panel = (mx < 0.4) & (t > 0.06)
        s_ = 1 + (_shade(mx, panel) - 1) * 0.35
        out[..., :3] = np.where(panel[..., None], np.where((t < split)[..., None], rgb(top), rgb(skirt)) * s_, out[..., :3])
        return np.clip(out, 0, 1)
    f.__name__ = f"twotone-{top[1:]}-{skirt[1:]}"; return f

def tinter(color, mode):
    """MULTIPLY darkens toward `color`; COLOR takes its hue and saturation and keeps the texture's light and shade."""
    target = rgb(color)
    def f(px):
        out = px.copy(); c = px[..., :3]
        if mode == "MULTIPLY": out[..., :3] = c * target
        else: lum = c @ np.array([0.299, 0.587, 0.114]); out[..., :3] = target * (lum / max(target @ np.array([0.299, 0.587, 0.114]), 1e-3))[..., None]
        return np.clip(out, 0, 1)
    f.__name__ = f"{mode.lower()}-{color[1:]}"; return f

# crowd members are seen small and soft: fewer units, smaller textures, no teeth
CROWD_UNITS = ["eyeBlinkLeft", "eyeBlinkRight", "jawOpen", "browInnerUp", "browDownLeft", "browDownRight", "mouthSmileLeft", "mouthSmileRight"]
ASIAN = dict(asian=1.0, caucasian=0.0, african=0.0)

def crowd_man(age, weight, height, skin, hair, hair_tint, suit, shirt, tie, muscle=0.5, **kw):
    return dict(macro=dict(gender=1.0, age=age, muscle=muscle, weight=weight, proportions=0.55, height=height, race=ASIAN), detail=kw.pop("detail", {}),
                skin=skin, eyes="brown", hair=(hair, hair_tint, kw.pop("hair_mode", "MULTIPLY")), eyebrows=(kw.pop("brows", "mindfront_eyebrows_06"), "#d8d0cc", "MULTIPLY"),
                eyelashes="eyelashes01", clothes=[("toigo_male_suit_3", msuit3(suit, shirt, tie), "PAINT"), ("shoes04", "#141416", "MULTIPLY")], crowd=True, **kw)

def crowd_woman(age, weight, height, skin, hair, hair_tint, clothes, shoes="#141416", cup=0.45, **kw):
    return dict(macro=dict(gender=0.0, age=age, muscle=0.38, weight=weight, proportions=0.6, height=height, cupsize=cup, firmness=0.55, race=ASIAN),
                detail=kw.pop("detail", {}), skin=skin, eyes="brown", hair=(hair, hair_tint, kw.pop("hair_mode", "MULTIPLY")),
                eyebrows=(kw.pop("brows", "mindfront_eyebrows_02"), "#d8d0cc", "MULTIPLY"), eyelashes="eyelashes02",
                clothes=clothes + [("toigo_ballet_flats", shoes, "COLOR" if rgb(shoes).mean() > 0.4 else "MULTIPLY")], crowd=True, **kw)

def top_skirt(top, skirt, midi=False):
    """Top and skirt: a two-tone shift dress (one garment, nothing to poke through), or for a long skirt a knit over a midi dress."""
    if midi: return [("toigo_halter_dress_midi", flat(skirt, 0.35), "PAINT"), ("toigo_fisherman_sweater", flat(top, 0.25), "PAINT")]
    return [("toigo_shift_dress", twotone(top, skirt), "PAINT")]

ARMS = {"arms/measure-upperarm-length-incr": 0.35, "arms/measure-lowerarm-length-incr": 0.35}

# The default female mouth is full with drooping corners and reads as a pout in the scene's light: slimmer, flatter lips.
LIPS = {"mouth/mouth-angles-up": 0.4, "mouth/mouth-lowerlip-volume-decr": 0.3, "mouth/mouth-upperlip-volume-decr": 0.25, "mouth/mouth-scale-depth-decr": 0.3}

# ── the cast. macro: MakeHuman sliders (0..1; age 0.5 = 25 years, 1.0 = 90). detail: target -> weight. Assets by folder name;
# a garment is "name", ("name", "#rrggbb", "COLOR" | "MULTIPLY") or ("name", painter, "PAINT").
CAST = {
    "M": dict(  # 薛珍珠: sixty-ish Shanghai mother, short and stocky, round full face, tight perm, green coat over a maroon top
        macro=dict(gender=0.0, age=0.72, muscle=0.42, weight=0.8, proportions=0.35, height=0.42, cupsize=0.62, firmness=0.3,
                   race=dict(asian=1.0, caucasian=0.0, african=0.0)),
        # face from the stills: a broad oval with high, full cheekbones and a small chin; large, wide-open eyes with a light inner
        # fold; thin arched brows; a wide mouth. Smooth, well-kept skin (middle-aged texture).
        detail={"head/head-oval": 0.5,
                "cheek/l-cheek-bones-incr": 0.4, "cheek/r-cheek-bones-incr": 0.4, "cheek/l-cheek-volume-incr": 0.5, "cheek/r-cheek-volume-incr": 0.5,
                "chin/chin-width-decr": 0.15, "chin/chin-prominent-incr": 0.2, "chin/chin-height-incr": 0.15,
                "eyes/l-eye-scale-incr": 0.7, "eyes/r-eye-scale-incr": 0.7, "eyes/l-eye-height2-incr": 0.6, "eyes/r-eye-height2-incr": 0.6,
                "eyes/l-eye-epicanthus-out": 0.6, "eyes/r-eye-epicanthus-out": 0.6, "eyes/l-eye-corner2-down": 0.2, "eyes/r-eye-corner2-down": 0.2,
                "eyebrows/eyebrows-angle-up": 0.7, "eyebrows/eyebrows-trans-up": 0.3,
                "mouth/mouth-scale-horiz-incr": 0.15, "mouth/mouth-angles-up": 0.2, "mouth/mouth-upperlip-volume-decr": 0.35, "mouth/mouth-lowerlip-volume-decr": 0.4,
                "arms/measure-upperarm-length-incr": 0.6, "arms/measure-lowerarm-length-incr": 0.6},
        skin="middleage_asian_female", eyes="brown", hair=("afro01", "#3a3436", "MULTIPLY"), eyebrows=("mindfront_eyebrows_09", "#d8d0cc", "MULTIPLY"),
        eyelashes="eyelashes01", clothes=[("toigo_female_suit_2", suit2("#1f5a45", "#2c1119", "#6b1728", tweed=("#4d8a6a", "#163d2f")), "PAINT"), "toigo_mj_cloth_shoes"]),
    "E": dict(  # 凌玲: mid-thirties, slight, long neck, sloping shoulders; ivory silk top, long cream skirt, short dark bob
        macro=dict(gender=0.0, age=0.57, muscle=0.38, weight=0.28, proportions=0.75, height=0.6, cupsize=0.42, firmness=0.6,
                   race=dict(asian=1.0, caucasian=0.0, african=0.0)),
        # face from the stills: a soft, full oval; large eyes with the outer corners dipping and the inner brows a touch
        # raised (the innocent, wronged look); a small, soft mouth
        detail={"head/head-oval": 0.4, "cheek/l-cheek-volume-incr": 0.35, "cheek/r-cheek-volume-incr": 0.35, "chin/chin-width-decr": 0.1,
                "eyes/l-eye-scale-incr": 0.5, "eyes/r-eye-scale-incr": 0.5, "eyes/l-eye-height2-incr": 0.4, "eyes/r-eye-height2-incr": 0.4,
                "eyes/l-eye-epicanthus-out": 0.5, "eyes/r-eye-epicanthus-out": 0.5, "eyes/l-eye-corner2-down": 0.35, "eyes/r-eye-corner2-down": 0.35,
                "eyebrows/eyebrows-angle-down": 0.2,
                "mouth/mouth-scale-horiz-decr": 0.2, "mouth/mouth-upperlip-volume-decr": 0.25, "mouth/mouth-lowerlip-volume-decr": 0.3, "mouth/mouth-angles-up": 0.3,
                "neck/measure-neck-height-incr": 0.35, "arms/measure-upperarm-length-incr": 0.4, "arms/measure-lowerarm-length-incr": 0.4},
        skin="young_asian_female", eyes="brown", hair=("toigo_blunt_bob", "#2e2724", "MULTIPLY"), eyebrows=("mindfront_eyebrows_04", "#d8d0cc", "MULTIPLY"),
        eyelashes="eyelashes02", clothes=[("toigo_halter_dress_midi", flat("#e3dccd", 0.3), "PAINT"), ("toigo_fisherman_sweater", flat("#efebe4", 0.2), "PAINT"),
                                          ("toigo_ballet_flats", "#d9c3a8", "COLOR")]),
    "R": dict(  # 前台: early twenties, narrow and timid; black jacket and skirt, white ruffle blouse, ponytail
        macro=dict(gender=0.0, age=0.5, muscle=0.35, weight=0.32, proportions=0.65, height=0.52, cupsize=0.4, firmness=0.6,
                   race=dict(asian=1.0, caucasian=0.0, african=0.0)),
        detail={"arms/measure-upperarm-length-incr": 0.4, "arms/measure-lowerarm-length-incr": 0.4, **LIPS},
        skin="young_asian_female", eyes="brown", hair=("ponytail01", "#1c1512", "MULTIPLY"), eyebrows=("mindfront_eyebrows_02", "#d8d0cc", "MULTIPLY"),
        eyelashes="eyelashes02", clothes=[("toigo_female_suit", fsuit("#17181b", "#f5f4f0"), "PAINT"), ("toigo_ballet_flats", "#141416", "MULTIPLY")]),
    "H": dict(  # 洪: about thirty, brisk and upright; black jacket and trousers over a mustard top, ponytail
        macro=dict(gender=0.0, age=0.53, muscle=0.45, weight=0.42, proportions=0.6, height=0.48, cupsize=0.45, firmness=0.55,
                   race=dict(asian=1.0, caucasian=0.0, african=0.0)),
        detail={"arms/measure-upperarm-length-incr": 0.4, "arms/measure-lowerarm-length-incr": 0.4, **LIPS},
        skin="young_asian_female", eyes="brown", hair=("ponytail01", "#1f1712", "MULTIPLY"), eyebrows=("mindfront_eyebrows_03", "#d8d0cc", "MULTIPLY"),
        eyelashes="eyelashes02", clothes=[("toigo_female_suit_2", suit2("#19191c", "#151517", "#c79d35"), "PAINT"), ("toigo_ballet_flats", "#141416", "MULTIPLY")]),
    "B": dict(  # 小董: mid-thirties, senior and composed; royal blue jacket, black top and trousers, soft waves
        macro=dict(gender=0.0, age=0.58, muscle=0.42, weight=0.4, proportions=0.65, height=0.62, cupsize=0.45, firmness=0.55,
                   race=dict(asian=1.0, caucasian=0.0, african=0.0)),
        detail={"arms/measure-upperarm-length-incr": 0.4, "arms/measure-lowerarm-length-incr": 0.4, **LIPS},
        skin="middleage_asian_female", eyes="brown", hair=("toigo_curled_under_bob", "#3a3433", "MULTIPLY"), eyebrows=("mindfront_eyebrows_12", "#d8d0cc", "MULTIPLY"),
        eyelashes="eyelashes02", clothes=[("toigo_female_suit_2", suit2("#1d3fbd", "#131316", "#101012"), "PAINT"), ("toigo_ballet_flats", "#141416", "MULTIPLY")]),
    "G1": dict(  # 保安: broad, thirties; navy uniform, pale blue shirt, dark tie (cap and badge are added in the scene)
        macro=dict(gender=1.0, age=0.55, muscle=0.65, weight=0.6, proportions=0.6, height=0.62, race=dict(asian=1.0, caucasian=0.0, african=0.0)),
        detail={"arms/measure-upperarm-length-incr": 0.3, "arms/measure-lowerarm-length-incr": 0.3},
        skin="middleage_asian_male", eyes="brown", hair=("short02", "#15110f", "MULTIPLY"), eyebrows=("mindfront_eyebrows_06", "#d8d0cc", "MULTIPLY"),
        eyelashes="eyelashes01", clothes=[("toigo_male_suit_3", msuit3("#1c2440", "#9fb4d8", "#141a30"), "PAINT"), ("shoes04", "#141416", "MULTIPLY")]),
    "G2": dict(  # the second guard: taller and leaner
        macro=dict(gender=1.0, age=0.52, muscle=0.6, weight=0.5, proportions=0.65, height=0.72, race=dict(asian=1.0, caucasian=0.0, african=0.0)),
        detail={"arms/measure-upperarm-length-incr": 0.3, "arms/measure-lowerarm-length-incr": 0.3},
        skin="middleage_asian_male", eyes="brown", hair=("short04", "#1b1512", "MULTIPLY"), eyebrows=("mindfront_eyebrows_08", "#d8d0cc", "MULTIPLY"),
        eyelashes="eyelashes01", clothes=[("toigo_male_suit_3", msuit3("#1c2440", "#9fb4d8", "#141a30"), "PAINT"), ("shoes04", "#141416", "MULTIPLY")]),
}

CAST.update({
    "c1": crowd_man(0.62, 0.55, 0.5, "middleage_asian_male", "short01", "#6a5a52", "#15161a", "#eef0f2", "#1b2a55", detail=ARMS),
    "c2": crowd_man(0.5, 0.55, 0.66, "young_asian_male", "short03", "#6a5a52", "#1a2848", "#f2f3f5", "#2d63cc", muscle=0.6, brows="mindfront_eyebrows_08", detail=ARMS),
    "c3": crowd_man(0.48, 0.45, 0.78, "young_asian_male", "short02", "#5a4a42", "#141416", "#e9e9e6", "#e9e9e6", detail=ARMS),
    "c4": crowd_man(0.8, 0.82, 0.45, "old_asian_male", "short04", "#8a8682", "#2b2d33", "#ecedee", "#3a3d46", hair_mode="COLOR", brows="mindfront_eyebrows_07", detail=ARMS),
    "c10": crowd_man(0.58, 0.72, 0.5, "middleage_asian_male", "short02", "#5a4a42", "#17171a", "#2a2a2e", "#2a2a2e", muscle=0.62, detail=ARMS),
    "a3": crowd_man(0.55, 0.5, 0.82, "middleage_asian_male", "short03", "#5a4a42", "#131315", "#f0f1f3", "#22232a", muscle=0.58, detail=ARMS),
    "L1": crowd_man(0.55, 0.55, 0.62, "middleage_asian_male", "short01", "#6a5a52", "#1a2132", "#f1f2f4", "#2a5fc4", brows="mindfront_eyebrows_08", detail=ARMS),
    "L2": crowd_man(0.65, 0.72, 0.7, "middleage_asian_male", "short04", "#5a4a42", "#141416", "#eceef0", "#30323a", detail=ARMS),
    "c5": crowd_woman(0.5, 0.35, 0.3, "young_asian_female", "rehmanpolanski_hair_bun_brown", "#4a3a33", top_skirt("#131114", "#62378a"), detail=ARMS),
    "c6": crowd_woman(0.56, 0.38, 0.65, "middleage_asian_female", "long01", "#4a3a33", [("toigo_female_suit", fsuit("#151518", "#8d8f96"), "PAINT")], brows="mindfront_eyebrows_03", detail=ARMS),
    "c7": crowd_woman(0.55, 0.55, 0.48, "middleage_asian_female", "long01", "#5a4136", [("toigo_female_suit_2", suit2("#676b73", "#2a2b30", "#ececea"), "PAINT")], cup=0.65, detail=ARMS),
    "c8": crowd_woman(0.5, 0.32, 0.38, "young_asian_female", "long01", "#8a5a40", top_skirt("#d9c8a7", "#dccdb0", midi=True), shoes="#c9b79a", brows="mindfront_eyebrows_01", detail=ARMS),
    "c9": crowd_woman(0.52, 0.4, 0.55, "young_asian_female", "rehmanpolanski_hair_bun_brown", "#3a2e2a",
                      [("toigo_wool_pants", flat("#8f8f8a", 0.4), "PAINT"), ("toigo_basic_tucked_t-shirt", stripes("#f4f6fa", "#7fa3d6"), "PAINT")], detail=ARMS),
    "c11": crowd_woman(0.5, 0.38, 0.45, "young_asian_female", "ponytail01", "#3a2e2a", [("toigo_female_suit", fsuit("#141416", "#f0efeb"), "PAINT")], detail=ARMS),
    "c12": crowd_woman(0.72, 0.65, 0.38, "middleage_asian_female", "long01", "#3a2e2a",
                       [("toigo_halter_dress_midi", flat("#c9bfa7", 0.35), "PAINT"), ("toigo_fisherman_sweater", flat("#8b9069", 0.35), "PAINT")], cup=0.62, brows="mindfront_eyebrows_04", detail=ARMS),
    "a1": crowd_woman(0.52, 0.36, 0.75, "young_asian_female", "rehmanpolanski_hair_bun_brown", "#3a2e2a",
                      [("toigo_wool_pants", flat("#a3a39c", 0.4), "PAINT"), ("toigo_basic_tucked_t-shirt", stripes("#f4f6fa", "#7fa3d6"), "PAINT")], detail=ARMS),
    "a2": crowd_woman(0.5, 0.33, 0.3, "young_asian_female", "long01", "#3a2e2a", top_skirt("#f1f0ea", "#121214"), detail=ARMS),
    "a4": crowd_woman(0.54, 0.5, 0.48, "middleage_asian_female", "long01", "#6a4a3a", top_skirt("#131316", "#1f3a44"), cup=0.6, brows="mindfront_eyebrows_03", detail=ARMS),
    "a5": crowd_woman(0.5, 0.36, 0.52, "young_asian_female", "ponytail01", "#3a2e2a", top_skirt("#f3f2ee", "#8a8a88"), detail=ARMS),
})

EXPR = {  # preview expressions, ARKit units 0..1
    "angry": {"browDownLeft": 0.95, "browDownRight": 0.95, "eyeSquintLeft": 0.45, "eyeSquintRight": 0.45, "noseSneerLeft": 0.55, "noseSneerRight": 0.55,
              "jawOpen": 0.42, "mouthUpperUpLeft": 0.45, "mouthUpperUpRight": 0.45, "mouthLowerDownLeft": 0.35, "mouthLowerDownRight": 0.35,
              "mouthStretchLeft": 0.3, "mouthStretchRight": 0.3, "cheekSquintLeft": 0.35, "cheekSquintRight": 0.35},
}

def find(kind, name, ext):
    d = os.path.join(DATA, kind, name)
    return next(os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith(ext))

def base_texture_node(mat):
    """The image node that feeds the material's base colour, through any nodes in between."""
    nt = mat.node_tree if mat else None
    bsdf = nt and next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    base = bsdf and bsdf.inputs["Base Color"]
    node = base and base.is_linked and base.links[0].from_node
    while node and node.type != "TEX_IMAGE" and any(i.is_linked for i in node.inputs):
        node = next(i.links[0].from_node for i in node.inputs if i.is_linked)
    return node if node and node.type == "TEX_IMAGE" else None

def repaint(obj, fn, tag, outdir, opaque=False):
    for slot in obj.material_slots:
        node = base_texture_node(slot.material)
        if not node: continue
        img = node.image; w, h = img.size; px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
        out = fn(px.reshape(h, w, 4)).astype(np.float32)
        if opaque: out[..., 3] = 1.0   # knits and lace come with holes in their alpha; the scene draws cloth solid
        new = bpy.data.images.new(tag, w, h, alpha=True); new.pixels.foreach_set(out.ravel())
        os.makedirs(outdir, exist_ok=True); new.filepath_raw = os.path.join(outdir, tag + ".png"); new.file_format = "PNG"; new.save()
        node.image = new

def dress(human, item, kind, outdir):
    name, how, mode = (item, None, None) if isinstance(item, str) else item
    obj = HumanService.add_mhclo_asset(find(kind.lower(), name, ".mhclo"), human, asset_type=kind, subdiv_levels=0)
    for slot in obj.material_slots:   # "<Kind>.<asset>": the scene tells hair cards from cloth by this name
        if slot.material: slot.material.name = f"{kind}.{name}"
    if mode == "PAINT": repaint(obj, how, f"{name}-{how.__name__}", outdir, opaque=kind == "Clothes")
    elif mode: fn = tinter(how, mode); repaint(obj, fn, f"{name}-{fn.__name__}", outdir, opaque=kind == "Clothes")
    return obj

def build(spec, outdir):
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    human = HumanService.create_human(macro_detail_dict=spec["macro"])
    for name, w in spec["detail"].items():
        path = os.path.join(TARGETS, name + ".target.gz")
        if os.path.exists(path): TargetService.load_target(human, path, weight=w)
        else: print("missing target", name)
    HumanService.set_character_skin(find("skins", spec["skin"], ".mhmat"), human, skin_type="MAKESKIN")
    HumanService.add_builtin_rig(human, "game_engine")   # before any asset, so each one is weighted to the rig as it is fitted
    # low-poly eyes: the high-poly set adds a cornea shell that only works as a transparent layer, and its UVs don't fit these irises
    eyes = HumanService.add_mhclo_asset(find("eyes", "low-poly", ".mhclo"), human, asset_type="Eyes", subdiv_levels=0)
    node = base_texture_node(eyes.material_slots[0].material) if eyes.material_slots else None
    if node: node.image = bpy.data.images.load(os.path.join(DATA, "eyes", "materials", spec["eyes"] + "_eye.png"))
    dress(human, spec["eyebrows"], "Eyebrows", outdir); dress(human, spec["eyelashes"], "Eyelashes", outdir)
    if not spec.get("crowd"): dress(human, "teeth_base", "Teeth", outdir); dress(human, "tongue01", "Tongue", outdir)
    dress(human, spec["hair"], "Hair", outdir)
    worn = [(c if isinstance(c, str) else c[0], dress(human, c, "Clothes", outdir)) for c in spec["clothes"]]
    FaceService.load_targets(human, load_microsoft_visemes=False, load_arkit_faceunits=True)
    # brows, lashes, teeth and tongue follow the face units. MPFB looks for them under the basemesh's parent (the rig), but
    # they hang off the basemesh itself, so detach it for the call and put it back.
    rig, inv = human.parent, human.matrix_parent_inverse.copy()
    human.parent = None; FaceService.interpolate_targets(human); human.parent = rig; human.matrix_parent_inverse = inv
    for name, obj in worn:
        if name in CUT: print("cut", name, drop_uv_faces(obj, CUT[name]), "faces")
    return human

# Garment parts nobody in the scene wears, cut out of the mesh by UV box (u0, u1, t0, t1; t from the top of the texture).
CUT = {"toigo_female_suit_2": [(0.85, 0.95, 0.0, 0.28)]}   # the necktie: Xue, Hong and Dong wear open-necked tops

def drop_uv_faces(obj, boxes):
    import bmesh
    for o in bpy.context.selected_objects: o.select_set(False)
    bpy.context.view_layer.objects.active = obj; obj.select_set(True); bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(obj.data); uv = bm.loops.layers.uv.active; n = 0
    for f in bm.faces:
        u = sum(l[uv].uv.x for l in f.loops) / len(f.loops); t = 1 - sum(l[uv].uv.y for l in f.loops) / len(f.loops)
        f.select_set(any(u0 < u < u1 and t0 < t < t1 for u0, u1, t0, t1 in boxes)); n += f.select
    bmesh.update_edit_mesh(obj.data); bpy.ops.mesh.delete(type="FACE"); bpy.ops.object.mode_set(mode="OBJECT"); obj.select_set(False)
    return n

def bake_keep(obj, keep):
    """Bake every shape key into the mesh except `keep`, which are re-based onto the baked shape."""
    kb = obj.data.shape_keys.key_blocks; n = len(obj.data.vertices)
    def co(k): a = np.empty(n * 3, np.float32); k.data.foreach_get("co", a); return a
    b0 = co(kb[0]); deltas = {k.name: co(k) - b0 for k in kb if k.name in keep}
    for k in kb:
        if k.name in keep: k.value = 0.0
    mix = co(obj.shape_key_add(name="__mix", from_mix=True))
    obj.shape_key_clear(); obj.data.vertices.foreach_set("co", mix); obj.data.update()
    obj.shape_key_add(name="Basis")
    for name in keep:
        if name in deltas and np.abs(deltas[name]).max() > 1e-6: obj.shape_key_add(name=name, from_mix=False).data.foreach_set("co", mix + deltas[name])
    print("kept face units:", len(obj.data.shape_keys.key_blocks) - 1)

def export(human, path, crowd=False):
    units = CROWD_UNITS if crowd else FACE_UNITS
    bake_keep(human, units)
    subdiv = not crowd   # principals are seen close: one level of subdivision on the body and the cloth
    keep = set(units)
    for o in bpy.data.objects:   # child meshes: only the driven units, and none at all if nothing moves
        if o is human or o.type != "MESH" or not o.data.shape_keys: continue
        for kb in list(o.data.shape_keys.key_blocks)[1:]:
            if kb.name not in keep: o.shape_key_remove(kb)
        if len(o.data.shape_keys.key_blocks) <= 1: o.shape_key_clear()
    if subdiv:
        m = human.modifiers.new("Subdivision", "SUBSURF"); m.levels = m.render_levels = 1
    ExportService.bake_modifiers_remove_helpers(human, bake_masks=True, bake_subdiv=subdiv, remove_helpers=True)
    if subdiv:
        for o in bpy.data.objects:   # garments have no shape keys left, so a plain apply does
            if o.type != "MESH" or o is human or o.data.shape_keys or not any(s.material and s.material.name.startswith("Clothes.") for s in o.material_slots): continue
            bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
            m = o.modifiers.new("Subdivision", "SUBSURF"); m.levels = m.render_levels = 1
            bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0); bpy.ops.object.modifier_apply(modifier=m.name)
    def images_of(objs): return {n.image for o in objs for slot in o.material_slots if slot.material and slot.material.node_tree for n in slot.material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image}
    skin_imgs = images_of([human])
    hair_imgs = images_of([o for o in bpy.data.objects if o.type == "MESH" and any(sl.material and sl.material.name.startswith("Hair.") for sl in o.material_slots)])
    for img in bpy.data.images:   # the skin carries the face in close-ups; everything else can be smaller
        if not img.size[0]: continue
        skin = img in skin_imgs
        cap = (1024 if skin else 512) if crowd else (2048 if skin or img in hair_imgs else 1024)   # close-ups show face and hair
        if img.size[0] > cap: img.scale(cap, int(img.size[1] * cap / img.size[0]))
    for mat in bpy.data.materials:   # the scene sets roughness itself and drops spec maps, so don't ship them
        if not mat.node_tree: continue
        for link in list(mat.node_tree.links):
            if link.to_node.type == "BSDF_PRINCIPLED" and link.to_socket.name in ("Metallic", "Roughness", "Specular IOR Level", "Specular Tint"):
                mat.node_tree.links.remove(link)
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type in ("ARMATURE", "MESH"): o.select_set(True)   # body, clothes, hair, eyes, teeth: everything but preview lights
    for o in bpy.data.objects:   # MPFB leaves baked keys at 1; the glTF would start with every face unit fully on
        if o.type == "MESH" and o.data.shape_keys:
            for kb in o.data.shape_keys.key_blocks: kb.value = 0.0
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_morph=True,
                              export_morph_normal=False, export_skins=True, export_animations=False, export_image_format="WEBP",
                              export_image_quality=82, export_try_sparse_sk=True, export_yup=True)
    print("exported", path, f"{os.path.getsize(path) / 1e6:.1f} MB")

def preview(human, outdir, tag, expr):
    if expr:
        for kb in human.data.shape_keys.key_blocks:
            for unit, v in EXPR[expr].items():
                if kb.name == unit: kb.value = v
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try: sc.render.engine = eng; break
        except TypeError: pass
    sc.render.resolution_x, sc.render.resolution_y = 900, 1200; sc.view_settings.view_transform = "AgX"
    world = sc.world or bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
    bg = world.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.78, 0.79, 0.8, 1); bg.inputs[1].default_value = 0.45
    for name, loc, energy, size in (("key", (2.2, -3.0, 3.2), 520, 2.5), ("fill", (-2.8, -1.8, 2.0), 200, 3.0), ("rim", (0.5, 2.8, 2.8), 380, 2.0)):
        l = bpy.data.lights.new(name, "AREA"); l.energy = energy; l.size = size; o = bpy.data.objects.new(name, l); o.location = loc; sc.collection.objects.link(o)
        o.rotation_euler = (Vector((0, 0, 1.0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    h = max((o.matrix_world @ Vector(c)).z for o in sc.objects if o.type == "MESH" for c in o.bound_box)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    for view, eye, at, lens in (("full", (1.3, -3.6, h * 0.62), (0, 0, h * 0.5), 50), ("face", (0.22, -0.95, h * 0.93), (0, 0, h * 0.92), 85), ("side", (3.6, 0.0, h * 0.6), (0, 0, h * 0.5), 50)):
        cam.location = eye; cam.data.lens = lens; cam.rotation_euler = (Vector(at) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(outdir, f"{tag}-{view}{'-' + expr if expr else ''}.png"); bpy.ops.render.render(write_still=True)
    print("previews written to", outdir)

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(); ap.add_argument("id"); ap.add_argument("--preview"); ap.add_argument("--glb"); ap.add_argument("--expr")
    ap.add_argument("--hair", help="try another hairstyle (asset folder name), keeping the colour")
    ap.add_argument("--detail", help='try extra targets, JSON: \'{"mouth/mouth-angles-up": 0.4}\'')
    ap.add_argument("--tag", help="preview file prefix (default: the id)")
    args = ap.parse_args(argv)
    tex = os.path.join(ROOT, ".design", "mpfb", "tex")
    spec = dict(CAST[args.id])
    if args.hair: spec["hair"] = (args.hair,) + tuple(spec["hair"][1:]) if isinstance(spec["hair"], tuple) else args.hair
    if args.detail: spec["detail"] = {**spec.get("detail", {}), **json.loads(args.detail)}
    human = build(spec, tex)
    if args.preview: os.makedirs(args.preview, exist_ok=True); preview(human, args.preview, args.tag or args.id, args.expr)
    if args.glb: export(human, args.glb, crowd=CAST[args.id].get("crowd", False))
