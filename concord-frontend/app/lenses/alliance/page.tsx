'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { Loading } from '@/components/common/Loading';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, MessageSquare, Target, Shield, Zap, Layers, ChevronDown, Crown } from 'lucide-react';
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
  const [showFeatures, setShowFeatures] = useState(false);

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
          { icon: Users, color: 'text-neon-cyan', value: alliances.reduce((s, a) => s + a.members.length, 0), label: 'Total Members' },
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
      {alliances.length > 0 && (
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
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors"
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
