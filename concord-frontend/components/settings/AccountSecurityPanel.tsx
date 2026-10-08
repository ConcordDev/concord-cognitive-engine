'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, lensRun } from '@/lib/api/client';
import {
  Loader2, Shield, Monitor, LogOut, KeyRound, Link2, Unlink, Check,
} from 'lucide-react';

// Extracts the real backend error message from an axios rejection
// (matches the `pickMessage` idiom used across other action panels —
// e.g. components/bio/BioActionPanel.tsx).
function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface Overview {
  lastPasswordChange: string | null;
}
interface Session {
  id: string;
  current: boolean;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeen: string;
}
interface OAuthConnection {
  provider: string;
  email: string | null;
  name: string | null;
  linkedAt: string;
}

// Providers the auth layer can actually link (server/routes/oauth.js).
const PROVIDERS = ['google', 'apple'];

/**
 * AccountSecurityPanel — the account / security surface: password change,
 * the session making this request plus a real "sign out everywhere"
 * (`POST /api/auth/revoke-all-sessions`), and real linked sign-in providers
 * (`/api/auth/me/connections`, `/api/auth/link/:provider`). Two-factor auth
 * is shown as unavailable: no second factor is enforced at sign-in, so a
 * toggle would be a false security promise. Per-device session history is
 * not recorded, so other devices are not listed. Password change is two real steps: a
 * `settings.changePassword` policy pre-check, then the actual credential
 * rotation via `POST /api/auth/change-password` — success is only reported
 * once the second (real) call succeeds.
 */
export function AccountSecurityPanel() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [accounts, setAccounts] = useState<OAuthConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // password form
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwResult, setPwResult] = useState<string | null>(null);

  const [provider, setProvider] = useState(PROVIDERS[0]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ovr, sess, conns] = await Promise.all([
        lensRun<Overview>('settings', 'accountOverview', {}),
        lensRun<{ sessions: Session[] }>('settings', 'sessions', {}),
        api.get<{ ok: boolean; oauthConnections?: OAuthConnection[] }>('/api/auth/me/connections').catch(() => null),
      ]);
      if (ovr.data?.ok && ovr.data.result) setOverview(ovr.data.result);
      if (sess.data?.ok && sess.data.result) setSessions(sess.data.result.sessions);
      setAccounts(conns?.data?.oauthConnections ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load account');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const submitPassword = useCallback(async () => {
    setBusy('pw');
    setError(null);
    setPwResult(null);
    try {
      // Step 1 — settings.changePassword is a fast in-lens policy
      // pre-check ONLY (12+ chars, letters+numbers, differs from current).
      // It does not touch the real credential — see server/domains/settings.js.
      const pre = await lensRun<{ note: string }>('settings', 'changePassword', {
        currentPassword: currentPw, newPassword: newPw,
      });
      if (!pre.data?.ok || !pre.data.result) {
        setError(pre.data?.error || 'failed to change password');
        return;
      }
      // Step 2 — the REAL credential rotation. Only report success once
      // this call actually succeeds; a prior version of this panel showed
      // the step-1 pre-check's note as if it were a completed change,
      // while the account's real password was never touched.
      await api.post('/api/auth/change-password', {
        currentPassword: currentPw, newPassword: newPw,
      });
      setPwResult('Password changed successfully.');
      setCurrentPw('');
      setNewPw('');
      await load();
    } catch (e) {
      setError(pickMessage(e));
    } finally {
      setBusy(null);
    }
  }, [currentPw, newPw, load]);

  const signOutEverywhere = useCallback(async () => {
    if (!window.confirm('Sign out of every device, including this one?')) return;
    setBusy('revoke-all');
    setError(null);
    try {
      await api.post('/api/auth/revoke-all-sessions', {});
      router.push('/login');
    } catch (e) {
      setError(pickMessage(e));
      setBusy(null);
    }
  }, [router]);

  const link = useCallback(async () => {
    setBusy('connect');
    setError(null);
    try {
      const r = await api.post<{ ok: boolean; authUrl?: string; error?: string }>(`/api/auth/link/${provider}`, {});
      if (r.data?.authUrl) {
        window.location.href = r.data.authUrl;
        return;
      }
      setError(r.data?.error || 'could not start linking');
    } catch (e) {
      setError(pickMessage(e));
    } finally {
      setBusy(null);
    }
  }, [provider]);

  const unlink = useCallback(async (prov: string) => {
    setBusy(prov);
    setError(null);
    try {
      await api.delete(`/api/auth/link/${prov}`);
      await load();
    } catch (e) {
      setError(pickMessage(e));
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
          <Shield className="w-4 h-4" /> Two-factor authentication
        </h3>
        <p className="bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2 text-xs text-gray-300">
          Not available yet. Sign-in currently uses your password or a linked provider only; use a long, unique password
          and keep your linked provider&apos;s own two-step verification on.
        </p>
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
            className="w-full px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (12+ chars, letters & numbers)"
            aria-label="New password"
            className="w-full px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
            <Monitor className="w-4 h-4" /> This session
          </h3>
          <button
            onClick={signOutEverywhere}
            disabled={busy === 'revoke-all'}
            className="text-[11px] text-red-300 hover:text-red-200 inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-red-500 rounded px-1"
          >
            {busy === 'revoke-all' ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
            Sign out of all devices
          </button>
        </div>
        <ul className="space-y-1.5">
          {sessions.map((s) => (
            <li key={s.id} className="bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2">
              <p className="text-xs text-gray-200 truncate">
                {s.userAgent}
                <span className="ml-2 text-[9px] text-emerald-400">this device</span>
              </p>
              <p className="text-[10px] text-white/40">
                {s.ip} · last seen {new Date(s.lastSeen).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[10px] text-white/40">
          Other devices aren&apos;t listed individually — signing out of all devices ends every session, including this one.
        </p>
      </section>

      {/* Connected accounts */}
      <section>
        <h3 className="text-sm font-semibold text-cyan-300 mb-2 flex items-center gap-1.5">
          <Link2 className="w-4 h-4" /> Linked sign-in providers ({accounts.length})
        </h3>
        {accounts.length > 0 && (
          <ul className="space-y-1.5 mb-2">
            {accounts.map((a) => (
              <li
                key={a.provider}
                className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-200 capitalize">
                    {a.provider} <span className="text-white/50">· {a.email || a.name || 'linked'}</span>
                  </p>
                  <p className="text-[10px] text-white/40">
                    Linked {new Date(a.linkedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => unlink(a.provider)}
                  disabled={busy === a.provider}
                  className="px-2 py-1 text-[11px] bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded text-gray-200 inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  {busy === a.provider ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                  Unlink
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
            {PROVIDERS.filter((p) => !accounts.some((a) => a.provider === p)).map((p) => (<option key={p} value={p}>{p}</option>))}
          </select>
          <button
            onClick={link}
            disabled={busy === 'connect' || PROVIDERS.every((p) => accounts.some((a) => a.provider === p))}
            className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            {busy === 'connect' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
            Link account
          </button>
        </div>
      </section>
    </div>
  );
}
