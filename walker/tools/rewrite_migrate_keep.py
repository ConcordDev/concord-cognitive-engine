#!/usr/bin/env python3
"""Mechanical migration: a committed rewrite step marked `needs_human_step` whose ORIGINAL text the mapper now maps is
changed to `keep` (what rewrites.agree() demands: "the original maps (use keep)"). Nothing else in a record changes
(orig_hash, expected, other steps untouched). Idempotent; --check lists what would change and exits 1 if anything would.

  python3 tools/rewrite_migrate_keep.py --repo .. --sha 272e62f41 [--check]
"""
import argparse, glob, json, os, sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import rewrites as R
from concord_walker.fold import extract_from_git


def migrate(fold, rewrites_dir):
    changed = []
    for path in sorted(glob.glob(os.path.join(rewrites_dir, "batch-*.jsonl"))):
        out, dirty = [], False
        for line in open(path):
            if not line.strip():
                out.append(line)
                continue
            rec = json.loads(line)
            t = fold.base.get(rec.get("ticket_id"))
            before = len(changed)
            if t is not None and rec.get("status") == "rewritten":
                clauses = R._X.split_clauses(t.get("expected")) if hasattr(R, "_X") else []
                for c in rec.get("expected") or []:
                    if c.get("kind") != "needs_human":
                        continue
                    text, _ = R.compile_clause(dict(c, kind="keep"), R._clauses_of(t))
                    if text and R._clause_kinds(text) is not None:
                        old = c.get("why")
                        c["kind"], c["args"] = "keep", {}
                        c.pop("why", None)
                        c["migrated_from"] = "needs_human: " + (old or "")[:120]
                        changed.append(rec["ticket_id"])
                raws = R._R.split_steps(t)
                for s in rec["steps"]:
                    if s["op"] != "needs_human_step":
                        continue
                    text, _ = R.compile_step(dict(s, op="keep"), raws)
                    if text and R._step_mapped(text, rec["lens"])["mapped"]:
                        old = s.get("why")
                        for k in [k for k in s if k not in ("from_orig", "op", "src")]:
                            del s[k]
                        s["op"], s["src"] = "keep", "text"
                        s["migrated_from"] = "needs_human_step: " + (old or "")[:120]
                        dirty = True
                        changed.append(rec["ticket_id"])
            out.append(json.dumps(rec, sort_keys=True) + "\n" if len(changed) > before else line)
            dirty = dirty or len(changed) > before
        if dirty:
            open(path, "w").write("".join(out))
    return changed


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="..")
    ap.add_argument("--sha", default="272e62f41")
    ap.add_argument("--dir", default=os.path.join(HERE, "rewrites"))
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    fold = extract_from_git(a.repo, a.sha)
    if a.check:
        import shutil, tempfile
        tmp = tempfile.mkdtemp()
        for f in glob.glob(os.path.join(a.dir, "batch-*.jsonl")):
            shutil.copy(f, tmp)
        ch = migrate(fold, tmp)
        print("would migrate %d step(s): %s" % (len(ch), sorted(set(ch))))
        sys.exit(1 if ch else 0)
    ch = migrate(fold, a.dir)
    print("migrated %d step(s) in %d record(s): %s" % (len(ch), len(set(ch)), sorted(set(ch))))
