'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Loader2, Shield, ShieldCheck, Monitor, LogOut, KeyRound, Link2, Unlink, Check,
} from 'lucide-react';

interface Overview {
  twoFactorEnabled: boolean;
  recoveryCodesIssued: number;
  lastPasswordChange: string | null;
  activeSessions: number;
  connectedAccounts: number;
}
interface Session {
  id: string;
  current: boolean;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeen: string;
}
interface ConnectedAccount {
  id: string;
  provider: string;
  handle: string;
  connectedAt: string;
}

const PROVIDERS = ['github', 'google', 'discord', 'apple', 'steam'];

/**
 * AccountSecurityPanel — the account / security surface: password change,
 * two-factor toggle (with recovery codes), active sessions with revoke, and
 * connected external accounts. Every value is from a real `settings.*`
 * macro; no value is fabricated.
 */
export function AccountSecurityPanel() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // password form
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwResult, setPwResult] = useState<string | null>(null);

  // connect form
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [handle, setHandle] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ovr, sess, acct] = await Promise.all([
        lensRun<Overview>('settings', 'accountOverview', {}),
        lensRun<{ sessions: Session[] }>('settings', 'sessions', {}),
        lensRun<{ accounts: ConnectedAccount[] }>('settings', 'connectedAccounts', {}),
      ]);
      if (ovr.data?.ok && ovr.data.result) setOverview(ovr.data.result);
      if (sess.data?.ok && sess.data.result) setSessions(sess.data.result.sessions);
      if (acct.data?.ok && acct.data.result) setAccounts(acct.data.result.accounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load account');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle2fa = useCallback(async () => {
    if (!overview) return;
    setBusy('2fa');
    setError(null);
    try {
      const r = await lensRun<{ twoFactorEnabled: boolean; recoveryCodes: string[] | null }>(
        'settings', 'setTwoFactor', { enabled: !overview.twoFactorEnabled },
      );
      if (r.data?.ok && r.data.result) {
        setRecoveryCodes(r.data.result.recoveryCodes);
        await load();
      } else {
        setError(r.data?.error || 'failed to update 2FA');
      }
    } finally {
      setBusy(null);
    }
  }, [overview, load]);

  const submitPassword = useCallback(async () => {
    setBusy('pw');
    setError(null);
    setPwResult(null);
    try {
      const r = await lensRun<{ note: string }>('settings', 'changePassword', {
        currentPassword: currentPw, newPassword: newPw,
      });
      if (r.data?.ok && r.data.result) {
        setPwResult(r.data.result.note);
        setCurrentPw('');
        setNewPw('');
        await load();
      } else {
        setError(r.data?.error || 'failed to change password');
      }
    } finally {
      setBusy(null);
    }
  }, [currentPw, newPw, load]);

  const revoke = useCallback(async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const r = await lensRun('settings', 'revokeSession', { id });
      if (r.data?.ok) await load();
      else if (r.data?.error) setError(r.data.error);
    } finally {
      setBusy(null);
    }
  }, [load]);

  const revokeOthers = useCallback(async () => {
    setBusy('revoke-all');
    try {
      const r = await lensRun('settings', 'revokeOtherSessions', {});
      if (r.data?.ok) await load();
    } finally {
      setBusy(null);
    }
  }, [load]);

  const connect = useCallback(async () => {
    setBusy('connect');
    setError(null);
    try {
      const r = await lensRun('settings', 'connectAccount', { provider, handle: handle.trim() });
      if (r.data?.ok) {
        setHandle('');
        await load();
      } else {
        setError(r.data?.error || 'failed to connect account');
      }
    } finally {
      setBusy(null);
    }
  }, [provider, handle, load]);

  const disconnect = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const r = await lensRun('settings', 'disconnectAccount', { id });
      if (r.data?.ok) await load();
      else if (r.data?.error) setError(r.data.error);
    } finally {
      setBusy(null);
    }
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading account…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 rounded px-3 py-2">
          {error}
        </p>
      )}

      {/* Two-factor */}
      <section>
        <h3 className="text-sm font-semibold text-cyan-300 mb-2 flex items-center gap-1.5">
          {overview?.twoFactorEnabled ? <ShieldCheck className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
          Two-factor authentication
        </h3>
        <div className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2">
          <span className="flex-1 text-xs text-gray-300">
            {overview?.twoFactorEnabled
              ? `Enabled · ${overview.recoveryCodesIssued} recovery codes issued`
              : 'Disabled — turn on for an extra layer of protection.'}
          </span>
          <button
            onClick={toggle2fa}
            disabled={busy === '2fa'}
            className={`px-3 py-1 text-xs rounded text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
              overview?.twoFactorEnabled ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-cyan-600 hover:bg-cyan-500'
            } disabled:opacity-50`}
          >
            {busy === '2fa' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : null}
            {overview?.twoFactorEnabled ? 'Disable' : 'Enable'}
          </button>
        </div>
        {recoveryCodes && recoveryCodes.length > 0 && (
          <div className="mt-2 bg-amber-950/30 border border-amber-900/50 rounded px-3 py-2">
            <p className="text-[11px] text-amber-300 mb-1">
              Save these recovery codes — they will not be shown again.
            </p>
            <div className="grid grid-cols-2 gap-1 font-mono text-[11px] text-amber-100">
              {recoveryCodes.map((c) => (<span key={c}>{c}</span>))}
            </div>
          </div>
        )}
      </section>

      {/* Password */}
      <section>
        <h3 className="text-sm font-semibold text-cyan-300 mb-2 flex items-center gap-1.5">
          <KeyRound className="w-4 h-4" /> Change password
        </h3>
        <div className="space-y-2">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Current password"
            aria-label="Current password"
            className="w-full px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (8+ chars, letters & numbers)"
            aria-label="New password"
            className="w-full px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <button
            onClick={submitPassword}
            disabled={busy === 'pw' || !currentPw || !newPw}
            className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            {busy === 'pw' ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
            Update password
          </button>
          {pwResult && (
            <p className="text-[11px] text-emerald-300 inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> {pwResult}
            </p>
          )}
          {overview?.lastPasswordChange && (
            <p className="text-[10px] text-white/40">
              Last changed {new Date(overview.lastPasswordChange).toLocaleString()}
            </p>
          )}
        </div>
      </section>

      {/* Sessions */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-cyan-300 flex items-center gap-1.5">
            <Monitor className="w-4 h-4" /> Active sessions ({sessions.length})
          </h3>
          {sessions.length > 1 && (
            <button
              onClick={revokeOthers}
              disabled={busy === 'revoke-all'}
              className="text-[11px] text-red-300 hover:text-red-200 inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-1"
            >
              {busy === 'revoke-all' ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
              Sign out other sessions
            </button>
          )}
        </div>
        <ul className="space-y-1.5">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-200 truncate">
                  {s.userAgent}
                  {s.current && <span className="ml-2 text-[9px] text-emerald-400">this device</span>}
                </p>
                <p className="text-[10px] text-white/40">
                  {s.ip} · last seen {new Date(s.lastSeen).toLocaleString()}
                </p>
              </div>
              {!s.current && (
                <button
                  onClick={() => revoke(s.id)}
                  disabled={busy === s.id}
                  className="px-2 py-1 text-[11px] bg-red-900/60 hover:bg-red-800 disabled:opacity-50 rounded text-red-100 inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {busy === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Connected accounts */}
      <section>
        <h3 className="text-sm font-semibold text-cyan-300 mb-2 flex items-center gap-1.5">
          <Link2 className="w-4 h-4" /> Connected accounts ({accounts.length})
        </h3>
        {accounts.length > 0 && (
          <ul className="space-y-1.5 mb-2">
            {accounts.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-200 capitalize">
                    {a.provider} <span className="text-white/50">· {a.handle}</span>
                  </p>
                  <p className="text-[10px] text-white/40">
                    Linked {new Date(a.connectedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => disconnect(a.id)}
                  disabled={busy === a.id}
                  className="px-2 py-1 text-[11px] bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded text-gray-200 inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {busy === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="Provider"
            className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white capitalize focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            {PROVIDERS.map((p) => (<option key={p} value={p}>{p}</option>))}
          </select>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="Handle / username"
            aria-label="Account handle"
            maxLength={64}
            className="flex-1 px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <button
            onClick={connect}
            disabled={busy === 'connect' || !handle.trim()}
            className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            {busy === 'connect' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
            Connect
          </button>
        </div>
      </section>
    </div>
  );
}
