// @vitest-environment jsdom
/**
 * FIX-global-006: the scatter explorer is described as 'animated over
 * time' but had only a manual year slider. Pins: a Play control
 * advances the year frame on a timer and Pause stops it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const scatterResult = {
  indicatorX: "NY.GDP.PCAP.CD", indicatorY: "SP.DYN.LE00.IN",
  indicatorXName: "GDP per capita", indicatorYName: "Life expectancy",
  years: [2000, 2001, 2002],
  frames: [2000, 2001, 2002].map((year) => ({
    year, points: [{ code: "USA", name: "United States", x: 1, y: 2, size: 3 }],
  })),
  source: "World Bank",
};
vi.mock("@/lib/api/client", () => ({
  lensRun: vi.fn(async (_d: string, action: string) => {
    if (action === "scatterExplorer") return { data: { ok: true, result: scatterResult } };
    if (action === "choropleth") return { data: { ok: true, result: { countries: [], indicatorName: "GDP", source: "WB", year: 2020 } } };
    return { data: { ok: true, result: { views: [] } } };
  }),
}));
vi.mock("@/components/viz", () => ({ ChartKit: () => <div data-testid="chart" /> }));
vi.mock("@/components/common/StickyDeleteConfirm", () => ({ StickyDeleteConfirm: () => null }));
vi.mock("@/components/global/IndicatorPicker", () => ({ IndicatorPicker: () => null }));
vi.mock("@/components/global/CountryPicker", () => ({ CountryPicker: () => null }));
vi.mock("@/components/global/ChoroplethMap", () => ({ ChoroplethMap: () => null }));

import { DataExplorer } from "@/components/global/DataExplorer";

describe("scatter play animation", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("Play advances the year frame; Pause stops it", async () => {
    const qc = new QueryClient();
    const { container } = render(<QueryClientProvider client={qc}><DataExplorer /></QueryClientProvider>);
    const currentYear = () => container.querySelector(".text-neon-purple")?.textContent;
    fireEvent.click(screen.getByText("Scatter"));
    const runBtn = await vi.waitFor(() => screen.getAllByText("Run query").at(-1)!);
    fireEvent.click(runBtn);
    await vi.waitFor(() => expect(screen.getByTestId("scatter-play-toggle")).toBeTruthy());
    // Load lands on the last frame (2002).
    expect(currentYear()).toBe("2002");
    fireEvent.click(screen.getByTestId("scatter-play-toggle"));
    // Play restarts from the first frame, then advances.
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(currentYear()).toBe("2001");
    fireEvent.click(screen.getByTestId("scatter-play-toggle"));
    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(currentYear()).toBe("2001");
  });
});
