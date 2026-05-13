// @resource-leak-ok: addEventListener calls live inside the served HTML template string, not real server code
// @http-error-ok: fetch() calls in this file run in the browser (served HTML), not on the server
/**
 * API Documentation Routes — v1.0
 *
 * Serves interactive API documentation and auto-generated OpenAPI specs.
 * Mounted at /api/docs.
 *
 * - GET /api/docs           — Interactive API explorer HTML page
 * - GET /api/docs/openapi.json — Auto-generated OpenAPI 3.1 spec from lens actions
 */

import express from "express";

/**
 * Create the API docs router.
 *
 * @param {object} deps
 * @param {Map<string, Function>} deps.LENS_ACTIONS - The global lens action registry (domain.action -> handler)
 * @param {string[]} deps.ALL_LENS_DOMAINS - Array of all registered lens domain names
 * @param {string} [deps.serverVersion="5.1.0"] - Server version for the spec
 * @returns {import('express').Router}
 */
export default function createAPIDocsRouter({
  LENS_ACTIONS,
  ALL_LENS_DOMAINS,
  serverVersion = "5.1.0",
} = {}) {
  const router = express.Router();

  // ── GET /api/docs/openapi.json — Auto-generated OpenAPI spec ─────────
  router.get("/openapi.json", (_req, res) => {
    const spec = buildOpenAPISpec({
      LENS_ACTIONS: LENS_ACTIONS || new Map(),
      ALL_LENS_DOMAINS: ALL_LENS_DOMAINS || [],
      serverVersion,
    });
    res.json(spec);
  });

  // ── GET /api/docs — Interactive API explorer HTML page ───────────────
  router.get("/", (_req, res) => {
    const html = buildExplorerHTML();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  return router;
}

// ────────────────────────────────────────────────────────────────────────────
// OpenAPI Spec Builder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a complete OpenAPI 3.1 spec from the lens action registry.
 *
 * Each registered lens action (domain.action) becomes a POST endpoint:
 *   POST /api/lens/{domain}/{action}
 *
 * Core REST endpoints (DTUs, auth, chat, keys, billing) are also included.
 */
function buildOpenAPISpec({ LENS_ACTIONS, ALL_LENS_DOMAINS, serverVersion }) {
  const paths = {};
  const domainTags = new Set();

  // ── Core API endpoints ─────────────────────────────────────────────────
  addCorePaths(paths);

  // ── Lens action endpoints ──────────────────────────────────────────────
  // Group actions by domain
  const domainActions = new Map();
  for (const key of LENS_ACTIONS.keys()) {
    const dotIndex = key.indexOf(".");
    if (dotIndex === -1) continue;
    const domain = key.slice(0, dotIndex);
    const action = key.slice(dotIndex + 1);
    if (!domainActions.has(domain)) {
      domainActions.set(domain, []);
    }
    domainActions.get(domain).push(action);
    domainTags.add(domain);
  }

  // Create a POST endpoint for each domain.action
  for (const [domain, actions] of domainActions) {
    for (const action of actions) {
      const pathKey = `/api/lens/${domain}/${action}`;
      paths[pathKey] = {
        post: {
          tags: [`Lens: ${domain}`],
          summary: `${domain}.${action}`,
          description: `Execute the "${action}" action on the "${domain}" lens domain.`,
          operationId: `lens_${domain}_${action}`,
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    artifact: {
                      type: "object",
                      description: "The artifact/DTU to process",
                      properties: {
                        title: { type: "string" },
                        data: { type: "object" },
                        meta: { type: "object" },
                        domain: { type: "string", example: domain },
                      },
                    },
                    params: {
                      type: "object",
                      description: "Action-specific parameters",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Action result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      output: { type: "string" },
                      source: { type: "string" },
                      action: { type: "string" },
                      domain: { type: "string" },
                    },
                  },
                },
              },
            },
            401: { description: "Unauthorized — invalid or missing API key/token" },
            403: { description: "Forbidden — key scopes do not allow this domain" },
          },
        },
      };
    }
  }

  // ── Build tags list ────────────────────────────────────────────────────
  const tags = [
    { name: "Auth", description: "Authentication and authorization" },
    { name: "API Keys", description: "API key management (csk_... keys)" },
    { name: "DTUs", description: "Discrete Thought Unit CRUD" },
    { name: "Chat", description: "Conversational interface" },
    { name: "Social", description: "Social interactions: posts, follows, likes, votes" },
    { name: "Governance", description: "Community governance proposals and voting" },
    { name: "Marketplace", description: "DTU marketplace: publish, browse, and purchase listings" },
    { name: "Billing", description: "API billing and metering" },
    { name: "Docs", description: "API documentation" },
  ];

  for (const domain of [...domainTags].sort()) {
    tags.push({
      name: `Lens: ${domain}`,
      description: `Actions for the "${domain}" lens domain`,
    });
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Concord Cognitive Engine API",
      version: serverVersion,
      description:
        "Auto-generated API specification for the Concord Cognitive Engine. " +
        `Covers ${domainActions.size} lens domains with ${LENS_ACTIONS.size} total actions, ` +
        "plus core REST endpoints for DTUs, authentication, chat, social, governance, marketplace, billing, and key management.",
      contact: { name: "Concord Team" },
      license: { name: "MIT" },
    },
    servers: [
      // @env-config-ok: OpenAPI spec example server entry — documentation example, not runtime
      { url: "http://localhost:5050", description: "Local development" },
      { url: "https://api.concord.example.com", description: "Production" },
    ],
    tags,
    paths,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT or csk_... API key",
          description: "Pass a JWT token or a Concord Secret Key (csk_...) in the Authorization header.",
        },
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "Legacy API key header (prefer Authorization: Bearer csk_...)",
        },
      },
      schemas: {
        DTU: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            domain: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        APIKey: {
          type: "object",
          properties: {
            id: { type: "string" },
            prefix: { type: "string", example: "csk_a1b2c3d4..." },
            scopes: { type: "array", items: { type: "string" } },
            rateLimit: {
              type: "object",
              properties: {
                requestsPerMinute: { type: "integer" },
                requestsPerDay: { type: "integer" },
              },
            },
            createdAt: { type: "string", format: "date-time" },
            lastUsed: { type: "string", format: "date-time", nullable: true },
            usageCount: { type: "integer" },
            revoked: { type: "boolean" },
          },
        },
        Error: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: false },
            error: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  };
}

/**
 * Add core (non-lens) API paths to the spec.
 */
function addCorePaths(paths) {
  // ── Auth ─────────────────────────────────────────────────────────────
  paths["/api/auth/register"] = {
    post: {
      tags: ["Auth"],
      summary: "Register a new user",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["username", "password"],
              properties: {
                username: { type: "string" },
                password: { type: "string", format: "password" },
                email: { type: "string", format: "email" },
              },
            },
          },
        },
      },
      responses: { 201: { description: "User created" }, 400: { description: "Validation error" } },
    },
  };

  paths["/api/auth/login"] = {
    post: {
      tags: ["Auth"],
      summary: "Login and receive JWT token",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["username", "password"],
              properties: {
                username: { type: "string" },
                password: { type: "string", format: "password" },
              },
            },
          },
        },
      },
      responses: { 200: { description: "Login successful, returns token" }, 401: { description: "Invalid credentials" } },
    },
  };

  // ── API Keys ─────────────────────────────────────────────────────────
  paths["/api/keys"] = {
    get: {
      tags: ["API Keys"],
      summary: "List your API keys",
      security: [{ BearerAuth: [] }],
      responses: {
        200: {
          description: "Array of API key metadata",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  keys: { type: "array", items: { $ref: "#/components/schemas/APIKey" } },
                },
              },
            },
          },
        },
      },
    },
    post: {
      tags: ["API Keys"],
      summary: "Generate a new API key",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string", description: "Display name for the key" },
                scopes: { type: "array", items: { type: "string" }, description: "Lens domains this key can access (empty = all)" },
                rateLimit: {
                  type: "object",
                  properties: {
                    requestsPerMinute: { type: "integer", default: 60 },
                    requestsPerDay: { type: "integer", default: 10000 },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "Key created — rawKey is returned only once" },
        400: { description: "Validation error or max keys reached" },
      },
    },
  };

  paths["/api/keys/{id}"] = {
    put: {
      tags: ["API Keys"],
      summary: "Update key scopes or rate limit",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                scopes: { type: "array", items: { type: "string" } },
                rateLimit: { type: "object" },
              },
            },
          },
        },
      },
      responses: { 200: { description: "Key updated" }, 404: { description: "Key not found" } },
    },
    delete: {
      tags: ["API Keys"],
      summary: "Revoke an API key",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "Key revoked" }, 404: { description: "Key not found" } },
    },
  };

  paths["/api/keys/{id}/usage"] = {
    get: {
      tags: ["API Keys"],
      summary: "Get usage stats for a key",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "Usage statistics" } },
    },
  };

  // ── DTUs ─────────────────────────────────────────────────────────────
  paths["/api/dtus"] = {
    get: {
      tags: ["DTUs"],
      summary: "List DTUs",
      security: [{ BearerAuth: [] }],
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        { name: "domain", in: "query", schema: { type: "string" } },
      ],
      responses: { 200: { description: "DTU list" } },
    },
    post: {
      tags: ["DTUs"],
      summary: "Create a new DTU",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/DTU" },
          },
        },
      },
      responses: { 201: { description: "DTU created" } },
    },
  };

  paths["/api/dtus/{id}"] = {
    get: {
      tags: ["DTUs"],
      summary: "Get a DTU by ID",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "DTU data" }, 404: { description: "Not found" } },
    },
  };

  // ── Chat ─────────────────────────────────────────────────────────────
  paths["/api/chat"] = {
    post: {
      tags: ["Chat"],
      summary: "Send a chat message",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["message"],
              properties: {
                message: { type: "string" },
                sessionId: { type: "string" },
              },
            },
          },
        },
      },
      responses: { 200: { description: "Chat response" } },
    },
  };

  paths["/api/chat/stream"] = {
    post: {
      tags: ["Chat"],
      summary: "Stream a chat response (SSE)",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["message"],
              properties: {
                message: { type: "string" },
                sessionId: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Server-Sent Events stream",
          content: { "text/event-stream": {} },
        },
      },
    },
  };

  // ── Billing ──────────────────────────────────────────────────────────
  paths["/api/billing/config"] = {
    get: {
      tags: ["Billing"],
      summary: "Get billing configuration and pricing tiers",
      responses: { 200: { description: "Billing config" } },
    },
  };

  paths["/api/billing/usage/{userId}"] = {
    get: {
      tags: ["Billing"],
      summary: "Get usage summary for a user",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: { description: "Usage summary" } },
    },
  };

  // ── Social ───────────────────────────────────────────────────────────
  paths["/api/social/post"] = {
    post: {
      tags: ["Social"],
      summary: "Create a social post",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["content"],
              properties: {
                content: { type: "string" },
                dtuId: { type: "string", description: "Optional DTU to attach" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "Post created" },
        400: { description: "Invalid request" },
        401: { description: "Unauthorized" },
      },
    },
  };

  paths["/api/social/feed"] = {
    get: {
      tags: ["Social"],
      summary: "Get social feed for the authenticated user",
      security: [{ BearerAuth: [] }],
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        { name: "cursor", in: "query", schema: { type: "string" } },
      ],
      responses: { 200: { description: "Feed items" }, 401: { description: "Unauthorized" } },
    },
  };

  paths["/api/social/follow"] = {
    post: {
      tags: ["Social"],
      summary: "Follow a user",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["targetUserId"],
              properties: { targetUserId: { type: "string" } },
            },
          },
        },
      },
      responses: {
        200: { description: "Followed" },
        400: { description: "Already following or invalid target" },
        401: { description: "Unauthorized" },
      },
    },
  };

  paths["/api/dtus/{id}/like"] = {
    post: {
      tags: ["Social"],
      summary: "Like a DTU",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: { description: "Like recorded or alreadyLiked: true" },
        401: { description: "Unauthorized" },
        404: { description: "DTU not found" },
      },
    },
  };

  paths["/api/dtus/{id}/vote"] = {
    post: {
      tags: ["Social"],
      summary: "Vote on a DTU",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["direction"],
              properties: { direction: { type: "string", enum: ["up", "down"] } },
            },
          },
        },
      },
      responses: {
        200: { description: "Vote recorded or alreadyVoted: true" },
        401: { description: "Unauthorized" },
        404: { description: "DTU not found" },
      },
    },
  };

  paths["/api/dtus/{id}/fork"] = {
    post: {
      tags: ["DTUs"],
      summary: "Fork a DTU",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { title: { type: "string", description: "Override title for the fork" } },
            },
          },
        },
      },
      responses: {
        201: { description: "Forked DTU", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, dtu: { $ref: "#/components/schemas/DTU" } } } } } },
        401: { description: "Unauthorized" },
        404: { description: "DTU not found" },
      },
    },
  };

  // ── Governance ───────────────────────────────────────────────────────
  paths["/api/governance/proposals"] = {
    get: {
      tags: ["Governance"],
      summary: "List governance proposals",
      parameters: [
        { name: "status", in: "query", schema: { type: "string", enum: ["open", "closed", "passed", "rejected"] } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
      ],
      responses: { 200: { description: "List of proposals" } },
    },
    post: {
      tags: ["Governance"],
      summary: "Create a governance proposal",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["title", "description"],
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                type: { type: "string", enum: ["policy", "feature", "budget", "other"] },
                votingEndsAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "Proposal created" },
        400: { description: "Invalid request" },
        401: { description: "Unauthorized" },
      },
    },
  };

  paths["/api/governance/proposals/{id}/vote"] = {
    post: {
      tags: ["Governance"],
      summary: "Vote on a governance proposal",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["vote"],
              properties: { vote: { type: "string", enum: ["yes", "no", "abstain"] } },
            },
          },
        },
      },
      responses: {
        200: { description: "Vote recorded" },
        401: { description: "Unauthorized" },
        404: { description: "Proposal not found" },
        409: { description: "Already voted" },
      },
    },
  };

  // ── Marketplace ──────────────────────────────────────────────────────
  paths["/api/economy/marketplace"] = {
    get: {
      tags: ["Marketplace"],
      summary: "List marketplace listings",
      parameters: [
        { name: "domain", in: "query", schema: { type: "string" } },
        { name: "sort", in: "query", schema: { type: "string", enum: ["newest", "price_asc", "price_desc", "popular"] } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        { name: "cursor", in: "query", schema: { type: "string" } },
      ],
      responses: { 200: { description: "Marketplace listings" } },
    },
  };

  paths["/api/dtus/{id}/publish"] = {
    post: {
      tags: ["Marketplace"],
      summary: "Publish a DTU to the marketplace",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["price"],
              properties: {
                price: { type: "number", minimum: 0, description: "Price in platform credits" },
                license: { type: "string", enum: ["basic", "premium", "exclusive"], default: "basic" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Listing created", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, listingId: { type: "string" } } } } } },
        401: { description: "Unauthorized" },
        403: { description: "Not the DTU owner" },
        404: { description: "DTU not found" },
        409: { description: "Already listed" },
      },
    },
  };

  paths["/api/economy/marketplace/{id}/purchase"] = {
    post: {
      tags: ["Marketplace"],
      summary: "Purchase a marketplace listing",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", description: "Listing ID" } }],
      responses: {
        200: { description: "Purchase successful, royalties distributed" },
        400: { description: "Insufficient credits or already owned" },
        401: { description: "Unauthorized" },
        404: { description: "Listing not found" },
      },
    },
  };

  // ── Health ───────────────────────────────────────────────────────────
  paths["/health"] = {
    get: {
      tags: ["Docs"],
      summary: "Health check",
      security: [],
      responses: { 200: { description: "Server is healthy" } },
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Interactive API Explorer HTML
// ────────────────────────────────────────────────────────────────────────────

function buildExplorerHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Concord API Explorer</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0; padding: 0; background: #0d1117; color: #c9d1d9;
    }
    header {
      background: #161b22; border-bottom: 1px solid #30363d;
      padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem;
    }
    header h1 { margin: 0; font-size: 1.4rem; color: #58a6ff; }
    header .version { color: #8b949e; font-size: 0.85rem; }
    .container { max-width: 1200px; margin: 0 auto; padding: 1.5rem 2rem; }
    .controls { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .controls input, .controls select {
      background: #0d1117; border: 1px solid #30363d; color: #c9d1d9;
      padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.9rem;
    }
    .controls input { flex: 1; min-width: 200px; }
    .controls select { min-width: 150px; }
    .api-key-bar {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      padding: 0.75rem 1rem; margin-bottom: 1.5rem; display: flex; gap: 0.75rem; align-items: center;
    }
    .api-key-bar label { color: #8b949e; font-size: 0.85rem; white-space: nowrap; }
    .api-key-bar input {
      flex: 1; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9;
      padding: 0.5rem; border-radius: 4px; font-family: monospace; font-size: 0.85rem;
    }
    .endpoint {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      margin-bottom: 0.75rem; overflow: hidden;
    }
    .endpoint-header {
      padding: 0.75rem 1rem; cursor: pointer; display: flex; align-items: center; gap: 0.75rem;
    }
    .endpoint-header:hover { background: #1c2129; }
    .method {
      font-weight: 700; font-size: 0.75rem; padding: 0.2rem 0.5rem;
      border-radius: 4px; font-family: monospace; min-width: 52px; text-align: center;
    }
    .method.post { background: #238636; color: #fff; }
    .method.get { background: #1f6feb; color: #fff; }
    .method.put { background: #9e6a03; color: #fff; }
    .method.delete { background: #da3633; color: #fff; }
    .path { font-family: monospace; color: #c9d1d9; font-size: 0.9rem; }
    .summary { color: #8b949e; font-size: 0.85rem; margin-left: auto; }
    .tag-badge {
      font-size: 0.7rem; background: #30363d; color: #8b949e;
      padding: 0.15rem 0.4rem; border-radius: 3px;
    }
    .endpoint-body { display: none; padding: 1rem; border-top: 1px solid #30363d; }
    .endpoint-body.open { display: block; }
    .try-it { display: flex; flex-direction: column; gap: 0.75rem; }
    .try-it textarea {
      background: #0d1117; border: 1px solid #30363d; color: #c9d1d9;
      border-radius: 6px; padding: 0.75rem; font-family: monospace;
      font-size: 0.85rem; min-height: 80px; resize: vertical;
    }
    .try-it button {
      background: #238636; color: #fff; border: none; padding: 0.6rem 1.5rem;
      border-radius: 6px; cursor: pointer; font-size: 0.9rem; align-self: flex-start;
    }
    .try-it button:hover { background: #2ea043; }
    .response-box {
      background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
      padding: 0.75rem; font-family: monospace; font-size: 0.85rem;
      white-space: pre-wrap; max-height: 300px; overflow: auto; color: #7ee787;
    }
    .response-box.error { color: #f85149; }
    .stats { color: #8b949e; font-size: 0.85rem; margin-bottom: 1rem; }
    #loading { text-align: center; padding: 3rem; color: #8b949e; }
  </style>
</head>
<body>
  <header>
    <h1>Concord API Explorer</h1>
    <span class="version" id="version"></span>
  </header>
  <div class="container">
    <div class="api-key-bar">
      <label>API Key:</label>
      <input type="password" id="apiKeyInput" placeholder="csk_... or JWT token" />
    </div>
    <div class="controls">
      <input type="text" id="searchInput" placeholder="Search endpoints..." />
      <select id="tagFilter"><option value="">All Tags</option></select>
    </div>
    <div class="stats" id="stats"></div>
    <div id="loading">Loading API specification...</div>
    <div id="endpoints"></div>
  </div>
  <script>
    (async () => {
      const res = await fetch("/api/docs/openapi.json");
      const spec = await res.json();

      document.getElementById("version").textContent = "v" + (spec.info?.version || "?");
      document.getElementById("loading").style.display = "none";

      const tagFilter = document.getElementById("tagFilter");
      (spec.tags || []).forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.name; opt.textContent = t.name;
        tagFilter.appendChild(opt);
      });

      const entries = [];
      for (const [path, methods] of Object.entries(spec.paths || {})) {
        for (const [method, op] of Object.entries(methods)) {
          entries.push({ path, method: method.toUpperCase(), ...op });
        }
      }

      document.getElementById("stats").textContent =
        entries.length + " endpoints across " + (spec.tags?.length || 0) + " tags";

      function render(filter = "", tag = "") {
        const el = document.getElementById("endpoints");
        const filtered = entries.filter(e => {
          if (filter && !e.path.toLowerCase().includes(filter) &&
              !(e.summary || "").toLowerCase().includes(filter)) return false;
          if (tag && !(e.tags || []).includes(tag)) return false;
          return true;
        });
        el.innerHTML = filtered.map((e, i) => \`
          <div class="endpoint">
            <div class="endpoint-header" onclick="toggle(\${i})">
              <span class="method \${e.method.toLowerCase()}">\${e.method}</span>
              <span class="path">\${e.path}</span>
              \${(e.tags||[]).map(t => '<span class="tag-badge">'+t+'</span>').join("")}
              <span class="summary">\${e.summary || ""}</span>
            </div>
            <div class="endpoint-body" id="body-\${i}">
              <p>\${e.description || ""}</p>
              <div class="try-it">
                <textarea id="payload-\${i}" placeholder='{"key": "value"}'>\${e.method === "GET" ? "" : JSON.stringify({artifact:{},params:{}}, null, 2)}</textarea>
                <button onclick="tryIt(\${i}, '\${e.method}', '\${e.path}')">Send Request</button>
                <div class="response-box" id="resp-\${i}">Response will appear here...</div>
              </div>
            </div>
          </div>
        \`).join("");
      }

      render();

      document.getElementById("searchInput").addEventListener("input", e =>
        render(e.target.value.toLowerCase(), tagFilter.value));
      tagFilter.addEventListener("change", e =>
        render(document.getElementById("searchInput").value.toLowerCase(), e.target.value));

      window.toggle = (i) => {
        document.getElementById("body-" + i)?.classList.toggle("open");
      };

      window.tryIt = async (i, method, path) => {
        const respEl = document.getElementById("resp-" + i);
        const payload = document.getElementById("payload-" + i)?.value;
        const apiKey = document.getElementById("apiKeyInput")?.value;
        respEl.textContent = "Sending...";
        respEl.className = "response-box";
        try {
          const opts = { method, headers: { "Content-Type": "application/json" } };
          if (apiKey) opts.headers["Authorization"] = "Bearer " + apiKey;
          if (method !== "GET" && payload?.trim()) opts.body = payload;
          const r = await fetch(path, opts);
          const text = await r.text();
          try { respEl.textContent = JSON.stringify(JSON.parse(text), null, 2); }
          catch { respEl.textContent = text; }
          if (!r.ok) respEl.className = "response-box error";
        } catch (err) {
          respEl.textContent = "Error: " + err.message;
          respEl.className = "response-box error";
        }
      };
    })();
  </script>
</body>
</html>`;
}
