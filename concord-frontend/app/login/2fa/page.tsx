'use client';

// Second step of a two-factor sign-in (FIX-settings-005). The server
// mints the challenge only after the password (or the OAuth provider)
// verifies, and it lives five minutes. This page collects the
// authenticator code — or a single-use recovery code — and posts it to
// /api/auth/login/verify-2fa, which sets the session cookies on
// success. Nothing about the account is revealed here: a bad or
// expired challenge gets one honest message and a way back to sign-in.

import { useState, FormEvent, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import { connectSocket } from '@/lib/realtime/socket';
import { Brain, Shield } from 'lucide-react';
import { validateReturnTo } from '@/lib/return-to';

function TwoFactorForm() {
  const searchParams = useSearchParams();
  const challengeId = searchParams.get('challenge') || '';
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login/verify-2fa', { challengeId, code: code.trim() });
      if (res.data?.ok) {
        localStorage.setItem('concord_entered', 'true');
        await api.get('/api/auth/csrf-token').catch(() => {});
        connectSocket();
        localStorage.setItem('concord_login_ts', String(Date.now()));
        window.location.href = validateReturnTo(searchParams.get('from'));
      } else {
        const message = res.data?.error || 'That code didn\'t match.';
        setError(message);
        if (/expired/i.test(message)) setExpired(true);
      }
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } } };
      const message = axErr?.response?.data?.error || 'That code didn\'t match.';
      setError(message);
      if (/expired/i.test(message)) setExpired(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-lattice-void flex items-center justify-center px-4">
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-blue flex items-center justify-center">
              <Brain className="w-7 h-7 text-white" />
            </div>
            <span className="text-3xl font-bold text-white">Concordos</span>
          </Link>
          <p className="text-gray-300 mt-3">Two-factor authentication</p>
        </div>

        <div className="bg-lattice-surface border border-lattice-border rounded-2xl p-8">
          {!challengeId ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-300">
                This sign-in step is missing its challenge. Start again from the sign-in page —
                you&apos;ll land here right after your password checks out.
              </p>
              <Link href="/login" className="inline-block text-sm text-cyan-300 hover:text-cyan-200">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5" data-testid="two-factor-form">
              <p className="text-sm text-gray-300 flex gap-2">
                <Shield className="w-4 h-4 mt-0.5 shrink-0 text-cyan-300" />
                {useRecovery
                  ? 'Enter one of the recovery codes you saved when you turned two-factor on. Each code works once.'
                  : 'Enter the 6-digit code from your authenticator app. This step expires in 5 minutes.'}
              </p>

              {error && (
                <p role="alert" className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 rounded px-3 py-2">
                  {error}
                </p>
              )}

              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={useRecovery ? 'XXXX-XXXX-XXXX' : '123456'}
                aria-label={useRecovery ? 'Recovery code' : 'Authenticator code'}
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoFocus
                className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 tracking-widest"
              />

              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="w-full py-2.5 rounded-lg bg-cyan-500 text-black text-sm font-semibold hover:bg-cyan-400 disabled:opacity-60"
              >
                {loading ? 'Checking…' : 'Verify and sign in'}
              </button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(''); }}
                  className="text-cyan-300 hover:text-cyan-200"
                >
                  {useRecovery ? 'Use my authenticator instead' : 'Use a recovery code instead'}
                </button>
                {expired && (
                  <Link href="/login" className="text-cyan-300 hover:text-cyan-200">
                    Back to sign in
                  </Link>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TwoFactorPage() {
  return (
    <Suspense fallback={null}>
      <TwoFactorForm />
    </Suspense>
  );
}
