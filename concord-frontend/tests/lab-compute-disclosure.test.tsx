// @vitest-environment jsdom
/**
 * FIX-lab-004: Run Experiment carried no compute/cost disclosure.
 * The sandbox's Run only records the experiment — the label must say
 * so next to the button (no execution, no GPU, no cost).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useLensNav", () => ({ useLensNav: () => {} }));
vi.mock("@/hooks/useLensCommand", () => ({ useLensCommand: () => {} }));
vi.mock("@/hooks/useRealtimeLens", () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock("@/lib/hooks/use-lens-data", () => ({
  useLensData: () => ({ items: [], isLoading: false, isError: false, error: null, refetch: () => {}, create: async () => ({}) }),
}));
vi.mock("@/lib/hooks/use-lens-artifacts", () => ({ useRunArtifact: () => ({ mutateAsync: async () => ({ ok: true, result: {} }) }) }));
vi.mock("@/components/lens/LensShell", () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/lens/CrossLensRecentsPanel", () => ({ CrossLensRecentsPanel: () => null }));
vi.mock("@/components/lens/DepthBadge", () => ({ DepthBadge: () => null }));
vi.mock("@/components/lens/LiveIndicator", () => ({ LiveIndicator: () => null }));
vi.mock("@/components/lens/DTUExportButton", () => ({ DTUExportButton: () => null }));
vi.mock("@/components/lens/RealtimeDataPanel", () => ({ RealtimeDataPanel: () => null }));
vi.mock("@/components/lab/ArxivLabFeed", () => ({ ArxivLabFeed: () => null }));
vi.mock("@/components/lab/ELNWorkbench", () => ({ ELNWorkbench: () => null }));
vi.mock("@/components/lab/LabOrgPanel", () => ({ LabOrgPanel: () => null }));
vi.mock("@/lib/api/client", () => ({ apiHelpers: {} }));
vi.mock("@/store/ui", () => ({ useUIStore: (sel: (s: Record<string, unknown>) => unknown) => sel({}) }));
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => { const { children, ...rest } = props as { children?: React.ReactNode }; return <div {...rest}>{children}</div>; } }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LabLensPage from "@/app/lenses/lab/page";

describe("lab compute disclosure", () => {
  it("the Run Experiment button carries the compute label", () => {
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><LabLensPage /></QueryClientProvider>);
    expect(screen.getByText("Run Experiment")).toBeTruthy();
    const label = screen.getByTestId("lab-compute-disclosure");
    expect(label.textContent).toMatch(/not executed/i);
    expect(label.textContent).toMatch(/no GPU/i);
    expect(label.textContent).toMatch(/no cost/i);
  });
});
