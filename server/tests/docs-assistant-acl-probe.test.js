// server/tests/docs-assistant-acl-probe.test.js
//
// FIX-docs-001 premise probe: the Docs lens Assistant (LensAgentPanel)
// submits via lensRun('chat_agent', 'do') → POST /api/lens/run, and the
// audit reported a 403 for a signed-in member ("same as the global
// /api/lens/run 403"). This probe checks the one code gate that can 403
// a member on that path — the SEC-MACRO-ACL human gate
// (lib/macro-acl-human-gate.js, driven by the MACRO_ACL matrix) — using
// the hook server.js installs on globalThis with the REAL rule maps,
// plus the platform-internal domain gate's domain set.
//
// Result at branch state: chat_agent.do carries NO ACL rule (the domain
// is in no tier list and has no per-macro rule), so the gate allows a
// member; the platform-internal set is {ops, system} only. The 403 does
// not reproduce from branch code — the ticket's disposition is named in
// B11's slice-completion post (desk live-repro set, with the prod
// lens-run log's reason codes as the instrument). The contrast case
// (dtu.delete, an admin-tier macro) proves the probe can see a denial.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concord-docs-assistant-acl-"));
process.env.CONCORD_LOW_MEMORY_HOST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";
import { isPlatformInternalLensDomain } from "../lib/platform-internal-lens-gate.js";

const { __TEST__ } = await import("../server.js");
registerServerCleanExit(() => __TEST__);

const memberCtx = {
  actor: { userId: "qa-member", role: "member", scopes: ["read", "write"] },
  reqMeta: { path: "/api/lens/run" },
};

describe("FIX-docs-001 premise probe — the assistant's lens/run path at branch state", () => {
  it("the human macro ACL gate does NOT deny a member chat_agent.do", () => {
    const denial = globalThis.humanMacroAclDenial({ ctx: memberCtx, domain: "chat_agent", name: "do" });
    assert.equal(denial, null, `chat_agent.do must be member-allowed, got ${JSON.stringify(denial)}`);
  });

  it("contrast: the same gate DOES deny a member an owner-tier macro (goals.approve)", () => {
    const denial = globalThis.humanMacroAclDenial({ ctx: memberCtx, domain: "goals", name: "approve" });
    assert.ok(denial && denial.status === 403 && denial.code === "admin_only",
      `expected an admin_only denial for contrast, got ${JSON.stringify(denial)}`);
  });

  it("chat_agent and docs are not platform-internal domains", () => {
    assert.equal(isPlatformInternalLensDomain("chat_agent"), false);
    assert.equal(isPlatformInternalLensDomain("docs"), false);
    assert.equal(isPlatformInternalLensDomain("ops"), true);
  });
});
