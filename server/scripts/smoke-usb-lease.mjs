#!/usr/bin/env node
// Smoke: USB framework + lease system (file backend). No live trading.
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as usb from "../lib/usb-framework.js";
import * as lease from "../lib/lease-system.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const proof = {
  ok: false,
  usb: {},
  lease: {},
  errors: [],
};

try {
  usb.clear();
  usb.register("smoke.echo", (args) => ({ echo: args?.msg || "hi" }), {
    description: "smoke echo",
    risk: "read",
  });
  const listed = usb.list();
  const sync = usb.invokeSync("smoke.echo", { msg: "usb-live" });
  const asyncInv = await usb.invoke("smoke.echo", { msg: "usb-async" }, { observe_only: true });
  proof.usb = {
    registered: listed.some((s) => s.id === "smoke.echo"),
    list_count: listed.length,
    invokeSync_ok: !!sync.ok && sync.result?.echo === "usb-live",
    invoke_ok: !!asyncInv.ok && asyncInv.result?.echo === "usb-async",
    f0_decision: asyncInv.gate?.decision || null,
  };
} catch (e) {
  proof.errors.push(`usb:${e?.message || e}`);
}

try {
  const dir = path.join(__dirname, "../data/leases-smoke");
  const store = lease.createLeaseStore({ backend: "file", dir });
  const holder = "smoke-holder";
  const name = "smoke-leader";
  const a = store.acquire(name, { holder, ttlMs: 5000, meta: { smoke: true } });
  const r = store.renew(name, { holder, token: a.lease.token, ttlMs: 8000 });
  const st = store.status(name);
  const rel = store.release(name, { holder, token: a.lease.token });
  const st2 = store.status(name);
  proof.lease = {
    acquire_ok: !!a.ok,
    renew_ok: !!r.ok,
    held_after_acquire: !!st.held,
    release_ok: !!rel.ok && !!rel.released,
    held_after_release: !!st2.held,
    backend: a.lease?.backend || "file",
  };
} catch (e) {
  proof.errors.push(`lease:${e?.message || e}`);
}

proof.ok =
  proof.usb.registered &&
  proof.usb.invokeSync_ok &&
  proof.usb.invoke_ok &&
  proof.lease.acquire_ok &&
  proof.lease.renew_ok &&
  proof.lease.held_after_acquire &&
  proof.lease.release_ok &&
  !proof.lease.held_after_release &&
  proof.errors.length === 0;

console.log(JSON.stringify(proof, null, 2));
process.exit(proof.ok ? 0 : 1);
