#!/usr/bin/env python3
"""C16 (ULW-43) offline self-test: the per-lens isolation phase wiring.

Legs that need no browser: the phase plan's truth table, the probe plan,
the packet block's counted merge of the two legs, the run-level roll-up
counts, and the wiring shape in checks.py / walker.py (the phase is
standard, the block lands in the result, the summary aggregates it).
On the pristine walker this file fails at import — concord_walker.
isolation does not exist there.

The browser-driven legs (cross_account replay + probe_foreign_rows
through Playwright contexts) run where the walker's venv + Chrome exist;
they are NOT run here and are not implied.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)

from concord_walker import isolation as iso

results = {}


def check(name, cond):
    results[name] = bool(cond)


# --- phase plan: standard for write-capable t1 walks, honest skips otherwise
p = iso.phase_plan(acct="t1", admin=False, allow_write=True, has_t2=True)
check("plan: write-capable t1 walk runs the phase", p["run"] and "standard" in p["reason"])
p = iso.phase_plan(acct="t1", admin=False, allow_write=False, has_t2=True)
check("plan: read-only unflagged walk skips with reason", not p["run"] and "read-only" in p["reason"])
p = iso.phase_plan(acct="t1", admin=False, allow_write=False, has_t2=True, two_account_flag=True)
check("plan: flagged read-only walk runs (replay leg)", p["run"])
p = iso.phase_plan(acct="t1", admin=False, allow_write=True, has_t2=False)
check("plan: no t2 session skips honestly", not p["run"] and "t2" in p["reason"])
p = iso.phase_plan(acct="t2", admin=False, allow_write=True, has_t2=True)
check("plan: non-t1 walk skips", not p["run"])
p = iso.phase_plan(acct="t1", admin=True, allow_write=True, has_t2=True)
check("plan: admin look-only walk skips", not p["run"])

# --- probe plan
check("probe: fixture + paths runs", iso.probe_plan(fixture_label="qa-x", api_paths=["/api/a"])["run"])
check("probe: no fixture skips named", not iso.probe_plan(fixture_label=None, api_paths=["/api/a"])["run"])
check("probe: no paths skips named", not iso.probe_plan(fixture_label="qa-x", api_paths=[])["run"])

# --- packet block: counted merge of the two legs
ta = {"status": "FAIL", "replayed": 5, "ownership_failures": 2, "calls": []}
probe = {"verdict": "FIXED", "leaks": ["t2"], "method": "privacy:foreign-rows"}
b = iso.packet_block(ta, probe)
check("block: both legs -> RAN", b["status"] == "RAN")
check("block: checks = replayed", b["checks"] == 5)
check("block: findings = ownership failures", b["findings"] == 2)
check("block: leaks carried", b["leaks"] == ["t2"] and b["probe_verdict"] == "FIXED")
b = iso.packet_block(ta, None, probe_skip="no live labelled fixture for this lens in this run")
check("block: one leg -> PARTIAL + skip named", b["status"] == "PARTIAL" and "fixture" in b["probe_skip"])
b = iso.packet_block({"status": "SKIPPED", "reason": "no saved t2 session (auth/t2.json)"}, None)
check("block: skipped leg -> SKIPPED, zero counts", b["status"] == "SKIPPED" and b["checks"] == 0)

# --- roll-up counts
blocks = [iso.packet_block(ta, probe),
          iso.packet_block({"status": "PASS", "replayed": 3, "ownership_failures": 0}, None),
          None,
          {"status": "SKIPPED", "checks": 0, "findings": 0, "leaks": []}]
c = iso.summarize(blocks)
check("rollup: lenses counted", c["lenses"] == 4)
check("rollup: ran counted (RAN + PARTIAL)", c["ran"] == 2)
check("rollup: checks summed", c["checks"] == 8)
check("rollup: findings summed", c["findings"] == 2)
check("rollup: leak lenses counted", c["leak_lenses"] == 1)
line = iso.summary_line(c)
check("rollup: line states ran/total + counts", "2 of 4" in line and "8 checks" in line)

# --- wiring shape in the shipped sources (text legs; no browser imports)
checks_src = open(os.path.join(WALKER, "concord_walker", "checks.py")).read()
check("wiring: LensWalk.isolation_phase exists", "def isolation_phase(self)" in checks_src)
check("wiring: run() calls the phase", "self.isolation_phase()" in checks_src)
check("wiring: phase drives cross_account + the 04c probe",
      "self.cross_account()" in checks_src and "probe_foreign_rows" in checks_src)
check("wiring: counted block lands in the result", 'self.result["isolation"]' in checks_src)
walker_src = open(os.path.join(WALKER, "walker.py")).read()
check("wiring: summary aggregates isolation counts",
      "isolation" in walker_src and "summarize" in walker_src and "summary_line" in walker_src)

failed = [k for k, v in results.items() if not v]
print("run_selftest_c16: %d/%d PASS" % (len(results) - len(failed), len(results)))
for k in failed:
    print("  FAIL:", k)
sys.exit(1 if failed else 0)
