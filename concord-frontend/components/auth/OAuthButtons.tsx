'use client';

import { getApiBase } from '@/lib/api/base';
import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

const BASE_URL = getApiBase();

interface OAuthButtonsProps {
  /** Optional label prefix. Default: "Continue with" */
  labelPrefix?: string;
  /** Callback when an error is received (e.g. from redirect query params) */
  onError?: (error: string) => void;
  /** Additional class names for the container */
  className?: string;
}

interface ProviderConfig {
  name: string;
  label: string;
  bg: string;
  text: string;
  hoverBg: string;
  border: string;
  icon: React.ReactNode;
}

/** Google "G" logo as inline SVG */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

/** Apple logo as inline SVG */
function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 22" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M14.94 11.58c-.02-2.13 1.74-3.15 1.82-3.2-1-1.45-2.54-1.65-3.08-1.67-1.31-.13-2.56.77-3.23.77-.67 0-1.7-.75-2.8-.73-1.44.02-2.77.84-3.51 2.13-1.5 2.6-.38 6.44 1.08 8.55.71 1.03 1.56 2.19 2.68 2.15 1.07-.04 1.48-.7 2.78-.7 1.3 0 1.67.7 2.78.67 1.16-.02 1.89-1.05 2.6-2.09.82-1.2 1.16-2.36 1.18-2.42-.03-.01-2.26-.87-2.28-3.44zM12.83 4.9c.59-.72 1-1.71.88-2.71-.86.04-1.9.57-2.51 1.29-.55.63-1.03 1.65-.9 2.62.96.07 1.93-.49 2.53-1.2z"
        fill="currentColor"
      />
    </svg>
  );
}

const PROVIDERS: Record<string, ProviderConfig> = {
  google: {
    name: 'google',
    label: 'Google',
    bg: 'bg-white',
    text: 'text-gray-800',
    hoverBg: 'hover:bg-gray-100',
    border: 'border border-gray-300',
    icon: <GoogleIcon />,
  },
  apple: {
    name: 'apple',
    label: 'Apple',
    bg: 'bg-black',
    text: 'text-white',
    hoverBg: 'hover:bg-gray-900',
    border: 'border border-black',
    icon: <AppleIcon />,
  },
};

export function OAuthButtons({
  labelPrefix = 'Continue with',
  onError,
  className = '',
}: OAuthButtonsProps) {
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);

  // Fetch available providers on mount
  useEffect(() => {
    let mounted = true;
    async function fetchProviders() {
      try {
        const resp = await fetch(`${BASE_URL}/api/auth/providers`, {
          credentials: 'include',
        });
        if (!resp.ok) throw new Error('Failed to fetch providers');
        const data = await resp.json();
        if (mounted && data.ok && Array.isArray(data.providers)) {
          setAvailableProviders(data.providers);
        }
      } catch {
        // Silently fail — OAuth buttons won't show if providers can't be fetched
      } finally {
        if (mounted) setIsLoadingProviders(false);
      }
    }
    fetchProviders();
    return () => { mounted = false; };
  }, []);

  // Check for error query params on mount (returned from OAuth redirect)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error && onError) {
      const errorMessages: Record<string, string> = {
        invalid_state: 'Authentication session expired. Please try again.',
        no_code: 'Authentication was cancelled.',
        no_email: 'Email address is required for sign-in.',
        no_identity: 'Could not verify your identity. Please try again.',
        oauth_failed: 'Authentication failed. Please try again.',
        user_not_found: 'Account not found. Please sign up first.',
      };
      onError(errorMessages[error] || `Authentication error: ${error}`);
    }
  }, [onError]);

  const handleOAuthClick = useCallback((provider: string) => {
    setLoadingProvider(provider);
    // Redirect to the OAuth initiation endpoint
    window.location.href = `${BASE_URL}/api/auth/${provider}`;
  }, []);

  // Don't render anything if no providers available
  if (isLoadingProviders) {
    return (
      <div className={`flex justify-center py-4 ${className}`}>
        <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (availableProviders.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {availableProviders.map((providerName) => {
        const provider = PROVIDERS[providerName];
        if (!provider) return null;

        const isLoading = loadingProvider === providerName;

        return (
          <button
            key={providerName}
            type="button"
            disabled={isLoading || loadingProvider !== null}
            onClick={() => handleOAuthClick(providerName)}
            className={`
              relative flex items-center justify-center gap-3 w-full px-4 py-3
              rounded-lg font-medium text-sm transition-all
              ${provider.bg} ${provider.text} ${provider.hoverBg} ${provider.border}
              disabled:opacity-60 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-lattice-void focus:ring-neon-cyan
            `}
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              provider.icon
            )}
            <span>
              {providerName === 'apple' ? 'Sign in with' : labelPrefix} {provider.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
