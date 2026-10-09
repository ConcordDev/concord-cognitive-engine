// server/lib/conkay/safety-case/change-log.js
//
// Append-only, hash-chained change history for safety-case items. Each entry
// hashes { seq, at, actor, action, target, change, prevHash } with the same
// canonical JSON + SHA-256 the iterate-loop receipts use, so editing,
// removing or reordering any entry breaks every later link.
// Timestamps are supplied by the caller (deterministic tests and reports).
// Human-only actions (accepting a proposal, signing off, changing a
// requirement) are refused for ConKay or any tool.

import { canonical, sha256 } from "../iterate/receipt.js";
import { humanNameError } from "./vocabulary.js";

export const GENESIS = "0".repeat(64);
export const HUMAN_ONLY_ACTIONS = Object.freeze(["accept-proposal", "reject-proposal", "sign-off", "change-requirement", "set-acceptance-criterion"]);
export const ACTIONS = Object.freeze(["create", "link-analysis", "propose", "record-verification", "note", ...HUMAN_ONLY_ACTIONS]);

function entryHash(e) {
  return sha256(canonical({ seq: e.seq, at: e.at, actor: e.actor, action: e.action, target: e.target, change: e.change, prevHash: e.prevHash }));
}

export class ChangeLog {
  #entries = [];

  /** actor: { name, kind: "human" | "tool" } */
  append({ at, actor, action, target, change = null }) {
    if (typeof at !== "string" || !at) throw new Error("change log: `at` timestamp required");
    if (!actor || !["human", "tool"].includes(actor.kind) || typeof actor.name !== "string") throw new Error("change log: actor { name, kind: human|tool } required");
    if (!ACTIONS.includes(action)) throw new Error(`change log: unknown action "${action}"`);
    if (HUMAN_ONLY_ACTIONS.includes(action)) {
      if (actor.kind !== "human") throw new Error(`change log: "${action}" is a human decision; ${actor.name} cannot record it`);
      const err = humanNameError(actor.name, action);
      if (err) throw new Error(`change log: ${err}`);
    }
    const prev = this.#entries[this.#entries.length - 1];
    const e = { seq: this.#entries.length, at, actor: { name: actor.name, kind: actor.kind }, action, target: String(target), change: JSON.parse(JSON.stringify(change)), prevHash: prev ? prev.hash : GENESIS };
    e.hash = entryHash(e);
    const frozen = deepFreeze(e);
    this.#entries.push(frozen);
    return frozen;
  }

  entries() { return [...this.#entries]; }
  head() { return this.#entries.length ? this.#entries[this.#entries.length - 1].hash : GENESIS; }
  for(target) { return this.#entries.filter((e) => e.target === target); }
  toJSON() { return this.entries(); }
}

function deepFreeze(o) {
  if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

/** Verify an exported chain (e.g. from JSON). Reports the first broken link. */
export function verifyChain(entries) {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return { valid: false, brokenAt: i, reason: `entry ${i} has seq ${e.seq} (removed or reordered entries)` };
    if (e.prevHash !== prev) return { valid: false, brokenAt: i, reason: `entry ${i} does not link to the previous entry's hash` };
    if (entryHash(e) !== e.hash) return { valid: false, brokenAt: i, reason: `entry ${i} content does not match its hash (edited after the fact)` };
    prev = e.hash;
  }
  return { valid: true, brokenAt: null, reason: null, head: prev, length: entries.length };
}
