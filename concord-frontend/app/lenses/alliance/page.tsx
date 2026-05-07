'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { Loading } from '@/components/common/Loading';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, MessageSquare, Target, Zap, Layers, ChevronDown, HeartHandshake as Handshake, Crown, Loader2, XCircle, Shield, Network, BarChart3, AlertTriangle, CheckCircle } from 'lucide-react';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

interface AllianceData {
  name: string;
  description: string;
  members: string[];
  type: 'research' | 'security' | 'development' | 'governance';
  status: 'active' | 'forming' | 'dissolved';
  sharedWorkspace: string;
  activeProposals: number;
  createdAt: string;
}

interface MessageData {
  allianceId: string;
  sender: string;
  content: string;
  timestamp: string;
}

const SEED_ALLIANCES: {
  title: string;
  data: Record<string, unknown>;
}[] = [];

const SEED_MESSAGES: {
  title: string;
  data: Record<string, unknown>;
}[] = [];

export default function AllianceLensPage() {
  useLensNav('alliance');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('alliance');
  const [selectedAlliance, setSelectedAlliance] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [newAllianceName, setNewAllianceName] = useState('');
  const [newAllianceDesc, setNewAllianceDesc] = useState('');
  const [newAllianceType, setNewAllianceType] = useState<AllianceData['type']>('research');
  const [showFeatures, setShowFeatures] = useState(true);

  // Backend action wiring
  const runAction = useRunArtifact('alliance');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleAllianceAction = async (action: string) => {
    const targetId = selectedAlliance || allianceItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  const {
    items: allianceItems,
    isLoading: alliancesLoading, isError: isError, error: error, refetch: refetch,
    create: createAlliance,
    createMut: createAllianceMut,
  } = useLensData<AllianceData>('alliance', 'alliance', {
    seed: SEED_ALLIANCES,
  });

  const {
    items: messageItems,
    isLoading: messagesLoading, isError: isError2, error: error2, refetch: refetch2,
    create: createMessage,
    createMut: createMessageMut,
  } = useLensData<MessageData>('alliance', 'message', {
    seed: SEED_MESSAGES,
  });

  // Map lens items to the shapes used in rendering
  const alliances = allianceItems.map((item) => ({
    id: item.id,
    name: item.title || item.data?.name || '',
    description: item.data?.description || '',
    members: item.data?.members || [],
    type: (item.data?.type || 'research') as AllianceData['type'],
    status: (item.data?.status || 'forming') as AllianceData['status'],
    sharedWorkspace: item.data?.sharedWorkspace || '',
    activeProposals: item.data?.activeProposals ?? 0,
    createdAt: item.data?.createdAt || item.createdAt,
  }));

  const messages = messageItems.map((item) => ({
    id: item.id,
    allianceId: item.data?.allianceId || '',
    sender: item.data?.sender || '',
    content: item.data?.content || '',
    timestamp: item.data?.timestamp || item.createdAt,
  }));

  const typeColors = {
    research: 'text-neon-purple bg-neon-purple/20',
    security: 'text-neon-green bg-neon-green/20',
    development: 'text-neon-cyan bg-neon-cyan/20',
    governance: 'text-neon-blue bg-neon-blue/20',
  };

  const typeBorderGradients: Record<string, string> = {
    research: 'border-purple-500/60',
    security: 'border-red-500/60',
    development: 'border-blue-500/60',
    governance: 'border-amber-500/60',
  };

  const selectedAllianceData = alliances.find((a) => a.id === selectedAlliance);
  const allianceMessages = messages.filter((m) => m.allianceId === selectedAlliance);

  const handleCreateAlliance = async () => {
    if (!newAllianceName.trim()) return;
    await createAlliance({
      title: newAllianceName,
      data: {
        name: newAllianceName,
        description: newAllianceDesc,
        members: [],
        type: newAllianceType,
        status: 'forming',
        sharedWorkspace: newAllianceName.toLowerCase().replace(/\s+/g, '-'),
        activeProposals: 0,
        createdAt: new Date().toISOString().split('T')[0],
      } as Partial<AllianceData>,
    });
    setNewAllianceName('');
    setNewAllianceDesc('');
    setShowCreate(false);
  };

  const handleSendMessage = async () => {
    if (!chatMessage.trim() || !selectedAlliance) return;
    await createMessage({
      title: `Message in ${selectedAllianceData?.name || 'alliance'}`,
      data: {
        allianceId: selectedAlliance,
        sender: 'You',
        content: chatMessage,
        timestamp: new Date().toISOString(),
      } as Partial<MessageData>,
    });
    setChatMessage('');
  };

  const isLoading = alliancesLoading || messagesLoading;

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loading text="Loading alliances..." />
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
    <div data-lens-theme="alliance" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🤝</span>
          <div>
            <h1 className="text-xl font-bold">Alliance Lens</h1>
            <p className="text-sm text-gray-400">
              Multi-entity collaboration and shared workspaces
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="alliance" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-neon purple"
        >
          <Plus className="w-4 h-4 mr-2 inline" />
          Form Alliance
        </button>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="alliance" artifactId={allianceItems[0]?.id} compact />
      {/* Create Alliance Form */}
      {showCreate && (
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">Form New Alliance</h3>
          <input
            type="text"
            value={newAllianceName}
            onChange={(e) => setNewAllianceName(e.target.value)}
            placeholder="Alliance name..."
            className="input-lattice w-full"
          />
          <input
            type="text"
            value={newAllianceDesc}
            onChange={(e) => setNewAllianceDesc(e.target.value)}
            placeholder="Description..."
            className="input-lattice w-full"
          />
          <select
            value={newAllianceType}
            onChange={(e) => setNewAllianceType(e.target.value as AllianceData['type'])}
            className="input-lattice w-full"
          >
            <option value="research">Research</option>
            <option value="security">Security</option>
            <option value="development">Development</option>
            <option value="governance">Governance</option>
          </select>
          <button
            onClick={handleCreateAlliance}
            disabled={createAllianceMut.isPending || !newAllianceName.trim()}
            className="btn-neon green w-full"
          >
            {createAllianceMut.isPending ? 'Creating...' : 'Create Alliance'}
          </button>
        </div>
      )}

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Users, color: 'text-neon-purple', value: alliances.length, label: 'Total Alliances' },
          { icon: Zap, color: 'text-neon-green', value: alliances.filter((a) => a.status === 'active').length, label: 'Active' },
          { icon: Target, color: 'text-neon-blue', value: alliances.reduce((s, a) => s + a.activeProposals, 0), label: 'Joint Proposals' },
          { icon: Handshake, color: 'text-neon-cyan', value: alliances.reduce((s, a) => s + a.members.length, 0), label: 'Total Members' },
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

      {/* Alliance Strength Meter */}
      {alliances.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="panel p-4"
        >
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-400" />
            Alliance Strength Overview
          </h3>
          <div className="space-y-2">
            {alliances.slice(0, 5).map((alliance) => {
              const strength = Math.min(100, (alliance.members.length * 20) + (alliance.activeProposals * 10) + (alliance.status === 'active' ? 30 : 0));
              return (
                <div key={alliance.id} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-32 truncate">{alliance.name}</span>
                  <div className="flex-1 h-2 bg-lattice-deep rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${strength >= 70 ? 'bg-neon-green' : strength >= 40 ? 'bg-amber-400' : 'bg-neon-pink'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${strength}%` }}
                      transition={{ duration: 0.8, delay: 0.4 }}
                    />
                  </div>
                  <span className="text-xs font-mono w-10 text-right text-gray-300">{strength}%</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${typeColors[alliance.type]}`}>
                    {alliance.members.length}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
          <p>No alliances formed yet. Create an alliance to see collaboration data.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Alliance List */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-neon-purple" />
            Alliances
          </h2>
          <div className="space-y-3">
            <AnimatePresence>
            {alliances.map((alliance, i) => (
              <motion.button
                key={alliance.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ delay: i * 0.06 }}
                onClick={() => setSelectedAlliance(alliance.id)}
                className={`w-full text-left lens-card transition-all border-2 ${
                  selectedAlliance === alliance.id ? 'border-neon-cyan ring-1 ring-neon-cyan' : typeBorderGradients[alliance.type] || 'border-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">{alliance.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded ${typeColors[alliance.type]}`}>
                    {alliance.type}
                  </span>
                </div>
                <p className="text-sm text-gray-400 mb-2">{alliance.description}</p>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {alliance.members.length} members
                  </span>
                  <span className={alliance.status === 'active' ? 'text-neon-green' : 'text-gray-400'}>
                    {alliance.status}
                  </span>
                </div>
              </motion.button>
            ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Alliance Details & Chat */}
        <div className="lg:col-span-2 space-y-4">
          {selectedAllianceData ? (
            <>
              {/* Details */}
              <div className="panel p-4">
                <h2 className="font-semibold mb-4">{selectedAllianceData.name}</h2>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="lens-card">
                    <p className="text-xs text-gray-400">Shared Workspace</p>
                    <p className="font-mono">{selectedAllianceData.sharedWorkspace}</p>
                  </div>
                  <div className="lens-card">
                    <p className="text-xs text-gray-400">Active Proposals</p>
                    <p className="text-xl font-bold text-neon-purple">{selectedAllianceData.activeProposals}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-2">Members</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedAllianceData.members.map((member) => (
                      <span key={member} className="px-3 py-1 bg-lattice-surface rounded-full text-sm">
                        {member}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Backend Action Panels ── */}
              <div className="panel p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-neon-yellow" />
                  Alliance Analysis
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => handleAllianceAction('compatibilityScore')}
                    disabled={isRunning !== null}
                    className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-neon-cyan/50 transition-colors disabled:opacity-50"
                  >
                    {isRunning === 'compatibilityScore' ? <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" /> : <Handshake className="w-5 h-5 text-neon-cyan" />}
                    <span className="text-xs text-gray-300">Compatibility Score</span>
                  </button>
                  <button
                    onClick={() => handleAllianceAction('networkAnalysis')}
                    disabled={isRunning !== null}
                    className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-neon-purple/50 transition-colors disabled:opacity-50"
                  >
                    {isRunning === 'networkAnalysis' ? <Loader2 className="w-5 h-5 text-neon-purple animate-spin" /> : <Network className="w-5 h-5 text-neon-purple" />}
                    <span className="text-xs text-gray-300">Network Analysis</span>
                  </button>
                  <button
                    onClick={() => handleAllianceAction('riskAssessment')}
                    disabled={isRunning !== null}
                    className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-red-400/50 transition-colors disabled:opacity-50"
                  >
                    {isRunning === 'riskAssessment' ? <Loader2 className="w-5 h-5 text-red-400 animate-spin" /> : <Shield className="w-5 h-5 text-red-400" />}
                    <span className="text-xs text-gray-300">Risk Assessment</span>
                  </button>
                </div>

                {/* Action Result Display */}
                {actionResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 p-3 bg-lattice-deep rounded-lg border border-lattice-border"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-neon-cyan" /> Result
                      </h4>
                      <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white">
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Compatibility Score Result */}
                    {actionResult.compositeScore !== undefined && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="text-3xl font-bold text-neon-cyan">{actionResult.compositeScore as number}%</div>
                          <div>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                              (actionResult.compatibilityLevel as string) === 'excellent' ? 'bg-green-500/20 text-green-400' :
                              (actionResult.compatibilityLevel as string) === 'good' ? 'bg-blue-500/20 text-blue-400' :
                              (actionResult.compatibilityLevel as string) === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-red-500/20 text-red-400'
                            }`}>
                              {actionResult.compatibilityLevel as string}
                            </span>
                            <p className="text-xs text-gray-400 mt-1">{actionResult.partnerA as string} + {actionResult.partnerB as string}</p>
                          </div>
                        </div>
                        {!!actionResult.componentScores && (
                          <div className="grid grid-cols-2 gap-2">
                            {Object.entries(actionResult.componentScores as Record<string, number>).map(([key, val]) => (
                              <div key={key} className="p-2 bg-lattice-surface rounded">
                                <p className="text-[10px] text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                                <p className="text-sm font-bold text-white">{val}%</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {!!actionResult.overlap && (
                          <div className="text-xs text-gray-400 space-y-1">
                            {Object.entries(actionResult.overlap as Record<string, string[]>).map(([key, vals]) => (
                              vals.length > 0 && (
                                <div key={key} className="flex items-center gap-2">
                                  <CheckCircle className="w-3 h-3 text-neon-green flex-shrink-0" />
                                  <span className="capitalize">{key}:</span>
                                  <span className="text-white">{vals.join(', ')}</span>
                                </div>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Network Analysis Result */}
                    {actionResult.nodeCount !== undefined && actionResult.density !== undefined && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div className="p-2 bg-lattice-surface rounded text-center">
                            <p className="text-sm font-bold text-neon-cyan">{actionResult.nodeCount as number}</p>
                            <p className="text-[10px] text-gray-500">Nodes</p>
                          </div>
                          <div className="p-2 bg-lattice-surface rounded text-center">
                            <p className="text-sm font-bold text-neon-purple">{actionResult.edgeCount as number}</p>
                            <p className="text-[10px] text-gray-500">Edges</p>
                          </div>
                          <div className="p-2 bg-lattice-surface rounded text-center">
                            <p className="text-sm font-bold text-neon-green">{actionResult.density as number}</p>
                            <p className="text-[10px] text-gray-500">Density</p>
                          </div>
                          <div className="p-2 bg-lattice-surface rounded text-center">
                            <p className="text-sm font-bold text-neon-blue">{actionResult.connectedComponents as number}</p>
                            <p className="text-[10px] text-gray-500">Components</p>
                          </div>
                        </div>
                        <div className="text-xs text-gray-400">
                          <span>Global Clustering: <span className="text-white font-medium">{actionResult.globalClusteringCoefficient as number}</span></span>
                        </div>
                        {(actionResult.brokers as Array<{ name: string; brokerageScore: number }>)?.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Key Brokers</p>
                            <div className="space-y-1">
                              {(actionResult.brokers as Array<{ name: string; brokerageScore: number }>).slice(0, 3).map((b, i) => (
                                <div key={i} className="flex items-center justify-between text-xs p-1.5 bg-lattice-surface rounded">
                                  <span className="text-white">{b.name}</span>
                                  <span className="text-neon-purple font-mono">{b.brokerageScore}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Risk Assessment Result */}
                    {actionResult.overallRiskScore !== undefined && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className={`text-3xl font-bold ${
                            (actionResult.riskLevel as string) === 'critical' ? 'text-red-400' :
                            (actionResult.riskLevel as string) === 'high' ? 'text-orange-400' :
                            (actionResult.riskLevel as string) === 'moderate' ? 'text-yellow-400' :
                            'text-green-400'
                          }`}>{actionResult.overallRiskScore as number}</div>
                          <div>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded uppercase ${
                              (actionResult.riskLevel as string) === 'critical' ? 'bg-red-500/20 text-red-400' :
                              (actionResult.riskLevel as string) === 'high' ? 'bg-orange-500/20 text-orange-400' :
                              (actionResult.riskLevel as string) === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-green-500/20 text-green-400'
                            }`}>
                              {actionResult.riskLevel as string} risk
                            </span>
                            <p className="text-xs text-gray-400 mt-1">HHI: {actionResult.hhi as number} ({actionResult.hhiClassification as string})</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-2 bg-lattice-surface rounded text-center">
                            <p className="text-sm font-bold text-white">{actionResult.allianceCount as number}</p>
                            <p className="text-[10px] text-gray-500">Alliances Analyzed</p>
                          </div>
                          <div className="p-2 bg-lattice-surface rounded text-center">
                            <p className="text-sm font-bold text-neon-green">{actionResult.diversificationIndex as number}</p>
                            <p className="text-[10px] text-gray-500">Diversification</p>
                          </div>
                        </div>
                        {(actionResult.singlePointsOfFailure as Array<{ category: string; partnerName: string; isCritical: boolean }>)?.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Single Points of Failure</p>
                            <div className="space-y-1">
                              {(actionResult.singlePointsOfFailure as Array<{ category: string; partnerName: string; isCritical: boolean }>).map((spof, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs p-1.5 bg-red-500/10 rounded">
                                  <AlertTriangle className={`w-3 h-3 flex-shrink-0 ${spof.isCritical ? 'text-red-400' : 'text-yellow-400'}`} />
                                  <span className="text-gray-300">{spof.category}:</span>
                                  <span className="text-white">{spof.partnerName}</span>
                                  {spof.isCritical && <span className="text-red-400 font-medium">CRITICAL</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Fallback: message-only */}
                    {!!actionResult.message && !actionResult.compositeScore && !actionResult.nodeCount && !actionResult.overallRiskScore && (
                      <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                    )}
                  </motion.div>
                )}
              </div>

              {/* Chat */}
              <div className="panel p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-neon-blue" />
                  Alliance Chat
                </h3>
                <div className="space-y-3 mb-4 max-h-60 overflow-auto">
                  {allianceMessages.length === 0 ? (
                    <p className="text-center py-4 text-gray-500">No messages yet</p>
                  ) : (
                    allianceMessages.map((msg) => (
                      <div key={msg.id} className="bg-lattice-deep p-3 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-neon-cyan">{msg.sender}</span>
                          <span className="text-xs text-gray-500">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300">{msg.content}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Message the alliance..."
                    className="input-lattice flex-1"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={createMessageMut.isPending || !chatMessage.trim()}
                    className="btn-neon"
                  >
                    {createMessageMut.isPending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="panel p-4 h-full flex items-center justify-center">
              <div className="text-center text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select an alliance to view details</p>
              </div>
            </div>
          )}
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="alliance"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="alliance" />
          </div>
        )}
      </div>
    </div>
  );
}
