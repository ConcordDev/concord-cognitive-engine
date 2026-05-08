/**
 * Concord Identity (CID) — Authentication, Identity & OAuth 2.0 Provider
 *
 * Manages user identities within the Concord platform. Each identity carries
 * professional credentials, per-domain reputation, portfolio stats, badges,
 * firm affiliations, and world memberships.
 *
 * Includes a built-in OAuth 2.0 authorization server (simulated) with
 * scope-based access control for third-party integrations.
 *
 * Seed identities are loaded on construction for development/testing.
 */

"use strict";

const crypto = require("crypto");

// ── Helpers ────────────────────────────────────────────────────────────────

function uid(prefix = "cid") {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

// ── OAuth Scope Definitions ────────────────────────────────────────────────

const OAUTH_SCOPES = Object.freeze({
  profile:    { label: "Profile",    description: "Read display name, handle, avatar, join date" },
  portfolio:  { label: "Portfolio",  description: "Read DTU portfolio stats and top contributions" },
  reputation: { label: "Reputation", description: "Read per-domain and overall reputation scores" },
  badges:     { label: "Badges",     description: "Read earned badges and achievements" },
  firms:      { label: "Firms",      description: "Read firm memberships and roles" },
  worlds:     { label: "Worlds",     description: "Read world memberships and roles" },
  email:      { label: "Email",      description: "Read email address" },
  validate:   { label: "Validate",   description: "Verify identity and credentials" },
  publish:    { label: "Publish",    description: "Publish DTUs on behalf of the user" },
});

// ── Scope-to-Field Mapping ─────────────────────────────────────────────────

const SCOPE_FIELDS = Object.freeze({
  profile:    ["cid", "handle", "displayName", "avatar", "joined", "professions", "verified"],
  portfolio:  ["portfolio"],
  reputation: ["reputation"],
  badges:     ["badges"],
  firms:      ["firms"],
  worlds:     ["worlds"],
  email:      ["email"],
  validate:   ["cid", "handle", "verified", "reputation"],
  publish:    ["cid", "handle"],
});

// ── Seed Identities ────────────────────────────────────────────────────────

function buildSeedIdentities() {
  const seeds = [
    {
      cid: "cid_engineer_dutch_001",
      handle: "@engineer_dutch",
      displayName: "Dutch van der Berg",
      avatar: "https://concord.city/avatars/dutch.png",
      email: "dutch@concordengineering.io",
      joined: "2024-03-15T09:00:00Z",
      professions: ["architect", "structural-engineer"],
      reputation: {
        overall: 4506,
        domains: {
          architecture: 1800,
          "structural-engineering": 1600,
          "urban-planning": 700,
          collaboration: 406,
        },
      },
      portfolio: {
        totalDTUs: 342,
        totalCitations: 1287,
        totalRoyalties: 14520.50,
        topDTUs: [
          { id: "dtu_bridge_cantilever_01", title: "Cantilever Bridge Load Analysis", citations: 89 },
          { id: "dtu_tower_wind_02", title: "High-Rise Wind Resistance Model", citations: 74 },
          { id: "dtu_foundation_clay_03", title: "Clay Soil Foundation Spec", citations: 61 },
        ],
      },
      badges: ["founding-member", "master-architect", "peer-reviewer-gold", "1000-citations"],
      firms: [
        { firmId: "firm_vdb_arch", name: "Van der Berg Architecture", role: "founder" },
      ],
      worlds: [
        { worldId: "world_harbor_001", name: "Harbor District", role: "lead-architect" },
        { worldId: "world_downtown_002", name: "Downtown Core", role: "contributor" },
      ],
      verified: true,
    },
    {
      cid: "cid_jane_structures_002",
      handle: "@jane_structures",
      displayName: "Jane Okafor",
      avatar: "https://concord.city/avatars/jane.png",
      email: "jane@structuralworks.io",
      joined: "2024-05-22T14:30:00Z",
      professions: ["structural-engineer"],
      reputation: {
        overall: 3200,
        domains: {
          "structural-engineering": 2100,
          "seismic-analysis": 800,
          collaboration: 300,
        },
      },
      portfolio: {
        totalDTUs: 198,
        totalCitations: 742,
        totalRoyalties: 8340.00,
        topDTUs: [
          { id: "dtu_seismic_retrofit_01", title: "Seismic Retrofit Protocol", citations: 112 },
          { id: "dtu_steel_joint_02", title: "Steel Joint Fatigue Model", citations: 67 },
        ],
      },
      badges: ["structural-specialist", "peer-reviewer-silver", "500-citations"],
      firms: [
        { firmId: "firm_structural_works", name: "Structural Works Ltd", role: "partner" },
      ],
      worlds: [
        { worldId: "world_harbor_001", name: "Harbor District", role: "structural-reviewer" },
      ],
      verified: true,
    },
    {
      cid: "cid_kai_marine_003",
      handle: "@kai_marine",
      displayName: "Kai Nakamura",
      avatar: "https://concord.city/avatars/kai.png",
      email: "kai@oceanmaterials.io",
      joined: "2024-08-10T11:00:00Z",
      professions: ["marine-biologist", "materials-scientist"],
      reputation: {
        overall: 2100,
        domains: {
          "marine-biology": 900,
          "materials-science": 800,
          "environmental-impact": 400,
        },
      },
      portfolio: {
        totalDTUs: 87,
        totalCitations: 310,
        totalRoyalties: 3200.00,
        topDTUs: [
          { id: "dtu_coral_concrete_01", title: "Coral-Safe Concrete Mix", citations: 48 },
          { id: "dtu_saltwater_corrosion_02", title: "Saltwater Corrosion Resistance", citations: 39 },
        ],
      },
      badges: ["interdisciplinary-pioneer", "eco-innovator"],
      firms: [],
      worlds: [
        { worldId: "world_harbor_001", name: "Harbor District", role: "environmental-consultant" },
        { worldId: "world_coastal_003", name: "Coastal Resilience Zone", role: "lead-researcher" },
      ],
      verified: true,
    },
    {
      cid: "cid_proxy_builder_004",
      handle: "@proxy_builder",
      displayName: "Proxy Chen",
      avatar: "https://concord.city/avatars/proxy.png",
      email: "proxy@urbanforge.io",
      joined: "2024-09-01T08:00:00Z",
      professions: ["urban-planner", "architect"],
      reputation: {
        overall: 1800,
        domains: {
          "urban-planning": 1000,
          architecture: 500,
          "community-design": 300,
        },
      },
      portfolio: {
        totalDTUs: 64,
        totalCitations: 195,
        totalRoyalties: 1800.00,
        topDTUs: [
          { id: "dtu_mixed_use_zoning_01", title: "Mixed-Use Zoning Template", citations: 33 },
          { id: "dtu_pedestrian_flow_02", title: "Pedestrian Flow Simulation", citations: 28 },
        ],
      },
      badges: ["urban-visionary", "community-builder"],
      firms: [
        { firmId: "firm_urban_forge", name: "Urban Forge Collective", role: "co-founder" },
      ],
      worlds: [
        { worldId: "world_downtown_002", name: "Downtown Core", role: "zoning-lead" },
      ],
      verified: true,
    },
    {
      cid: "cid_nova_circuits_005",
      handle: "@nova_circuits",
      displayName: "Nova Petrov",
      avatar: "https://concord.city/avatars/nova.png",
      email: "nova@circuitdesign.io",
      joined: "2025-01-12T16:45:00Z",
      professions: ["electrical-engineer"],
      reputation: {
        overall: 950,
        domains: {
          "electrical-engineering": 600,
          "circuit-design": 250,
          collaboration: 100,
        },
      },
      portfolio: {
        totalDTUs: 31,
        totalCitations: 78,
        totalRoyalties: 620.00,
        topDTUs: [
          { id: "dtu_smart_grid_01", title: "Smart Grid Load Balancer", citations: 22 },
        ],
      },
      badges: ["rising-star"],
      firms: [],
      worlds: [
        { worldId: "world_downtown_002", name: "Downtown Core", role: "electrical-consultant" },
      ],
      verified: false,
    },
  ];

  const map = new Map();
  for (const identity of seeds) {
    map.set(identity.cid, identity);
  }
  return map;
}

// ── ConcordIdentity Class ──────────────────────────────────────────────────

class ConcordIdentity {
  constructor() {
    /** @type {Map<string, object>} cid -> identity */
    this._identities = buildSeedIdentities();

    /** @type {Map<string, string>} handle -> cid (lookup index) */
    this._handleIndex = new Map();
    for (const [cid, identity] of this._identities.entries()) {
      this._handleIndex.set(identity.handle, cid);
    }

    /** @type {Map<string, object>} authCode -> { cid, scopes, clientId, redirectUri, expiresAt } */
    this._authCodes = new Map();

    /** @type {Map<string, object>} accessToken -> { cid, scopes, issuedAt, expiresAt } */
    this._tokens = new Map();

    /** @type {Map<string, object>} refreshToken -> { cid, accessToken } */
    this._refreshTokens = new Map();
  }

  // ── Identity Management ──────────────────────────────────────────────

  /**
   * Look up an identity by CID or handle.
   *
   * @param {string} cidOrHandle
   * @returns {object|null}
   */
  getIdentity(cidOrHandle) {
    if (!cidOrHandle) return null;

    // Direct CID lookup
    if (this._identities.has(cidOrHandle)) {
      return { ...this._identities.get(cidOrHandle) };
    }

    // Handle lookup (with or without @)
    const handle = cidOrHandle.startsWith("@") ? cidOrHandle : `@${cidOrHandle}`;
    const cid = this._handleIndex.get(handle);
    if (cid) {
      return { ...this._identities.get(cid) };
    }

    return null;
  }

  /**
   * Create a new Concord Identity.
   *
   * @param {object} config
   * @param {string} config.handle         — unique handle (e.g. "@new_user")
   * @param {string} config.displayName
   * @param {string[]} [config.professions]
   * @param {string} [config.email]
   * @param {string} [config.avatar]
   * @returns {object} the created identity
   */
  createIdentity(config) {
    if (!config || !config.handle || !config.displayName) {
      throw new Error("handle and displayName are required");
    }

    const handle = config.handle.startsWith("@") ? config.handle : `@${config.handle}`;

    if (this._handleIndex.has(handle)) {
      throw new Error(`Handle "${handle}" is already taken`);
    }

    const cid = uid("cid");
    const identity = {
      cid,
      handle,
      displayName: config.displayName,
      avatar: config.avatar || `https://concord.city/avatars/default.png`,
      email: config.email || null,
      joined: nowISO(),
      professions: config.professions || [],
      reputation: {
        overall: 0,
        domains: {},
      },
      portfolio: {
        totalDTUs: 0,
        totalCitations: 0,
        totalRoyalties: 0,
        topDTUs: [],
      },
      badges: [],
      firms: [],
      worlds: [],
      verified: false,
    };

    this._identities.set(cid, identity);
    this._handleIndex.set(handle, cid);

    return { ...identity };
  }

  /**
   * Update reputation for an identity in a specific domain.
   *
   * @param {string} cid
   * @param {string} domain   — e.g. "architecture", "structural-engineering"
   * @param {number} amount   — positive to add, negative to subtract
   * @returns {object} updated reputation
   */
  updateReputation(cid, domain, amount) {
    const identity = this._identities.get(cid);
    if (!identity) throw new Error(`Identity not found: ${cid}`);

    const numAmount = Number(amount) || 0;
    identity.reputation.domains[domain] = Math.max(
      0,
      (identity.reputation.domains[domain] || 0) + numAmount
    );

    // Recalculate overall
    identity.reputation.overall = Object.values(identity.reputation.domains)
      .reduce((sum, v) => sum + v, 0);

    return { ...identity.reputation };
  }

  /**
   * Award a badge to an identity.
   *
   * @param {string} cid
   * @param {string} badge
   * @returns {string[]} updated badges list
   */
  addBadge(cid, badge) {
    const identity = this._identities.get(cid);
    if (!identity) throw new Error(`Identity not found: ${cid}`);

    if (!identity.badges.includes(badge)) {
      identity.badges.push(badge);
    }

    return [...identity.badges];
  }

  // ── OAuth 2.0 Provider ───────────────────────────────────────────────

  /**
   * Generate an OAuth authorization URL.
   *
   * @param {string} clientId
   * @param {string} redirectUri
   * @param {string[]} scopes      — subset of OAUTH_SCOPES keys
   * @returns {object} { url, state }
   */
  generateAuthUrl(clientId, redirectUri, scopes) {
    if (!clientId || !redirectUri) {
      throw new Error("clientId and redirectUri are required");
    }

    const validScopes = (scopes || []).filter((s) => OAUTH_SCOPES[s]);
    if (validScopes.length === 0) {
      throw new Error(`No valid scopes provided. Available: ${Object.keys(OAUTH_SCOPES).join(", ")}`);
    }

    const state = randomToken(16);
    const code = randomToken(20);

    // Store the auth code (expires in 10 minutes)
    this._authCodes.set(code, {
      clientId,
      redirectUri,
      scopes: validScopes,
      state,
      expiresAt: Date.now() + 10 * 60 * 1000,
      cid: null, // set when user authorizes
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: validScopes.join(" "),
      state,
      code,
    });

    return {
      url: `https://id.concord.city/oauth/authorize?${params.toString()}`,
      state,
      code,
      scopes: validScopes,
    };
  }

  /**
   * Exchange an authorization code for access and refresh tokens.
   * In production this would verify client_secret; here we simulate.
   *
   * @param {string} code
   * @param {string} [cid]  — the CID of the authorizing user (simulated)
   * @returns {object} { accessToken, refreshToken, expiresIn, scopes, tokenType }
   */
  exchangeCode(code, cid) {
    const authEntry = this._authCodes.get(code);
    if (!authEntry) {
      throw new Error("Invalid or expired authorization code");
    }

    if (Date.now() > authEntry.expiresAt) {
      this._authCodes.delete(code);
      throw new Error("Authorization code expired");
    }

    // In simulated mode, use provided CID or first seed identity
    const identityCid = cid || authEntry.cid || this._identities.keys().next().value;
    if (!this._identities.has(identityCid)) {
      throw new Error(`Identity not found: ${identityCid}`);
    }

    const accessToken = randomToken(32);
    const refreshToken = randomToken(32);
    const expiresIn = 3600; // 1 hour

    this._tokens.set(accessToken, {
      cid: identityCid,
      scopes: authEntry.scopes,
      issuedAt: Date.now(),
      expiresAt: Date.now() + expiresIn * 1000,
    });

    this._refreshTokens.set(refreshToken, {
      cid: identityCid,
      accessToken,
    });

    // Consume the auth code
    this._authCodes.delete(code);

    return {
      accessToken,
      refreshToken,
      expiresIn,
      scopes: authEntry.scopes,
      tokenType: "Bearer",
    };
  }

  /**
   * Get user info for an access token (the /userinfo endpoint).
   *
   * @param {string} accessToken
   * @returns {object|null} scoped identity data
   */
  getUserInfo(accessToken) {
    const tokenData = this._tokens.get(accessToken);
    if (!tokenData) return null;

    if (Date.now() > tokenData.expiresAt) {
      this._tokens.delete(accessToken);
      return null;
    }

    const identity = this._identities.get(tokenData.cid);
    if (!identity) return null;

    return this.filterByScope(identity, tokenData.scopes);
  }

  /**
   * Validate an access token.
   *
   * @param {string} token
   * @returns {object} { valid, cid, scopes, expiresIn }
   */
  validateToken(token) {
    const tokenData = this._tokens.get(token);
    if (!tokenData) {
      return { valid: false, cid: null, scopes: [], expiresIn: 0 };
    }

    const remaining = tokenData.expiresAt - Date.now();
    if (remaining <= 0) {
      this._tokens.delete(token);
      return { valid: false, cid: tokenData.cid, scopes: [], expiresIn: 0 };
    }

    return {
      valid: true,
      cid: tokenData.cid,
      scopes: tokenData.scopes,
      expiresIn: Math.ceil(remaining / 1000),
    };
  }

  /**
   * Revoke an access token (and its associated refresh token).
   *
   * @param {string} token
   * @returns {boolean} true if revoked
   */
  revokeToken(token) {
    const existed = this._tokens.has(token);
    this._tokens.delete(token);

    // Also revoke any refresh token referencing this access token
    for (const [rt, data] of this._refreshTokens.entries()) {
      if (data.accessToken === token) {
        this._refreshTokens.delete(rt);
      }
    }

    return existed;
  }

  /**
   * Filter an identity to only include fields allowed by granted scopes.
   *
   * @param {object} identity
   * @param {string[]} scopes
   * @returns {object} filtered identity
   */
  filterByScope(identity, scopes) {
    if (!identity || !scopes || scopes.length === 0) return {};

    const allowedFields = new Set();
    for (const scope of scopes) {
      const fields = SCOPE_FIELDS[scope];
      if (fields) {
        for (const f of fields) allowedFields.add(f);
      }
    }

    const filtered = {};
    for (const field of allowedFields) {
      if (identity[field] !== undefined) {
        filtered[field] = identity[field];
      }
    }

    return filtered;
  }

  // ── Search ───────────────────────────────────────────────────────────

  /**
   * Search identities by handle, profession, or minimum reputation.
   *
   * @param {object} query
   * @param {string} [query.handle]       — partial handle match
   * @param {string} [query.profession]   — exact profession match
   * @param {number} [query.minReputation] — minimum overall reputation
   * @param {number} [query.limit=20]
   * @returns {object[]}
   */
  search(query = {}) {
    const limit = query.limit || 20;
    const results = [];

    for (const identity of this._identities.values()) {
      // Handle filter (partial, case-insensitive)
      if (query.handle) {
        const q = query.handle.toLowerCase().replace(/^@/, "");
        if (!identity.handle.toLowerCase().includes(q)) continue;
      }

      // Profession filter
      if (query.profession) {
        if (!identity.professions.includes(query.profession)) continue;
      }

      // Reputation filter
      if (query.minReputation != null) {
        if (identity.reputation.overall < query.minReputation) continue;
      }

      results.push({
        cid: identity.cid,
        handle: identity.handle,
        displayName: identity.displayName,
        professions: identity.professions,
        reputation: identity.reputation.overall,
        verified: identity.verified,
      });

      if (results.length >= limit) break;
    }

    // Sort by reputation descending
    results.sort((a, b) => b.reputation - a.reputation);

    return results;
  }

  // ── Introspection ────────────────────────────────────────────────────

  /**
   * Get available OAuth scopes.
   * @returns {object}
   */
  getScopes() {
    return { ...OAUTH_SCOPES };
  }

  /**
   * Get total identity count.
   * @returns {number}
   */
  getIdentityCount() {
    return this._identities.size;
  }
}

module.exports = ConcordIdentity;
