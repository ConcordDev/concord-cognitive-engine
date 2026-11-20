#!/usr/bin/env python3
"""ULW v3 W5b selftest (B2, GB-1576): the ownership + private-broadcast
sweep.

Covers:
  * broadcast_verdict: LEAK / CLEAN / NO_FRAMES (no traffic is never a
    pass), and the trust block's broadcast leg: a leak fails the block,
    a skip is named, status counts three legs;
  * ownerscan over synthetic sources: a write handler loading by
    req.params.id with no owner comparison is flagged and outranks a
    read handler; a handler WITH an ownership comparison is excluded; a
    destructured body id is a source; a room-scoped emit and a
    single-socket emit are not global; a global emit with a data payload
    is flagged, with a constant payload is not; a global-log push with a
    data payload is flagged; ranking is deterministic;
  * scan_tree over a synthetic tree: node_modules and test files skipped;
  * wiring: trust_phase runs _broadcast_leg, the leg files through
    _premap_finding, walker.py carries the owner-scan subcommand.

Fail-on-pristine: concord_walker.ownerscan does not exist pre-build, and
trust_probes has no broadcast_verdict.
"""
import json, os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from concord_walker import ownerscan as oscan
from concord_walker import trust_probes as tp

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

# --- broadcast verdicts + block ---------------------------------------------
check("marker in frames -> LEAK", tp.broadcast_verdict(4, True) == "LEAK")
check("frames, no marker -> CLEAN", tp.broadcast_verdict(4, False) == "CLEAN")
check("no frames -> NO_FRAMES (never a pass)", tp.broadcast_verdict(0, False) == "NO_FRAMES")
row = lambda v: {"kind": "update", "method": "POST", "path": "/x", "status": 200, "verdict": v}
b = tp.trust_block([row("REFUSED")], [row("REFUSED")], broadcast={"verdict": "LEAK", "frames": 3})
check("leak fails the block, three legs RAN", b["verdict"] == "FAIL" and b["findings"] == 1 and b["status"] == "RAN" and b["checks"] == 3, b)
b2 = tp.trust_block([row("REFUSED")], None, None, "no actor fields", broadcast_skip="no live labelled fixture")
check("broadcast skip named, status PARTIAL", b2["status"] == "PARTIAL" and b2["legs"]["broadcast"]["skip"].startswith("no live"), b2)
b3 = tp.trust_block([row("REFUSED")], [row("TOLERATED")])
check("two-leg block unchanged without broadcast", b3["status"] == "RAN" and "broadcast" not in b3["legs"], b3)

# --- ownerscan: pattern A ------------------------------------------------------
BAD_WRITE = '''
app.post("/api/studio/projects/:id/tracks", (req, res) => {
  const project = db.prepare("SELECT id FROM studio_projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).json({ error: "not found" });
  const { instrument_id } = req.body;
  db.prepare("INSERT INTO tracks (project_id) VALUES (?)").run(req.params.id);
  res.json({ ok: true });
});
'''
GOOD_WRITE = '''
app.post("/api/studio/projects/:id/tracks", (req, res) => {
  const project = db.prepare("SELECT id, ownerId FROM studio_projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).json({ error: "not found" });
  if (project.ownerId !== req.user.id) return res.status(403).json({ error: "forbidden" });
  res.json({ ok: true });
});
'''
READ_ROUTE = '''
app.get("/api/market/items/:id", (req, res) => {
  const item = getDTU(req.params.id);
  res.json(item);
});
'''
rows_bad = oscan.scan_file("a.js", BAD_WRITE)
check("unchecked write lookup flagged", len(rows_bad) == 1 and rows_bad[0]["kind"] == "id_lookup_no_owner_check", rows_bad)
check("write route scores the full signal set", rows_bad and rows_bad[0]["score"] == 95
      and "id_from_body" in rows_bad[0]["signals"] and rows_bad[0]["route"] == "POST /api/studio/projects/:id/tracks", rows_bad)
check("owner-checked handler excluded", oscan.scan_file("b.js", GOOD_WRITE) == [])
rows_read = oscan.scan_file("c.js", READ_ROUTE)
check("read lookup flagged lower", len(rows_read) == 1 and rows_read[0]["score"] < rows_bad[0]["score"], rows_read)

# --- ownerscan: pattern B --------------------------------------------------------
GLOBAL_EMIT = 'io.emit("user:notification", { userId: target, text: msg });'
SCOPED_EMIT = 'io.to(roomId).emit("room:update", { state: s });'
CONST_EMIT = 'io.emit("server:tick");'
SOCKET_EMIT = 'socket.emit("liveshare:debug:state-snapshot", { snap: 1 });'
LOG_PUSH = 'eventLog.push({ type: "dm", from: a, to: b, body: text });'
check("global emit with data payload flagged", len(oscan.scan_file("d.js", GLOBAL_EMIT)) == 1
      and oscan.scan_file("d.js", GLOBAL_EMIT)[0]["signals"].count("private_shaped_event") == 1)
check("room-scoped emit not global", oscan.scan_file("e.js", SCOPED_EMIT) == [])
check("constant-payload emit not flagged", oscan.scan_file("f.js", CONST_EMIT) == [])
check("single-socket emit not global", oscan.scan_file("g.js", SOCKET_EMIT) == [])
check("global log push flagged", len(oscan.scan_file("h.js", LOG_PUSH)) == 1
      and oscan.scan_file("h.js", LOG_PUSH)[0]["kind"] == "global_emit_private_payload")

# --- scan_tree -------------------------------------------------------------------
with tempfile.TemporaryDirectory() as td:
    os.makedirs(os.path.join(td, "node_modules", "x"))
    os.makedirs(os.path.join(td, "routes"))
    open(os.path.join(td, "routes", "a.js"), "w").write(BAD_WRITE)
    open(os.path.join(td, "routes", "a.test.js"), "w").write(BAD_WRITE)
    open(os.path.join(td, "node_modules", "x", "b.js"), "w").write(BAD_WRITE)
    tree_rows = oscan.scan_tree(td)
check("tree scan skips tests + node_modules", len(tree_rows) == 1 and tree_rows[0]["file"].endswith("routes/a.js") and tree_rows[0]["rank"] == 1, tree_rows)
check("ranking deterministic", oscan.scan_file("a.js", BAD_WRITE) == rows_bad)

# --- wiring ------------------------------------------------------------------------
base = os.path.join(os.path.dirname(__file__), "..")
checks_src = open(os.path.join(base, "concord_walker", "checks.py")).read()
walker_src = open(os.path.join(base, "walker.py")).read()
check("trust_phase runs the broadcast leg", "self._broadcast_leg(owner, observer, octx, b_label, b_candidates)" in checks_src)
check("broadcast leg files ownership findings", checks_src.count('_premap_finding("ownership"') >= 2 and "FrameCapture" in checks_src)
check("owner-scan subcommand wired", '"owner-scan"' in walker_src and "cmd_owner_scan" in walker_src)

print()
if FAILS:
    print("W5B SWEEP: %d FAILURES: %s" % (len(FAILS), FAILS))
    sys.exit(1)
print("W5B SWEEP: ALL PASS")
