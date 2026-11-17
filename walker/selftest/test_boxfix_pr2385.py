#!/usr/bin/env python3
"""Offline tests for the PR #2385 box-test fixes (no Playwright / Chromium needed):
  1 domread (CDP-snapshot readers replacing page JS) + the no-page-JS scan over concord_walker/*.py
  2 'press Delete' stays the refused KEY; enter_submit focuses its named field; net rows carry string paths (netcheck/observe)
  3 failure-path exception class names; typed-values shorthand 'x/z' stays unmapped
  4 sweep wiring: deploy guard stops the sweep, discards the straddling lens, refuses --resume onto another build; per-lens states
  5 human-only automation (lighthouse / A-B / visual) from the replay path, fail closed
Run: python3 selftest/test_boxfix_pr2385.py"""
import argparse, functools, json, os, re, sys, tempfile, types

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
_pw = types.ModuleType("playwright"); _sa = types.ModuleType("playwright.sync_api")
class _Browser:
    def close(self): pass
class _PW:
    class chromium:
        @staticmethod
        def launch(*a, **k): return _Browser()
class _CM:
    def __enter__(self): return _PW()
    def __exit__(self, *a): return False
_sa.sync_playwright = lambda: _CM()
sys.modules.setdefault("playwright", _pw); sys.modules["playwright.sync_api"] = _sa

import walker as W
from concord_walker import repro, domread as D, netcheck as N, observe as O, lensrecord, longwalk as LW, automate as A, writevocab
from concord_walker.util import load_config, Log

FAILS = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else " :: " + str(extra)[:300]))
    if not cond: FAILS.append(name)

# ------------------------------------------------------------------ 1 domread on a fake DOMSnapshot
def snap(nodes):
    """nodes: [(parent, type, name, attrs{}, text|None, bounds, style[10], scrollRect, clientRect)] -> a minimal DOMSnapshot."""
    S, ix = [], {}
    def sid(x):
        if x not in ix: ix[x] = len(S); S.append(x)
        return ix[x]
    d = {"nodes": {"parentIndex": [], "nodeType": [], "nodeName": [], "nodeValue": [], "attributes": []},
         "layout": {"nodeIndex": [], "bounds": [], "styles": [], "scrollRects": [], "clientRects": []}}
    for i, (par, typ, name, attrs, text, bounds, style, sr, cr) in enumerate(nodes):
        n = d["nodes"]
        n["parentIndex"].append(par); n["nodeType"].append(typ); n["nodeName"].append(sid(name)); n["nodeValue"].append(sid(text) if text is not None else -1)
        n["attributes"].append([x for k, v in attrs.items() for x in (sid(k), sid(v))])
        if bounds:
            l = d["layout"]; l["nodeIndex"].append(i); l["bounds"].append(bounds); l["styles"].append([sid(x) for x in style]); l["scrollRects"].append(sr); l["clientRects"].append(cr)
    return {"documents": [d], "strings": S}

ST = ["", "rgb(255, 255, 255)", "none", "16px", "400", "1", "visible", "block", "static", "visible"]
def st(**kw):
    s = list(ST)
    for k, v in kw.items(): s[{"bg": 1, "vis": 6, "disp": 7, "ovx": 9}[k]] = v
    return s

base = [(-1, 9, "#document", {}, None, None, None, None, None),
        (0, 1, "HTML", {"data-theme": "light"}, None, [0, 0, 400, 800], ST, [0, 0, 400, 800], [0, 0, 400, 800]),
        (1, 1, "BODY", {}, None, [0, 0, 400, 800], st(bg="rgb(17, 17, 17)"), [0, 0, 400, 800], [0, 0, 400, 800]),
        (2, 1, "DIV", {"id": "wide"}, None, [0, 0, 900, 20], ST, [0, 0, 900, 20], [0, 0, 900, 20]),
        (2, 1, "SPAN", {}, None, [0, 30, 50, 20], ST, [0, 0, 120, 20], [0, 0, 50, 20]),
        (4, 3, "#text", {}, "overflowing label text", None, None, None, None),
        (2, 1, "DIV", {"role": "progressbar"}, None, [0, 60, 20, 20], ST, [0, 0, 20, 20], [0, 0, 20, 20])]
sn = snap(base)
check("page_scheme reads <html data-theme> + body background from the snapshot", D.page_scheme(sn) == "light|rgb(17, 17, 17)", D.page_scheme(sn))
check("page_scheme unreadable -> None (never a guess)", D.page_scheme({"documents": []}) is None and D.page_scheme(snap(base[:1])) is None)
lay = D.layout(sn, 400, 800)
check("layout: element wider than the viewport is reported clipped", any(c["sel"] == "div#wide" and c["right"] == 900 for c in lay["clipped"]), lay)
check("layout: leaf text wider than its box is reported", any(t.startswith("span:overflowing") for t in lay["textOverflow"]), lay)
check("layout: no viewport -> None (UNVERIFIED upstream)", D.layout(sn, 0, 800) is None)
scroller = list(base); scroller[3] = (2, 1, "DIV", {"id": "wide"}, None, [0, 0, 900, 20], ST, [0, 0, 900, 20], [0, 0, 900, 20])
scroller.insert(3, (2, 1, "DIV", {}, None, [0, 0, 400, 20], st(ovx="auto"), [0, 0, 900, 20], [0, 0, 400, 20]))
scroller[4] = (3, 1, "DIV", {"id": "wide"}, None, [0, 0, 900, 20], ST, [0, 0, 900, 20], [0, 0, 900, 20])
check("layout: a wide child inside an overflow:auto scroller is NOT clipped", not [c for c in D.layout(snap(scroller), 400, 800)["clipped"] if c["sel"] == "div#wide"])
check("spinner: role=progressbar with area is seen", D.spinner(sn) is True)
check("spinner: none present -> False", D.spinner(snap(base[:6])) is False)

class N_:
    def __init__(s, role, name, parent=None, props=None, children=()): s.role, s.name, s.parent, s.props, s.children, s.id, s.ignored = role, name, parent, props or {}, list(children), name, False
class AX_:
    def __init__(s, ns): s.ns = {n.id: n for n in ns}
    def focused(s): return next((n for n in s.ns.values() if n.props.get("focused")), None)
    def ancestors(s, n):
        out = []
        while n.parent and n.parent in s.ns: n = s.ns[n.parent]; out.append(n)
        return out
    def descendants(s, n):
        out, st_ = [], list(n.children)
        while st_:
            c = s.ns[st_.pop()]; out.append(c); st_.extend(c.children)
        return out
tl = N_("tablist", "Views", children=["Two", "One"]); one = N_("tab", "One", "Views", {"selected": False, "focused": True}); two = N_("tab", "Two", "Views", {"selected": True})
check("active_item: the selected tab of the focused tablist", D.active_item(AX_([tl, one, two])) == "Two#sel")
one.props["focused"] = False
check("active_item: nothing focused -> None", D.active_item(AX_([tl, one, two])) is None)
btn = N_("button", "Save", props={"focused": True})
check("active_item: a lone focused control reports its name", D.active_item(AX_([btn])) == "Save#focus")

banned = re.compile(r"\.(evaluate|evaluate_handle|locator|query_selector|query_selector_all|add_init_script|add_script_tag|expose_function|expose_binding|fill|get_by_\w+|wait_for_selector|wait_for_function|route)\(|Runtime\.evaluate|Runtime\.callFunctionOn")
hits = [(f, i + 1) for f in sorted(os.listdir(os.path.join(HERE, "concord_walker"))) if f.endswith(".py")
        for i, l in enumerate(open(os.path.join(HERE, "concord_walker", f))) if banned.search(l)]
check("no page-JS calls anywhere in concord_walker/*.py (selftest's own scan, no allow-list)", not hits, hits)

# ------------------------------------------------------------------ 2 keys / enter / net rows
r = repro.expand_step("press Delete", "std")
check("'press Delete' is the refused KEY: unmapped with a refusal (never reinterpreted as a Delete control)", r["mapped"] is False and "refused" in (r["reason"] or ""), r)
check("'press Ctrl+Delete' also refused", repro.expand_step("press Ctrl+Delete", "std")["mapped"] is False)
check("a plain 'Delete the row' step is not caught by the key refusal", "refused" not in (repro.expand_step("Delete the row", "std")["reason"] or ""))
e = repro.expand_step("press Enter in the Title field to submit", "std")["substeps"][0]
check("enter_submit carries its named field", e["action"] == "enter_submit" and e.get("field") == "Title", e)
check("enter_submit on a non-field target stays field-less", "field" not in (repro.expand_step("press Enter in the palette", "std")["substeps"] or [{}])[0])
from concord_walker import precap as P
class Drv:
    def __init__(s, can_focus): s.keys, s.can = [], can_focus; s.focused = None
    def focus_name(s, n): s.focused = n if s.can else None; return s.can
    def net_mark(s): return 0
    def net_since(s, m): return ["POST /api/x"] if s.focused else []
    def snapshot(s): return {"texts": [], "dialogs": []}
ctx = {"allow_write": True, "send_key": lambda k: None, "forbid_keys": set()}
d = Drv(True); out = P.execute("enter_submit", {"action": "enter_submit", "field": "Title"}, d, {}, ctx)
check("enter_submit focuses the named field before Enter, then confirms the observed write", d.focused == "Title" and "submitted" in out, out)
try:
    P.execute("enter_submit", {"action": "enter_submit", "field": "Title"}, Drv(False), {}, ctx); ok = False
except P.NotFound:
    ok = True
check("enter_submit with no such field fails closed (NotFound), Enter never sent", ok)

row = {"method": "POST", "path": ("/api/rows", []), "status": 201}
check("netcheck.norm_row turns a (path, keys) tuple into a string path", N.norm_row(row)["path"] == "/api/rows")
check("_rows tolerates tuple/list/None/int paths without raising", len(N._rows({"obs": [{"net": [row, {"method": "GET", "path": None, "status": 200}, {"method": "GET", "path": 5}, "junk"]}]})) == 3)
check("telemetry rows are still filtered after normalising", N._rows({"obs": [{"net": [{"method": "POST", "path": ("/api/telemetry", []), "status": 200}]}]}) == [])
w = O.window_from({}, {}, [], [row])
check("observe.window_from stores string paths", w["net"][0]["path"] == "/api/rows", w["net"])
check("the repro recorder stores the templated path STRING (source of the tuple)", 'template_path(urlparse(r.url).path)[0]' in open(os.path.join(HERE, "concord_walker", "repro.py")).read())
ev = {"obs": [{"net": [{"method": "POST", "path": ("/api/rows", []), "status": 201}, {"method": "GET", "path": ("/api/rows", []), "status": 200}]}]}
try:
    N.readback_check(ev); ok = True
except Exception as ex:
    ok = False
check("readback_check no longer raises on tuple-path rows", ok)

# ------------------------------------------------------------------ 3 exception names + typed values shorthand
check("replay driver exceptions keep their historical class names", repro._NotFound.__name__ == "_NotFound" and repro._Refused.__name__ == "_Refused" and P.NotFound is repro._NotFound)
x = repro.expand_step("Open Claim, leave plot x/z blank, submit.", "std")
check("'plot x/z blank' stays unmapped (no guessed 'z' field)", x["mapped"] is False, x)
check("_split_fields: a normal 'Qty / Price' split still works", writevocab._split_fields("Qty / Price") == ["Qty", "Price"])
check("_split_fields: single-letter shorthand is ambiguous -> []", writevocab._split_fields("plot x/z") == [])
y = repro.expand_step("Open Claim, leave plot blank, submit.", "std")
check("a clear single field blank still maps", y["mapped"] is True, y)

# ------------------------------------------------------------------ 4 sweep wiring with fakes
SHA1, SHA2 = "a" * 40, "b" * 40
class _Net:
    def build(self): return ([], [], [], {})
class FakeLensWalk:
    flip_on = None; sha_box = [SHA1]; seen = []
    def __init__(self, browser, cfg, rec, lens, acct, log, **kw):
        self.slug, self.allow_write, self.findings, self.screens, self.net, self.premap_findings = lens["slug"], False, [], [], _Net(), []
    def run(self):
        FakeLensWalk.seen.append(self.slug)
        if FakeLensWalk.flip_on == self.slug:
            FakeLensWalk.sha_box[0] = SHA2          # a deploy lands while this lens is being walked
        return {"slug": self.slug, "url": "u", "account": "t1", "admin": False, "started": "s", "finished": "f", "elapsed_s": 1,
                "checks": {"reach": {"status": "PASS"}}, "initial_evidence": "ev/initial.png"}

def ns(**kw):
    d = dict(allow_write=False, admin=False, dry_run=False, no_auth=False, phases=None, base_url=None, premap=False, premap_budget_s=None,
             expect_sha=None, two_account=False, resume=None, auto_resume=2, only=None, category=None, start_from=None, limit=None,
             from_repo=None, deploy_sha=None, no_replay=True)
    d.update(kw); return argparse.Namespace(**d)

def mkcfg(tmp, slugs):
    cfg = load_config(None)
    cfg["runs_dir"], cfg["queue_dir"], cfg["audit_dir"], cfg["records_dir"] = [os.path.join(tmp, x) for x in ("runs", "queue", "audit", "records")]
    os.makedirs(cfg["audit_dir"], exist_ok=True)
    open(os.path.join(cfg["audit_dir"], "fix_tickets.jsonl"), "w").close()
    cfg["base_url"] = "http://127.0.0.1:9"
    json.dump([{"slug": s, "url": "http://127.0.0.1:9/lenses/" + s, "category": "x"} for s in slugs], open(os.path.join(cfg["audit_dir"], "inventory.json"), "w"))
    return cfg

def sweep(cfg, args):
    W.LensWalk, W.has_session, W.wait_for_memory = FakeLensWalk, (lambda *a: True), (lambda *a: True)
    fetch = lambda u: json.dumps({"buildSha": FakeLensWalk.sha_box[0]}) if u.endswith("/health") else ""
    real = lensrecord.deploy_stamp
    lensrecord.deploy_stamp = functools.partial(real, fetch=fetch)
    FakeLensWalk.seen.clear()
    code = 0
    try:
        W.cmd_walk(args, cfg, Log(quiet=True))
    except SystemExit as e:
        code = e.code
    finally:
        lensrecord.deploy_stamp = real
    runs = cfg["runs_dir"]
    rd = os.path.join(runs, sorted(os.listdir(runs))[-1])
    return code, rd, json.load(open(os.path.join(rd, "walk-manifest.json")))

tmp = tempfile.mkdtemp(); cfg = mkcfg(tmp, ["a", "b", "c"])
FakeLensWalk.sha_box[0], FakeLensWalk.flip_on = SHA1, None
code, rd, man = sweep(cfg, ns())
rows = {l["slug"]: l for l in man["lenses"]}
check("clean sweep: exit 0, every lens walked with a DONE state", code == 0 and all(rows[s]["status"] == "walked" and rows[s]["state"] == "DONE" for s in "abc"), (code, man["lenses"]))
check("manifest records the build sha the run started on", man.get("build_sha") == SHA1, man.get("build_sha"))
check("SUMMARY lists per-lens states", "Per-lens states: DONE=3" in open(os.path.join(rd, "SUMMARY.md")).read())

tmp = tempfile.mkdtemp(); cfg = mkcfg(tmp, ["a", "b", "c"])
FakeLensWalk.sha_box[0], FakeLensWalk.flip_on = SHA1, "b"
code, rd, man = sweep(cfg, ns())
rows = {l["slug"]: l for l in man["lenses"]}
check("deploy mid-lens: sweep STOPS with a non-zero exit", code == 4, code)
check("the straddling lens is discarded: not 'walked', state DEPLOY_DETECTED, no result file", rows["b"]["status"] == "aborted" and rows["b"]["state"] == "DEPLOY_DETECTED" and not os.path.exists(os.path.join(rd, "lens-b.json")), rows.get("b"))
check("lens before the deploy keeps its result; lens after is never started", rows["a"]["status"] == "walked" and "c" not in rows and FakeLensWalk.seen == ["a", "b"], (rows, FakeLensWalk.seen))
check("ABORTED.txt says DEPLOY_DETECTED", "DEPLOY_DETECTED" in open(os.path.join(rd, "ABORTED.txt")).read())
check("manifest state is aborted and names DEPLOY_DETECTED", man["state"] == "aborted" and "DEPLOY_DETECTED" in (man.get("note") or ""), man.get("note"))
rid = man["run_id"]
code2, rd2, man2 = sweep(cfg, ns(resume=rid))                 # live build is now SHA2 != the run's SHA1
check("--resume onto a different build is refused (non-zero, nothing walked)", code2 == 4 and FakeLensWalk.seen == [] and "resume refused" in open(os.path.join(rd2, "ABORTED.txt")).read(), (code2, FakeLensWalk.seen))
FakeLensWalk.sha_box[0], FakeLensWalk.flip_on = SHA1, None   # the original build is back
code3, rd3, man3 = sweep(cfg, ns(resume=rid))
rows3 = {l["slug"]: l for l in man3["lenses"]}
check("--resume on the SAME build continues: walked lenses skipped, b and c walked", code3 == 0 and FakeLensWalk.seen == ["b", "c"] and all(rows3[s]["status"] == "walked" for s in "abc"), (code3, FakeLensWalk.seen))

tmp = tempfile.mkdtemp(); cfg = mkcfg(tmp, ["a"])
class NoShaLW(FakeLensWalk): pass
FakeLensWalk.sha_box[0] = None
_fetch_none = lambda u: json.dumps({}) if u.endswith("/health") else ""
W.LensWalk, W.has_session, W.wait_for_memory = FakeLensWalk, (lambda *a: True), (lambda *a: True)
real = lensrecord.deploy_stamp; lensrecord.deploy_stamp = functools.partial(real, fetch=_fetch_none)
try:
    W.cmd_walk(ns(), cfg, Log(quiet=True)); code = 0
except SystemExit as e:
    code = e.code
finally:
    lensrecord.deploy_stamp = real
check("no readable /health sha at start: guard is OFF (logged), existing behaviour unchanged, sweep completes", code == 0)
check("lens_state: gate lens -> SKIPPED_UNSAFE; ERROR check -> PARTIAL; replay all pending -> PENDING_CAPTURE; else DONE",
      LW.lens_state({}, gate=True) == "SKIPPED_UNSAFE" and LW.lens_state({"checks": {"x": {"status": "ERROR"}}}) == "PARTIAL"
      and LW.lens_state({"replay": {"pending_capture": 2, "counts": {"NEEDS_HUMAN": 2}}}) == "PENDING_CAPTURE"
      and LW.lens_state({"replay": {"pending_capture": 2, "counts": {"FIXED": 1}}}) == "DONE" and LW.lens_state({"checks": {"x": {"status": "PASS"}}}) == "DONE")
check("exception -> state: timeout / 429 / other", LW.state_for_exception(RuntimeError("HTTP 429")) == "RATE_LIMITED" and LW.state_for_exception(TimeoutError("x")) == "TIMEOUT" and LW.state_for_exception(ValueError("x")) == "CRASHED")
g = LW.DeployGuard(lambda: None)
check("guard: unreadable sha AFTER the start sha was known is NOT trusted", (lambda g: (g.start(known=SHA1), g.check("l", phase="after"))[1])(LW.DeployGuard(lambda: None)) is not None)

# ------------------------------------------------------------------ 5 automation from the replay path
from concord_walker.reverify import Reverifier
class RV(Reverifier):
    def __init__(self, env):
        self.env = env; self.rec = types.SimpleNamespace(run_dir=tempfile.mkdtemp()); self.cfg = {"base_url": "http://x"}; self.inv = {"l": {"url": "http://x/lenses/l"}}; self.log = lambda *a: None
    def _automation_env(self, t, route): return self.env
def lh(score):
    return {"state": "ok", "lhr": {"categories": {"performance": {"score": score}}, "audits": {}, "requestedUrl": "http://x/lenses/l", "finalUrl": "http://x/lenses/l"}}
t = {"id": "T1", "lens": "l", "repro_steps": ["Run Lighthouse"], "expected": "Performance score >= 90"}
info = {"source": "human_only", "reason": "lighthouse"}
res = RV({"lighthouse": lambda ff: lh(0.95), "requested_path": "/lenses/l"})._automate_human_only(t, {"verdict": "NEEDS_HUMAN", "evidence": []}, info)
check("lighthouse above threshold -> FIXED with evidence file", res["verdict"] == "FIXED" and res["automation"]["state"] == "PASS" and res["evidence"] and os.path.exists(res["evidence"][0]), res)
res = RV({"lighthouse": lambda ff: lh(0.4), "requested_path": "/lenses/l"})._automate_human_only(t, {"verdict": "NEEDS_HUMAN", "evidence": []}, info)
check("lighthouse below threshold -> STILL_FAILING", res["verdict"] == "STILL_FAILING", res)
res = RV({"lighthouse": lambda ff: {"state": "unverified", "reason": "lighthouse CLI is not installed"}})._automate_human_only(t, {"verdict": "NEEDS_HUMAN", "evidence": []}, info)
check("lighthouse tool absent -> UNVERIFIED reason, verdict stays NEEDS_HUMAN", res["verdict"] == "NEEDS_HUMAN" and "not installed" in res["notes"] and res["automation"]["state"] == "UNVERIFIED", res)
res = RV({})._automate_human_only(dict(t, id="T2"), {"verdict": "NEEDS_HUMAN", "evidence": []}, {"source": "human_only", "reason": "cross_account"})
check("A/B with no t2 session / runner -> UNVERIFIED (never PASS)", res["verdict"] == "NEEDS_HUMAN" and "t1/t2" in res["notes"], res)
res = RV({"screenshot": None, "want_theme": "dark"})._automate_human_only(dict(t, id="T3", expected="dark theme"), {"verdict": "NEEDS_HUMAN", "evidence": []}, {"source": "human_only", "reason": "visual"})
check("visual with no screenshot -> UNVERIFIED", res["verdict"] == "NEEDS_HUMAN" and res["automation"]["state"] == "UNVERIFIED", res)
res = RV({})._automate_human_only(dict(t, id="T4"), {"verdict": "NEEDS_HUMAN", "evidence": []}, {"source": "human_only", "reason": "code_read"})
check("code_read stays human with its exact reason", res["verdict"] == "NEEDS_HUMAN" and "code_read" in res["notes"], res)
ab = {"create": lambda: {"path": "/api/x/1", "marker": "m"}, "fetch_owner": lambda p, m: {"status": 200, "contains": True},
      "fetch_other": lambda p, m: {"status": 404, "contains": False}, "fetch_anon": lambda p, m: {"status": 401, "contains": False}}
res = RV({"ab": ab})._automate_human_only(dict(t, id="T5"), {"verdict": "NEEDS_HUMAN", "evidence": []}, {"source": "human_only", "reason": "cross_account"})
check("A/B isolation holding -> FIXED; the walker never deletes/admins", res["verdict"] == "FIXED", res)
ab2 = dict(ab, fetch_other=lambda p, m: {"status": 200, "contains": True})
res = RV({"ab": ab2})._automate_human_only(dict(t, id="T6"), {"verdict": "NEEDS_HUMAN", "evidence": []}, {"source": "human_only", "reason": "cross_account"})
check("A/B: t2 reads t1's item -> STILL_FAILING", res["verdict"] == "STILL_FAILING", res)
check("the hook is reached from _apply_repro_steps (source check)", "return self._automate_human_only(t, res, rwinfo)" in open(os.path.join(HERE, "concord_walker", "reverify.py")).read())

print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
