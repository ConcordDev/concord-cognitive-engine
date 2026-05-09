/**
 * DTU Usage Rights Model
 *
 * Every DTU carries an explicit rights declaration:
 * - Creator rights (always preserved)
 * - Derivative rights (can others remix?)
 * - Commercial rights (can it be sold?)
 * - Attribution requirements
 * - Scope restrictions (local-only, global, marketplace)
 * - Expiration (time-limited access)
 * - Transfer rules (can ownership change?)
 *
 * The rights model integrates with the canonical registry to ensure
 * that rights flow correctly from canonical DTUs to derivatives.
 */

import { randomUUID } from "crypto";

function uid(prefix = "rgt") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString();
}

// ── Predefined license types ──────────────────────────────────────────
export const LICENSE_TYPES = Object.freeze({
  standard: {
    name: "Standard",
    derivativeAllowed: true,
    commercialAllowed: false,
    attributionRequired: true,
    transferable: true,
    description: "Free to use and derive, attribution required, no commercial use",
  },
  creative_commons: {
    name: "Creative Commons",
    derivativeAllowed: true,
    commercialAllowed: true,
    attributionRequired: true,
    transferable: true,
    description: "Free to use, derive, and sell with attribution",
  },
  commercial: {
    name: "Commercial",
    derivativeAllowed: false,
    commercialAllowed: true,
    attributionRequired: false,
    transferable: true,
    description: "Purchased content, no derivatives, commercial use allowed",
  },
  exclusive: {
    name: "Exclusive",
    derivativeAllowed: false,
    commercialAllowed: false,
    attributionRequired: false,
    transferable: false,
    description: "Single owner only, no derivatives, no commercial use, no transfer",
  },
  open: {
    name: "Open",
    derivativeAllowed: true,
    commercialAllowed: true,
    attributionRequired: false,
    transferable: true,
    description: "Completely open — no restrictions",
  },
  "personal-use": {
    name: "Personal Use",
    derivativeAllowed: false,
    commercialAllowed: false,
    attributionRequired: true,
    transferable: false,
    description: "Personal use only — no derivatives, no commercial use, no transfer",
  },
});

// ── Valid actions for permission checks ───────────────────────────────
const VALID_ACTIONS = new Set([
  "read", "write", "delete", "promote",
  "derive", "sell", "transfer", "share",
  "export", "list_marketplace",
]);

// ── Valid scopes ─────────────────────────────────────────────────────
const VALID_SCOPES = new Set(["local", "global", "marketplace"]);

/**
 * Initialize the dtu_rights table in SQLite.
 * Called by migration 025, but safe to call again at boot.
 * @param {import("better-sqlite3").Database} db
 */
export function initRightsTable(db) {
  if (!db) return false;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dtu_rights (
        id TEXT PRIMARY KEY,
        dtu_id TEXT NOT NULL UNIQUE,
        creator_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        derivative_allowed INTEGER DEFAULT 1,
        commercial_allowed INTEGER DEFAULT 0,
        attribution_required INTEGER DEFAULT 1,
        scope TEXT DEFAULT 'local',
        license TEXT DEFAULT 'standard',
        expiration TEXT,
        transferable INTEGER DEFAULT 1,
        max_derivatives INTEGER DEFAULT -1,
        derivative_count INTEGER DEFAULT 0,
        revoked_users_json TEXT DEFAULT '[]',
        granted_users_json TEXT DEFAULT '[]',
        transfer_history_json TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rights_dtu ON dtu_rights(dtu_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rights_creator ON dtu_rights(creator_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rights_owner ON dtu_rights(owner_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rights_scope ON dtu_rights(scope)`);
    return true;
  } catch (e) {
    console.error("[DTURights] Failed to initialize table:", e.message);
    return false;
  }
}

/**
 * Create the rights management system.
 *
 * @param {import("better-sqlite3").Database} db - SQLite database
 * @param {object} [opts]
 * @param {function} [opts.log] - Structured logger function
 * @returns {object} Rights manager API
 */
export function createRightsManager(db, opts = {}) {
  const log = opts.log || (() => {});
  let _stmts = null;

  function stmts() {
    if (_stmts) return _stmts;
    if (!db) return null;
    try {
      _stmts = {
        get: db.prepare("SELECT * FROM dtu_rights WHERE dtu_id = ?"),
        getById: db.prepare("SELECT * FROM dtu_rights WHERE id = ?"),
        insert: db.prepare(`
          INSERT INTO dtu_rights
            (id, dtu_id, creator_id, owner_id, derivative_allowed, commercial_allowed,
             attribution_required, scope, license, expiration, transferable,
             max_derivatives, derivative_count, revoked_users_json, granted_users_json,
             transfer_history_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        update: db.prepare(`
          UPDATE dtu_rights SET
            derivative_allowed = ?, commercial_allowed = ?,
            attribution_required = ?, scope = ?, license = ?,
            expiration = ?, transferable = ?,
            max_derivatives = ?, updated_at = ?
          WHERE dtu_id = ?
        `),
        updateOwner: db.prepare(
          "UPDATE dtu_rights SET owner_id = ?, transfer_history_json = ?, updated_at = ? WHERE dtu_id = ?"
        ),
        updateDerivativeCount: db.prepare(
          "UPDATE dtu_rights SET derivative_count = derivative_count + 1, updated_at = ? WHERE dtu_id = ?"
        ),
        updateRevoked: db.prepare(
          "UPDATE dtu_rights SET revoked_users_json = ?, updated_at = ? WHERE dtu_id = ?"
        ),
        updateGranted: db.prepare(
          "UPDATE dtu_rights SET granted_users_json = ?, updated_at = ? WHERE dtu_id = ?"
        ),
        delete: db.prepare("DELETE FROM dtu_rights WHERE dtu_id = ?"),
        byCreator: db.prepare("SELECT * FROM dtu_rights WHERE creator_id = ?"),
        byOwner: db.prepare("SELECT * FROM dtu_rights WHERE owner_id = ?"),
        count: db.prepare("SELECT COUNT(*) as count FROM dtu_rights"),
      };
      return _stmts;
    } catch (e) {
      log("error", "rights_prepare_failed", { error: e.message });
      return null;
    }
  }

  /**
   * Convert a database row to a rights object.
   * @param {object} row
   * @returns {object}
   */
  function rowToRights(row) {
    if (!row) return null;
    return {
      id: row.id,
      dtuId: row.dtu_id,
      creatorId: row.creator_id,
      ownerId: row.owner_id,
      derivativeAllowed: !!row.derivative_allowed,
      commercialAllowed: !!row.commercial_allowed,
      attributionRequired: !!row.attribution_required,
      scope: row.scope,
      license: row.license,
      expiration: row.expiration,
      transferable: !!row.transferable,
      maxDerivatives: row.max_derivatives,
      derivativeCount: row.derivative_count,
      revokedUsers: JSON.parse(row.revoked_users_json || "[]"),
      grantedUsers: JSON.parse(row.granted_users_json || "[]"),
      transferHistory: JSON.parse(row.transfer_history_json || "[]"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  const manager = {
    /**
     * Assign rights to a DTU. Creates or updates the rights record.
     *
     * @param {string} dtuId - DTU ID
     * @param {object} rights - Rights declaration
     * @param {string} rights.creatorId - Creator's user ID
     * @param {string} [rights.ownerId] - Owner's user ID (defaults to creator)
     * @param {boolean} [rights.derivativeAllowed] - Can others create derivatives?
     * @param {boolean} [rights.commercialAllowed] - Can content be sold?
     * @param {boolean} [rights.attributionRequired] - Must derivatives attribute the creator?
     * @param {string} [rights.scope] - 'local', 'global', or 'marketplace'
     * @param {string} [rights.license] - License type name
     * @param {string} [rights.expiration] - ISO date string for access expiration
     * @param {boolean} [rights.transferable] - Can ownership be transferred?
     * @param {number} [rights.maxDerivatives] - Max number of derivatives (-1 = unlimited)
     * @returns {object} Created/updated rights
     */
    assignRights(dtuId, rights) {
      if (!dtuId) return { ok: false, error: "missing_dtu_id" };
      if (!rights.creatorId) return { ok: false, error: "missing_creator_id" };

      const s = stmts();
      if (!s) return { ok: false, error: "no_database" };

      // Apply license defaults if specified
      const licenseType = rights.license || "standard";
      const licenseDefaults = LICENSE_TYPES[licenseType] || LICENSE_TYPES.standard;

      const derivativeAllowed = rights.derivativeAllowed !== undefined
        ? rights.derivativeAllowed : licenseDefaults.derivativeAllowed;
      const commercialAllowed = rights.commercialAllowed !== undefined
        ? rights.commercialAllowed : licenseDefaults.commercialAllowed;
      const attributionRequired = rights.attributionRequired !== undefined
        ? rights.attributionRequired : licenseDefaults.attributionRequired;
      const transferable = rights.transferable !== undefined
        ? rights.transferable : licenseDefaults.transferable;

      const scope = VALID_SCOPES.has(rights.scope) ? rights.scope : "local";

      try {
        // Check if rights already exist
        const existing = s.get.get(dtuId);

        if (existing) {
          // Update existing rights
          s.update.run(
            derivativeAllowed ? 1 : 0,
            commercialAllowed ? 1 : 0,
            attributionRequired ? 1 : 0,
            scope,
            licenseType,
            rights.expiration || existing.expiration,
            transferable ? 1 : 0,
            rights.maxDerivatives !== undefined ? rights.maxDerivatives : existing.max_derivatives,
            nowISO(),
            dtuId
          );

          log("info", "rights_updated", { dtuId, license: licenseType });
          return { ok: true, rights: rowToRights(s.get.get(dtuId)) };
        }

        // Create new rights
        const id = uid("rgt");
        const now = nowISO();

        s.insert.run(
          id,
          dtuId,
          rights.creatorId,
          rights.ownerId || rights.creatorId,
          derivativeAllowed ? 1 : 0,
          commercialAllowed ? 1 : 0,
          attributionRequired ? 1 : 0,
          scope,
          licenseType,
          rights.expiration || null,
          transferable ? 1 : 0,
          rights.maxDerivatives !== undefined ? rights.maxDerivatives : -1,
          0, // derivative_count
          "[]", // revoked_users_json
          "[]", // granted_users_json
          "[]", // transfer_history_json
          now,
          now
        );

        log("info", "rights_assigned", { dtuId, id, license: licenseType, creatorId: rights.creatorId });
        return { ok: true, rights: rowToRights(s.get.get(dtuId)) };
      } catch (e) {
        log("error", "rights_assign_failed", { dtuId, error: e.message });
        return { ok: false, error: e.message };
      }
    },

    /**
     * Check if a user can perform a specific action on a DTU.
     *
     * @param {string} dtuId - DTU ID
     * @param {string} userId - User ID requesting the action
     * @param {string} action - Action to check (read, write, delete, derive, sell, transfer, etc.)
     * @returns {{ allowed: boolean, reason: string }}
     */
    checkPermission(dtuId, userId, action) {
      if (!VALID_ACTIONS.has(action)) {
        return { allowed: false, reason: `Unknown action: ${action}` };
      }

      const s = stmts();
      if (!s) return { allowed: true, reason: "No database — defaulting to allow" };

      try {
        const row = s.get.get(dtuId);
        if (!row) {
          // No rights record means unrestricted
          return { allowed: true, reason: "No rights record — unrestricted" };
        }

        const rights = rowToRights(row);

        // Check if user is revoked
        if (rights.revokedUsers.includes(userId)) {
          return { allowed: false, reason: "Access revoked for this user" };
        }

        // Check expiration
        if (rights.expiration && new Date(rights.expiration) < new Date()) {
          return { allowed: false, reason: "Rights have expired" };
        }

        // Creator always has full access
        if (userId === rights.creatorId) {
          return { allowed: true, reason: "Creator has full access" };
        }

        // Owner has most access
        if (userId === rights.ownerId) {
          if (action === "delete") {
            return { allowed: true, reason: "Owner can delete" };
          }
          return { allowed: true, reason: "Owner has access" };
        }

        // Action-specific checks
        switch (action) {
          case "read":
            // Read is generally allowed unless scope restricts
            if (rights.scope === "local" && !rights.grantedUsers.includes(userId)) {
              return { allowed: false, reason: "Local scope — not in granted users" };
            }
            return { allowed: true, reason: "Read access granted" };

          case "write":
            return { allowed: false, reason: "Only creator or owner can write" };

          case "delete":
            return { allowed: false, reason: "Only creator or owner can delete" };

          case "promote":
            return { allowed: false, reason: "Only creator or owner can promote" };

          case "derive":
            if (!rights.derivativeAllowed) {
              return { allowed: false, reason: "Derivatives not allowed" };
            }
            if (rights.maxDerivatives >= 0 && rights.derivativeCount >= rights.maxDerivatives) {
              return { allowed: false, reason: `Max derivatives reached (${rights.maxDerivatives})` };
            }
            return { allowed: true, reason: "Derivative access granted" };

          case "sell":
          case "list_marketplace":
            if (!rights.commercialAllowed) {
              return { allowed: false, reason: "Commercial use not allowed" };
            }
            if (userId !== rights.ownerId) {
              return { allowed: false, reason: "Only owner can sell" };
            }
            return { allowed: true, reason: "Commercial use allowed" };

          case "transfer":
            if (!rights.transferable) {
              return { allowed: false, reason: "Transfer not allowed" };
            }
            if (userId !== rights.ownerId) {
              return { allowed: false, reason: "Only owner can transfer" };
            }
            return { allowed: true, reason: "Transfer allowed" };

          case "share":
            if (rights.scope === "local" && !rights.grantedUsers.includes(userId)) {
              return { allowed: false, reason: "Local scope — cannot share" };
            }
            return { allowed: true, reason: "Share allowed" };

          case "export":
            return { allowed: true, reason: "Export allowed" };

          default:
            return { allowed: false, reason: `Unknown action: ${action}` };
        }
      } catch (e) {
        log("error", "rights_check_failed", { dtuId, userId, action, error: e.message });
        return { allowed: false, reason: `Error checking permissions: ${e.message}` };
      }
    },

    /**
     * Transfer ownership of a DTU from one user to another.
     *
     * @param {string} dtuId - DTU ID
     * @param {string} fromUserId - Current owner
     * @param {string} toUserId - New owner
     * @returns {object} Transfer result
     */
    transferOwnership(dtuId, fromUserId, toUserId) {
      const s = stmts();
      if (!s) return { ok: false, error: "no_database" };

      try {
        const row = s.get.get(dtuId);
        if (!row) return { ok: false, error: "No rights record found" };

        const rights = rowToRights(row);

        // Only current owner can transfer
        if (rights.ownerId !== fromUserId) {
          return { ok: false, error: "Only the current owner can transfer" };
        }

        // Check if transferable
        if (!rights.transferable) {
          return { ok: false, error: "This DTU is not transferable" };
        }

        // Check expiration
        if (rights.expiration && new Date(rights.expiration) < new Date()) {
          return { ok: false, error: "Rights have expired" };
        }

        // Record transfer in history
        const transferHistory = rights.transferHistory || [];
        transferHistory.push({
          from: fromUserId,
          to: toUserId,
          timestamp: nowISO(),
        });

        const now = nowISO();
        s.updateOwner.run(toUserId, JSON.stringify(transferHistory), now, dtuId);

        log("info", "rights_ownership_transferred", { dtuId, from: fromUserId, to: toUserId });

        return {
          ok: true,
          dtuId,
          previousOwner: fromUserId,
          newOwner: toUserId,
          transferredAt: now,
        };
      } catch (e) {
        log("error", "rights_transfer_failed", { dtuId, error: e.message });
        return { ok: false, error: e.message };
      }
    },

    /**
     * Grant derivative rights on a DTU with specific terms.
     *
     * @param {string} dtuId - DTU ID
     * @param {object} terms - Derivative terms
     * @param {string} [terms.grantedTo] - User being granted rights (or 'all')
     * @param {number} [terms.maxDerivatives] - Max derivatives allowed
     * @param {boolean} [terms.commercialDerivatives] - Can derivatives be sold?
     * @returns {object} Grant result
     */
    grantDerivativeRights(dtuId, terms = {}) {
      const s = stmts();
      if (!s) return { ok: false, error: "no_database" };

      try {
        const row = s.get.get(dtuId);
        if (!row) return { ok: false, error: "No rights record found" };

        const now = nowISO();

        // Enable derivatives if not already
        const updates = {
          derivativeAllowed: 1,
          commercialAllowed: terms.commercialDerivatives ? 1 : row.commercial_allowed,
          attributionRequired: row.attribution_required,
          scope: row.scope,
          license: row.license,
          expiration: row.expiration,
          transferable: row.transferable,
          maxDerivatives: terms.maxDerivatives !== undefined ? terms.maxDerivatives : row.max_derivatives,
        };

        s.update.run(
          updates.derivativeAllowed,
          updates.commercialAllowed,
          updates.attributionRequired,
          updates.scope,
          updates.license,
          updates.expiration,
          updates.transferable,
          updates.maxDerivatives,
          now,
          dtuId
        );

        // If granting to a specific user, add them to granted list
        if (terms.grantedTo && terms.grantedTo !== "all") {
          const granted = JSON.parse(row.granted_users_json || "[]");
          if (!granted.includes(terms.grantedTo)) {
            granted.push(terms.grantedTo);
            s.updateGranted.run(JSON.stringify(granted), now, dtuId);
          }
        }

        // Increment derivative count on the source
        s.updateDerivativeCount.run(now, dtuId);

        log("info", "derivative_rights_granted", { dtuId, terms });

        return {
          ok: true,
          dtuId,
          derivativeAllowed: true,
          maxDerivatives: updates.maxDerivatives,
          grantedTo: terms.grantedTo || "all",
        };
      } catch (e) {
        log("error", "derivative_grant_failed", { dtuId, error: e.message });
        return { ok: false, error: e.message };
      }
    },

    /**
     * Check if content can be used commercially.
     *
     * @param {string} dtuId - DTU ID
     * @returns {{ allowed: boolean, license: string, reason: string }}
     */
    checkCommercialRights(dtuId) {
      const s = stmts();
      if (!s) return { allowed: false, license: "unknown", reason: "No database" };

      try {
        const row = s.get.get(dtuId);
        if (!row) return { allowed: true, license: "none", reason: "No rights record — unrestricted" };

        const rights = rowToRights(row);

        if (rights.expiration && new Date(rights.expiration) < new Date()) {
          return { allowed: false, license: rights.license, reason: "Rights expired" };
        }

        return {
          allowed: rights.commercialAllowed,
          license: rights.license,
          ownerId: rights.ownerId,
          reason: rights.commercialAllowed
            ? "Commercial use allowed"
            : "Commercial use not allowed under current license",
        };
      } catch (e) {
        return { allowed: false, license: "error", reason: e.message };
      }
    },

    /**
     * Get a comprehensive rights report for a DTU.
     *
     * @param {string} dtuId - DTU ID
     * @returns {object} Full rights report
     */
    getRightsReport(dtuId) {
      const s = stmts();
      if (!s) return { ok: false, error: "no_database" };

      try {
        const row = s.get.get(dtuId);
        if (!row) {
          return {
            ok: true,
            dtuId,
            hasRights: false,
            report: null,
          };
        }

        const rights = rowToRights(row);
        const licenseInfo = LICENSE_TYPES[rights.license] || null;
        const isExpired = rights.expiration && new Date(rights.expiration) < new Date();

        return {
          ok: true,
          dtuId,
          hasRights: true,
          report: {
            ...rights,
            licenseInfo,
            isExpired,
            derivativesRemaining: rights.maxDerivatives < 0
              ? "unlimited"
              : Math.max(0, rights.maxDerivatives - rights.derivativeCount),
          },
        };
      } catch (e) {
        log("error", "rights_report_failed", { dtuId, error: e.message });
        return { ok: false, error: e.message };
      }
    },

    /**
     * Enforce attribution chain — ensure a derivative properly attributes its source.
     *
     * @param {string} derivativeDtuId - The derivative DTU ID
     * @param {string} [sourceDtuId] - The source DTU ID (looked up if not provided)
     * @returns {object} Attribution enforcement result
     */
    enforceAttribution(derivativeDtuId, sourceDtuId) {
      const s = stmts();
      if (!s) return { ok: false, error: "no_database" };

      try {
        // Get derivative's rights
        const derivRow = s.get.get(derivativeDtuId);
        if (!derivRow) {
          return { ok: true, attributionRequired: false, reason: "No rights record for derivative" };
        }

        // If a source is specified, check its attribution requirements
        if (sourceDtuId) {
          const sourceRow = s.get.get(sourceDtuId);
          if (sourceRow && sourceRow.attribution_required) {
            const sourceRights = rowToRights(sourceRow);
            return {
              ok: true,
              attributionRequired: true,
              sourceCreatorId: sourceRights.creatorId,
              sourceDtuId,
              derivativeDtuId,
              message: `Attribution to creator ${sourceRights.creatorId} is required`,
            };
          }
        }

        return {
          ok: true,
          attributionRequired: false,
          reason: "No attribution requirement found",
        };
      } catch (e) {
        log("error", "attribution_enforce_failed", { derivativeDtuId, error: e.message });
        return { ok: false, error: e.message };
      }
    },

    /**
     * Revoke a specific user's access to a DTU.
     *
     * @param {string} dtuId - DTU ID
     * @param {string} userId - User to revoke
     * @returns {object} Revocation result
     */
    revokeAccess(dtuId, userId) {
      const s = stmts();
      if (!s) return { ok: false, error: "no_database" };

      try {
        const row = s.get.get(dtuId);
        if (!row) return { ok: false, error: "No rights record found" };

        const rights = rowToRights(row);

        // Cannot revoke creator
        if (userId === rights.creatorId) {
          return { ok: false, error: "Cannot revoke creator's access" };
        }

        // Add to revoked list
        const revoked = rights.revokedUsers;
        if (!revoked.includes(userId)) {
          revoked.push(userId);
          s.updateRevoked.run(JSON.stringify(revoked), nowISO(), dtuId);
        }

        // Remove from granted list if present
        const granted = rights.grantedUsers.filter(u => u !== userId);
        s.updateGranted.run(JSON.stringify(granted), nowISO(), dtuId);

        log("info", "rights_revoked", { dtuId, userId });

        return { ok: true, dtuId, revokedUserId: userId };
      } catch (e) {
        log("error", "rights_revoke_failed", { dtuId, userId, error: e.message });
        return { ok: false, error: e.message };
      }
    },

    /**
     * Delete rights record for a DTU.
     *
     * @param {string} dtuId
     * @returns {boolean}
     */
    deleteRights(dtuId) {
      const s = stmts();
      if (!s) return false;
      try {
        const result = s.delete.run(dtuId);
        return result.changes > 0;
      } catch (e) {
        log("error", "rights_delete_failed", { dtuId, error: e.message });
        return false;
      }
    },

    /**
     * Get rights for a DTU (raw lookup).
     *
     * @param {string} dtuId
     * @returns {object|null}
     */
    getRights(dtuId) {
      const s = stmts();
      if (!s) return null;
      try {
        const row = s.get.get(dtuId);
        return rowToRights(row);
      } catch {
        return null;
      }
    },

    // Expose license types for API consumers
    LICENSE_TYPES,
    VALID_ACTIONS,
  };

  return manager;
}
