// server/domains/haptic.js
//
// Haptic encoding (#44) — macro over lib/haptic-encode.js. Encodes a real
// combat impact into a Web Gamepad dual-rumble pattern + ADSR envelope the
// client plays via the actual vibrationActuator API. Pure deterministic; no DB.
//
// Registered from server.js: registerHapticMacros(register).

import { waveformFromImpact, waveformFor } from "../lib/haptic-encode.js";

export default function registerHapticMacros(register) {
  register("haptic", "encode", async (_ctx, input = {}) => {
    // Either pass a resolved {severity, momentum} or strike kinematics (kind/tier/frame).
    if (input.momentum != null || input.severity) {
      return { ok: true, pattern: waveformFromImpact({ severity: input.severity, momentum: input.momentum }) };
    }
    return { ok: true, pattern: waveformFor(input) };
  }, { note: "encode a combat impact into a controller rumble pattern + ADSR envelope (#44)" });
}
