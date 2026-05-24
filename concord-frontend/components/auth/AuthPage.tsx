'use client';

import { useState, useCallback, FormEvent, useEffect } from 'react';
import { Loader2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { OAuthButtons } from './OAuthButtons';
import { useAuth } from '@/hooks/useAuth';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

type AuthMode = 'signin' | 'signup';

interface AuthPageProps {
  /** URL to redirect to after successful auth. Default: "/" */
  redirectTo?: string;
  /** Optional callback on successful auth */
  onAuthSuccess?: (user: { id: string; username: string; email: string }) => void;
}

export function AuthPage({ redirectTo: rawRedirectTo = '/', onAuthSuccess }: AuthPageProps) {
  // Validate redirect is a safe relative path to prevent open redirect attacks
  const redirectTo = rawRedirectTo.startsWith('/') && !rawRedirectTo.startsWith('//') ? rawRedirectTo : '/';
  const { user, isLoading: isCheckingAuth, isAuthenticated } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      if (onAuthSuccess) {
        onAuthSuccess(user);
      } else if (typeof window !== 'undefined') {
        window.location.href = redirectTo;
      }
    }
  }, [isAuthenticated, user, redirectTo, onAuthSuccess]);

  // Check for auth=success from OAuth redirect
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      const provider = params.get('provider');
      const isNew = params.get('new') === '1';
      setSuccessMessage(
        isNew
          ? `Account created with ${provider || 'OAuth'}! Redirecting...`
          : `Signed in with ${provider || 'OAuth'}! Redirecting...`
      );
      // Clean up URL params
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
  }, []);

  const handleOAuthError = useCallback((errorMsg: string) => {
    setError(errorMsg);
  }, []);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const endpoint = mode === 'signup' ? '/api/auth/register' : '/api/auth/login';
      const body = mode === 'signup'
        ? { username, email, password }
        : { email, password };

      const resp = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await resp.json();

      if (!resp.ok || !data.ok) {
        setError(data.error || 'Authentication failed');
        return;
      }

      // Success. If this is a signup (register endpoint), or the user
      // hasn't completed onboarding (no region/nation/primary lens),
      // route them through the onboarding flow before anything else.
      // Sign-in users who already have all three just go to the
      // requested destination.
      if (mode === 'signup') {
        window.location.href = '/onboarding';
        return;
      }
      try {
        // Probe /me to find out whether they need onboarding. If the
        // endpoint is unavailable for any reason we fall through to
        // the normal redirect so a broken /me doesn't block sign-in.
        const meResp = await fetch(`${BASE_URL}/api/auth/me`, { credentials: 'include' });
        if (meResp.ok) {
          const me = await meResp.json();
          if (me?.user?.needsOnboarding) {
            window.location.href = '/onboarding';
            return;
          }
        }
      } catch {
        /* non-fatal — fall through */
      }
      if (onAuthSuccess && data.user) {
        onAuthSuccess(data.user);
      } else {
        window.location.href = redirectTo;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [mode, email, username, password, redirectTo, onAuthSuccess]);

  const toggleMode = useCallback(() => {
    setMode(m => m === 'signin' ? 'signup' : 'signin');
    setError(null);
    setSuccessMessage(null);
  }, []);

  // Show loading while checking existing auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-lattice-void flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-neon-cyan animate-spin" />
          <p className="text-sm text-gray-400">Checking authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-lattice-void flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">
            {mode === 'signin' ? 'Sign in to Concord' : 'Create your account'}
          </h1>
          <p className="text-sm text-gray-400">
            {mode === 'signin'
              ? 'Welcome back. Sign in to continue.'
              : 'Get started with Concord Cognitive Engine.'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-lattice-elevated border border-lattice-surface rounded-xl p-6 shadow-2xl">
          {/* Success message */}
          {successMessage && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700 text-green-300 text-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              {successMessage}
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* OAuth Buttons */}
          <OAuthButtons
            labelPrefix={mode === 'signin' ? 'Sign in with' : 'Sign up with'}
            onError={handleOAuthError}
            className="mb-6"
          />

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-lattice-surface" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-lattice-elevated px-3 text-gray-400">
                or continue with email
              </span>
            </div>
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username (sign-up only) */}
            {mode === 'signup' && (
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required={mode === 'signup'}
                  minLength={3}
                  maxLength={32}
                  autoComplete="username"
                  placeholder="Choose a username"
                  className="w-full px-4 py-2.5 rounded-lg bg-lattice-void border border-lattice-surface text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-neon-cyan focus:border-transparent transition-all"
                />
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 rounded-lg bg-lattice-void border border-lattice-surface text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-neon-cyan focus:border-transparent transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === 'signup' ? 12 : 1}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'signup' ? 'Minimum 12 characters' : 'Enter your password'}
                  className="w-full px-4 py-2.5 pr-10 rounded-lg bg-lattice-void border border-lattice-surface text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-neon-cyan focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-lg bg-neon-blue text-white font-medium text-sm hover:bg-neon-blue/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-lattice-elevated focus:ring-neon-blue disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* Toggle mode */}
          <div className="mt-6 text-center text-sm text-gray-400">
            {mode === 'signin' ? (
              <>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="text-neon-cyan hover:text-neon-cyan/80 font-medium transition-colors"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="text-neon-cyan hover:text-neon-cyan/80 font-medium transition-colors"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-gray-400">
          By continuing, you agree to the Concord terms of service and privacy policy.
        </p>
      </div>
    </div>
  );
}
