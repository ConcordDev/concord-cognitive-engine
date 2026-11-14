// @vitest-environment jsdom
/**
 * FIX-forge-002: the 'Connection lost' banner is a fixed full-width
 * strip at the top of the viewport; it overlaid lens header toolbars
 * (Forge's Export / Publish / Lens tools) and intercepted their
 * clicks. The banner has no interactive children — it must be
 * click-transparent while staying visible.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

let lostCb: (() => void) | null = null;
vi.mock("@/hooks/useClientConfig", () => ({
  useClientConfig: () => ({ poll: { connectionStatusMs: 60000 } }),
}));
vi.mock("@/lib/realtime/socket", () => ({
  onConnectionLost: (cb: () => void) => { lostCb = cb; return () => { lostCb = null; }; },
  onReconnected: () => () => {},
}));
vi.mock("@/lib/realtime/server-busy", () => ({
  getServerBusy: () => null,
  onServerBusy: () => () => {},
  clearServerBusy: () => {},
  noteServerBusy: () => {},
  isServiceOverloadedPayload: () => false,
}));
vi.mock("@/hooks/useSmartPolling", () => ({ useSmartPolling: () => {} }));

import { ConnectionStatus } from "@/components/common/ConnectionStatus";

describe("connection banner click-through", () => {
  it("banner is visible but pointer-events-none when the connection drops", async () => {
    render(<ConnectionStatus />);
    expect(screen.queryByText(/Connection lost/)).toBeNull();
    await act(async () => { lostCb?.(); });
    const banner = screen.getByText(/Connection lost/);
    expect(banner.className).toContain("pointer-events-none");
  });
});
