#!/bin/bash
# Weapons + props gap fill — the one pull_gaps.sh left open (its own
# content_gaps_covered list has no "weapons" or "props" key). Same pattern:
# OpenGameArt direct-file mirrors (curl-able without an itch.io claim flow),
# CC0, unzip into a matching subfolder, extend AURA_MANIFEST.json.
set -u
DEST="/Users/dutch/concord vs code/concord-cognitive-engine/apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks"
LOG="$DEST/Logs/weapons_props.log"
UA="ConcordiaFreePacksWeaponsProps/1.0"
mkdir -p "$DEST"/{Weapons,Props,Logs}
echo "---- $(date) WEAPONS+PROPS START ----" >> "$LOG"

dl() {
  local url="$1" out="$2"
  mkdir -p "$(dirname "$out")"
  if [ -f "$out" ] && [ "$(stat -f%z "$out" 2>/dev/null || echo 0)" -gt 1000 ]; then
    echo "$(date +%H:%M:%S) skip $(basename "$out")" >> "$LOG"
    return 0
  fi
  echo "$(date +%H:%M:%S) GET $(basename "$out")" >> "$LOG"
  curl -L -A "$UA" --fail --retry 4 --retry-delay 2 -o "$out.partial" "$url" >> "$LOG" 2>&1
  if [ $? -eq 0 ] && [ -f "$out.partial" ] && [ "$(stat -f%z "$out.partial")" -gt 1000 ]; then
    mv "$out.partial" "$out"
    echo "$(date +%H:%M:%S) ok $(basename "$out") $(stat -f%z "$out")" >> "$LOG"
  else
    rm -f "$out.partial"
    echo "$(date +%H:%M:%S) FAIL $(basename "$out")" >> "$LOG"
  fi
}

# Weapons — B8 (31 bespoke ids: 1h slash, 2h heavy, polearm, bow, thrown, focus/staff, improvised)
dl "https://opengameart.org/sites/default/files/Medieval%20Weapons%20Pack%20-%20Sept%202018.zip" \
  "$DEST/Weapons/Quaternius_Medieval_Weapons.zip"

# Props — B10 (40 bespoke ids: lanterns, urns, crates, tools, market stalls, satchels, chests)
dl "https://opengameart.org/sites/default/files/fantasy_props_megakitstandard.zip" \
  "$DEST/Props/Quaternius_Fantasy_Props_MegaKit_Standard.zip"

# Grid-world specific (Pulse Blade, Rail Bow, Count Pike, Cable Whip, junction box,
# cable coil, solar tile) — modular sci-fi greebles for the cyber-palette reskins
dl "https://opengameart.org/sites/default/files/modular_scifi_megakitstandard.zip" \
  "$DEST/Props/Quaternius_Modular_SciFi_MegaKit_Standard.zip"

for dir in Weapons Props; do
  cd "$DEST/$dir" || continue
  for z in *.zip; do
    [ -f "$z" ] || continue
    d="${z%.zip}"
    mkdir -p "$d"
    unzip -n -q "$z" -d "$d" && echo "$(date +%H:%M:%S) unzipped $z" >> "$LOG"
  done
done

echo "---- $(date) WEAPONS+PROPS DONE ----" >> "$LOG"
du -sh "$DEST"/Weapons "$DEST"/Props >> "$LOG" 2>/dev/null
