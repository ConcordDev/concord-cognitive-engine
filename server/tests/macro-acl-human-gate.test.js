// SEC-MACRO-ACL (P0): admin/owner-tier macro rules must be enforced for
// signed-in human callers. runMacro's canRunMacro gate only fires for
// sovereign-only domains / non-human callers, so admin tags were decorative
// for humans. lib/macro-acl-human-gate.js now enforces them role-only, with
// a member-usable allowlist so product-facing admin macros stay open.
//
// This file deliberately does NOT import server.js (it boots the whole
// server): the ACL matrix is mirrored here from server.js's tier objects,
// and wiring is asserted from source, mirroring the three-gate-consistency
// test's approach. No network.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  humanMacroAclDenial,
  PRIVILEGED_ROLES,
  MEMBER_USABLE_ADMIN_MACROS,
} from "../lib/macro-acl-human-gate.js";

const SERVER_PATH = path.resolve(import.meta.dirname, "../server.js");
const source = readFileSync(SERVER_PATH, "utf-8");

// ---- Mirror of server.js's Macro Permission Matrix (tiers + rules) ----
const _ACL_PUB         = { roles: ["viewer","member","admin","owner"], scopes: ["read","write","admin","*"] };
const _ACL_MEMBER      = { roles: ["member","admin","owner"], scopes: ["write","admin","*"] };
const _ACL_MEMBER_READ = { roles: ["member","admin","owner"], scopes: ["read","write","admin","*"] };
const _ACL_ADMIN      = { roles: ["admin","owner"], scopes: ["admin","*"] };
const _ACL_OWNER      = { roles: ["owner"], scopes: ["*"] };

const ADMIN_DOMAINS = [
  "admin","automation","backup","db",
  "integration","webhook","log","llm","plugin","source","abstraction",
  "audit","experiment","synth","harness","crawl",
  "import","redis","sync","repair",
];

const MEMBER_DOMAINS = [
  "ask","chat","forge","swarm","sim","reasoning","hypothesis","inference",
  "metacognition","metalearning","search","semantic","reflection","attention","experience",
  "entity","voice","tools","multimodal","collab","whiteboard","persona","wrapper","layer",
  "temporal","grounding","worldmodel","commonsense","explanation","transfer","materials",
  "style","visual","market","marketplace","mobile","pwa","notion","obsidian","vscode",
  "paper","research","anon","dtu","goals","intent","interface","skill","dimensional",
  "lattice","backpressure","emergent",
];

const macroAcl = new Map();       // `${domain}.${name}` → rule
const macroAclDomain = new Map(); // domain → rule
for (const d of ADMIN_DOMAINS) macroAclDomain.set(d, _ACL_ADMIN);
for (const d of MEMBER_DOMAINS) macroAclDomain.set(d, _ACL_MEMBER);
macroAclDomain.set("lens", _ACL_MEMBER);

// Per-macro overrides (sensitive ops inside member/public domains)
macroAcl.set("dtu.delete", _ACL_ADMIN);
macroAcl.set("dtu.tier_change", _ACL_ADMIN);
macroAcl.set("dtu.shadow_access", _ACL_ADMIN);
macroAcl.set("goals.approve", _ACL_OWNER);
macroAcl.set("goals.activate", _ACL_OWNER);
macroAcl.set("goals.config", _ACL_OWNER);
macroAcl.set("chicken3.meta_propose", _ACL_OWNER);
macroAcl.set("chicken3.meta_commit_quiet", _ACL_OWNER);
macroAcl.set("entity.terminal_approve", _ACL_ADMIN);
macroAcl.set("entity.terminal_pending", _ACL_ADMIN);
macroAcl.set("grounding.approve_action", _ACL_ADMIN);
macroAcl.set("council.vote", _ACL_MEMBER);
macroAcl.set("auth.whoami", _ACL_MEMBER_READ);
macroAcl.set("dtu.list", _ACL_PUB);
macroAcl.set("chat.respond", _ACL_PUB);

// Macros a signed-in ordinary member must NOT be able to run.
const ADMIN_ONLY_CASES = [
  ["redis","get"], ["db","query"], ["webhook","list"], ["webhook","delete"],
  ["automation","run"], ["automation","delete"], ["integration","list"],
  ["plugin","register"], ["plugin","disable"], ["sync","force"], ["harness","run"],
  ["source","list"], ["admin","dashboard"], ["repair","run_now"],
  ["dtu","tier_change"], ["dtu","shadow_access"],
  ["entity","terminal_approve"], ["grounding","approve_action"],
  ["goals","approve"], ["chicken3","meta_propose"],
];

// Macros an ordinary member CAN run (member-usable allowlist + ordinary
// lens/member/public macros; forum.post has no rule at all).
const MEMBER_ALLOWED_CASES = [
  ...Array.from(MEMBER_USABLE_ADMIN_MACROS).map(k => k.split(".")),
  ["log","list_mine"], ["plugin","recent_mine"], // self-scoped names in admin domains
  ["dtu","create"], ["dtu","list"], ["chat","respond"],
  ["lens","run"], ["lens","update"], ["forum","post"],
  ["marketplace","list"], ["collab","create"], ["council","vote"], ["auth","whoami"],
];

function makeCtx(actor) { return { reqMeta: { path: "/api/lens/run" }, actor }; }

const MEMBER = { userId: "u1", orgId: "default", role: "member", scopes: ["read", "write"] };

function assertDenied(res, [domain, name]) {
  assert.ok(res, `${domain}.${name} should be denied`);
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.equal(res.code, "admin_only");
  assert.equal(res.error, `forbidden: ${domain}.${name} requires an admin role`);
}

describe("SEC-MACRO-ACL human gate (unit)", () => {
  it("ordinary member is DENIED admin/owner-tier macros", () => {
    for (const [domain, name] of ADMIN_ONLY_CASES) {
      const res = humanMacroAclDenial({ ctx: makeCtx(MEMBER), domain, name, macroAcl, macroAclDomain });
      assertDenied(res, [domain, name]);
    }
  });

  it("ordinary member is ALLOWED member-usable, self-scoped and ordinary macros", () => {
    for (const [domain, name] of MEMBER_ALLOWED_CASES) {
      const res = humanMacroAclDenial({ ctx: makeCtx(MEMBER), domain, name, macroAcl, macroAclDomain });
      assert.equal(res, null, `${domain}.${name} should be allowed for a member`);
    }
  });

  it("MEMBER_USABLE_ADMIN_MACROS is exactly the reviewed allowlist", () => {
    assert.deepEqual(Array.from(MEMBER_USABLE_ADMIN_MACROS).sort(), [
      "crawl.enqueue","crawl.fetch","dtu.delete","experiment.log","goals.config",
      "import.json","import.markdown","llm.embed","llm.local","log.list",
      "plugin.list","synth.combine",
    ]);
  });

  it("privileged roles (owner/admin/founder/sovereign) are ALLOWED admin-tier macros", () => {
    assert.deepEqual([...PRIVILEGED_ROLES], ["owner","admin","founder","sovereign"]);
    for (const role of PRIVILEGED_ROLES) {
      for (const [domain, name] of ADMIN_ONLY_CASES) {
        const res = humanMacroAclDenial({
          ctx: makeCtx({ userId: "u2", role, scopes: ["read", "write"] }),
          domain, name, macroAcl, macroAclDomain,
        });
        assert.equal(res, null, `${role} should be allowed ${domain}.${name}`);
      }
    }
  });

  it("viewer and anonymous (guest) actors are DENIED admin-tier macros", () => {
    for (const actor of [{ userId: "u3", role: "viewer", scopes: ["read"] }, { userId: "anon", role: "guest", scopes: ["read"] }]) {
      for (const [domain, name] of ADMIN_ONLY_CASES) {
        const res = humanMacroAclDenial({ ctx: makeCtx(actor), domain, name, macroAcl, macroAclDomain });
        assertDenied(res, [domain, name]);
      }
    }
  });

  it("internal ctx and internal actor bypass the gate", () => {
    for (const [domain, name] of ADMIN_ONLY_CASES) {
      const resCtxInternal = humanMacroAclDenial({
        ctx: { reqMeta: { path: "/api/lens/run" }, internal: true, actor: { ...MEMBER } },
        domain, name, macroAcl, macroAclDomain,
      });
      assert.equal(resCtxInternal, null, `ctx.internal should allow ${domain}.${name}`);
      const resActorInternal = humanMacroAclDenial({
        ctx: makeCtx({ ...MEMBER, internal: true }),
        domain, name, macroAcl, macroAclDomain,
      });
      assert.equal(resActorInternal, null, `actor.internal should allow ${domain}.${name}`);
    }
  });
});

describe("SEC-MACRO-ACL matrix drift (source)", () => {
  it("server.js admin-domain allowDomain list is exactly the 20 reviewed domains", () => {
    const marker = "// Admin-level domains";
    const idx = source.indexOf(marker);
    assert.ok(idx > 0, "admin-domain marker not found in server.js");
    const bracketStart = source.indexOf("[", idx);
    const arrayStr = source.slice(bracketStart, source.indexOf("]", bracketStart));
    const re = /"([^"]+)"/g;
    const domains = [];
    let m;
    while ((m = re.exec(arrayStr)) !== null) domains.push(m[1]);
    assert.deepEqual(domains.sort(), [...ADMIN_DOMAINS].sort());
  });
});

describe("SEC-MACRO-ACL wiring in runMacro (source)", () => {
  const runMacroStart = source.indexOf("async function runMacro(");
  const callIdx = source.indexOf("const _aclDenied = humanMacroAclDenial({", runMacroStart);
  const c2Idx = source.indexOf("inLatticeReality(", runMacroStart);
  const heavyIdx = source.indexOf("isHeavy(domain, name)", runMacroStart);

  it("server.js imports humanMacroAclDenial from lib/macro-acl-human-gate.js", () => {
    assert.ok(source.includes(`import { humanMacroAclDenial } from "./lib/macro-acl-human-gate.js";`));
  });

  it("runMacro calls humanMacroAclDenial with the MACRO ACL maps", () => {
    assert.ok(runMacroStart > 0);
    assert.ok(callIdx > runMacroStart, "humanMacroAclDenial call not found inside runMacro");
    const call = source.slice(callIdx, source.indexOf("});", callIdx) + 3);
    assert.ok(call.includes("macroAcl: MACRO_ACL"));
    assert.ok(call.includes("macroAclDomain: MACRO_ACL_DOMAIN"));
  });

  it("the call is guarded by MACROS.get(domain)?.has(name)", () => {
    const guardIdx = source.indexOf("MACROS.get(domain)?.has(name)", runMacroStart);
    assert.ok(guardIdx > 0, "MACROS.get(domain)?.has(name) guard not found");
    assert.ok(guardIdx < callIdx && callIdx - guardIdx < 300, "guard must immediately precede the call");
    assert.ok(source.slice(guardIdx - 200, guardIdx).includes("!_sovereignOnlyDomains.has(domain)"),
      "guard must exclude sovereign-only domains");
    assert.ok(source.slice(guardIdx - 200, guardIdx).includes("(safeReadBypass || _isAuthenticatedUser || _isHumanRequest)"),
      "gate must only cover callers that skipped canRunMacro");
  });

  it("the call passes runMacro's resolved actor when ctx has none", () => {
    const call = source.slice(callIdx, source.indexOf("});", callIdx) + 3);
    assert.ok(call.includes("ctx: ctx?.actor ? ctx : { ...(ctx || {}), actor }"));
  });

  it("the gate runs before inLatticeReality and the isHeavy worker-pool dispatch", () => {
    assert.ok(c2Idx > runMacroStart, "inLatticeReality call not found inside runMacro");
    assert.ok(heavyIdx > runMacroStart, "isHeavy dispatch not found inside runMacro");
    assert.ok(callIdx < c2Idx, "humanMacroAclDenial must run before the Chicken2 inLatticeReality check");
    assert.ok(callIdx < heavyIdx, "humanMacroAclDenial must run before the isHeavy worker-pool dispatch");
  });
});