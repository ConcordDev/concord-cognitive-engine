#!/bin/bash
set -u
DEST="/Users/dutch/concord vs code/concord-cognitive-engine/apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks"
LOG="$DEST/Logs/pull.log"
UA="ConcordiaFreePacks/1.0"
mkdir -p "$DEST"/{Quaternius,KenneyUI,GameIcons,ambientCG,FoozleUI,TinyRPGUI,Logs}
echo "---- $(date) START ----" >> "$LOG"

dl() {
  local url="$1" out="$2"
  if [ -f "$out" ] && [ $(stat -f%z "$out" 2>/dev/null || echo 0) -gt 1000 ]; then
    echo "$(date +%H:%M:%S) skip $(basename "$out")" >> "$LOG"
    return 0
  fi
  echo "$(date +%H:%M:%S) GET $url -> $out" >> "$LOG"
  curl -L -A "$UA" --fail --retry 4 --retry-delay 2 -o "$out.partial" "$url" >> "$LOG" 2>&1
  local rc=$?
  if [ $rc -eq 0 ] && [ -f "$out.partial" ] && [ $(stat -f%z "$out.partial") -gt 1000 ]; then
    mv "$out.partial" "$out"
    echo "$(date +%H:%M:%S) ok $(basename "$out") $(stat -f%z "$out") bytes" >> "$LOG"
  else
    rm -f "$out.partial"
    echo "$(date +%H:%M:%S) FAIL $url rc=$rc" >> "$LOG"
  fi
}

# Quaternius Ultimate Animated Character Pack (CC0)
dl "https://opengameart.org/sites/default/files/ultimate_animated_character_pack_by_quaternius.zip" \
  "$DEST/Quaternius/ultimate_animated_character_pack_by_quaternius.zip"

# Kenney UI (CC0)
dl "https://opengameart.org/sites/default/files/kenney_ui-pack.zip" \
  "$DEST/KenneyUI/kenney_ui-pack.zip"
dl "https://opengameart.org/sites/default/files/kenney_ui-pack-adventure.zip" \
  "$DEST/KenneyUI/kenney_ui-pack-adventure.zip"
dl "https://opengameart.org/sites/default/files/kenney_input-prompts.zip" \
  "$DEST/KenneyUI/kenney_input-prompts.zip"

# Game-icons (CC-BY 3.0 — attribution required)
dl "https://opengameart.org/sites/default/files/game-icons.net_.png.zip" \
  "$DEST/GameIcons/game-icons.net_png.zip"
dl "https://opengameart.org/sites/default/files/game-icons.net_.svg.zip" \
  "$DEST/GameIcons/game-icons.net_svg.zip"

# More Quaternius nature/RPG if available
for u in \
  "https://opengameart.org/sites/default/files/rpg_characters_-_nov_2020.zip" \
  "https://opengameart.org/sites/default/files/lowpoly_nature_pack.zip"
 do
  bn=$(basename "$u")
  dl "$u" "$DEST/Quaternius/$bn"
 done

# Unzip packs in place (keep zips)
cd "$DEST/Quaternius" && for z in *.zip; do [ -f "$z" ] || continue; d="${z%.zip}"; mkdir -p "$d"; unzip -n -q "$z" -d "$d" && echo "$(date +%H:%M:%S) unzipped $z" >> "$LOG"; done
cd "$DEST/KenneyUI" && for z in *.zip; do [ -f "$z" ] || continue; d="${z%.zip}"; mkdir -p "$d"; unzip -n -q "$z" -d "$d" && echo "$(date +%H:%M:%S) unzipped $z" >> "$LOG"; done
cd "$DEST/GameIcons" && for z in *.zip; do [ -f "$z" ] || continue; d="${z%.zip}"; mkdir -p "$d"; unzip -n -q "$z" -d "$d" && echo "$(date +%H:%M:%S) unzipped $z" >> "$LOG"; done

# Manifest for Aura
python3 - <<'PY' >> "$LOG" 2>&1
import json, os, time
root = "/Users/dutch/concord vs code/concord-cognitive-engine/apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks"
packs = {}
for name in ("Quaternius","KenneyUI","GameIcons","FoozleUI","TinyRPGUI","ambientCG"):
  p = os.path.join(root, name)
  files = []
  for dp,_,fs in os.walk(p):
    for f in fs:
      if f.endswith('.partial'): continue
      files.append(os.path.relpath(os.path.join(dp,f), p))
  packs[name] = {"path": f"Assets/Concordia/FreePacks/{name}", "file_count": len(files), "files_sample": files[:40]}
manifest = {
  "purpose": "Free chars/anims + UI for Concordia (post Poly Haven)",
  "license_notes": {
    "Quaternius": "CC0",
    "KenneyUI": "CC0",
    "GameIcons": "CC-BY 3.0 — credit game-icons.net / Lorc & Delapouite",
    "FoozleUI": "CC0 when downloaded",
    "TinyRPGUI": "check pack license",
    "ambientCG": "CC0"
  },
  "aura_instructions": [
    "Quaternius: import FBX as Humanoid; replace polo/khakis hero; use pack anims for locomotion/combat/emotes",
    "KenneyUI: Court parchment theme + Steel theme share layout; buttons/panels/sliders from UI Pack + Adventure",
    "GameIcons: HUD skill/item icons; keep attribution in credits",
    "Foozle Lucifer RPG UI: steel/dark RPG HUD alternate (download pending itch)",
    "Do not use paid Asset Store packs"
  ],
  "packs": packs,
  "updated": time.strftime("%Y-%m-%dT%H:%M:%S")
}
open(os.path.join(root,"AURA_MANIFEST.json"),"w").write(json.dumps(manifest, indent=2))
open(os.path.join(root,"README_FOR_AURA.md"),"w").write(
  "# FreePacks (chars / UI)\n\nQuaternius = hero+NPC+anims (CC0).\nKenney = HUD/menus (CC0).\nGame-icons = icons (CC-BY 3.0).\nFoozle/TinyRPG/ambientCG = follow-up.\n")
print("manifest written", {k:v["file_count"] for k,v in packs.items()})
PY

echo "---- $(date) DONE ----" >> "$LOG"
ls -lh "$DEST"/Quaternius/*.zip "$DEST"/KenneyUI/*.zip "$DEST"/GameIcons/*.zip 2>/dev/null >> "$LOG"
df -h /Users/dutch | tail -1 >> "$LOG"
