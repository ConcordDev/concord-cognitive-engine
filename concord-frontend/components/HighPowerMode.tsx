// concord-frontend/components/HighPowerMode.tsx
//
// Settings panel section for the High Power Mode toggle.
//
// Lets the user switch between:
// - private (default): all calls go to local Ollama
// - high_power: free cloud providers as fallback when Ollama is busy
//
// Shows per-provider quota usage (calls today / limit) and a reset countdown.

import React, { useState, useEffect, useCallback } from 'react';

export interface ProviderStatus {
  provider: string;
  configured: boolean;
}

export interface ProviderQuota {
  calls: number;
  callsLimit: number;
  exhausted: boolean;
}

export interface QuotaStatus {
  callsToday: number;
  perProvider: Record<string, ProviderQuota>;
  resetsAt: number;
  providers: ProviderStatus[];
}

export interface HighPowerModeProps {
  currentMode: 'private' | 'high_power';
  onModeChange: (mode: 'private' | 'high_power') => Promise<void>;
  onRefreshQuota: () => Promise<QuotaStatus>;
}

const formatResetTime = (ms: number): string => {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
};

export function HighPowerMode({ currentMode, onModeChange, onRefreshQuota }: HighPowerModeProps) {
  const [pending, setPending] = useState(false);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const q = await onRefreshQuota();
      setQuota(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quota');
    }
  }, [onRefreshQuota]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleToggle = async () => {
    if (currentMode === 'private') {
      setConfirming(true);
    } else {
      setPending(true);
      try {
        await onModeChange('private');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update');
      } finally {
        setPending(false);
      }
    }
  };

  const confirmHighPower = async () => {
    setConfirming(false);
    setPending(true);
    setError(null);
    try {
      await onModeChange('high_power');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setPending(false);
    }
  };

  const resetMs = quota ? Math.max(0, quota.resetsAt - Date.now()) : 0;

  return (
    <div className="high-power-mode">
      <h3>Brain Mode</h3>
      <p className="muted">
        Private: every call stays on local Concord. High Power: free cloud models as fallback.
      </p>

      <div className="toggle">
        <button
          onClick={handleToggle}
          disabled={pending}
          className={currentMode === 'high_power' ? 'active' : ''}
        >
          {currentMode === 'private' ? 'Switch to High Power' : 'Switch to Private'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {confirming && (
        <div className="confirm-modal">
          <h4>Enable High Power Mode?</h4>
          <p>
            High Power sends requests to free cloud providers (OpenRouter, Cerebras, Groq, Gemini,
            Mistral, Cloudflare Workers AI). These providers may log prompts. Free-tier daily limits
            apply — your requests share quota with other users.
          </p>
          <button onClick={confirmHighPower} disabled={pending}>Yes, Enable</button>
          <button onClick={() => setConfirming(false)} disabled={pending}>Cancel</button>
        </div>
      )}

      {currentMode === 'high_power' && quota && (
        <div className="quota-display">
          <h4>Today's Usage</h4>
          <p className="reset-countdown">
            Resets in <strong>{formatResetTime(resetMs)}</strong>
          </p>
          {Object.entries(quota.perProvider).map(([provider, p]) => (
            <div key={provider} className={'quota-row ' + (p.exhausted ? 'exhausted' : '')}>
              <span className="provider-name">{provider}</span>
              <span className="quota-bar">
                <span
                  className="quota-fill"
                  style={{ width: `${Math.min(100, (p.calls / p.callsLimit) * 100)}%` }}
                />
              </span>
              <span className="quota-numbers">
                {p.calls} / {p.callsLimit}
                {p.exhausted && ' (exhausted, try next provider)'}
              </span>
            </div>
          ))}
        </div>
      )}

      {quota && quota.providers.filter(p => p.configured).length === 0 && (
        <div className="warning">
          No cloud providers configured. High Power Mode will fall through to local Ollama.
        </div>
      )}
    </div>
  );
}

export default HighPowerMode;
