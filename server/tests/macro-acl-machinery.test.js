// CB-1324 — machinery ACL tagging: dtu.dedupeSweep · evolution.dedupe ·
// system.promotionTick · heartbeat.tick · agent.enable · agent.tick.
//
// Runs server.js's real ACL population block into collector maps, then
// asks the REAL human gate (lib/macro-acl-human-gate.js) who may call:
// members must be denied, admin-class and internal callers must pass,
// and member-facing macros must stay open (no collateral lockdown).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(here, "..", "server.js"), "utf8");
const { humanMacroAclDenial } = await import("../lib/macro-acl-human-gate.js");

function populationMaps() {
  const start = serverSrc.indexOf("// ---- Populate Macro Permission Matrix ----");
  assert.ok(start >= 0, "ACL population block found");
  const endMark = 'allowMacro("lens", "export", _ACL_PUB);';
  const end = serverSrc.indexOf(endMark, start);
  assert.ok(end > start, "population block end found");
  const block = serverSrc.slice(start, end + endMark.length);
  const macroAcl = new Map();
  const macroAclDomain = new Map();
  const allowMacro = (domain, name, rule = { roles: ["owner", "admin", "member"], scopes: ["*"] }) =>
    macroAcl.set(`${domain}.${name}`, rule);
  const allowDomain = (domain, rule = { roles: ["owner", "admin", "member"], scopes: ["*"] }) =>
    macroAclDomain.set(domain, rule);
  // eslint-disable-next-line no-new-func -- compiles a slice of server.js to test one handler in isolation
  const factory = new Function("allowMacro", "allowDomain", block + "\nreturn true;");
  factory(allowMacro, allowDomain);
  return { macroAcl, macroAclDomain };
}

const { macroAcl, macroAclDomain } = populationMaps();
const member = { actor: { userId: "alice", role: "member", scopes: ["read", "write"] } };
const admin = { actor: { userId: "root", role: "admin", scopes: ["read", "write"] } };
const internal = { internal: true, actor: { userId: "system", role: "system", internal: true } };
const denial = (ctx, domain, name) => humanMacroAclDenial({ ctx, domain, name, macroAcl, macroAclDomain });

const MACHINERY = [
  ["dtu", "dedupeSweep"], ["evolution", "dedupe"], ["system", "promotionTick"],
  ["heartbeat", "tick"], ["agent", "enable"], ["agent", "tick"],
];
for (const [d, n] of MACHINERY) {
  test(`member is denied ${d}.${n}`, () => {
    const out = denial(member, d, n);
    assert.ok(out && out.status === 403, `${d}.${n} denies members`);
  });
  test(`admin passes ${d}.${n}`, () => {
    assert.equal(denial(admin, d, n), null);
  });
  test(`internal caller bypasses ${d}.${n}`, () => {
    assert.equal(denial(internal, d, n), null);
  });
}

test("member-facing macros stay open (no collateral lockdown)", () => {
  assert.equal(denial(member, "chat", "forge.save"), null);
  assert.equal(denial(member, "paper", "build"), null);
  assert.equal(denial(member, "verify", "lineageLink"), null);
});

test("pre-existing owner tag still denies members (goals.approve)", () => {
  const out = denial(member, "goals", "approve");
  assert.ok(out && out.status === 403);
});

test("dtu.delete stays member-usable by design (inline owner gate)", () => {
  assert.equal(denial(member, "dtu", "delete"), null);
});
