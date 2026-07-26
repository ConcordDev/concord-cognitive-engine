'use client';

/**
 * BrainStatusBadge — GH-3d discoverability widget for the code lens.
 *
 * Concord's BYO-key system (`/lenses/byo-keys`) is already fully wired for
 * coding: `ctx.llm.chat({ slot: "conscious" })` in server.js transparently
 * routes through a user's own Anthropic/OpenAI/xAI/Google key whenever an
 * ACTIVE override exists for the "conscious" slot — the exact slot
 * `code.codebase-chat` and `code.multi-file-plan` both call. Nothing in the
 * code lens told a user this existed. This widget is pure discoverability:
 * it reads the real `byo_keys.list` (+ `byo_keys.available_providers` for
 * the real default-model label, never an invented one) state and reports it
 * honestly. No fabricated state — CLAUDE.md's "honest by construction"
 * invariant applies here exactly as it does everywhere else.
 *
 * Three states only, matching what the backend can actually tell us:
 *   loading             — the fetch is genuinely in flight.
 *   no active override  — covers every case that means the same real thing
 *                          (Concord's own local brain answers): no row for
 *                          "conscious", a paused/inactive row, a row still
 *                          pointed at concord_default/ollama (server.js's
 *                          BYO router only engages for a real 3rd-party
 *                          provider — see LOCAL_PROVIDERS below), or a
 *                          failed/unauthenticated fetch.
 *   active override      — a real conscious-slot row with active=1 and a
 *                          real 3rd-party provider. Shows the provider name
 *                          and the model — the user's saved model_id, or
 *                          (only if they never set one) the provider's real
 *                          default straight from `byo_keys.available_
 *                          providers`, never a hardcoded guess.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowRight, Cpu, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface OverrideRow {
  slot: string;
  provider: string;
  model_id: string | null;
  active: number | boolean;
}

interface ProviderInfo {
  id: string;
  name: string;
  defaultModels: Record<string, string>;
}

// The server's BYO router only routes inference through these when the
// provider is a REAL 3rd party (server.js ctx.llm.chat(): `provider !==
// "concord_default" && provider !== "ollama"`). A row pointed at either of
// these is not a reasoning bump, whatever its `active` flag says.
const LOCAL_PROVIDERS = new Set(['concord_default', 'ollama']);

export function BrainStatusBadge() {
  const [loading, setLoading] = useState(true);
  const [override, setOverride] = useState<OverrideRow | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, provRes] = await Promise.all([
        lensRun('byo_keys', 'list', {}),
        lensRun('byo_keys', 'available_providers', {}),
      ]);
      const overrides = (listRes.data?.ok
        ? (listRes.data.result as { overrides?: OverrideRow[] } | null)?.overrides
        : null) ?? [];
      const conscious = overrides.find((o) => o.slot === 'conscious') ?? null;
      const isRealActiveOverride = !!conscious && !!conscious.active && !LOCAL_PROVIDERS.has(conscious.provider);
      setOverride(isRealActiveOverride ? conscious : null);

      const provs = (provRes.data?.ok
        ? (provRes.data.result as { providers?: ProviderInfo[] } | null)?.providers
        : null) ?? [];
      setProviders(provs);
    } catch {
      // Network failure or a genuinely-unauthenticated context — fall
      // through to the honest default state below. Concord's local brain
      // really is what answers in both cases, so this is never an error.
      setOverride(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div
        data-testid="brain-status-badge-loading"
        className="flex items-center gap-2 px-3 py-2 text-[10px] text-gray-400 border-b border-white/10 bg-white/[0.02]"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Checking reasoning brain…</span>
      </div>
    );
  }

  const providerInfo = override ? providers.find((p) => p.id === override.provider) : null;
  const modelLabel = override
    ? (override.model_id || providerInfo?.defaultModels?.conscious || null)
    : null;
  const providerLabel = override ? (providerInfo?.name || override.provider) : null;

  return (
    <div
      data-testid="brain-status-badge"
      className="px-3 py-2 text-[10px] border-b border-white/10 bg-white/[0.02] space-y-1"
    >
      <div className="flex items-center gap-2">
        <Cpu className="w-3 h-3 text-gray-400 shrink-0" />
        {override ? (
          <span data-testid="brain-status-active" className="flex items-center gap-1.5 min-w-0 text-gray-300">
            <span className="text-emerald-400" aria-hidden="true">●</span>
            <span className="truncate">
              Reasoning brain:{' '}
              <span className="text-gray-100 font-medium">
                {providerLabel}{modelLabel ? ` / ${modelLabel}` : ''}
              </span>
            </span>
          </span>
        ) : (
          <span data-testid="brain-status-default" className="text-gray-400 truncate">
            Reasoning brain: Concord default (local)
          </span>
        )}
        <Link
          href="/lenses/byo-keys"
          data-testid="brain-status-swap-link"
          className="ml-auto shrink-0 flex items-center gap-1 text-neon-cyan hover:text-neon-cyan/80 hover:underline"
          title="Plug in your own Claude/GPT/Grok/Gemini key"
        >
          Swap brain <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <p className="text-gray-500 leading-snug">
        Your coding assistant runs on this brain. Plug in your own Claude/GPT/Grok/Gemini key for a stronger reasoning bump.
      </p>
    </div>
  );
}

export default BrainStatusBadge;
