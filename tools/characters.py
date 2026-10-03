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
import bpy, sys, os, argparse
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
              "noseSneerLeft", "noseSneerRight", "cheekSquintLeft", "cheekSquintRight", "cheekPuff"]

def rgb(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])

# ── texture painters: (h, w, 4) sRGB floats, row 0 = bottom → new pixels
def xue_suit(px):
    """toigo_female_suit_2 → 薛珍珠's outfit: jacket panels green tweed, trouser panels near-black maroon, the shirt (and the
    tie, which is part of the same mesh) her maroon top. The weave's light and shade is kept."""
    h, w = px.shape[:2]; c = px[..., :3]; mx = c.max(-1); sat = (mx - c.min(-1)) / np.maximum(mx, 1e-4)
    ys, xs = np.mgrid[0:h, 0:w]; u, t = xs / w, 1 - ys / h          # t runs top-down, as in an image viewer
    suit = (sat > 0.3) & (c[..., 1] < c[..., 0]) & (c[..., 1] < c[..., 2]); shirt = (sat < 0.2) & (mx > 0.55)
    hue = np.degrees(np.arctan2(np.sqrt(3) * (c[..., 1] - c[..., 2]), 2 * c[..., 0] - c[..., 1] - c[..., 2])) % 360
    tie = (sat > 0.2) & ((hue < 270) | (hue > 340)) & (u > 0.7) & (t < 0.5)   # the floral tie and pocket square: any hue but magenta
    buttons = (u > 0.555) & (u < 0.705) & (t > 0.03) & (t < 0.105)
    pants = u < 0.245
    shade = lambda m: (mx / max(np.median(mx[m]), 1e-3))[..., None] if m.any() else 1
    n = np.random.default_rng(3).random((h // 2 + 1, w // 2 + 1)).repeat(2, 0).repeat(2, 1)[:h, :w]   # tweed flecks, 2 px
    tweed = np.where((n > 0.94)[..., None], rgb("#4d8a6a"), np.where((n < 0.05)[..., None], rgb("#163d2f"), rgb("#1f5a45")))
    out = px.copy(); jacket = suit & ~pants & ~buttons
    out[..., :3] = np.where(jacket[..., None], tweed * shade(jacket), out[..., :3])
    out[..., :3] = np.where((suit & pants)[..., None], rgb("#2c1119") * shade(suit & pants), out[..., :3])
    out[..., :3] = np.where(((shirt | tie) & ~pants)[..., None], rgb("#6b1728") * np.clip(shade(shirt), 0.6, 1.25), out[..., :3])
    out[..., :3] = np.where(buttons[..., None], rgb("#17161a") * shade(buttons), out[..., :3])
    return np.clip(out, 0, 1)

def tinter(color, mode):
    """MULTIPLY darkens toward `color`; COLOR takes its hue and saturation and keeps the texture's light and shade."""
    target = rgb(color)
    def f(px):
        out = px.copy(); c = px[..., :3]
        if mode == "MULTIPLY": out[..., :3] = c * target
        else: lum = c @ np.array([0.299, 0.587, 0.114]); out[..., :3] = target * (lum / max(target @ np.array([0.299, 0.587, 0.114]), 1e-3))[..., None]
        return np.clip(out, 0, 1)
    return f

PAINTERS = {"xue_suit": xue_suit}

# ── the cast. macro: MakeHuman sliders (0..1; age 0.5 = 25 years, 1.0 = 90). detail: target -> weight. Assets by folder name;
# a garment is "name", ("name", "#rrggbb", "COLOR" | "MULTIPLY") or ("name", painter, "PAINT").
CAST = {
    "M": dict(  # 薛珍珠: sixty-ish Shanghai mother, short and stocky, round full face, tight perm, green coat over a maroon top
        macro=dict(gender=0.0, age=0.77, muscle=0.42, weight=0.8, proportions=0.35, height=0.42, cupsize=0.62, firmness=0.3,
                   race=dict(asian=1.0, caucasian=0.0, african=0.0)),
        detail={"head/head-oval": 0.5, "head/head-fat-incr": 0.6, "cheek/l-cheek-volume-incr": 0.5, "cheek/r-cheek-volume-incr": 0.5,
                "neck/neck-double-incr": 0.5, "neck/neck-scale-depth-incr": 0.3,
                "arms/measure-upperarm-length-incr": 0.6, "arms/measure-lowerarm-length-incr": 0.6},
        skin="old_asian_female", eyes="brown", hair=("afro01", "#3a3436", "MULTIPLY"), eyebrows=("eyebrow001", "#2a211d", "MULTIPLY"),
        eyelashes="eyelashes01", clothes=[("toigo_female_suit_2", "xue_suit", "PAINT"), "toigo_mj_cloth_shoes"]),
}

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

def repaint(obj, fn, tag, outdir):
    for slot in obj.material_slots:
        node = base_texture_node(slot.material)
        if not node: continue
        img = node.image; w, h = img.size; px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
        out = fn(px.reshape(h, w, 4)).astype(np.float32)
        new = bpy.data.images.new(tag, w, h, alpha=True); new.pixels.foreach_set(out.ravel())
        os.makedirs(outdir, exist_ok=True); new.filepath_raw = os.path.join(outdir, tag + ".png"); new.file_format = "PNG"; new.save()
        node.image = new

def dress(human, item, kind, outdir):
    name, how, mode = (item, None, None) if isinstance(item, str) else item
    obj = HumanService.add_mhclo_asset(find(kind.lower(), name, ".mhclo"), human, asset_type=kind, subdiv_levels=0)
    if mode == "PAINT": repaint(obj, PAINTERS[how], f"{name}-{how}", outdir)
    elif mode: repaint(obj, tinter(how, mode), f"{name}-{mode.lower()}", outdir)
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
    eyes = HumanService.add_mhclo_asset(find("eyes", "low-poly", ".mhclo"), human, asset_type="Eyes", subdiv_levels=0)
    node = base_texture_node(eyes.material_slots[0].material) if eyes.material_slots else None
    if node: node.image = bpy.data.images.load(os.path.join(DATA, "eyes", "materials", spec["eyes"] + "_eye.png"))
    dress(human, spec["eyebrows"], "Eyebrows", outdir); dress(human, spec["eyelashes"], "Eyelashes", outdir)
    dress(human, "teeth_base", "Teeth", outdir); dress(human, "tongue01", "Tongue", outdir)
    dress(human, spec["hair"], "Hair", outdir)
    for c in spec["clothes"]: dress(human, c, "Clothes", outdir)
    FaceService.load_targets(human, load_microsoft_visemes=False, load_arkit_faceunits=True)
    # brows, lashes, teeth and tongue follow the face units. MPFB looks for them under the basemesh's parent (the rig), but
    # they hang off the basemesh itself, so detach it for the call and put it back.
    rig, inv = human.parent, human.matrix_parent_inverse.copy()
    human.parent = None; FaceService.interpolate_targets(human); human.parent = rig; human.matrix_parent_inverse = inv
    return human

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

def export(human, path):
    bake_keep(human, FACE_UNITS)
    keep = set(FACE_UNITS)
    for o in bpy.data.objects:   # child meshes: only the driven units, and none at all if nothing moves
        if o is human or o.type != "MESH" or not o.data.shape_keys: continue
        for kb in list(o.data.shape_keys.key_blocks)[1:]:
            if kb.name not in keep: o.shape_key_remove(kb)
        if len(o.data.shape_keys.key_blocks) <= 1: o.shape_key_clear()
    ExportService.bake_modifiers_remove_helpers(human, bake_masks=True, bake_subdiv=False, remove_helpers=True)
    for img in bpy.data.images:   # the skin carries the face in close-ups; everything else can be smaller
        if not img.size[0]: continue
        cap = 2048 if "skin" in img.name.lower() or "female" in img.name.lower() else 1024
        if img.size[0] > cap: img.scale(cap, int(img.size[1] * cap / img.size[0]))
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
    args = ap.parse_args(argv)
    tex = os.path.join(ROOT, ".design", "mpfb", "tex")
    human = build(CAST[args.id], tex)
    if args.preview: os.makedirs(args.preview, exist_ok=True); preview(human, args.preview, args.id, args.expr)
    if args.glb: export(human, args.glb)
