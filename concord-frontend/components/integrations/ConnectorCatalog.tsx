'use client';

// App connector catalog with OAuth-style connect/disconnect. Browses the
// integrations domain connector catalog, shows pre-built triggers/actions per
// SaaS app, and mints/destroys stored connection records.

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plug, Search, Loader2, Check, Link2, Unlink, Zap, Send } from 'lucide-react';
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
}

export function ConnectorCatalog() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

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

  const connect = async (c: Connector) => {
    setBusy(c.id);
    try {
      const r = await lensRun('integrations', 'connectApp', { connectorId: c.id });
      if (r.data.ok) await loadConnections();
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
            <Link2 className="w-3.5 h-3.5 text-neon-green" /> Connected accounts ({connections.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {connections.map((conn) => (
              <div key={conn.id} className="flex items-center gap-2 bg-lattice-surface rounded px-2 py-1 text-xs">
                <span className="text-neon-green">{conn.connectorName}</span>
                <span className="text-gray-400">· {conn.account}</span>
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
        </div>
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
                    <span className="text-xs text-neon-green flex items-center gap-1">
                      <Check className="w-3 h-3" /> Connected
                    </span>
                  ) : (
                    <button
                      onClick={() => connect(c)}
                      disabled={busy === c.id}
                      className="btn-secondary text-xs px-2 py-1 flex items-center gap-1"
                    >
                      {busy === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                      Connect
                    </button>
                  )}
                </div>
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
