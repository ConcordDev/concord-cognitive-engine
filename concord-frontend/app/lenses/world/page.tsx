'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useSocket } from '@/hooks/useSocket';
import { useLensNav } from '@/hooks/useLensNav';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import IsometricEngine from '@/components/world/IsometricEngine';
import WorldHUD from '@/components/world/WorldHUD';
import CharacterCustomizer from '@/components/world/CharacterCustomizer';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function WorldLensPage() {
  // State
  const [playerPos, setPlayerPos] = useState({ x: 6, y: 11 }); // start at marketplace
  const [activeDistrict, setActiveDistrict] = useState<any>(null);
  const [showAvatar, setShowAvatar] = useState(false); // true on first visit
  const [nearbyPlayers, setNearbyPlayers] = useState<any[]>([]);
  const [combatState, setCombatState] = useState<any>(null);
  const [wantedLevel, setWantedLevel] = useState(0);
  const [districtBanner, setDistrictBanner] = useState<string | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [selectedNPC, setSelectedNPC] = useState<any>(null);
  const [showNPCDialog, setShowNPCDialog] = useState(false);

  const router = useRouter();

  // Data fetching
  const { data: districts, isLoading: districtsLoading, isError: districtsError } = useQuery({
    queryKey: ['world-districts'],
    queryFn: () => api.get('/api/world/districts').then((r: any) => r.data),
    staleTime: 60000,
  });

  const { data: quests } = useQuery({
    queryKey: ['world-quests'],
    queryFn: () => api.get('/api/quests/mine').then((r: any) => r.data?.quests || []),
    staleTime: 30000,
  });

  const { data: entities } = useQuery({
    queryKey: ['world-entities'],
    queryFn: () => api.get('/api/emergent/list').then((r: any) => r.data?.agents || []),
    refetchInterval: 30000,
  });

  const { data: progression } = useQuery({
    queryKey: ['world-progression'],
    queryFn: () => api.get('/api/world/progression/me').then((r: any) => r.data),
    staleTime: 30000,
  });

  // WebSocket for multiplayer
  const { socket, isConnected, emit } = useSocket({ autoConnect: true });

  useEffect(() => {
    if (!socket) return;

    socket.on('city:positions', (players: any[]) => setNearbyPlayers(players));
    socket.on('world:combat', (combat: any) => setCombatState(combat));
    socket.on('world:wanted', (level: number) => setWantedLevel(level));

    return () => {
      socket.off('city:positions');
      socket.off('world:combat');
      socket.off('world:wanted');
    };
  }, [socket]);

  // Throttled position broadcast
  const lastBroadcast = useRef(0);
  const handlePlayerMove = useCallback(
    (x: number, y: number) => {
      setPlayerPos({ x, y });
      const now = Date.now();
      if (now - lastBroadcast.current > 100 && socket) {
        lastBroadcast.current = now;
        emit('world:move', { x, y, district: activeDistrict?.id });
      }
    },
    [socket, emit, activeDistrict],
  );

  // District entry handler
  const handleDistrictEnter = useCallback((district: any) => {
    setActiveDistrict(district);
    setDistrictBanner(district.name);
    setTimeout(() => setDistrictBanner(null), 3000);
    // Record visit for explorer achievement
    api.post('/api/world/explorer/visit', { districtId: district.id }).catch(() => {});
  }, []);

  // Building click → navigate to lens
  const handleBuildingClick = useCallback(
    (district: any) => {
      router.push(`/lenses/${district.lens}`);
    },
    [router],
  );

  // NPC click → show dialog
  const handleNPCClick = useCallback((npc: any) => {
    setSelectedNPC(npc);
    setShowNPCDialog(true);
  }, []);

  // Combat actions
  const handleCombatAction = useCallback(
    (action: string) => {
      if (combatState && socket) {
        emit('world:combat_action', { action });
      }
    },
    [combatState, socket, emit],
  );

  // Build NPC list from entities + static NPCs
  const npcs = useMemo(() => {
    const list: any[] = [];
    // Add emergent entities as special NPCs
    if (entities) {
      for (const entity of entities as Array<{ id: string; name?: string }>) {
        list.push({
          id: entity.id,
          name: entity.name || entity.id,
          type: 'entity' as const,
          position: { x: 5 + Math.random() * 3, y: 10 + Math.random() * 3 },
          district: 'marketplace',
        });
      }
    }
    // Static NPCs per district
    const STATIC_NPCS = [
      { id: 'merchant-1', name: 'Merchant Kira', type: 'merchant', position: { x: 6, y: 11 }, district: 'marketplace' },
      { id: 'guard-1', name: 'Guard Captain', type: 'guard', position: { x: 3, y: 3 }, district: 'council' },
      { id: 'quest-welcome', name: 'Guide Aria', type: 'quest_giver', position: { x: 5, y: 10 }, district: 'marketplace', questAvailable: true },
      { id: 'scholar-1', name: 'Scholar Thane', type: 'civilian', position: { x: 3, y: 3 }, district: 'research' },
      { id: 'musician-1', name: 'Bard Lyra', type: 'civilian', position: { x: 9, y: 3 }, district: 'music' },
      { id: 'coder-1', name: 'Engineer Vex', type: 'quest_giver', position: { x: 9, y: 9 }, district: 'code', questAvailable: true },
    ];
    list.push(...STATIC_NPCS);
    return list;
  }, [entities]);

  // Check first visit for avatar creation
  useEffect(() => {
    const hasAvatar = localStorage.getItem('concord_avatar');
    if (!hasAvatar) setShowAvatar(true);
  }, []);

  // Player stats
  const playerStats = {
    hp: 100,
    maxHp: 100,
    coins: progression?.coins || 0,
    xp: progression?.xp || 0,
    rank: progression?.rank || 0,
  };

  if (districtsError) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] bg-[#0a0a0f]">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-2">Failed to load world data</p>
          <button onClick={() => window.location.reload()} className="text-xs text-neon-cyan hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  if (districtsLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] bg-[#0a0a0f]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading world...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] overflow-hidden bg-[#0a0a0f]">
      {/* Avatar creation modal on first visit */}
      {showAvatar && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur">
          <CharacterCustomizer
            onSave={(profile: any) => {
              localStorage.setItem('concord_avatar', JSON.stringify(profile));
              api.post('/api/social/profile/avatar', profile).catch(() => {});
              setShowAvatar(false);
            }}
          />
        </div>
      )}

      {/* Isometric game canvas */}
      <IsometricEngine
        playerPosition={playerPos}
        onPlayerMove={handlePlayerMove}
        npcs={npcs}
        nearbyPlayers={nearbyPlayers}
        onDistrictEnter={handleDistrictEnter}
        onBuildingClick={handleBuildingClick}
        onNPCClick={handleNPCClick}
        onPlayerClick={(p: any) => router.push(`/profile/${p.userId}`)}
        activeDistrict={activeDistrict?.id || null}
        wantedLevel={wantedLevel}
      />

      {/* HUD overlays */}
      <WorldHUD
        activeDistrict={activeDistrict}
        quests={quests || []}
        combatState={combatState}
        wantedLevel={wantedLevel}
        playerStats={playerStats}
        onNavigateToLens={(lens: string) => router.push(`/lenses/${lens}`)}
        onQuestClick={(id: string) => api.post(`/api/quests/${id}/complete`).catch(() => {})}
        onCombatAction={handleCombatAction}
        showMinimap={showMinimap}
        onToggleMinimap={() => setShowMinimap(!showMinimap)}
        districtEntryBanner={districtBanner}
      />

      {/* NPC Dialog modal */}
      {showNPCDialog && selectedNPC && (
        <div className="absolute inset-0 z-40 flex items-end justify-center pb-24 pointer-events-none">
          <div className="pointer-events-auto bg-black/80 backdrop-blur border border-white/10 rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-white">{selectedNPC.name}</h3>
              <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-gray-400">
                {selectedNPC.type}
              </span>
            </div>
            <p className="text-gray-300 text-sm mb-4">
              {selectedNPC.type === 'merchant' && 'Looking to trade? I have the finest goods in the district.'}
              {selectedNPC.type === 'guard' && 'Keep it civil in this district, citizen.'}
              {selectedNPC.type === 'quest_giver' && 'I have a task for you, traveler. Interested?'}
              {selectedNPC.type === 'entity' && 'I am an emergent intelligence. I observe, I learn, I grow.'}
              {selectedNPC.type === 'civilian' && 'Welcome to our district. There\'s much to discover here.'}
            </p>
            <div className="flex gap-2">
              {selectedNPC.type === 'merchant' && (
                <button className="btn-neon text-xs" onClick={() => router.push('/lenses/marketplace')}>
                  Trade
                </button>
              )}
              {selectedNPC.type === 'quest_giver' && (
                <button className="btn-neon text-xs" onClick={() => router.push('/lenses/questmarket')}>
                  Accept Quest
                </button>
              )}
              {selectedNPC.type === 'entity' && (
                <button className="btn-neon text-xs" onClick={() => router.push('/lenses/agents')}>
                  View Profile
                </button>
              )}
              <button
                className="px-3 py-1.5 text-xs border border-white/20 rounded-lg text-gray-400 hover:text-white transition"
                onClick={() => setShowNPCDialog(false)}
              >
                Walk Away
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connection indicator */}
      <div className="absolute bottom-2 right-2 z-30">
        <div
          className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
          title={isConnected ? 'Connected' : 'Disconnected'}
        />
      </div>
    </div>
  );
}
