/**
 * ButtonClickGuard.tsx — prevent ghost clicks + show loading state.
 *
 * When a button click triggers an API call:
 * - First click: fires the action, shows spinner
 * - Subsequent clicks (during action): blocked + debounced
 * - Action completes (success/error): re-enables button
 *
 * Fixes "ghost clicks on buttons" — common when the API call hangs
 * (event_loop_lag_critical) and user clicks again thinking nothing happened.
 */

import { useCallback, useRef, useState } from 'react';

export interface ButtonClickGuardOptions {
  /** Async action to run on click */
  onClick: (e: React.MouseEvent) => Promise<void> | void;
  /** Disable the button (overrides guard) */
  disabled?: boolean;
  /** Show loading spinner during action */
  showSpinner?: boolean;
  /** Time to lock button after click (ms) — even if action fails */
  lockMs?: number;
  /** Minimum interval between clicks (ms) — debounce */
  debounceMs?: number;
}

export function useButtonClickGuard({
  onClick,
  disabled,
  showSpinner = true,
  lockMs = 300,
  debounceMs = 250,
}: ButtonClickGuardOptions) {
  const [loading, setLoading] = useState(false);
  const lastClickRef = useRef(0);
  const lockUntilRef = useRef(0);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    const now = Date.now();

    // Debounce: too soon since last click
    if (now - lastClickRef.current < debounceMs) {
      e.preventDefault();
      return;
    }

    // Locked: still within lock window
    if (now < lockUntilRef.current) {
      e.preventDefault();
      return;
    }

    // Manual disable
    if (disabled) {
      e.preventDefault();
      return;
    }

    lastClickRef.current = now;
    lockUntilRef.current = now + lockMs;
    setLoading(true);

    try {
      await onClick(e);
    } finally {
      // Small grace period before unlocking (visual feedback)
      setTimeout(() => setLoading(false), 100);
    }
  }, [onClick, disabled, lockMs, debounceMs]);

  return {
    onClick: handleClick,
    loading: showSpinner && loading,
    disabled: disabled || loading,
  };
}

/**
 * Wrapper component for inline use.
 */
export function GuardedButton({
  children,
  onClick,
  disabled,
  loadingText = '...',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  onClick: (e: React.MouseEvent) => Promise<void> | void;
  loadingText?: string;
}) {
  const guard = useButtonClickGuard({ onClick, disabled });

  return (
    <button
      {...rest}
      onClick={guard.onClick}
      disabled={guard.disabled}
      style={{
        position: 'relative',
        opacity: guard.loading ? 0.7 : 1,
        cursor: guard.loading ? 'wait' : (rest.style?.cursor ?? 'pointer'),
        ...rest.style,
      }}
    >
      {guard.loading ? loadingText : children}
      {guard.loading && (
        <span style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 12,
          height: 12,
          border: '2px solid rgba(255,255,255,0.3)',
          borderTop: '2px solid #fff',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      )}
    </button>
  );
}

export default useButtonClickGuard;
