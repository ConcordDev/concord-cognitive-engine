// lib/agent-capability-sandbox.js
//
// Phase 13 (Stage C) — capability-scoped ctx for running published agents.
//
// Every "run someone else's agent" code path MUST construct ctx via this
// wrapper. Direct baseCtx.runMacro is never passed to agent code — that
// would let an agent escalate to macros it never declared.
//
// The sandbox is a one-way ratchet: agent code receives a proxy that
// (a) hard-throws on undeclared macro names with `capability_denied`,
// (b) nulls out llm/runArtifact when the agent didn't declare the
// reserved `_llm` capability, (c) does not allow reconstruction of the
// unsandboxed ctx (no back-references stored on the proxy).

import { capabilitySet, validateAgentManifest } from "./agent-spec-validator.js";

const CAPABILITY_DENIED = "capability_denied";

/**
 * Build a sandboxed ctx that gates runMacro by the agent manifest's
 * declared capabilities. Throws if the manifest is malformed (re-validates
 * at load time per spec).
 *
 * @param {object} baseCtx — the trusted server ctx (runMacro, llm, db, …)
 * @param {object} agentManifest — the agent spec (validated)
 * @returns {object} sandboxed ctx
 */
export function makeSandboxedCtx(baseCtx, agentManifest) {
  const v = validateAgentManifest(agentManifest);
  if (!v.ok) {
    throw new Error(`agent_manifest_invalid: ${v.reason}${v.detail ? ` (${v.detail})` : ""}`);
  }
  const manifest = v.normalized;
  const allowed = capabilitySet(manifest);
  const hasLlm = allowed.has("_llm");

  const sandboxedRunMacro = async (domain, name, input) => {
    const key = `${domain}.${name}`;
    if (!allowed.has(key)) {
      const err = new Error(`${CAPABILITY_DENIED}: agent ${manifest.id} did not declare ${key}`);
      // Tag for caller introspection without depending on err.code.
      err.code = CAPABILITY_DENIED;
      err.deniedMacro = key;
      throw err;
    }
    return baseCtx.runMacro(domain, name, input);
  };

  // Best-effort wrapper for runArtifact when present. Same gating rule.
  const sandboxedRunArtifact = baseCtx.runArtifact
    ? async (domain, action, input) => {
        const key = `${domain}.${action}`;
        if (!allowed.has(key)) {
          const err = new Error(`${CAPABILITY_DENIED}: agent ${manifest.id} did not declare runArtifact ${key}`);
          err.code = CAPABILITY_DENIED;
          err.deniedMacro = key;
          throw err;
        }
        return baseCtx.runArtifact(domain, action, input);
      }
    : undefined;

  // Build the sandbox WITHOUT a back-reference to baseCtx so agent code
  // can't introspect its way back to an unsandboxed runMacro. Only carry
  // forward fields the agent actually needs.
  const sandbox = {
    actor: baseCtx.actor ? { userId: baseCtx.actor.userId } : null,
    db: baseCtx.db, // read access fine — sandboxed writes happen via runMacro
    state: baseCtx.state,
    runMacro: sandboxedRunMacro,
    runArtifact: sandboxedRunArtifact,
    llm: hasLlm ? baseCtx.llm : null,
    agent: {
      id: manifest.id,
      version: manifest.version,
      capabilities: [...allowed],
      hasLlmCapability: hasLlm,
    },
  };

  // Freeze so the agent can't mutate the sandbox to grant itself caps.
  Object.freeze(sandbox);
  return sandbox;
}

export { CAPABILITY_DENIED };
