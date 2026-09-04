// server/lib/runtime/deployment-profiles.js
//
// Deployment profiles — local / cloud-hybrid / air-gapped.

import { getConfig, setConfig } from "./runtime-config.js";

export const PROFILES = Object.freeze({
  local: {
    id: "local",
    label: "Local-first",
    enforceAutonomous: false,
    workerAllowlist: "wr-mistral,wr-groq,wr-cerebras,oc-,ollama",
    marathonDefault: false,
    cloudProviders: false,
  },
  hybrid: {
    id: "hybrid",
    label: "Cloud hybrid",
    enforceAutonomous: true,
    workerAllowlist: "wr-groq,wr-mistral,wr-cerebras,wr-gemini,oc-,ollama",
    marathonDefault: true,
    cloudProviders: true,
  },
  airgapped: {
    id: "airgapped",
    label: "Air-gapped",
    enforceAutonomous: false,
    workerAllowlist: "oc-,ollama,local",
    marathonDefault: false,
    cloudProviders: false,
  },
});

export function getActiveProfile(db) {
  const id = getConfig(db, "deployment.profile", null)
    || process.env.CONCORD_DEPLOYMENT_PROFILE
    || "local";
  return PROFILES[id] || PROFILES.local;
}

export function applyDeploymentProfile(db, profileId = "local") {
  const profile = PROFILES[profileId];
  if (!profile) return { ok: false, reason: "unknown_profile", profileId };

  setConfig(db, "deployment.profile", profileId);
  setConfig(db, "auth_gate.enforce_autonomous", profile.enforceAutonomous);
  setConfig(db, "mission.marathon_default", profile.marathonDefault);

  if (profile.workerAllowlist) {
    process.env.CONCORD_DILA_WORKER_ALLOWLIST = profile.workerAllowlist;
  }

  return { ok: true, profile };
}

export function profileSummary(db) {
  const active = getActiveProfile(db);
  return {
    ok: true,
    profile: active.id,
    label: active.label,
    enforceAutonomous: active.enforceAutonomous,
    marathonDefault: active.marathonDefault,
    cloudProviders: active.cloudProviders,
  };
}
