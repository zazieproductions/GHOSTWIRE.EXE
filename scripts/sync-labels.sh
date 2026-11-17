#!/usr/bin/env bash
# GHOSTWIRE.EXE — sync GitHub labels from .github/labels.yml
#
# Idempotent: creates any missing labels. Existing labels are left untouched
# (use `gh label edit` to change a color/description deliberately).
# Requires: gh CLI, authenticated (`gh auth status`).
#
# Usage:
#   bash scripts/sync-labels.sh            # create missing labels
#   DRY_RUN=1 bash scripts/sync-labels.sh  # print what would be created
set -euo pipefail

cd "$(dirname "$0")/.."
YML=".github/labels.yml"

if [[ ! -f "$YML" ]]; then
  echo "error: $YML not found" >&2
  exit 1
fi

# Parse the simple YAML subset used in .github/labels.yml:
#   - name: foo
#     color: "aabbcc"
#     description: "..."
# Names/descriptions may be quoted; colors are always quoted hex.
mapfile -t NAMES < <(grep -E '^\s*- name:' "$YML" | sed -E 's/^\s*- name:\s*//; s/^"//; s/"$//')
mapfile -t COLORS < <(grep -E '^\s*color:' "$YML" | sed -E 's/^\s*color:\s*//; s/^"//; s/"$//')
mapfile -t DESCS < <(grep -E '^\s*description:' "$YML" | sed -E 's/^\s*description:\s*//; s/^"//; s/"$//')

if [[ ${#NAMES[@]} -ne ${#COLORS[@]} || ${#NAMES[@]} -ne ${#DESCS[@]} ]]; then
  echo "error: parsed ${#NAMES[@]} names, ${#COLORS[@]} colors, ${#DESCS[@]} descriptions — check $YML" >&2
  exit 1
fi

existing="$(gh label list --limit 200 --json name --jq '.[].name' 2>/dev/null || true)"
created=0
skipped=0

for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"
  color="${COLORS[$i]}"
  desc="${DESCS[$i]}"
  if grep -qxF "$name" <<<"$existing"; then
    echo "exists:  $name"
    skipped=$((skipped + 1))
  elif [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "would create: $name (#$color) — $desc"
    created=$((created + 1))
  else
    gh label create "$name" --color "$color" --description "$desc" >/dev/null
    echo "created: $name"
    created=$((created + 1))
  fi
done

echo "---"
echo "created: $created, already present: $skipped, total in file: ${#NAMES[@]}"
