#!/usr/bin/env python3
"""Assemble rewrite records from HAND-WRITTEN per-ticket specs (a person/agent read the ticket and wrote the translation).
This tool does no drafting: it only attaches provenance (orig_hash, fold sha, author, date), aligns entries to the
original step / clause indices, and derives the status. Every record is still gated by rewrites.agree() in rewrite_check.py.

Spec file (python): SPEC = {"FIX-001": {...}, ...}; per ticket:
  steps: one entry per ORIGINAL step, in order. An entry is
      "keep"                         the original step maps as written
      ("needs", why)                 stays a person's step; `why` names the concrete blocker
      ("drop", "observe_moved_to_expected"|"no_text")
      {op, target?, value?, count?, src}   one executable step      (src: live:<lens> | manifest:<f> | frontend:<path>:<line> | alias | text)
      [ {...}, {...} ]               several executable steps for one original step
  exp: one entry per ORIGINAL clause, in order. An entry is "keep" | ("needs", why) | {kind, args, span?} | [ {kind,args,span}, ... ]
       (span defaults to the whole clause text; give spans when splitting one clause into several checks)
  sexp: {step_idx: {kind, args, span?}}   expectation carried by an observe step that was dropped
  human: ("lighthouse"|"code_read"|"cross_account"|"visual"|"other_with_note", note)   -> status human_only
"""
import argparse, json, os, sys, importlib.util

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro, rewrites as R, expected as X
from tools.rewrite_check import pool_of, BATCH

DATE = "2026-11-16"


def build(t, sp):
    base = {"ticket_id": t["id"], "lens": t["lens"], "fold_sha": R.FOLD_SHA, "orig_hash": R.orig_hash(t), "author": "sonnet", "date": DATE, "schema": R.SCHEMA}
    if sp.get("human"):
        reason, note = sp["human"]
        d = dict(base, status="human_only", human_only_reason=reason)
        if note:
            d["note"] = note
        return d
    raws, clauses = repro.split_steps(t), X.split_clauses(t.get("expected"))
    assert len(sp["steps"]) == len(raws), "%s: %d step entries for %d original steps" % (t["id"], len(sp["steps"]), len(raws))
    steps, dropped, exp = [], [], []
    for i, e in enumerate(sp["steps"]):
        if e == "keep":
            steps.append({"op": "keep", "src": "text", "from_orig": [i]})
        elif isinstance(e, tuple) and e[0] == "needs":
            steps.append({"op": "needs_human_step", "src": "text", "from_orig": [i], "why": e[1]})
        elif isinstance(e, tuple) and e[0] == "drop":
            dropped.append({"orig": i, "reason": e[1]})
        else:
            for d in (e if isinstance(e, list) else [e]):
                steps.append(dict(d, from_orig=[i]))
    assert len(sp["exp"]) == len(clauses), "%s: %d clause entries for %d original clauses (%r)" % (t["id"], len(sp["exp"]), len(clauses), clauses)
    for j, e in enumerate(sp["exp"]):
        if e == "keep":
            exp.append({"kind": "keep", "args": {}, "from_orig_clause": [j], "orig_span": clauses[j]})
        elif isinstance(e, tuple) and e[0] == "needs":
            exp.append({"kind": "needs_human", "args": {}, "from_orig_clause": [j], "orig_span": clauses[j], "why": e[1]})
        else:
            for d in (e if isinstance(e, list) else [e]):
                d = dict(d)
                exp.append({"kind": d["kind"], "args": d.get("args", {}), "from_orig_clause": [j], "orig_span": d.get("span", clauses[j])})
    for si, d in (sp.get("sexp") or {}).items():
        exp.append({"kind": d["kind"], "args": d.get("args", {}), "from_orig_clause": ["s%d" % si], "orig_span": d.get("span", raws[si])})
    converted = any(s["op"] not in ("keep", "needs_human_step") for s in steps) or any(c["kind"] not in ("keep", "needs_human") for c in exp)
    return dict(base, status="rewritten" if converted else "original_sufficient", steps=steps, dropped=dropped, expected=exp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, required=True)
    ap.add_argument("--spec", required=True)
    ap.add_argument("--repo", default="..")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    m = importlib.util.spec_from_file_location("spec", a.spec)
    mod = importlib.util.module_from_spec(m)
    m.loader.exec_module(mod)
    pool = pool_of(a.repo, R.FOLD_SHA)[(a.batch - 1) * BATCH: a.batch * BATCH]
    miss = [t["id"] for t in pool if t["id"] not in mod.SPEC]
    extra = [k for k in mod.SPEC if k not in {t["id"] for t in pool}]
    if miss or extra:
        sys.exit("spec/pool mismatch: missing %s extra %s" % (miss, extra))
    out = a.out or os.path.join(R.DEFAULT_DIR, "batch-%03d.jsonl" % a.batch)
    with open(out, "w", encoding="utf-8") as fh:
        for t in pool:
            fh.write(json.dumps(build(t, mod.SPEC[t["id"]]), ensure_ascii=False, sort_keys=True) + "\n")
    print("wrote", out, len(pool))


if __name__ == "__main__":
    main()
