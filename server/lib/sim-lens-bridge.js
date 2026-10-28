// Lets the /sim routes call the real message, world and cobuild lens actions
// without a second store. The domains register into a private Map here and keep
// all their data in globalThis._concordSTATE, so a call through this bridge reads
// and writes the same rows the lens UI does (same validation, same persistence).

import registerMessageActions from "../domains/message.js";
import registerWorldActions from "../domains/world.js";
import registerCobuildActions from "../domains/cobuild.js";

let registry = null;

function load() {
  if (registry) return registry;
  registry = new Map();
  const register = (domain, action, handler) => { registry.set(`${domain}.${action}`, handler); };
  registerMessageActions(register);
  registerWorldActions(register);
  registerCobuildActions(register);
  return registry;
}

// Runs one lens action as `userId`. Always returns the action's own {ok,...} object.
export function runLensAction(domain, action, userId, params = {}) {
  const handler = load().get(`${domain}.${action}`);
  if (!handler) return { ok: false, error: "action_not_registered", action: `${domain}.${action}` };
  const ctx = { actor: { userId: userId || null }, userId: userId || null };
  return handler(ctx, null, params);
}

// Maps a failed lens action to an HTTP status. Actions return plain error strings.
export function lensErrorStatus(res) {
  if (Number.isInteger(res?.status)) return res.status;
  const err = String(res?.error || "");
  if (err === "auth_required") return 401;
  if (/not found$/.test(err)) return 404;
  if (err === "not a participant") return 403;
  if (/required|too long/.test(err)) return 400;
  if (err === "already_claimed") return 409;
  return 500;
}
