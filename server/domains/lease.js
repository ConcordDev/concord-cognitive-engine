// server/domains/lease.js — Lease System macro surface
import * as lease from "../lib/lease-system.js";
import os from "node:os";

export default function registerLeaseMacros(register) {
  register("lease", "status", async (ctx, input = {}) => {
    if (input.name) {
      const s = lease.status(input.name);
      return { ok: true, ...s, system: "LIVE", module: "server/lib/lease-system.js" };
    }
    const all = lease.listLeases();
    return {
      ok: true,
      name: "Lease System",
      module: "server/lib/lease-system.js",
      status: "LIVE",
      leases: all.length,
      items: all,
    };
  }, { note: "Lease System status / one lease" });

  register("lease", "list", async () => {
    return { ok: true, leases: lease.listLeases() };
  }, { note: "list all leases" });

  register("lease", "acquire", async (ctx, input = {}) => {
    if (!input.name) return { ok: false, reason: "name_required" };
    const holder = input.holder || input.owner || os.hostname().split(".")[0];
    return lease.acquire(input.name, {
      holder,
      ttlMs: input.ttlMs || 300_000,
      meta: input.meta || {},
    });
  }, { note: "acquire named lease" });

  register("lease", "renew", async (ctx, input = {}) => {
    if (!input.name) return { ok: false, reason: "name_required" };
    return lease.renew(input.name, {
      holder: input.holder || input.owner || os.hostname().split(".")[0],
      token: input.token,
      ttlMs: input.ttlMs,
    });
  }, { note: "renew lease" });

  register("lease", "release", async (ctx, input = {}) => {
    if (!input.name) return { ok: false, reason: "name_required" };
    return lease.release(input.name, {
      holder: input.holder || input.owner || os.hostname().split(".")[0],
      token: input.token,
    });
  }, { note: "release lease" });
}
