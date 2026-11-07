// server/lib/graph-nodes.js
//
// A4 Leg C: the graph's non-DTU registration surface.
//
// The fabric (semantic search + the graph views) is built over canonical
// DTUs. Saved work that lives in a lens's own store — Commonsense's
// checks in their table, any lens's per-domain state — is in neither,
// and until now no registration surface existed for it (the export
// registry had no graph analogue; Commonsense S-CS-4's connections leg
// was priced at the platform layer for exactly this reason).
//
// The shape deliberately mirrors lib/lens-export.js's providers:
//   registerGraphNodeProvider(domain, (ctx) => nodes)
// A provider receives the caller's ctx and MUST scope nodes to that
// caller. Nodes are fabric-shaped: { id, title, domain, summary, tags }.
// Composition (collectGraphNodes) isolates providers from each other: a
// failing provider is reported in `errors`, never thrown, and never
// takes the other providers' nodes down with it.

const providers = new Map(); // domain -> (ctx) => nodes[] | Promise<nodes[]>

export function registerGraphNodeProvider(domain, provider) {
  if (!domain || typeof provider !== "function") return false;
  providers.set(domain, provider);
  return true;
}

export function hasGraphNodeProvider(domain) {
  return providers.has(domain);
}

export function _clearGraphNodeProvidersForTests() {
  providers.clear();
}

function normalizeNode(node, domain) {
  if (!node || typeof node !== "object" || !node.id) return null;
  const title = typeof node.title === "string" ? node.title.trim() : "";
  if (!title) return null;
  return {
    id: String(node.id),
    title,
    domain: typeof node.domain === "string" && node.domain ? node.domain : domain,
    summary: typeof node.summary === "string" ? node.summary : "",
    tags: Array.isArray(node.tags) ? node.tags.filter((t) => typeof t === "string") : [],
    registered: true,
  };
}

/**
 * Compose the registered nodes for one domain (the panel's home lens)
 * plus, when `all` is set, every registered domain's nodes for this
 * caller. Providers are caller-scoped by contract.
 */
export async function collectGraphNodes({ domain, ctx, all = false } = {}) {
  const domains = all ? [...providers.keys()] : (domain ? [domain] : []);
  const nodes = [];
  const errors = {};
  const seen = new Set();
  for (const d of domains) {
    const provider = providers.get(d);
    if (!provider) continue;
    try {
      const raw = await provider(ctx);
      for (const n of Array.isArray(raw) ? raw : []) {
        const node = normalizeNode(n, d);
        if (node && !seen.has(node.id)) { seen.add(node.id); nodes.push(node); }
      }
    } catch (err) {
      errors[d] = err?.message || "graph_node_provider_failed";
    }
  }
  return { ok: true, nodes, errors };
}
