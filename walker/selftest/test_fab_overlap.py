#!/usr/bin/env python3
"""GB-1581 item 3b unit tests: the 390 px FAB / bottom-nav overlap geometry.

Pure geometry (checks.fab_nav_overlaps / rects_overlap): a floating action
button whose (x, y, w, h) box intersects the fixed bottom nav's box is
reported with the intersection area; clear, edge-touching and disjoint
boxes are not.
Run: python3 selftest/test_fab_overlap.py"""
import os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker.checks import rects_overlap, fab_nav_overlaps

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(extra)) if (extra and not cond) else ""))
    if not cond:
        FAILS.append(name)


NAV = (0, 788, 390, 56)          # fixed bottom nav at 390x844
FAB_CLEAR = (318, 700, 56, 56)  # floats above the nav, no contact
FAB_OVER = (318, 760, 56, 56)   # dips 28 px into the nav band
FAB_SIDE = (10, 700, 56, 56)


def test_geometry():
    check("clear FAB does not overlap", not rects_overlap(FAB_CLEAR, NAV))
    check("dipping FAB overlaps", rects_overlap(FAB_OVER, NAV))
    check("edge-touching is not an overlap", not rects_overlap((318, 732, 56, 56), NAV))
    check("disjoint boxes do not overlap", not rects_overlap(FAB_SIDE, (200, 100, 50, 50)))
    hits = fab_nav_overlaps([("New post", FAB_OVER), ("Help", FAB_CLEAR)], [NAV])
    check("only the intersecting FAB is reported", len(hits) == 1 and hits[0]["control"] == "New post", hits)
    check("overlap area is the intersection", hits and hits[0]["overlap_px"] == 56 * 28, hits)
    check("no navs -> no hits", fab_nav_overlaps([("New post", FAB_OVER)], []) == [])
    check("second nav can be the intersecting one",
          len(fab_nav_overlaps([("New post", FAB_OVER)], [(0, 0, 390, 40), NAV])) == 1)


if __name__ == "__main__":
    test_geometry()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
