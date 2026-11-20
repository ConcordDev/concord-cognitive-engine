"""Reverify coverage (Dutch, Nov 15 2026).

1. Recipe-only VERIFIED. Only a hand-written repro recipe can produce FIXED:
   a per-ticket recipe registered in Reverifier.recipes (the r_* / prod
   recipes), the form bad-input validation recipe, or the two-account privacy
   probe. A FIXED that came only from a keyword-classified standard check is
   capped at NEEDS_HUMAN. STILL_FAILING from any path stands (it can reopen).
   Where unsure, NEEDS_HUMAN.

2. Coverage table. Every ticket in the reverify scope whose prior status is
   FIXED_PENDING_VERIFY or OPEN gets exactly one row in
   reverify_coverage.json / .md, with a reason that is never empty — nothing
   sits pending without saying why.
"""
import json, os, re
from collections import Counter

FIXED, STILL, HUMAN, NOT_ATTEMPTED = "FIXED", "STILL_FAILING", "NEEDS_HUMAN", "NOT_ATTEMPTED"
VERDICTS = (FIXED, STILL, HUMAN, NOT_ATTEMPTED)
SCOPE_STATUSES = ("FIXED_PENDING_VERIFY", "OPEN")

# Category recipes Dutch named as hand-written (they drive their own repro).
# Matched on category AND method, so a keyword path can never pose as one.
_CATEGORY_RECIPES = {"validation": re.compile(r"^form bad-input recipe"),
                     "privacy": re.compile(r"^privacy[:\s]")}

NOTE_FIRST_RUN = ("First-run numbers reflect the old matching; judge re-verify by the next run's "
                  "NEEDS_HUMAN queue length.")
BASES = ("recipe", "repro-steps", "keyword", "none")

# Reasons for tickets that were not replayed.
R_NOT_WALKED = "lens not walked this run"
R_NOT_IN_INV = "lens not in inventory"
R_FILTER = "excluded by filter"
R_CI = "routed to the CI lane (WALK-06), not walked"
R_ADMIN = "admin lens without an admin session (look-only gate check only)"
R_NO_REPLAY = "replay disabled for this run (--no-replay)"
R_BUDGET = "lens time budget exceeded"
R_LOW_MEM = "stopped: low memory before this ticket"
R_ABORT = "stopped: run aborted before this ticket"
R_NOT_REACHED = "stopped: run ended before this ticket"
R_RESUMED = "finished in an earlier attempt of this run (--resume); verdict is in that attempt's reverify.jsonl"


def recipe_kind(tid, res, recipe_ids):
    """'per-ticket' / 'validation' / 'privacy' when a hand-written recipe
    graded the ticket, else None (a keyword-classified standard check)."""
    if tid in (recipe_ids or ()):
        return "per-ticket"
    cat = (res or {}).get("category")
    rx = _CATEGORY_RECIPES.get(cat)
    if rx and rx.search(str((res or {}).get("method") or "")):
        return cat
    return None


def capped_reason(cat):
    return "no hand-written repro recipe; keyword match only (%s)" % (cat or "unclassified")


def cap_verdict(tid, res, recipe_ids):
    """Apply the recipe-only rule in place and return res.

    Every result gets coverage_basis 'recipe' or 'keyword' (+ recipe_kind for
    recipes). A keyword FIXED becomes NEEDS_HUMAN (capped=True, the original
    kept in uncapped_verdict); a keyword STILL_FAILING / NEEDS_HUMAN stands."""
    kind = recipe_kind(tid, res, recipe_ids)
    if kind:
        res["coverage_basis"], res["recipe_kind"] = "recipe", kind
        return res
    res["coverage_basis"] = "keyword"
    if res.get("verdict") == FIXED:
        prior = res.get("notes") or ""
        res["uncapped_verdict"] = FIXED
        res["verdict"] = HUMAN
        res["capped"] = True
        res["notes"] = capped_reason(res.get("category")) + ("; check said: %s" % prior if prior else "")
    return res


def _human_reason(res):
    """Normalized NEEDS_HUMAN reason; the leading clause is the group key."""
    m = str(res.get("method") or "")
    notes = str(res.get("notes") or "").strip()
    low = notes.lower()
    if res.get("capped"):
        return notes or capped_reason(res.get("category"))
    if m == "needs-write" or "--allow-write" in low:
        return "needs --allow-write: " + (notes or "repro needs a create/delete")
    if "fixture" in low and re.search(r"\bno\b|missing|not found", low):
        return "no fixture: " + notes
    if m == "smoke-only" or "not reproducible" in low or "not walkable" in low or "no decision rule" in low:
        return "repro not automatable: " + (notes or "no standard check matches")
    return "needs human: " + (notes or "check gave no reason")


def row_for(tid, t, res=None, skip_reason=None):
    """One coverage row. Exactly one of res / skip_reason is normally given;
    with neither the ticket was never reached."""
    lens = (t or {}).get("lens")
    prior = str((t or {}).get("status") or "OPEN").strip().upper()
    if res is None or res.get("verdict") not in (FIXED, STILL, HUMAN):
        reason = next((str(x).strip() for x in (skip_reason, (res or {}).get("coverage_reason")) if x and str(x).strip()), R_NOT_REACHED)
        return {"id": tid, "lens": lens, "prior_status": prior, "attempted": False,
                "verdict": NOT_ATTEMPTED, "coverage_basis": "none", "reason": reason, "method": None}
    v = res["verdict"]
    basis = res.get("coverage_basis") if res.get("coverage_basis") in ("recipe", "repro-steps", "keyword") else "keyword"
    if v == FIXED and basis not in ("recipe", "repro-steps"):
        # defensive: a FIXED that did not pass through cap_verdict is not trusted
        v = HUMAN
        reason = capped_reason(res.get("category"))
    elif v == HUMAN:
        reason = _human_reason(res)
    elif v == FIXED and basis == "repro-steps":
        reason = "repro_steps replayed (every step mapped + executed, expected outcome machine-checked): %s" % (res.get("method") or "repro-steps")
        if prior != "FIXED_PENDING_VERIFY":
            reason += "; prior %s, not claimed fixed: tester closes" % prior
    elif v == FIXED:
        reason = "recipe repro passes (%s): %s" % (res.get("recipe_kind") or "recipe", res.get("method") or "recipe")
        if prior != "FIXED_PENDING_VERIFY":
            reason += "; prior %s, not claimed fixed: tester closes" % prior
    else:
        reason = "repro still fails (%s): %s" % (basis, res.get("method") or "check")
    return {"id": tid, "lens": lens, "prior_status": prior, "attempted": True, "verdict": v,
            "coverage_basis": basis, "reason": reason.strip() or "needs human: check gave no reason",
            "method": res.get("method")}


def build_rows(scope, results, skipped):
    """scope: [(tid, ticket)] in run order (any statuses; filtered here);
    results: {tid: result}; skipped: {tid: reason}. One row per in-scope ticket."""
    rows, seen = [], set()
    for tid, t in scope:
        if tid in seen or t is None:
            continue
        if str(t.get("status") or "OPEN").strip().upper() not in SCOPE_STATUSES:
            continue
        seen.add(tid)
        rows.append(row_for(tid, t, results.get(tid), skipped.get(tid)))
    for r in rows:
        assert r["reason"] and r["reason"].strip(), "coverage row without a reason: %r" % r
        assert r["verdict"] in VERDICTS and r["coverage_basis"] in BASES, r
    return rows


def reason_key(reason):
    """Group key for 'top reasons': the clause before the first ':' or ';'."""
    k = re.split(r"[:;(]", reason or "", maxsplit=1)[0].strip()
    return k[:80] or "(none)"


def summarize(rows):
    return {"total": len(rows),
            "by_verdict": {v: sum(1 for r in rows if r["verdict"] == v) for v in VERDICTS},
            "attempted": sum(1 for r in rows if r["attempted"]),
            "top_reasons": Counter(reason_key(r["reason"]) for r in rows if r["verdict"] != FIXED).most_common(10)}


def render_md(rows, meta=None):
    meta = meta or {}
    s = summarize(rows)
    out = ["# Reverify coverage %s\n\n" % (meta.get("run_id") or ""),
           "> %s\n\n" % NOTE_FIRST_RUN,
           "Rule: only a hand-written recipe can verify; keyword-only FIXED is capped at NEEDS_HUMAN.\n\n",
           "Live sha: %s · dry: %s · generated: %s\n\n" % (meta.get("live_sha") or "unverified", meta.get("dry"), meta.get("ts") or "-"),
           "## Summary\n\n| verdict | count |\n|---|---|\n"]
    for v in VERDICTS:
        out.append("| %s | %d |\n" % (v, s["by_verdict"][v]))
    out.append("| **total** | **%d** (attempted %d) |\n\n" % (s["total"], s["attempted"]))
    out.append("### Top reasons (non-FIXED)\n\n| reason | tickets |\n|---|---|\n")
    for k, n in s["top_reasons"]:
        out.append("| %s | %d |\n" % (k.replace("|", "/"), n))
    out.append("\n## Rows\n\n| id | lens | prior | attempted | verdict | basis | reason |\n|---|---|---|---|---|---|---|\n")
    for r in rows:
        out.append("| %s | %s | %s | %s | %s | %s | %s |\n" % (
            r["id"], r["lens"], r["prior_status"], "yes" if r["attempted"] else "no", r["verdict"],
            r.get("coverage_basis") or "-", r["reason"].replace("|", "/").replace("\n", " ")[:240]))
    return "".join(out)


def write(dirs, rows, meta=None):
    """Write reverify_coverage.json + .md into every dir in dirs. Returns paths."""
    meta = dict(meta or {})
    doc = {"note": NOTE_FIRST_RUN, "meta": meta, "summary": summarize(rows), "rows": rows}
    md = render_md(rows, meta)
    paths = []
    for d in dirs:
        if not d:
            continue
        os.makedirs(d, exist_ok=True)
        for name, body in (("reverify_coverage.json", json.dumps(doc, indent=1)), ("reverify_coverage.md", md)):
            p = os.path.join(d, name)
            tmp = p + ".tmp"
            with open(tmp, "w") as f:
                f.write(body)
            os.replace(tmp, p)
            paths.append(p)
    return paths


def walked_lenses(run_dirs):
    """Slugs with a finished per-lens result (lens-*.json) in any of run_dirs."""
    out = set()
    for d in run_dirs:
        if not os.path.isdir(d):
            raise SystemExit("--walked-run %s: not a run dir" % d)
        # recursive: a pre-slug-fix walker wrote nested slugs as subdirectories
        # (lens-world-creator/anomalies.json); the slug inside the JSON wins.
        for root, _dirs, files in os.walk(d):
            for fn in files:
                if not fn.endswith(".json"):
                    continue
                rel = os.path.relpath(os.path.join(root, fn), d)
                if not rel.startswith("lens-"):
                    continue
                try:
                    slug = json.load(open(os.path.join(root, fn))).get("slug")
                except Exception:
                    slug = None
                out.add(slug or rel[5:-5])
    return out
