/**
 * Source-pin suite for the Artistry Draw dialog dismissal contract
 * (F5 fix return). Filed behaviour (R4 re-pass): opening the colour
 * well and clicking the native picker's R field or hue slider closed
 * the picker AND the dialog and discarded the unsaved drawing —
 * deterministically — so no second colour could be authored. Cause:
 * the dialog's full-viewport backdrop dismissed on click, and the
 * native <input type="color"> picker is browser chrome rendered
 * OUTSIDE the React tree, where the panel's stopPropagation cannot
 * protect it; picker gestures were delivered to the backdrop. The
 * dialog's content is entirely unsaved work (canvases in refs), so
 * the backdrop no longer dismisses; the explicit closers remain.
 *
 * Each pin is verified against the shipped source below.
 */
import { describe, it } from 'vitest';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const canvas = readFileSync(join(here, "..", "components", "artistry", "StudyCanvas.tsx"), "utf8");

describe("artistry Draw dialog — unsaved work never dies to a backdrop click", () => {
  it("the backdrop is inert: the fixed overlay carries no onClick dismissal", () => {
    assert.ok(canvas.includes('<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="presentation">'));
    const backdropLine = canvas.split("\n").find((l) => l.includes("fixed inset-0 z-[60]"));
    assert.ok(backdropLine && !backdropLine.includes("onClick"), "backdrop must not dismiss");
  });

  it("the explicit closers remain: X button, Cancel, and Escape", () => {
    assert.ok(canvas.includes('<button type="button" onClick={onClose} aria-label="Close drawing tool">'));
    assert.ok(canvas.includes('<button type="button" onClick={onClose} className="rounded border border-white/10 px-3 py-1.5 text-xs hover:bg-white/10">Cancel</button>'));
    assert.ok(canvas.includes("onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}"));
  });

  it("the panel still stops propagation for its own clicks (unchanged)", () => {
    assert.ok(canvas.includes("onClick={(e) => e.stopPropagation()}"));
  });

  it("the colour path itself is untouched: the native colour input still authors colour", () => {
    assert.ok(canvas.includes('data-testid="study-canvas-color"'));
    assert.ok(canvas.includes('type="color"'));
    assert.ok(canvas.includes("onChange={(e) => setColor(e.target.value)}"));
  });

  it("the drawing still lives in the component and saves through the same upload macro", () => {
    assert.ok(canvas.includes("'project-image-upload'"));
    assert.ok(canvas.includes("onSaved(ref, fileName)"));
  });
});
