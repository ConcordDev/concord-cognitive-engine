// server/tests/conkay-boundary-audit.test.js
//
// SXC-25 — boundary audit CI pin (Q10).
// Rule: a NOT_COMPUTED reason that pleads unmodeled physics
// ("not modeled / not modelled / unmodeled / unmodelled") must
// carry a modeling-ticket id in the same string — an unmodeled
// boundary is a ticket, not a shrug. The audit behind this pin is
// docs/conkay/boundary-audit.md (census at branch head 4593ac8b9).
//
// Classes (the audit doc defines them):
//   A — a `notComputed` return whose reason pleads unmodeled
//       physics. Zero exist today; the pin keeps it zero unless a
//       ticket id rides the string.
//   B — a nested value-level `reason:` on a not-computed state
//       pleading unmodeled physics. Exactly ONE exists today
//       (show-solid's door-gap increment); it is allowlisted by
//       exact set-equality below, so the list can only shrink —
//       and shrinking it requires updating this pin AND the audit
//       doc in the same change, which is the point.
//   C — prose disclosures (assumptions, regime declarations,
//       warnings, labels). The boundary drawn honestly in text;
//       not computation refusals, no ticket required. Counted so
//       the census stays checkable.
//
// The scan is source-text over lib/conkay (289 files at census).
// Non-vacuity guards assert the scan actually saw the tree: a
// pin that scans nothing passes forever and proves nothing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(SERVER, "lib", "conkay");
const PLEA = /not modelled|not modeled|unmodeled|unmodelled/i;
const TICKET = /\b(SX-[A-Z]+-\d+|SXE-\d+|SXC-\d+)\b/;

// The class-B allowlist: file (relative to lib/conkay) + a stable
// substring of the pleading string. Disposition in the audit doc:
// a door-gap drag-increment modeling ticket is owed by the
// catalogue process; until it is seated, this one plea stands
// named here rather than silently exempted by a pattern.
const ALLOWLIST_B = [
  { file: "physics/solvers/show-solid.js", marker: "gaps are not modelled by aero.drag-buildup", item: "door-gap drag increment for aero.drag-buildup" },
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".js")) yield p;
  }
}

function census() {
  const files = [...walk(ROOT)];
  const classA = [];
  const classB = [];
  let classC = 0;
  let notComputedLines = 0;
  for (const f of files) {
    const rel = relative(ROOT, f);
    const text = readFileSync(f, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (line.includes("notComputed")) notComputedLines += 1;
      if (!PLEA.test(line)) return;
      const isA = line.includes("notComputed");
      if (isA) {
        if (!TICKET.test(line)) classA.push(`${rel}:${i + 1}`);
      } else if (/reason\s*:/.test(line) && line.includes("not computed")) {
        if (!TICKET.test(line)) classB.push({ file: rel, line: i + 1, text: line });
      } else {
        classC += 1;
      }
    });
    // Window scan: a plea within 300 chars after a notComputed
    // token (catches a reason wrapped onto the next line).
    const flat = text.replace(/\s+/g, " ");
    for (const m of flat.matchAll(/notComputed/g)) {
      const window = flat.slice(m.index, m.index + 300);
      if (PLEA.test(window) && !TICKET.test(window)) {
        const key = `${rel}:window@${m.index}`;
        if (!classA.some((a) => a.startsWith(rel))) classA.push(key);
      }
    }
  }
  return { files: files.length, notComputedLines, classA, classB, classC };
}

describe("SXC-25 — boundary audit pin (Q10)", () => {
  const c = census();

  it("the scan is not vacuous: it saw the tree, the refusals, and the disclosures", () => {
    assert.ok(c.files >= 250, `expected >= 250 conkay source files, scanned ${c.files}`);
    assert.ok(c.notComputedLines >= 500, `expected >= 500 notComputed lines, saw ${c.notComputedLines}`);
    assert.ok(c.classC >= 30, `expected >= 30 prose disclosures (class C), saw ${c.classC}`);
  });

  it("class A: no NOT_COMPUTED reason pleads unmodeled physics without a ticket id", () => {
    assert.deepEqual(c.classA, [], `unticketed not-modeled pleas in notComputed reasons: ${c.classA.join(", ")}`);
  });

  it("class B: the value-level pleas are exactly the allowlisted set — shrink-only", () => {
    const found = c.classB.map((b) => {
      const a = ALLOWLIST_B.find((x) => x.file === b.file && b.text.includes(x.marker));
      return a ? `${b.file} :: ${a.item}` : `${b.file}:${b.line} :: UNLISTED`;
    }).sort();
    const expected = ALLOWLIST_B.map((a) => `${a.file} :: ${a.item}`).sort();
    assert.deepEqual(found, expected, "a new unticketed plea appeared, or an allowlisted one vanished without the audit being updated");
  });
});
