#!/usr/bin/env python3
"""Mapped-step rate + VERIFIED-eligible rate of the repro_steps mapper (backward compatible).

  python3 tools/mapped_rate.py --repo .. --sha 272e62f41 --n 200 --seed 20261116      # seeded sample
  python3 tools/mapped_rate.py --repo .. --sha 272e62f41 --all                        # every ticket with repro_steps

Reports
  * steps mapped / steps total, tickets with ALL steps mapped / tickets;
  * VERIFIED-eligible = tickets with every step mapped AND every `expected` clause in a
    machine-checkable kind (a clause no machine check can read is `unchecked`), plus the counts
    of the blocking reasons (steps only / expected only / both);
  * per-class remaining unmapped step counts (regex classes from the 2026-11-16 mapping-gap diagnosis).
Eligibility is NOT a verdict: a ticket still verifies only through the single VERIFIED gate
(every step ran, every clause machine-checked on live evidence, run id + sha + evidence path).

Uses repro.expand_step when present (breadcrumb mapper) else the legacy repro.map_step, and
repro.classify_expected when present (typed clauses) else the legacy check_clause-on-an-empty-snapshot
test, so the SAME script and definition measure BEFORE and AFTER."""
import argparse, json, os, random, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro, rewrites as _rw
from concord_walker.fold import extract_from_git

_EMPTY = {"controls": [], "texts": [], "dialogs": [], "errors": 0}

# failure classes (diagnosis 2026-11-16), first match wins; applied to an unmapped step's raw text
_I = re.I
CLASSES = [
    ("no_text", r"^\s*(see evidence|n/?a|none|x|-|tbd)\.?\s*$"),
    ("evidence_pointer", r"^\s*see\b[^.]{0,40}\bevidence/"),   # a pointer to an evidence file, not a reproduction: nothing to replay
    ("guard_meta", r"(?:^|[.;,]\s*)(?:do not|don't|never|if\b|repeat|wait\b|until\b|unless)"),
    ("viewport_theme", r"\b\d{3,4}\s*[x×]\s*\d{3,4}\b|\b(mobile|viewport|device toolbar|desktop|dark theme|light theme|theme toggle|dark mode|light mode|zoom|reduced motion|offline)\b"),
    ("tooling_console_net_a11y", r"devtools|console|network|accessibility (?:tree|pane)|a11y|lighthouse|waterfall|screen ?reader|axe\b|performance"),
    ("keyboard_prose", r"\b(?:tab|shift\+tab|arrow\w*|esc(?:ape)?|focus|blur|keyboard)\b"),
    ("chat_ask", r"\bask\b|send question|lens tools|quick capture"),
    ("observe_in_step", r"\b(?:inspect|observe|look for|check whether|record|whether)\b"),
    ("bad_input_value", r"(?:-\d|\b0\b|\b9{5,}|\d{3}-?char|\bempty\b|\bblank\b|'[^']{0,25}'|\bnegative|\binvalid\b|\bpaste\b)"),
    ("export_flow", r"\bexport\b|\bdownload\b|\b(?:json|csv)\b"),
    ("delete_flow", r"\b(?:delete|remove|trash|revoke|archive|cancel)\b"),
    ("create_fill_flow", r"\b(?:create|add|new|make|log|save|submit|schedule|import|fill|record|set|edit|rename|enter|type|upload|join|leave|run|start|apply|generate|send|post|publish)\b"),
    ("generic_target", r"\b(?:a|an|any|each|every|some|first|one|another)\s+\w+"),
]


def classify_unmapped(raw):
    for name, rx in CLASSES:
        if re.search(rx, raw or "", _I):
            return name
    return "prose_other"


def step_mapped(raw, lens):
    fn = getattr(repro, "expand_step", None)
    if fn:
        return bool(fn(raw, lens)["mapped"])
    return bool(repro.map_step(raw, lens)["mapped"])


def expected_all_checkable(ticket):
    """(ok, n_clauses, n_unchecked). ok: >=1 clause and every clause has a machine-checkable kind
    (the ticket's `expected` plus, in the new mapper, the clauses its observe steps moved there)."""
    expected = ticket.get("expected")
    tk = getattr(repro, "ticket_expected_kinds", None)
    cl = getattr(repro, "classify_expected", None)
    if tk:
        kinds = tk(ticket)  # [(clause, kind|None)]
        un = sum(1 for _, k in kinds if k is None)
        return bool(kinds) and un == 0, len(kinds), un
    if cl:
        kinds = cl(expected)
        un = sum(1 for _, k in kinds if k is None)
        return bool(kinds) and un == 0, len(kinds), un
    clauses = repro._clauses(expected)
    un = sum(1 for c in clauses if repro.check_clause(c, _EMPTY)[0] == "unchecked")
    return bool(clauses) and un == 0, len(clauses), un


def measure(tickets, with_reasons=False, rewrites=None, labels=None):
    steps = mapped = full = eligible = 0
    blocked_expected = blocked_steps = blocked_both = 0
    clauses = clauses_unchecked = 0
    unmapped, by_class = {}, {}
    rw_used = rw_rejected = orig_suff = 0
    rejected_by, human_by, eligible_rw, eligible_orig = {}, {}, 0, 0
    for t in tickets:
        used_rw = False
        if rewrites:
            t2, info = _rw.prepare(t, rewrites, labels)
            if info["source"] == "rewrite":
                t, used_rw = t2, True
                rw_used += 1
            elif info["source"] == "original_sufficient":
                orig_suff += 1
            elif info["source"] == "rewrite_disagrees":
                rw_rejected += 1
                rejected_by[info["reason"]] = rejected_by.get(info["reason"], 0) + 1
            elif info["source"] == "human_only":
                human_by[info["reason"]] = human_by.get(info["reason"], 0) + 1
                t = dict(t, _human_only=True)   # never replayed from a rewrite: NEEDS_HUMAN, never eligible
        raws = repro.split_steps(t)
        ok = [step_mapped(r, t.get("lens")) for r in raws]
        steps += len(ok)
        mapped += sum(ok)
        all_ok = bool(ok) and all(ok)
        exp_ok, nc, nu = expected_all_checkable(t)
        clauses += nc
        clauses_unchecked += nu
        if all_ok:
            full += 1
        if t.get("_human_only"):
            all_ok = exp_ok = False      # NEEDS_HUMAN: a human_only ticket is never eligible
        if all_ok and exp_ok:
            eligible += 1
            if used_rw:
                eligible_rw += 1
            else:
                eligible_orig += 1
        elif all_ok:
            blocked_expected += 1
        elif exp_ok:
            blocked_steps += 1
        else:
            blocked_both += 1
        for r, o in zip(raws, ok):
            if not o:
                c = classify_unmapped(r)
                by_class[c] = by_class.get(c, 0) + 1
                if with_reasons:
                    unmapped[r] = t.get("id")
    n = len(tickets)
    return {"tickets": n, "steps": steps, "steps_mapped": mapped,
            "step_rate": round(mapped / steps, 4) if steps else 0.0,
            "tickets_all_mapped": full, "ticket_rate": round(full / n, 4) if n else 0.0,
            "verified_eligible_tickets": eligible, "verified_eligible_rate": round(eligible / n, 4) if n else 0.0,
            "blocked_by": {"expected_unchecked_only": blocked_expected, "steps_unmapped_only": blocked_steps, "both": blocked_both},
            "clauses": clauses, "clauses_unchecked": clauses_unchecked,
            "all_mapped_but_expected_unchecked": blocked_expected,  # legacy key (kept for older callers)
            "rewrites": {"rewrite_backed": rw_used, "original_only": n - rw_used, "original_sufficient": orig_suff, "rejected_by_agree": rw_rejected, "rejected_by_reason": rejected_by,
                         "human_only_by_reason": human_by, "eligible_rewrite_backed": eligible_rw, "eligible_original_only": eligible_orig} if rewrites else None,
            "unmapped_by_class": dict(sorted(by_class.items(), key=lambda kv: -kv[1])),
            "unmapped_examples": unmapped}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="..")
    ap.add_argument("--sha", default="272e62f41")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--all", action="store_true", help="measure every ticket with repro_steps instead of a sample")
    ap.add_argument("--seed", type=int, default=20261116)
    ap.add_argument("--rewrites", default=None, help="directory of batch-*.jsonl rewrites (default off: measures the original text only)")
    ap.add_argument("--show-unmapped", type=int, default=0)
    a = ap.parse_args()
    fold = extract_from_git(a.repo, a.sha)
    pool = sorted((t for t in fold.base.values() if repro.split_steps(t)), key=lambda t: t["id"])
    sample = pool if a.all else random.Random(a.seed).sample(pool, min(a.n, len(pool)))
    print("seed=%d sha=%s pool=%d measured=%d mode=%s mapper=%s expected=%s" % (
        a.seed, a.sha, len(pool), len(sample), "all" if a.all else "sample",
        "expand_step" if hasattr(repro, "expand_step") else "map_step",
        "classify_expected" if hasattr(repro, "classify_expected") else "legacy"))
    rwi = _rw.load_dir(a.rewrites) if a.rewrites else None
    r = measure(sample, with_reasons=bool(a.show_unmapped), rewrites=rwi)
    ex = r.pop("unmapped_examples")
    print(json.dumps(r, indent=1))
    for raw, tid in list(ex.items())[:a.show_unmapped]:
        print("  UNMAPPED %s: %s" % (tid, raw[:140]))


if __name__ == "__main__":
    main()
