// @vitest-environment jsdom
/**
 * FIX-sub-worlds-007: the Settings panel was handed a snapshot of the
 * world taken when it opened, so after a pause/resume (from the card
 * or from the panel itself) its Pause/Resume label stayed stale.
 * Pins: the open panel follows the live world list.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

let serverStatus: "active" | "paused" = "active";
const world = () => ({
  world_id: "w1", name: "Test World", description: "", thumbnail: "",
  privacy: "public", kind: "research_zone", capacity: 10, editors: [],
  status: serverStatus, is_owner: true, can_edit: true,
});
vi.mock("@/lib/api/client", () => ({
  lensRun: vi.fn(async (_d: string, action: string, params?: { status?: string }) => {
    if (action === "list") return { data: { ok: true, result: { worlds: [world()] } } };
    if (action === "set_status") { serverStatus = params?.status as "active" | "paused"; return { data: { ok: true, result: {} } }; }
    if (action === "my_favorites" || action === "list_favorites") return { data: { ok: true, result: { worlds: [] } } };
    return { data: { ok: true, result: {} } };
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/hooks/useWorldTravel", () => ({ useWorldTravel: () => ({ phase: "idle", targetWorldId: null, error: null, travel: async () => {} }) }));
vi.mock("@/components/world/PortalLoadScreen", () => ({ PortalLoadScreen: () => null }));
vi.mock("@/components/sub-worlds/WorldCard", () => ({
  WorldCard: ({ world: w, onManage }: { world: { name: string; status: string }; onManage?: () => void }) => (
    <div>
      <span>{w.name}:{w.status}</span>
      {onManage && <button onClick={onManage}>card-manage</button>}
    </div>
  ),
}));
vi.mock("@/components/sub-worlds/WorldEditorPanel", () => ({ WorldEditorPanel: () => null }));
vi.mock("@/components/sub-worlds/WorldAnalyticsPanel", () => ({ WorldAnalyticsPanel: () => null }));
vi.mock("@/components/common/StickyDeleteConfirm", () => ({ StickyDeleteConfirm: () => null }));

import { GalleryPanel } from "@/components/sub-worlds/GalleryPanel";

describe("settings panel status sync", () => {
  it("the open panel's Pause/Resume label follows status changes", async () => {
    render(<GalleryPanel mode="mine" />);
    fireEvent.click(await screen.findByText("Settings"));
    // World is active → the panel offers Pause.
    expect(await screen.findByText("Pause")).toBeTruthy();
    // Pause it from inside the panel: the label must flip to Resume.
    fireEvent.click(screen.getByText("Pause"));
    expect(await screen.findByText("Resume")).toBeTruthy();
    // Resume it from the card: the still-open panel must flip back.
    fireEvent.click(screen.getByText("card-manage"));
    expect(await screen.findByText("Pause")).toBeTruthy();
  });
});
