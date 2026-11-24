#!/usr/bin/env python3
"""ULW packet-identity family (C27/C30/C32): canonical packet_id, packet
supersession, and the wiring-provenance mark — browser-free pins.

Gate §16: every packet carries ONE machine-readable identity field
(lens + build + version); a superseding packet names the packet it
replaces. Gate §12: packets record that wiring was captured on the clean
happy path; fuzz files as findings only.

Run: python3 selftest/test_packet_identity.py
On the pre-build head every identity leg FAILS (no packet_id, no
supersedes, no provenance anywhere); the structural fuzz-lane leg holds
in both trees (it pins the discipline the mark certifies).
"""
import json, os, sys, tempfile
from types import SimpleNamespace

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "tools"))
from concord_walker import lensrecord as LR
from concord_walker import wiring as WR
import pack as PK

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" " + str(extra)[:400]) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


SHA = "f4f1f77ff610252fba82f35ec0b83da0829d53c6"
DEPLOY = {"backend_sha": SHA, "frontend_build_id": "fb1", "walker_sha": None, "walker_dirty": None,
          "base_url": "http://x", "checked_at": "t", "walked_at": "2026-11-18T00:00:00-0500",
          "sha_status": "ok", "sha_note": None}

# --- C30: the canonical ID -------------------------------------------------
pid = LR.packet_id_for("alpha", DEPLOY)
check("packet_id is lens@build12:vN", pid == "alpha@f4f1f77ff610:v1", pid)
check("packet_id deterministic", LR.packet_id_for("alpha", DEPLOY) == pid)
check("packet_id with no build stamp names 'unknown', shape intact",
      LR.packet_id_for("alpha", {"backend_sha": None}) == "alpha@unknown:v1")
check("packet_id version segment is the capture generation",
      LR.packet_id_for("alpha", DEPLOY, 2) == "alpha@f4f1f77ff610:v2")

# --- C30/C27: finalize stamps identity + provenance -------------------------
res = {"slug": "alpha", "checks": {}}
LR.upgrade_record(res, DEPLOY, [], ["alpha"], [])
check("upgrade_record stamps packet_id", res.get("packet_id") == "alpha@f4f1f77ff610:v1", res.get("packet_id"))
check("upgrade_record stamps packet_version 1", res.get("packet_version") == 1)
check("upgrade_record stamps wiring_provenance clean_happy_path",
      res.get("wiring_provenance") == "clean_happy_path", res.get("wiring_provenance"))
check("a first capture carries no supersedes", "supersedes" not in res)

# --- C32: supersession -------------------------------------------------------
prior = {"slug": "alpha", "deploy": DEPLOY, "packet_version": 1, "packet_id": "alpha@f4f1f77ff610:v1"}
res2 = {"slug": "alpha", "checks": {}}
LR.upgrade_record(res2, dict(DEPLOY, backend_sha="b" * 40), [], ["alpha"], [], prior=prior)
check("superseding record names the packet it replaces",
      res2.get("supersedes") == "alpha@f4f1f77ff610:v1", res2.get("supersedes"))
check("superseding record bumps the generation", res2.get("packet_version") == 2)
check("superseding record recomputes its own packet_id",
      res2.get("packet_id") == "alpha@bbbbbbbbbbbb:v2", res2.get("packet_id"))
try:
    LR.apply_supersession({"slug": "beta", "deploy": DEPLOY}, prior)
    check("cross-lens supersession is refused", False)
except ValueError:
    check("cross-lens supersession is refused", True)

# --- load path: derivation, never a rewrite ----------------------------------
with tempfile.TemporaryDirectory() as td:
    p1 = os.path.join(td, "lens-old.json")
    with open(p1, "w") as f:
        json.dump({"slug": "old", "initial_evidence": "x.png"}, f)
    r1 = LR.load_lens_record(p1)
    check("v1 record derives a packet_id on load", r1.get("packet_id") == "old@unknown:v1", r1.get("packet_id"))
    p2 = os.path.join(td, "lens-alpha.json")
    with open(p2, "w") as f:
        json.dump({"slug": "alpha", "schema_version": 2, "deploy": DEPLOY, "packet_id": "alpha@pinned:v7",
                   "packet_version": 7}, f)
    r2 = LR.load_lens_record(p2)
    check("a stamped packet_id is never rewritten on load",
          r2.get("packet_id") == "alpha@pinned:v7" and r2.get("packet_version") == 7)

# --- C27: wiring documents carry the mark ------------------------------------
doc = WR.build_lens("alpha", [{"sid": "c_1", "control_id": "load:page:-", "name": "Alpha", "role": "page",
                               "requests": []}], None, "run1", "foldsha")
check("wiring doc is stamped clean_happy_path", doc.get("provenance") == "clean_happy_path", doc.get("provenance"))
ll = WR.live_labels([doc], "run1", "foldsha")
check("live_labels provenance names the wiring provenance",
      ll["provenance"].get("wiring") == "clean_happy_path", ll["provenance"])
with tempfile.TemporaryDirectory() as td:
    WR.write_all(td, [doc], "run1", "foldsha")
    ix = json.load(open(os.path.join(td, "wiring-index.json")))
    check("wiring index is stamped clean_happy_path", ix.get("provenance") == "clean_happy_path", ix.get("provenance"))

# --- C27 discipline: fuzz never enters the capture lane ----------------------
for mod in ("walker.py", os.path.join("concord_walker", "checks.py"), os.path.join("concord_walker", "netledger.py"),
            os.path.join("concord_walker", "longwalk.py")):
    src = open(os.path.join(HERE, mod)).read()
    check("capture lane does not import formfuzz (%s)" % os.path.basename(mod), "formfuzz" not in src)

# --- pack surfacing: the packet is cited by its ID ---------------------------
cur = {"slug": "alpha", "schema_version": 2, "deploy": DEPLOY, "checks": {}, "findings": [],
       "controls": [], "endpoints": [], "actions": [], "packet_id": "alpha@f4f1f77ff610:v2",
       "packet_version": 2, "wiring_provenance": "clean_happy_path"}
prev = {"slug": "alpha", "schema_version": 2, "deploy": DEPLOY, "packet_id": "alpha@f4f1f77ff610:v1",
        "packet_version": 1}
inp = SimpleNamespace(records={"alpha": ("/runs/r2/lens-alpha.json", cur)},
                      prev={"alpha": ("/runs/r1/lens-alpha.json", prev)},
                      registry=None, live_checked=False, live_sha=None, fix_commits={},
                      a=SimpleNamespace(repo=None), rc=[], sig_of={}, fix={},
                      regdiff=lambda slug: None)
d = PK.lens_data(inp, "alpha")
check("pack lens_data surfaces the packet_id", d.get("packet_id") == "alpha@f4f1f77ff610:v2", d.get("packet_id"))
check("pack lens_data names the superseded packet from the prev pairing",
      d.get("supersedes") == "alpha@f4f1f77ff610:v1", d.get("supersedes"))
check("pack lens_data surfaces the wiring provenance",
      d.get("wiring_provenance") == "clean_happy_path", d.get("wiring_provenance"))

print()
print("%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
