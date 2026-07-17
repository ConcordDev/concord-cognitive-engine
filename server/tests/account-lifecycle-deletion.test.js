// server/tests/account-lifecycle-deletion.test.js
//
// Functional (not structural) test for the REAL account-deletion pipeline —
// server/lib/account-lifecycle.js#executeAccountDeletion /
// #requestAccountDeletion. Per docs/PRIVACY_DSAR_DELETION_INVESTIGATION.md,
// this pipeline had a confirmed silently-failing bug (Finding 3: the
// "delete social content" step referenced a compound WHERE clause against
// columns/tables that don't exist, so it threw on every call and the error
// was swallowed) and several undocumented coverage gaps (Finding 5), with
// ZERO functional test coverage (Finding 6) — only static regex scans that
// assert the string "account.*delete" appears somewhere in server.js.
//
// This test builds a real in-memory better-sqlite3 DB with the exact table
// shapes from the live migrations (same hand-rolled-schema pattern as
// tests/economy/ledger-conservation.test.js — this file's own money-safety
// sibling), seeds a TARGET user's data in every table the pipeline touches
// PLUS a CONTROL user's data in the same tables, runs the real deletion
// function, and asserts:
//
//   1. Every HARD-DELETE category is actually gone for the target user.
//   2. Every ANONYMIZE category has its identifying columns replaced with
//      the deletion tombstone, with content/lineage preserved (not erased).
//   3. Cited DTUs (royalty_lineage-linked) are anonymized, NOT hard-deleted
//      — the DTU-tombstone invariant.
//   4. The CONTROL user's rows in every single one of these tables survive
//      completely untouched — no over-deletion, no cross-user bleed.
//   5. requestAccountDeletion's 90-day balance-forfeit path is UNCHANGED:
//      a user with a positive balance gets SCHEDULED, not immediately
//      deleted, and a pending withdrawal blocks deletion outright.
//
// Run: node --test server/tests/account-lifecycle-deletion.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  executeAccountDeletion,
  requestAccountDeletion,
} from "../lib/account-lifecycle.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL, last_login_at TEXT, is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, owner_user_id TEXT, title TEXT NOT NULL DEFAULT 'Untitled',
      body_json TEXT NOT NULL DEFAULT '{}', tags_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'private', tier TEXT NOT NULL DEFAULT 'regular',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE royalty_lineage (
      id TEXT PRIMARY KEY, child_id TEXT NOT NULL, parent_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1, creator_id TEXT NOT NULL, parent_creator TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE anonymized_attributions (
      id TEXT PRIMARY KEY, dtu_id TEXT NOT NULL UNIQUE, original_user_id TEXT NOT NULL,
      anonymous_wallet_id TEXT NOT NULL, anonymized_at TEXT NOT NULL DEFAULT (datetime('now')),
      reason TEXT DEFAULT 'consent_revoked'
    );

    -- Required by lib/consent.js#anonymizeAttribution's audit-trail insert
    -- (server/migrations/032_consent_layer.js) — the whole anonymize
    -- transaction rolls back if this table is missing.
    CREATE TABLE consent_audit_log (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, event TEXT NOT NULL,
      ip TEXT, user_agent TEXT, metadata_json TEXT DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE creative_artifacts (
      id TEXT PRIMARY KEY, creator_id TEXT NOT NULL,
      marketplace_status TEXT DEFAULT 'draft', updated_at TEXT
    );

    -- Real shape per server/migrations/315_missing_tables_repair.js
    CREATE TABLE social_posts (
      id TEXT PRIMARY KEY, user_id TEXT, author_id TEXT, content TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE direct_messages (
      id TEXT PRIMARY KEY, sender_id TEXT, recipient_id TEXT, content TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Real shape per server/migrations/026_oauth.js
    CREATE TABLE oauth_connections (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL, email TEXT, name TEXT, avatar_url TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    -- Real shape per server/migrations/331_connector_oauth_tokens.js
    CREATE TABLE connector_oauth_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, connector_id TEXT NOT NULL,
      access_token TEXT NOT NULL, refresh_token TEXT, token_type TEXT DEFAULT 'Bearer',
      expires_at INTEGER, scopes_json TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_refreshed_at INTEGER
    );

    -- Real shape per server/migrations/036_personal_locker.js
    CREATE TABLE personal_dtus (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      lens_domain TEXT, content_type TEXT NOT NULL, title TEXT,
      encrypted_content BLOB NOT NULL, iv BLOB NOT NULL, auth_tag BLOB NOT NULL
    );

    -- Real shape per server/migrations/193_chat_sessions.js
    CREATE TABLE chat_sessions (
      session_id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, last_lens TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, msg_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, ts INTEGER NOT NULL, meta_json TEXT
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip_address TEXT, user_agent TEXT,
      is_revoked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL, created_at TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE user_consent (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL,
      granted INTEGER, granted_at TEXT
    );

    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, from_user_id TEXT, to_user_id TEXT,
      amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0, net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete', metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE economy_withdrawals (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0,
      net REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE user_xp (
      user_id TEXT NOT NULL, federation_tier TEXT NOT NULL DEFAULT '', total_xp INTEGER DEFAULT 0
    );
    CREATE TABLE quest_completions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, quest_id TEXT NOT NULL
    );
    CREATE TABLE creative_xp (
      user_id TEXT NOT NULL, federation_tier TEXT NOT NULL DEFAULT '', total_xp INTEGER DEFAULT 0
    );
    CREATE TABLE leaderboard_entries (
      user_id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', score REAL DEFAULT 0
    );

    CREATE TABLE account_deletion_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'scheduled',
      balance_at_request REAL DEFAULT 0, forfeit_date TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
    );

    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL,
      user_id TEXT, details TEXT
    );
  `);
  return db;
}

// Seeds one row per table for the given userRole ("user_id"-equivalent
// column varies per table — matched to each table's real schema).
function seedUserData(db, userId, { asSenderTo, asRecipientFrom } = {}) {
  db.prepare("INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,?,datetime('now'))")
    .run(userId, `${userId}_uname`, `${userId}@example.com`, "hash");

  db.prepare("INSERT INTO dtus (id, owner_user_id, title) VALUES (?,?,?)").run(`${userId}_dtu_uncited`, userId, "uncited");
  db.prepare("INSERT INTO dtus (id, owner_user_id, title) VALUES (?,?,?)").run(`${userId}_dtu_cited`, userId, "cited");
  // Someone else's DTU cites userId's cited DTU as a parent.
  db.prepare("INSERT INTO royalty_lineage (id, child_id, parent_id, creator_id, parent_creator) VALUES (?,?,?,?,?)")
    .run(`${userId}_lineage`, "someone_elses_child_dtu", `${userId}_dtu_cited`, "other_creator", userId);

  db.prepare("INSERT INTO creative_artifacts (id, creator_id, marketplace_status) VALUES (?,?, 'active')").run(`${userId}_listing`, userId);

  db.prepare("INSERT INTO social_posts (id, user_id, content) VALUES (?,?,?)").run(`${userId}_post`, userId, "hello world");

  if (asSenderTo) {
    db.prepare("INSERT INTO direct_messages (id, sender_id, recipient_id, content) VALUES (?,?,?,?)")
      .run(`${userId}_dm_sent`, userId, asSenderTo, "hi there");
  }
  if (asRecipientFrom) {
    db.prepare("INSERT INTO direct_messages (id, sender_id, recipient_id, content) VALUES (?,?,?,?)")
      .run(`${userId}_dm_received`, asRecipientFrom, userId, "hi back");
  }

  db.prepare("INSERT INTO oauth_connections (id, user_id, provider, provider_user_id, created_at, updated_at) VALUES (?,?, 'google', ?, datetime('now'), datetime('now'))")
    .run(`${userId}_oauth`, userId, `${userId}_google_sub`);

  db.prepare("INSERT INTO connector_oauth_tokens (id, user_id, connector_id, access_token) VALUES (?,?, 'google_calendar', ?)")
    .run(`${userId}_connector`, userId, `tok_${userId}`);

  db.prepare("INSERT INTO personal_dtus (id, user_id, content_type, encrypted_content, iv, auth_tag) VALUES (?,?, 'journal', X'00', X'00', X'00')")
    .run(`${userId}_locker`, userId);

  db.prepare("INSERT INTO chat_sessions (session_id, owner_id, created_at, updated_at) VALUES (?,?, unixepoch(), unixepoch())")
    .run(`${userId}_chatsess`, userId);
  db.prepare("INSERT INTO chat_messages (session_id, role, content, ts) VALUES (?, 'user', ?, unixepoch())")
    .run(`${userId}_chatsess`, "remember this");

  db.prepare("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?,?,?, datetime('now'), datetime('now','+1 day'))")
    .run(`${userId}_sess`, userId, "th");

  db.prepare("INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, created_at) VALUES (?,?, 'k', 'h', 'p', datetime('now'))")
    .run(`${userId}_apikey`, userId);

  db.prepare("INSERT INTO user_consent (id, user_id, action, granted) VALUES (?,?, 'publish_to_marketplace', 1)").run(`${userId}_consent`, userId);

  // A ROYALTY_PAYOUT credit row (satisfies CREDIT_ROW_PREDICATE regardless of from/to shape).
  db.prepare("INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, net) VALUES (?, 'ROYALTY_PAYOUT', 'platform', ?, 10, 10)")
    .run(`${userId}_ledger`, userId);

  db.prepare("INSERT INTO user_xp (user_id, total_xp) VALUES (?, 100)").run(userId);
  db.prepare("INSERT INTO quest_completions (id, user_id, quest_id) VALUES (?,?, 'q1')").run(`${userId}_quest`, userId);
  db.prepare("INSERT INTO creative_xp (user_id, total_xp) VALUES (?, 50)").run(userId);
  db.prepare("INSERT INTO leaderboard_entries (user_id, score) VALUES (?, 999)").run(userId);
}

describe("executeAccountDeletion — real seed/delete/assert-survivors functional test", () => {
  let db;
  const TARGET = "target_user";
  const CONTROL = "control_user";

  beforeEach(() => {
    db = createDb();
    // Target and control message each other so the direct_messages anonymize
    // step's two-party behavior is actually exercised in both directions.
    seedUserData(db, TARGET, { asSenderTo: CONTROL, asRecipientFrom: CONTROL });
    seedUserData(db, CONTROL, { asSenderTo: TARGET, asRecipientFrom: TARGET });
  });

  it("returns ok:true with no unhandled step errors against the real schema", () => {
    const result = executeAccountDeletion(db, TARGET);
    assert.equal(result.ok, true);
    // Finding 3's bug manifested as swallowed errors on every social-content
    // step. With the fix, none of the steps this test seeds data for should
    // report an error.
    const badSteps = (result.errors || []).map((e) => e.step);
    assert.deepEqual(badSteps, [], `unexpected step errors: ${JSON.stringify(badSteps)}`);
  });

  it("HARD-DELETE categories: target's rows are gone", () => {
    executeAccountDeletion(db, TARGET);

    assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE id = ?").get(TARGET).c, 0, "users row must be gone");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM dtus WHERE id = ?").get(`${TARGET}_dtu_uncited`).c, 0, "uncited DTU must be gone");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM social_posts WHERE user_id = ?").get(TARGET).c, 0, "social_posts must be gone (Finding 3 fix)");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM oauth_connections WHERE user_id = ?").get(TARGET).c, 0, "oauth_connections must be gone (Finding 5 fix)");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM connector_oauth_tokens WHERE user_id = ?").get(TARGET).c, 0, "connector_oauth_tokens must be gone (Finding 5 fix)");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM personal_dtus WHERE user_id = ?").get(TARGET).c, 0, "personal_dtus must be gone (Finding 5 fix)");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM chat_sessions WHERE owner_id = ?").get(TARGET).c, 0, "chat_sessions must be gone (Finding 5 fix)");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE session_id = ?").get(`${TARGET}_chatsess`).c, 0, "chat_messages must be gone (Finding 5 fix, cascade is inert so must be explicit)");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM api_keys WHERE user_id = ?").get(TARGET).c, 0, "api_keys must be gone");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM user_consent WHERE user_id = ?").get(TARGET).c, 0, "user_consent must be gone");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM user_xp WHERE user_id = ?").get(TARGET).c, 0, "user_xp must be gone");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM quest_completions WHERE user_id = ?").get(TARGET).c, 0, "quest_completions must be gone");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM creative_xp WHERE user_id = ?").get(TARGET).c, 0, "creative_xp must be gone");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM leaderboard_entries WHERE user_id = ?").get(TARGET).c, 0, "leaderboard_entries must be gone");

    // Sessions are REVOKED, not row-deleted (existing, unchanged behavior).
    const sess = db.prepare("SELECT is_revoked FROM sessions WHERE user_id = ?").get(TARGET);
    assert.equal(sess.is_revoked, 1, "session must be revoked");
  });

  it("ANONYMIZE categories: direct_messages tombstone the deleted user in BOTH roles, preserving the counterparty's copy", () => {
    const result = executeAccountDeletion(db, TARGET);
    const tombstone = `deleted_${result.deletionId}`;

    // Message TARGET sent to CONTROL: sender anonymized, content + recipient survive.
    const sent = db.prepare("SELECT * FROM direct_messages WHERE id = ?").get(`${TARGET}_dm_sent`);
    assert.equal(sent.sender_id, tombstone, "sender_id must be tombstoned, not left as the deleted user's real id");
    assert.equal(sent.recipient_id, CONTROL, "recipient_id (control user) must be untouched");
    assert.equal(sent.content, "hi there", "message content must survive — this is the CONTROL user's inbox copy");

    // Message CONTROL sent to TARGET: recipient anonymized, content + sender survive.
    const received = db.prepare("SELECT * FROM direct_messages WHERE id = ?").get(`${TARGET}_dm_received`);
    assert.equal(received.recipient_id, tombstone, "recipient_id must be tombstoned");
    assert.equal(received.sender_id, CONTROL, "sender_id (control user, the author) must be untouched — their authored content is not the target's to delete");
    assert.equal(received.content, "hi back");

    // No direct_messages row was hard-deleted — row count for the whole table stays the same.
    const totalDms = db.prepare("SELECT COUNT(*) c FROM direct_messages").get().c;
    assert.equal(totalDms, 4, "no direct_messages row should have been hard-deleted (2 users x 2 messages each)");
  });

  it("ANONYMIZE: economy_ledger is tombstoned, not deleted (7-year retention, unchanged)", () => {
    const result = executeAccountDeletion(db, TARGET);
    const tombstone = `deleted_${result.deletionId}`;
    const row = db.prepare("SELECT * FROM economy_ledger WHERE id = ?").get(`${TARGET}_ledger`);
    assert.ok(row, "ledger row must still exist (retained for legal/tax purposes)");
    assert.equal(row.to_user_id, tombstone);
    assert.equal(row.amount, 10, "ledger amount must be preserved exactly (money invariant)");
  });

  it("DTU-tombstone invariant: a cited DTU is ANONYMIZED, never hard-deleted", () => {
    executeAccountDeletion(db, TARGET);
    const cited = db.prepare("SELECT * FROM dtus WHERE id = ?").get(`${TARGET}_dtu_cited`);
    assert.ok(cited, "cited DTU must still exist — hard-deleting it would break the citing DTU's lineage");
    assert.match(cited.metadata_json, /"anonymized":1/, "cited DTU must be flagged anonymized");
    const anon = db.prepare("SELECT * FROM anonymized_attributions WHERE dtu_id = ?").get(`${TARGET}_dtu_cited`);
    assert.ok(anon, "anonymized_attributions row must be written for the citation-lineage tombstone");
    const lineage = db.prepare("SELECT parent_creator FROM royalty_lineage WHERE parent_id = ?").get(`${TARGET}_dtu_cited`);
    assert.equal(lineage.parent_creator, anon.anonymous_wallet_id, "royalty routing must move to the anonymous wallet, not vanish");
  });

  it("marketplace listings are delisted, not deleted", () => {
    executeAccountDeletion(db, TARGET);
    const listing = db.prepare("SELECT * FROM creative_artifacts WHERE id = ?").get(`${TARGET}_listing`);
    assert.ok(listing, "listing row must still exist");
    assert.equal(listing.marketplace_status, "delisted");
  });

  it("audit_log + account_deletion_requests record the deletion", () => {
    db.prepare("INSERT INTO account_deletion_requests (id, user_id, status) VALUES (?,?, 'scheduled')").run("adr_1", TARGET);
    const result = executeAccountDeletion(db, TARGET);
    const audit = db.prepare("SELECT * FROM audit_log WHERE user_id = ?").get(`deleted_${result.deletionId}`);
    assert.ok(audit, "audit log entry must be written");
    assert.equal(audit.action, "account_deleted");
    const adr = db.prepare("SELECT status FROM account_deletion_requests WHERE user_id = ?").get(TARGET);
    assert.equal(adr.status, "completed");
  });

  it("CONTROL user's rows survive untouched in every table the pipeline writes to — no over-deletion", () => {
    executeAccountDeletion(db, TARGET);

    // Hard-delete categories: control's rows must all still be present.
    assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM dtus WHERE id = ?").get(`${CONTROL}_dtu_uncited`).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM social_posts WHERE user_id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM oauth_connections WHERE user_id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM connector_oauth_tokens WHERE user_id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM personal_dtus WHERE user_id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM chat_sessions WHERE owner_id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM chat_messages WHERE session_id = ?").get(`${CONTROL}_chatsess`).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM api_keys WHERE user_id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM user_consent WHERE user_id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM user_xp WHERE user_id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM quest_completions WHERE user_id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM creative_xp WHERE user_id = ?").get(CONTROL).c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM leaderboard_entries WHERE user_id = ?").get(CONTROL).c, 1);

    // Control's session must NOT be revoked by target's deletion.
    const controlSess = db.prepare("SELECT is_revoked FROM sessions WHERE user_id = ?").get(CONTROL);
    assert.equal(controlSess.is_revoked, 0, "control user's session must not be touched");

    // Anonymize categories: control's own ledger + DM rows keep their real ids.
    const controlLedger = db.prepare("SELECT to_user_id FROM economy_ledger WHERE id = ?").get(`${CONTROL}_ledger`);
    assert.equal(controlLedger.to_user_id, CONTROL);

    const controlSentDm = db.prepare("SELECT sender_id, recipient_id FROM direct_messages WHERE id = ?").get(`${CONTROL}_dm_sent`);
    assert.equal(controlSentDm.sender_id, CONTROL, "control's own sent message must keep control's real sender_id");
    // (recipient_id on control's outbound DM is TARGET — legitimately tombstoned since TARGET was deleted; that's covered above.)

    const controlListing = db.prepare("SELECT creator_id, marketplace_status FROM creative_artifacts WHERE id = ?").get(`${CONTROL}_listing`);
    assert.equal(controlListing.creator_id, CONTROL);
    assert.equal(controlListing.marketplace_status, "active", "control's own listing must NOT be delisted by target's deletion");

    // Control's cited DTU must remain fully attributed (not anonymized).
    const controlCited = db.prepare("SELECT metadata_json FROM dtus WHERE id = ?").get(`${CONTROL}_dtu_cited`);
    assert.ok(!controlCited.metadata_json || !controlCited.metadata_json.includes('"anonymized":1'), "control's cited DTU must not be anonymized by target's deletion");
  });
});

describe("requestAccountDeletion — 90-day balance-forfeit path is unchanged by this fix", () => {
  let db;
  const USER = "balance_user";

  beforeEach(() => {
    db = createDb();
    db.prepare("INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,?,datetime('now'))")
      .run(USER, "balu", "balu@example.com", "hash");
  });

  it("schedules deletion 90 days out when the user has a positive balance — does NOT delete immediately", () => {
    db.prepare("INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, net) VALUES ('l1', 'ROYALTY_PAYOUT', 'platform', ?, 100, 100)").run(USER);

    const result = requestAccountDeletion(db, USER);
    assert.equal(result.ok, true);
    assert.equal(result.scheduled, true);
    assert.equal(result.deletedImmediately, undefined, "must not be immediately deleted while a balance is outstanding");
    assert.equal(result.balance, 100);

    // User row must still exist — nothing was deleted.
    assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE id = ?").get(USER).c, 1);

    const forfeitDays = Math.round((new Date(result.forfeitDate).getTime() - Date.now()) / 86400000);
    assert.equal(forfeitDays, 90, "forfeit window must be exactly BALANCE_FORFEIT_DAYS=90 — a constitutional invariant, unchanged by this fix");

    const adr = db.prepare("SELECT * FROM account_deletion_requests WHERE user_id = ?").get(USER);
    assert.equal(adr.status, "scheduled");
    assert.equal(adr.balance_at_request, 100);
  });

  it("blocks deletion outright when a withdrawal is pending", () => {
    db.prepare("INSERT INTO economy_withdrawals (id, user_id, amount, net, status) VALUES ('w1', ?, 50, 49, 'pending')").run(USER);
    const result = requestAccountDeletion(db, USER);
    assert.equal(result.ok, false);
    assert.equal(result.error, "pending_withdrawals");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE id = ?").get(USER).c, 1, "user must not be deleted while a withdrawal is pending");
  });

  it("deletes immediately when balance is zero — and applies the same fixed pipeline", () => {
    const result = requestAccountDeletion(db, USER);
    assert.equal(result.ok, true);
    assert.equal(result.deletedImmediately, true);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE id = ?").get(USER).c, 0);
  });
});
