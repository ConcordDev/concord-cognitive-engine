#!/usr/bin/env python3
"""Selftest: GB-1577 fabricated_data tuning — comment-stripped matching
+ the id/colour Math.random veto. Run: python3 selftest/test_fakedata_tuning.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from concord_walker import dossier

FAILS = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


class StubTree:
    def __init__(self, files):
        self.files = files

    def read(self, rel):
        return self.files.get(rel)

    def ls(self, rel):
        return sorted(p for p in self.files if p.startswith(rel + "/"))


def kinds_for(domain_js=None, component_tsx=None):
    files = {}
    if domain_js is not None:
        files["server/domains/notes.js"] = domain_js
    if component_tsx is not None:
        files["concord-frontend/components/notes/Panel.tsx"] = component_tsx
    scan = dossier._code_scan(StubTree(files), "notes", ["notes"], [])
    return [f["kind"] for f in scan["flags"]]


# --- MUST flag -------------------------------------------------------------
check("fake data variable flags",
      "fabricated_data" in kinds_for("const fakeData = [{ id: 1 }];"))
check("synthetic data string flags",
      "fabricated_data" in kinds_for('const label = "synthetic data";'))
check("fabricate* call flags",
      "fabricated_data" in kinds_for("const s = fabricateTimestamp();"))
check("Math.random fabricating a content number flags",
      "fabricated_data" in kinds_for(
          "const views = Math.floor(Math.random() * 1000);"))
check("mock-data in a component flags",
      "fabricated_data" in kinds_for(
          None, "export const seedRows = mockData;"))
check("textual signal flags despite an id field on the line",
      "fabricated_data" in kinds_for("const fakeData = [{ id: 1 }];"))

# --- MUST NOT flag -----------------------------------------------------------
check("id generator (toString 36) does not flag",
      "fabricated_data" not in kinds_for(
          "const id = Math.random().toString(36).slice(2);"))
check("camelCase Id maker does not flag",
      "fabricated_data" not in kinds_for(
          "const noteId = 'n-' + Math.random().toString(36).substring(2, 9);"))
check("sticky colour pick does not flag",
      "fabricated_data" not in kinds_for(
          "const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];"))
check("random hue does not flag",
      "fabricated_data" not in kinds_for(
          "const hue = Math.floor(Math.random() * 360);"))
check("line comment describing a past fix does not flag",
      "fabricated_data" not in kinds_for(
          "// previously fabricated data was served here; fixed\n"
          "const rows = loadRealRows();"))
check("block comment does not flag",
      "fabricated_data" not in kinds_for(
          "/* mock data removed in the rework\n   still a comment */\n"
          "const rows = loadRealRows();"))
check("trailing comment does not flag",
      "fabricated_data" not in kinds_for(
          "const real = loadReal(); // used to return mock data"))

# --- the stripper itself -----------------------------------------------------
out = dossier._strip_comments(['const u = "https://example.com/x"; // fetch it'])
check("stripper keeps // inside a string",
      out[0].startswith('const u = "https://example.com/x";'))
out = dossier._strip_comments(["const a = 1; /* start", "middle", "end */ const b = 2;"])
check("stripper carries block state across lines",
      out[1].strip() == "" and "const b = 2;" in out[2])

print("FAILURES:", len(FAILS))
sys.exit(1 if FAILS else 0)
