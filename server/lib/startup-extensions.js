/**
 * Startup Extensions — optional capability modules initialized at server start.
 *
 * Call initExtensions(app, db, STATE, io) once after DB migrations complete,
 * before routes are mounted. Every block is wrapped in try/catch — a failing
 * optional module never crashes the server.
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import logger from "../logger.js";

import { initErrorAlerting } from "./error-alerting.js";
import { createCDNManager } from "./cdn-manager.js";
import { createURLSigner } from "./cdn-url-signer.js";
import { cdnMiddleware, cdnCacheHeaders, cdnCorsHeaders } from "./cdn-middleware.js";
import { createSecurityIngest } from "./security-ingest.js";
import { createSecurityMatcher } from "./security-matcher.js";
import { initCanonicalRegistry, createCanonicalStore } from "./canonical-registry.js";
import { initFeedManager, startFeedManager } from "./feed-manager.js";
import { ALL_DEFAULT_FEEDS } from "./feed-sources.js";
import { importAnthropicSkillTree } from "./skills/anthropic-skills-adapter.js";
import { initIntegrityTable, createIntegritySystem } from "./dtu-integrity.js";
import { initRightsTable, createRightsManager } from "./dtu-rights.js";
import { createCompressionPipeline } from "./dtu-compression.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Initialize all optional server extension modules.
 * @param {import('express').Application} app
 * @param {object} db  — SQLite/DB handle
 * @param {object} STATE — shared server state object
 * @param {object} io   — Socket.IO server
 */
export async function initExtensions(app, db, STATE, io) {
  // 1. Error alerting — must be first so subsequent init failures are reported
  try {
    initErrorAlerting();
    logger.info("[startup-extensions] error alerting initialized");
  } catch (err) {
    logger.warn("[startup-extensions] error-alerting init failed", { err: err?.message });
  }

  // 2. CDN manager
  try {
    const cdnManager = createCDNManager({ provider: process.env.CONCORD_CDN_PROVIDER });
    app.locals.cdnManager = cdnManager;
    logger.info("[startup-extensions] CDN manager initialized", { provider: process.env.CONCORD_CDN_PROVIDER || "local" });
  } catch (err) {
    logger.warn("[startup-extensions] cdn-manager init failed", { err: err?.message });
  }

  // 3. CDN URL signer
  try {
    if (process.env.CONCORD_CDN_SIGNING_SECRET) {
      app.locals.urlSigner = createURLSigner({ secret: process.env.CONCORD_CDN_SIGNING_SECRET });
      logger.info("[startup-extensions] CDN URL signer initialized");
    }
  } catch (err) {
    logger.warn("[startup-extensions] cdn-url-signer init failed", { err: err?.message });
  }

  // 4. CDN middleware (depends on cdnManager being set above)
  try {
    if (app.locals.cdnManager) {
      app.use(cdnMiddleware(app.locals.cdnManager));
      app.use(cdnCacheHeaders());
      app.use(cdnCorsHeaders());
      logger.info("[startup-extensions] CDN middleware mounted");
    }
  } catch (err) {
    logger.warn("[startup-extensions] cdn-middleware mount failed", { err: err?.message });
  }

  // 5. Security ingest
  try {
    app.locals.securityIngest = await createSecurityIngest(db);
    logger.info("[startup-extensions] security ingest initialized");
  } catch (err) {
    logger.warn("[startup-extensions] security-ingest init failed", { err: err?.message });
  }

  // 6. Security matcher
  try {
    app.locals.securityMatcher = createSecurityMatcher(db, {});
    logger.info("[startup-extensions] security matcher initialized");
  } catch (err) {
    logger.warn("[startup-extensions] security-matcher init failed", { err: err?.message });
  }

  // 7. Canonical registry
  try {
    initCanonicalRegistry(db);
    app.locals.canonicalStore = createCanonicalStore(db, STATE?.dtuStore ?? null, {});
    logger.info("[startup-extensions] canonical registry initialized");
  } catch (err) {
    logger.warn("[startup-extensions] canonical-registry init failed", { err: err?.message });
  }

  // 8. Feed manager
  try {
    const feedMgr = initFeedManager({ STATE, db, io, logger });
    // Register all default feed sources
    if (typeof feedMgr?.registerFeeds === "function") {
      feedMgr.registerFeeds(ALL_DEFAULT_FEEDS);
    } else {
      // registerFeeds may be a module-level fn; register individually
      for (const feed of ALL_DEFAULT_FEEDS) {
        try {
          const { registerFeed } = await import("./feed-manager.js");
          registerFeed(feed);
        } catch { /* skip bad feed */ }
      }
    }
    startFeedManager();
    app.locals.feedManager = feedMgr;
    logger.info("[startup-extensions] feed manager started", { feeds: ALL_DEFAULT_FEEDS.length });
  } catch (err) {
    logger.warn("[startup-extensions] feed-manager init failed", { err: err?.message });
  }

  // 9. Anthropic skill tree import (background, non-blocking)
  try {
    const skillsDir = path.join(__dirname, "../skills");
    if (fs.existsSync(skillsDir)) {
      Promise.resolve(importAnthropicSkillTree(skillsDir))
        .catch(err => logger.debug("[startup-extensions] skill tree import failed", { err: err?.message }));
      logger.info("[startup-extensions] anthropic skill tree import queued", { dir: skillsDir });
    }
  } catch (err) {
    logger.warn("[startup-extensions] anthropic-skills-adapter init failed", { err: err?.message });
  }

  // 10. DTU integrity system
  try {
    initIntegrityTable(db);
    app.locals.dtuIntegrity = createIntegritySystem(db, {});
    logger.info("[startup-extensions] DTU integrity system initialized");
  } catch (err) {
    logger.warn("[startup-extensions] dtu-integrity init failed", { err: err?.message });
  }

  // 11. DTU rights manager
  try {
    initRightsTable(db);
    app.locals.dtuRights = createRightsManager(db, {});
    logger.info("[startup-extensions] DTU rights manager initialized");
  } catch (err) {
    logger.warn("[startup-extensions] dtu-rights init failed", { err: err?.message });
  }

  // 12. DTU compression pipeline
  try {
    app.locals.dtuCompression = createCompressionPipeline({});
    logger.info("[startup-extensions] DTU compression pipeline initialized");
  } catch (err) {
    logger.warn("[startup-extensions] dtu-compression init failed", { err: err?.message });
  }

  logger.info("[startup-extensions] all extension modules processed");
}
