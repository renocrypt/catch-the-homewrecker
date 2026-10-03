# Credits

## Characters (`models/*.glb`)

Built with [MPFB](https://static.makehumancommunity.org/mpfb.html) (MakeHuman for Blender) by `tools/characters.py`.
MPFB itself (GPL-3.0) is a build tool and is not part of this site. Everything below comes from the MakeHuman community
asset packs and is released under **CC0**; MakeHuman's own output is CC0 as well. No attribution is required, but here
is where things come from:

- **Base mesh, eyes, teeth, tongue, skins** (`young_/middleage_/old_asian_female`, `…_asian_male`): MakeHuman system
  assets and skins01/skins02.
- **Face units** (ARKit-style shape keys): faceunits01.
- **Clothes** by Margaret Toigo (suits01, shirts01, pants01, dress01, shoes01): `toigo_female_suit`,
  `toigo_female_suit_2`, `toigo_male_suit_3`, `toigo_shift_dress`, `toigo_halter_dress_midi`, `toigo_fisherman_sweater`,
  `toigo_basic_tucked_t-shirt`, `toigo_wool_pants`, `toigo_ballet_flats`, `toigo_mj_cloth_shoes`; `shoes04` from shoes01.
  Colours and patterns are repainted per character.
- **Hair** (hair01): `afro01`, `short01`–`short04`, `long01`, `ponytail01`, `toigo_blunt_bob`, `toigo_curled_under_bob`,
  `rehmanpolanski_hair_bun_brown`.
- **Brows and lashes** (eyebrows01, eyelashes01): `eyebrow001`, `eyebrow005`, `eyelashes01`, `eyelashes02`.

## Libraries (`vendor/`)

- [three.js](https://threejs.org) r186, including `GLTFLoader` and the meshopt decoder (MIT).
- [anime.js](https://animejs.com) (MIT).

## Voices

Generated locally with Breeze TTS 2 and checked with Qwen3-ASR (see `tools/voice_lines.py`).
