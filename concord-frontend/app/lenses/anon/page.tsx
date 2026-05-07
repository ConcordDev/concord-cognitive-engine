'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Send, RefreshCw, Eye, EyeOff, Lock, Timer, ShieldCheck, Loader2, XCircle, Zap, BarChart3, AlertTriangle, CheckCircle, Fingerprint, ShieldAlert, Waves } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

interface AnonMessage {
  id: string;
  content: string;
  timestamp: string;
  encrypted: boolean;
  expiresAt?: string;
}

export default function AnonLensPage() {
  useLensNav('anon');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('anon');

  const [message, setMessage] = useState('');
  const [recipient, setRecipient] = useState('');
  const [showMessages, setShowMessages] = useState(true);
  const [ephemeral, setEphemeral] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  // Session timer
  useEffect(() => {
    const interval = setInterval(() => setSessionSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const { items: messageItems, isLoading, isError: isError, error: error, refetch: refetch, create: createMessage } = useLensData<Record<string, unknown>>('anon', 'message', { seed: [] });
  const messages = messageItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as AnonMessage[];

  const { items: identityItems, isError: isError2, error: error2, refetch: refetch2, create: createIdentity, remove: removeIdentity } = useLensData<Record<string, unknown>>('anon', 'identity', { seed: [] });

  // Backend action wiring
  const runAction = useRunArtifact('anon');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleAnonAction = async (action: string) => {
    const targetId = messageItems[0]?.id || identityItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };
  const identity = identityItems.length > 0 ? identityItems[0].data : null;

  // Anonymity level based on identity rotation and message count
  const anonymityLevel = identity ? (identityItems.length > 0 && (identity as Record<string, unknown>).rotatedAt ? 'high' : 'medium') : 'low';
  const anonymityColors = { low: 'text-red-400 bg-red-400/20', medium: 'text-amber-400 bg-amber-400/20', high: 'text-neon-green bg-neon-green/20' };

  const sendMessage = useMutation({
    mutationFn: (payload: { content: string; recipient: string; ephemeral: boolean }) =>
      createMessage({ title: 'message', data: payload }),
    onSuccess: () => {
      refetch();
      setMessage('');
      setRecipient('');
    },
    onError: (err) => console.error('Send anonymous message failed:', err instanceof Error ? err.message : err),
  });

  const rotateIdentity = useMutation({
    mutationFn: async () => {
      if (identityItems.length > 0) await removeIdentity(identityItems[0].id);
      return createIdentity({ title: 'identity', data: { alias: `anon-${Math.random().toString(36).slice(2, 8)}`, rotatedAt: new Date().toISOString() } });
    },
    onSuccess: () => {
      refetch2();
    },
    onError: (err) => console.error('Identity rotation failed:', err instanceof Error ? err.message : err),
  });


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="anon" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">👤</span>
          <div>
            <h1 className="text-xl font-bold">Anon Lens</h1>
            <p className="text-sm text-gray-400">
              Anonymous E2E encrypted messaging
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="anon" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-neon-green" />
          <span className="text-sm text-neon-green">E2E Encrypted</span>
        </div>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="anon" artifactId={messageItems[0]?.id} compact />

      {/* ── Backend Action Panels ── */}
      <div className="panel p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-green" />
          Privacy Compute Actions
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <button onClick={() => handleAnonAction('anonymize')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-neon-green/50 transition-colors disabled:opacity-50">
            {isRunning === 'anonymize' ? <Loader2 className="w-5 h-5 text-neon-green animate-spin" /> : <Fingerprint className="w-5 h-5 text-neon-green" />}
            <span className="text-xs text-gray-300">Anonymize Data</span>
          </button>
          <button onClick={() => handleAnonAction('privacyRisk')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-red-400/50 transition-colors disabled:opacity-50">
            {isRunning === 'privacyRisk' ? <Loader2 className="w-5 h-5 text-red-400 animate-spin" /> : <ShieldAlert className="w-5 h-5 text-red-400" />}
            <span className="text-xs text-gray-300">Privacy Risk</span>
          </button>
          <button onClick={() => handleAnonAction('differentialPrivacy')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-neon-purple/50 transition-colors disabled:opacity-50">
            {isRunning === 'differentialPrivacy' ? <Loader2 className="w-5 h-5 text-neon-purple animate-spin" /> : <Waves className="w-5 h-5 text-neon-purple" />}
            <span className="text-xs text-gray-300">Differential Privacy</span>
          </button>
        </div>

        {/* Action Result Display */}
        {actionResult && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-3 bg-lattice-deep rounded-lg border border-lattice-border">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2"><BarChart3 className="w-4 h-4 text-neon-green" /> Result</h4>
              <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white"><XCircle className="w-4 h-4" /></button>
            </div>

            {/* Anonymize Result */}
            {actionResult.k !== undefined && actionResult.generalizationLevel !== undefined && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-green">{actionResult.k as number}</p><p className="text-[10px] text-gray-500">K-Anonymity</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-cyan">{actionResult.generalizationLevel as number}</p><p className="text-[10px] text-gray-500">Gen Level</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-purple">{actionResult.equivalenceClasses as number}</p><p className="text-[10px] text-gray-500">Equiv Classes</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-white">{(actionResult.informationLoss as number).toFixed(1)}%</p><p className="text-[10px] text-gray-500">Info Loss</p></div>
                </div>
                {(actionResult.quasiIdentifiers as string[])?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(actionResult.quasiIdentifiers as string[]).map((qi) => (
                      <span key={qi} className="text-[10px] px-1.5 py-0.5 bg-neon-green/10 text-neon-green rounded">{qi}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs">
                  {(actionResult.kAchieved as boolean)
                    ? <span className="flex items-center gap-1 text-neon-green"><CheckCircle className="w-3 h-3" /> K-anonymity satisfied</span>
                    : <span className="flex items-center gap-1 text-red-400"><AlertTriangle className="w-3 h-3" /> K-anonymity NOT satisfied</span>
                  }
                </div>
              </div>
            )}

            {/* Privacy Risk Result */}
            {actionResult.overallRiskLevel !== undefined && actionResult.attackModels !== undefined && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`text-3xl font-bold ${(actionResult.overallRiskLevel as string) === 'critical' || (actionResult.overallRiskLevel as string) === 'high' ? 'text-red-400' : (actionResult.overallRiskLevel as string) === 'moderate' ? 'text-yellow-400' : 'text-green-400'}`}>
                    {(actionResult.attackModels as Record<string, Record<string, unknown>>)?.prosecutor?.risk as number}%
                  </div>
                  <div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded uppercase ${(actionResult.overallRiskLevel as string) === 'critical' || (actionResult.overallRiskLevel as string) === 'high' ? 'bg-red-500/20 text-red-400' : (actionResult.overallRiskLevel as string) === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}`}>
                      {actionResult.overallRiskLevel as string} risk
                    </span>
                    <p className="text-xs text-gray-400 mt-1">Prosecutor risk: {(actionResult.attackModels as Record<string, Record<string, unknown>>)?.prosecutor?.risk as number}%</p>
                  </div>
                </div>
                {(actionResult.recommendations as string[])?.length > 0 && (
                  <div className="space-y-1">
                    {(actionResult.recommendations as string[]).map((v, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 p-1.5 rounded">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {v}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Differential Privacy Result */}
            {(actionResult.privacyParameters as Record<string, unknown>)?.epsilon !== undefined && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-purple">{(actionResult.privacyParameters as Record<string, unknown>)?.epsilon as number}</p><p className="text-[10px] text-gray-500">Epsilon (ε)</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-cyan">{(actionResult.privacyParameters as Record<string, unknown>)?.privacyLevel as string}</p><p className="text-[10px] text-gray-500">Privacy Level</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-green">{(actionResult.budgetTracking as Record<string, unknown>)?.cumulative as number}</p><p className="text-[10px] text-gray-500">Budget Used</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-white">{(actionResult.privacyParameters as Record<string, unknown>)?.queriesProcessed as number}</p><p className="text-[10px] text-gray-500">Queries</p></div>
                </div>
                <div className="text-xs text-gray-400">
                  Privacy guarantee: {((actionResult.privacyParameters as Record<string, unknown>)?.privacyLevel as string) || 'standard'}
                </div>
              </div>
            )}

            {/* Fallback */}
            {!!actionResult.message && !actionResult.k && !actionResult.overallRiskLevel && !(actionResult.privacyParameters as Record<string, unknown>)?.epsilon && (
              <p className="text-sm text-gray-400">{actionResult.message as string}</p>
            )}
          </motion.div>
        )}
      </div>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: EyeOff, color: 'text-neon-purple', value: messages?.length || 0, label: 'Messages' },
          { icon: Lock, color: 'text-neon-green', value: messages?.filter((m: AnonMessage) => m.encrypted).length || 0, label: 'Encrypted' },
          { icon: Timer, color: 'text-neon-cyan', value: formatTime(sessionSeconds), label: 'Session Time' },
          { icon: ShieldCheck, color: anonymityLevel === 'high' ? 'text-neon-green' : anonymityLevel === 'medium' ? 'text-amber-400' : 'text-red-400', value: anonymityLevel.toUpperCase(), label: 'Anonymity Level' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Anonymity Level Indicator */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="panel p-4 flex items-center gap-4"
      >
        <div className="flex items-center gap-2">
          <EyeOff className="w-5 h-5 text-neon-purple" />
          <span className="text-sm font-semibold">Anonymity Status</span>
        </div>
        <div className="flex-1 flex items-center gap-3">
          {['low', 'medium', 'high'].map((level) => (
            <div key={level} className={`flex-1 h-2 rounded-full ${anonymityLevel === level || (anonymityLevel === 'high' && level !== 'high') || (anonymityLevel === 'medium' && level === 'low') ? (level === 'low' ? 'bg-red-400' : level === 'medium' ? 'bg-amber-400' : 'bg-neon-green') : 'bg-lattice-deep'}`} />
          ))}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded ${anonymityColors[anonymityLevel]}`}>{anonymityLevel}</span>
        <div className="flex items-center gap-1.5 ml-2 px-2 py-1 rounded bg-neon-green/10 border border-neon-green/20">
          <Lock className="w-3 h-3 text-neon-green" />
          <span className="text-xs text-neon-green font-mono">E2E</span>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Identity Panel */}
        <div className="panel p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Shield className="w-4 h-4 text-neon-purple" />
            Anonymous Identity
          </h3>

          <div className="lens-card sovereignty-lock">
            <p className="text-xs text-gray-400 mb-1">Your Anon ID</p>
            <p className="font-mono text-sm break-all">
              {String(identity?.anonId || 'Loading...')}
            </p>
          </div>

          <div className="lens-card">
            <p className="text-xs text-gray-400 mb-1">Public Key</p>
            <p className="font-mono text-xs break-all text-gray-300">
              {String(identity?.publicKey || '').slice(0, 32)}...
            </p>
          </div>

          <button
            onClick={() => rotateIdentity.mutate()}
            disabled={rotateIdentity.isPending}
            className="btn-neon w-full flex items-center justify-center gap-2"
          >
            <RefreshCw
              className={`w-4 h-4 ${rotateIdentity.isPending ? 'animate-spin' : ''}`}
            />
            Rotate Identity
          </button>

          <p className="text-xs text-gray-500 text-center">
            Rotating generates a new anonymous identity
          </p>
        </div>

        {/* Message Compose */}
        <div className="lg:col-span-2 space-y-4">
          <div className="panel p-4 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Send className="w-4 h-4 text-neon-blue" />
              Send Anonymous Message
            </h3>

            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Recipient Anon ID or Public Key..."
              className="input-lattice font-mono text-sm"
            />

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your encrypted message..."
              className="input-lattice h-32 resize-none"
            />

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ephemeral}
                  onChange={(e) => setEphemeral(e.target.checked)}
                  className="rounded border-lattice-border bg-lattice-deep"
                />
                <span className="text-sm text-gray-400">Ephemeral (self-destruct)</span>
              </label>

              <button
                onClick={() =>
                  sendMessage.mutate({ content: message, recipient, ephemeral })
                }
                disabled={!message || !recipient || sendMessage.isPending}
                className="btn-neon purple"
              >
                <Send className="w-4 h-4 mr-2 inline" />
                {sendMessage.isPending ? 'Encrypting...' : 'Send'}
              </button>
            </div>
          </div>

          {/* Received Messages */}
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Shield className="w-4 h-4 text-neon-green" />
                Received Messages
              </h3>
              <button
                onClick={() => setShowMessages(!showMessages)}
                className="btn-neon p-2"
              >
                {showMessages ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>

            <div className="space-y-2">
              {messages?.length === 0 ? (
                <p className="text-center py-8 text-gray-500">
                  No messages yet. Your inbox is secure and empty.
                </p>
              ) : showMessages ? (
                messages?.map((msg: AnonMessage, i: number) => (
                  <motion.div key={msg.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="lens-card">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-400">
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                      {msg.encrypted && (
                        <Lock className="w-3 h-3 text-neon-green" />
                      )}
                    </div>
                    <p className="text-sm">{msg.content}</p>
                    {msg.expiresAt && (
                      <p className="text-xs text-neon-pink mt-2">
                        Expires: {new Date(msg.expiresAt).toLocaleString()}
                      </p>
                    )}
                  </motion.div>
                ))
              ) : (
                <p className="text-center py-8 text-gray-500">
                  Messages hidden for privacy
                </p>
              )}
            </div>
          </div>
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="anon"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>
    </div>
  );
}
