#!/usr/bin/env python3
"""
Frontend npm audit FP-aware gate.

Reads audit.json (output of `npm audit --omit=dev --json` run from
concord-frontend/), filters out advisories that are known FP for our
codebase, and exits non-zero iff a REAL high/critical finding remains.

Known FP allowlist (no upstream fix; audited as not-applicable):

  GHSA-r5fr-rjxr-66jc
    lodash _.template code injection. Codebase audit confirms
    _.template is never invoked (`grep -rE "lodash.*template|_.template\\("`
    → 0 hits). Transitive via @excalidraw → mermaid → chevrotain parser
    which doesn't use _.template.

  GHSA-xxjr-mmjv-4gpg
    lodash prototype pollution via _.unset/_.omit array paths. Same
    transitive source (chevrotain parser). chevrotain uses lodash for
    basic iteration helpers, not user-supplied array path operations.

When npm registry adds NEW high-severity advisories on these packages
that ARE NOT FPs, they will surface here as real high/critical findings
and the gate will block. Add new allowlist entries by audit + PR
discussion only.

Extracted to its own file (Sprint 35 v2) because embedding multiline
Python inside a YAML `run: |` block-scalar broke under matrix nesting —
YAML strips the common leading indent, which leaves Python top-level
statements indented and rejected by the interpreter.

Usage:
  npm audit --omit=dev --json > audit.json
  python3 ../scripts/ci/check-frontend-audit.py audit.json
"""

import json
import sys
from pathlib import Path

ALLOWLIST_ADVISORIES = {
    "GHSA-r5fr-rjxr-66jc",
    "GHSA-xxjr-mmjv-4gpg",
}


def main():
    audit_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("audit.json")
    if not audit_path.exists():
        print(f"::error::audit file not found at {audit_path}")
        sys.exit(1)

    data = json.loads(audit_path.read_text())

    flagged = 0
    for name, info in data.get("vulnerabilities", {}).items():
        if info.get("severity") not in ("high", "critical"):
            continue
        vias = info.get("via", [])
        # Only count vias that are high/critical AND not in allowlist.
        # Moderate vias on a high-severity package shouldn't trip the
        # gate (the high/critical via itself might be allowlisted).
        real = [
            x for x in vias
            if isinstance(x, dict)
            and x.get("severity") in ("high", "critical")
            and x.get("url", "").rsplit("/", 1)[-1] not in ALLOWLIST_ADVISORIES
        ]
        if real:
            flagged += 1
            urls = [x.get("url", "?") for x in real[:3]]
            print(f"  HIGH/CRIT: {name} (advisories: {urls})")

    print(f"real_high_or_critical={flagged}")

    if flagged > 0:
        print(f"::error::Frontend has {flagged} real high/critical npm audit findings")
        sys.exit(1)

    print("All high/critical findings are FP-allowlisted; audit passes.")
    sys.exit(0)


if __name__ == "__main__":
    main()
