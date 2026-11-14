// @vitest-environment jsdom
/**
 * FIX-quantum-005 (QASM half): the composer's Export QASM filled the
 * source box and stopped there — no file and no copy control, so the
 * correct QASM text could not leave the lens. Pins: with QASM in the
 * box, a Copy control writes the exact text to the clipboard and
 * confirms. (The header-CSV half is discharged at branch state by the
 * shared state leg — saved circuits are STATE.quantumLens records the
 * exporter enumerates — verified by the slice's pristine exercise.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const writeText = vi.fn(async () => {});
Object.assign(navigator, { clipboard: { writeText } });

vi.mock("@/lib/api/client", () => ({
  lensRun: vi.fn(async (_domain: string, action: string) => {
    if (action === "listCircuits") return { data: { ok: true, result: { circuits: [] } } };
    if (action === "gateLibrary") return { data: { ok: true, result: { gates: [] } } };
    if (action === "noisePresets") return { data: { ok: true, result: { presets: [] } } };
    return { data: { ok: true, result: {} } };
  }),
}));
vi.mock("@/hooks/useLensCommand", () => ({ useLensCommand: () => {} }));
vi.mock("@/hooks/useLensState", () => ({
  useLensState: () => ({ restored: null, save: () => {} }),
}));
vi.mock("@/components/viz", () => ({ ChartKit: () => null }));
vi.mock("@/components/quantum/CircuitComposer", () => ({ CircuitComposer: () => null }));
vi.mock("@/components/quantum/BlochSphere", () => ({ BlochSphere: () => null }));

import { ComposerPanel } from "@/components/quantum/ComposerPanel";

const QASM = "OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[2];\nh q[0];\ncx q[0],q[1];";

describe("quantum QASM takeout", () => {
  beforeEach(() => writeText.mockClear());

  it("copies the QASM source out of the lens with a confirmation", async () => {
    render(<ComposerPanel />);
    const box = await screen.findByLabelText("OpenQASM source");
    fireEvent.change(box, { target: { value: QASM } });
    const copyBtn = screen.getByTestId("quantum-copy-qasm");
    expect((copyBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(copyBtn);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(QASM));
    expect(await screen.findByText("Copied")).toBeTruthy();
  });
});
