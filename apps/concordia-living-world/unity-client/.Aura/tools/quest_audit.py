import json, os, glob, collections, sys
# Repo content/ and the Unity Canon folder; override with QUEST_AUDIT_CONTENT / QUEST_AUDIT_CANON.
REPO = os.environ.get("QUEST_AUDIT_CONTENT", "/Users/dutch/concord vs code/concord-cognitive-engine/content")
CANON = os.environ.get("QUEST_AUDIT_CANON", os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../Assets/Concordia/Resources/Concordia/Canon"))
UNITY = {"talk_to","interact","reach_location","observe","defeat","gather","deliver"}   # HubObjectives.cs QuestLog.CanDo
SERVER = {"kill","defeat","gather","talk_to"}  # recordObjectiveProgress(..., '<type>') call sites in server/

def sources():
    for f in sorted(glob.glob(f"{REPO}/quests/*.json")):
        yield f, "concordia-hub", os.path.basename(f)
    for f in sorted(glob.glob(f"{REPO}/quests/sub-worlds/*/*.json")):
        yield f, f.split("/")[-2], os.path.basename(f)
    for f in sorted(glob.glob(f"{REPO}/world/*/quests/*.json")):
        yield f, f.split("/")[-3], os.path.basename(f)

def quests(doc):
    if isinstance(doc, list): return [q for q in doc if isinstance(q, dict)]
    if isinstance(doc, dict):
        for k in ("quests", "items", "chain"):
            if isinstance(doc.get(k), list): return [q for q in doc[k] if isinstance(q, dict)]
        return [doc]
    return []

rows, missing, stale, totals = [], [], [], collections.Counter()
type_counts = collections.Counter()
for path, world, name in sources():
    rel = os.path.relpath(path, os.path.dirname(REPO))
    canon = f"{CANON}/{world}/quests/{name}"
    status = "present"
    if not os.path.exists(canon):
        status = "MISSING"; missing.append((rel, f"Canon/{world}/quests/{name}"))
    elif open(canon, "rb").read() != open(path, "rb").read():
        status = "STALE"; stale.append((rel, f"Canon/{world}/quests/{name}"))
    try: doc = json.load(open(path))
    except Exception as e:
        rows.append((rel, world, status, f"(unreadable: {e})", 0, 0, 0, "")); continue
    for q in quests(doc):
        objs = [o for o in (q.get("objectives") or []) if isinstance(o, dict)]
        types = [str(o.get("type", "")).strip().lower() for o in objs]
        type_counts.update(types)
        u = sum(t in UNITY for t in types); s = sum(t in SERVER for t in types)
        unsupported = sorted({t for t in types if t not in UNITY})
        totals["quests"] += 1; totals["objectives"] += len(types); totals["unity"] += u; totals["server"] += s
        if types and u == len(types): totals["unity_complete"] += 1
        if types and s == len(types): totals["server_complete"] += 1
        rows.append((rel, world, status, q.get("id", "?"), len(types), u, s, ", ".join(unsupported)))

out = []
w = out.append
w("# Quest content audit (A-01)")
w("")
w("Generated 2026-10-26 by Claude from repo `content/` and `Canon/`. Regenerate with the script named at the end.")
w("")
w("## Summary")
w("")
w(f"- **Quests:** {totals['quests']}, with {totals['objectives']} objectives.")
w(f"- **Unity can complete** {totals['unity']}/{totals['objectives']} objectives (`QuestLog.CanDo`: {', '.join(sorted(UNITY))}). Quests completable end to end in Unity: {totals['unity_complete']}/{totals['quests']}.")
w(f"- **The server records progress for** {totals['server']}/{totals['objectives']} objectives (types with a `recordObjectiveProgress` call site: {', '.join(sorted(SERVER))}). Quests completable end to end online: {totals['server_complete']}/{totals['quests']}.")
w(f"- **Canon files:** {len(missing)} missing, {len(stale)} differ from `content/`.")
w("")
w("Online (A-05), a quest finishes on the server only when the server records every objective. `reach_location`, `interact`, `deliver` and `observe` have no server writer yet, so most quests cannot finish online; that is server work, not a client gap.")
w("")
w("## Objective types")
w("")
w("| Type | Count | Unity | Server |")
w("|---|---:|:---:|:---:|")
for t, n in type_counts.most_common():
    w(f"| `{t or '(none)'}` | {n} | {'yes' if t in UNITY else 'no'} | {'yes' if t in SERVER else 'no'} |")
w("")
w("`talk_to_npc` is spelled differently from `talk_to`; `QuestLog.Norm` only lower-cases, so Unity treats it as unsupported.")
w("")
w("## Canon sync")
w("")
if missing:
    w("Missing in Canon (needs a sync REQ; Aura must not copy them):")
    w("")
    for a, b in missing: w(f"- `{a}` → `{b}`")
    w("")
if stale:
    w("Present but different from `content/`:")
    w("")
    for a, b in stale: w(f"- `{a}` ≠ `{b}`")
    w("")
if not missing and not stale: w("Every source file is in Canon and identical."); w("")
# Quest ids Unity's own Canon names (prerequisites, unlocks) that no Canon quest defines.
canon_ids, canon_text = set(), ""
for f in glob.glob(f"{CANON}/*/quests/*.json"):
    t = open(f).read(); canon_text += t
    try: canon_ids.update(q.get("id") for q in quests(json.loads(t)))
    except Exception: pass
dangling = sorted({qid for qid in (r[3] for r in rows) if qid not in canon_ids and f'"{qid}"' in canon_text})
if dangling:
    w("Named by Canon quests (as prerequisites or unlocks) but not loadable in Unity:")
    w("")
    for qid in dangling: w(f"- `{qid}`")
    w("")
w("## Per quest")
w("")
w("| Source | World | Canon | Quest | Objectives | Unity | Server | Unsupported in Unity |")
w("|---|---|---|---|---:|---:|---:|---|")
for r in rows:
    w("| `%s` | %s | %s | `%s` | %d | %d | %d | %s |" % r)
w("")
w("Script: `.Aura/tools/quest_audit.py` (run with python3 from anywhere).")
open(sys.argv[1], "w").write("\n".join(out) + "\n")
print(totals, len(missing), len(stale))
