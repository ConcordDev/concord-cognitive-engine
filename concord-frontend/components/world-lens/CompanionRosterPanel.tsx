'use client';

/**
 * CompanionRosterPanel — pet/companion HUD.
 *
 * Lists owned companions, lets the player deploy/dismiss/rename. Mounted
 * collapsed by default; opens via the bottom-right pet icon. Reads from
 * `/api/companions?worldId=…` so a companion stranded in another world
 * shows as "stabled" (undeployable until travel).
 *
 * Subscribes to `companion:tame-success` and `companion:level-up` to
 * refresh the roster without polling.
 */

import { useCallback, useEffect, useState } from 'react';
import { Cat, ChevronDown, ChevronUp, Edit2, Power, X } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';

interface Companion {
  id: string;
  owner_id: string;
  creature_id: string;
  name: string;
  tame_bond: number;
  loyalty: number;
  level: number;
  xp: number;
  caught_at: number;
  world_id: string;
  deployed: number;
}

interface Props {
  worldId: string;
}

export function CompanionRosterPanel({ worldId }: Props) {
  const [open, setOpen] = useState(false);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');

  const refresh = useCallback(() => {
    fetch(`/api/companions`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.ok) setCompanions(d.companions); })
      .catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Refresh on companion events.
  useEffect(() => {
    const u1 = subscribe('companion:tame-success', () => refresh());
    const u2 = subscribe('companion:level-up', () => refresh());
    const u3 = subscribe('companion:deployed', () => refresh());
    return () => { u1(); u2(); u3(); };
  }, [refresh]);

  const deploy = async (id: string) => {
    await fetch(`/api/companions/${id}/deploy`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId }),
    });
    refresh();
  };

  const dismiss = async (id: string) => {
    await fetch(`/api/companions/${id}/dismiss`, { method: 'POST', credentials: 'same-origin' });
    refresh();
  };

  const rename = async (id: string) => {
    if (!renameTo.trim()) { setEditing(null); return; }
    await fetch(`/api/companions/${id}/rename`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameTo }),
    });
    setEditing(null);
    setRenameTo('');
    refresh();
  };

  return (
    <div className="absolute bottom-24 right-4 z-30 w-72">
      <div className="rounded-lg border border-pink-500/30 bg-black/70 backdrop-blur-md shadow-lg">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-pink-200 hover:bg-pink-500/10"
        >
          <span className="flex items-center gap-2">
            <Cat className="h-3.5 w-3.5" />
            Companions
            <span className="rounded bg-pink-500/20 px-1.5 py-0.5 text-[10px] tabular-nums">
              {companions.length}
            </span>
          </span>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {open && (
          <div className="max-h-80 overflow-y-auto border-t border-pink-500/20">
            {companions.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-slate-500">
                No companions yet. Get close to a creature, build trust, then press <span className="font-mono">J</span> to attempt a tame.
              </div>
            ) : (
              <ul className="divide-y divide-pink-500/10">
                {companions.map((c) => {
                  const inWorld = c.world_id === worldId;
                  const isDeployed = c.deployed === 1;
                  return (
                    <li key={c.id} className="px-3 py-2">
                      <div className="flex items-center justify-between">
                        {editing === c.id ? (
                          <div className="flex flex-1 items-center gap-1">
                            <input
                              autoFocus
                              value={renameTo}
                              onChange={(e) => setRenameTo(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && rename(c.id)}
                              placeholder={c.name}
                              className="flex-1 rounded bg-slate-800 px-1.5 py-0.5 text-[11px]"
                            />
                            <button onClick={() => rename(c.id)} className="text-[10px] text-emerald-300">save</button>
                            <button onClick={() => setEditing(null)} className="text-[10px] text-slate-500"><X className="h-3 w-3" /></button>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1">
                              <div className="text-[11px] font-medium text-pink-100">{c.name}</div>
                              <div className="text-[9px] text-slate-400">
                                Lv {c.level} · loyalty {Math.round(c.loyalty)} · bond {Math.round(c.tame_bond)}
                                {!inWorld && <span className="ml-2 text-amber-400">[stabled · {c.world_id}]</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => { setEditing(c.id); setRenameTo(c.name); }}
                                className="rounded p-1 text-slate-400 hover:text-pink-200"
                                title="Rename"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                              {inWorld && (isDeployed ? (
                                <button
                                  onClick={() => dismiss(c.id)}
                                  className="rounded bg-rose-500/20 p-1 text-rose-200 hover:bg-rose-500/30"
                                  title="Dismiss"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => deploy(c.id)}
                                  className="rounded bg-emerald-500/20 p-1 text-emerald-200 hover:bg-emerald-500/30"
                                  title="Deploy"
                                >
                                  <Power className="h-3 w-3" />
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
