// @vitest-environment jsdom
/**
 * FIX-paper-012: a successful .dtu export downloaded silently — every
 * failure path toasted, success said nothing in-app. Pins: success
 * raises a confirmation toast naming the downloaded file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const addToast = vi.fn();
vi.mock("@/store/ui", () => ({
  useUIStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
vi.mock("@/lib/api/client", () => ({
  api: {
    post: vi.fn(async () => ({ data: new Blob(["dtu-bytes"], { type: "application/octet-stream" }) })),
    get: vi.fn(async () => ({ data: { artifacts: [] } })),
  },
}));

import { DTUExportButton } from "@/components/lens/DTUExportButton";

describe("DTU export success feedback", () => {
  beforeEach(() => {
    addToast.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });
  it("toasts a success confirmation naming the file", async () => {
    render(<DTUExportButton domain="paper" data={{ rows: [1] }} compact />);
    fireEvent.click(screen.getByRole("button", { name: /Export paper data as .dtu/ }));
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    const call = addToast.mock.calls.find((c) => c[0].type === "success");
    expect(call).toBeTruthy();
    expect(call[0].message).toMatch(/Exported paper-\d+\.dtu/);
  });
});
