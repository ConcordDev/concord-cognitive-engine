// @vitest-environment jsdom
/**
 * FIX-home-improvement-002: Permit Check showed "$$100-$500" — the
 * domain returns estimatedCost as a range string with the symbol
 * baked in ("$100-$500") and the panel prepended another "$".
 * Pins: the rendered cost carries exactly one currency symbol.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/api/client", () => ({
  lensRun: vi.fn(async (_domain: string, action: string) => {
    if (action === "permitCheck") {
      return { data: { ok: true, result: {
        projectType: "deck", requiresPermit: true, permitType: "building-permit",
        estimatedCost: "$100-$500", processingTime: "2-6 weeks",
        inspectionsRequired: ["rough inspection", "final inspection"],
        tip: "Apply for permit before starting work",
      } } };
    }
    return { data: { ok: true, result: {} } };
  }),
}));

import { CalculatorsPanel } from "@/components/home-improvement/CalculatorsPanel";

describe("permit cost formatting", () => {
  it("renders a single currency symbol", async () => {
    render(<CalculatorsPanel />);
    fireEvent.click(screen.getByText("Check permit"));
    const cost = await screen.findByText("$100-$500");
    expect(cost).toBeTruthy();
    expect(document.body.textContent).not.toContain("$$100-$500");
  });
});
