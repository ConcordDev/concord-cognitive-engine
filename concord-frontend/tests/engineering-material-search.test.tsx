// @vitest-environment jsdom
/**
 * FIX-engineering-006: the engineering lens had no in-lens search
 * (only the global lens-name palette). Pins the name search over the
 * materials library: typing narrows the cards by label, composes with
 * the category filter, and a no-match query says so.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

const mats = [
  { id: "m1", label: "Structural Steel A36", category: "metals", E: 200e9, yield: 250, ultimate: 400, density: 7850, poisson: 0.3, cte: 12, thermalK: 50 },
  { id: "m2", label: "Aluminium 6061-T6", category: "metals", E: 69e9, yield: 276, ultimate: 310, density: 2700, poisson: 0.33, cte: 23, thermalK: 167 },
];
vi.mock("@/components/engineering/EngineeringFeaProvider", () => ({
  useEngineeringFea: () => ({
    libMaterials: mats, matCategories: ["metals"], matFilter: "all",
    setMatFilter: () => {}, matLoading: false, matError: "", loadMaterials: () => {},
  }),
}));

import { MaterialsPanel } from "@/components/engineering/MaterialsPanel";

describe("materials name search", () => {
  it("narrows by name and reports no-match honestly", () => {
    render(<MaterialsPanel />);
    expect(screen.getByText("Structural Steel A36")).toBeTruthy();
    expect(screen.getByText("Aluminium 6061-T6")).toBeTruthy();
    fireEvent.change(screen.getByTestId("engineering-material-search"), { target: { value: "alum" } });
    expect(screen.queryByText("Structural Steel A36")).toBeNull();
    expect(screen.getByText("Aluminium 6061-T6")).toBeTruthy();
    fireEvent.change(screen.getByTestId("engineering-material-search"), { target: { value: "zzz" } });
    expect(screen.getByText(/No materials match/)).toBeTruthy();
  });
});
