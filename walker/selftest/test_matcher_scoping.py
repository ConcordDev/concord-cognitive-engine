#!/usr/bin/env python3
"""ERROR_TEXT / STATUS_TEXT scoping (H2/H3/H4 matcher fix): a bare status
number in page content is not an error text.

The capture walk (run 20261117-080754) filed achievements, wallet and
staking as failing to load because checks.error_texts matched a11y texts
"500" (a stat/reward figure, the wallet Buy-CC amount tile) and "404.5"
(a staking figure) against ERROR_TEXT's bare 404|500 alternatives. These
legs pin the scoped shape: numeric content produces NO error texts (the
lens PASSes reach), while genuine error texts still match (the lens
still FAILs reach).

Run: python3 selftest/test_matcher_scoping.py
On the pre-fix matcher the numeric-content legs FAIL (the texts match);
the true-error legs hold in both trees (they pin no regression).
"""
import os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import checks

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" " + str(extra)[:300]) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


class Ax:
    def __init__(self, texts):
        self._texts = texts

    def texts(self):
        return list(self._texts)


def errs(texts):
    return checks.LensWalk.error_texts(object.__new__(checks.LensWalk), Ax(texts))


# --- discriminator legs: the H2/H3/H4 record texts must NOT match --------
check("achievements '500' figure is not an error text", errs(["500"]) == [], errs(["500"]))
check("achievements desktop+mobile pair '500; 500' is not an error text",
      errs(["500", "500"]) == [], errs(["500", "500"]))
check("wallet Buy-CC '500' tile is not an error text", errs(["500 CC"]) == [], errs(["500 CC"]))
check("staking '404.5' figure is not an error text", errs(["404.5"]) == [], errs(["404.5"]))
check("grouped figure '1,500' is not an error text", errs(["1,500"]) == [], errs(["1,500"]))
check("positive compound '500 error-free plays' is not an error text",
      errs(["500 error-free plays"]) == [], errs(["500 error-free plays"]))

# --- control legs: genuine error texts must STILL match -------------------
for text in ("Internal Server Error", "500 Internal Server Error", "404 Not Found",
             "This page could not be found", "Failed to load", "Something went wrong",
             "Error 500", "Application error"):
    check("true error text still matches: %r" % text, errs([text]) == [text], errs([text]))

# --- reach-level shape: a numeric-content lens yields no error texts -----
check("mixed content page yields no error texts",
      errs(["Achievements", "500", "Level 12", "404.5", "Keep going"]) == [],
      errs(["Achievements", "500", "Level 12", "404.5", "Keep going"]))

print()
if FAILS:
    print("FAILED: %d leg(s): %s" % (len(FAILS), ", ".join(FAILS)))
    sys.exit(1)
print("ALL PASS")
