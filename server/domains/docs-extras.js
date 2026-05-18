// server/domains/docs-extras.js
//
// Docs Sprint C — workspace semantic search + embed validation +
// embed SVG rendering for math/mermaid placeholders.

import { semanticSearch } from "../lib/docs/semantic.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

const EMBED_KINDS = new Set(["math","mermaid","audio","video","iframe"]);
const SAFE_IFRAME_HOSTS = new Set([
  "youtube.com","www.youtube.com","youtu.be","youtube-nocookie.com","www.youtube-nocookie.com",
  "vimeo.com","player.vimeo.com",
  "loom.com","www.loom.com",
  "codepen.io",
  "codesandbox.io",
  "open.spotify.com",
  "soundcloud.com","w.soundcloud.com",
  "miro.com",
  "figma.com","www.figma.com",
  "github.com","gist.github.com",
]);

function _hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

export default function registerDocsExtrasMacros(register) {

  // ─── Semantic workspace search ──────────────────────────────────
  register("docs", "semantic_search", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const query = String(input.query || "").trim();
    if (query.length < 2) return { ok: true, results: [] };
    const results = semanticSearch(db, {
      ownerId: userId, query,
      limit: Math.min(Number(input.limit) || 10, 50),
    });
    return { ok: true, results, count: results.length };
  }, { note: "Semantic workspace search (bigram + TF-IDF; no embeddings yet)" });

  // ─── Embed validation ───────────────────────────────────────────
  // Lightweight whitelist check so the frontend renderer doesn't have
  // to ship a security policy; only validated embeds are reflected
  // back into rendered HTML.
  register("docs", "embed_validate", async (_ctx, input = {}) => {
    const kind = String(input.kind || "").toLowerCase();
    const content = String(input.content || "");
    if (!EMBED_KINDS.has(kind)) return { ok: false, reason: "unknown_kind" };
    if (!content) return { ok: false, reason: "content_required" };
    if (content.length > 100_000) return { ok: false, reason: "content_too_large" };

    if (kind === "iframe") {
      const url = content.trim();
      const host = _hostOf(url);
      if (!host) return { ok: false, reason: "invalid_url" };
      const ok = SAFE_IFRAME_HOSTS.has(host) || [...SAFE_IFRAME_HOSTS].some((h) => host === h || host.endsWith("." + h));
      if (!ok) return { ok: false, reason: "host_not_allowlisted", host };
      return { ok: true, kind, url, host };
    }

    if (kind === "audio" || kind === "video") {
      const url = content.trim();
      if (!/^https?:\/\//.test(url) && !url.startsWith("/api/")) return { ok: false, reason: "invalid_url" };
      return { ok: true, kind, url };
    }

    if (kind === "math") {
      // Reject obvious script injection; allow standard LaTeX / KaTeX syntax.
      if (/<script|on\w+=/i.test(content)) return { ok: false, reason: "unsafe_content" };
      return { ok: true, kind, source: content };
    }

    if (kind === "mermaid") {
      if (/<script|on\w+=/i.test(content)) return { ok: false, reason: "unsafe_content" };
      // First non-empty line should be a known diagram type.
      const first = content.split("\n").map((l) => l.trim()).find(Boolean) || "";
      const types = ["graph","flowchart","sequenceDiagram","classDiagram","stateDiagram","erDiagram","gantt","pie","journey","gitGraph","mindmap","timeline"];
      const isKnown = types.some((t) => first.startsWith(t));
      if (!isKnown) return { ok: false, reason: "unknown_diagram_type", first };
      return { ok: true, kind, source: content, diagramType: first.split(/\s+/)[0] };
    }

    return { ok: false, reason: "unhandled_kind" };
  }, { note: "Validate an embed (math/mermaid/audio/video/iframe) against the safe host list + content rules" });

  register("docs", "embed_render_svg", async (_ctx, input = {}) => {
    // Deterministic placeholder SVG seeded by content. Real KaTeX /
    // Mermaid rendering happens in the browser; this is for the
    // public published page where no JS runs against untrusted body.
    const kind = String(input.kind || "").toLowerCase();
    const content = String(input.content || "");
    if (!EMBED_KINDS.has(kind)) return { ok: false, reason: "unknown_kind" };
    if (kind !== "math" && kind !== "mermaid") return { ok: false, reason: "kind_not_svg_renderable" };
    const lines = content.split("\n").slice(0, 24);
    const label = kind === "math" ? "math" : "diagram";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 ${Math.max(120, lines.length * 22 + 50)}">
  <rect width="720" height="100%" fill="#0f172a" stroke="#1e293b" rx="6"/>
  <text x="12" y="22" font-family="ui-monospace,monospace" font-size="11" fill="#64748b">${label}</text>
  ${lines.map((l, i) => `<text x="12" y="${44 + i * 18}" font-family="ui-monospace,monospace" font-size="13" fill="#cbd5e1">${(l || "").replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[m]).slice(0, 96)}</text>`).join("\n  ")}
</svg>`;
    const dataUri = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    return { ok: true, kind, url: dataUri, svg };
  }, { note: "Server-side placeholder SVG for math/mermaid embeds (used by public published pages)" });
}
