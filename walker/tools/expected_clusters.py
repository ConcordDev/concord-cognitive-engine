#!/usr/bin/env python3
"""Cluster table for `expected` clauses (ULW pass 2). Read-only; same fold + same ticket pool as mapped_rate.py --all.

  python3 tools/expected_clusters.py --repo .. --sha 272e62f41

For EVERY clause of EVERY ticket with repro_steps (sentence splitter = expected.split_clauses, plus the
clauses observe-steps move to the expected side) it prints, per kind:
  clauses | tickets | fully-mapped-but-expected-blocked tickets that contain it | tickets that kind ALONE
  would unblock (every other clause already checkable) | % of the blocked set | 3 real examples.
Unclassified clauses are bucketed into families (what a predicate would have to read), so the next kind to
build is the biggest remaining bucket. A clause no family reads stays `vague/fragment` (NEEDS_HUMAN)."""
import argparse, collections, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro
from concord_walker.fold import extract_from_git

FAMILIES = [
    ("fam:esc/focus", r"\besc(ape)?\b|focus (return|restor|trap|stays|moves|visible|ring|order|contain)|returns? focus|focus is|focus on|\barrow|tab order|keyboard"),
    ("fam:validation", r"reject|invalid|validat|required|clamp|inline (error|message)|error message|not allowed|cannot|must be|blocked|disabled|prevent|ignored|negative|greater than|range|too (long|short)"),
    ("fam:confirm", r"confirm|are you sure|undo"),
    ("fam:no-error", r"\bno (console |page |js )?(errors?|crash|exception|5\d\d|4\d\d|failed|blank|white)|without error|doesn.t crash|not crash|loads without|failed request"),
    ("fam:export", r"export|download|csv|json|file"),
    ("fam:a11y", r"accessible name|aria|label(l)?ed|unnamed|alt text|screen reader|heading|contrast|wcag"),
    ("fam:layout", r"overflow|clip|overlap|390|horizontal scroll|fits?|wrap|truncat|cut off|responsive|cover|mobile"),
    ("fam:persist", r"persist|reload|survive|refresh|saved|remembered|retain|after (a )?(reload|nav)|still (there|present)"),
    ("fam:status", r"\b[2-5]\d\d\b|status|http"),
    ("fam:created/list", r"appears?|listed|created|added|shows? up|new (item|row|entry)|in the list|row|table"),
    ("fam:text", r"\bshows?\b|\bdisplays?\b|\bvisible\b|\bpresent\b|\blists?\b|\bcontains?\b|\bincludes?\b|\breads?\b|\bsays?\b|\bbadge|\blabel"),
    ("fam:perf", r"\bunder \d|\bwithin \d|\bms\b|\bsec(ond)?s?\b|spinner|skeleton|loading"),
]


def family(cl):
    for n, rx in FAMILIES:
        if re.search(rx, cl, re.I):
            return n
    return "vague/fragment"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="..")
    ap.add_argument("--sha", default="272e62f41")
    a = ap.parse_args()
    fold = extract_from_git(a.repo, a.sha)
    pool = sorted((t for t in fold.base.values() if repro.split_steps(t)), key=lambda t: t["id"])
    clauses = collections.Counter()
    tix = collections.defaultdict(set)
    ex = collections.defaultdict(list)
    per = {}
    blocked = set()
    for t in pool:
        ks = repro.ticket_expected_kinds(t)
        per[t["id"]] = ks
        steps_ok = all(repro.expand_step(r, t.get("lens"))["mapped"] for r in repro.split_steps(t))
        exp_ok = bool(ks) and all(k for _, k in ks)
        if steps_ok and not exp_ok:
            blocked.add(t["id"])
        for cl, k in ks:
            key = k if k else family(cl)
            clauses[key] += 1
            tix[key].add(t["id"])
            if len(ex[key]) < 3:
                ex[key].append("%s: %s" % (t["id"], cl[:90]))
    total = sum(clauses.values())
    print("tickets=%d clauses=%d blocked(fully-mapped, expected-blocked)=%d" % (len(pool), total, len(blocked)))
    print("| kind | clauses | tickets | in blocked set | alone unblocks | %% of blocked | examples |\n|---|---:|---:|---:|---:|---:|---|")
    for key, n in clauses.most_common():
        inb = len(tix[key] & blocked)
        alone = 0
        for tid in tix[key] & blocked:
            others = [k2 if k2 else family(c2) for c2, k2 in per[tid]]
            if all(o == key or not o.startswith(("fam:", "vague")) for o in others):
                alone += 1
        print("| %s | %d | %d | %d | %d | %.1f%% | %s |" % (key, n, len(tix[key]), inb, alone, 100.0 * alone / max(1, len(blocked)), " ; ".join(ex[key]).replace("|", "/")))


if __name__ == "__main__":
    main()
