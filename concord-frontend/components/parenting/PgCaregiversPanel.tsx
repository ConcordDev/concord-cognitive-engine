'use client';

/**
 * PgCaregiversPanel — multi-caregiver sync. The owner mints a share code
 * for a child; other caregivers redeem it to share one canonical baby log.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Users, KeyRound, Copy, Check, UserMinus, Share2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Caregiver { caregiverId: string; role: string; childId: string; joinedAt: string; via: string }
interface Invite { code: string; childId: string; childName: string; role: string }

const ROLES = ['parent', 'nanny', 'grandparent', 'caregiver'] as const;

export function PgCaregiversPanel({ childId }: { childId: string }) {
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string>('parent');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('parenting', 'caregiver-list', { childId });
    setCaregivers(r.data?.result?.caregivers || []);
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const mintCode = async () => {
    const r = await lensRun('parenting', 'caregiver-invite', { childId, role });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to create code'); return; }
    setError(null);
    setInvite(r.data?.result as Invite);
    setCopied(false);
  };
  const copyCode = async () => {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite.code); setCopied(true); } catch { setCopied(false); }
  };
  const redeem = async () => {
    const code = redeemCode.trim().toUpperCase();
    if (code.length !== 6) { setRedeemMsg('Enter the 6-character code.'); return; }
    const r = await lensRun('parenting', 'caregiver-redeem', { code });
    if (r.data?.ok === false) { setRedeemMsg(r.data?.error || 'Invalid code'); return; }
    setRedeemMsg('Joined — you now share this baby log.');
    setRedeemCode('');
  };
  const remove = async (caregiverId: string) => {
    await lensRun('parenting', 'caregiver-remove', { caregiverId });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Invite a caregiver */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2.5">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <Share2 className="w-3.5 h-3.5 text-rose-400" /> Invite a caregiver
        </h3>
        <div className="flex items-center gap-2">
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button type="button" onClick={mintCode}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg">
            <KeyRound className="w-3.5 h-3.5" /> Generate code
          </button>
        </div>
        {invite && (
          <div className="flex items-center gap-2 bg-rose-950/30 border border-rose-900/50 rounded-lg px-3 py-2">
            <span className="font-mono text-lg font-bold tracking-[0.3em] text-rose-200">{invite.code}</span>
            <span className="text-[10px] text-zinc-400 capitalize">{invite.role} · {invite.childName}</span>
            <button type="button" onClick={copyCode}
              className="ml-auto flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </section>

      {/* Redeem a code */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-semibold text-zinc-300">Have a code? Join a shared log</h3>
        <div className="flex items-center gap-2">
          <input placeholder="6-character code" value={redeemCode} maxLength={6}
            onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 font-mono tracking-widest uppercase" />
          <button type="button" onClick={redeem}
            className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">Join</button>
        </div>
        {redeemMsg && <p className="text-[11px] text-zinc-400">{redeemMsg}</p>}
      </section>

      {/* Caregiver roster */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Users className="w-3.5 h-3.5 text-rose-400" /> Shared caregivers
        </h3>
        {caregivers.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic py-4 text-center">No caregivers have joined yet.</p>
        ) : (
          <ul className="space-y-1">
            {caregivers.map((c) => (
              <li key={c.caregiverId} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <Users className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-xs text-zinc-200 capitalize">{c.role}</span>
                <span className="text-[10px] text-zinc-500">joined {c.joinedAt.slice(0, 10)} · via {c.via}</span>
                <button type="button" onClick={() => remove(c.caregiverId)}
                  className="ml-auto text-zinc-500 hover:text-rose-300" aria-label="Remove caregiver">
                  <UserMinus className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-[10px] text-zinc-500">Everyone with access reads and writes one canonical baby log in real time.</p>
    </div>
  );
}
