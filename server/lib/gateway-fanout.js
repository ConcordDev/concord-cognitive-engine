// server/lib/gateway-fanout.js
//
// Modules that still broadcast on `REALTIME.io.emit` (socket.io-only) would
// otherwise never reach `/godot-ws` or `/unity-ws`. `realtimeEmit` cannot be
// substituted blindly — it would double-fire socket.io for those callers.
// This hook is gateway-only. server.js assigns `globalThis._concordGatewayMirror`
// next to the two gateway emitters. A missing hook is a silent no-op so unit
// tests of weather/clock without a boot still pass.

export function mirrorToGateways(event, payload, opts = {}) {
  try {
    const fn = globalThis._concordGatewayMirror;
    if (typeof fn === "function") fn(event, payload, opts);
  } catch { /* survive */ }
}
