'use client';

/**
 * API keys management — the page the DX Platform lens's "API keys" card
 * has always linked to (FIX-dx-platform-012: the link used to land on a
 * raw "Cannot GET /api-keys" because this route did not exist).
 *
 * Backed by /api/auth/api-keys: list shows prefixes only; creating a key
 * returns the raw key exactly once; revoking deletes it for good.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { KeyRound, Loader2, Trash2, Plus, ArrowLeft } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';

interface ApiKeyRow {
  id: string;
  keyPrefix: string;
  name: string;
  scopes?: string[];
  createdAt?: string;
  lastUsedAt?: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('');
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiHelpers.auth.apiKeys.list();
      const data = r.data as { apiKeys?: ApiKeyRow[] };
      setKeys(data.apiKeys || []);
      setError('');
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 401 ? 'Sign in to manage your API keys.' : 'Could not load your API keys — try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError('');
    setFreshKey(null);
    try {
      const r = await apiHelpers.auth.apiKeys.create({
        name: name.trim(),
        scopes: scopes.split(',').map((x) => x.trim()).filter(Boolean),
      });
      const data = r.data as { apiKey?: string };
      if (data.apiKey) setFreshKey(data.apiKey);
      setName('');
      setScopes('');
      await load();
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 403
        ? 'Key creation is restricted to workspace owners and admins. Your existing keys are listed below.'
        : 'The key could not be created — try again.');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await apiHelpers.auth.apiKeys.delete(id);
      setConfirmRevokeId(null);
      await load();
    } catch {
      setError('That key could not be revoked — it may already be gone. The list has been refreshed.');
      await load();
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <header className="space-y-1">
        <Link href="/lenses/dx-platform" className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-3 w-3" /> DX Platform
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
          <KeyRound className="h-5 w-5 text-cyan-300" /> API keys
        </h1>
        <p className="text-sm text-zinc-400">Keys for programmatic access and the editor plugins. A key&rsquo;s secret is shown once, at creation — store it then.</p>
      </header>

      {error && <p role="alert" className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}

      {freshKey && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 space-y-1">
          <p className="text-xs font-medium text-emerald-200">Your new key — save it now. It cannot be retrieved again.</p>
          <p className="font-mono text-xs text-emerald-100 break-all select-all">{freshKey}</p>
        </div>
      )}

      <section className="rounded-2xl border border-white/10 bg-[#111] p-4 space-y-3">
        <h2 className="text-sm font-medium text-white">Create a key</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="api-key-name" className="text-xs text-zinc-400">Name</label>
            <input id="api-key-name" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
              placeholder="VS Code on my laptop"
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-zinc-100" />
          </div>
          <div>
            <label htmlFor="api-key-scopes" className="text-xs text-zinc-400">Scopes (comma-separated, optional)</label>
            <input id="api-key-scopes" name="scopes" value={scopes} onChange={(e) => setScopes(e.target.value)}
              placeholder="read, run"
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-zinc-100" />
          </div>
        </div>
        <button type="button" onClick={() => void create()} disabled={!name.trim() || creating}
          className="inline-flex items-center gap-1 rounded bg-cyan-500/20 border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-100 disabled:opacity-40">
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create key
        </button>
        {!name.trim() && <p className="text-[11px] text-zinc-500" role="note">Name the key to create it.</p>}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#111] p-4 space-y-2">
        <h2 className="text-sm font-medium text-white">Your keys</h2>
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-xs text-zinc-400">No API keys yet.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-100">{k.name}</p>
                  <p className="font-mono text-[11px] text-zinc-500">
                    {k.keyPrefix} · {(k.scopes || []).join(', ') || 'no scopes'} · created {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : '—'} · last used {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'never'}
                  </p>
                </div>
                {confirmRevokeId === k.id ? (
                  <span className="flex items-center gap-1">
                    <button type="button" onClick={() => void revoke(k.id)} className="rounded border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-100">Revoke for good</button>
                    <button type="button" onClick={() => setConfirmRevokeId(null)} className="rounded border border-white/10 px-2 py-1 text-[11px] text-zinc-300">Keep</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmRevokeId(k.id)} aria-label={`Revoke ${k.name}`}
                    className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[11px] text-zinc-300 hover:text-rose-200">
                    <Trash2 className="h-3 w-3" /> Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
