#!/bin/sh
# Assemble the static site for Cloudflare Pages into dist/.
# Only what the page loads at runtime is copied; the source video, reference
# clips, tools and notes stay out of the public deployment.
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist/data
cp -R index.html favicon.ico favicon.svg apple-touch-icon.png og.jpg src vendor audio dist/
cp data/script.json data/voices.json dist/data/
find dist -name .DS_Store -delete
find dist -type d -empty -delete
echo "dist/: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
