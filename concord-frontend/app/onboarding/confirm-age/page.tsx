'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Brain, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api/client';

// Post-OAuth age gate. Google/Apple never return a date of birth, so an OAuth
// account lands with date_of_birth = NULL and the server redirects it here
// (see routes/oauth.js#completeOAuthLogin). The user confirms an adult DOB once;
// 18+ unlocks the account, under-18 deactivates it. Mirrors the password-register
// age gate so the two sign-up paths enforce the same floor.
function ConfirmAgeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const provider = params.get('provider') || '';
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!dateOfBirth) {
      setError('Please enter your date of birth');
      return;
    }
    // Client-side 18+ check for an immediate, clear message (server re-validates).
    const _dob = new Date(`${dateOfBirth}T00:00:00Z`);
    const _now = new Date();
    let _age = _now.getUTCFullYear() - _dob.getUTCFullYear();
    const _md = _now.getUTCMonth() - _dob.getUTCMonth();
    if (_md < 0 || (_md === 0 && _now.getUTCDate() < _dob.getUTCDate())) _age--;
    if (Number.isNaN(_dob.getTime()) || _dob.getTime() > _now.getTime()) {
      setError('Please enter a valid date of birth');
      return;
    }
    if (_age < 18) {
      setError('You must be at least 18 years old to use Concord.');
      return;
    }

    setLoading(true);
    try {
      // Refresh the CSRF token first (this is a state-changing write).
      await api.get('/api/auth/csrf-token');
      const res = await api.post('/api/auth/confirm-age', { dateOfBirth });
      if (res.data?.ok) {
        localStorage.setItem('concord_entered', 'true');
        router.push('/');
      } else {
        setError(res.data?.error || 'Could not confirm your age. Please try again.');
      }
    } catch (err: unknown) {
      const axErr = err as { response?: { status?: number; data?: { error?: string; code?: string } } };
      if (axErr?.response?.data?.code === 'AGE_RESTRICTED') {
        // Account was deactivated server-side. Send them out.
        setError(axErr.response.data.error || 'You must be at least 18 years old to use Concord.');
        setTimeout(() => router.push('/login?reason=age'), 2500);
      } else {
        setError(axErr?.response?.data?.error || 'Could not confirm your age. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-lattice-void flex items-center justify-center px-4">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-neon-purple/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/3 w-96 h-96 bg-neon-cyan/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-blue flex items-center justify-center">
              <Brain className="w-7 h-7 text-white" />
            </div>
            <span className="text-3xl font-bold text-white">Concordos</span>
          </div>
          <p className="text-gray-400 mt-3">One more step{provider ? ` after your ${provider} sign-in` : ''}</p>
        </div>

        {/* Card */}
        <div className="bg-lattice-surface border border-lattice-border rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-5">
            <ShieldCheck className="w-6 h-6 text-neon-green shrink-0" />
            <h1 className="text-lg font-semibold text-white">Confirm your date of birth</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" aria-describedby={error ? 'confirm-age-error' : undefined}>
            {error && (
              <div id="confirm-age-error" role="alert" aria-live="assertive" className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="date-of-birth" className="block text-sm font-medium text-gray-300 mb-2">
                Date of birth
              </label>
              <input
                id="date-of-birth"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                required
                autoFocus
                max={new Date().toISOString().slice(0, 10)}
                aria-invalid={!!error}
                aria-describedby="dob-hint"
                className="w-full px-4 py-3 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/30 transition-colors [color-scheme:dark]"
              />
              <p id="dob-hint" className="text-gray-400 text-xs mt-1">You must be 18 or older. Concordia contains mature, violent content.</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-blue text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Confirming…' : 'Confirm and continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ConfirmAgePage() {
  return (
    <Suspense fallback={null}>
      <ConfirmAgeInner />
    </Suspense>
  );
}
