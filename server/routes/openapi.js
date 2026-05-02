/**
 * OpenAPI 3.1 Specification Generator
 *
 * Auto-generates API docs covering the connective tissue endpoints,
 * lens features, and core economy routes.
 */

import { Router } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const YAML_PATH  = resolve(__dirname, "..", "openapi.yaml");

let _cachedYaml = null;
function loadYamlSpec() {
  if (_cachedYaml !== null) return _cachedYaml;
  try {
    _cachedYaml = readFileSync(YAML_PATH, "utf8");
  } catch {
    _cachedYaml = "";
  }
  return _cachedYaml;
}

export default function openapiRoutes() {
  const router = Router();

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Concord Cognitive Engine API",
      version: "1.0.0",
      description: "Complete API for the 112-lens Concord platform — economy, DTU pipeline, marketplace, CRETI scoring, compression, fork mechanism, preview system, emergent/bot access, and cross-lens search.",
      contact: { name: "Concord", url: "https://concord.dev" },
    },
    servers: [{ url: "/api", description: "Concord API" }],
    tags: [
      { name: "Economy", description: "CC tipping, transfers, bounties, merit credit" },
      { name: "DTU", description: "DTU creation, publication, listing, purchase" },
      { name: "CRETI", description: "Quality scoring system" },
      { name: "Compression", description: "DTU → Mega → Hyper compression pipeline" },
      { name: "Fork", description: "DTU forking with auto-citation" },
      { name: "Preview", description: "DTU preview system" },
      { name: "Search", description: "Cross-lens DTU search" },
      { name: "Emergent", description: "Emergent entity and bot management" },
      { name: "Lens Features", description: "112-lens feature specification system" },
      { name: "Marketplace", description: "DTU marketplace and listings" },
    ],
    paths: {
      "/ct/tip": {
        post: {
          tags: ["Economy"],
          summary: "Tip content with CC",
          requestBody: {
            content: { "application/json": { schema: { $ref: "#/components/schemas/TipRequest" } } },
          },
          responses: { 200: { description: "Tip result" } },
        },
      },
      "/ct/bounties": {
        get: {
          tags: ["Economy"],
          summary: "List open bounties",
          parameters: [
            { name: "lensId", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", default: "OPEN" } },
          ],
          responses: { 200: { description: "Bounty list" } },
        },
        post: {
          tags: ["Economy"],
          summary: "Post a new bounty (CC escrowed)",
          requestBody: {
            content: { "application/json": { schema: { $ref: "#/components/schemas/BountyRequest" } } },
          },
          responses: { 200: { description: "Bounty created" } },
        },
      },
      "/ct/bounties/{bountyId}/claim": {
        post: {
          tags: ["Economy"],
          summary: "Claim a bounty",
          parameters: [{ name: "bountyId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Bounty claimed" } },
        },
      },
      "/ct/merit/{userId}": {
        get: {
          tags: ["Economy"],
          summary: "Get merit credit score",
          parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Merit credit breakdown" } },
        },
      },
      "/ct/loan-eligibility/{userId}": {
        get: {
          tags: ["Economy"],
          summary: "Check 0% loan eligibility",
          parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Loan eligibility tier and max amount" } },
        },
      },
      "/ct/dtu/create": {
        post: {
          tags: ["DTU"],
          summary: "Create a new DTU from any lens",
          requestBody: {
            content: { "application/json": { schema: { $ref: "#/components/schemas/DTUCreateRequest" } } },
          },
          responses: { 200: { description: "DTU created with CRETI score and preview" } },
        },
      },
      "/ct/dtu/list": {
        post: {
          tags: ["DTU", "Marketplace"],
          summary: "List a DTU on the marketplace for sale",
          responses: { 200: { description: "DTU listed" } },
        },
      },
      "/ct/dtu/purchase": {
        post: {
          tags: ["DTU", "Marketplace"],
          summary: "Purchase a DTU (95% creator / 5% platform, with royalty cascade)",
          responses: { 200: { description: "Purchase complete with royalty cascade" } },
        },
      },
      "/ct/dtu/{dtuId}/creti": {
        get: {
          tags: ["CRETI"],
          summary: "Get CRETI score breakdown for a DTU",
          parameters: [{ name: "dtuId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "CRETI score with 5-dimension breakdown" } },
        },
      },
      "/ct/dtu/{dtuId}/creti/recalculate": {
        post: {
          tags: ["CRETI"],
          summary: "Recalculate CRETI score based on marketplace activity",
          parameters: [{ name: "dtuId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Updated CRETI score" } },
        },
      },
      "/ct/dtu/compress/mega": {
        post: {
          tags: ["Compression"],
          summary: "Compress multiple DTUs into a Mega DTU",
          responses: { 200: { description: "Mega DTU created" } },
        },
      },
      "/ct/dtu/compress/hyper": {
        post: {
          tags: ["Compression"],
          summary: "Compress Mega DTUs into a Hyper DTU",
          responses: { 200: { description: "Hyper DTU created" } },
        },
      },
      "/ct/dtu/fork": {
        post: {
          tags: ["Fork"],
          summary: "Fork a DTU with auto-citation to original",
          responses: { 200: { description: "Fork created with citation link" } },
        },
      },
      "/ct/dtu/{dtuId}/forks": {
        get: {
          tags: ["Fork"],
          summary: "Get fork tree for a DTU",
          parameters: [{ name: "dtuId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Fork tree" } },
        },
      },
      "/ct/dtu/{dtuId}/preview": {
        get: {
          tags: ["Preview"],
          summary: "Get preview content for a DTU",
          parameters: [{ name: "dtuId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Preview content with metadata" } },
        },
      },
      "/ct/search": {
        get: {
          tags: ["Search"],
          summary: "Search DTUs across all lenses",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "Search query" },
            { name: "lensId", in: "query", schema: { type: "string" } },
            { name: "tier", in: "query", schema: { type: "string", enum: ["REGULAR", "MEGA", "HYPER"] } },
            { name: "minCreti", in: "query", schema: { type: "integer", minimum: 0 } },
            { name: "maxPrice", in: "query", schema: { type: "number" } },
            { name: "sortBy", in: "query", schema: { type: "string", enum: ["creti_score", "price", "newest", "popular"] } },
          ],
          responses: { 200: { description: "Search results ranked by CRETI score" } },
        },
      },
      "/ct/emergent/register": {
        post: {
          tags: ["Emergent"],
          summary: "Register a new emergent entity",
          responses: { 200: { description: "Emergent entity registered with wallet" } },
        },
      },
      "/ct/bot/register": {
        post: {
          tags: ["Emergent"],
          summary: "Register a new bot",
          responses: { 200: { description: "Bot registered with API key (returned once)" } },
        },
      },
      "/ct/bot/auth": {
        post: {
          tags: ["Emergent"],
          summary: "Authenticate a bot by API key",
          responses: { 200: { description: "Bot authenticated with lens access" } },
        },
      },
      "/ct/entities": {
        get: {
          tags: ["Emergent"],
          summary: "List all active entities (emergents + bots)",
          responses: { 200: { description: "Entity list" } },
        },
      },
    },
    components: {
      schemas: {
        TipRequest: {
          type: "object",
          required: ["tipperId", "creatorId", "contentId", "amount"],
          properties: {
            tipperId: { type: "string" },
            creatorId: { type: "string" },
            contentId: { type: "string" },
            contentType: { type: "string", default: "unknown" },
            lensId: { type: "string" },
            amount: { type: "number", minimum: 0.01 },
          },
        },
        BountyRequest: {
          type: "object",
          required: ["posterId", "title", "amount"],
          properties: {
            posterId: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            lensId: { type: "string", default: "questmarket" },
            amount: { type: "number", minimum: 0.01 },
            tags: { type: "array", items: { type: "string" } },
            expiresAt: { type: "string", format: "date-time" },
          },
        },
        DTUCreateRequest: {
          type: "object",
          required: ["creatorId", "title", "content"],
          properties: {
            creatorId: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            contentType: { type: "string", default: "text" },
            lensId: { type: "string" },
            tier: { type: "string", enum: ["REGULAR", "MEGA", "HYPER", "SHADOW"] },
            tags: { type: "array", items: { type: "string" } },
            citations: { type: "array", items: { type: "object" } },
            price: { type: "number", default: 0 },
            previewPolicy: { type: "string", enum: ["first_3", "summary", "teaser", "none", "full"] },
          },
        },
      },
    },
  };

  // Wire the new platform endpoints we've added so they're discoverable in
  // the public spec. Each has a thin entry — full request/response details
  // live in the YAML spec (which is authoritative when present).
  spec.tags.push(
    { name: "Telemetry", description: "Anonymous client perf telemetry" },
    { name: "World", description: "World bazaar, weather, NPC schedule" },
    { name: "Council", description: "Council Live Theater stream" },
    { name: "Intelligence", description: "Knowledge weather, drift radar, continuity diary" },
    { name: "Repair", description: "Repair brain pre-flight validation" },
    { name: "Federation", description: "Cross-instance peering and search" },
  );

  Object.assign(spec.paths, {
    "/world/perf-telemetry": {
      get:  { tags: ["Telemetry"], summary: "Aggregated p10/p50/p90 FPS + breach rate",
              responses: { 200: { description: "Telemetry summary" } } },
      post: { tags: ["Telemetry"], summary: "Submit a 30s rolling perf sample (anonymous)",
              responses: { 200: { description: "Sample accepted" } } },
    },
    "/world/bazaar": {
      get: { tags: ["World"], summary: "Top marketplace listings as in-world stalls",
             parameters: [{ name: "worldId", in: "query", schema: { type: "string", default: "concordia" } },
                          { name: "limit",   in: "query", schema: { type: "integer", default: 24 } }],
             responses: { 200: { description: "Stall list with positions" } } },
    },
    "/marketplace/dream-promoted": {
      get: { tags: ["Marketplace"], summary: "Listings promoted by the most recent dream cycle",
             responses: { 200: { description: "Dream-promoted listings" } } },
    },
    "/quests/citation-chains": {
      get: { tags: ["Search"], summary: "Deep citation chains eligible to materialize as quests",
             responses: { 200: { description: "Chain previews" } } },
    },
    "/quests/materialize-chain": {
      post: { tags: ["Search"], summary: "Materialize a citation chain as a verify-the-lineage quest",
              responses: { 200: { description: "Quest creation result" } } },
    },
    "/council/theater": {
      get: { tags: ["Council"], summary: "Snapshot of the live council theater (current/next/history)",
             responses: { 200: { description: "Theater state" } } },
    },
    "/intelligence/knowledge-weather": {
      get: { tags: ["Intelligence"], summary: "24h warm/cold fronts by knowledge domain",
             responses: { 200: { description: "Domain weather" } } },
    },
    "/intelligence/drift-radar": {
      get: { tags: ["Intelligence"], summary: "Domain pairs with shared citations but divergent vocabulary",
             responses: { 200: { description: "Drift candidates" } } },
    },
    "/intelligence/continuity-diary": {
      get: { tags: ["Intelligence"], summary: "Rolling journal of major system events",
             parameters: [{ name: "kind",  in: "query", schema: { type: "string" } },
                          { name: "limit", in: "query", schema: { type: "integer", default: 30 } }],
             responses: { 200: { description: "Diary entries" } } },
    },
    "/federation/instances": {
      get: { tags: ["Federation"], summary: "Known peer Concord instances",
             responses: { 200: { description: "Peer list" } } },
    },
    "/federation/search": {
      get: { tags: ["Federation"], summary: "Cross-instance DTU semantic search",
             parameters: [{ name: "q",     in: "query", required: true, schema: { type: "string" } },
                          { name: "limit", in: "query", schema: { type: "integer", default: 20 } }],
             responses: { 200: { description: "Federated search results" } } },
    },
  });

  router.get("/openapi.json", (_req, res) => {
    res.json(spec);
  });

  router.get("/openapi.yaml", (_req, res) => {
    const yaml = loadYamlSpec();
    if (!yaml) return res.status(404).type("text/plain").send("openapi.yaml not found");
    res.type("text/yaml; charset=utf-8").send(yaml);
  });

  router.get("/docs", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html><head><title>Concord API Docs</title>
<meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
<style>
  body{margin:0;background:#0b0f17;color:#e2e8f0;font-family:system-ui,sans-serif}
  .topbar{background:#0b0f17;border-bottom:1px solid #1f2937;padding:12px 24px}
  .topbar a{color:#fbbf24;margin-right:16px;text-decoration:none}
  .topbar a:hover{text-decoration:underline}
</style>
</head><body>
<div class="topbar">
  <strong style="color:#fbbf24">Concord API</strong>
  <a href="/api/openapi.json">openapi.json</a>
  <a href="/api/openapi.yaml">openapi.yaml</a>
  <a href="https://github.com/ryttps94jq-gif/concord-cognitive-engine">GitHub</a>
</div>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: "/api/openapi.json", dom_id: "#swagger-ui", deepLinking: true });</script>
</body></html>`);
  });

  return router;
}
