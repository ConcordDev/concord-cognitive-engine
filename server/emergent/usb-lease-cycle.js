// Heartbeat: keep USB builtins registered + renew kitchen lease.
import * as usb from "../lib/usb-framework.js";
import * as lease from "../lib/lease-system.js";
import os from "node:os";

export const USB_LEASE_CYCLE_FREQUENCY = 60;

function bootstrapUsb() {
  if (!usb.has("usb.ping")) {
    usb.register("usb.ping", async () => ({ pong: true, ts: new Date().toISOString() }), {
      description: "USB health ping", risk: "read",
    });
  }
}

export async function runUsbLeaseCycle() {
  // Heartbeat modules must never throw (see CLAUDE.md "Key Invariants"). The
  // registry catches throws, but the invariant + invariant-guardian detector
  // want the handler itself defensive.
  try {
    const holder = os.hostname().split(".")[0];
    bootstrapUsb();
    // Ensure kitchen lease is held/renewed by this host
    let kitchen = lease.acquire("concord_kitchen", {
      holder,
      ttlMs: 300_000,
      meta: { purpose: "kitchen_organ_liveness" },
    });
    if (kitchen.ok && kitchen.lease?.token) {
      kitchen = lease.renew("concord_kitchen", {
        holder,
        token: kitchen.lease.token,
        ttlMs: 300_000,
      });
    }
    const ping = await usb.invoke("usb.ping", {}, { observe_only: true });
    return {
      ok: true,
      usb_skills: usb.list().length,
      usb_ping: !!ping.ok,
      kitchen,
      leases: lease.listLeases().length,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}
