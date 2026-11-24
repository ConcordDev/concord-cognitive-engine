#!/usr/bin/env python3
"""C25 wiring selftest (browser-free): case provenance tagging enforcement.

Pins, on the landed tree:
  * the classifier: a rewrite record grounded in observed artefacts
    (live:/manifest:/frontend: step sources) is OBSERVED; one resting on
    ticket text alone is EXTRAPOLATED; an ungrounded control step in an
    otherwise grounded record keeps it EXTRAPOLATED.
  * the enforcement door: rewrites.agree() fails closed with
    case_source_mismatch when a record's DECLARED tag disagrees with the
    tag its own grounding derives -- before any step is mapped -- and a
    correctly stamped record (rewrites.stamp_case_source) draws no
    case_source reason. check_schema refuses a tag outside the vocabulary.
  * the battery door: formfuzz.battery_with_provenance tags ticket-value
    cases OBSERVED and the enumerated patterns EXTRAPOLATED, with
    battery_for's own (name, value) shape untouched.
  * the counting door: provenance_counts keeps the kinds in separate
    counts, names the observed count as the coverage of record, exposes
    NO summed total, and raises on an unknown tag.

Run:  python3 walker/selftest/test_provenance_wiring.py   (from the repo root)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from concord_walker import formfuzz, provenance as P, rewrites as R


def _ticket():
    return {"id": "FIX-demo-001", "lens": "demo",
            "repro_steps": ["Click 'Filters'"], "expected": "the dialog closes"}


def _rw(src, declared=None):
    rw = {"schema": R.SCHEMA, "ticket_id": "FIX-demo-001", "lens": "demo",
          "orig_hash": R.orig_hash(_ticket()), "fold_sha": "f4f1f77ff",
          "author": "selftest", "date": "2026-11-19", "status": "rewritten",
          "steps": [{"op": "click", "target": "Filters", "src": src, "from_orig": [0]}],
          "expected": []}
    if declared is not None:
        rw["case_source"] = declared
    return rw


class Classifier(unittest.TestCase):
    def test_grounded_is_observed(self):
        self.assertEqual(P.classify_rewrite(_rw("live:demo@run1:f4f1f77ff")), P.OBSERVED)
        self.assertEqual(P.classify_rewrite(_rw("manifest:lenses/demo")), P.OBSERVED)
        self.assertEqual(P.classify_rewrite(_rw("frontend:src/x.js:12")), P.OBSERVED)

    def test_text_only_is_extrapolated(self):
        self.assertEqual(P.classify_rewrite(_rw("text")), P.EXTRAPOLATED)
        self.assertEqual(P.classify_rewrite({"steps": []}), P.EXTRAPOLATED)

    def test_ungrounded_control_keeps_extrapolated(self):
        rw = _rw("live:demo@run1:f4f1f77ff")
        rw["steps"].append({"op": "click", "target": "Other", "src": "text", "from_orig": [0]})
        self.assertEqual(P.classify_rewrite(rw), P.EXTRAPOLATED)


class Enforcement(unittest.TestCase):
    def test_mismatch_fails_closed_first(self):
        ok, why = R.agree(_ticket(), _rw("text", declared="observed"))
        self.assertFalse(ok)
        self.assertEqual(len(why), 1)
        self.assertTrue(why[0].startswith("case_source_mismatch"), why)

    def test_stamp_roundtrip_no_case_source_reason(self):
        stamped = R.stamp_case_source(_rw("text"))
        self.assertEqual(stamped["case_source"], "extrapolated")
        ok, why = R.agree(_ticket(), stamped)
        self.assertFalse(any("case_source" in w for w in why), why)

    def test_absent_tag_is_legacy_not_failed(self):
        ok, why = R.agree(_ticket(), _rw("text"))
        self.assertFalse(any("case_source" in w for w in why), why)

    def test_schema_refuses_unknown_tag(self):
        bad = _rw("text", declared="guessed")
        self.assertIn("case_source", R.check_schema(bad) or "")


class BatteryDoor(unittest.TestCase):
    def test_battery_tags(self):
        tagged = formfuzz.battery_with_provenance("text", ["hello"], [])
        by_name = {n: t for n, v, t in tagged}
        self.assertEqual(by_name["ticket-value"], P.OBSERVED)
        self.assertEqual(by_name["blank"], P.EXTRAPOLATED)
        self.assertEqual(by_name["bad-chars"], P.EXTRAPOLATED)
        nums = {n: t for n, v, t in formfuzz.battery_with_provenance("number", [], ["42"])}
        self.assertEqual(nums["negative"], P.EXTRAPOLATED)
        self.assertEqual(nums["ticket-value"], P.OBSERVED)

    def test_battery_for_shape_untouched(self):
        for pair in formfuzz.battery_for("text", ["hello"], []):
            self.assertEqual(len(pair), 2)


class CountingDoor(unittest.TestCase):
    def test_counts_separate_never_summed(self):
        c = P.provenance_counts(["observed", "extrapolated", "observed", "observed"])
        self.assertEqual(c, {"observed": 3, "extrapolated": 1, "coverage_of_record": 3})
        self.assertNotIn("total", c)

    def test_unknown_tag_raises(self):
        with self.assertRaises(ValueError):
            P.provenance_counts(["observed", "guessed"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
