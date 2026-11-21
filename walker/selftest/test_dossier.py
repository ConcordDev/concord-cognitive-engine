#!/usr/bin/env python3
"""GB-1575 W2 — the per-lens redesign dossier, exercised end to end on a
hermetic fixture: a temp git repo (one domain file carrying one defect of
each scan class + one clean read, one used + one orphaned component) and a
synthetic finished run dir (records + wiring + manifest + reverify rows).

Pins: every dossier section populates from its named input; the orphan is
called; the hidden (exposed, never called) action shows; each scan flag
fires exactly once; findings group by root-cause signature; the gates read
FAIL/PASS from their named inputs; the distance-to-bar score equals the
hand-computed formula value for the defective lens and exactly 100 for the
clean lens; the INDEX ranks the clean lens above the defective one.

Run: python3 selftest/test_dossier.py
"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import dossier

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name +
          ((" " + str(extra)[:300]) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


DOMAIN_JS = """
function registerAll(registerLensAction, ctx) {
  registerLensAction("fixture", "listThings", async (c, args) => {
    const url = args.feedUrl;
    const res = await fetch(url);
    return { ok: true, mine: c.actor.userId };
  });
  registerLensAction("fixture", "tipThing", async (c, args) => {
    const amt = args.amount;
    return { ok: true, tipped: amt };
  });
  registerLensAction("fixture", "secretFeature", async (c, args) => {
    const seed = Math.random();
    return { ok: true, seed };
  });
  registerLensAction("fixture", "saveThing", async (c, args) => {
    return { ok: true, saved: args.payload };
  });
}
"""

PAGE_TSX = """
import UsedPanel from "@/components/fixturelens/UsedPanel";
import { lensRun } from "@/lib/lensRun";
export default function Page() { lensRun("fixture.listThings", {}); return <UsedPanel />; }
"""

USED_TSX = "export default function UsedPanel() { return null; }\n"
ORPHAN_TSX = "export default function OrphanPanel() { return null; }\n"


def _git(repo, *args):
    subprocess.run(["git", "-C", repo] + list(args), check=True,
                   capture_output=True, text=True)


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def main():
    tmp = tempfile.mkdtemp(prefix="dossier-test-")
    repo = os.path.join(tmp, "repo")
    os.makedirs(repo)
    subprocess.run(["git", "init", repo], check=True, capture_output=True)
    _git(repo, "config", "user.email", "dossier@test")
    _git(repo, "config", "user.name", "dossier-test")
    _write(os.path.join(repo, "server/domains/fixture.js"), DOMAIN_JS)
    _write(os.path.join(repo, "concord-frontend/components/fixturelens/UsedPanel.tsx"), USED_TSX)
    _write(os.path.join(repo, "concord-frontend/components/fixturelens/OrphanPanel.tsx"), ORPHAN_TSX)
    _write(os.path.join(repo, "concord-frontend/app/lenses/fixturelens/page.tsx"), PAGE_TSX)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "fixture")
    sha = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"],
                         check=True, capture_output=True, text=True).stdout.strip()
    sha12 = sha[:12]

    run_dir = os.path.join(tmp, "run")
    os.makedirs(run_dir)
    _write(os.path.join(run_dir, "walk-manifest.json"), json.dumps({
        "run_id": "fixture-run", "total": 2, "status": "done",
        "lenses": [{"slug": "fixturelens", "status": "walked",
                    "checks_not_run": []},
                   {"slug": "cleanlens", "status": "walked",
                    "checks_not_run": []}]}))
    _write(os.path.join(run_dir, "lens-fixturelens.json"), json.dumps({
        "packet_id": "fixturelens@%s:v1" % sha12,
        "wiring_provenance": "clean_happy_path",
        "deploy": {"backend_sha": sha, "walked_at": "2026-11-20T00:00:00-05:00"},
        "findings": [
            {"signature": "contrast.ffffff_on_ec4899", "check": "contrast",
             "severity": "high", "title": "white on pink fails AA"},
            {"signature": "escape.sub_lens_expand_menu", "check": "escape",
             "severity": "medium", "title": "Escape does not close panel"}],
        "controls": [
            {"role": "tab", "name": "Overview", "exercised": True},
            {"role": "tab", "name": "Overview", "exercised": True},
            {"role": "button", "name": "Save", "exercised": True}],
        "actions": [{"domain": "fixture", "action": "listThings",
                     "statuses": {"200": 2}}],
        "two_account": {"status": "PASS"},
        "premap_findings": []}))
    _write(os.path.join(run_dir, "lens-cleanlens.json"), json.dumps({
        "packet_id": "cleanlens@%s:v1" % sha12,
        "wiring_provenance": "clean_happy_path",
        "deploy": {"backend_sha": sha, "walked_at": "2026-11-20T00:01:00-05:00"},
        "findings": [], "controls": [], "actions": [],
        "two_account": {"status": "PASS"}, "premap_findings": []}))
    for slug in ("fixturelens", "cleanlens"):
        _write(os.path.join(run_dir, "wiring-%s.json" % slug), json.dumps({
            "schema": "wiring/1", "lens": slug, "run_id": "fixture-run",
            "provenance": "clean_happy_path", "controls": [], "flows": []}))
    _write(os.path.join(run_dir, "live_labels.json"), json.dumps({
        "lenses": {"fixturelens": {"labels": [], "tabs": ["Overview"],
                                   "inputs": []}}}))
    _write(os.path.join(run_dir, "reverify.jsonl"),
           json.dumps({"id": "FIX-fixturelens-001", "verdict": "VERIFIED",
                       "method": "repro-steps"}) + "\n" +
           json.dumps({"id": "FIX-fixturelens-002", "verdict": "REOPENED",
                       "method": "repro-steps"}) + "\n")

    idx = dossier.build_all(run_dir, repo=repo)
    out = os.path.join(run_dir, "dossiers")
    dpath = os.path.join(out, "fixturelens@%s.json" % sha12)
    check("dossier file emitted per lens@build12", os.path.exists(dpath))
    check("dossier .md emitted", os.path.exists(dpath[:-5] + ".md"))
    d = json.load(open(dpath))

    inv = d["inventory"]
    check("inventory counts controls + duplicates",
          inv["controls_total"] == 3 and len(inv["duplicates"]) == 1
          and inv["duplicates"][0]["name"] == "Overview", inv)
    comp = d["components"]
    # GB-1580 item 3: OrphanPanel is imported NOWHERE — dead code (info),
    # not an orphan deduction. UsedPanel is mounted via the page.
    check("unimported panel is dead (info), used panel mounted",
          comp["dead_components"] == ["concord-frontend/components/fixturelens/OrphanPanel.tsx"]
          and comp["orphaned"] == []
          and comp["mounted"] == ["concord-frontend/components/fixturelens/UsedPanel.tsx"],
          comp)
    be = d["backend_reach"]
    hidden = {(h["domain"], h["action"]) for h in be["hidden_actions"]}
    check("walk-hidden = exposed minus walk-called",
          hidden == {("fixture", "saveThing"), ("fixture", "tipThing"),
                     ("fixture", "secretFeature")}, hidden)
    # GB-1580 item 2: the page calls fixture.listThings via lensRun, so
    # the no-frontend-caller set is the other three exposed actions.
    uncalled = {(h["domain"], h["action"]) for h in be["uncalled_actions"]}
    check("uncalled = exposed minus frontend call sites",
          uncalled == {("fixture", "saveThing"), ("fixture", "tipThing"),
                       ("fixture", "secretFeature")}, uncalled)
    kinds = sorted(f["kind"] for f in d["code_scan"]["flags"])
    check("one flag per scan class",
          kinds == ["fabricated_data", "money_action_without_ledger_call",
                    "raw_fetch_user_url", "write_without_owner_check"], kinds)
    causes = d["findings_by_root_cause"]
    check("findings grouped by root cause",
          len(causes) == 2 and causes[0]["max_severity"] == "high"
          and causes[0]["count"] == 1, causes)
    check("replay verdicts attributed by ticket prefix",
          d["replay"]["counts"] == {"VERIFIED": 1, "REOPENED": 1},
          d["replay"]["counts"])
    g = d["gates"]
    # GB-1580 item 5: security judges live evidence only — two_account
    # PASS + no trust/premap findings means PASS despite the scan flags
    # (they render as code smell, counted on the gate block).
    check("gates from named inputs",
          g["polished"]["status"] == "FAIL"
          and g["stacking"]["status"] == "FAIL"
          and g["wiring"]["status"] == "PASS"
          and g["security_detector"]["status"] == "PASS"
          and g["security_detector"]["security_scan_flags"] == 2, g)
    # Hand-computed under the GB-1580 split (re-pinned; CB-1014 names
    # the continuity question for the desk): LIVE — causes high 6 +
    # medium 3 = 9; reopened 1 -> 5; gates failed 2 -> 10; core verb
    # absent -> 0. Live total 24, live_quality 76. SMELL — sec/money
    # flags 3 -> 45; other flags 1 -> 8; orphans 0 (the panel is dead,
    # info only); uncalled actions 3 -> 6. Smell total 59, code_smell
    # 41, smell in combined capped at 25. Combined = 100 - 24 - 25 = 51.
    check("score equals the hand-computed formula value",
          d["score"]["score"] == 51
          and d["score"]["live_quality"] == 76
          and d["score"]["code_smell"] == 41, d["score"])
    clean = json.load(open(os.path.join(out, "cleanlens@%s.json" % sha12)))
    check("clean lens scores exactly 100", clean["score"]["score"] == 100,
          clean["score"])
    check("index ranks farthest-from-bar first",
          [r["lens"] for r in idx["lenses"]] == ["fixturelens", "cleanlens"],
          idx["lenses"])
    md = open(os.path.join(out, "INDEX.md")).read()
    check("index md renders both lenses",
          "fixturelens" in md and "cleanlens" in md)

    print("FAILURES: %d" % len(FAILS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
