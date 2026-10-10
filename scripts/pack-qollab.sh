#!/usr/bin/env bash
# Build the zip for Qollab "Upload your own files".
# Allow-list of git-tracked files (nothing else can leak into the upload). Usage:
#   scripts/pack-qollab.sh            # writes dist/entangled-qollab.zip
#   scripts/pack-qollab.sh --dry-run  # list files only
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Allow-list: anything not matching is NOT packed (docs/, dev/, tests/, scripts/, dist/, mock engine...).
INCLUDE='^(index\.html|main\.js|main\.css|LICENSE|README\.md|js/[^/]+\.js|levels/[^/]+\.json|quantum/.+\.py|audio/[^/]+\.ogg)$'
# Dropped even if they match INCLUDE: the mock engine and Python tests.
DENY='^(js/mock_engine\.js|(.*/)?(tests?/.*|test_[^/]*\.py|[^/]*_test\.py))$'
MAX_FILES=100
MAX_BYTES=$((2 * 1024 * 1024))

mapfile -t FILES < <(git ls-files | grep -E "$INCLUDE" | grep -Ev "$DENY")

for required in index.html main.js main.css; do
  printf '%s\n' "${FILES[@]}" | grep -qx "$required" || { echo "missing $required at repo root" >&2; exit 1; }
done

if (( ${#FILES[@]} > MAX_FILES )); then
  echo "too many files: ${#FILES[@]} > $MAX_FILES" >&2; exit 1
fi
for f in "${FILES[@]}"; do
  size=$(stat -c %s "$f")
  if (( size > MAX_BYTES )); then echo "file over 2 MB: $f ($size bytes)" >&2; exit 1; fi
done

printf '%s\n' "${FILES[@]}"
echo "${#FILES[@]} files"

if [[ "${1:-}" == "--dry-run" ]]; then exit 0; fi

mkdir -p dist
rm -f dist/entangled-qollab.zip
zip -q dist/entangled-qollab.zip "${FILES[@]}"
echo "wrote dist/entangled-qollab.zip"
