'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/client';

interface Guild {
  id: string;
  name: string;
  type: string;
  description: string;
  leaderId?: string;
  bankSparks?: number;
  memberCount?: number;
}

interface GuildProgression {
  org_level: number;
  org_xp: number;
  hall_building_id: string | null;
}

interface BankItem {
  item_kind: string;
  item_descriptor: string;
  quantity: number;
  deposited_by: string;
  deposited_at: number;
}

interface InventoryItem {
  id: string;
  item_id: string;
  item_name: string;
  quantity: number;
}

interface GuildPanelProps {
  playerId: string;
  onClose: () => void;
}

// 100 * level^2 — must match server/lib/guild-substrate.js#DEFAULT_XP_CURVE.
const nextLevelXp = (level: number) => 100 * level * level;

export function GuildPanel({ playerId, onClose }: GuildPanelProps) {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [myGuild, setMyGuild] = useState<Guild | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [joining, setJoining] = useState<string | null>(null);
  const [tab, setTab] = useState<'mine' | 'browse'>('mine');

  // Guild bank / XP / hall — the Phase BC1 substrate (server/lib/guild-substrate.js),
  // previously fully built but unreachable from any route. See routes/world-orgs-extended.js.
  const [progression, setProgression] = useState<GuildProgression | null>(null);
  const [bankItems, setBankItems] = useState<BankItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [depositItemId, setDepositItemId] = useState('');
  const [depositQty, setDepositQty] = useState(1);
  const [depositing, setDepositing] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    api.get('/api/world/orgs').then(r => {
      const all: Guild[] = r.data?.organizations ?? [];
      setGuilds(all);
      setMyGuild(all.find(g => g.leaderId === playerId) ?? null);
    }).finally(() => setLoading(false));
  }, [playerId]);

  useEffect(() => { reload(); }, [reload]);

  const reloadGuildSubstrate = useCallback((orgId: string) => {
    api.get(`/api/world-orgs/${orgId}/progression`).then(r => {
      setProgression(r.data?.progression ?? null);
    }).catch(() => setProgression(null));
    api.get(`/api/world-orgs/${orgId}/bank`).then(r => {
      setBankItems(r.data?.items ?? []);
    }).catch(() => setBankItems([]));
  }, []);

  useEffect(() => {
    if (myGuild) {
      reloadGuildSubstrate(myGuild.id);
      api.get('/api/player-inventory').then(r => {
        setInventory((r.data?.items ?? []).filter((i: InventoryItem) => i.quantity > 0));
      }).catch(() => setInventory([]));
    } else {
      setProgression(null);
      setBankItems([]);
    }
  }, [myGuild, reloadGuildSubstrate]);

  const handleDeposit = useCallback(async () => {
    if (!myGuild || !depositItemId || depositQty <= 0) return;
    setDepositing(true);
    setBankError(null);
    try {
      const res = await api.post(`/api/world-orgs/${myGuild.id}/bank/deposit`, {
        inventoryItemId: depositItemId,
        quantity: depositQty,
      });
      if (res.data?.ok === false) {
        setBankError(res.data.error || 'deposit failed');
      } else {
        setDepositItemId('');
        setDepositQty(1);
        reloadGuildSubstrate(myGuild.id);
        api.get('/api/player-inventory').then(r => {
          setInventory((r.data?.items ?? []).filter((i: InventoryItem) => i.quantity > 0));
        }).catch(() => {});
      }
    } catch (e: any) {
      setBankError(e?.response?.data?.error || 'deposit failed');
    } finally {
      setDepositing(false);
    }
  }, [myGuild, depositItemId, depositQty, reloadGuildSubstrate]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post('/api/world/orgs', { name: newName.trim(), description: newDesc.trim(), type: 'guild', leaderId: playerId });
      setNewName('');
      setNewDesc('');
      reload();
    } finally {
      setCreating(false);
    }
  }, [newName, newDesc, playerId, reload]);

  const handleJoin = useCallback(async (guildId: string) => {
    setJoining(guildId);
    try {
      await api.post(`/api/world/orgs/${guildId}/join`, { userId: playerId });
      reload();
    } finally {
      setJoining(null);
    }
  }, [playerId, reload]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-40">
      <div className="bg-black/90 border border-white/10 rounded-2xl w-full max-w-md mx-4 flex flex-col max-h-[80vh]">
        {/* Header + tabs */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-bold">Guilds</h2>
            <button onClick={onClose} className="text-white/30 hover:text-white">✕</button>
          </div>
          <div className="flex gap-3">
            {(['mine', 'browse'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-xs font-semibold pb-1.5 border-b-2 transition-all capitalize ${tab === t ? 'border-blue-500 text-white' : 'border-transparent text-white/40'}`}
              >
                {t === 'mine' ? 'My Guild' : 'Browse'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="text-white/30 text-sm text-center py-8">Loading…</div>
          ) : tab === 'mine' ? (
            myGuild ? (
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                  <div className="text-white font-bold">{myGuild.name}</div>
                  <div className="text-white/40 text-xs mt-1">{myGuild.description}</div>
                  {myGuild.memberCount !== undefined && (
                    <div className="text-white/30 text-xs mt-1">{myGuild.memberCount} member{myGuild.memberCount !== 1 ? 's' : ''}</div>
                  )}

                  {/* Guild level / XP — server-canonical org_progression (guild-substrate.js) */}
                  {progression && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-purple-300 font-bold">Level {progression.org_level}</span>
                        <span className="text-white/30 font-mono">
                          {progression.org_xp} / {nextLevelXp(progression.org_level)} XP
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/10 mt-1 overflow-hidden">
                        <div
                          className="h-full bg-purple-500"
                          style={{
                            width: `${Math.min(100, (progression.org_xp / Math.max(1, nextLevelXp(progression.org_level))) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="text-white/30 text-[10px] mt-1">
                        {progression.hall_building_id ? '🏛 Guild hall claimed' : 'No guild hall claimed yet'}
                      </div>
                    </div>
                  )}
                </div>

                {/* Guild bank — org_inventory, real shared storage */}
                <div className="p-4 rounded-xl border border-white/10 space-y-2">
                  <div className="text-white text-xs font-semibold">Guild Bank</div>
                  {bankItems.length === 0 ? (
                    <div className="text-white/30 text-xs">Empty. Contribute an item below.</div>
                  ) : (
                    <div className="space-y-1">
                      {bankItems.map(item => (
                        <div key={item.item_descriptor} className="flex items-center justify-between text-xs">
                          <span className="text-white/70">{item.item_descriptor}</span>
                          <span className="text-white/40 font-mono">×{item.quantity}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {inventory.length > 0 && (
                    <div className="flex gap-2 pt-2 border-t border-white/5">
                      <select
                        value={depositItemId}
                        onChange={e => setDepositItemId(e.target.value)}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-white/30"
                      >
                        <option value="">Choose item…</option>
                        {inventory.map(item => (
                          <option key={item.id} value={item.id}>
                            {item.item_name || item.item_id} (×{item.quantity})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={depositQty}
                        onChange={e => setDepositQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-14 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-white/30"
                      />
                      <button
                        onClick={handleDeposit}
                        disabled={!depositItemId || depositing}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-500 disabled:opacity-30 text-white flex-shrink-0"
                      >
                        {depositing ? '…' : 'Contribute'}
                      </button>
                    </div>
                  )}
                  {bankError && <div className="text-red-400 text-[10px]">{bankError}</div>}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-white/40 text-sm text-center">You're not in a guild.</div>
                <div className="p-4 rounded-xl border border-white/10 space-y-3">
                  <div className="text-white text-xs font-semibold">Create a Guild</div>
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Guild name…"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-white/30"
                  />
                  <textarea
                    value={newDesc}
                    onChange={e => setNewDesc(e.target.value)}
                    placeholder="Description (optional)…"
                    rows={2}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 resize-none focus:outline-none focus:border-white/30"
                  />
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim() || creating}
                    className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold"
                  >
                    {creating ? 'Creating…' : 'Create Guild'}
                  </button>
                </div>
              </div>
            )
          ) : (
            // Browse guilds
            guilds.length === 0 ? (
              <div className="text-white/30 text-sm text-center py-8">No guilds yet. Be the first to create one.</div>
            ) : (
              guilds.map(g => (
                <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl border border-white/8 hover:border-white/15 transition-all">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium">{g.name}</div>
                    <div className="text-white/40 text-xs">{g.description?.slice(0, 60)}</div>
                    {g.memberCount !== undefined && <div className="text-white/20 text-[10px] mt-0.5">{g.memberCount} members</div>}
                  </div>
                  <button
                    onClick={() => handleJoin(g.id)}
                    disabled={joining === g.id || g.leaderId === playerId}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white flex-shrink-0"
                  >
                    {joining === g.id ? '…' : g.leaderId === playerId ? 'Yours' : 'Join'}
                  </button>
                </div>
              ))
            )
          )}
        </div>
      </div>
    </div>
  );
}
