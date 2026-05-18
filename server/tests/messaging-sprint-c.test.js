// server/tests/messaging-sprint-c.test.js
//
// Tier-2 contract tests for Sprint C: huddles + cite_dtu + channel
// agent + adapters. Real DB + audio_rooms substrate; stubbed LLM
// for the agent.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerMessagingHuddleMacros from "../domains/messaging-huddle.js";
import registerMessagingCiteMacros from "../domains/messaging-cite.js";
import registerMessagingAgentMacros from "../domains/messaging-agent.js";
import registerMessagingAdaptersMacros from "../domains/messaging-adapters.js";
import registerMessagingConversationsMacros from "../domains/messaging-conversations.js";
import { runChannelAgentStep } from "../lib/messaging/channel-agent.js";

let db; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  // Whitelist needed tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT,
      creator_id TEXT, meta_json TEXT, skill_level INTEGER DEFAULT 1,
      total_experience INTEGER DEFAULT 0, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS royalty_lineage (
      id TEXT PRIMARY KEY, child_id TEXT NOT NULL, parent_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1, creator_id TEXT,
      parent_creator TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS user_consent (
      user_id TEXT NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER, PRIMARY KEY (user_id, key)
    );
  `);
  const m209 = await import("../migrations/209_messaging_substrate.js"); m209.up(db);
  const m200 = await import("../migrations/200_audio_rooms.js");
  if (typeof m200.up === "function") m200.up(db); else if (typeof m200.default === "function") m200.default(db);
  const m171 = await import("../migrations/171_agent_marathon_sessions.js");
  if (typeof m171.up === "function") m171.up(db); else if (typeof m171.default === "function") m171.default(db);
  registerMessagingHuddleMacros((_d, n, h) => macros.set(n, h));
  registerMessagingCiteMacros((_d, n, h) => macros.set(n, h));
  registerMessagingAgentMacros((_d, n, h) => macros.set(n, h));
  registerMessagingAdaptersMacros((_d, n, h) => macros.set(n, h));
  registerMessagingConversationsMacros((_d, n, h) => macros.set(n, h));
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("huddles", () => {
  let cid; let roomId;
  before(async () => {
    const c = await macros.get("convo_create")({ db, actor: { userId: "u_a" } }, { kind: "channel", title: "huddle-ch" });
    cid = c.id;
    await macros.get("convo_add_participant")({ db, actor: { userId: "u_a" } }, { conversationId: cid, userId: "u_listener", role: "member" });
  });
  it("member starts a huddle, room id is prefixed", async () => {
    const r = await macros.get("huddle_start")({ db, actor: { userId: "u_a" } }, { conversationId: cid });
    assert.equal(r.ok, true);
    assert.ok(r.roomId.startsWith(`messaging:${cid}:`));
    roomId = r.roomId;
  });
  it("non-member is forbidden", async () => {
    const r = await macros.get("huddle_start")({ db, actor: { userId: "u_outsider" } }, { conversationId: cid });
    assert.equal(r.reason, "forbidden");
  });
  it("huddle_list scoped to conversation", async () => {
    const r = await macros.get("huddle_list")({ db }, { conversationId: cid });
    assert.equal(r.ok, true);
    assert.ok(r.huddles.find((h) => h.id === roomId));
  });
  it("join + leave + end round-trip", async () => {
    const j = await macros.get("huddle_join")({ db, actor: { userId: "u_listener" } }, { roomId });
    assert.equal(j.ok, true);
    const l = await macros.get("huddle_leave")({ db, actor: { userId: "u_listener" } }, { roomId });
    assert.equal(l.ok, true);
    const e = await macros.get("huddle_end")({ db, actor: { userId: "u_a" } }, { roomId });
    assert.equal(e.ok, true);
  });
});

describe("cite_dtu_in_message", () => {
  let cid;
  before(async () => {
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at) VALUES (?, 'chord_progression', ?, ?, ?, unixepoch())`)
      .run("dtu:cp:cite-test", "C-G-Am-F", "u_studio", JSON.stringify({ visibility: "public", consent: { allowCitations: true } }));
    const c = await macros.get("convo_create")({ db, actor: { userId: "u_alice" } }, { kind: "channel", title: "cite-ch" });
    cid = c.id;
  });
  it("rejects unknown DTU", async () => {
    const r = await macros.get("cite_dtu_in_message")({ db, actor: { userId: "u_alice" } }, { conversationId: cid, dtuId: "dtu:nope" });
    assert.equal(r.reason, "dtu_not_found");
  });
  it("cite_dtu cross-user public → fires cascade", async () => {
    const r = await macros.get("cite_dtu_in_message")({ db, actor: { userId: "u_alice" } }, {
      conversationId: cid, dtuId: "dtu:cp:cite-test", body: "love this progression",
    });
    assert.equal(r.ok, true);
    assert.equal(r.cascadeRegistered, true);
    const lin = db.prepare(`SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?`).get(r.messageId, "dtu:cp:cite-test");
    assert.ok(lin);
    const msg = db.prepare(`SELECT body, body_kind, attachments_json FROM messages WHERE id = ?`).get(r.messageId);
    assert.equal(msg.body_kind, "dtu_embed");
    assert.equal(msg.body, "love this progression");
    assert.ok(msg.attachments_json.includes("dtu:cp:cite-test"));
  });
  it("same-author cite skips cascade", async () => {
    // Author of the DTU cites their own DTU in their own channel.
    const cSelf = await macros.get("convo_create")({ db, actor: { userId: "u_studio" } }, { kind: "channel", title: "self-cite" });
    const r = await macros.get("cite_dtu_in_message")({ db, actor: { userId: "u_studio" } }, {
      conversationId: cSelf.id, dtuId: "dtu:cp:cite-test",
    });
    assert.equal(r.ok, true);
    assert.equal(r.cascadeRegistered, false);
    assert.equal(r.sameAuthor, true);
  });
});

describe("channel agent", () => {
  let cid; let sessionId;
  before(async () => {
    const c = await macros.get("convo_create")({ db, actor: { userId: "u_a" } }, { kind: "channel", title: "agent-ch" });
    cid = c.id;
  });
  it("agent_start inserts a row + meta tagged 'channel_agent_session'", async () => {
    const r = await macros.get("agent_start")({ db, actor: { userId: "u_a" } }, {
      conversationId: cid, task: "summarise overnight chatter", maxSteps: 3,
    });
    assert.equal(r.ok, true);
    sessionId = r.sessionId;
    const row = db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
    assert.ok(row.meta_json.includes('"kind":"channel_agent_session"'));
  });
  it("agent_status returns session", async () => {
    const r = await macros.get("agent_status")({ db }, { sessionId });
    assert.equal(r.ok, true);
    assert.equal(r.session.id, sessionId);
  });
  it("agent_list scopes by conversationId", async () => {
    const r = await macros.get("agent_list")({ db, actor: { userId: "u_a" } }, { conversationId: cid });
    assert.ok(r.sessions.find((s) => s.id === sessionId));
  });
  it("runChannelAgentStep post_message lands real message", async () => {
    const ctx = {
      db, actor: { userId: "u_a" },
      llm: { chat: async () => ({ text: JSON.stringify({ tool: "post_message", args: { body: "hi from agent" } }) }) },
    };
    const step = await runChannelAgentStep({ ctx, conversationId: cid, task: "say hi", sessionId, history: [] });
    assert.equal(step.ok, true);
    assert.equal(step.toolCalled, "post_message");
    const recent = db.prepare(`SELECT body FROM messages WHERE conversation_id = ? ORDER BY server_ts DESC LIMIT 1`).get(cid);
    assert.equal(recent.body, "hi from agent");
  });
  it("runChannelAgentStep done → step.done=true", async () => {
    const ctx = {
      db, actor: { userId: "u_a" },
      llm: { chat: async () => ({ text: JSON.stringify({ tool: "done", args: { reason: "ok" } }) }) },
    };
    const step = await runChannelAgentStep({ ctx, conversationId: cid, task: "x", sessionId, history: [] });
    assert.equal(step.done, true);
  });
  it("no-LLM fallback posts an agent-fallback sticky", async () => {
    const step = await runChannelAgentStep({
      ctx: { db, actor: { userId: "u_a" } },
      conversationId: cid, task: "x", sessionId, history: [],
    });
    assert.equal(step.ok, true);
    assert.equal(step.toolCalled, "post_message");
  });
  it("agent_cancel marks abandoned", async () => {
    const r = await macros.get("agent_cancel")({ db, actor: { userId: "u_a" } }, { sessionId });
    assert.equal(r.ok, true);
  });
  it("agent_publish mints kind='agent_spec' DTU", async () => {
    // Start fresh session to publish
    const fresh = await macros.get("agent_start")({ db, actor: { userId: "u_a" } }, {
      conversationId: cid, task: "publishable agent",
    });
    const pub = await macros.get("agent_publish")({ db, actor: { userId: "u_a" } }, { sessionId: fresh.sessionId, priceCents: 250, license: "MIT" });
    assert.equal(pub.ok, true);
    assert.ok(pub.agentSpecDtuId.startsWith("agent_spec:"));
    const row = db.prepare(`SELECT kind FROM dtus WHERE id = ?`).get(pub.agentSpecDtuId);
    assert.equal(row.kind, "agent_spec");
  });
});

describe("external adapters", () => {
  it("adapter_list reports all 6 with env_enabled + configured flags", async () => {
    const r = await macros.get("adapter_list")({});
    assert.equal(r.ok, true);
    const platforms = r.adapters.map((a) => a.platform).sort();
    assert.deepEqual(platforms, ["discord", "imessage", "signal", "slack", "telegram", "whatsapp"]);
    // Each adapter has the capability shape
    for (const a of r.adapters) {
      assert.equal(typeof a.env_enabled, "boolean");
      assert.equal(typeof a.configured, "boolean");
      assert.equal(typeof a.capabilities.send, "boolean");
      assert.equal(typeof a.capabilities.receive, "boolean");
    }
  });
  it("adapter_status rejects unknown", async () => {
    const r = await macros.get("adapter_status")({}, { platform: "myspace" });
    assert.equal(r.reason, "unknown_platform");
  });
  it("adapter_send rejects when env not enabled", async () => {
    const r = await macros.get("adapter_send")({ db, actor: { userId: "u_a" } }, {
      platform: "slack", channel: "#general", text: "hi",
    });
    assert.equal(r.reason, "adapter_disabled");
  });
  it("adapter_inbound creates a kind='external' conversation + posts msg", async () => {
    const r = await macros.get("adapter_inbound")({ db }, {
      platform: "slack", channelId: "C12345", author: "U_external", body: "hello from slack",
    });
    assert.equal(r.ok, true);
    assert.equal(r.conversationId, "external:slack:C12345");
    const conv = db.prepare(`SELECT kind, external_source FROM conversations WHERE id = ?`).get(r.conversationId);
    assert.equal(conv.kind, "external");
    assert.equal(conv.external_source, "slack");
    const msg = db.prepare(`SELECT body, author_id FROM messages WHERE id = ?`).get(r.messageId);
    assert.equal(msg.body, "hello from slack");
    assert.equal(msg.author_id, "external:slack:U_external");
  });
});
