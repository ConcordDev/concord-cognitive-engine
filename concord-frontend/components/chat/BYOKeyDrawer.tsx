'use client';

// BYOKeyDrawer — slide-in drawer for managing per-brain BYO API keys.
// Connects to the backend `byo_keys.{list,set,remove,set_active,test,
// available_providers}` macros via /api/lens/run. Keys are encrypted
// AES-GCM at rest with a per-user wrap key derived from JWT_SECRET; the
// backend never returns plaintext after save (only previews).
//
// Renders:
//   - Top: provider × model picker + API key input + slot dropdown
//   - List below: existing overrides with toggle / test / remove
//
// Closed by clicking the backdrop or the X button. Mounted from the
// chat lens persona picker (key icon next to persona name).

import { useEffect, useState, useCallback } from 'react';
import { Key, X, Trash2, CheckCircle, Power, Loader2 } from 'lucide-react';

interface OverrideRow {
  slot: string;
  provider: string;
  model_id: string | null;
  active: number | boolean;
  key_preview: string | null;
  created_at: number | string;
}

interface ProviderInfo {
  id: string;
  label: string;
  models: string[];
}

interface BYOKeyDrawerProps {
  open: boolean;
  onClose: () => void;
}

const SLOTS = [
  { id: 'conscious', label: 'Conscious (chat)' },
  { id: 'subconscious', label: 'Subconscious (autogen / dreams)' },
  { id: 'utility', label: 'Utility (formatting / extract)' },
  { id: 'repair', label: 'Repair (error fixes)' },
];

async function runMacro<T = unknown>(domain: string, name: string, input?: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/lens/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ domain, name, input: input || {} }),
  });
  if (!res.ok) throw new Error(`${domain}.${name} failed`);
  return (await res.json()) as T;
}

export default function BYOKeyDrawer({ open, onClose }: BYOKeyDrawerProps) {
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [slot, setSlot] = useState<string>('conscious');
  const [provider, setProvider] = useState<string>('anthropic');
  const [modelId, setModelId] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const list = await runMacro<{ ok: boolean; overrides?: OverrideRow[]; reason?: string }>(
        'byo_keys', 'list'
      );
      if (list.ok && Array.isArray(list.overrides)) setOverrides(list.overrides);
      else if (list.reason === 'no_actor') setErrorMsg('Sign in to manage BYO keys.');
      const p = await runMacro<{ ok: boolean; providers?: ProviderInfo[] }>(
        'byo_keys', 'available_providers'
      );
      if (p.ok && Array.isArray(p.providers)) setProviders(p.providers);
    } catch (e) {
      setErrorMsg((e as Error).message || 'Failed to load BYO keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  const save = async () => {
    if (!apiKey.trim()) { setErrorMsg('API key is required.'); return; }
    setSaving(true);
    setErrorMsg(null);
    setOkMsg(null);
    try {
      const r = await runMacro<{ ok: boolean; reason?: string; error?: string }>(
        'byo_keys', 'set',
        { slot, provider, modelId: modelId || undefined, apiKey: apiKey.trim() }
      );
      if (r.ok) {
        setOkMsg(`${provider} key saved for ${slot}.`);
        setApiKey('');
        await refresh();
      } else {
        setErrorMsg(r.error || r.reason || 'Save failed.');
      }
    } catch (e) {
      setErrorMsg((e as Error).message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (slotId: string) => {
    if (!confirm(`Remove BYO key for ${slotId}?`)) return;
    try {
      await runMacro('byo_keys', 'remove', { slot: slotId });
      await refresh();
    } catch (e) {
      setErrorMsg((e as Error).message || 'Remove failed.');
    }
  };

  const toggle = async (slotId: string, currentlyActive: boolean) => {
    try {
      await runMacro('byo_keys', 'set_active', { slot: slotId, active: !currentlyActive });
      await refresh();
    } catch (e) {
      setErrorMsg((e as Error).message || 'Toggle failed.');
    }
  };

  const test = async (slotId: string) => {
    setTesting(slotId);
    setErrorMsg(null);
    setOkMsg(null);
    try {
      const r = await runMacro<{ ok: boolean; latency?: number; error?: string }>(
        'byo_keys', 'test', { slot: slotId }
      );
      if (r.ok) setOkMsg(`${slotId} key responded in ${r.latency ?? '?'}ms.`);
      else setErrorMsg(r.error || `${slotId} key test failed.`);
    } catch (e) {
      setErrorMsg((e as Error).message || 'Test failed.');
    } finally {
      setTesting(null);
    }
  };

  const currentProvider = providers.find((p) => p.id === provider);
  const modelOptions = currentProvider?.models || [];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby="byo-key-title">
      <button
        className="flex-1 bg-black/60 backdrop-blur-sm cursor-default"
        onClick={onClose}
        aria-label="Close drawer"
      />
      <aside className="w-full max-w-md bg-zinc-950 border-l border-white/10 overflow-y-auto p-5 text-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 id="byo-key-title" className="text-base font-semibold flex items-center gap-2">
            <Key className="w-4 h-4 text-neon-cyan" /> BYO API Keys
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Plug your own Anthropic / OpenAI / xAI / Google key into a brain slot. Your key
          is encrypted at rest and never returned to the browser after save.
        </p>

        {errorMsg && <div className="mb-3 p-2 rounded bg-red-500/15 border border-red-400/30 text-red-300 text-xs">{errorMsg}</div>}
        {okMsg && <div className="mb-3 p-2 rounded bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs">{okMsg}</div>}

        <fieldset className="space-y-2 mb-5 p-3 rounded-lg border border-white/10 bg-white/[0.02]">
          <legend className="px-1 text-xs uppercase tracking-wide text-gray-500">Add / replace</legend>
          <label className="block">
            <span className="text-xs text-gray-400">Slot</span>
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm"
            >
              {SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">Provider</span>
            <select
              value={provider}
              onChange={(e) => { setProvider(e.target.value); setModelId(''); }}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm"
            >
              {providers.length === 0
                ? <option value="anthropic">anthropic</option>
                : providers.map((p) => <option key={p.id} value={p.id}>{p.label || p.id}</option>)}
            </select>
          </label>
          {modelOptions.length > 0 && (
            <label className="block">
              <span className="text-xs text-gray-400">Model (optional override)</span>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm"
              >
                <option value="">(provider default)</option>
                {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-xs text-gray-400">API key</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-… / sk-… / xai-… / AIza…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm font-mono"
            />
          </label>
          <button
            onClick={save}
            disabled={saving || !apiKey.trim()}
            className="mt-1 w-full px-3 py-1.5 rounded bg-neon-cyan/20 hover:bg-neon-cyan/30 border border-neon-cyan/40 text-neon-cyan disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : 'Save key'}
          </button>
        </fieldset>

        <div>
          <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Active overrides</h3>
          {loading ? (
            <p className="text-xs text-gray-500">Loading…</p>
          ) : overrides.length === 0 ? (
            <p className="text-xs text-gray-500">No overrides yet — Concord uses its built-in 5-brain Ollama setup.</p>
          ) : (
            <ul className="space-y-2">
              {overrides.map((o) => {
                const isActive = !!o.active;
                return (
                  <li key={o.slot} className="p-2 rounded border border-white/10 bg-white/[0.02]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{o.slot}</div>
                        <div className="text-[11px] text-gray-400 font-mono truncate">
                          {o.provider}{o.model_id ? ` · ${o.model_id}` : ''} · {o.key_preview || '••••'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => test(o.slot)}
                          disabled={testing === o.slot}
                          className="p-1.5 rounded text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50"
                          aria-label={`Test ${o.slot} key`}
                          title="Test connection"
                        >
                          {testing === o.slot ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => toggle(o.slot, isActive)}
                          className={`p-1.5 rounded ${isActive ? 'text-neon-cyan hover:bg-neon-cyan/15' : 'text-gray-500 hover:bg-white/5'}`}
                          aria-label={`${isActive ? 'Disable' : 'Enable'} ${o.slot} override`}
                          title={isActive ? 'Active — click to disable' : 'Disabled — click to enable'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => remove(o.slot)}
                          className="p-1.5 rounded text-red-400 hover:bg-red-500/15"
                          aria-label={`Remove ${o.slot} override`}
                          title="Remove"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
