import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(async () => ({ data: { ok: true } })),
  delete: vi.fn(async () => ({ data: { ok: true } })),
}));
vi.mock("@/lib/api/client", () => ({ api: apiMock }));
vi.mock("@/lib/realtime/socket", () => ({ getSocket: () => null, subscribe: () => () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { NotificationBell } from "@/components/social/NotificationBell";
import { NotificationCenter } from "@/components/social/NotificationCenter";
import { SavedDtuIndicator } from "@/components/lens/SavedDtuIndicator";
import { ContentPublisher } from "@/components/lens/ContentPublisher";

function wrap(qc: QueryClient, node: ReactNode) {
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}
function newQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const PLATFORM_ITEM = {
  id: "notif_1",
  type: "action_notification",
  title: "PR alert fired",
  payload: {},
  createdAt: "2026-11-06T10:00:00.000Z",
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockClear();
  apiMock.delete.mockClear();
  apiMock.get.mockImplementation(async (url: string) => {
    if (url === "/api/social/notifications/count") return { data: { count: 0 } };
    if (url === "/api/social/notifications") return { data: { notifications: [] } };
    if (url === "/api/notifications/count") return { data: { ok: true, count: 1, unread: 1 } };
    if (url === "/api/notifications") return { data: { ok: true, notifications: [PLATFORM_ITEM] } };
    if (url.startsWith("/api/lens/")) return { data: { ok: true, artifact: { id: "a1", dtuId: "dtu_saved_1" } } };
    return { data: {} };
  });
});

describe("Chrome II Leg 1 — the bell panel mounts (THE BELL PANEL CHECK, cold leg)", () => {
  it("with the identity the fixed shell mounts pass, clicking the bell renders the panel + its empty state", async () => {
    apiMock.get.mockImplementation(async (url: string) => {
      if (url === "/api/notifications") return { data: { ok: true, notifications: [] } };
      if (url === "/api/notifications/count") return { data: { ok: true, count: 0, unread: 0 } };
      if (url.includes("/api/social/notifications")) return { data: { notifications: [], count: 0 } };
      return { data: {} };
    });
    render(wrap(newQc(), <NotificationBell userId="user_a" />));
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(await screen.findByText("No notifications")).toBeTruthy();
  });

  it("without a userId the panel cannot mount — the starved-prop shape the fix removes", async () => {
    render(wrap(newQc(), <NotificationBell userId={undefined} />));
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.queryByText("No notifications")).toBeNull();
  });
});

describe("Chrome II Leg 2 — F16: the panel lists the platform store beside the social store", () => {
  it("a platform-queue item renders in the panel, and marking it read posts to the platform route", async () => {
    render(
      wrap(
        newQc(),
        <NotificationCenter
          userId="user_a"
          isOpen
          onClose={() => {}}
          onNavigateToUser={() => {}}
          onNavigateToContent={() => {}}
          mode="dropdown"
        />
      )
    );
    const items = await screen.findAllByText("PR alert fired");
    expect(items.length).toBeGreaterThan(0);
    const row = items[0].closest('[class*="cursor-pointer"]') || items[0];
    fireEvent.click(row);
    await vi.waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith("/api/notifications/notif_1/read", {});
    });
  });

  it("the badge counts the platform store's unread beside the social count", async () => {
    render(wrap(newQc(), <NotificationBell userId="user_a" />));
    expect(await screen.findByText("1")).toBeTruthy();
  });
});

describe("Chrome II Leg 3 — F17 chrome half: the indicator reads the record, not the view", () => {
  it("shows Saved as DTU from the server read, and still shows it after a remount (navigation)", async () => {
    const qc = newQc();
    const first = render(wrap(qc, <SavedDtuIndicator domain="projects" artifactId="a1" />));
    expect(await screen.findByText("Saved as DTU")).toBeTruthy();
    first.unmount();
    render(wrap(qc, <SavedDtuIndicator domain="projects" artifactId="a1" />));
    expect(await screen.findByText("Saved as DTU")).toBeTruthy();
  });

  it("an artifact with no DTU link shows no saved claim", async () => {
    apiMock.get.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/lens/")) return { data: { ok: true, artifact: { id: "a2" } } };
      return { data: {} };
    });
    render(wrap(newQc(), <SavedDtuIndicator domain="projects" artifactId="a2" />));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Saved as DTU")).toBeNull();
  });
});

describe("Chrome II Leg 4 — S-PA-3: the minor-data share shape", () => {
  it("parenting: followers-only by default, with the preview + privacy statement", async () => {
    render(wrap(newQc(), <ContentPublisher domain="parenting" title="Milo — week 12" />));
    fireEvent.click(screen.getByTitle("Publish or share this content"));
    expect(await screen.findByText(/holds a child's developmental record/)).toBeTruthy();
    expect(screen.getByText(/Followers only by default/)).toBeTruthy();
    expect(screen.getByText("Followers only")).toBeTruthy();
    expect(screen.getByText(/milestone · schedule · health_record · activity/)).toBeTruthy();
  });

  it("an undeclared lens keeps the generic shape: public default, no privacy block", async () => {
    render(wrap(newQc(), <ContentPublisher domain="music" title="Track" />));
    fireEvent.click(screen.getByTitle("Publish or share this content"));
    expect(await screen.findByText("Public")).toBeTruthy();
    expect(screen.queryByText(/developmental record/)).toBeNull();
  });
});
