"""CB-1240 FIX 1: classify the needs---allow-write ticket list for the rerun.

Reads the desk's needs_allow_write.txt (one ticket id per line) and the ticket
fold (fix_tickets.jsonl), and splits the ids by which EXISTING walker write
path covers them, per concord_walker/reverify.py's _write_ctx rules:

  GENERAL              lens is neither admin nor write-skip and the repro
                       steps perform a write -> covered by --allow-write
                       (dedicated write account, own labelled fixtures).
  WRITE-OWN            lens is write-skip-listed -> covered by
                       --allow-write-own (t2, its own fixtures only, ULW C38).
  ADMIN-EXCLUDED       lens is an admin lens -> no write ctx ever, by design.
  NO-STEPS             the fold row carries no machine steps (absent, or a
                       pointer to an evidence file) -> the write need is
                       unstated; re-classify after the steps are authored
                       (the four-fix rerun's FIX 2 owns that authoring).
  MISLABELLED-CAND.    steps are present and contain no write verb/surface ->
                       relabel candidates (the desk's CB-1240 S1 alternative);
                       a verb-scan heuristic, so the desk's eye decides.

Usage: classify_allow_write.py <needs_allow_write.txt> <fix_tickets.jsonl>
         [--config walker/config.json] [--out classified.json]
"""
import argparse, json, re, sys

WRITE = re.compile(r"\b(create|save|publish|share|delete|remove|submit|post|add|upload|edit|send|"
                   r"invite|compose|reply|comment|book|schedule|rename|archive|vote|rate|follow|join|"
                   r"register|pay|transfer|mint|sell|buy|new|type|enter|fill|trash|ask)\b", re.I)

def lens_of(tid, row):
    if row and row.get("lens"):
        return row["lens"]
    m = re.match(r"FIX-(.+)-\d+$", tid)
    return m.group(1) if m else ""

def steps_of(row):
    if not row:
        return ""
    s = row.get("repro_steps")
    if isinstance(s, list):
        return "\n".join(str(x) for x in s)
    return str(s or "")

def classify(ids, fold, skip, admin):
    out = {"GENERAL": [], "WRITE-OWN": [], "ADMIN-EXCLUDED": [], "NO-STEPS": [], "MISLABELLED-CANDIDATE": []}
    for tid in ids:
        row = fold.get(tid)
        lens, st = lens_of(tid, row), steps_of(row)
        if lens in admin:
            out["ADMIN-EXCLUDED"].append(tid)
        elif lens in skip:
            out["WRITE-OWN"].append(tid)
        elif not st.strip() or st.strip().lower().startswith("see "):
            out["NO-STEPS"].append(tid)
        elif not WRITE.search(st):
            out["MISLABELLED-CANDIDATE"].append(tid)
        else:
            out["GENERAL"].append(tid)
    return out

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("list_file")
    ap.add_argument("fold_file")
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--out")
    a = ap.parse_args()
    ids = [l.strip() for l in open(a.list_file) if l.strip()]
    fold = {}
    for line in open(a.fold_file):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("id"):
            fold[r["id"]] = r
    cfg = json.load(open(a.config))
    classes = classify(ids, fold, set(cfg.get("write_skip_lenses", [])), set(cfg.get("admin_lenses", [])))
    result = {"source_list_count": len(ids),
              "counts": {k: len(v) for k, v in classes.items()},
              "classes": classes}
    text = json.dumps(result, indent=1)
    if a.out:
        open(a.out, "w").write(text + "\n")
    print(text if not a.out else "wrote %s: %s" % (a.out, result["counts"]))
    return 0

if __name__ == "__main__":
    sys.exit(main())
