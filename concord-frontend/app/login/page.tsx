'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import { connectSocket } from '@/lib/realtime/socket';
import { Brain, Lock, Eye, EyeOff } from 'lucide-react';

function LoginForm() {
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Fetch CSRF token before login (needed for the POST itself in production)
      await api.get('/api/auth/csrf-token').catch(() => {});
      const res = await api.post('/api/auth/login', { username, password });
      if (res.data?.ok) {
        // Mark as entered so HomeClient shows dashboard
        localStorage.setItem('concord_entered', 'true');
        // Eagerly refresh CSRF token now that we have a real session
        await api.get('/api/auth/csrf-token').catch(() => {});
        // Connect WebSocket now that we have a session cookie
        connectSocket();
        // Record login timestamp so HomeClient won't redirect back during auth check race
        localStorage.setItem('concord_login_ts', String(Date.now()));
        // Redirect to the page they were trying to reach, or home
        // Validate redirect is a relative path to prevent open redirect attacks
        const from = searchParams.get('from');
        const safeRedirect = from && from.startsWith('/') && !from.startsWith('//') ? from : '/';
        // Use hard navigation (not router.push) so the browser sends cookies
        // with the request headers — prevents middleware redirect loop
        window.location.href = safeRedirect;
      } else {
        setError(res.data?.error || 'Login failed');
      }
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } } };
      setError(axErr?.response?.data?.error || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-lattice-void flex items-center justify-center px-4">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-neon-blue/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/3 w-96 h-96 bg-neon-purple/5 rounded-full blur-3xl" />
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
          <p className="text-gray-400 mt-3">Sign in to your sovereign cognitive engine</p>
        </div>

        {/* Form card */}
        <div className="bg-lattice-surface border border-lattice-border rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5" aria-describedby={error ? "login-error" : undefined} data-testid="login-form">
            {searchParams.get('verified') === 'true' && (
              <div role="status" className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
                Email verified! You can now sign in.
              </div>
            )}

            {searchParams.get('reset') === 'true' && (
              <div role="status" className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
                Password reset! Sign in with your new password.
              </div>
            )}

            {error && (
              <div id="login-error" role="alert" aria-live="assertive" className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-2">
                Username or Email
              </label>
              <input
                id="username"
                data-testid="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                aria-invalid={!!error}
                aria-describedby={error ? "login-error" : undefined}
                className="w-full px-4 py-3 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/30 transition-colors"
                placeholder="Enter username or email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  data-testid="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full px-4 py-3 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/30 transition-colors pr-12"
                  placeholder="Enter password"
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

            <div className="text-right">
              <Link href="/forgot-password" className="text-sm text-gray-400 hover:text-neon-cyan transition-colors">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              data-testid="login-submit"
              disabled={loading}
              aria-busy={loading}
              className="w-full py-3 bg-gradient-to-r from-neon-cyan to-neon-blue rounded-lg text-white font-semibold hover:shadow-lg hover:shadow-neon-cyan/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="animate-pulse">Signing in...</span>
                  <span className="sr-only">Signing in, please wait</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Sign In
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center space-y-1.5">
            <p className="text-gray-400 text-sm">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="text-neon-cyan hover:text-neon-blue transition-colors font-medium">
                Create one
              </Link>
            </p>
            <p className="text-gray-500 text-sm">
              Just curious?{' '}
              <Link href="/explore" className="text-neon-cyan hover:text-neon-blue transition-colors font-medium">
                Look around first
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-gray-400 text-xs mt-6">
          Sovereign by design. Your data never leaves your control.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
