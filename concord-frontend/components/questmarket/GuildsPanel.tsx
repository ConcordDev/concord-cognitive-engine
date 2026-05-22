/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Loader2, Shield, Plus, Users, LogIn, LogOut, ChevronRight, ChevronDown,
  Coins, Trophy, X,
} from 'lucide-react';
import { QuestBoard } from './QuestBoard';

interface Guild {
  id: string;
  name: string;
  description: string;
  founder: string;
  totalXp: number;
  questsCompleted: number;
  memberCount: number;
  isMember: boolean;
  myRole: string | null;
}
interface Member {
  userId: string;
  role: string;
  contributedXp: number;
  questsCompleted: number;
}
interface SharedQuest {
  id: string;
  title: string;
  kind: string;
  reward: number;
  difficulty: string;
  status: string;
  claimCount: number;
}

export function GuildsPanel({ onChanged }: { onChanged?: () => void }) {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ members: Member[]; sharedQuests: SharedQuest[] } | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [gName, setGName] = useState('');
  const [gDesc, setGDesc] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<any>('questmarket', 'listGuilds', {});
    if (r.data?.ok && r.data.result) { setGuilds(r.data.result.guilds || []); setErr(null); }
    else setErr(r.data?.error || 'failed to load guilds');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const openDetail = async (guildId: string) => {
    if (expanded === guildId) { setExpanded(null); setDetail(null); return; }
    setExpanded(guildId);
    setDetail(null);
    const r = await lensRun<any>('questmarket', 'guildDetail', { guildId });
    if (r.data?.ok && r.data.result) {
      setDetail({
        members: r.data.result.members || [],
        sharedQuests: r.data.result.sharedQuests || [],
      });
    }
  };

  const create = async () => {
    if (!gName.trim()) return;
    setBusy('create');
    const r = await lensRun<any>('questmarket', 'createGuild', {
      name: gName.trim(), description: gDesc.trim(),
    });
    setBusy(null);
    if (r.data?.ok) {
      setShowCreate(false); setGName(''); setGDesc('');
      load(); onChanged?.();
    } else {
      setErr(r.data?.error || 'create failed');
    }
  };

  const join = async (guildId: string) => {
    setBusy(guildId);
    const r = await lensRun<any>('questmarket', 'joinGuild', { guildId });
    setBusy(null);
    if (r.data?.ok) { load(); onChanged?.(); }
    else setErr(r.data?.error || 'join failed');
  };

  const leave = async (guildId: string) => {
    setBusy(guildId);
    const r = await lensRun<any>('questmarket', 'leaveGuild', { guildId });
    setBusy(null);
    if (r.data?.ok) { setExpanded(null); setDetail(null); load(); onChanged?.(); }
    else setErr(r.data?.error || 'leave failed');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Guilds</h3>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {guilds.length}
          </span>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 rounded bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30">
          <Plus className="h-3.5 w-3.5" /> Create Guild
        </button>
      </div>

      {err && (
        <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : guilds.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
          No guilds yet. Create one to coordinate shared quests.
        </div>
      ) : (
        <div className="space-y-2">
          {guilds.map((g) => {
            const open = expanded === g.id;
            return (
              <div key={g.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60">
                <div className="flex items-center justify-between gap-3 p-3">
                  <button onClick={() => openDetail(g.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    {open ? <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                      : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />}
                    <Shield className="h-4 w-4 shrink-0 text-amber-400" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{g.name}</p>
                      {g.description && (
                        <p className="truncate text-[11px] text-zinc-500">{g.description}</p>
                      )}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                      <Users className="h-3 w-3" />{g.memberCount}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-amber-300">
                      <Trophy className="h-3 w-3" />{g.totalXp.toLocaleString()}
                    </span>
                    {g.isMember ? (
                      <button onClick={() => leave(g.id)} disabled={busy === g.id}
                        className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:text-red-300 disabled:opacity-50">
                        <LogOut className="h-3 w-3" /> {g.myRole === 'founder' ? 'Founder' : 'Leave'}
                      </button>
                    ) : (
                      <button onClick={() => join(g.id)} disabled={busy === g.id}
                        className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50">
                        <LogIn className="h-3 w-3" /> Join
                      </button>
                    )}
                  </div>
                </div>

                {open && (
                  <div className="space-y-3 border-t border-zinc-800 p-3">
                    {!detail ? (
                      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading guild…
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
                            Members ({detail.members.length})
                          </p>
                          <div className="space-y-1">
                            {detail.members.map((m) => (
                              <div key={m.userId}
                                className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
                                <span className="text-[11px] text-white">
                                  {m.userId}
                                  <span className="ml-1.5 rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-400">
                                    {m.role}
                                  </span>
                                </span>
                                <span className="flex items-center gap-2 text-[10px] text-zinc-400">
                                  <span className="text-amber-300">{m.contributedXp} XP</span>
                                  <span>{m.questsCompleted} done</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
                            Shared Quests ({detail.sharedQuests.length})
                          </p>
                          {detail.sharedQuests.length === 0 ? (
                            <p className="text-[11px] text-zinc-600">
                              No guild quests yet.
                              {g.isMember && ' Post one below to set a shared objective.'}
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {detail.sharedQuests.map((q) => (
                                <div key={q.id}
                                  className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
                                  <span className="truncate text-[11px] text-white">{q.title}</span>
                                  <span className="flex shrink-0 items-center gap-2 text-[10px] text-zinc-400">
                                    <span className="rounded bg-zinc-800 px-1 py-0.5">{q.status.replace('_', ' ')}</span>
                                    {q.reward > 0 && (
                                      <span className="flex items-center gap-0.5 text-amber-300">
                                        <Coins className="h-2.5 w-2.5" />{q.reward}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {g.isMember && (
                          <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2.5">
                            <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
                              Post a guild quest
                            </p>
                            <QuestBoard kind="quest" guildId={g.id}
                              onChanged={() => { openDetail(g.id); openDetail(g.id); load(); onChanged?.(); }} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-5"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Create Guild</h3>
              <button onClick={() => setShowCreate(false)} aria-label="Close">
                <X className="h-4 w-4 text-zinc-400" />
              </button>
            </div>
            <div className="space-y-3">
              <input value={gName} onChange={(e) => setGName(e.target.value)}
                placeholder="Guild name"
                className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white" />
              <textarea value={gDesc} onChange={(e) => setGDesc(e.target.value)}
                placeholder="Description" rows={3}
                className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300">
                Cancel
              </button>
              <button onClick={create} disabled={!gName.trim() || busy === 'create'}
                className="rounded bg-amber-500/20 px-4 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50">
                {busy === 'create' ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
