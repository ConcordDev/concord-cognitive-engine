#!/usr/bin/env node
// server/scripts/mint-hermes-mcp-bridge-key.mjs
//
// Mint a least-privilege csk_ API key for the Hermes MCP Execution Bridge.
// User id is always `hermes` — never Ramaj or any human account.
// Default scopes: mcp:lens:read, mcp:lens:compute, mcp:conkay:read, mcp:conkay:compute.
//
// Usage:
//   FOUNDER_SECRET=… node server/scripts/mint-hermes-mcp-bridge-key.mjs
//   # optional: --scopes=mcp:lens:read,mcp:conkay:read
//
// Prints the raw key ONCE. Set as CONCORD_MCP_TOKEN for concord-local-mcp.py.

import crypto from "node:crypto";
import { HERMES_USER_ID, HERMES_BRIDGE_DEFAULT_SCOPES } from "../lib/mcp-hermes-identity.js";

const args = process.argv.slice(2);
function parseFlag(name, fallback) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(`--${name}=`.length);
}

const SECRET = process.env.FOUNDER_SECRET || "";
if (!SECRET) {
  console.error("FATAL: FOUNDER_SECRET env var is unset.");
  process.exit(2);
}

const SCOPES_ARG = parseFlag("scopes", "");
const SCOPES = SCOPES_ARG
  ? SCOPES_ARG.split(",").map((s) => s.trim()).filter(Boolean)
  : [...HERMES_BRIDGE_DEFAULT_SCOPES];

// Refuse wildcard for this mint path — that would defeat least privilege.
if (SCOPES.includes("*") || SCOPES.includes("all")) {
  console.error("FATAL: wildcard scopes refused for Hermes bridge key. Use explicit mcp:* scopes.");
  process.exit(2);
}

const { generateKey } = await import("../lib/api-keys.js");
const minted = generateKey(HERMES_USER_ID, SCOPES, {
  requestsPerMinute: 120,
  requestsPerDay: 50000,
});
if (!minted.ok) {
  console.error(`FATAL: mint failed: ${minted.error}`);
  process.exit(1);
}

const last4 = minted.rawKey.slice(-4);
console.log("============================================================");
console.log(`Hermes MCP bridge key minted  ·  last 4: ${last4}`);
console.log("============================================================");
console.log(minted.rawKey);
console.log("============================================================");
console.log(`user:      ${HERMES_USER_ID} (service identity — never a human)`);
console.log(`scopes:    ${SCOPES.join(", ")}`);
console.log("validity:  in-memory only (dies on server restart)");
console.log("export:    CONCORD_MCP_TOKEN=<raw key>  # for concord-local-mcp.py");
console.log("============================================================");

// Also write a non-secret receipt for operators (no raw key).
const receipt = {
  keyId: minted.key.id,
  userId: HERMES_USER_ID,
  scopes: SCOPES,
  prefix: minted.key.prefix,
  last4,
  mintedAt: new Date().toISOString(),
  entropy: crypto.randomBytes(4).toString("hex"),
};
console.error(`[receipt] ${JSON.stringify(receipt)}`);
