'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro } from './_macro';

export function RealmPanel() {
  const [exiles, setExiles] = useState<Array<{ realm_id: string; reason: string; expires_at: number | null }>>([]);
  const refresh = useCallback(async () => {
    const r = await macro('realm_access', 'list_my_exiles');
    if (r?.ok) setExiles(r.exiles || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">My exiles</h3>
      {exiles.length === 0 ? <p className="text-zinc-400 text-xs italic">Welcome everywhere. No active exiles.</p> : (
        <ul className="space-y-1">
          {exiles.map((e) => (
            <li key={e.realm_id} className="text-xs bg-zinc-900/50 border border-red-900/40 rounded p-2">
              <span className="text-red-300">{e.realm_id}</span>
              <span className="ml-2 text-zinc-400">{e.reason}</span>
              {e.expires_at && <span className="ml-2 text-zinc-600">expires {new Date(e.expires_at * 1000).toLocaleDateString()}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
