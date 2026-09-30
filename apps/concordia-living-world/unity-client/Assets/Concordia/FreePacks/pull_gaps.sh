#!/bin/bash
set -u
DEST="/Users/dutch/concord vs code/concord-cognitive-engine/apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks"
LOG="$DEST/Logs/gaps.log"
UA="ConcordiaFreePacksGaps/1.0"
mkdir -p "$DEST"/{Fauna,Nature,VFX,Audio,Polish,Logs}
echo "---- $(date) GAPS START ----" >> "$LOG"

dl() {
  local url="$1" out="$2"
  mkdir -p "$(dirname "$out")"
  if [ -f "$out" ] && [ $(stat -f%z "$out" 2>/dev/null || echo 0) -gt 1000 ]; then
    echo "$(date +%H:%M:%S) skip $(basename "$out")" >> "$LOG"
    return 0
  fi
  echo "$(date +%H:%M:%S) GET $(basename "$out")" >> "$LOG"
  curl -L -A "$UA" --fail --retry 4 --retry-delay 2 -o "$out.partial" "$url" >> "$LOG" 2>&1
  if [ $? -eq 0 ] && [ -f "$out.partial" ] && [ $(stat -f%z "$out.partial") -gt 1000 ]; then
    mv "$out.partial" "$out"
    echo "$(date +%H:%M:%S) ok $(basename "$out") $(stat -f%z "$out")" >> "$LOG"
  else
    rm -f "$out.partial"
    echo "$(date +%H:%M:%S) FAIL $(basename "$out")" >> "$LOG"
  fi
}

# Fauna / mounts-ish (farm animals include horse-adjacent; animated wildlife)
dl "https://opengameart.org/sites/default/files/Animal%20Pack%20Vol.2%20by%20%40Quaternius.zip" \
  "$DEST/Fauna/Animal_Pack_Vol2_Quaternius.zip"
dl "https://opengameart.org/sites/default/files/Farm%20Animals%20by%20%40Quaternius.zip" \
  "$DEST/Fauna/Farm_Animals_Quaternius.zip"
dl "https://opengameart.org/sites/default/files/Animals%20Pack%20by%20Quaternius.zip" \
  "$DEST/Fauna/Animals_Pack_Quaternius.zip"

# Nature scatter (trees/rocks/plants) — polish terrain dress
dl "https://opengameart.org/sites/default/files/Nature%20Kit%20%282.1%29.zip" \
  "$DEST/Nature/Kenney_Nature_Kit_2.1.zip"

# VFX particles
dl "https://opengameart.org/sites/default/files/kenney_particlePack.zip" \
  "$DEST/VFX/kenney_particlePack.zip"

# Audio
dl "https://opengameart.org/sites/default/files/RPGsounds_Kenney.zip" \
  "$DEST/Audio/RPGsounds_Kenney.zip"
dl "https://opengameart.org/sites/default/files/kenney_interfaceSounds.zip" \
  "$DEST/Audio/kenney_interfaceSounds.zip"

# UI polish borders
dl "https://opengameart.org/sites/default/files/kenney_fantasy-ui-borders.zip" \
  "$DEST/Polish/kenney_fantasy-ui-borders.zip"

# Unzip
for dir in Fauna Nature VFX Audio Polish; do
  cd "$DEST/$dir" || continue
  for z in *.zip; do
    [ -f "$z" ] || continue
    d="${z%.zip}"
    mkdir -p "$d"
    unzip -n -q "$z" -d "$d" && echo "$(date +%H:%M:%S) unzipped $z" >> "$LOG"
  done
done

# Expanded Aura manifest (gaps + polish — polish settings are bind steps, not files)
python3 - <<'PY' >> "$LOG" 2>&1
import json, os, time
root = "/Users/dutch/concord vs code/concord-cognitive-engine/apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks"
sections = ["Quaternius","KenneyUI","GameIcons","FoozleUI","TinyRPGUI","ambientCG","Fauna","Nature","VFX","Audio","Polish"]
packs = {}
for name in sections:
  p = os.path.join(root, name)
  if not os.path.isdir(p):
    packs[name] = {"path": f"Assets/Concordia/FreePacks/{name}", "file_count": 0, "status": "empty"}
    continue
  files = []
  for dp,_,fs in os.walk(p):
    for f in fs:
      if f.endswith('.partial') or f.endswith('.sh'): continue
      files.append(os.path.relpath(os.path.join(dp,f), p))
  packs[name] = {"path": f"Assets/Concordia/FreePacks/{name}", "file_count": len(files), "files_sample": files[:30]}

manifest = {
  "purpose": "Free content gaps + polish ammo for Concordia (post Poly Haven)",
  "license_notes": {
    "Quaternius/Fauna": "CC0",
    "Kenney*": "CC0",
    "GameIcons": "CC-BY 3.0 — credit game-icons.net",
    "FoozleUI": "CC0 when present"
  },
  "content_gaps_covered": {
    "fauna_wildlife": "Fauna/* Quaternius animal packs (wolf/eagle/dog/cat + farm animals)",
    "mounts": "Farm animals + Quaternius horses via animal packs where included; Ultimate Animated Animal Pack still TODO if needed",
    "vfx": "Kenney particle pack (fire/smoke/magic/sparks)",
    "audio_sfx": "Kenney RPG + interface sounds",
    "nature_scatter": "Kenney Nature Kit 330+ trees/rocks/plants",
    "ui_polish": "Fantasy UI borders + prior Kenney UI + Game-icons"
  },
  "polish_bind_steps_NOT_files": [
    "URP Renderer: enable SSAO, soft shadows, contact shadows; muted color grade",
    "WorldVisualDirector: assign Poly Haven HDRIs per world; kill flat ambient",
    "Terrain: replace Plane with sculpted mesh + Poly Haven ground mats + Nature Kit scatter",
    "LODs: generate for Quaternius/Nature FBX; preserve silhouettes",
    "Hero: Quaternius Humanoid replace polo/khakis; grip sockets for weapons (no magenta)",
    "HUD: Court parchment vs Steel themes share layout; Game-icons for skills/items",
    "Audio: wire RPG SFX to combat/UI; interface sounds for menus"
  ],
  "still_not_downloadable_here": [
    "2B dialogue / voice — content/LLM pipeline, not an asset ZIP",
    "Quest authored art beyond generic UI",
    "Gameplay cascade proof (kill→world remembers) — systems binding"
  ],
  "aura_instructions": [
    "Index FreePacks/Fauna + Nature into FreePacks/DressVocab",
    "Spawn ambient fauna along Ring roads; farm animals near settlements",
    "Use Nature Kit + Poly Haven mats for non-flat terrain dress",
    "Import particle pack for hit/loot/magic FX",
    "Apply polish_bind_steps_NOT_files in URP + WorldVisualDirector",
    "Keep all free — no Asset Store paid"
  ],
  "packs": packs,
  "updated": time.strftime("%Y-%m-%dT%H:%M:%S")
}
open(os.path.join(root,"AURA_MANIFEST.json"),"w").write(json.dumps(manifest, indent=2))
open(os.path.join(root,"README_FOR_AURA.md"),"w").write(
"""# FreePacks — gaps + polish ammo

## Content
- Quaternius chars/anims + Fauna animals (CC0)
- Kenney UI / Nature / Particles / Audio (CC0)
- Game-icons (CC-BY 3.0 — attribute)
- Poly Haven is sibling folder Assets/Concordia/PolyHaven

## Polish (Aura must do — not in ZIPs)
SSAO/soft shadows, HDRI per world, terrain sculpt+scatter, Humanoid hero, weapon grips, Court vs Steel HUD themes.

## Not in packs
2B/voice dialogue, authored quests, kill→cascade gameplay proof.
""")
print("gaps manifest", {k:v.get("file_count") for k,v in packs.items()})
PY

echo "---- $(date) GAPS DONE ----" >> "$LOG"
du -sh "$DEST"/* >> "$LOG" 2>/dev/null
df -h /Users/dutch | tail -1 >> "$LOG"
