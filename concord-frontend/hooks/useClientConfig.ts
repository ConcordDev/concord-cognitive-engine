'use client';

// E0 — client cadence dials, server-tunable without a rebuild.
//
// The ~24 POLL_MS / FRAME_THROTTLE_MS constants were hardcoded. This hook
// fetches /api/config/client once (process-wide, cached + de-duped) and merges
// it over the baked-in DEFAULTS below, so:
//   - components get a sensible value SYNCHRONOUSLY on first render (no fl: of
//     undefined polls), and
//   - a server env change + page refresh re-tunes any dial without a rebuild.
// A failed fetch is harmless — the defaults stand.

import { useEffect, useState } from 'react';

export interface ClientConfig {
  poll: {
    hordeWaveMs: number; mahjongMs: number; submarineMs: number; extractionMs: number;
    timeLoopMs: number; climbingMs: number; horrorRoleMs: number; restaurantMs: number;
    themeParkMs: number; driftAlertMs: number; courtshipMs: number; footprintMs: number;
    forwardPredMs: number; worldHealthMs: number; partyCombatTickMs: number; partyCombatDiscMs: number;
    rogueliteMs: number; brawlInviteMs: number; factionMovesMs: number; dreamReaderMs: number;
  };
  throttle: {
    courtshipFrameMs: number; footprintFrameMs: number;
    npcActivityFrameMs: number; nemesisFrameMs: number; dangerBandFrameMs: number; contextPromptFrameMs: number;
  };
}

export const CLIENT_CONFIG_DEFAULTS: ClientConfig = {
  poll: {
    hordeWaveMs: 1000, mahjongMs: 800, submarineMs: 1000, extractionMs: 2000,
    timeLoopMs: 2000, climbingMs: 2000, horrorRoleMs: 2500, restaurantMs: 3000,
    themeParkMs: 3000, driftAlertMs: 15000, courtshipMs: 30000, footprintMs: 30000,
    forwardPredMs: 300000, worldHealthMs: 60000, partyCombatTickMs: 200, partyCombatDiscMs: 1000,
    rogueliteMs: 5000, brawlInviteMs: 5000, factionMovesMs: 30000, dreamReaderMs: 60000,
  },
  throttle: {
    courtshipFrameMs: 100, footprintFrameMs: 200,
    npcActivityFrameMs: 80, nemesisFrameMs: 80, dangerBandFrameMs: 500, contextPromptFrameMs: 80,
  },
};

// Module-level cache so every component shares one fetch.
let _cached: ClientConfig | null = null;
let _inflight: Promise<ClientConfig> | null = null;
const _subscribers = new Set<(c: ClientConfig) => void>();

function deepMerge(base: ClientConfig, over: Partial<ClientConfig> | null | undefined): ClientConfig {
  if (!over) return base;
  return {
    poll: { ...base.poll, ...(over.poll || {}) },
    throttle: { ...base.throttle, ...(over.throttle || {}) },
  };
}

async function fetchConfig(): Promise<ClientConfig> {
  if (_cached) return _cached;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const j = await fetch('/api/config/client', { credentials: 'include' }).then((r) => r.json());
      _cached = j?.ok ? deepMerge(CLIENT_CONFIG_DEFAULTS, j.config) : CLIENT_CONFIG_DEFAULTS;
    } catch {
      _cached = CLIENT_CONFIG_DEFAULTS;
    }
    for (const cb of _subscribers) cb(_cached);
    return _cached;
  })();
  return _inflight;
}

/** Returns the merged client config, defaults-first then live values after fetch. */
export function useClientConfig(): ClientConfig {
  const [cfg, setCfg] = useState<ClientConfig>(_cached || CLIENT_CONFIG_DEFAULTS);
  useEffect(() => {
    let active = true;
    if (_cached) { setCfg(_cached); return; }
    const cb = (c: ClientConfig) => { if (active) setCfg(c); };
    _subscribers.add(cb);
    fetchConfig();
    return () => { active = false; _subscribers.delete(cb); };
  }, []);
  return cfg;
}
