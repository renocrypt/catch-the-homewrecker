"""Clean MakeHuman skin textures for real-time lighting (pure numpy; used by characters.py inside Blender).

The skins are photo-sourced: shading is baked into the face (dark beside the nose, under the cheekbones, round the
mouth) and the scalp carries a grey-brown stubble that reaches the temples and sideburns. Under the scene's own lights
that reads as dirt. clean() works on the head island of the shared MakeHuman UV layout:

  1. stubble (dark and grainy) is found and blended toward the surrounding skin tone,
  2. the mid-scale mottling of the face (1-3 cm) is divided out, keeping pores and the overall tone,
  3. lips, eyes, nostrils and ear canals are left as they are.

px is float32 [rows, cols, 4] with row 0 at the BOTTOM (Blender's pixel order); u, v as in the UV editor.
"""
import numpy as np

HEAD = (0.70, 1.0, 0.13, 0.86)   # u0, u1, v0, v1 of the head island in the MakeHuman layout


def blur(a, s):
    """Gaussian-ish blur (three box passes) of a 2D or 3D array along the first two axes, radius ~ s pixels."""
    r = max(1, int(round(s * 0.87)))
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if i == ax else (0, 0) for i in range(a.ndim)], mode="edge"), axis=ax, dtype=np.float64)
            hi = np.take(c, np.arange(2 * r + 1, c.shape[ax]), axis=ax); lo = np.take(c, np.arange(0, c.shape[ax] - 2 * r - 1), axis=ax)
            a = ((hi - lo) / (2 * r + 1)).astype(np.float32)
    return a


def nblur(a, w, s):
    """blur of a weighted by w (normalized convolution): features with w = 0 don't bleed into their surroundings"""
    return blur(a * w[..., None], s) / np.maximum(blur(w, s), 1e-4)[..., None]


# kept as painted (u, v, radius): eyes, mouth, nose, ears. Positions are the shared MakeHuman layout.
KEEP = [(0.836, 0.444, 0.017), (0.836, 0.522, 0.017), (0.909, 0.487, 0.03), (0.875, 0.484, 0.014), (0.851, 0.346, 0.038), (0.851, 0.62, 0.038)]


def clean(px, grain_keep=0.6, debug=None):
    h, w = px.shape[:2]; k = w / 2048.0
    u0, u1, v0, v1 = HEAD
    r0, r1, c0, c1 = int(v0 * h), int(v1 * h), int(u0 * w), int(u1 * w)
    t = px[r0:r1, c0:c1, :3].astype(np.float32)
    L = t @ np.array([0.299, 0.587, 0.114], np.float32)
    vv, uu = np.meshgrid((np.arange(r0, r1) + 0.5) / h, (np.arange(c0, c1) + 0.5) / w, indexing="ij")
    keep = np.zeros_like(L)
    for cu, cv, r in KEEP: keep = np.maximum(keep, np.clip((r - np.hypot(uu - cu, vv - cv)) / (0.35 * r), 0, 1))
    # stubble: grain (local spread of the fine detail) on darker skin
    hp = L - blur(L, 2 * k); grain = np.sqrt(blur(hp * hp, 6 * k))
    Lm = blur(L, 6 * k); skin_ref = np.percentile(Lm, 75)
    stub = np.clip((grain - 0.012) / 0.012, 0, 1) * np.clip((skin_ref - Lm) / 0.08, 0, 1)
    stub = np.clip(blur(stub, 10 * k) * 1.6, 0, 1) * (1 - keep)
    wgt = (1 - keep) * (1 - stub)   # what the skin tone is taken from
    # the face becomes one even skin tone (only the widest variation survives) carrying the original's finest grain:
    # under real lights any baked light and dark reads as dirt, and the geometry already shades the face
    tone = nblur(t, wgt, 90 * k)
    fine = t / np.maximum(blur(t, 2.5 * k), 1e-3)
    out = tone * (1 + (fine - 1) * grain_keep)
    # deep in the scalp the stubble stays: it fills the gaps between hair cards, where skin would look bald
    deep = np.clip((blur(stub, 45 * k) - 0.85) / 0.12, 0, 1)[..., None]
    out = out * (1 - deep) + t * deep
    out = out * (1 - keep[..., None]) + t * keep[..., None]
    res = px.copy(); res[r0:r1, c0:c1, :3] = np.clip(out, 0, 1)
    if debug is not None:
        debug["stub"], debug["feat"], debug["box"] = stub * (1 - deep[..., 0]), keep, (r0, r1, c0, c1)
    return res
