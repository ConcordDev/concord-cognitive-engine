#!/usr/bin/env python3
"""C41 (LC-07, ULW 43-upgrade): per-lens block-reason profiles for the
17 never-walked lenses, rebuilt from scratch — the Nov 13 logs they
rested on are lost with the box copy (UPGRADE-PLAN-20261114 S3).

Pure python, no browser: the pins are data pins over walker/profiles/.

What this pins (each with its failure path):
  * the profile set is EXACTLY the master plan's LC-G3 set — the 17
    walk tickets LC-30..LC-46 in MASTER-V1-FULL.jsonl, whose lens
    groups union to these 17 slugs (at the pre-C41 head the profiles
    directory does not exist and this suite fails at the first leg);
  * every profile is schema-complete (slug/name/url/category, the
    LC-G3 group with its walk ticket, a block_class from the closed
    vocabulary, a block_reason, the Nov 17 run evidence block, the
    config state, the unblock list, the walk-2 disposition);
  * the evidence pins match the run of record (capture 20261117-080754
    at f4f1f77ff): the admin family's five profiles carry the look-only
    skip shape (reach gate 'admin', every replay ticket skipped), audit
    carries reach HTTP 404, whiteboard carries FIX-whiteboard-004
    among its high findings, the write-lane four carry create_delete
    NOT_RUN 'read-only run' with write_skip true, the NA four carry
    create_delete NA, household + trades carry the no-dialog reason;
  * the index census equals the profiles' own class census.

Run: python3 selftest/test_c41_profiles.py (from walker/).
Expected on the build tree: all checks PASS. Pristine control (the
tree without walker/profiles/): fails at the first leg.
"""

import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILES = os.path.join(HERE, "..", "profiles")

FAILURES = []


def check(name, ok, detail=""):
    if ok:
        print(f"  PASS {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILURES.append(name)


# The LC-G3 set of record: slug -> (master_parent, walk ticket).
LC_G3 = {
    "admin": ("MST-W2-15", "LC-30"), "ops": ("MST-W2-15", "LC-31"),
    "psyops": ("MST-W2-15", "LC-32"), "repair-telemetry": ("MST-W2-15", "LC-33"),
    "system": ("MST-W2-15", "LC-34"), "audit": ("MST-W2-15", "LC-35"),
    "chat": ("MST-W2-16", "LC-36"), "affect": ("MST-W2-16", "LC-37"),
    "council": ("MST-W2-16", "LC-38"), "courtship": ("MST-W2-16", "LC-39"),
    "detective": ("MST-W2-16", "LC-40"), "ghost-tracker": ("MST-W2-16", "LC-41"),
    "household": ("MST-W2-16", "LC-42"), "spectate": ("MST-W2-16", "LC-45"),
    "whiteboard": ("MST-W2-16", "LC-46"),
    "marketplace": ("MST-W2-17", "LC-43"), "trades": ("MST-W2-17", "LC-44"),
}

CLASSES = {
    "admin-session-absent", "route-absent", "error-boundary-on-load",
    "write-lane-read-only", "no-create-control", "create-opener-no-dialog",
}

EXPECTED_CLASS = {}
for _s in ("admin", "ops", "psyops", "repair-telemetry", "system"):
    EXPECTED_CLASS[_s] = "admin-session-absent"
EXPECTED_CLASS["audit"] = "route-absent"
EXPECTED_CLASS["whiteboard"] = "error-boundary-on-load"
for _s in ("chat", "council", "spectate", "marketplace"):
    EXPECTED_CLASS[_s] = "write-lane-read-only"
for _s in ("affect", "courtship", "detective", "ghost-tracker"):
    EXPECTED_CLASS[_s] = "no-create-control"
for _s in ("household", "trades"):
    EXPECTED_CLASS[_s] = "create-opener-no-dialog"


def main():
    check("profiles dir exists", os.path.isdir(PROFILES))
    if FAILURES:
        print(f"\n{len(FAILURES)} FAILURES")
        return 1

    files = sorted(f for f in os.listdir(PROFILES) if f.endswith(".json"))
    slugs = sorted(f[:-5] for f in files if f != "index.json")
    check("exactly the 17 LC-G3 profiles + index",
          slugs == sorted(LC_G3) and "index.json" in files,
          f"got {slugs}")

    profiles = {}
    for slug in LC_G3:
        with open(os.path.join(PROFILES, f"{slug}.json")) as fh:
            profiles[slug] = json.load(fh)

    for slug, p in sorted(profiles.items()):
        parent, ticket = LC_G3[slug]
        ok = (
            p["slug"] == slug and p["name"] and p["url"].endswith(f"/lenses/{slug}")
            and p["category"]
            and p["group"]["master_parent"] == parent
            and p["group"]["walk_ticket"] == ticket
            and p["group"]["milestone"] == "LC-G3: The 17 lenses never walked"
            and p["block_class"] in CLASSES
            and p["block_class"] == EXPECTED_CLASS[slug]
            and len(p["block_reason"]) > 80
            and p["nov17_run"]["run_id"] == "20261117-080754"
            and p["nov17_run"]["live_sha"] == "f4f1f77ff610252fba82f35ec0b83da0829d53c6"
            and isinstance(p["unblock"], list) and len(p["unblock"]) >= 2
            and p["walk2_disposition"]
        )
        check(f"schema + group + class: {slug}", ok)

    for slug in ("admin", "ops", "psyops", "repair-telemetry", "system"):
        p = profiles[slug]
        r = p["nov17_run"]
        check(f"admin look-only shape: {slug}",
              r["reach"]["gate"] == "admin" and r["reach"]["http_status"] == 200
              and r["replay"]["skipped"] == r["replay"]["tickets"] > 0
              and p["config_state"]["admin_lens"] is True
              and "surface" in r["phases_not_exercised"])

    r = profiles["audit"]["nov17_run"]
    check("audit route-absent shape",
          r["reach"]["http_status"] == 404 and r["reach"]["status"] == "FAIL")

    r = profiles["whiteboard"]["nov17_run"]
    check("whiteboard error-boundary shape",
          "FIX-whiteboard-004" in r["high_findings"] and r["reach"]["status"] == "FAIL")

    for slug in ("chat", "council", "spectate", "marketplace"):
        p = profiles[slug]
        cd = p["nov17_run"]["create_delete"]
        check(f"write-lane read-only shape: {slug}",
              cd["status"] == "NOT_RUN" and cd["reason"] == "read-only run"
              and p["config_state"]["write_skip"] is True)

    for slug in ("affect", "courtship", "detective", "ghost-tracker"):
        cd = profiles[slug]["nov17_run"]["create_delete"]
        check(f"no-create-control shape: {slug}",
              cd["status"] == "NA" and "no New/Create/Add control" in cd["reason"])

    for slug in ("household", "trades"):
        cd = profiles[slug]["nov17_run"]["create_delete"]
        check(f"opener-no-dialog shape: {slug}",
              cd["status"] == "NOT_RUN" and "no dialog/form" in cd["reason"])

    with open(os.path.join(PROFILES, "index.json")) as fh:
        index = json.load(fh)
    census = Counter(p["block_class"] for p in profiles.values())
    check("index census == profile census",
          index["census"] == dict(sorted(census.items()))
          and sum(census.values()) == 17
          and sorted(index["profiles"]) == sorted(LC_G3))

    print(f"\n{'ALL PASS' if not FAILURES else str(len(FAILURES)) + ' FAILURES'} "
          f"({17} profiles, census {dict(sorted(census.items()))})")
    return 0 if not FAILURES else 1


if __name__ == "__main__":
    sys.exit(main())
