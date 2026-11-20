#!/usr/bin/env python3
"""ULW C35 selftest (B2): the frozen defect-class vocabulary
(defectclasses.py) and the checks machinery pointed at it.

Covers: the vocabulary holds exactly the frozen 25 (Table 1's eight +
Table 2's seventeen, Amendment 1's six and Amendment 2's
absent-exit-path among them), tags unique, every entry carrying its
table, name, and definition; dialog-self-dismissal is EXCLUDED and
not frozen; the six Table 3 candidates stand in POSTURE and are not
frozen; validate_defect_class answers frozen/excluded/candidate/
unknown distinctly; finding() stamps a frozen tag, records an
untagged finding with defect_class None (today's behaviour), and
refuses an unknown, excluded, or candidate tag loudly (a
finding_with_invalid_defect_class judgment, no finding recorded);
the evidence refusal still fires first for evidence-less findings.

Fail-on-pristine: concord_walker.defectclasses does not exist
pre-C35 — ImportError, so this suite cannot pass there.
"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from concord_walker import defectclasses as dc
from concord_walker.checks import LensWalk

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

TABLE1 = ["silent-wrong-answers", "generation-as-execution",
          "unwired-unreachable", "shortcut-keystroke-eating",
          "ownerless-writes", "greeting-dead-surfaces",
          "permission-walls", "native-dialog-dead-controls"]
AMENDMENT1 = ["simulated-tier-surfaces", "split-store-persistence",
              "raw-identifiers-as-identity", "absent-lifecycle",
              "vocabulary-misleading", "status-sign-inconsistency"]
CANDIDATES = ["generation-applied-without-review",
              "empty-state-promises-vs-the-registry",
              "unscoped-shared-store-rendering",
              "nested-control-dismissal", "spinner-unmount",
              "pre-filled-values-not-registered-until-re-typed"]

check("exactly 25 frozen classes", len(dc.CLASSES) == 25, len(dc.CLASSES))
check("tags unique", len(set(dc.FROZEN_TAGS)) == 25)
check("FROZEN_TAGS is the classes in order",
      list(dc.FROZEN_TAGS) == [c["tag"] for c in dc.CLASSES])
check("Table 1 is the standing eight, in order",
      [c["tag"] for c in dc.CLASSES if c["table"] == 1] == TABLE1)
check("Table 2 holds seventeen",
      len([c for c in dc.CLASSES if c["table"] == 2]) == 17)
check("Amendment 1's six are frozen",
      all(dc.is_frozen(t) for t in AMENDMENT1))
check("absent-exit-path frozen as a class (Amendment 2)",
      dc.is_frozen("absent-exit-path")
      and dc.class_for("absent-exit-path")["table"] == 2)
check("absent-lifecycle and absent-exit-path are distinct entries",
      dc.class_for("absent-lifecycle") is not dc.class_for("absent-exit-path"))
check("every entry carries table, name, definition",
      all(c["table"] in (1, 2) and c["name"] and c["definition"]
          for c in dc.CLASSES))

check("dialog-self-dismissal is excluded, not frozen",
      not dc.is_frozen("dialog-self-dismissal")
      and dc.validate_defect_class("dialog-self-dismissal") == (False, "excluded"))
check("POSTURE holds exactly the six Table 3 candidates",
      [p["tag"] for p in dc.POSTURE] == CANDIDATES)
check("no candidate is frozen; each validates as candidate",
      all(not dc.is_frozen(t)
          and dc.validate_defect_class(t) == (False, "candidate")
          for t in CANDIDATES))
check("every frozen tag validates",
      all(dc.validate_defect_class(t) == (True, None) for t in dc.FROZEN_TAGS))
check("an invented tag validates as unknown",
      dc.validate_defect_class("some-new-class") == (False, "unknown"))
check("class_for round-trips and misses cleanly",
      dc.class_for("permission-walls")["table"] == 1
      and dc.class_for("some-new-class") is None)


class StubRec:
    def __init__(self):
        self.judgments = []
        self.findings = []
        self.rid = "run-test"
    def judgment(self, slug, kind, text, *a, **k):
        self.judgments.append((kind, text))
    def finding(self, rec):
        self.findings.append(rec)


def stub_walk():
    w = LensWalk.__new__(LensWalk)
    w.slug = "demo"
    w.findings = []
    w.rec = StubRec()
    w.cfg = {"accounts": {}}
    w.acct = None
    w.log = lambda *a: None
    return w


EV = ["shots/demo.png"]
w = stub_walk()
w.finding("surface", "P1", "a wall", [], "core loop", "walled", EV,
          defect_class="permission-walls")
check("finding() stamps a frozen tag",
      len(w.findings) == 1 and w.findings[0]["defect_class"] == "permission-walls",
      w.findings)

w = stub_walk()
w.finding("surface", "P2", "untagged", [], "x", "y", EV)
check("finding() without a tag records defect_class None",
      len(w.findings) == 1 and w.findings[0]["defect_class"] is None)

for tag in ("some-new-class", "dialog-self-dismissal", "spinner-unmount"):
    w = stub_walk()
    w.finding("surface", "P1", "bad tag", [], "x", "y", EV, defect_class=tag)
    check("finding() refuses tag %r loudly" % tag,
          w.findings == [] and len(w.rec.judgments) == 1
          and w.rec.judgments[0][0] == "finding_with_invalid_defect_class",
          (w.findings, w.rec.judgments))

w = stub_walk()
w.finding("surface", "P1", "no evidence", [], "x", "y", [],
          defect_class="permission-walls")
check("the evidence refusal still fires (no finding, evidence judgment)",
      w.findings == [] and len(w.rec.judgments) == 1
      and w.rec.judgments[0][0] == "finding_without_evidence",
      w.rec.judgments)

print()
if FAILS:
    print("FAILURES:", len(FAILS))
    for f in FAILS:
        print(" -", f)
    sys.exit(1)
print("ALL PASS")
