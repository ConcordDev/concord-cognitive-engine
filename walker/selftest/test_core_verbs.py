#!/usr/bin/env python3
"""GB-1576 W5a — core-verb truth, exercised hermetically: the shipped
spec file validates against the inventory spine (exact 270 coverage);
the pure verdict layer judges every observation shape with the FAIL /
UNSPECIFIED discipline (FAIL only when the verb was genuinely exercised
and the truth failed); the dossier gate + score wiring reads the verdict
exactly as GB-1576 orders (polished cannot PASS on a failed core verb;
FAIL -40, present UNSPECIFIED -10, absent block nothing — so the W2
hand-computed fixture scores stand).

Run: python3 selftest/test_core_verbs.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import core_verbs as cv
from concord_walker import dossier

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name +
          ((" " + str(extra)[:300]) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def main():
    # ---- the shipped spec file, against the inventory spine
    inv = json.load(open(os.path.join(HERE, "inventory.json")))
    slugs = [e["slug"] for e in inv]
    doc = cv.load_spec_doc()
    check("spec doc loads", isinstance(doc, dict))
    problems = cv.validate_doc(doc, slugs)
    check("spec doc valid + exact 270 coverage", problems == [], problems[:4])
    check("270 lens specs", len(doc["lenses"]) == 270, len(doc["lenses"]))
    conf = [s for s, e in doc["lenses"].items() if e["status"] == "confirmed"]
    check("15 confirmed specs (the W1 study set)", len(conf) == 15, sorted(conf))
    pinned = [s for s, e in doc["lenses"].items() if e["action"]]
    check("pinned actions on the majority", len(pinned) >= 200, len(pinned))

    spec = cv.spec_for(doc, "studio")
    check("spec_for studio", spec and spec["action"] == {"domain": "studio", "name": "project-create"}, spec)
    check("spec_for unknown lens", cv.spec_for(doc, "no-such-lens") is None)

    # ---- validation catches broken entries
    bad = {"verb": "", "visibility": "everyone", "status": "final",
           "steps": [], "action": {"domain": "x"}}
    probs = cv.validate_spec("badlens", bad)
    check("validate_spec catches bad entries", len(probs) >= 4, probs)

    # ---- money discipline
    check("money action detected", cv.is_money_action({"action": {"domain": "retail", "name": "cart-tender"}}))
    check("create action not money", not cv.is_money_action({"action": {"domain": "marketplace", "name": "listings-create"}}))
    p = cv.plan({"action": {"domain": "retail", "name": "cart-tender"}, "status": "draft"},
                has_observer=True)
    check("money plan never runs", p["run"] is False and "money" in p["reason"], p)
    p = cv.plan(None, has_observer=True)
    check("no-spec plan named", p["run"] is False and "no core-verb spec" in p["reason"], p)
    p = cv.plan(spec, has_observer=False)
    check("no-observer plan named", p["run"] is False and "observer" in p["reason"], p)
    p = cv.plan(spec, has_observer=True)
    check("pinned spec plan runs", p["run"] is True, p)

    # ---- bodies + ids
    body = cv.verb_body(spec, "LBL")
    check("verb body shape", body["domain"] == "studio" and body["action"] == "project-create"
          and body["args"]["title"] == "LBL", body)
    cb = cv.cleanup_body(spec, 42)
    check("cleanup body shape", cb == {"domain": "studio", "action": "project-delete",
                                       "args": {"id": 42}}, cb)
    check("cleanup body needs an id", cv.cleanup_body(spec, None) is None)
    check("extract id top-level", cv.extract_object_id({"id": "abc"}) == "abc")
    check("extract id nested", cv.extract_object_id({"data": {"_id": 7}}) == 7)
    check("extract id absent", cv.extract_object_id({"ok": True}) is None)
    check("default args template", cv.build_args({"args": None}, "L") == {"title": "L", "name": "L"})

    # ---- build_args recursion (pinning pass 2026-11-21): {label} is
    # substituted inside nested objects and lists, scalars untouched.
    nested = {"args": {"a": {"domain": "music", "title": "{label} (side A)"},
                       "objectives": [{"type": "observe", "target": "{label}"}],
                       "mood": 3, "flag": True, "none": None}}
    built = cv.build_args(nested, "LBL")
    check("build_args nested dict substitution",
          built["a"] == {"domain": "music", "title": "LBL (side A)"}, built)
    check("build_args nested list substitution",
          built["objectives"] == [{"type": "observe", "target": "LBL"}], built)
    check("build_args scalars pass through",
          built["mood"] == 3 and built["flag"] is True and built["none"] is None, built)

    # ---- drive classification
    check("drive performed", cv.classify_drive(200, {"ok": True}) == "performed")
    check("drive refused body is failed", cv.classify_drive(200, {"ok": False, "error": "nope"}) == "failed")
    check("drive 500 failed", cv.classify_drive(500, None) == "failed")
    check("drive 403 failed", cv.classify_drive(403, {"error": "forbidden"}) == "failed")
    check("drive validation 400 inconclusive",
          cv.classify_drive(400, {"error": "title is required"}) == "inconclusive")
    check("drive 404 inconclusive", cv.classify_drive(404, None) == "inconclusive")
    check("drive transport inconclusive", cv.classify_drive(None, None) == "inconclusive")

    # ---- the verdict matrix
    priv = {"action": {"domain": "studio", "name": "project-create"},
            "visibility": "private", "status": "confirmed", "verb": "create a song project",
            "steps": ["s1"]}
    pub = dict(priv, visibility="public")
    v, _ = cv.verdict(None, drive="performed", persisted=True, observer_sees=False)
    check("verdict no spec UNSPECIFIED", v == "CORE_VERB_UNSPECIFIED")
    v, _ = cv.verdict({"action": None, "visibility": "private"}, drive="performed",
                      persisted=True, observer_sees=False)
    check("verdict unpinned UNSPECIFIED", v == "CORE_VERB_UNSPECIFIED")
    v, _ = cv.verdict(priv, drive="inconclusive", persisted=None, observer_sees=None)
    check("verdict inconclusive drive UNSPECIFIED", v == "CORE_VERB_UNSPECIFIED")
    v, r = cv.verdict(priv, drive="failed", persisted=None, observer_sees=None)
    check("verdict failed drive FAIL", v == "CORE_VERB_FAIL", r)
    v, r = cv.verdict(priv, drive="performed", persisted=False, observer_sees=False)
    check("verdict not persisted FAIL", v == "CORE_VERB_FAIL", r)
    v, _ = cv.verdict(priv, drive="performed", persisted=None, observer_sees=False)
    check("verdict persistence unprovable UNSPECIFIED", v == "CORE_VERB_UNSPECIFIED")
    v, r = cv.verdict(priv, drive="performed", persisted=True, observer_sees=True)
    check("verdict private seen by observer FAIL", v == "CORE_VERB_FAIL", r)
    v, r = cv.verdict(pub, drive="performed", persisted=True, observer_sees=False)
    check("verdict public unseen FAIL", v == "CORE_VERB_FAIL", r)
    v, _ = cv.verdict(priv, drive="performed", persisted=True, observer_sees=None)
    check("verdict visibility unprovable UNSPECIFIED", v == "CORE_VERB_UNSPECIFIED")
    v, _ = cv.verdict(priv, drive="performed", persisted=True, observer_sees=False)
    check("verdict private PASS", v == "CORE_VERB_PASS")
    v, _ = cv.verdict(pub, drive="performed", persisted=True, observer_sees=True)
    check("verdict public PASS", v == "CORE_VERB_PASS")

    blk = cv.core_verb_block(priv, "CORE_VERB_PASS", "ok", drive="performed",
                             persisted=True, observer_sees=False, cleanup="deleted")
    check("block shape", blk["verdict"] == "CORE_VERB_PASS" and blk["action"] == "studio.project-create"
          and blk["cleanup"] == "deleted" and blk["repro"][-1].startswith("Observed:"), blk)

    # ---- dossier wiring (GB-1576's gate + heavy score weight)
    def gates_score(rec):
        g = dossier._gates(rec, {"provenance": "clean_happy_path"},
                           {"flags": []}, {})
        s = dossier._score({"flags": []}, {"orphaned": []}, {"hidden_actions": []},
                           [], {"counts": {}}, g)
        return g, s
    base = {"findings": [], "two_account": {"status": "PASS"}, "premap_findings": []}
    g, s = gates_score(dict(base))
    check("dossier: absent block -> core_verb gate NOT_RUN, no deduction, polished PASS",
          g["core_verb"]["status"] == "NOT_RUN" and s["deductions"]["live"]["core_verb"] == 0
          and g["polished"]["status"] == "PASS" and s["score"] == 100, (g, s))
    g, s = gates_score(dict(base, core_verb={"verdict": "CORE_VERB_FAIL",
                                             "spec_status": "confirmed",
                                             "verb": "create a song project"}))
    check("dossier: FAIL -> polished FAIL + gate FAIL + -40",
          g["polished"]["status"] == "FAIL" and g["core_verb"]["status"] == "FAIL"
          and s["deductions"]["live"]["core_verb"] == 40, (g, s))
    g, s = gates_score(dict(base, core_verb={"verdict": "CORE_VERB_UNSPECIFIED",
                                             "spec_status": "draft", "verb": "x"}))
    check("dossier: UNSPECIFIED -> -10, polished untouched",
          s["deductions"]["live"]["core_verb"] == 10 and g["polished"]["status"] == "PASS"
          and g["core_verb"]["status"] == "UNSPECIFIED", (g, s))
    g, s = gates_score(dict(base, core_verb={"verdict": "CORE_VERB_PASS",
                                             "spec_status": "draft", "verb": "x"}))
    check("dossier: PASS -> no deduction",
          s["deductions"]["live"]["core_verb"] == 0 and s["score"] == 100, (g, s))

    # ---- the pinning pass of 2026-11-21 (CB-1054 seating): the 55
    # formerly-null entries are resolved — 33 pinned with dict args,
    # 22 null with the specific blocker named in a substantive note —
    # and the doc's counts block tallies with the entries themselves.
    PINNED_1121 = ["chat", "goals", "resonance", "math", "genesis", "translation",
                   "cri", "affect", "quests", "lfg", "mail", "spectate", "settings",
                   "fishing", "creatures", "garage", "move-builder", "careers",
                   "byo-keys", "cognition", "crisis-ops", "deities", "expert-mode",
                   "forecast", "foundry", "goddess", "kingdoms", "maker", "saved",
                   "sentinel", "sessions", "wellness", "ops-telemetry"]
    NULL_1121 = ["dtus", "literary", "auction", "achievements", "training-room",
                 "housing", "announcements", "detective", "narrative-walk",
                 "courtship", "repair-telemetry", "codex", "civic-bonds",
                 "death-insurance", "dreams", "ghost-tracker", "lattice", "ledger",
                 "personas", "plugins", "strategic-adds", "world-observatory"]
    lenses = doc["lenses"]
    check("pinning pass: all 33 pins carry an action + dict args",
          all(lenses[s].get("action") and isinstance(lenses[s].get("args"), dict)
              for s in PINNED_1121))
    check("pinning pass: all 22 nulls stay null with a substantive named blocker",
          all(not lenses[s].get("action") and len(lenses[s].get("note") or "") >= 200
              for s in NULL_1121))
    tally = {"confirmed": 0, "draft_action": 0, "draft_null": 0}
    for s in lenses.values():
        if s["status"] == "confirmed":
            tally["confirmed"] += 1
        elif s.get("action"):
            tally["draft_action"] += 1
        else:
            tally["draft_null"] += 1
    check("pinning pass: counts block tallies with the entries", doc["counts"] == tally,
          (doc["counts"], tally))
    check("pinning pass: no money-class action among the pins",
          not any(cv.is_money_action(lenses[s]) for s in PINNED_1121))

    # ---- wiring: the leg exists and rides the isolation phase
    src = open(os.path.join(HERE, "concord_walker", "checks.py")).read()
    check("core_verb_phase defined", "def core_verb_phase(self, owner, observer)" in src)
    check("phase rides isolation_phase", "self.core_verb_phase(owner, observer)" in src)

    print("FAILURES: %d" % len(FAILS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
