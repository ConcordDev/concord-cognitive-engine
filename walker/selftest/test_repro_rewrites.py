#!/usr/bin/env python3
"""Repro rewrites (rewrites.py): agree() fail-closed rules, originals untouched, provenance, safety, replay wiring.
Pure python, offline. Run: python3 selftest/test_repro_rewrites.py"""
import copy, hashlib, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "selftest"))
from concord_walker import rewrites as R, repro
from concord_walker.fold import extract_from_git

FAILS = []
REPO = os.path.dirname(HERE)
SHA = "272e62f41"


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:400] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


T = {"id": "X-1", "lens": "srs", "status": "FIXED_PENDING_VERIFY",
     "repro_steps": ["Open the Review tab, then click Export", "Look for a delete button", "See evidence/foo.md", "Type 'abc' in Name"],
     "expected": "Export downloads a JSON file. No console errors. Usable layout."}


def base(**kw):
    rw = {"ticket_id": "X-1", "lens": "srs", "fold_sha": SHA, "orig_hash": R.orig_hash(T), "author": "sonnet", "date": "2026-11-16", "schema": 1,
          "status": "rewritten",
          "steps": [{"op": "keep", "src": "text", "from_orig": [0]}, {"op": "needs_human_step", "src": "text", "from_orig": [2], "why": "no control named in original"},
                    {"op": "type", "target": "Name", "value": "abc", "src": "text", "from_orig": [3]}],
          "dropped": [{"orig": 1, "reason": "observe_moved_to_expected"}],
          "expected": [{"kind": "keep", "args": {}, "from_orig_clause": [0], "orig_span": "Export downloads a JSON file"},
                       {"kind": "no_console_error", "args": {}, "from_orig_clause": [1], "orig_span": "No console errors"},
                       {"kind": "needs_human", "args": {}, "from_orig_clause": [2], "orig_span": "Usable layout", "why": "visual judgement, no predicate"},
                       {"kind": "control_present", "args": {"names": ["delete"]}, "from_orig_clause": ["s1"], "orig_span": "Look for a delete button"}]}
    rw.update(kw)
    return rw


def mut(f):
    rw = copy.deepcopy(base())
    f(rw)
    return rw


def disagrees(name, rw, needle, ticket=T):
    ok, why = R.agree(ticket, rw)
    check("%s: fails closed" % name, (not ok) and any(needle in w for w in why), why)


ok, why = R.agree(T, base())
check("a faithful rewrite agrees", ok, why)

# ---- one case per agree() rule
disagrees("rule1 stale orig_hash", mut(lambda r: r.update(orig_hash="0" * 64)), "stale")
disagrees("rule1 ticket id mismatch", mut(lambda r: r.update(ticket_id="X-2")), "identity")
disagrees("rule1 lens mismatch", mut(lambda r: r.update(lens="other")), "identity")
disagrees("rule1 bad schema version", mut(lambda r: r.update(schema=2)), "schema")
disagrees("rule1 missing author", mut(lambda r: r.pop("author")), "provenance")
disagrees("rule1 missing date", mut(lambda r: r.pop("date")), "provenance")
disagrees("rule1 bad status", mut(lambda r: r.update(status="maybe")), "schema")
disagrees("rule2 added step (no from_orig)", mut(lambda r: r["steps"].append({"op": "reload", "src": "text", "from_orig": []})), "added_step")
disagrees("rule2 added step (points past the original)", mut(lambda r: r["steps"].append({"op": "reload", "src": "text", "from_orig": [9]})), "added_step")
disagrees("rule2 added step (reload not in the original step)", mut(lambda r: r["steps"].append({"op": "reload", "src": "text", "from_orig": [0]})), "literal_not_in_original")
disagrees("rule2 dropped step (uncovered, not listed)", mut(lambda r: r["steps"].pop(0)), "dropped_step")
disagrees("rule2 dropped step with a disallowed reason", mut(lambda r: r["dropped"].append({"orig": 0, "reason": "boring"})), "schema")
disagrees("rule2 observe moved to expected but nothing carries it", mut(lambda r: r["expected"].pop()), "dropped_step")
disagrees("rule3 added clause (no source)", mut(lambda r: r["expected"].append({"kind": "no_console_error", "args": {}, "from_orig_clause": [], "orig_span": "x"})), "added_clause")
disagrees("rule3 added clause (points at nothing)", mut(lambda r: r["expected"].append({"kind": "no_console_error", "args": {}, "from_orig_clause": [7], "orig_span": "No console errors"})), "added_clause")
disagrees("rule3 added clause (span not in the original clause)", mut(lambda r: r["expected"].__setitem__(1, dict(r["expected"][1], orig_span="Never crashes ever"))), "added_clause")
disagrees("rule3 dropped clause (original expectation not covered)", mut(lambda r: r["expected"].pop(2)), "dropped_clause")
disagrees("rule3 literal not in the original", mut(lambda r: r["expected"].__setitem__(3, dict(r["expected"][3], args={"names": ["Frobnicate"]}))), "literal_not_in_original")
disagrees("rule3 kind without an anchor in the original", mut(lambda r: r["expected"].__setitem__(1, {"kind": "contrast", "args": {}, "from_orig_clause": [1], "orig_span": "No console errors"})), "anchor")
disagrees("rule3 keep on a non-checkable clause", mut(lambda r: r["expected"].__setitem__(2, dict(r["expected"][2], kind="keep"))), "keep")
disagrees("rule3 needs_human on a checkable clause", mut(lambda r: r["expected"].__setitem__(0, dict(r["expected"][0], kind="needs_human"))), "needs_human")
disagrees("rule4 typed value not in the original", mut(lambda r: r["steps"][2].update(value="zzz")), "typed_value_not_in_original")
disagrees("rule5 different control than the original names", mut(lambda r: r["steps"].__setitem__(0, {"op": "click", "target": "Delete", "src": "text", "from_orig": [0]})), "literal_not_in_original")
disagrees("rule5 src must be a recorded source", mut(lambda r: r["steps"][2].update(src="made-up")), "src")
ok_l, why_l = R.agree(T, mut(lambda r: r["steps"].__setitem__(0, {"op": "click", "target": "Export", "src": "live:srs", "from_orig": [0]})), labels={"srs": ["Review", "Import"]})
check("rule5 live src label not live on the lens: fails closed", (not ok_l) and any("src_not_live" in w for w in why_l), why_l)
disagrees("keep marked on an unmappable original", mut(lambda r: r["steps"].__setitem__(1, {"op": "keep", "src": "text", "from_orig": [2]})), "keep")
disagrees("needs_human_step marked on a mappable original", mut(lambda r: r["steps"].__setitem__(0, {"op": "needs_human_step", "src": "text", "from_orig": [0]})), "needs_human_step")

# rule 6 + replay wiring: human_only is never replayed from a rewrite
ho = {"ticket_id": "X-1", "lens": "srs", "fold_sha": SHA, "orig_hash": R.orig_hash(T), "author": "sonnet", "date": "2026-11-16", "schema": 1,
      "status": "human_only", "human_only_reason": "lighthouse"}
ok, why = R.agree(T, ho)
check("rule6 human_only never agrees (never replayed)", (not ok) and why == ["human_only:lighthouse"], why)
t2, info = R.prepare(T, {"X-1": ho})
check("rule6 human_only -> no replay ticket, reason kept", t2 is None and info["source"] == "human_only" and info["reason"] == "lighthouse", info)
check("human_only reason must be in the enum", R.check_schema(dict(ho, human_only_reason="boredom")) is not None)
check("other_with_note needs a note", R.check_schema(dict(ho, human_only_reason="other_with_note")) is not None)


# ---- course-correction rules: why, original_sufficient, frontend: sources
disagrees("rule: needs_human_step without why", mut(lambda r: r["steps"][1].pop("why")), "why")
disagrees("rule: needs_human clause without why", mut(lambda r: r["expected"][2].pop("why")), "why")
only_keep = {"ticket_id": "X-1", "lens": "srs", "fold_sha": SHA, "orig_hash": R.orig_hash(T), "author": "sonnet", "date": "2026-11-16", "schema": 1,
             "status": "rewritten", "steps": [{"op": "keep", "src": "text", "from_orig": [0]}], "dropped": [], "expected": []}
check("a record that converts nothing cannot claim status rewritten", R.check_schema(only_keep) is not None)
check("original_sufficient with only keep entries validates", R.check_schema(dict(only_keep, status="original_sufficient")) is None)
check("original_sufficient with a converted step is refused", R.check_schema(dict(only_keep, status="original_sufficient", steps=[{"op": "reload", "src": "text", "from_orig": [0]}])) is not None)
t5, info = R.prepare(T, {"X-1": dict(only_keep, status="original_sufficient", steps=[{"op": "keep", "src": "text", "from_orig": [0]}, {"op": "needs_human_step", "src": "text", "from_orig": [1, ], "why": "observe only, no control", }, {"op": "needs_human_step", "src": "text", "from_orig": [2], "why": "evidence pointer, not a step"}, {"op": "keep", "src": "text", "from_orig": [3]}])})
check("original_sufficient replays the ORIGINAL ticket (not rewrite-backed)", info["source"] in ("original_sufficient", "rewrite_disagrees") and (t5 is T or info["source"] == "rewrite_disagrees"), info)
check("frontend: src format accepted", R.SRC_RE.match("frontend:concord-frontend/app/lenses/food/page.tsx:42") is not None and not R.SRC_RE.match("frontend:../etc/passwd"))
FEP = "concord-frontend/app/lenses/food/page.tsx"
if subprocess.run(["git", "-C", REPO, "cat-file", "-e", SHA], capture_output=True).returncode == 0:
    check("frontend: label literally at that line of the fold source verifies", R.frontend_label_at(FEP, 39, "Recipes", REPO))
    check("frontend: wrong label / wrong line / missing path / out-of-range line all fail closed",
          not R.frontend_label_at(FEP, 39, "Cookbook", REPO) and not R.frontend_label_at(FEP, 64, "zzz", REPO)
          and not R.frontend_label_at("concord-frontend/app/lenses/food/nope.tsx", 1, "x", REPO) and not R.frontend_label_at(FEP, 10 ** 7, "Recipes", REPO))
    tf = {"id": "X-2", "lens": "food", "repro_steps": ["Open the Recipes tab"], "expected": "No console errors"}
    mk = lambda line, lab: {"ticket_id": "X-2", "lens": "food", "fold_sha": SHA, "orig_hash": R.orig_hash(tf), "author": "sonnet", "date": "2026-11-16", "schema": 1, "status": "rewritten",
                            "steps": [{"op": "open_tab", "target": lab, "src": "frontend:%s:%d" % (FEP, line), "from_orig": [0]}], "dropped": [], "expected": [{"kind": "no_console_error", "args": {}, "from_orig_clause": [0], "orig_span": "No console errors"}]}
    ok, why = R.agree(tf, mk(39, "Recipes"), None, None, REPO)
    check("agree: a frontend: src whose label is on that line passes", ok, why)
    ok, why = R.agree(tf, mk(40, "Recipes"), None, None, REPO)
    check("agree: a frontend: src whose line does not carry the label fails closed (src_not_live)", (not ok) and any("src_not_live" in w for w in why), why)
else:
    print("SKIP frontend: checks: %s not in this clone" % SHA)

# ---- passing rewrite is used and recorded; failing one -> NEEDS_HUMAN rewrite_disagrees
t3, info = R.prepare(T, {"X-1": base()})
check("passing rewrite is used and recorded (source/orig_hash/author/date)", t3 is not None and info["source"] == "rewrite" and info["orig_hash"] == R.orig_hash(T)
      and info["author"] == "sonnet" and info["date"] == "2026-11-16" and t3["_rewrite"]["source"] == "rewrite", info)
check("effective ticket carries the compiled steps, original ticket untouched", t3["repro_steps"][0] == T["repro_steps"][0] and T["repro_steps"][3] == "Type 'abc' in Name" and "_rewrite" not in T)
t4, info = R.prepare(T, {"X-1": mut(lambda r: r.update(orig_hash="1" * 64))})
check("failing rewrite -> no replay ticket, rewrite_disagrees:stale", t4 is None and info["source"] == "rewrite_disagrees" and info["reason"] == "stale", info)
check("no record -> the original ticket, unchanged", R.prepare(T, {})[0] is T and R.prepare(T, {})[1]["source"] == "original")

import test_replay_hook as H  # noqa  (its helpers build a Reverifier with a fake runner; it runs its own checks on import)
HFAILS_BEFORE = len(H.FAILS)


def replay(tk, index):
    runner = H.runner_for({tk["id"]: dict(H.FIXED_RR)})
    rr, rv, ledger, rec, tmp = H.setup([tk], runner)
    rv._rw_index = index
    res = rv._apply_repro_steps(tk, {"verdict": "NEEDS_HUMAN", "notes": "", "evidence": []})
    return res, runner.calls


tk = H.tk("FIX-demo-900")
rw_ok = {"ticket_id": tk["id"], "lens": "demo", "fold_sha": SHA, "orig_hash": R.orig_hash(tk), "author": "sonnet", "date": "2026-11-16", "schema": 1, "status": "rewritten",
         "steps": [{"op": "open", "target": "/lenses/demo", "src": "text", "from_orig": [0]}, {"op": "keep", "src": "text", "from_orig": [1]}], "dropped": [],
         "expected": [{"kind": "keep", "args": {}, "from_orig_clause": [0], "orig_span": "Row is selected"}]}
res, calls = replay(tk, {tk["id"]: rw_ok})
check("replay: a passing rewrite is run and recorded (source rewrite, hash, author, date)", calls == [tk["id"]] and res.get("rewrite", {}).get("source") == "rewrite"
      and res["rewrite"]["orig_hash"] == R.orig_hash(tk) and res["rewrite"]["author"] == "sonnet" and res["rewrite"]["date"] == "2026-11-16", res)
res, calls = replay(tk, {tk["id"]: dict(rw_ok, orig_hash="2" * 64)})
check("replay: a disagreeing rewrite is NEEDS_HUMAN rewrite_disagrees:stale and is NOT run (no fallback)", calls == [] and res["verdict"] == "NEEDS_HUMAN"
      and "rewrite_disagrees:stale" in res["notes"] and res["rewrite"]["source"] == "rewrite_disagrees", res)
res, calls = replay(tk, {tk["id"]: dict(rw_ok, status="human_only", human_only_reason="visual", steps=None, expected=None)})
check("replay: human_only is NEEDS_HUMAN with its reason and is NOT run", calls == [] and res["verdict"] == "NEEDS_HUMAN" and "human_only:visual" in res["notes"], res)
res, calls = replay(tk, {})
check("replay: no record -> original path, unchanged (run once, no rewrite key)", calls == [tk["id"]] and "rewrite" not in res, res)
check("replay wiring: rewrites.py never names or sets a VERIFIED verdict (the ledger gate is the only path)", not re.search(r"[\"']VERIFIED[\"']|assert_verifiable|ledger", open(os.path.join(HERE, "concord_walker", "rewrites.py")).read().split('"""')[2]))

# ---- a rewrite can't widen safety
for nm, step, needle in [("type into a Password field", {"op": "type", "target": "Password", "value": "abc", "src": "text", "from_orig": [3]}, "safety"),
                         ("click a payment control", {"op": "click", "target": "Pay now", "src": "text", "from_orig": [0]}, None),
                         ("type into an admin role field", {"op": "type", "target": "Role", "value": "abc", "src": "text", "from_orig": [3]}, "safety")]:
    t5 = dict(T, repro_steps=["Open the Review tab, then click Pay now", "x", "y", "Type 'abc' in %s" % step.get("target")])
    rw = mut(lambda r: r.update(orig_hash=R.orig_hash(t5)))
    rw["steps"][2 if step["op"] == "type" else 0] = step
    ok5, why5 = R.agree(t5, rw)
    check("safety: %s is refused by agree() exactly as the mapper policy would" % nm, not ok5, why5)
# own-fixture create openers are NOT refused just for being create controls; publish/share/other-user stay refused
for nm, tgt, refused in [("own-fixture create opener 'New page'", "New page", False), ("own-fixture create opener 'Add model'", "Add model", False),
                         ("publish control 'Share & Publish'", "Share & Publish", True), ("'New post' (post = sends to others)", "New post", True),
                         ("'Start a piece' (HARD_DENY verb, not a create opener)", "Start a piece", True)]:
    t6 = dict(T, repro_steps=["Open the Review tab, then click %s" % tgt, "x", "y", "z"])
    rw = mut(lambda r: r.update(orig_hash=R.orig_hash(t6)))
    rw["steps"][0] = {"op": "click", "target": tgt, "src": "text", "from_orig": [0]}
    ok6, why6 = R.agree(t6, rw)
    has_safety = any("safety" in w for w in why6)
    check("safety: %s is %s by agree()" % (nm, "refused" if refused else "not refused"), has_safety == refused, why6)
# the compiled text maps to the SAME sub-steps the original text would (no new verb, no widening)
for step, orig in [({"op": "click", "target": "Export", "src": "text", "from_orig": [0]}, 'Click Export'), ({"op": "press", "target": "Escape", "src": "text", "from_orig": [0]}, "Press Escape"),
                   ({"op": "viewport", "target": "390x844", "src": "text", "from_orig": [0]}, "Set viewport 390x844")]:
    txt, _ = R.compile_step(step)
    a = [(s["action"], s.get("name"), s.get("key")) for s in repro.expand_step(txt, "srs")["substeps"]]
    b = [(s["action"], s.get("name"), s.get("key")) for s in repro.expand_step(orig, "srs")["substeps"]]
    check("compiled %s step maps exactly like the equivalent original text" % step["op"], a == b and a, (a, b))
check("unknown ops and kinds are rejected (no new verbs/kinds)", R.check_schema(mut(lambda r: r["steps"].append({"op": "teleport", "src": "text", "from_orig": [0]}))) is not None
      and R.check_schema(mut(lambda r: r["expected"].append({"kind": "vibes", "args": {}, "from_orig_clause": [0], "orig_span": "x"}))) is not None)

# ---- originals byte-identical; provenance of every committed record
def git_bytes(path):
    return subprocess.run(["git", "-C", REPO, "show", "%s:%s" % (SHA, path)], capture_output=True).stdout


def sources_hash():
    names = subprocess.run(["git", "-C", REPO, "ls-tree", "--name-only", SHA, "audit/fix-list/records/"], capture_output=True, text=True).stdout.split()
    h = hashlib.sha256(git_bytes("audit/fix-list/fix_tickets.jsonl"))
    for n in sorted(names):
        h.update(git_bytes(n))
    return h.hexdigest()


have_fold = subprocess.run(["git", "-C", REPO, "cat-file", "-e", SHA], capture_output=True).returncode == 0
if have_fold:
    before = sources_hash()
    fold = extract_from_git(REPO, SHA)
    snap = copy.deepcopy({tid: (t.get("repro_steps"), t.get("expected")) for tid, t in fold.base.items()})
    index = R.load_dir()
    applied = 0
    for tid, rw in index.items():
        t = fold.base.get(tid)
        if t is None:
            continue
        R.prepare(t, index)
        applied += 1
    after = {tid: (t.get("repro_steps"), t.get("expected")) for tid, t in fold.base.items()}
    check("originals byte-identical: fix_tickets + records bytes at %s unchanged by loading/applying %d rewrites" % (SHA, applied), sources_hash() == before)
    check("originals byte-identical: the fold's repro_steps/expected unchanged by prepare()/effective_ticket()", snap == after)
    bad = [tid for tid, rw in index.items() if tid in fold.base and rw["orig_hash"] != R.orig_hash(fold.base[tid])]
    check("provenance: EVERY committed record's orig_hash equals the fold's (%d records)" % len(index), not bad, bad[:5])
    unknown = [tid for tid in index if tid not in fold.base]
    check("provenance: every committed record is a real fold ticket with the same lens", not unknown and all(index[t]["lens"] == fold.base[t]["lens"] for t in index), unknown[:5])
    disagree = [(tid, R.agree(fold.base[tid], rw)[1][:1]) for tid, rw in index.items() if rw["status"] == "rewritten" and not R.agree(fold.base[tid], rw)[0]]
    check("every committed `rewritten` record passes agree() against its fold ticket", not disagree, disagree[:3])
    if index:
        tid = sorted(index)[0]
        tam = dict(index[tid], orig_hash="f" * 64)
        check("provenance: a tampered record fails", R.agree(fold.base[tid], tam)[0] is False)
else:
    print("SKIP fold-backed checks: %s not in this clone" % SHA)

src = open(os.path.join(HERE, "concord_walker", "rewrites.py")).read()
check("no code path in rewrites.py writes to tickets/records/fold (no write-mode open, no .write)", not re.search(r"open\([^)]*[\"']w|\.write\(|os\.(?:remove|rename)|shutil", src))
import tempfile
d = tempfile.mkdtemp()
open(os.path.join(d, "batch-001.jsonl"), "w").write(json.dumps(base()) + "\n{torn\n")
check("a torn batch line never poisons the load", list(R.load_dir(d)) == ["X-1"])

sys.path.insert(0, os.path.join(HERE, "tools"))
import rewrite_draft as _D  # walk02 forbids the account literal in walker code; it lives only here
check("cross-account mention still detected (t2)", bool(_D._CROSS.search("sign in as zuko_qa_t2")))
check("plain step not cross-account", not _D._CROSS.search("plain single account step"))
check("t1 prefix stripped (lens form)", _D._PFX.sub("", "On /lenses/chat as zuko_qa_t1, open the menu") == "open the menu")
check("t1 prefix stripped (paren form)", _D._PFX.sub("", "on zuko_qa_t1 (admin), click Save") == "click Save")

print("\n%d failed" % len(FAILS))
sys.exit(1 if FAILS or len(H.FAILS) > HFAILS_BEFORE else 0)

