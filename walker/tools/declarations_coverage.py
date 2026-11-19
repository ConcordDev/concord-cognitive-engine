#!/usr/bin/env python3
"""ULW C22: declarations-coverage metric for the roll-ups (Gate section 9).

  declarations_coverage.py --snapshot actions-<sha12>.json.gz [--recipes DIR]
                           [--compute-domains chem,engineering,physics,math,science]
                           [--out-json F] [--out-md F]

Gate section 9: "Declarations coverage (declared compute actions / total
compute actions) is a named programme metric in the roll-ups, starting
from the 2 / 146 baseline on f4f1f77ff -- and value-asserting recipes are
counted in TWO separate numbers, never one: correctness coverage
(independently-backed assertions only) and drift coverage
(self-referenced assertions)."

Definitions (named in every emission; a redefinition is a visible event,
never a silent rebase):
  compute actions  = registry actions whose domain is in the compute set.
                     The default set {chem, engineering, physics, math,
                     science} reproduces the Gate baseline exactly at
                     f4f1f77ff: 146 actions.
  declared         = a compute action whose receipt_class is PRODUCT
                     (a registerDeclaration certifies it). Baseline: 2
                     (chem.equilibrium, engineering.beamStudy); the
                     snapshot's own counts.declarations cross-checks.
  value assertion  = a recipe entry carrying an expected VALUE plus the
                     declaration's EXISTING review-source label
                     (independent -> correctness; self / self-referenced
                     -> drift). An expected value with NO source label is
                     counted as UNLABELLED and enters NEITHER number --
                     a change detector wearing a correctness badge is the
                     failure Gate section 9 exists to prevent.
Read-only. Inputs are the action_registry.py snapshot and a walker
recipes directory (walker/recipes at any checkout of the corpus).
"""
import argparse, glob, gzip, json, os, sys

DEFAULT_COMPUTE_DOMAINS = ("chem", "engineering", "physics", "math", "science")
BASELINE = {"declared": 2, "total": 146, "sha": "f4f1f77ff"}
VALUE_KEYS = ("expected_value", "assert_value", "expected", "value")
SOURCE_KEYS = ("review_source", "review-source", "assertion_source",
               "expected_source", "source")
INDEPENDENT = {"independent", "independently-backed", "checker", "external"}
SELF_REF = {"self", "self-referenced", "self_referenced", "solver", "own"}


def load_snapshot(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def _walk_entries(node):
    """Yield every dict nested in a recipe (steps, adversarial, assertions)."""
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk_entries(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk_entries(v)


def classify_recipe(recipe):
    """Return 'correctness' | 'drift' | 'unlabelled' | None for one recipe."""
    found = None
    for entry in _walk_entries(recipe):
        if not any(k in entry for k in VALUE_KEYS):
            continue
        src = None
        for k in SOURCE_KEYS:
            if k in entry and isinstance(entry[k], str):
                src = entry[k].strip().lower()
                break
        if src in INDEPENDENT:
            return "correctness"          # strongest class wins
        if src in SELF_REF:
            found = found or "drift"
        else:
            found = found or "unlabelled"
    return found


def coverage(snapshot, recipes_dir=None, compute_domains=DEFAULT_COMPUTE_DOMAINS):
    domains = set(compute_domains)
    actions = snapshot.get("actions", [])
    compute = [a for a in actions if a.get("domain") in domains]
    declared = [a for a in compute if a.get("receipt_class") == "PRODUCT"]
    out = {
        "sha": snapshot.get("sha"),
        "compute_domains": sorted(domains),
        "declarations_coverage": {
            "declared": len(declared),
            "total_compute_actions": len(compute),
            "declared_actions": sorted("%s.%s" % (a["domain"], a["action"])
                                       for a in declared),
            "undeclared_compute_actions": len(compute) - len(declared),
            "snapshot_declaration_count": (snapshot.get("counts") or {}).get("declarations"),
        },
        "baseline": dict(BASELINE),
        "value_asserting_recipes": {"correctness": 0, "drift": 0,
                                    "unlabelled": 0, "recipes_scanned": 0},
    }
    dc = out["declarations_coverage"]
    out["baseline_reproduced"] = (
        dc["declared"] == BASELINE["declared"]
        and dc["total_compute_actions"] == BASELINE["total"]
        and str(out["sha"] or "").startswith(BASELINE["sha"]))
    if recipes_dir:
        counts = {"correctness": 0, "drift": 0, "unlabelled": 0}
        scanned = 0
        for path in sorted(glob.glob(os.path.join(recipes_dir, "*.json"))):
            try:
                with open(path, encoding="utf-8") as fh:
                    recipe = json.load(fh)
            except Exception:
                continue
            scanned += 1
            cls = classify_recipe(recipe)
            if cls:
                counts[cls] += 1
        counts["recipes_scanned"] = scanned
        out["value_asserting_recipes"] = counts
    return out


def render_md(m):
    dc = m["declarations_coverage"]
    va = m["value_asserting_recipes"]
    return "\n".join([
        "## Declarations coverage (Gate section 9, ULW C22)",
        "",
        "- Declarations coverage: **%d / %d** compute actions declared "
        "(sha %s; compute domains: %s; baseline %d/%d on %s -- %s)."
        % (dc["declared"], dc["total_compute_actions"], m["sha"],
           ", ".join(m["compute_domains"]), m["baseline"]["declared"],
           m["baseline"]["total"], m["baseline"]["sha"],
           "reproduced" if m["baseline_reproduced"] else "NOT reproduced"),
        "- Declared: %s." % (", ".join(dc["declared_actions"]) or "none"),
        "- Correctness coverage (independently-backed value assertions): **%d** recipes."
        % va["correctness"],
        "- Drift coverage (self-referenced value assertions): **%d** recipes."
        % va["drift"],
        "- Unlabelled value assertions (counted in NEITHER number): %d; "
        "recipes scanned: %d." % (va["unlabelled"], va["recipes_scanned"]),
        "",
    ])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--snapshot", required=True)
    ap.add_argument("--recipes", default=None)
    ap.add_argument("--compute-domains", default=",".join(DEFAULT_COMPUTE_DOMAINS))
    ap.add_argument("--out-json", default=None)
    ap.add_argument("--out-md", default=None)
    args = ap.parse_args(argv)
    snap = load_snapshot(args.snapshot)
    m = coverage(snap, args.recipes,
                 [d.strip() for d in args.compute_domains.split(",") if d.strip()])
    text = json.dumps(m, indent=2, sort_keys=True)
    if args.out_json:
        with open(args.out_json, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    if args.out_md:
        with open(args.out_md, "w", encoding="utf-8") as fh:
            fh.write(render_md(m))
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
