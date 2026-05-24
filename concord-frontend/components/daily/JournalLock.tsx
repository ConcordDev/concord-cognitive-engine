'use client';

/**
 * JournalLock — Day One-style private journal lock. Gates the journaling
 * studio behind a user-set passcode and lets the user set / change /
 * remove it. Wires the daily.lock-status, lock-set, lock-verify,
 * lock-remove macros. The passcode is a soft client privacy gate (the
 * substrate stores only a non-reversible hash).
 */

import { useCallback, useEffect, useState } from 'react';
import { Lock, Unlock, ShieldCheck, Loader2, KeyRound } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface LockStatus { locked: boolean; hint: string | null }

export function JournalLock({
  unlocked,
  onUnlock,
}: {
  unlocked: boolean;
  onUnlock: (v: boolean) => void;
}) {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'set' | 'change' | 'remove' | null>(null);
  const [form, setForm] = useState({ current: '', next: '', hint: '' });

  const loadStatus = useCallback(async () => {
    const r = await lensRun<LockStatus>('daily', 'lock-status', {});
    if (r.data?.ok && r.data.result) {
      setStatus(r.data.result);
      if (!r.data.result.locked) onUnlock(true);
    }
    setLoading(false);
  }, [onUnlock]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const verify = useCallback(async () => {
    if (!code) return;
    setBusy(true); setErr(null);
    const r = await lensRun<{ unlocked: boolean; hint: string | null }>('daily', 'lock-verify', { passcode: code });
    setBusy(false);
    if (r.data?.ok && r.data.result?.unlocked) {
      onUnlock(true);
      setCode('');
    } else {
      setErr('Incorrect passcode.' + (r.data?.result?.hint ? ` Hint: ${r.data.result.hint}` : ''));
    }
  }, [code, onUnlock]);

  const setLock = useCallback(async () => {
    if (form.next.length < 4) { setErr('Passcode must be at least 4 characters.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('daily', 'lock-set', {
      passcode: form.next,
      currentPasscode: form.current || undefined,
      hint: form.hint || undefined,
    });
    setBusy(false);
    if (r.data?.ok) {
      setForm({ current: '', next: '', hint: '' });
      setMode(null);
      await loadStatus();
    } else {
      setErr(r.data?.error || 'Could not set passcode.');
    }
  }, [form, loadStatus]);

  const removeLock = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await lensRun('daily', 'lock-remove', { passcode: form.current });
    setBusy(false);
    if (r.data?.ok) {
      setForm({ current: '', next: '', hint: '' });
      setMode(null);
      await loadStatus();
    } else {
      setErr(r.data?.error || 'Could not remove passcode.');
    }
  }, [form, loadStatus]);

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  // Locked + not unlocked → block with passcode prompt.
  if (status?.locked && !unlocked) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6 text-center max-w-sm mx-auto">
        <Lock className="w-8 h-8 text-rose-400 mx-auto mb-3" />
        <h3 className="text-sm font-bold text-zinc-100 mb-1">Journal locked</h3>
        <p className="text-xs text-zinc-400 mb-3">Enter your passcode to view your entries.</p>
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void verify(); }}
          placeholder="Passcode" maxLength={64}
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-center text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500" />
        {status.hint && <p className="text-[11px] text-zinc-400 mt-1">Hint: {status.hint}</p>}
        {err && <p className="text-[11px] text-rose-400 mt-1">{err}</p>}
        <button onClick={verify} disabled={!code || busy}
          className="w-full mt-3 px-3 py-1.5 text-xs font-semibold rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlock className="w-3 h-3" />}Unlock
        </button>
      </div>
    );
  }

  // Unlocked → settings strip.
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
      <div className="flex items-center gap-2">
        {status?.locked ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <Unlock className="w-4 h-4 text-zinc-400" />}
        <p className="text-xs text-zinc-300">
          {status?.locked ? 'Journal is protected with a passcode.' : 'Journal is not locked.'}
        </p>
        <div className="ml-auto flex gap-1">
          {!status?.locked && (
            <button onClick={() => { setMode('set'); setErr(null); }}
              className="px-2 py-1 text-[11px] rounded bg-rose-600 hover:bg-rose-500 text-white inline-flex items-center gap-1">
              <KeyRound className="w-3 h-3" />Set passcode
            </button>
          )}
          {status?.locked && (
            <>
              <button onClick={() => { setMode('change'); setErr(null); }}
                className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200">Change</button>
              <button onClick={() => { setMode('remove'); setErr(null); }}
                className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-rose-300">Remove</button>
            </>
          )}
        </div>
      </div>

      {mode === 'remove' && (
        <div className="mt-2 space-y-2">
          <input type="password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })}
            placeholder="Current passcode" maxLength={64}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-100" />
          {err && <p className="text-[11px] text-rose-400">{err}</p>}
          <div className="flex gap-1">
            <button onClick={removeLock} disabled={busy}
              className="flex-1 px-2 py-1 text-[11px] rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40">Remove lock</button>
            <button onClick={() => setMode(null)} className="px-2 py-1 text-[11px] rounded bg-zinc-800 text-zinc-400">Cancel</button>
          </div>
        </div>
      )}

      {(mode === 'set' || mode === 'change') && (
        <div className="mt-2 space-y-2">
          {mode === 'change' && (
            <input type="password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })}
              placeholder="Current passcode" maxLength={64}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-100" />
          )}
          <input type="password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })}
            placeholder="New passcode (min 4 chars)" maxLength={64}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-100" />
          <input value={form.hint} onChange={(e) => setForm({ ...form, hint: e.target.value })}
            placeholder="Hint (optional)" maxLength={120}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
          {err && <p className="text-[11px] text-rose-400">{err}</p>}
          <div className="flex gap-1">
            <button onClick={setLock} disabled={busy}
              className="flex-1 px-2 py-1 text-[11px] rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40">
              {mode === 'change' ? 'Update passcode' : 'Set passcode'}
            </button>
            <button onClick={() => setMode(null)} className="px-2 py-1 text-[11px] rounded bg-zinc-800 text-zinc-400">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
