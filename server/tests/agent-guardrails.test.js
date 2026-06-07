// Contract + CI-invariant test for Wave 7 / Track C — the three agent guardrail fences.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentEnabled,
  AGENT_READ_DOMAINS,
  AGENT_FORBIDDEN_DOMAINS,
  isAgentDomainAllowed,
  isAgentActor,
  assertAgentContextSafe,
  isCcBlockedForActor,
  checkBehavioralRail,
  filterAgentMessage,
  makeActorActionCap,
  AGENT_BEHAVIORAL_RAIL,
} from "../lib/agent-guardrails.js";

test("Track C — agent guardrail fences", async (t) => {
  await t.test("C3 kill-switch: agents are opt-in (default off)", () => {
    const prev = process.env.CONCORD_AGENT_ENABLED;
    delete process.env.CONCORD_AGENT_ENABLED;
    assert.equal(agentEnabled(), false);
    process.env.CONCORD_AGENT_ENABLED = "1";
    assert.equal(agentEnabled(), true);
    if (prev === undefined) delete process.env.CONCORD_AGENT_ENABLED; else process.env.CONCORD_AGENT_ENABLED = prev;
  });

  await t.test("C2 CI INVARIANT: forbidden domains are never in the allowlist", () => {
    for (const d of AGENT_FORBIDDEN_DOMAINS) {
      assert.equal(AGENT_READ_DOMAINS.includes(d), false, `${d} must not be agent-readable`);
      assert.equal(isAgentDomainAllowed(d), false, `${d} must be blocked even if env tries to add it`);
    }
    // a normal player domain is allowed; an unknown one is denied (whitelist)
    assert.equal(isAgentDomainAllowed("dtu"), true);
    assert.equal(isAgentDomainAllowed("totally-unknown-domain"), false);
  });

  await t.test("C2 CI INVARIANT: env cannot add a forbidden domain", () => {
    const prev = process.env.CONCORD_AGENT_DOMAINS;
    process.env.CONCORD_AGENT_DOMAINS = "code,admin,repair";
    assert.equal(isAgentDomainAllowed("code"), false, "forbidden domains beat the env extension");
    if (prev === undefined) delete process.env.CONCORD_AGENT_DOMAINS; else process.env.CONCORD_AGENT_DOMAINS = prev;
  });

  await t.test("C2 structural bar: an agent context is NEVER internal / privileged", () => {
    assert.equal(isAgentActor({ role: "agent" }), true);
    assert.equal(isAgentActor({ is_agent: true }), true);
    assert.equal(isAgentActor({ role: "user" }), false);
    // a non-agent passes through untouched
    assert.equal(assertAgentContextSafe({ role: "user", internal: true }).safe, true);
    // an agent that somehow carries internal=true is rejected
    const bad = assertAgentContextSafe({ actor: { role: "agent" }, internal: true });
    assert.equal(bad.safe, false);
    assert.match(bad.reason, /internal/);
    // an agent that somehow holds a privileged role is rejected
    assert.equal(assertAgentContextSafe({ actor: { role: "agent", internal: false, role2: "x" }, role: "agent" }).safe, true);
    const priv = assertAgentContextSafe({ actor: { is_agent: true, role: "admin" } });
    assert.equal(priv.safe, false);
  });

  await t.test("C2 Sparks-only: agents are blocked from CC surfaces", () => {
    assert.equal(isCcBlockedForActor({ role: "agent" }), true);
    assert.equal(isCcBlockedForActor({ is_agent: true }), true);
    assert.equal(isCcBlockedForActor({ role: "user" }), false);
  });

  await t.test("C1 behavioral rail catches solicitation / dependency / advice", () => {
    assert.equal(checkBehavioralRail("Hey friend, want to explore the north ruins?").ok, true);
    assert.equal(checkBehavioralRail("send me money please, transfer me a gift card").ok, false);
    assert.equal(checkBehavioralRail("only I understand you, you don't need them").ok, false);
    assert.equal(checkBehavioralRail("you should stop taking your medication").ok, false);
    assert.ok(AGENT_BEHAVIORAL_RAIL.includes("AI"), "the rail prompt states it is an AI");
  });

  await t.test("C1 outbound filter is fail-closed on any flag", () => {
    const ok = filterAgentMessage("Nice to meet you! Want to team up for the festival?");
    assert.equal(ok.allowed, true);
    const solicit = filterAgentMessage("please wire me $50 to my cashapp");
    assert.equal(solicit.allowed, false);
    const leak = filterAgentMessage("the vault code is SECRET123", { secrets: ["SECRET123"] });
    assert.equal(leak.allowed, false);
    assert.equal(leak.flags.includes("secret_leak"), true);
    // empty is blocked
    assert.equal(filterAgentMessage("").allowed, false);
  });

  await t.test("C3 per-actor action cap bounds machine-speed flooding", () => {
    let clock = 0;
    const cap = makeActorActionCap({ perActorPerMin: 2, now: () => clock });
    assert.equal(cap.tryConsume("agentA"), true);
    assert.equal(cap.tryConsume("agentA"), true);
    assert.equal(cap.tryConsume("agentA"), false, "3rd in the minute is throttled");
    assert.equal(cap.tryConsume("agentB"), true, "a different actor has its own bucket");
    clock += 60000;
    assert.equal(cap.tryConsume("agentA"), true, "refills over time");
  });
});
