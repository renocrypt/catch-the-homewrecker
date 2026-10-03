#!/bin/sh
# Build cast models: Blender + MPFB export (tools/characters.py), then meshopt compression with gltfpack.
#   tools/build_models.sh M E R          # these ids
#   PREVIEW=1 tools/build_models.sh M    # also render .design/mpfb/<id>-{full,face,side}.png
# Needs Metal (run outside the sandbox) and BLENDER_USER_RESOURCES pointing at the MPFB install (see characters.py).
set -eu
cd "$(dirname "$0")/.."
: "${BLENDER_USER_RESOURCES:=$HOME/.cache/blender-mpfb/user}"; export BLENDER_USER_RESOURCES
B=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
TMP=${TMPDIR:-/tmp}/cast-models; mkdir -p "$TMP" models
for id in "$@"; do
  extra=""; [ "${PREVIEW:-}" = 1 ] && extra="--preview .design/mpfb"
  "$B" -b --python tools/characters.py -- "$id" --glb "$TMP/$id.glb" $extra 2>&1 | grep -E 'Traceback|Error:|missing|exported' || true
  [ -f "$TMP/$id.glb" ] || { echo "$id: export failed"; continue; }
  npx -y gltfpack@1.3 -i "$TMP/$id.glb" -o "models/$id.glb" -cc -kn -km -ke >/dev/null
  echo "$id: models/$id.glb $(du -h "models/$id.glb" | cut -f1)"
done
