'use client';

/**
 * AffectStateStrip — persistent 7D readout + ATS health (clinical header).
 */

import { motion } from 'framer-motion';
import { Shield, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAffectAts } from '@/components/affect/useAffectAts';
import { dimColor, dimBgColor } from '@/components/affect/affect-model';
import { ErrorState } from '@/components/common/EmptyState';

export function AffectStateStrip() {
  const {
    sessionId,
    setSessionId,
    dimValues,
    healthData,
    overallScore,
    warnings,
    resetAffect,
    isLoading,
    isError,
    errorMessage,
    refetchAll,
  } = useAffectAts();

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-live="polite" className="flex items-center gap-3 py-4">
        <div className="w-6 h-6 border-2 border-neon-pink border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading affect state…</p>
      </div>
    );
  }

  if (isError) {
    return <ErrorState error={errorMessage} onRetry={refetchAll} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-3">
        <input
          type="text"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          className="input-lattice w-40 text-sm"
          placeholder="Session ID"
          aria-label="Affect session id"
        />
        <button
          type="button"
          onClick={() => resetAffect.mutate(undefined)}
          disabled={resetAffect.isPending}
          className="btn-neon flex items-center gap-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3 h-3 ${resetAffect.isPending ? 'animate-spin' : ''}`} />
          {resetAffect.isPending ? 'Resetting...' : 'Reset'}
        </button>
        <button
          type="button"
          onClick={() => resetAffect.mutate('cooldown')}
          disabled={resetAffect.isPending}
          className="btn-neon flex items-center gap-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          title="Council-mandated cooldown"
        >
          <Shield className="w-3 h-3" /> Cooldown
        </button>
      </div>

      {healthData && (
        <div
          className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${
            healthData.healthy !== false
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {healthData.healthy !== false ? (
            <Shield className="w-4 h-4" />
          ) : (
            <AlertTriangle className="w-4 h-4" />
          )}
          ATS Health: {healthData.healthy !== false ? 'Operational' : 'Degraded'} —{' '}
          {typeof healthData.sessions === 'number' ? healthData.sessions : 0} active sessions
          {overallScore != null && (
            <span className="ml-auto font-mono">Score: {(overallScore * 100).toFixed(0)}%</span>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <div
              key={i}
              className={`p-2 rounded-lg border text-xs flex items-center gap-2 ${
                w.severity === 'critical'
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium">{w.dimension}:</span>
              {w.message}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {dimValues.map((dim) => (
          <motion.div
            key={dim.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel p-3"
          >
            <div className={`flex items-center gap-1 mb-2 ${dim.color}`}>
              {dim.icon}
              <span className="text-xs font-medium">{dim.label}</span>
            </div>
            <p className={`text-2xl font-bold font-mono ${dimColor(dim.key === 'f' ? 1 - dim.value : dim.value)}`}>
              {(dim.value * 100).toFixed(1)}%
            </p>
            <div className="h-2 bg-lattice-deep rounded-full mt-2 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${dim.value * 100}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className={`h-full rounded-full ${dimBgColor(dim.key === 'f' ? 1 - dim.value : dim.value)}`}
              />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
