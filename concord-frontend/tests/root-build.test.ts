// Source pins for the Root build. Behavioural proof lives server-side
// (root-build.test.js: token-exact keyboard, named evaluator readings,
// rename scoping, the export provider); these pins assert the FE shapes
// the slices require — dual readings, the metrics contract, the earned
// semantic, lifecycle wiring, and the preserved standing testids.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, "..", rel), "utf8");

const page = read("app/lenses/root/page.tsx");
const metrics = read("components/root/RootMetrics.tsx");
const notebook = read("components/root/ComputationNotebook.tsx");
const bitwise = read("components/root/BitwisePanel.tsx");
const evaluator = read("components/root/ExpressionEvaluator.tsx");

describe("S-ROOT-1 — ambiguity shown, never silently chosen", () => {
  it("the converter enumerates every reading of a glyph string", () => {
    assert.ok(page.includes("function glyphReadings"));
    assert.ok(page.includes("function parseGlyphsAll"));
    assert.ok(page.includes("This string reads more than one way; every reading is shown."));
  });
  it("a decimal whose written form is ambiguous is flagged with the other reading", () => {
    assert.ok(page.includes("both readings stand; Root does not choose silently"));
    assert.ok(page.includes("writtenReadings"));
  });
  it("the convert view keep-mounts so the keyboard draft survives (F9)", () => {
    assert.ok(page.includes("view === 'convert' ? '' : 'hidden'"));
  });
});

describe("S-ROOT-2 — Metrics reads the endpoint's real shape", () => {
  it("tiles bind to fields perf.metrics actually returns", () => {
    assert.ok(metrics.includes("d.memory?.heapUsed"));
    assert.ok(metrics.includes("d.dtus?.total"));
    assert.ok(metrics.includes("d.graph?.nodes"));
    assert.ok(metrics.includes("d.collab?.sessions"));
  });
  it("the unsourceable tiles are gone", () => {
    assert.ok(!metrics.includes("tickDurationMs"));
    assert.ok(!metrics.includes("activeUsers"));
    assert.ok(!metrics.includes("Ticks"));
  });
});

describe("S-ROOT-3 — the export control serves the saved work", () => {
  it("the page mounts the DTU export for the root domain", () => {
    assert.ok(page.includes('DTUExportButton domain="root"'));
  });
});

describe("S-ROOT-4 — the semantic cites the computation; errors speak", () => {
  it("the playground note is built from digit readings, not the type template", () => {
    assert.ok(page.includes("digitNames(ag)"));
    assert.ok(page.includes("digitNames(num)"));
    assert.ok(!page.includes("produces structural transformation"));
  });
  it("division by Refusal renders undefined, never an infinity result", () => {
    assert.ok(page.includes("numerical: 'undefined'"));
    assert.ok(!page.includes("'∞'"));
    assert.ok(!evaluator.includes("'∞'"));
  });
  it("invalid numeric input produces an explicit sentence (F4)", () => {
    assert.ok(page.includes("Not a number — enter a decimal like 47 or 1.5"));
    assert.ok(page.includes("Enter a number for both a and b"));
  });
  it("confirmations clear when the operation changes (F5)", () => {
    assert.ok(page.includes("setOpA(e.target.value); setOpNotice('')"));
    assert.ok(page.includes("setOpB(e.target.value); setOpNotice('')"));
  });
  it("the evaluator renders the server's ambiguity warnings", () => {
    assert.ok(evaluator.includes("result.warnings"));
  });
});

describe("S-ROOT-5 — lifecycle", () => {
  it("notebook entries render their date and rename in place", () => {
    assert.ok(notebook.includes("new Date(c.createdAt).toLocaleString()"));
    assert.ok(notebook.includes("renameComputation"));
    assert.ok(notebook.includes('aria-label="Rename computation"'));
  });
  it("deletes are two-step and name the entry (F10)", () => {
    assert.ok(notebook.includes("confirmId"));
    assert.ok(notebook.includes("Delete “{c.label}”?"));
  });
  it("the standing notebook testids survive", () => {
    for (const id of ["notebook-loading", "notebook-error", "notebook-empty", "notebook-list"]) {
      assert.ok(notebook.includes(`data-testid="${id}"`), id);
    }
  });
  it("bitwise results save through the same path and reload lands in the panel", () => {
    assert.ok(bitwise.includes("kind: 'bitwise'"));
    assert.ok(bitwise.includes("Save to notebook"));
    assert.ok(bitwise.includes("useImperativeHandle"));
    assert.ok(page.includes("bitwiseRef"));
  });
});
