"""CB-1240 FIX 1: the needs---allow-write classification + the arming invariants.

Pins: (1) classify() puts synthetic rows into all five classes by the
_write_ctx rules; (2) every input id lands in exactly one class; (3) the
reverify composition the rerun's arming relies on still holds in source:
--allow-write and --allow-write-own compose per-lens (the C28 write-account
block and the C38 write-own block are mutually exclusive by the write_skip
condition), and the write-own ctx requires the t2 session.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER_DIR = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(WALKER_DIR, "tools"))
sys.path.insert(0, WALKER_DIR)

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" — " + detail) if detail and not cond else ""))
    if not cond:
        FAILS.append(name)

from classify_allow_write import classify

skip, admin = {"auction", "marketplace"}, {"debug", "ops"}
fold = {
    "FIX-alliance-001": {"id": "FIX-alliance-001", "lens": "alliance", "repro_steps": "Share > Publish > Esc"},
    "FIX-auction-001": {"id": "FIX-auction-001", "lens": "auction", "repro_steps": "Type 0 in Start CC"},
    "FIX-debug-001": {"id": "FIX-debug-001", "lens": "debug", "repro_steps": "Create a widget"},
    "FIX-agents-001": {"id": "FIX-agents-001", "lens": "agents", "repro_steps": "See evidence/agents.md"},
    "FIX-board-001": {"id": "FIX-board-001", "lens": "board", "repro_steps": None},
    "FIX-alliance-002": {"id": "FIX-alliance-002", "lens": "alliance", "repro_steps": "Analytics > Compatibility"},
    "FIX-ar-001": {"id": "FIX-ar-001", "lens": "ar", "repro_steps": "Trash on any item"},
}
ids = list(fold)
out = classify(ids, fold, skip, admin)
check("GENERAL takes the non-skip write-step rows", sorted(out["GENERAL"]) == ["FIX-alliance-001", "FIX-ar-001"], str(out["GENERAL"]))
check("WRITE-OWN takes the write-skip row", out["WRITE-OWN"] == ["FIX-auction-001"], str(out["WRITE-OWN"]))
check("ADMIN-EXCLUDED takes the admin row even with write steps", out["ADMIN-EXCLUDED"] == ["FIX-debug-001"], str(out["ADMIN-EXCLUDED"]))
check("NO-STEPS takes pointer + absent steps", sorted(out["NO-STEPS"]) == ["FIX-agents-001", "FIX-board-001"], str(out["NO-STEPS"]))
check("MISLABELLED-CANDIDATE takes the read-only steps", out["MISLABELLED-CANDIDATE"] == ["FIX-alliance-002"], str(out["MISLABELLED-CANDIDATE"]))
check("a delete verb (trash) is a write, not a mislabel", "FIX-ar-001" in out["GENERAL"], str(out))
flat = [t for v in out.values() for t in v]
check("every id classified exactly once", sorted(flat) == sorted(ids) and len(flat) == len(set(flat)))

src = open(os.path.join(WALKER_DIR, "concord_walker", "reverify.py")).read()
check("C28 block: write account for non-skip lenses under --allow-write",
      'if self.allow_write and not admin and lens not in self.cfg.get("write_skip_lenses", [])' in src)
check("C38 block: write-own rows replay as t2 on write-skip lenses",
      'self.allow_write and self.allow_write_own and not admin' in src and 'acct = "t2"' in src)
check("write-own ctx requires the t2 session",
      'if not (self.allow_write_own and acct == "t2")' in src)
check("no write ctx on admin, ever", "if not self.allow_write or admin:" in src)

print("FAILURES: %d" % len(FAILS))
sys.exit(1 if FAILS else 0)
