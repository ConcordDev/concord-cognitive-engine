#!/usr/bin/env python3
"""Slug-to-filename sanitization (nested slugs must not become subdirectories).

The crash on world-creator/anomalies: cmd_walk wrote lens-%s.json with the raw
slug, so open() looked for a missing world-creator/ directory. This suite pins
the helper, the run-dir result path, evidence_dir, and the failure path of the
unsanitized write.

Run: python3 selftest/test_safe_filename.py   (exit 0 = all legs pass)
No browser, no network, no secrets.
"""
import json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from concord_walker.util import safe_filename, lens_result_path
from concord_walker.records import RunRecorder

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print("PASS", name)
    else:
        FAILS.append(name)
        print("FAIL", name, detail)


def t_safe_filename():
    check("slash becomes __", safe_filename("world-creator/anomalies") == "world-creator__anomalies")
    check("single backslash becomes __", safe_filename("a" + chr(92) + "b") == "a__b")
    check("simple slug unchanged", safe_filename("council") == "council")
    check("spaces and colons replaced", safe_filename("a b:c*") == "a_b_c_")
    check("empty falls back", safe_filename("") == "slug")
    check("dot falls back", safe_filename(".") == "slug")
    check("dotdot falls back", safe_filename("..") == "slug")
    def _no_sep(s):
        return os.sep not in s and (os.altsep is None or os.altsep not in s)
    check("slash-only is a single component", _no_sep(safe_filename("/")) and safe_filename("/") not in ("", ".", ".."))
    samples = ["world-creator/anomalies", "a/b/c", "a" + chr(92) + "b", "..", ".",
               "/etc/passwd", "foo/../../etc"]
    for s in samples:
        out = safe_filename(s)
        check("no sep in %r -> %r" % (s, out), _no_sep(out))
        check("not empty-or-dot %r -> %r" % (s, out), out not in ("", ".", ".."))


def t_failure_path():
    """The pre-fix write (raw slug in the filename) raises FileNotFoundError."""
    with tempfile.TemporaryDirectory(prefix="walker-slug-fail-") as tmp:
        slug = "world-creator/anomalies"
        raw = os.path.join(tmp, "lens-%s.json" % slug)
        # lens-%s.json % "world-creator/anomalies" => .../lens-world-creator/anomalies.json
        check("unsanitized path is a subdirectory",
              os.path.dirname(raw) == os.path.join(tmp, "lens-world-creator")
              and os.path.basename(raw) == "anomalies.json")
        check("unsanitized parent does not exist", not os.path.exists(os.path.dirname(raw)))
        raised = None
        try:
            with open(raw, "w") as f:
                f.write("{}")
        except FileNotFoundError as e:
            raised = e
        check("unsanitized open raises FileNotFoundError", isinstance(raised, FileNotFoundError), repr(raised))
        check("unsanitized write created no file", not os.path.exists(raw))


def t_lens_result_path_and_recorder():
    """The fixed helpers write a flat file and a flat evidence dir."""
    with tempfile.TemporaryDirectory(prefix="walker-slug-ok-") as tmp:
        slug = "world-creator/anomalies"
        run_dir = os.path.join(tmp, "runs", "rid")
        os.makedirs(run_dir)
        path = lens_result_path(run_dir, slug)
        check("result path is flat in run dir", os.path.dirname(path) == run_dir)
        check("result name uses __", os.path.basename(path) == "lens-world-creator__anomalies.json")
        with open(path, "w") as f:
            json.dump({"slug": slug}, f)
        check("sanitized result write succeeds", os.path.isfile(path))
        check("no world-creator subdir under run dir",
              not os.path.isdir(os.path.join(run_dir, "world-creator")))

        audit = os.path.join(tmp, "audit")
        os.makedirs(audit)
        cfg = {"_walker_dir": tmp, "runs_dir": os.path.join(tmp, "runs"),
               "audit_dir": audit, "queue_dir": os.path.join(tmp, "queue"),
               "evidence_dir": os.path.join(audit, "evidence"),
               "accounts": {"t1": {"username": "fixture"}}}
        rec = RunRecorder(cfg, "ridtest", dry=False)
        ev = rec.evidence_dir(slug)
        check("evidence dir uses sanitized slug",
              os.path.basename(os.path.dirname(ev)) == "world-creator__anomalies")
        check("evidence dir exists", os.path.isdir(ev))
        check("evidence is not nested under world-creator/anomalies",
              not os.path.isdir(os.path.join(audit, "evidence", "world-creator", "anomalies")))
        # a screenshot-style file can be written there
        shot = os.path.join(ev, "walker-01-demo.png")
        open(shot, "wb").close()
        check("evidence file writes under flat dir", os.path.isfile(shot))


def t_inventory_slash_slugs():
    inv = json.load(open(os.path.join(ROOT, "inventory.json")))
    slugs = [x["slug"] for x in inv]
    slash = [s for s in slugs if "/" in s or "\\" in s or chr(92) in s]
    check("inventory contains the known nested slug", "world-creator/anomalies" in slugs)
    check("only one nested slug in shipped inventory", slash == ["world-creator/anomalies"], slash)
    names = [safe_filename(s) for s in slugs]
    check("sanitized inventory names are unique", len(names) == len(set(names)))
    check("every sanitized name is a single component",
          all(os.sep not in n and (not os.altsep or os.altsep not in n) for n in names))


if __name__ == "__main__":
    t_safe_filename()
    t_failure_path()
    t_lens_result_path_and_recorder()
    t_inventory_slash_slugs()
    print()
    print("%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
