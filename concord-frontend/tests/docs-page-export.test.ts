/**
 * FIX-docs-013: per-page export. The payload must carry the full page
 * document (title + blocks), and the filename derives from the title.
 */
import { describe, it, expect } from "vitest";
import { pageExportPayload, pageExportFilename } from "@/components/docs/exportPages";

const page = {
  id: "pg_1", title: "Launch Notes!", icon: "📄", parentId: null,
  blocks: [{ id: "b1", type: "text", text: "Ship it", checked: false }],
  createdAt: "2026-11-12T00:00:00Z", updatedAt: "2026-11-12T01:00:00Z",
} as never;

describe("per-page export", () => {
  it("payload carries the full page document", () => {
    const payload = pageExportPayload(page);
    expect(payload.kind).toBe("concord-docs-page");
    expect((payload.page as { title: string }).title).toBe("Launch Notes!");
    expect((payload.page as { blocks: unknown[] }).blocks).toHaveLength(1);
  });
  it("filename slugs the title", () => {
    expect(pageExportFilename(page)).toBe("launch-notes.page.json");
    expect(pageExportFilename({ ...page, title: "" } as never)).toBe("untitled.page.json");
  });
});
