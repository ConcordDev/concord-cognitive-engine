#!/usr/bin/env python3
"""Root-cause grouping of raw fix_tickets.jsonl (does not rewrite tickets).

Uses the 108-ticket snapshot from the 2026-11-15 live walk as a fixture.
Expects the 78 Escape / Expand sub-lenses tickets to collapse to one row,
overflow-at-390 to one row, contrast to split by colour pair, and per-lens
functional bugs (export with no file) to stay their own row.

Failure paths: empty file, a malformed line, and an unknown-shape ticket
must not crash and must not invent rows from junk.

Run: python3 selftest/test_root_causes.py   (exit 0 = all legs pass)
No browser, no network, no secrets.
"""
import json, os, shutil, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIXTURE = os.path.join(HERE, "fixtures", "fix_tickets_108.jsonl")
sys.path.insert(0, ROOT)

from concord_walker.root_causes import (
    load_tickets, group_tickets, build_report, write_root_causes,
    contrast_pairs,
)

FAILS = []


def check(name, cond, detail=""):
    if cond:
        print("PASS", name)
    else:
        FAILS.append(name)
        print("FAIL", name, detail if detail else "")


def _row(report, sig=None, prefix=None):
    rows = report["rows"]
    if sig:
        hits = [r for r in rows if r["signature"] == sig]
        return hits[0] if hits else None
    if prefix:
        return [r for r in rows if r["signature"].startswith(prefix)]
    return rows


def t_fixture_present():
    check("fixture exists", os.path.isfile(FIXTURE), FIXTURE)
    n = sum(1 for l in open(FIXTURE) if l.strip())
    check("fixture has 108 tickets", n == 108, "got %d" % n)


def t_live_fixture_grouping():
    tickets, skipped = load_tickets(FIXTURE)
    check("fixture loads with no skips", skipped == [] and len(tickets) == 108,
          "tickets=%d skipped=%s" % (len(tickets), skipped[:3]))
    report = build_report(FIXTURE)
    # stable across a second pass
    report2 = build_report(FIXTURE)
    check("signatures stable across reruns",
          [r["signature"] for r in report["rows"]] == [r["signature"] for r in report2["rows"]])

    esc = _row(report, "escape.sub_lens_expand_menu")
    check("escape collapses to one row", esc is not None)
    if esc:
        check("escape count is 78", esc["count"] == 78, "got %s" % esc["count"])
        check("escape title names the shared menu",
              "Expand sub-lenses" in esc["title"] and "Chat" not in esc["title"])
        check("escape severity is low", esc["severity"] == "low")
        check("escape spans many lenses", len(esc["lenses"]) >= 10,
              esc["lenses"])
        check("escape has example evidence", len(esc["evidence"]) >= 1)
        check("escape suspected_area is overlay keyboard",
              "overlay keyboard" in (esc["suspected_area"] or ""))

    ov = _row(report, "overflow.offscreen_390")
    check("overflow-390 is one row", ov is not None)
    if ov:
        check("overflow count is 14", ov["count"] == 14, "got %s" % ov["count"])
        check("overflow area is mobile layout",
              "mobile" in (ov["suspected_area"] or "").lower())

    contrast = _row(report, prefix="contrast.")
    check("contrast is grouped by colour pair (more than 1 row)",
          len(contrast) > 1, "got %d" % len(contrast))
    # unique pairs in the fixture
    pairs = set()
    for t in tickets:
        if "contrast" in (t.get("title") or "").lower() or "WCAG" in (t.get("title") or ""):
            pairs.update(contrast_pairs(t))
    check("one contrast row per unique pair",
          len(contrast) == len(pairs) and len(pairs) == 17,
          "rows=%d pairs=%d" % (len(contrast), len(pairs)))
    pink = _row(report, "contrast.ffffff_on_ec4899")
    check("shared #ffffff on #ec4899 is its own row", pink is not None)
    if pink:
        check("#ffffff on #ec4899 appears on all 14 contrast tickets",
              pink["count"] == 14, "got %s" % pink["count"])
        check("contrast title carries the pair",
              "#ffffff" in pink["title"] and "#ec4899" in pink["title"])
        # member tickets include a medium-severity contrast ticket (code)
        check("contrast severity is max(members)",
              pink["severity"] in ("low", "medium"))

    exp = _row(report, "export.no_file.hub")
    check("hub export-no-file stays its own per-lens row", exp is not None)
    if exp:
        check("export count is 1", exp["count"] == 1)
        check("export lenses is only hub", exp["lenses"] == ["hub"], exp["lenses"])
        check("export severity is medium", exp["severity"] == "medium")

    unnamed = _row(report, "a11y.unnamed_control")
    check("unnamed-control row exists", unnamed is not None)
    if unnamed:
        check("unnamed count is 1", unnamed["count"] == 1)

    # handful: 1 escape + 1 overflow + 17 contrast + 1 export + 1 unnamed = 21
    check("whole set is 21 rows (handful vs 108 tickets)",
          report["row_count"] == 21, "got %d" % report["row_count"])
    check("row count is far below ticket count",
          report["row_count"] <= 25 and report["row_count"] < report["ticket_count"] / 4)

    # every fixture ticket is in at least one row
    covered = set()
    for r in report["rows"]:
        covered.update(r["ticket_ids"])
    ids = {t["id"] for t in tickets}
    check("every fixture ticket is a member of some row",
          covered == ids, "missing=%s extra=%s" % (sorted(ids - covered)[:5], sorted(covered - ids)[:5]))

    # fix_tickets.jsonl is not rewritten
    before = open(FIXTURE, "rb").read()
    # write into a temp audit dir copied from the fixture
    tmp = tempfile.mkdtemp(prefix="walker-rc-")
    try:
        audit = os.path.join(tmp, "audit")
        os.makedirs(audit)
        dest = os.path.join(audit, "fix_tickets.jsonl")
        shutil.copy(FIXTURE, dest)
        out = write_root_causes(audit)
        check("write_root_causes returns the report", out and out["row_count"] == 21)
        check("root_causes.json written", os.path.isfile(os.path.join(audit, "root_causes.json")))
        check("root_causes.md written", os.path.isfile(os.path.join(audit, "root_causes.md")))
        after = open(dest, "rb").read()
        check("fix_tickets.jsonl left byte-identical", after == before)
        data = json.load(open(os.path.join(audit, "root_causes.json")))
        check("json has signature/title/severity/count/lenses/evidence/suspected_area",
              all(k in data["rows"][0] for k in
                  ("signature", "title", "severity", "count", "lenses", "evidence", "suspected_area")))
        md = open(os.path.join(audit, "root_causes.md")).read()
        check("md names the escape signature", "escape.sub_lens_expand_menu" in md)
        check("md is not empty", len(md) > 200)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def t_failure_empty():
    tmp = tempfile.mkdtemp(prefix="walker-rc-empty-")
    try:
        audit = os.path.join(tmp, "audit")
        os.makedirs(audit)
        open(os.path.join(audit, "fix_tickets.jsonl"), "w").close()
        report = write_root_causes(audit)
        check("empty file: no crash", report is not None)
        check("empty file: 0 tickets", report["ticket_count"] == 0)
        check("empty file: 0 rows", report["row_count"] == 0)
        check("empty file: 0 skipped", report["skipped"] == 0)
        data = json.load(open(os.path.join(audit, "root_causes.json")))
        check("empty file: json rows is []", data["rows"] == [])
        md = open(os.path.join(audit, "root_causes.md")).read()
        check("empty file: md still written", "0 ticket" in md or "No root-cause" in md)
        # missing file is the same (not an error)
        os.remove(os.path.join(audit, "fix_tickets.jsonl"))
        report = write_root_causes(audit)
        check("missing file: 0 rows, no crash", report and report["row_count"] == 0)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def t_failure_malformed():
    tmp = tempfile.mkdtemp(prefix="walker-rc-bad-")
    try:
        audit = os.path.join(tmp, "audit")
        os.makedirs(audit)
        good = [json.loads(l) for l in open(FIXTURE) if l.strip()][:3]
        # 2 good escape tickets + a broken line + 1 good overflow
        esc = [t for t in good if (t.get("title") or "").startswith("Escape")]
        ov = None
        for l in open(FIXTURE):
            if not l.strip():
                continue
            t = json.loads(l)
            if "390" in (t.get("title") or ""):
                ov = t
                break
        path = os.path.join(audit, "fix_tickets.jsonl")
        with open(path, "w") as f:
            f.write(json.dumps(esc[0]) + "\n")
            f.write("{this is not json\n")
            f.write(json.dumps(esc[1] if len(esc) > 1 else esc[0]) + "\n")
            f.write(json.dumps(ov) + "\n")
        report = write_root_causes(audit)
        check("malformed line: no crash", report is not None)
        check("malformed line: skipped at least 1", report["skipped"] >= 1,
              "skipped=%s" % report["skipped"])
        check("malformed line: good tickets still grouped",
              report["ticket_count"] == 3 and report["row_count"] == 2,
              "tickets=%s rows=%s" % (report["ticket_count"], report["row_count"]))
        check("malformed line: tickets file not rewritten",
              "{this is not json" in open(path).read())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def t_failure_unknown_shape():
    tmp = tempfile.mkdtemp(prefix="walker-rc-shape-")
    try:
        audit = os.path.join(tmp, "audit")
        os.makedirs(audit)
        good = json.loads(next(l for l in open(FIXTURE) if l.strip()))
        path = os.path.join(audit, "fix_tickets.jsonl")
        with open(path, "w") as f:
            f.write(json.dumps(good) + "\n")
            f.write(json.dumps({"foo": 1, "bar": [2]}) + "\n")
            f.write(json.dumps({"id": "FIX-mystery-001", "status": "OPEN"}) + "\n")
            f.write(json.dumps({"type": "retest_update", "id": good["id"],
                                "status": "VERIFIED"}) + "\n")
            f.write("null\n")
            f.write("[]\n")
        report = write_root_causes(audit)
        check("unknown shape: no crash", report is not None)
        check("unknown shape: only the real ticket is grouped",
              report["ticket_count"] == 1 and report["row_count"] == 1,
              "tickets=%s rows=%s skipped=%s" % (
                  report["ticket_count"], report["row_count"], report["skipped"]))
        check("unknown shape: stubs and updates are skipped",
              report["skipped"] >= 4, "skipped=%s" % report["skipped"])
        # did not invent a row from the shapeless dict
        sigs = [r["signature"] for r in report["rows"]]
        check("unknown shape: no junk signature", all("mystery" not in s for s in sigs), sigs)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    t_fixture_present()
    t_live_fixture_grouping()
    t_failure_empty()
    t_failure_malformed()
    t_failure_unknown_shape()
    print()
    print("%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
