#!/bin/sh
# Copy the Level 2 templates from the companion repository (vibeqm/vqm, checked out
# beside this one) into templates/, which `vqm-check init` writes from. The companion
# repository is the source; edit the templates there, then run this.
# npm leaves .gitignore files out of a package, so it is bundled as "gitignore".
set -eu
# Work from the repository root, wherever this is run from: the rm below is relative.
cd -- "$(dirname -- "$0")/.."
src="${1:-../vqm}/templates/level-2"
[ -d "$src" ] || { echo "sync-templates: $src not found" >&2; exit 1; }
rm -rf templates/level-2
mkdir -p templates
cp -R "$src" templates/level-2
mv templates/level-2/.gitignore templates/level-2/gitignore
echo "templates/level-2 synced from $src"
