// server/domains/usb-lease.js
//
// USB Framework + Lease System domain export — makes both modules reachable
// via lens macros and a heartbeat lease-renewal sweep.

import { registerHeartbeat } from "../emergent/heartbeat-registry.js";
import * as usb from "../lib/usb-framework.js";
import * as lease from "../lib/lease-system.js";

const HOLDER = "concord-usb-lease-domain";
const LEASE_NAME = "usb-lease-domain-leader";

function bootBuiltinSkills() {
  if (!usb.has("usb.ping")) {
    usb.register("usb.ping", (args = {}) => ({
      pong: true,
      echo: args.echo ?? null,
      ts: Date.now(),
    }), { description: "USB health ping", risk: "read" });
  }
  if (!usb.has("lease.status")) {
    usb.register("lease.status", (args = {}) => {
      const name = args.name || LEASE_NAME;
      return lease.status(name);
    }, { description: "Lease status via USB", risk: "read" });
  }
}

bootBuiltinSkills();

// Heartbeat: renew domain leader lease so the module is observably live.
try {
  registerHeartbeat("usb-lease-renewal", {
    frequency: 4,
    scope: "global",
    lowPriority: true,
    handler: () => {
      try {
        if (process.env.CONCORD_USB_LEASE_SWEEP === "0") {
          return { ok: true, skipped: "disabled" };
        }
        const st = lease.status(LEASE_NAME);
        if (st.held && st.lease?.holder === HOLDER) {
          return lease.renew(LEASE_NAME, {
            holder: HOLDER,
            token: st.lease.token,
            ttlMs: 120_000,
          });
        }
        return lease.acquire(LEASE_NAME, {
          holder: HOLDER,
          ttlMs: 120_000,
          meta: { purpose: "usb-lease-domain-leader" },
        });
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    },
  });
} catch (e) {
  console.warn("[usb-lease] registerHeartbeat skipped:", e?.message || e);
}

export default function registerUsbLeaseActions(registerLensAction) {
  bootBuiltinSkills();

  registerLensAction("usb", "list", (_ctx, _artifact, _params) => {
    return { ok: true, result: { skills: usb.list() } };
  });

  registerLensAction("usb", "register", (_ctx, artifact, params) => {
    const id = params?.id || artifact?.data?.id;
    if (!id) return { ok: false, error: "id_required" };
    const description = params?.description || artifact?.data?.description || "";
    usb.register(String(id), (args) => ({ registered_echo: true, id, args }), {
      description,
      risk: "read",
      meta: { source: "lens_macro" },
    });
    return { ok: true, result: { id: String(id) } };
  });

  registerLensAction("usb", "invoke", async (_ctx, artifact, params) => {
    const id = params?.id || artifact?.data?.id;
    const args = params?.args || artifact?.data?.args || {};
    if (!id) return { ok: false, error: "id_required" };
    const out = await usb.invoke(String(id), args, { observe_only: true });
    return { ok: !!out.ok, result: out, error: out.ok ? undefined : out.error };
  });

  registerLensAction("lease", "acquire", (_ctx, artifact, params) => {
    const name = params?.name || artifact?.data?.name || LEASE_NAME;
    const holder = params?.holder || artifact?.data?.holder || HOLDER;
    const ttlMs = Number(params?.ttlMs || artifact?.data?.ttlMs || 30_000);
    const out = lease.acquire(String(name), { holder: String(holder), ttlMs });
    return { ok: !!out.ok, result: out, error: out.ok ? undefined : out.error };
  });

  registerLensAction("lease", "renew", (_ctx, artifact, params) => {
    const name = params?.name || artifact?.data?.name || LEASE_NAME;
    const holder = params?.holder || artifact?.data?.holder || HOLDER;
    const token = params?.token || artifact?.data?.token;
    const ttlMs = params?.ttlMs || artifact?.data?.ttlMs;
    if (!token) return { ok: false, error: "token_required" };
    const out = lease.renew(String(name), { holder: String(holder), token: String(token), ttlMs });
    return { ok: !!out.ok, result: out, error: out.ok ? undefined : out.error };
  });

  registerLensAction("lease", "release", (_ctx, artifact, params) => {
    const name = params?.name || artifact?.data?.name || LEASE_NAME;
    const holder = params?.holder || artifact?.data?.holder || HOLDER;
    const token = params?.token || artifact?.data?.token;
    const out = lease.release(String(name), {
      holder: holder ? String(holder) : undefined,
      token: token ? String(token) : undefined,
    });
    return { ok: !!out.ok, result: out, error: out.ok ? undefined : out.error };
  });

  registerLensAction("lease", "status", (_ctx, artifact, params) => {
    const name = params?.name || artifact?.data?.name || LEASE_NAME;
    return { ok: true, result: lease.status(String(name)) };
  });
}

export { usb, lease };
