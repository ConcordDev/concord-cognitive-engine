// server/tests/unit/tools.test.js
// Unit tests for computer-use-tool.js and sandbox-manager.js.
// Uses Node.js built-in test runner (node:test + node:assert).

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// ─── Minimal in-memory SQLite-compatible DB stub ──────────────────────────────
// Provides a synchronous prepared-statement API that matches the subset of
// better-sqlite3 that sandbox-manager.js needs.

function createInMemoryDb() {
  const tables = {};

  function ensureTable(name) {
    if (!tables[name]) tables[name] = [];
  }

  function parseTableName(sql) {
    const m = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
    return m ? m[1] : null;
  }

  function prepare(sql) {
    const trimmed = sql.trim();

    return {
      run(...args) {
        if (/INSERT\s+INTO\s+sandbox_workspaces/i.test(trimmed)) {
          ensureTable("sandbox_workspaces");
          // columns: id, user_id, agent_id, thread_id, name, status='ready', sandbox_type, config_json, created_at, last_active_at
          const [id, user_id, agent_id, thread_id, name, sandbox_type, config_json, created_at, last_active_at] = args;
          tables.sandbox_workspaces.push({
            id, user_id, agent_id, thread_id, name,
            status: "ready", sandbox_type, config_json,
            created_at, last_active_at,
            terminated_at: null, entry_url: null,
          });
        } else if (/INSERT\s+INTO\s+sandbox_actions/i.test(trimmed)) {
          ensureTable("sandbox_actions");
          const [id, workspace_id, action_type, action_args_json, result_json, error, duration_ms, created_at] = args;
          tables.sandbox_actions = tables.sandbox_actions || [];
          tables.sandbox_actions.push({ id, workspace_id, action_type, action_args_json, result_json, error, duration_ms, created_at });
        } else if (/UPDATE\s+sandbox_workspaces.*SET\s+status\s*=\s*'terminated'/i.test(trimmed)) {
          // terminateSandbox: (now, now, sandboxId)
          const id = args[args.length - 1];
          const row = tables.sandbox_workspaces?.find(r => r.id === id);
          if (row) { row.status = "terminated"; row.terminated_at = args[0]; row.last_active_at = args[1]; }
        } else if (/UPDATE\s+sandbox_workspaces.*SET\s+status\s*=\s*'paused'/i.test(trimmed)) {
          const id = args[args.length - 1];
          const row = tables.sandbox_workspaces?.find(r => r.id === id);
          if (row) { row.status = "paused"; row.last_active_at = args[0]; }
        } else if (/UPDATE\s+sandbox_workspaces.*SET\s+status\s*=\s*'ready'/i.test(trimmed)) {
          const id = args[args.length - 1];
          const row = tables.sandbox_workspaces?.find(r => r.id === id);
          if (row) { row.status = "ready"; row.last_active_at = args[0]; }
        } else if (/DELETE\s+FROM\s+sandbox_workspaces/i.test(trimmed)) {
          const cutoff = args[0];
          if (tables.sandbox_workspaces) {
            tables.sandbox_workspaces = tables.sandbox_workspaces.filter(
              r => !(r.status === "terminated" && r.terminated_at < cutoff)
            );
          }
        }
        return { changes: 1 };
      },

      get(...args) {
        if (/SELECT\s+\*\s+FROM\s+sandbox_workspaces\s+WHERE\s+id\s*=/i.test(trimmed)) {
          ensureTable("sandbox_workspaces");
          const id = args[0];
          return tables.sandbox_workspaces.find(r => r.id === id) ?? undefined;
        }
        return undefined;
      },

      all(...args) {
        ensureTable("sandbox_workspaces");
        const [userId] = args;
        return tables.sandbox_workspaces.filter(r => r.user_id === userId && r.status !== "terminated");
      },
    };
  }

  function exec(sql) {
    const name = parseTableName(sql);
    if (name) ensureTable(name);
  }

  return { prepare, exec, _tables: tables };
}

// ─── computer-use-tool.js ─────────────────────────────────────────────────────

describe("computer-use-tool: COMPUTER_USE_TOOL_SCHEMA", () => {
  test("schema has required shape fields: name and type", async () => {
    const { COMPUTER_USE_TOOL_SCHEMA } = await import("../../lib/tools/computer-use-tool.js");
    assert.ok(COMPUTER_USE_TOOL_SCHEMA, "COMPUTER_USE_TOOL_SCHEMA should be exported");
    assert.equal(typeof COMPUTER_USE_TOOL_SCHEMA.name, "string", "schema.name should be a string");
    assert.equal(COMPUTER_USE_TOOL_SCHEMA.name, "computer_use", "schema.name should be 'computer_use'");
    assert.equal(COMPUTER_USE_TOOL_SCHEMA.inputSchema.type, "object", "inputSchema.type should be 'object'");
  });

  test("schema required array includes 'action'", async () => {
    const { COMPUTER_USE_TOOL_SCHEMA } = await import("../../lib/tools/computer-use-tool.js");
    assert.ok(Array.isArray(COMPUTER_USE_TOOL_SCHEMA.inputSchema.required), "inputSchema.required should be an array");
    assert.ok(
      COMPUTER_USE_TOOL_SCHEMA.inputSchema.required.includes("action"),
      "required should include 'action'"
    );
  });

  test("schema action enum includes expected values", async () => {
    const { COMPUTER_USE_TOOL_SCHEMA } = await import("../../lib/tools/computer-use-tool.js");
    const actionProp = COMPUTER_USE_TOOL_SCHEMA.inputSchema.properties?.action;
    assert.ok(actionProp, "inputSchema.properties.action should exist");
    assert.ok(Array.isArray(actionProp.enum), "action.enum should be an array");
    for (const expected of ["screenshot", "click", "navigate", "type", "scroll"]) {
      assert.ok(actionProp.enum.includes(expected), `action.enum should include '${expected}'`);
    }
  });

  test("schema has a non-empty description", async () => {
    const { COMPUTER_USE_TOOL_SCHEMA } = await import("../../lib/tools/computer-use-tool.js");
    assert.equal(typeof COMPUTER_USE_TOOL_SCHEMA.description, "string");
    assert.ok(COMPUTER_USE_TOOL_SCHEMA.description.length > 0, "description should be non-empty");
  });
});

describe("computer-use-tool: registerComputerUseGate", () => {
  test("registerComputerUseGate does not throw when called multiple times (idempotent)", async () => {
    const { registerComputerUseGate } = await import("../../lib/tools/computer-use-tool.js");
    assert.doesNotThrow(() => {
      registerComputerUseGate();
      registerComputerUseGate();
    });
  });

  test("constitutional gate blocks computer_use without session opt-in", async () => {
    // The gate is registered at module load time via registerComputerUseGate().
    const { execute } = await import("../../lib/agentic/hooks.js");
    const result = await execute("before_tool", {
      toolName: "computer_use",
      state: {}, // no __chicken3.computerUseEnabled
      args: { action: "screenshot" },
    });
    assert.equal(result.aborted, true, "gate should abort computer_use without opt-in");
    assert.ok(
      result.reason?.includes("opt_in") || result.reason?.includes("requires"),
      `abort reason should mention opt-in: "${result.reason}"`
    );
  });

  test("constitutional gate allows computer_use when session opt-in is set", async () => {
    const { execute } = await import("../../lib/agentic/hooks.js");
    const result = await execute("before_tool", {
      toolName: "computer_use",
      state: { __chicken3: { computerUseEnabled: true } },
      args: { action: "screenshot" },
    });
    assert.equal(result.aborted, false, "gate should allow computer_use when opt-in is set");
  });

  test("constitutional gate blocks surveillance-intent actions even with opt-in", async () => {
    const { execute } = await import("../../lib/agentic/hooks.js");
    const result = await execute("before_tool", {
      toolName: "computer_use",
      state: { __chicken3: { computerUseEnabled: true } },
      args: { action: "navigate", url: "https://example.com/keylog-tool" },
    });
    assert.equal(result.aborted, true, "gate should block surveillance-intent actions");
    assert.ok(result.reason?.includes("prohibited"), `reason should mention prohibited term: "${result.reason}"`);
  });

  test("constitutional gate ignores non-computer_use tools", async () => {
    const { execute } = await import("../../lib/agentic/hooks.js");
    const result = await execute("before_tool", {
      toolName: "search",
      state: {},
      args: {},
    });
    // computer-use gate should pass; result depends on other hooks but should not abort due to computer-use gate
    // We only verify it doesn't throw
    assert.equal(typeof result.aborted, "boolean");
  });
});

// ─── sandbox-manager.js ───────────────────────────────────────────────────────

describe("sandbox-manager: createSandbox", () => {
  test("returns a sandboxId string starting with 'sb_'", async () => {
    const { createSandbox } = await import("../../lib/tools/sandbox-manager.js");
    const db = createInMemoryDb();
    const result = createSandbox(db, { userId: "u1", sandboxType: "browser" });
    assert.ok(result.sandboxId, "should return sandboxId");
    assert.equal(typeof result.sandboxId, "string");
    assert.ok(result.sandboxId.startsWith("sb_"), "sandboxId should start with 'sb_'");
  });

  test("stores the sandbox in the database", async () => {
    const { createSandbox } = await import("../../lib/tools/sandbox-manager.js");
    const db = createInMemoryDb();
    const { sandboxId } = createSandbox(db, { userId: "u2", name: "my-ws", sandboxType: "code" });
    const raw = db._tables.sandbox_workspaces?.find(r => r.id === sandboxId);
    assert.ok(raw, "sandbox should be stored in db");
    assert.equal(raw.status, "ready", "new sandbox should have status 'ready'");
    assert.equal(raw.user_id, "u2");
  });
});

describe("sandbox-manager: getSandbox", () => {
  test("retrieves sandbox by id and userId", async () => {
    const { createSandbox, getSandbox } = await import("../../lib/tools/sandbox-manager.js");
    const db = createInMemoryDb();
    const { sandboxId } = createSandbox(db, { userId: "u3", sandboxType: "browser" });
    const sandbox = getSandbox(db, sandboxId, "u3");
    assert.ok(sandbox, "should return sandbox");
    assert.equal(sandbox.id, sandboxId);
    assert.equal(sandbox.user_id, "u3");
  });

  test("returns null for wrong userId", async () => {
    const { createSandbox, getSandbox } = await import("../../lib/tools/sandbox-manager.js");
    const db = createInMemoryDb();
    const { sandboxId } = createSandbox(db, { userId: "owner", sandboxType: "browser" });
    const result = getSandbox(db, sandboxId, "not-owner");
    assert.equal(result, null, "should return null for wrong userId");
  });

  test("returns null for unknown sandboxId", async () => {
    const { getSandbox } = await import("../../lib/tools/sandbox-manager.js");
    const db = createInMemoryDb();
    const result = getSandbox(db, "sb_unknown", "any-user");
    assert.equal(result, null);
  });
});

describe("sandbox-manager: terminateSandbox", () => {
  test("sets status to terminated", async () => {
    const { createSandbox, terminateSandbox } = await import("../../lib/tools/sandbox-manager.js");
    const db = createInMemoryDb();
    const { sandboxId } = createSandbox(db, { userId: "u4", sandboxType: "general" });

    terminateSandbox(db, sandboxId);

    const raw = db._tables.sandbox_workspaces.find(r => r.id === sandboxId);
    assert.equal(raw.status, "terminated", "status should be terminated after terminateSandbox");
    assert.ok(raw.terminated_at, "terminated_at should be set");
  });
});

describe("sandbox-manager: full round-trip", () => {
  test("create → get → terminate", async () => {
    const { createSandbox, getSandbox, terminateSandbox } = await import("../../lib/tools/sandbox-manager.js");
    const db = createInMemoryDb();

    // Create
    const { sandboxId } = createSandbox(db, {
      userId: "rt-user",
      agentId: "agent-1",
      name: "round-trip",
      sandboxType: "browser",
      config: { headless: true },
    });
    assert.ok(sandboxId);

    // Get
    const sandbox = getSandbox(db, sandboxId, "rt-user");
    assert.ok(sandbox);
    assert.equal(sandbox.user_id, "rt-user");
    assert.equal(sandbox.sandbox_type, "browser");
    assert.equal(sandbox.status, "ready");

    // Terminate
    terminateSandbox(db, sandboxId);
    const raw = db._tables.sandbox_workspaces.find(r => r.id === sandboxId);
    assert.equal(raw.status, "terminated");
  });
});
