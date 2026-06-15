'use client';

import { useState, useRef, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import { Brain, UserPlus, Eye, EyeOff } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const pageLoadTime = useRef(Date.now());
  const [honeypot, setHoneypot] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }
    // 18+ age gate — Concordia has mature/violent content. Mirror the server
    // check client-side for an immediate, clear message.
    if (!dateOfBirth) {
      setError('Please enter your date of birth');
      return;
    }
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
      setError('You must be at least 18 years old to create an account.');
      return;
    }

    setLoading(true);

    try {
      // Fetch CSRF token first
      await api.get('/api/auth/csrf-token');
      const res = await api.post('/api/auth/register', {
        username, email, password, dateOfBirth,
        _t: pageLoadTime.current,
        ...(honeypot && { website: honeypot }),
      });
      // A REAL registration returns a `token` (and auto-sets the auth cookies). The
      // anti-bot defenses (honeypot / sub-2s timing check) return a SILENT fake-success
      // — { ok: true, user: { id: 'ok' } } with NO token, NO cookie — so we must not
      // treat a bare `ok` as logged-in, or the user lands on /onboarding unauthenticated
      // and bounces to /login ("I registered but I'm not logged in"). Require the token.
      const realSuccess = res.data?.ok && (res.data?.token || res.data?.user?.id && res.data.user.id !== 'ok');
      if (realSuccess) {
        // Registration auto-logged you in (cookies set) — go straight to onboarding.
        localStorage.setItem('concord_entered', 'true');
        router.push('/onboarding');
      } else if (res.data?.ok) {
        // Silently rejected by a bot-defense (most often: form submitted too fast).
        setError('Registration could not be completed. Please wait a moment, then try again.');
      } else {
        setError(res.data?.error || 'Registration failed');
      }
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } } };
      setError(axErr?.response?.data?.error || 'Registration failed. Please try again.');
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
          <Link href="/" className="inline-flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-blue flex items-center justify-center">
              <Brain className="w-7 h-7 text-white" />
            </div>
            <span className="text-3xl font-bold text-white">Concordos</span>
          </Link>
          <p className="text-gray-400 mt-3">Create your sovereign account</p>
          <div className="flex items-center justify-center gap-3 mt-4 text-xs font-semibold">
            <span className="px-2.5 py-1 rounded bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan">No ads</span>
            <span className="px-2.5 py-1 rounded bg-neon-blue/10 border border-neon-blue/20 text-neon-blue">No subscriptions</span>
            <span className="px-2.5 py-1 rounded bg-neon-purple/10 border border-neon-purple/20 text-neon-purple">No data extraction</span>
            <span className="px-2.5 py-1 rounded bg-neon-green/10 border border-neon-green/20 text-neon-green">Free</span>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-lattice-surface border border-lattice-border rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5" aria-describedby={error ? "register-error" : undefined}>
            {/* Honeypot — hidden from real users, bots auto-fill it */}
            <div className="absolute -left-[9999px]" aria-hidden="true">
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
            </div>
            {error && (
              <div id="register-error" role="alert" aria-live="assertive" className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-2">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                pattern="^[a-zA-Z0-9_-]+$"
                minLength={3}
                maxLength={50}
                aria-invalid={!!error}
                aria-describedby="username-hint"
                className="w-full px-4 py-3 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/30 transition-colors"
                placeholder="Choose a username"
              />
              <p id="username-hint" className="text-gray-400 text-xs mt-1">3-50 characters, letters, numbers, underscores, hyphens</p>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                aria-invalid={!!error}
                className="w-full px-4 py-3 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/30 transition-colors"
                placeholder="you@example.com"
              />
            </div>

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
                max={new Date().toISOString().slice(0, 10)}
                aria-invalid={!!error}
                aria-describedby="dob-hint"
                className="w-full px-4 py-3 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/30 transition-colors [color-scheme:dark]"
              />
              <p id="dob-hint" className="text-gray-400 text-xs mt-1">You must be 18 or older. Concordia contains mature, violent content.</p>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={12}
                  autoComplete="new-password"
                  aria-invalid={!!error}
                  className="w-full px-4 py-3 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/30 transition-colors pr-12"
                  placeholder="Minimum 12 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-300 mb-2">
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
                aria-invalid={!!error}
                className="w-full px-4 py-3 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/30 transition-colors"
                placeholder="Re-enter password"
              />
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                required
                className="mt-1 rounded border-lattice-border bg-lattice-deep accent-neon-cyan"
              />
              <span className="text-xs text-gray-400">
                I confirm I am at least 18 years old and agree to the{' '}
                <Link href="/legal/terms" target="_blank" className="text-neon-cyan hover:underline">Terms of Service</Link>
                {' '}and{' '}
                <Link href="/legal/privacy" target="_blank" className="text-neon-cyan hover:underline">Privacy Policy</Link>
              </span>
            </label>

            <button
              type="submit"
              disabled={loading || !agreedToTerms}
              className="w-full py-3 bg-gradient-to-r from-neon-cyan to-neon-blue rounded-lg text-white font-semibold hover:shadow-lg hover:shadow-neon-cyan/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="animate-pulse">Creating account...</span>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Create Account
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-400 text-sm">
              Already have an account?{' '}
              <Link href="/login" className="text-neon-cyan hover:text-neon-blue transition-colors font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-gray-400 text-xs mt-6">
          First user becomes the owner with full administrative access.
        </p>
      </div>
    </div>
  );
}
