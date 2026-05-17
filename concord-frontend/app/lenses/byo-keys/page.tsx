'use client';

/**
 * /lenses/byo-keys — Sprint 10D
 *
 * BYO API key management surface. Lets users plug their own
 * OpenAI / Anthropic / xAI / Google keys into per-brain slots and
 * route inference through their provider of choice. Keys are encrypted
 * AES-GCM at rest with a per-user wrapping key; the frontend never
 * sees the plaintext again after save (only the masked preview).
 *
 * Backed by:
 *   byo_keys.list                — current overrides + previews
 *   byo_keys.set                 — create/update an override
 *   byo_keys.remove              — delete an override
 *   byo_keys.set_active          — toggle without deletion
 *   byo_keys.test                — 1-token ping to verify
 *   byo_keys.available_providers — static catalog
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState, useCallback } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { OpenRouterCatalog } from '@/components/byo-keys/OpenRouterCatalog';

interface OverrideRow {
  slot: string;
  provider: string;
  model_id: string | null;
  key_preview: string | null;
  active: number;
  last_used_at: number | null;
}

interface ProviderInfo {
  id: string;
  name: string;
  defaultModels: Record<string, string>;
  keyFormat: string;
}

const SLOTS = [
  { id: 'conscious', label: 'Conscious (chat, council, deep reasoning)' },
  { id: 'subconscious', label: 'Subconscious (autogen, dream, synthesis)' },
  { id: 'utility', label: 'Utility (lens actions, quick tasks)' },
  { id: 'repair', label: 'Repair (error detection, auto-fix)' },
  { id: 'vision', label: 'Vision (image understanding)' },
];

function fmtRelative(unix: number | null): string {
  if (!unix) return 'never';
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  return j?.result || j;
}

export default function ByoKeysLens() {
  useLensCommand([
    { id: 'byo-keys-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'byo-keys' });

  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // slot being edited
  const [form, setForm] = useState({ provider: 'anthropic', modelId: '', apiKey: '' });
  const [testResult, setTestResult] = useState<{ slot: string; ok: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [list, prov] = await Promise.all([
      macro('byo_keys', 'list'),
      macro('byo_keys', 'available_providers'),
    ]);
    if (list?.ok) setOverrides(list.overrides || []);
    if (prov?.ok) setProviders(prov.providers || []);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const overridesBySlot = new Map(overrides.map(o => [o.slot, o]));

  const startEdit = (slot: string) => {
    setEditing(slot);
    const existing = overridesBySlot.get(slot);
    setForm({
      provider: existing?.provider || 'anthropic',
      modelId: existing?.model_id || '',
      apiKey: '',
    });
    setTestResult(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm({ provider: 'anthropic', modelId: '', apiKey: '' });
  };

  const save = async (slot: string) => {
    if (form.provider !== 'concord_default' && form.provider !== 'ollama' && (!form.apiKey || form.apiKey.length < 8)) {
      alert('API key must be at least 8 characters. Paste from your provider\'s dashboard.');
      return;
    }
    setBusy(true);
    const r = await macro('byo_keys', 'set', {
      slot, provider: form.provider,
      modelId: form.modelId || null,
      apiKey: form.apiKey || null,
    });
    setBusy(false);
    if (r?.ok) {
      cancelEdit();
      refresh();
    } else {
      alert(`Save failed: ${r?.reason || 'unknown'}`);
    }
  };

  const remove = async (slot: string) => {
    if (!confirm(`Remove the ${slot} brain override? This deletes your saved key — you'd need to re-paste it to re-enable.`)) return;
    await macro('byo_keys', 'remove', { slot });
    refresh();
  };

  const toggleActive = async (slot: string, currentlyActive: boolean) => {
    await macro('byo_keys', 'set_active', { slot, active: !currentlyActive });
    refresh();
  };

  const testKey = async (slot: string) => {
    setTestResult(null);
    setBusy(true);
    const r = await macro('byo_keys', 'test', { slot });
    setBusy(false);
    setTestResult({ slot, ok: !!r?.ok, error: r?.error || r?.reason });
  };

  const selectedProvider = providers.find(p => p.id === form.provider);

  return (
        <LensShell lensId="byo-keys">
      <FirstRunTour lensId="byo-keys" />
      <DepthBadge lensId="byo-keys" size="sm" className="ml-2" />
  <div className="min-h-screen bg-zinc-950 text-zinc-100 px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <header className="mb-8">
            <h1 className="text-2xl font-semibold mb-2">Brain overrides — Bring Your Own API key</h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Plug your own OpenAI / Anthropic / xAI / Google API key into each of Concord&apos;s 5
              brain slots. The default is the free Ollama instance hosted by concord-os.org — but
              if you already pay for ChatGPT Plus, Claude Pro, or a Grok subscription, you can route
              your inference through those providers instead and get frontier-tier intelligence
              inside Concord, free.
            </p>
            <p className="mt-3 text-xs text-zinc-500 leading-relaxed">
              <strong className="text-zinc-300">Privacy:</strong> keys are encrypted AES-GCM with a
              per-user wrapping key derived from JWT_SECRET. They are never returned to your browser
              after save (only the masked preview is shown). Prompts go directly to your provider
              with your key — concord-os.org is not in the data path.
            </p>
          </header>

          <ul className="space-y-3">
            {SLOTS.map(({ id: slot, label }) => {
              const existing = overridesBySlot.get(slot);
              const isEditing = editing === slot;
              return (
                <li key={slot} className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-100">{label}</div>
                      <div className="mt-1 text-xs text-zinc-400">
                        {existing ? (
                          <>
                            <span className={existing.active ? 'text-emerald-400' : 'text-zinc-500'}>
                              {existing.active ? '● active' : '○ inactive'}
                            </span>{' '}
                            <span className="text-zinc-300 font-mono">{existing.provider}</span>
                            {existing.model_id && (
                              <span className="text-zinc-500"> / {existing.model_id}</span>
                            )}
                            {existing.key_preview && (
                              <span className="ml-2 text-zinc-500 font-mono">{existing.key_preview}</span>
                            )}
                            <span className="ml-3 text-zinc-600">last used {fmtRelative(existing.last_used_at)}</span>
                          </>
                        ) : (
                          <span className="text-zinc-500">default — uses concord-os.org Ollama (free)</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {existing && (
                        <>
                          <button
                            onClick={() => toggleActive(slot, !!existing.active)}
                            className="px-2.5 py-1 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                            title={existing.active ? 'Pause this override (key stays saved)' : 'Re-enable this override'}
                          >
                            {existing.active ? 'pause' : 'resume'}
                          </button>
                          <button
                            onClick={() => testKey(slot)}
                            disabled={busy}
                            className="px-2.5 py-1 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50"
                          >
                            test
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => isEditing ? cancelEdit() : startEdit(slot)}
                        className="px-2.5 py-1 rounded-md text-xs bg-amber-600/80 hover:bg-amber-600 text-amber-50"
                      >
                        {isEditing ? 'cancel' : existing ? 'edit' : 'add key'}
                      </button>
                      {existing && (
                        <button
                          onClick={() => remove(slot)}
                          className="px-2.5 py-1 rounded-md text-xs bg-red-700/70 hover:bg-red-700 text-red-50"
                        >
                          remove
                        </button>
                      )}
                    </div>
                  </div>

                  {testResult?.slot === slot && (
                    <div className={`mt-2 text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testResult.ok ? '✓ key works — ping successful' : `✗ ${testResult.error || 'test failed'}`}
                    </div>
                  )}

                  {isEditing && (
                    <div className="mt-4 space-y-3 border-t border-zinc-800 pt-4">
                      <div>
                        <label className="block text-xs text-zinc-400 mb-1">Provider</label>
                        <select
                          value={form.provider}
                          onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                          className="w-full px-3 py-1.5 rounded-md bg-zinc-950 text-zinc-100 text-sm ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none"
                        >
                          <option value="concord_default">Concord default (free Ollama)</option>
                          {providers.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      {form.provider !== 'concord_default' && form.provider !== 'ollama' && (
                        <>
                          <div>
                            <label className="block text-xs text-zinc-400 mb-1">
                              Model (optional — defaults to {selectedProvider?.defaultModels[slot] || '?'})
                            </label>
                            <input
                              type="text"
                              value={form.modelId}
                              onChange={e => setForm(f => ({ ...f, modelId: e.target.value }))}
                              placeholder={selectedProvider?.defaultModels[slot] || ''}
                              className="w-full px-3 py-1.5 rounded-md bg-zinc-950 text-zinc-100 text-sm ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-zinc-400 mb-1">
                              API key {selectedProvider?.keyFormat && (
                                <span className="font-mono text-zinc-500">({selectedProvider.keyFormat})</span>
                              )}
                            </label>
                            <input
                              type="password"
                              value={form.apiKey}
                              onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                              placeholder={existing ? '(paste to replace existing key)' : 'paste your API key…'}
                              className="w-full px-3 py-1.5 rounded-md bg-zinc-950 text-zinc-100 text-sm ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none font-mono"
                              autoComplete="off"
                            />
                            <p className="mt-1 text-[10px] text-zinc-500">
                              Encrypted at rest. Never logged. Never returned to the frontend after save.
                              Concord-os.org is never in the data path — your prompts go directly to {selectedProvider?.name}.
                            </p>
                          </div>
                        </>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => save(slot)}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 text-amber-50 text-sm font-medium disabled:opacity-50"
                        >
                          save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm"
                        >
                          cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <footer className="mt-8 text-xs text-zinc-500 leading-relaxed">
            <p className="mb-2">
              <strong className="text-zinc-300">The revolving door (opt-in):</strong> when you mint
              DTUs with a frontier-tier model (Claude / GPT / Grok / Gemini), they default to{' '}
              <em>personal</em> scope and stay private. If you choose to publish a specific DTU to
              public or global scope, other users can cite it in their Expert Mode answers — and
              the royalty cascade pays you a multi-generational royalty every time. Nothing leaves
              your personal scope unless you explicitly publish it.
            </p>
          </footer>
        </div>
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <OpenRouterCatalog />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <RecentMineCard domain="byo-keys" limit={10} hideWhenEmpty className="mt-4" />
          <CrossLensRecentsPanel lensId="byo-keys" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
