'use client';

/**
 * SharePanel — per-page share & permission controls. Wires
 * docs.share-get / share-set (visibility private|link|public + a
 * view/edit role) and docs.share-invite / share-revoke for named
 * collaborators.
 */

import { useCallback, useEffect, useState } from 'react';
import { Share2, Loader2, Globe, Lock, Link as LinkIcon, Copy, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { Share } from './types';

const VIS: { id: Share['visibility']; label: string; icon: React.ReactNode }[] = [
  { id: 'private', label: 'Private', icon: <Lock className="w-3 h-3" /> },
  { id: 'link', label: 'Anyone with link', icon: <LinkIcon className="w-3 h-3" /> },
  { id: 'public', label: 'Public', icon: <Globe className="w-3 h-3" /> },
];

export function SharePanel({ pageId }: { pageId: string }) {
  const [share, setShare] = useState<Share | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [invitee, setInvitee] = useState('');
  const [inviteRole, setInviteRole] = useState<'view' | 'edit'>('view');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await lensRun('docs', 'share-get', { pageId });
    setShare((r.data?.result?.share as Share) || null);
    setShareUrl((r.data?.result?.shareUrl as string | null) ?? null);
    setLoading(false);
  }, [pageId]);
  useEffect(() => { setLoading(true); void load(); }, [load]);

  async function setVisibility(visibility: Share['visibility']) {
    const r = await lensRun('docs', 'share-set', { pageId, visibility, role: share?.role || 'view' });
    setShare((r.data?.result?.share as Share) || share);
    setShareUrl((r.data?.result?.shareUrl as string | null) ?? null);
  }
  async function setRole(role: 'view' | 'edit') {
    const r = await lensRun('docs', 'share-set', { pageId, visibility: share?.visibility || 'private', role });
    setShare((r.data?.result?.share as Share) || share);
    setShareUrl((r.data?.result?.shareUrl as string | null) ?? null);
  }
  async function invite() {
    if (!invitee.trim()) return;
    await lensRun('docs', 'share-invite', { pageId, invitee: invitee.trim(), role: inviteRole });
    setInvitee('');
    await load();
  }
  async function revoke(inviteId: string) {
    await lensRun('docs', 'share-revoke', { pageId, inviteId });
    await load();
  }
  function copyLink() {
    if (!shareUrl) return;
    const full = typeof window !== 'undefined' ? `${window.location.origin}${shareUrl}` : shareUrl;
    void navigator.clipboard?.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-4 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
        <Share2 className="w-3.5 h-3.5" /> Share &amp; permissions
      </h4>

      <div>
        <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Visibility</p>
        <div className="space-y-1">
          {VIS.map(v => (
            <button key={v.id} onClick={() => setVisibility(v.id)}
              className={cn('w-full flex items-center gap-1.5 rounded border px-2 py-1 text-[11px]',
                share?.visibility === v.id
                  ? 'border-indigo-600 bg-indigo-900/40 text-indigo-100'
                  : 'border-zinc-800 text-zinc-300 hover:border-zinc-600')}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </div>

      {share && share.visibility !== 'private' && (
        <>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Link role</p>
            <div className="flex gap-1">
              {(['view', 'edit'] as const).map(r => (
                <button key={r} onClick={() => setRole(r)}
                  className={cn('flex-1 rounded border px-2 py-1 text-[11px]',
                    share.role === r ? 'border-indigo-600 bg-indigo-900/40 text-indigo-100' : 'border-zinc-800 text-zinc-300')}>
                  Can {r}
                </button>
              ))}
            </div>
          </div>
          {shareUrl && (
            <div className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/40 px-1.5 py-1">
              <code className="flex-1 text-[10px] text-sky-300 truncate">{shareUrl}</code>
              <button aria-label="Copy" onClick={copyLink} className="text-zinc-400 hover:text-zinc-100">
                <Copy className="w-3 h-3" />
              </button>
              {copied && <span className="text-[9px] text-emerald-400">copied</span>}
            </div>
          )}
        </>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Invite people</p>
        <div className="flex gap-1 mb-1">
          <input value={invitee} onChange={e => setInvitee(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void invite(); }}
            placeholder="username or email"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200 px-1.5 py-1" />
          <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'view' | 'edit')}
            className="bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-1">
            <option value="view">view</option>
            <option value="edit">edit</option>
          </select>
          <button onClick={invite} disabled={!invitee.trim()}
            className="rounded bg-indigo-700 hover:bg-indigo-600 text-white text-[11px] px-2 disabled:opacity-50">Add</button>
        </div>
        {(share?.invites?.length ?? 0) === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No collaborators invited.</p>
        ) : (
          <div className="space-y-1">
            {share!.invites.map(iv => (
              <div key={iv.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1">
                <span className="flex-1 text-[11px] text-zinc-200 truncate">{iv.invitee}</span>
                <span className="text-[9px] uppercase rounded bg-zinc-800 px-1 text-zinc-400">{iv.role}</span>
                <button onClick={() => revoke(iv.id)} className="text-zinc-400 hover:text-rose-400">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
