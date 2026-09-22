#!/bin/bash
set -u
ROOT="/Users/dutch/concord vs code/concord-cognitive-engine/apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/ambientCG"
LOG="$ROOT/Logs/pull.log"
mkdir -p "$ROOT/Logs" "$ROOT/zips" "$ROOT/extracted"
echo "---- $(date) ambientCG START ----" >> "$LOG"
UA="ConcordiaAmbientCG/1.0"
# Collect download file names via API for key queries
python3 - <<'PY' >> "$LOG" 2>&1
import json, urllib.request, os, time, random
ROOT="/Users/dutch/concord vs code/concord-cognitive-engine/apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/ambientCG"
UA={"User-Agent":"ConcordiaAmbientCG/1.0"}
queries=["wood","rock","ground","metal","fabric","stone","brick","dirt","grass","sand","snow","plaster","roof","asphalt","concrete"]
files=set()
for q in queries:
  url=f"https://ambientcg.com/api/v3/assets?type=material&q={q}&limit=40&include=downloadFolders"
  try:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
      data=json.load(r)
  except Exception as e:
    print(f"api fail {q}: {e}")
    continue
  found=data.get("foundAssets") or data.get("assets") or []
  if isinstance(data, dict) and "foundAssets" not in data and "assets" not in data:
    # v3 may return list under different key
    found = data if isinstance(data, list) else list(data.values()) if data else []
  # normalize
  items=[]
  if isinstance(found, list):
    items=found
  elif isinstance(found, dict):
    items=list(found.values())
  for a in items:
    if not isinstance(a, dict):
      continue
    aid=a.get("assetId") or a.get("id") or a.get("name")
    if not aid: continue
    # prefer 1K-JPG zip name convention
    files.add(f"{aid}_1K-JPG.zip")
  print(f"q={q} total_candidates={len(files)}")
  time.sleep(0.4+random.random()*0.3)
open(os.path.join(ROOT,"Logs","filelist.txt"),"w").write("\n".join(sorted(files)))
print(f"WROTE {len(files)} files")
PY

n=0; ok=0; fail=0; skip=0
while IFS= read -r fn; do
  [ -z "$fn" ] && continue
  n=$((n+1))
  out="$ROOT/zips/$fn"
  if [ -f "$out" ] && [ $(stat -f%z "$out") -gt 5000 ]; then
    skip=$((skip+1)); continue
  fi
  url="https://ambientcg.com/get?file=$fn"
  curl -L -A "$UA" --fail --retry 3 --retry-delay 2 -o "$out.partial" "$url" >> "$LOG" 2>&1
  if [ $? -eq 0 ] && [ -f "$out.partial" ] && [ $(stat -f%z "$out.partial") -gt 5000 ]; then
    mv "$out.partial" "$out"
    ok=$((ok+1))
    echo "$(date +%H:%M:%S) ok $fn" >> "$LOG"
  else
    rm -f "$out.partial"
    fail=$((fail+1))
    echo "$(date +%H:%M:%S) fail $fn" >> "$LOG"
  fi
  # stop early if disk tight
  free=$(df -g /Users/dutch | awk 'NR==2{print $4}')
  if [ "${free:-0}" -lt 8 ]; then
    echo "LOW DISK stop free=${free}G" >> "$LOG"
    break
  fi
done < "$ROOT/Logs/filelist.txt"

# unzip a subset for Aura (not all — save space); keep zips
cd "$ROOT/zips" && ls *.zip 2>/dev/null | head -80 | while read z; do
  d="$ROOT/extracted/${z%.zip}"
  mkdir -p "$d"
  unzip -n -q "$z" -d "$d" 2>/dev/null || true
done

echo "DONE n=$n ok=$ok skip=$skip fail=$fail" >> "$LOG"
du -sh "$ROOT" >> "$LOG"
df -h /Users/dutch | tail -1 >> "$LOG"
