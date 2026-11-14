'use client';

// App connector catalog with OAuth-style connect/disconnect. Browses the
// integrations domain connector catalog, shows pre-built triggers/actions per
// SaaS app, and mints/destroys stored connection records.

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plug, Search, Loader2, Check, Link2, Unlink, Zap, Send, ShieldAlert, KeyRound, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Connector {
  id: string;
  name: string;
  category: string;
  authType: string;
  scopes: string[];
  triggers: Array<{ id: string; label: string }>;
  actions: Array<{ id: string; label: string }>;
}

interface Connection {
  id: string;
  connectorId: string;
  connectorName: string;
  label: string;
  authType: string;
  account: string;
  status: string;
  createdAt: string;
  // Honesty (Track C): credentialStored is true ONLY when a real OAuth token
  // exists in connector_oauth_tokens. needsOauth flags an oauth2 connector the
  // user has selected but not yet authorized — the real egress path refuses it.
  credentialStored?: boolean;
  needsOauth?: boolean;
}

export function ConnectorCatalog() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // FIX-integrations-003: per-connector API-key status (stored + last-4
  // hint only — the key itself is never returned) and the entry draft.
  // The draft lives in component state only and is cleared on save.
  const [keyInfo, setKeyInfo] = useState<Record<string, { stored: boolean; hint: string | null }>>({});
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [keyBusy, setKeyBusy] = useState<string | null>(null);

  const loadKeyStatus = useCallback(async (connectorId: string) => {
    const r = await lensRun<{ stored: boolean; hint: string | null }>('integrations', 'apiKeyStatus', { connectorId });
    if (r.data.ok && r.data.result) {
      setKeyInfo((prev) => ({ ...prev, [connectorId]: { stored: !!r.data.result.stored, hint: r.data.result.hint ?? null } }));
    }
  }, []);

  const saveKey = async (c: Connector) => {
    const apiKey = (keyDraft[c.id] || '').trim();
    if (!apiKey) return;
    setKeyBusy(c.id);
    setError(null);
    try {
      const r = await lensRun('integrations', 'setApiKey', { connectorId: c.id, apiKey });
      if (r.data.ok) {
        setKeyDraft((prev) => ({ ...prev, [c.id]: '' }));
        await loadKeyStatus(c.id);
      } else setError(r.data.error || 'Could not store the key');
    } finally { setKeyBusy(null); }
  };

  const revokeKey = async (c: Connector) => {
    setKeyBusy(c.id);
    try {
      await lensRun('integrations', 'removeApiKey', { connectorId: c.id });
      await loadKeyStatus(c.id);
      await loadConnections();
    } finally { setKeyBusy(null); }
  };

  const loadConnections = useCallback(async () => {
    const r = await lensRun<{ connections: Connection[] }>('integrations', 'connectionList', {});
    if (r.data.ok && r.data.result) setConnections(r.data.result.connections || []);
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ connectors: Connector[]; categories: string[] }>(
      'integrations', 'connectorCatalog', { category: category || undefined, search: search || undefined },
    );
    if (r.data.ok && r.data.result) {
      setConnectors(r.data.result.connectors || []);
      if (r.data.result.categories) setCategories(r.data.result.categories);
    }
    setLoading(false);
  }, [category, search]);

  useEffect(() => { loadConnections(); }, [loadConnections]);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    for (const c of connectors) if (c.authType === 'api_key') void loadKeyStatus(c.id);
  }, [connectors, loadKeyStatus]);

  const connect = async (c: Connector) => {
    setBusy(c.id);
    setError(null);
    try {
      const r = await lensRun('integrations', 'connectApp', { connectorId: c.id });
      if (r.data.ok) await loadConnections();
      else setError(r.data.error || 'Connect refused — no credential stored');
    } finally { setBusy(null); }
  };

  const disconnect = async (conn: Connection) => {
    setBusy(conn.id);
    try {
      const r = await lensRun('integrations', 'disconnectApp', { connectionId: conn.id });
      if (r.data.ok) await loadConnections();
    } finally { setBusy(null); }
  };

  const connectionFor = (connectorId: string) => connections.find((c) => c.connectorId === connectorId);

  return (
    <div className="space-y-4">
      {/* Active connections strip */}
      {connections.length > 0 && (
        <div className="panel p-3">
          <div className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1">
            <Link2 className="w-3.5 h-3.5 text-neon-green" /> Linked accounts ({connections.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {connections.map((conn) => (
              <div key={conn.id} className="flex items-center gap-2 bg-lattice-surface rounded px-2 py-1 text-xs">
                <span className={conn.credentialStored ? 'text-neon-green' : 'text-yellow-400'}>{conn.connectorName}</span>
                {conn.account ? <span className="text-gray-400">· {conn.account}</span> : null}
                {!conn.credentialStored && (
                  <span className="text-[10px] text-yellow-400/80 flex items-center gap-0.5" title="No OAuth token stored — real egress refused until authorized">
                    <ShieldAlert className="w-3 h-3" /> needs auth
                  </span>
                )}
                <button
                  onClick={() => disconnect(conn)}
                  disabled={busy === conn.id}
                  aria-label={`Disconnect ${conn.connectorName}`}
                  className="text-gray-400 hover:text-red-400 disabled:opacity-40"
                >
                  {busy === conn.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                </button>
              </div>
            ))}
          </div>
          {connections.some((c) => !c.credentialStored) && (
            <p className="mt-2 text-[10px] text-gray-500">
              A linked app without a stored credential cannot egress. Complete OAuth (or supply a real API key when that path lands) before Concord can read or send on your behalf.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="text-xs text-rose-400" role="alert">{error}</p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-lattice-surface border border-lattice-border rounded px-2">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps"
            className="bg-transparent py-1.5 text-sm w-40 focus:outline-none"
          />
        </div>
        <button
          onClick={() => setCategory('')}
          className={`text-xs px-2 py-1 rounded ${category === '' ? 'bg-neon-green/20 text-neon-green' : 'bg-lattice-surface text-gray-400'}`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`text-xs px-2 py-1 rounded capitalize ${category === cat ? 'bg-neon-green/20 text-neon-green' : 'bg-lattice-surface text-gray-400'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 p-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading connector catalog...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {connectors.map((c, i) => {
            const conn = connectionFor(c.id);
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="panel p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Plug className="w-5 h-5 text-neon-cyan" />
                    <div>
                      <h3 className="font-semibold text-sm">{c.name}</h3>
                      <span className="text-[10px] uppercase tracking-wide text-gray-400">{c.category} · {c.authType}</span>
                    </div>
                  </div>
                  {conn ? (
                    conn.credentialStored ? (
                      <span className="text-xs text-neon-green flex items-center gap-1" title="Real OAuth credential stored — egress is live">
                        <Check className="w-3 h-3" /> Connected
                      </span>
                    ) : (
                      <span
                        className="text-xs text-yellow-400 flex items-center gap-1"
                        title="Selected but not yet authorized. No OAuth token is stored, so the real egress path will refuse this connector until you complete the OAuth flow."
                      >
                        <ShieldAlert className="w-3 h-3" /> Needs auth
                      </span>
                    )
                  ) : c.authType === 'api_key' ? (
                    keyInfo[c.id]?.stored ? (
                      <span className="text-xs text-neon-green flex items-center gap-1" title="An encrypted API key is stored for this connector">
                        <KeyRound className="w-3 h-3" /> Key stored{keyInfo[c.id]?.hint ? ` ••••${keyInfo[c.id].hint}` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-yellow-400 flex items-center gap-1" title="This connector needs an API key — paste it below to store it encrypted">
                        <ShieldAlert className="w-3 h-3" /> Needs API key
                      </span>
                    )
                  ) : (
                    <button
                      onClick={() => connect(c)}
                      disabled={busy === c.id}
                      className="btn-secondary text-xs px-2 py-1 flex items-center gap-1"
                    >
                      {busy === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                      {c.authType === 'oauth2' ? 'Select' : 'Connect'}
                    </button>
                  )}
                </div>
                {!conn && c.authType === 'api_key' && (
                  keyInfo[c.id]?.stored ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => connect(c)}
                        disabled={busy === c.id}
                        className="btn-secondary text-xs px-2 py-1 flex items-center gap-1"
                      >
                        {busy === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />} Connect
                      </button>
                      <button
                        onClick={() => revokeKey(c)}
                        disabled={keyBusy === c.id}
                        aria-label={`Revoke the stored ${c.name} API key`}
                        title="Revoke the stored key"
                        className="text-xs px-2 py-1 flex items-center gap-1 text-gray-400 hover:text-red-400 disabled:opacity-40"
                      >
                        <Trash2 className="w-3 h-3" /> Revoke key
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`apikey-${c.id}`}>{c.name} API key</label>
                      <input
                        id={`apikey-${c.id}`}
                        type="password"
                        autoComplete="off"
                        placeholder={`${c.name} API key`}
                        value={keyDraft[c.id] || ''}
                        onChange={(e) => setKeyDraft((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        className="flex-1 min-w-0 bg-lattice-surface rounded px-2 py-1.5 text-xs text-gray-100 placeholder:text-gray-500"
                      />
                      <button
                        onClick={() => saveKey(c)}
                        disabled={keyBusy === c.id || !(keyDraft[c.id] || '').trim()}
                        className="btn-secondary text-xs px-2 py-1 flex items-center gap-1"
                      >
                        {keyBusy === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />} Save key
                      </button>
                    </div>
                  )
                )}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-gray-400 flex items-center gap-1 mb-0.5"><Zap className="w-3 h-3" /> Triggers</div>
                    {c.triggers.map((t) => <div key={t.id} className="text-gray-300 truncate">· {t.label}</div>)}
                  </div>
                  <div>
                    <div className="text-gray-400 flex items-center gap-1 mb-0.5"><Send className="w-3 h-3" /> Actions</div>
                    {c.actions.map((a) => <div key={a.id} className="text-gray-300 truncate">· {a.label}</div>)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {c.scopes.map((sc) => (
                    <span key={sc} className="text-[9px] bg-lattice-surface px-1.5 py-0.5 rounded font-mono text-gray-400">{sc}</span>
                  ))}
                </div>
              </motion.div>
            );
          })}
          {connectors.length === 0 && (
            <div className="col-span-full panel p-6 text-center text-sm text-gray-400">
              No connectors match your filters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
