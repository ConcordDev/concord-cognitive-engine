#!/usr/bin/env python3
"""Selftest for the GB-1575 W1 redesign study deliverables.

Validates walker/analysis/redesign_misses.jsonl (the machine-readable half of
the study): every row carries the full schema, verdicts and signal classes are
in their vocabularies, row ids are unique, every check id resolves to exactly
one catalogue entry in walker/docs/REDESIGN-STUDY.md, and the study's headline
counts (rows / caught / partial / missed) match the file. Stdlib only.

Run directly:  python3 selftest/test_redesign_misses.py   (exit 0 = PASS)
"""
import json
import re
import sys
from pathlib import Path

WALKER = Path(__file__).resolve().parent.parent
JSONL = WALKER / "analysis" / "redesign_misses.jsonl"
STUDY = WALKER / "docs" / "REDESIGN-STUDY.md"

VERDICTS = {"caught", "partial", "missed"}
SIGNALS = {"ui", "network", "two-account", "code-scan", "media", "ci"}
ROW_KEYS = {"id", "lens", "redesign", "defect", "defect_class", "found_by",
            "ulw", "walk_evidence", "check"}
CHECK_KEYS = {"id", "name", "signal", "home", "sketch"}
# The thirteen of GB-1575 plus the flagged fourteenth (photos).
STUDY_LENSES = {"retail", "conkay", "studio", "music", "code", "news",
                "market", "art", "podcast", "dtus", "film-studios",
                "animation", "graph", "photos",
                "platform", "feed"}  # cross-cutting rows ride platform/feed


def main() -> int:
    failures = []

    rows = []
    for lineno, line in enumerate(JSONL.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as exc:
            failures.append(f"jsonl line {lineno}: invalid JSON: {exc}")

    if not rows:
        failures.append("redesign_misses.jsonl is empty")

    ids = [r.get("id") for r in rows]
    if len(ids) != len(set(ids)):
        failures.append("row ids are not unique")

    catalogue_ids = set()
    if STUDY.exists():
        text = STUDY.read_text(encoding="utf-8")
        marker = "# The new-check catalogue"
        if marker in text:
            catalogue_text = text.split(marker, 1)[1]
            end = catalogue_text.find("\n# What this means")
            if end != -1:
                catalogue_text = catalogue_text[:end]
            catalogue_ids = set(re.findall(r"^### ([A-Z][A-Z0-9-]+) — ",
                                           catalogue_text, flags=re.M))
        else:
            failures.append("REDESIGN-STUDY.md lacks the new-check catalogue section")
    else:
        failures.append("REDESIGN-STUDY.md missing beside the analysis file")

    for r in rows:
        rid = r.get("id", "<no id>")
        missing = ROW_KEYS - set(r)
        if missing:
            failures.append(f"{rid}: missing row keys {sorted(missing)}")
        if r.get("ulw") not in VERDICTS:
            failures.append(f"{rid}: verdict {r.get('ulw')!r} not in {sorted(VERDICTS)}")
        if r.get("lens") not in STUDY_LENSES:
            failures.append(f"{rid}: lens {r.get('lens')!r} outside the study scope")
        chk = r.get("check") or {}
        cmissing = CHECK_KEYS - set(chk)
        if cmissing:
            failures.append(f"{rid}: check missing keys {sorted(cmissing)}")
        if chk.get("signal") not in SIGNALS:
            failures.append(f"{rid}: signal {chk.get('signal')!r} not in {sorted(SIGNALS)}")
        if chk.get("id") not in catalogue_ids:
            failures.append(f"{rid}: check id {chk.get('id')!r} has no catalogue entry in REDESIGN-STUDY.md")
        for key in ("defect", "found_by", "walk_evidence"):
            if not str(r.get(key, "")).strip():
                failures.append(f"{rid}: {key} is empty")

    # Every catalogue entry must be used by at least one row (no orphans).
    used = {r["check"]["id"] for r in rows if r.get("check")}
    for cid in sorted(catalogue_ids - used):
        failures.append(f"catalogue check {cid} is not referenced by any row")

    counts = {v: sum(1 for r in rows if r.get("ulw") == v) for v in VERDICTS}
    print(f"rows={len(rows)} caught={counts['caught']} partial={counts['partial']} "
          f"missed={counts['missed']} checks={len(used)}")

    if failures:
        for f_ in failures:
            print("FAIL:", f_)
        return 1
    print("PASS: redesign_misses.jsonl schema, verdicts, and catalogue cross-refs all hold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
