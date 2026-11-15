// @vitest-environment jsdom
/**
 * FIX-forestry-010: a saved polygon's row showed its acreage beside a
 * bare kilometre figure that was actually the PERIMETER, so it read
 * as a (wrong) km area — "0.09 ac · 0.08 km" for a stand whose area
 * is 0.00036 km². Pins: the row carries the area in ac AND km², and
 * the kilometre figure is labelled perimeter.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/api/client", () => ({
  lensRun: vi.fn(async () => ({
    data: {
      ok: true,
      result: {
        polygons: [{
          id: "poly_1", name: "North stand", standId: null,
          vertices: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }],
          acres: 0.09, perimeterM: 80, notes: "", createdAt: "2026-11-12T09:00:00.000Z",
        }],
        count: 1, totalAcres: 0.09,
      },
    },
  })),
}));
vi.mock("@/components/common/MapView", () => ({ default: () => null }));

import { StandPolygonPanel } from "@/components/forestry/StandPolygonPanel";

describe("forestry polygon area units", () => {
  it("shows area in ac and km² with the perimeter labelled", async () => {
    render(<StandPolygonPanel />);
    const row = await screen.findByText(
      (_content, el) => el?.tagName === "P" && (el.textContent || "").includes("0.09 ac"),
    );
    expect(row.textContent).toContain("0.09 ac");
    expect(row.textContent).toContain("0.00036 km²");
    expect(row.textContent).toContain("0.08 km perimeter");
  });
});
