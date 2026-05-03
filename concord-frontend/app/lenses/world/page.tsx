'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useSocket } from '@/hooks/useSocket';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

import DistrictViewport from '@/components/world-lens/DistrictViewport';
import CreationToolbar from '@/components/world-lens/CreationToolbar';
import InspectorPanel from '@/components/world-lens/InspectorPanel';
import StatusBar from '@/components/world-lens/StatusBar';
import GuidedCreator from '@/components/world-lens/GuidedCreator';
import ComponentCreator from '@/components/world-lens/ComponentCreator';
import RawDTUEditor from '@/components/world-lens/RawDTUEditor';
import MarketplacePalette from '@/components/world-lens/MarketplacePalette';
import ConcordiaHub from '@/components/world-lens/ConcordiaHub';
import OnboardingTutorial from '@/components/world-lens/OnboardingTutorial';

import dynamic from 'next/dynamic';
import { DEMO_DISTRICT } from '@/lib/world-lens/district-seed';
import {
  DeformationStore,
  replayDeformations,
  applyDeformationRecord,
  type DeformationRecord,
  type WeatherPhysicsModifiers,
} from '@/lib/world-lens/world-deformation';
import {
  encodeDelta,
  ReconciliationBuffer,
  type CharState,
  type ServerStateMsg,
} from '@/lib/concordia/netcode';

const ConcordiaScene = dynamic(() => import('@/components/world-lens/ConcordiaScene'), {
  ssr: false,
});
const AvatarSystem3D = dynamic(() => import('@/components/world-lens/AvatarSystem3D'), {
  ssr: false,
});
const CameraControls = dynamic(() => import('@/components/world-lens/CameraControls'), {
  ssr: false,
});
const HUDOverlay = dynamic(() => import('@/components/world-lens/HUDOverlay'), { ssr: false });
const ChatSystem = dynamic(() => import('@/components/world-lens/ChatSystem'), { ssr: false });
const InventoryPanel = dynamic(() => import('@/components/world-lens/InventoryPanel'), {
  ssr: false,
});
const QuestPanel = dynamic(() => import('@/components/world-lens/QuestPanel'), { ssr: false });
const QuestTracker = dynamic(
  () => import('@/components/world/QuestTracker').then((m) => ({ default: m.QuestTracker })),
  { ssr: false }
);
const ImpactFeedback = dynamic(
  () => import('@/components/world/ImpactFeedback').then((m) => ({ default: m.ImpactFeedback })),
  { ssr: false }
);
const DistrictActivityFeed = dynamic(
  () =>
    import('@/components/world/DistrictActivityFeed').then((m) => ({
      default: m.DistrictActivityFeed,
    })),
  { ssr: false }
);
const EmoteWheelLegacy = dynamic(
  () => import('@/components/world/EmoteWheel').then((m) => ({ default: m.EmoteWheel })),
  { ssr: false }
);
const PlayerPresence = dynamic(() => import('@/components/world-lens/PlayerPresence'), {
  ssr: false,
});
const CombatSystem = dynamic(() => import('@/components/world-lens/CombatSystem'), { ssr: false });
const MapNavigation = dynamic(() => import('@/components/world-lens/MapNavigation'), {
  ssr: false,
});
const PlayerProfile = dynamic(() => import('@/components/world-lens/PlayerProfile'), {
  ssr: false,
});
const _CraftingPanel = dynamic(() => import('@/components/world-lens/CraftingPanel'), {
  ssr: false,
});
const CollaborationTools = dynamic(() => import('@/components/world-lens/CollaborationTools'), {
  ssr: false,
});
const LiveCollaboration = dynamic(() => import('@/components/world-lens/LiveCollaboration'), {
  ssr: false,
});
const EventsGatherings = dynamic(() => import('@/components/world-lens/EventsGatherings'), {
  ssr: false,
});
const SocialProofFeed = dynamic(() => import('@/components/world-lens/SocialProofFeed'), {
  ssr: false,
});
const NotificationFeed = dynamic(() => import('@/components/world-lens/NotificationFeed'), {
  ssr: false,
});
const SmartNotifications = dynamic(() => import('@/components/world-lens/SmartNotifications'), {
  ssr: false,
});
const ModerationPanel = dynamic(() => import('@/components/world-lens/ModerationPanel'), {
  ssr: false,
});
const OwnershipProfile = dynamic(() => import('@/components/world-lens/OwnershipProfile'), {
  ssr: false,
});
const FederationPanel = dynamic(() => import('@/components/world-lens/FederationPanel'), {
  ssr: false,
});
const VoiceInterface = dynamic(() => import('@/components/world-lens/VoiceInterface'), {
  ssr: false,
});
const VoiceAssistant = dynamic(() => import('@/components/world-lens/VoiceAssistant'), {
  ssr: false,
});
const BuildingRenderer3D = dynamic(() => import('@/components/world-lens/BuildingRenderer3D'), {
  ssr: false,
});
const TerrainRenderer = dynamic(() => import('@/components/world-lens/TerrainRenderer'), {
  ssr: false,
});
const SkyWeatherRenderer = dynamic(() => import('@/components/world-lens/SkyWeatherRenderer'), {
  ssr: false,
});
const WaterRenderer = dynamic(() => import('@/components/world-lens/WaterRenderer'), {
  ssr: false,
});
const ParticleEffectsComponent = dynamic(() => import('@/components/world-lens/ParticleEffects'), {
  ssr: false,
});
const SoundscapeEngine = dynamic(() => import('@/components/world-lens/SoundscapeEngine'), {
  ssr: false,
});
const AnimationManager = dynamic(() => import('@/components/world-lens/AnimationManager'), {
  ssr: false,
});
const GameJuice = dynamic(() => import('@/components/world-lens/GameJuice'), { ssr: false });
const PerformanceOverlay = dynamic(
  () => import('@/components/world-lens/PerformanceOverlay'),
  { ssr: false },
);
const BazaarLayer = dynamic(
  () => import('@/components/world-lens/BazaarLayer'),
  { ssr: false },
);
const DiegeticSurfaces = dynamic(
  () => import('@/components/world-lens/DiegeticSurfaces'),
  { ssr: false },
);
const CraftingPanelV2 = dynamic(
  () => import('@/components/world-lens/CraftingPanelV2'),
  { ssr: false },
);
const CoopPanel = dynamic(
  () => import('@/components/world-lens/CoopPanel'),
  { ssr: false },
);
const CurrencyHUD = dynamic(
  () => import('@/components/world-lens/CurrencyHUD'),
  { ssr: false },
);
const PostTutorialHints = dynamic(
  () => import('@/components/world-lens/PostTutorialHints'),
  { ssr: false },
);
const LevelUpJuiceBridge = dynamic(
  () => import('@/components/world-lens/LevelUpJuiceBridge').then((m) => ({ default: m.LevelUpJuiceBridge })),
  { ssr: false },
);
const SocialOverlay = dynamic(
  () => import('@/components/world-lens/SocialOverlay').then((m) => ({ default: m.SocialOverlay })),
  { ssr: false },
);
const LoadingTransitions = dynamic(() => import('@/components/world-lens/LoadingTransitions'), {
  ssr: false,
});

// ── Builder / Tools (District mode) ───────────────────────────────
const SnapBuildCatalog = dynamic(() => import('@/components/world-lens/SnapBuildCatalog'), {
  ssr: false,
});
const ConcordDSLEditor = dynamic(() => import('@/components/world-lens/ConcordDSLEditor'), {
  ssr: false,
});
const ConcordTerminal = dynamic(() => import('@/components/world-lens/ConcordTerminal'), {
  ssr: false,
});
const DTUDiffViewer = dynamic(() => import('@/components/world-lens/DTUDiffViewer'), {
  ssr: false,
});
const StandardsLibrary = dynamic(() => import('@/components/world-lens/StandardsLibrary'), {
  ssr: false,
});
const FabricationExportPanel = dynamic(
  () => import('@/components/world-lens/FabricationExportPanel'),
  { ssr: false }
);
const ExportEmbed = dynamic(() => import('@/components/world-lens/ExportEmbed'), { ssr: false });
const NotebookEditor = dynamic(() => import('@/components/world-lens/NotebookEditor'), {
  ssr: false,
});
const DependencyGraphViewer = dynamic(
  () => import('@/components/world-lens/DependencyGraphViewer'),
  { ssr: false }
);
const DigitalTwinDashboard = dynamic(() => import('@/components/world-lens/DigitalTwinDashboard'), {
  ssr: false,
});
const SensorDashboard = dynamic(() => import('@/components/world-lens/SensorDashboard'), {
  ssr: false,
});
const ServiceMarketplace = dynamic(() => import('@/components/world-lens/ServiceMarketplace'), {
  ssr: false,
});
const CertificatePanel = dynamic(() => import('@/components/world-lens/CertificatePanel'), {
  ssr: false,
});
const NotarizationPanel = dynamic(() => import('@/components/world-lens/NotarizationPanel'), {
  ssr: false,
});
const StressTestPanel = dynamic(() => import('@/components/world-lens/StressTestPanel'), {
  ssr: false,
});
const ReplayForensics = dynamic(() => import('@/components/world-lens/ReplayForensics'), {
  ssr: false,
});
const ReplaySpectator = dynamic(() => import('@/components/world-lens/ReplaySpectator'), {
  ssr: false,
});

// ── Concordia Input Mode Overlays ──────────────────────────────────────
const CombatHUD = dynamic(
  () => import('@/components/concordia/hud/CombatHUD').then((m) => ({ default: m.CombatHUD })),
  { ssr: false }
);
const VehicleHUD = dynamic(
  () => import('@/components/concordia/hud/VehicleHUD').then((m) => ({ default: m.VehicleHUD })),
  { ssr: false }
);
const DialoguePanel = dynamic(
  () =>
    import('@/components/concordia/dialogue/DialoguePanel').then((m) => ({
      default: m.DialoguePanel,
    })),
  { ssr: false }
);
const CreationWorkshop = dynamic(
  () =>
    import('@/components/concordia/creation/CreationWorkshop').then((m) => ({
      default: m.CreationWorkshop,
    })),
  { ssr: false }
);
const LensWorkspace = dynamic(
  () =>
    import('@/components/concordia/lens/LensWorkspaceInWorld').then((m) => ({
      default: m.LensWorkspaceInWorld,
    })),
  { ssr: false }
);
const EmoteWheel = dynamic(
  () => import('@/components/concordia/social/EmoteWheel').then((m) => ({ default: m.EmoteWheel })),
  { ssr: false }
);
const QuickMessageBar = dynamic(
  () =>
    import('@/components/concordia/social/QuickMessageBar').then((m) => ({
      default: m.QuickMessageBar,
    })),
  { ssr: false }
);
const SpectatorControls = dynamic(
  () =>
    import('@/components/concordia/spectator/SpectatorControls').then((m) => ({
      default: m.SpectatorControls,
    })),
  { ssr: false }
);
const MobileControls = dynamic(
  () =>
    import('@/components/concordia/mobile/MobileControlsOverlay').then((m) => ({
      default: m.MobileControlsOverlay,
    })),
  { ssr: false }
);
const TutorialOverlay = dynamic(
  () =>
    import('@/components/concordia/onboarding/TutorialHint').then((m) => ({
      default: m.TutorialOverlay,
    })),
  { ssr: false }
);
const SkillsPanel = dynamic(
  () =>
    import('@/components/concordia/skills/SkillsPanel').then((m) => ({ default: m.SkillsPanel })),
  { ssr: false }
);
const XPToast = dynamic(
  () => import('@/components/concordia/hud/XPToast').then((m) => ({ default: m.XPToast })),
  { ssr: false }
);
const NemesisAlert = dynamic(
  () =>
    import('@/components/concordia/hud/NemesisAlert').then((m) => ({ default: m.NemesisAlert })),
  { ssr: false }
);
const LegendaryAnnouncement = dynamic(
  () =>
    import('@/components/concordia/world/LegendaryAnnouncement').then((m) => ({
      default: m.LegendaryAnnouncement,
    })),
  { ssr: false }
);
const HybridReveal = dynamic(
  () =>
    import('@/components/concordia/skills/HybridReveal').then((m) => ({ default: m.HybridReveal })),
  { ssr: false }
);
const CrisisBanner = dynamic(
  () =>
    import('@/components/concordia/world/CrisisBanner').then((m) => ({ default: m.CrisisBanner })),
  { ssr: false }
);
const GameModeHUD = dynamic(
  () =>
    import('@/components/concordia/game-modes/GameModeHUD').then((m) => ({
      default: m.GameModeHUD,
    })),
  { ssr: false }
);
const GameModePicker = dynamic(
  () =>
    import('@/components/concordia/game-modes/GameModePicker').then((m) => ({
      default: m.GameModePicker,
    })),
  { ssr: false }
);
const QuestLog = dynamic(
  () => import('@/components/concordia/quests/QuestLog').then((m) => ({ default: m.QuestLog })),
  { ssr: false }
);
// QuestNotification and GatheringMinigame are imported for future activation via gathering/quest state.
// They are loaded but not yet wired to in-game events; see render site below.
const _QuestNotification = dynamic(
  () =>
    import('@/components/concordia/quests/QuestNotification').then((m) => ({
      default: m.QuestNotification,
    })),
  { ssr: false }
);
const _GatheringMinigame = dynamic(
  () =>
    import('@/components/concordia/crafting/GatheringMinigame').then((m) => ({
      default: m.GatheringMinigame,
    })),
  { ssr: false }
);
const DesignHUD = dynamic(
  () => import('@/components/world/DesignHUD').then((m) => ({ default: m.DesignHUD })),
  { ssr: false }
);
const NPCDialogue = dynamic(
  () => import('@/components/world/NPCDialogue').then((m) => ({ default: m.NPCDialogue })),
  { ssr: false }
);
const BuildingInterior = dynamic(
  () =>
    import('@/components/world/BuildingInterior').then((m) => ({ default: m.BuildingInterior })),
  { ssr: false }
);
const CraftingBench = dynamic(
  () =>
    import('@/components/concordia/crafting/CraftingBench').then((m) => ({
      default: m.CraftingBench,
    })),
  { ssr: false }
);
const GuildPanel = dynamic(
  () => import('@/components/concordia/social/GuildPanel').then((m) => ({ default: m.GuildPanel })),
  { ssr: false }
);
const SeasonPassPanel = dynamic(
  () =>
    import('@/components/concordia/world/SeasonPassPanel').then((m) => ({
      default: m.SeasonPassPanel,
    })),
  { ssr: false }
);
const SeasonBanner = dynamic(
  () =>
    import('@/components/concordia/world/SeasonBanner').then((m) => ({ default: m.SeasonBanner })),
  { ssr: false }
);
const LeaderboardPanel = dynamic(
  () =>
    import('@/components/concordia/world/LeaderboardPanel').then((m) => ({
      default: m.LeaderboardPanel,
    })),
  { ssr: false }
);
const WorldEventsPanel = dynamic(
  () =>
    import('@/components/concordia/world/WorldEventsPanel').then((m) => ({
      default: m.WorldEventsPanel,
    })),
  { ssr: false }
);
const ArenaPanel = dynamic(
  () => import('@/components/concordia/world/ArenaPanel').then((m) => ({ default: m.ArenaPanel })),
  { ssr: false }
);
const JobsBoardPanel = dynamic(
  () =>
    import('@/components/concordia/world/JobsBoardPanel').then((m) => ({
      default: m.JobsBoardPanel,
    })),
  { ssr: false }
);
const LorePanel = dynamic(
  () => import('@/components/concordia/world/LorePanel').then((m) => ({ default: m.LorePanel })),
  { ssr: false }
);

import { LensPortalMarker } from '@/components/concordia/world/LensPortalMarker';
import { modeManager, startLensTimeTick, stopLensTimeTick } from '@/lib/concordia/mode-manager';
import { MODE_TO_HUD } from '@/lib/concordia/modes';
import type { InputMode } from '@/lib/concordia/modes';
import { DEFAULT_SPECIAL } from '@/lib/concordia/player-stats';
import { useCombatState } from '@/hooks/useCombatState';
import { useVehicleState } from '@/hooks/useVehicleState';
import { useDialogue } from '@/hooks/useDialogue';
import type { HUDMode } from '@/components/world-lens/HUDOverlay';

import { SEED_MATERIALS } from '@/lib/world-lens/material-seed';
import { cacheMaterials } from '@/lib/world-lens/validation-engine';
import type {
  District,
  CreationMode,
  PlacedBuildingDTU,
  InfrastructureDTU,
  TerrainCell,
  Citation,
  BuildingDTU,
  MaterialDTU,
  ValidationReport,
} from '@/lib/world-lens/types';
import type { ConcordiaDistrict } from '@/components/world-lens/ConcordiaHub';

import {
  Globe,
  ChevronDown,
  Layers,
  Map as MapIcon,
  Zap,
  X,
  Radio,
  Eye,
  Play,
  Square,
  Users,
  Clock,
  Coins,
  HeartHandshake,
  CalendarDays,
  Bell,
  Mic,
  MessageSquare,
  ThumbsUp,
  BellRing,
  Shield,
  Fingerprint,
  Network,
  AudioLines,
  Wrench,
  Package,
  Code2,
  Terminal,
  Diff,
  BookOpen,
  BoxSelect,
  FileCode,
  GitBranch,
  Activity,
  Gauge,
  ShoppingCart,
  Award,
  Stamp,
  FlaskConical,
  History,
  Clapperboard,
  ChevronRight,
  Swords,
  Cpu,
  Gamepad2,
  Trophy,
  Briefcase,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
// Wave 1 deferral 5: reads the player's stored quality preset (set via /lenses/settings)
import { getStoredQualityPreset } from '@/lib/world-lens/quality-preset';
import { emitHitNumber, emitScreenShake, emitHitStop } from '@/components/world/ImpactFeedback';
import type { LimbState, LimbArmorState } from '@/components/concordia/hud/CombatHUD';

// ── City Streaming Types ───────────────────────────────────────

interface CityStream {
  id: string;
  creatorId: string;
  cityId: string;
  title: string;
  startedAt: string;
  viewerCount: number;
  dtusCreated: number;
  salesMade: number;
  ccEarned: number;
  status: 'live' | 'ended';
}

interface StreamEvent {
  id: string;
  type: 'dtu-created' | 'sale' | 'viewer-joined' | 'viewer-left';
  message: string;
  timestamp: string;
}

// ── City Streaming Section ─────────────────────────────────────

function CityStreamingSection() {
  const { on, off, isConnected } = useSocket({ autoConnect: true });

  // Creator controls
  const [myStream, setMyStream] = useState<CityStream | null>(null);
  const [streamTitle, setStreamTitle] = useState('');
  const [streamCityId, setStreamCityId] = useState('concordia-central');
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);

  // Viewer state
  const [activeStreams, setActiveStreams] = useState<CityStream[]>([]);
  const [watchingStreamId, setWatchingStreamId] = useState<string | null>(null);
  const [activityFeed, setActivityFeed] = useState<StreamEvent[]>([]);
  const [isLoadingStreams, setIsLoadingStreams] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);

  const eventCounter = useRef(0);

  // Fetch active streams
  const fetchStreams = useCallback(async () => {
    setIsLoadingStreams(true);
    try {
      const { data } = await api.get('/api/city/streams');
      const streams = Array.isArray(data) ? data : (data?.streams ?? []);
      setActiveStreams(streams);
    } catch {
      // Silently handle — streams may not be available
    } finally {
      setIsLoadingStreams(false);
    }
  }, []);

  useEffect(() => {
    fetchStreams();
    const interval = setInterval(fetchStreams, 15000);
    return () => clearInterval(interval);
  }, [fetchStreams]);

  // Socket listeners for live events
  useEffect(() => {
    const handleDtuCreated = (data: unknown) => {
      const d = data as Record<string, unknown>;
      setActivityFeed((prev) => [
        ...prev.slice(-49),
        {
          id: `evt-${++eventCounter.current}`,
          type: 'dtu-created' as const,
          message: `DTU created: ${d.title || d.dtuId || 'untitled'}`,
          timestamp: new Date().toISOString(),
        },
      ]);
      // Update stream stats
      setActiveStreams((prev) =>
        prev.map((s) => (s.id === d.streamId ? { ...s, dtusCreated: (s.dtusCreated || 0) + 1 } : s))
      );
    };

    const handleSale = (data: unknown) => {
      const d = data as Record<string, unknown>;
      setActivityFeed((prev) => [
        ...prev.slice(-49),
        {
          id: `evt-${++eventCounter.current}`,
          type: 'sale' as const,
          message: `Sale: ${d.amount || 0} CC`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setActiveStreams((prev) =>
        prev.map((s) =>
          s.id === d.streamId
            ? {
                ...s,
                salesMade: (s.salesMade || 0) + 1,
                ccEarned: (s.ccEarned || 0) + Number(d.amount || 0),
              }
            : s
        )
      );
    };

    const handleStreamStarted = (data: unknown) => {
      const d = data as CityStream;
      setActiveStreams((prev) => {
        if (prev.some((s) => s.id === d.id)) return prev;
        return [...prev, d];
      });
    };

    const handleStreamEnded = (data: unknown) => {
      const d = data as Record<string, unknown>;
      setActiveStreams((prev) => prev.filter((s) => s.id !== d.streamId && s.id !== d.id));
      if (watchingStreamId === (d.streamId ?? d.id)) {
        setWatchingStreamId(null);
      }
    };

    on('city:stream-dtu-created', handleDtuCreated);
    on('city:stream-sale', handleSale);
    on('city:stream-started', handleStreamStarted);
    on('city:stream-ended', handleStreamEnded);

    return () => {
      off('city:stream-dtu-created', handleDtuCreated);
      off('city:stream-sale', handleSale);
      off('city:stream-started', handleStreamStarted);
      off('city:stream-ended', handleStreamEnded);
    };
  }, [on, off, watchingStreamId]);

  // Auto-scroll activity feed
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activityFeed.length]);

  // Creator: start stream
  const handleStartStream = async () => {
    if (!streamTitle.trim()) return;
    setIsStarting(true);
    try {
      const { data } = await api.post('/api/city/stream/start', {
        cityId: streamCityId,
        title: streamTitle.trim(),
      });
      setMyStream(data?.stream ?? data);
      setStreamTitle('');
      fetchStreams();
    } catch (err) {
      console.error('Failed to start stream:', err);
    } finally {
      setIsStarting(false);
    }
  };

  // Creator: end stream
  const handleEndStream = async () => {
    setIsEnding(true);
    try {
      await api.post('/api/city/stream/end', {});
      setMyStream(null);
      fetchStreams();
    } catch (err) {
      console.error('Failed to end stream:', err);
    } finally {
      setIsEnding(false);
    }
  };

  // Viewer: follow/unfollow stream
  const handleToggleWatch = async (streamId: string) => {
    const isWatching = watchingStreamId === streamId;
    try {
      await api.post('/api/macros/run', {
        domain: 'city',
        name: isWatching ? 'unfollowStream' : 'followStream',
        input: { streamId },
      });
      setWatchingStreamId(isWatching ? null : streamId);
      if (!isWatching) {
        setActivityFeed([]);
      }
    } catch (err) {
      console.error('Failed to toggle stream watch:', err);
    }
  };

  const watchedStream = activeStreams.find((s) => s.id === watchingStreamId);

  // Duration helper
  const formatDuration = (startedAt: string) => {
    const ms = Date.now() - new Date(startedAt).getTime();
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Connection status */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <div
          className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}
        />
        {isConnected ? 'Live connection' : 'Connecting...'}
      </div>

      {/* ── Creator Controls ──────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-3"
      >
        <h3 className="text-sm font-semibold text-cyan-300 flex items-center gap-2">
          <Radio className="w-4 h-4" />
          Stream Controls
        </h3>

        {myStream ? (
          <div className="space-y-3">
            {/* Active stream status */}
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-medium text-red-400">LIVE</span>
              <span className="text-xs text-gray-400 ml-auto">
                {formatDuration(myStream.startedAt)}
              </span>
            </div>
            <div className="text-sm text-white font-medium">{myStream.title}</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-xs text-gray-400 flex items-center justify-center gap-1">
                  <Eye className="w-3 h-3" /> Viewers
                </div>
                <div className="text-sm font-bold text-white">{myStream.viewerCount}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-xs text-gray-400">DTUs</div>
                <div className="text-sm font-bold text-cyan-300">{myStream.dtusCreated}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-xs text-gray-400 flex items-center justify-center gap-1">
                  <Coins className="w-3 h-3" /> Earned
                </div>
                <div className="text-sm font-bold text-green-400">{myStream.ccEarned} CC</div>
              </div>
            </div>
            <button
              onClick={handleEndStream}
              disabled={isEnding}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
            >
              {isEnding ? (
                <div className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Square className="w-3 h-3" />
              )}
              End Stream
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={streamTitle}
              onChange={(e) => setStreamTitle(e.target.value)}
              placeholder="Stream title..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
            />
            <select
              value={streamCityId}
              onChange={(e) => setStreamCityId(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            >
              <option value="concordia-central">Concordia Central</option>
              <option value="neon-district">Neon District</option>
              <option value="maker-mile">Maker Mile</option>
              <option value="data-harbor">Data Harbor</option>
            </select>
            <button
              onClick={handleStartStream}
              disabled={isStarting || !streamTitle.trim()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50 transition-colors"
            >
              {isStarting ? (
                <div className="w-3 h-3 border border-cyan-300 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              Go Live
            </button>
          </div>
        )}
      </motion.div>

      {/* ── Active Streams ────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-cyan-300 flex items-center gap-2">
            <Eye className="w-4 h-4" />
            Active Streams
          </h3>
          <button
            onClick={fetchStreams}
            disabled={isLoadingStreams}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <Radio className={`w-3.5 h-3.5 ${isLoadingStreams ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {activeStreams.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-xs">No active streams right now</div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {activeStreams.map((stream) => (
                <motion.div
                  key={stream.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={`bg-white/5 rounded-lg p-3 border transition-colors ${
                    watchingStreamId === stream.id
                      ? 'border-cyan-500/50 bg-cyan-500/5'
                      : 'border-white/5 hover:border-white/15'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-xs text-gray-400 truncate">{stream.creatorId}</span>
                      </div>
                      <div className="text-sm text-white font-medium truncate mt-0.5">
                        {stream.title}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                        <span className="flex items-center gap-0.5">
                          <Globe className="w-2.5 h-2.5" /> {stream.cityId}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Users className="w-2.5 h-2.5" /> {stream.viewerCount}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" /> {formatDuration(stream.startedAt)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleToggleWatch(stream.id)}
                      className={`shrink-0 px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                        watchingStreamId === stream.id
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                          : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30'
                      }`}
                    >
                      {watchingStreamId === stream.id ? 'Leave' : 'Watch'}
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      {/* ── Live Stream View (when watching) ──────────────── */}
      <AnimatePresence>
        {watchedStream && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white/[0.03] border border-cyan-500/20 rounded-xl p-4 space-y-3 overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-cyan-300 flex items-center gap-2">
                <Radio className="w-4 h-4 text-red-400 animate-pulse" />
                {watchedStream.title}
              </h3>
              <div className="flex items-center gap-2 text-[10px] text-gray-400">
                <span className="flex items-center gap-0.5">
                  <Eye className="w-3 h-3" /> {watchedStream.viewerCount}
                </span>
                <span>{formatDuration(watchedStream.startedAt)}</span>
              </div>
            </div>

            {/* Real-time activity feed */}
            <div className="bg-black/30 rounded-lg border border-white/5 max-h-48 overflow-y-auto p-2 space-y-1">
              {activityFeed.length === 0 ? (
                <div className="text-center py-4 text-gray-600 text-[10px]">
                  Waiting for stream activity...
                </div>
              ) : (
                activityFeed.map((evt) => (
                  <motion.div
                    key={evt.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2 text-[11px] py-0.5"
                  >
                    <span
                      className={`w-1 h-1 rounded-full shrink-0 ${
                        evt.type === 'sale' ? 'bg-green-400' : 'bg-cyan-400'
                      }`}
                    />
                    <span className={evt.type === 'sale' ? 'text-green-400' : 'text-gray-300'}>
                      {evt.message}
                    </span>
                    <span className="text-gray-600 ml-auto text-[9px]">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                  </motion.div>
                ))
              )}
              <div ref={feedEndRef} />
            </div>

            {/* Stream stats bar */}
            <div className="flex items-center gap-4 text-[10px]">
              <span className="text-gray-400">
                DTUs: <span className="text-cyan-300 font-medium">{watchedStream.dtusCreated}</span>
              </span>
              <span className="text-gray-400">
                Sales: <span className="text-green-400 font-medium">{watchedStream.salesMade}</span>
              </span>
              <span className="text-gray-400">
                Earned:{' '}
                <span className="text-green-400 font-medium">{watchedStream.ccEarned} CC</span>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── View Modes ──────────────────────────────────────────────────────

type ViewMode = 'concordia' | 'district' | 'streams' | 'explore';

type DistrictTool =
  | 'snapbuild'
  | 'dsl'
  | 'terminal'
  | 'diff'
  | 'standards'
  | 'fabrication'
  | 'embed'
  | 'notebook'
  | 'depgraph'
  | 'digitaltwin'
  | 'sensors'
  | 'marketplace'
  | 'certificates'
  | 'notarization'
  | 'stresstest'
  | 'replay'
  | 'spectator'
  | null;

const DISTRICT_TOOLS: {
  key: Exclude<DistrictTool, null>;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
}[] = [
  // Build
  { key: 'snapbuild', label: 'Snap Build', icon: Package, group: 'Build' },
  { key: 'dsl', label: 'DSL Editor', icon: Code2, group: 'Build' },
  { key: 'terminal', label: 'Terminal', icon: Terminal, group: 'Build' },
  { key: 'notebook', label: 'Notebook', icon: FileCode, group: 'Build' },
  // Inspect
  { key: 'diff', label: 'DTU Diff', icon: Diff, group: 'Inspect' },
  { key: 'standards', label: 'Standards', icon: BookOpen, group: 'Inspect' },
  { key: 'depgraph', label: 'Dependencies', icon: GitBranch, group: 'Inspect' },
  { key: 'digitaltwin', label: 'Digital Twin', icon: Activity, group: 'Inspect' },
  { key: 'sensors', label: 'Sensors', icon: Gauge, group: 'Inspect' },
  // Export & Services
  { key: 'fabrication', label: 'Fabrication', icon: BoxSelect, group: 'Export' },
  { key: 'embed', label: 'Embed Export', icon: Code2, group: 'Export' },
  { key: 'marketplace', label: 'Marketplace', icon: ShoppingCart, group: 'Export' },
  // Verify
  { key: 'certificates', label: 'Certificates', icon: Award, group: 'Verify' },
  { key: 'notarization', label: 'Notarization', icon: Stamp, group: 'Verify' },
  { key: 'stresstest', label: 'Stress Test', icon: FlaskConical, group: 'Verify' },
  // Replay
  { key: 'replay', label: 'Replay', icon: History, group: 'Replay' },
  { key: 'spectator', label: 'Spectator', icon: Clapperboard, group: 'Replay' },
];

// ── Component ───────────────────────────────────────────────────────

export default function WorldLensPage() {
  useLensNav('world');

  const router = useRouter();
  const { isLive, lastUpdated } = useRealtimeLens('world');
  // World-lens socket for player movement + nearby-player broadcasts.
  // The CityStreamingSection component already uses its own useSocket
  // for stream events — this instance is dedicated to multiplayer.
  const worldSocket = useSocket({ autoConnect: true });

  // ── Concordia input mode ──────────────────────────────────────
  const [inputMode, setInputMode] = useState<InputMode>(() => modeManager.mode);
  useEffect(() => {
    return modeManager.subscribe((next) => setInputMode(next));
  }, []);

  // Start/stop the 5-minute lens time tick whenever the player enters lens_work mode.
  useEffect(() => {
    if (inputMode === 'lens_work' && worldSocket.isConnected) {
      startLensTimeTick('world', (event, data) => worldSocket.emit(event, data));
    } else {
      stopLensTimeTick();
    }
    return () => stopLensTimeTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode, worldSocket.isConnected]);

  // Mode-specific state hooks (always called — conditionally rendered)
  const combatCtx = useCombatState(DEFAULT_SPECIAL);
  const vehicleCtx = useVehicleState();
  const dialogueCtx = useDialogue(DEFAULT_SPECIAL);

  // ── State ─────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('concordia');
  const [activeDistrict, setActiveDistrict] = useState<District>(DEMO_DISTRICT);
  const [creationMode, setCreationMode] = useState<CreationMode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState<0 | 1 | 2 | 3>(0);

  // District tools state
  const [activeTool, setActiveTool] = useState<DistrictTool>(null);
  const [toolsExpanded, setToolsExpanded] = useState(false);

  // 3D Explore mode state
  const [cameraMode, setCameraMode] = useState<
    'isometric' | 'follow' | 'first-person' | 'free' | 'interior' | 'cinematic'
  >('follow');
  const [concordiaTheme, setConcordiaTheme] = useState<'neon-punk' | 'classic' | 'minimal'>(
    'neon-punk'
  );
  const [concordiaRenderStyle, setConcordiaRenderStyle] = useState<'pbr' | 'toon'>('pbr');
  const [showPanel, setShowPanel] = useState<
    | 'none'
    | 'inventory'
    | 'quests'
    | 'questlog'
    | 'chat'
    | 'map'
    | 'crafting'
    | 'players'
    | 'profile'
    | 'collaboration'
    | 'livecollab'
    | 'events'
    | 'socialproof'
    | 'notifications'
    | 'smartnotify'
    | 'moderation'
    | 'ownership'
    | 'federation'
    | 'voice'
    | 'voiceassist'
    | 'combat'
    | 'skills'
    | 'modes'
    | 'guild'
    | 'season'
    | 'npcshop'
    | 'leaderboard'
    | 'worldevents'
    | 'arena'
    | 'jobs'
    | 'lore'
    | 'character'
  >('none');
  // Local player avatar — mutable so moves update it in place. On
  // first mount we ask the server for saved state (via player:load)
  // and land back wherever the user logged off.
  type PlayerAnimationClip =
    | 'idle'
    | 'walk'
    | 'run'
    | 'sit'
    | 'build'
    | 'inspect'
    | 'wave'
    | 'clap'
    | 'point'
    | 'celebrate'
    | 'craft';
  const [playerAvatar, setPlayerAvatar] = useState<{
    id: string;
    name: string;
    appearance: {
      skinColor: string;
      hairColor: string;
      hairStyle: 'short';
      bodyType: 'average';
      clothing: {
        top: { color: string; type: 'shirt' };
        bottom: { color: string; type: 'pants' };
      };
    };
    position: { x: number; y: number; z: number };
    rotation: number;
    currentAnimation: PlayerAnimationClip;
  }>({
    id: 'player-1',
    name: 'You',
    appearance: {
      skinColor: '#c8956c',
      hairColor: '#3d2314',
      hairStyle: 'short',
      bodyType: 'average',
      clothing: {
        top: { color: '#1a5276', type: 'shirt' },
        bottom: { color: '#2c3e50', type: 'pants' },
      },
    },
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    currentAnimation: 'idle',
  });
  // Lens portal buildings loaded from server
  const [portals, setPortals] = useState<
    Array<{
      id: string;
      lens_id: string;
      label: string;
      x: number;
      y: number;
      accessible: boolean;
      required_skill_level: number;
      npc_name?: string;
      npc_title?: string;
    }>
  >([]);
  // When a portal is entered, overrides the LensWorkspace lensId
  const [activeLensOverride, setActiveLensOverride] = useState<string | null>(null);
  // Portal within E-press range
  const [nearPortalId, setNearPortalId] = useState<string | null>(null);

  // Other players in the same chunk(s), updated via city:positions
  // socket broadcasts. The `currentAnimation` is typed to match the
  // AnimationClip union that AvatarSystem3D accepts; remote player
  // actions that aren't in that set get coerced to 'idle' at the
  // mapping site below.
  const [otherPlayers, setOtherPlayers] = useState<
    Array<{
      id: string;
      name: string;
      appearance: typeof playerAvatar.appearance;
      position: { x: number; y: number; z: number };
      rotation: number;
      currentAnimation:
        | 'idle'
        | 'walk'
        | 'run'
        | 'sit'
        | 'build'
        | 'inspect'
        | 'wave'
        | 'clap'
        | 'point'
        | 'celebrate'
        | 'craft';
      timestamp: number;
    }>
  >([]);

  // ── Combat state ────────────────────────────────────────────────
  // Source of truth for combat HUD. Mirrors what the server sends
  // back on combat:attack:ack / combat:hit / player:respawn:ack so
  // damage numbers, health bars, and the death overlay all render
  // from server-authoritative state. The `target` field doubles as
  // the PvP click-target — clicking a player in PlayerPresence sets
  // it and combat:attack sends to that id.
  type CombatTargetInfo = {
    id: string;
    name: string;
    health: number;
    maxHealth: number;
    level: number;
    type: 'enemy' | 'player';
    position?: { x: number; y: number; z: number };
  };
  const [combatState, setCombatState] = useState<{
    health: number;
    maxHealth: number;
    stamina: number;
    maxStamina: number;
    armor: number;
    weapon: { name: string; damage: number; speed: number; type: string } | null;
    target: CombatTargetInfo | null;
    coverBonus: number;
    isDead: boolean;
    damageNumbers: Array<{ id: string; amount: number; isCrit: boolean; timestamp: number }>;
    combatLog: Array<{
      id: string;
      message: string;
      type: 'damage-dealt' | 'damage-taken' | 'block' | 'heal' | 'death' | 'info';
      timestamp: string;
    }>;
    damageFlash: boolean;
  }>({
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    armor: 10,
    weapon: { name: 'Fists', damage: 8, speed: 1.5, type: 'melee' },
    target: null,
    coverBonus: 0,
    isDead: false,
    damageNumbers: [],
    combatLog: [],
    damageFlash: false,
  });
  const combatLogIdRef = useRef(0);
  const dmgNumIdRef = useRef(0);

  // ── Combat feel: combo counter, stagger, limb damage ─────────────────────
  const [comboCount, setComboCount] = useState(0);
  const [staggered, setStaggered] = useState(false);
  const [limbState, setLimbState] = useState<LimbState>({
    head: 100,
    torso: 100,
    left_arm: 100,
    right_arm: 100,
    left_leg: 100,
    right_leg: 100,
  });
  const [limbArmorState, setLimbArmorState] = useState<LimbArmorState>({
    head: 100,
    torso: 100,
    left_arm: 100,
    right_arm: 100,
    left_leg: 100,
    right_leg: 100,
  });
  const comboTargetRef = useRef<string | null>(null);
  const comboTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── AAA systems: deformation store, combat music, delta compression, weather modifiers
  const deformStoreRef = useRef(new DeformationStore());
  const deformLookupRef = useRef<
    ((id: string) => { visible: boolean; userData: Record<string, unknown> } | undefined) | null
  >(null);
  const combatMusicRef = useRef<{
    onCombatEvent: (intensity: number) => void;
    update: (delta: number, inCombat: boolean) => void;
    dispose: () => void;
  } | null>(null);
  const prevCharStateRef = useRef<CharState | null>(null);
  const inputSeqRef = useRef(0);
  const reconRef = useRef<ReconciliationBuffer | null>(null);
  // Lazily initialise on first move so the physics sim closure is cheap
  function getRecon(): ReconciliationBuffer {
    if (!reconRef.current) {
      reconRef.current = new ReconciliationBuffer((state, input) => {
        // Minimal KCC sim: apply velocity from input flags, same constants as AvatarSystem3D
        const WALK = 5.0;
        const RUN = 12.0;
        const spd = input.sprint ? RUN : WALK;
        return {
          ...state,
          seq: input.seq,
          position: {
            x: state.position.x + input.strafe * spd * input.delta,
            y: state.position.y,
            z: state.position.z + input.forward * spd * input.delta,
          },
        };
      });
    }
    return reconRef.current;
  }
  const [weatherData, setWeatherData] = useState<{ type: string; intensity: number } | null>(null);
  const [weatherModifiers, setWeatherModifiers] = useState<WeatherPhysicsModifiers | null>(null);
  // Live mirror so socket handlers can read the current target / stamina
  // without stale closures. Updated below via useEffect.
  const combatStateRef = useRef<typeof combatState>({
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    armor: 10,
    weapon: { name: 'Fists', damage: 8, speed: 1.5, type: 'melee' },
    target: null,
    coverBonus: 0,
    isDead: false,
    damageNumbers: [],
    combatLog: [],
    damageFlash: false,
  });
  const pushCombatLog = useCallback(
    (
      message: string,
      type: 'damage-dealt' | 'damage-taken' | 'block' | 'heal' | 'death' | 'info'
    ) => {
      combatLogIdRef.current++;
      const now = new Date();
      const ts = `${now.getMinutes()}:${String(now.getSeconds()).padStart(2, '0')}`;
      setCombatState((prev) => ({
        ...prev,
        combatLog: [
          { id: `cl-${combatLogIdRef.current}`, message, type, timestamp: ts },
          ...prev.combatLog,
        ].slice(0, 40),
      }));
    },
    []
  );

  const [visibleLayers, setVisibleLayers] = useState(
    new Set(['water', 'power', 'drainage', 'road', 'data'])
  );
  const [showValidation, setShowValidation] = useState(false);
  const [showWeather, setShowWeather] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !localStorage.getItem('world_lens_visited');
  });
  const [showFeatures, setShowFeatures] = useState(false);

  // Live NPC state — populated from API, refreshed every 10s
  const [worldNPCs, setWorldNPCs] = useState<
    import('@/components/world-lens/AvatarSystem3D').NPCData[]
  >([]);

  // Raw NPC data (full API response) for dialogue and behavioral visual cues
  const [rawWorldNPCs, setRawWorldNPCs] = useState<
    Array<{
      id: string;
      name: string;
      archetype: string;
      faction?: string;
      isConscious?: boolean;
      griefLevel?: number;
      criminalRep?: number;
      isWanted?: boolean;
      jobType?: string;
      currentHp?: number;
      maxHp?: number;
      position: { x: number; y: number; z?: number };
    }>
  >([]);

  // NPC dialogue overlay
  const [dialogueNPC, setDialogueNPC] = useState<{
    id: string;
    name: string;
    archetype: string;
    faction?: string;
    isConscious?: boolean;
    griefLevel?: number;
    criminalRep?: number;
    isWanted?: boolean;
    jobType?: string;
    currentHp?: number;
    maxHp?: number;
  } | null>(null);

  // Emote wheel toggle
  const [showEmoteWheel, setShowEmoteWheel] = useState(false);

  // World quests — loaded from server for QuestLog panel
  const [worldQuests, setWorldQuests] = useState<
    Array<{
      id: string;
      title: string;
      description: string;
      status: string;
      giver_npc_id?: string;
    }>
  >([]);

  // Nearest NPC within interaction range (≤3 units)
  const [nearbyNPC, setNearbyNPC] = useState<(typeof rawWorldNPCs)[number] | null>(null);

  // Building interior overlay
  const [interiorBuilding, setInteriorBuilding] = useState<{ id: string; name: string } | null>(
    null
  );

  // Selection state
  const [selectedBuilding, setSelectedBuilding] = useState<PlacedBuildingDTU | null>(null);
  const [selectedInfra, setSelectedInfra] = useState<InfrastructureDTU | null>(null);
  const [selectedTerrain, setSelectedTerrain] = useState<TerrainCell | null>(null);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);

  // Materials
  const [materials] = useState<MaterialDTU[]>(SEED_MATERIALS);

  // Cache materials for validation engine
  useEffect(() => {
    cacheMaterials(materials);
  }, [materials]);

  // Fetch lens portal buildings for this world
  useEffect(() => {
    fetch('/api/lens-portals?worldId=concordia-hub')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.portals) setPortals(d.portals);
      })
      .catch(() => {});
  }, []);

  // ── Loot bags ─────────────────────────────────────────────────────────────
  const [lootBags, setLootBags] = useState<
    { id: string; itemCount: number; killerPriority: boolean; expiresAt: number }[]
  >([]);
  const [claimingBag, setClaimingBag] = useState<string | null>(null);
  const [lootNotification, setLootNotification] = useState<string | null>(null);

  useEffect(() => {
    const loadBags = () => {
      fetch(`/api/worlds/${activeDistrict.id}/loot-bags`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.bags) setLootBags(d.bags);
        })
        .catch(() => {});
    };
    loadBags();
    const interval = setInterval(loadBags, 8_000);
    return () => clearInterval(interval);
  }, [activeDistrict.id]);

  const claimLootBag = useCallback(
    async (bagId: string) => {
      setClaimingBag(bagId);
      try {
        const res = await fetch(`/api/worlds/${activeDistrict.id}/loot-bags/${bagId}/claim`, {
          method: 'POST',
        });
        const data = await res.json();
        if (data.ok) {
          setLootBags((prev) => prev.filter((b) => b.id !== bagId));
          setLootNotification(`Claimed ${data.count} item${data.count !== 1 ? 's' : ''}!`);
          setTimeout(() => setLootNotification(null), 3000);
        }
      } catch {
        /* non-fatal */
      } finally {
        setClaimingBag(null);
      }
    },
    [activeDistrict.id]
  );

  // ── Resource nodes + gathering ────────────────────────────────────────────
  type ResourceNode = {
    id: string;
    node_type: string;
    resource_id: string;
    resource_name: string;
    x: number;
    y: number;
    z: number;
    depth: number;
    quantity_remaining: number;
    max_quantity: number;
    quality: string;
    difficulty: number;
    biome: string;
    is_depleted: number;
  };
  const [_resourceNodes, setResourceNodes] = useState<ResourceNode[]>([]);
  const [nearbyNodes, setNearbyNodes] = useState<ResourceNode[]>([]);
  const [gatheringNode, setGatheringNode] = useState<string | null>(null);
  const [gatherResult, setGatherResult] = useState<string | null>(null);
  const [isSwimming, _setIsSwimming] = useState(false);
  const [worldBuildings, setWorldBuildings] = useState<
    {
      id: string;
      building_type: string;
      name: string;
      x: number;
      y: number;
      z: number;
      width: number;
      depth: number;
      height: number;
      material: string;
      is_seed: number;
    }[]
  >([]);
  const playerPos = useRef({ x: 1000, z: 1000 }); // updated on movement

  // Load all surface nodes for map dots (once per world)
  useEffect(() => {
    fetch(`/api/worlds/${activeDistrict.id}/nodes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.nodes) setResourceNodes(d.nodes);
      })
      .catch(() => {});
  }, [activeDistrict.id]);

  // Load buildings (seed city + player-placed)
  useEffect(() => {
    fetch(`/api/worlds/${activeDistrict.id}/buildings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.buildings) setWorldBuildings(d.buildings);
      })
      .catch(() => {});
  }, [activeDistrict.id]);

  // Sync active district to SoundscapeEngine ambient audio via window event
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('concordia:soundscape-command', {
        detail: { action: 'setDistrict', district: activeDistrict.id },
      })
    );
  }, [activeDistrict.id]);

  // Poll for nearby nodes every 5s based on player position
  useEffect(() => {
    const poll = () => {
      const { x, z } = playerPos.current;
      fetch(`/api/worlds/${activeDistrict.id}/nodes?x=${x}&z=${z}&radius=15`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.nodes) setNearbyNodes(d.nodes);
        })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, [activeDistrict.id]);

  const gatherFromNode = async (nodeId: string) => {
    setGatheringNode(nodeId);
    try {
      const node = nearbyNodes.find((n) => n.id === nodeId);
      const res = await fetch(`/api/worlds/${activeDistrict.id}/nodes/${nodeId}/gather`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolType:
            node?.node_type === 'tree'
              ? 'axe'
              : ['ore_vein', 'stone', 'crystal', 'fuel'].includes(node?.node_type ?? '')
                ? 'pickaxe'
                : 'hands',
          toolTier: 1,
          skillLevel: 10,
          x: playerPos.current.x,
          z: playerPos.current.z,
        }),
      });
      const data = await res.json();
      if (data.ok && data.gathered?.length) {
        const summary = data.gathered
          .map((g: { quantity: number; name: string }) => `${g.quantity}× ${g.name}`)
          .join(', ');
        setGatherResult(`Gathered: ${summary}`);
        setTimeout(() => setGatherResult(null), 3500);
        // If this gather triggered a level-up, show upgrade prompt
        const cl = data.skillProgress?.characterLevelResult;
        if (cl?.pendingUpgrades > 0) {
          setUpgradePrompt({
            characterLevel: cl.characterLevel,
            pendingUpgrades: cl.pendingUpgrades,
          });
        }
        // Refresh nearby nodes to show depleted state
        setNearbyNodes((prev) =>
          prev.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  quantity_remaining: data.node?.quantityRemaining ?? 0,
                  is_depleted: data.node?.isDepleted ? 1 : 0,
                }
              : n
          )
        );
      }
    } catch {
      /* non-fatal */
    } finally {
      setGatheringNode(null);
    }
  };

  // Load NPCs from API and keep positions fresh every 10s
  useEffect(() => {
    const loadNPCs = () => {
      fetch(`/api/worlds/${activeDistrict.id}/npcs`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d?.npcs) return;
          // Store both avatar-mapped and raw NPC data
          setWorldNPCs(d.npcs.map(_mapNPCToAvatarData));
          setRawWorldNPCs(
            d.npcs.map((n: Record<string, unknown>) => ({
              id: n.id as string,
              name: (n.name as string) ?? 'Unknown',
              archetype: (n.archetype as string) ?? 'guard',
              faction: n.faction as string | undefined,
              isConscious: n.isConscious as boolean | undefined,
              griefLevel: n.griefLevel as number | undefined,
              criminalRep: n.criminalRep as number | undefined,
              isWanted: n.isWanted as boolean | undefined,
              jobType: n.jobType as string | undefined,
              currentHp: n.currentHp as number | undefined,
              maxHp: n.maxHp as number | undefined,
              position: { x: (n.x as number) ?? 0, y: (n.y as number) ?? 0 },
            }))
          );
        })
        .catch(() => {});
    };
    loadNPCs();
    const interval = setInterval(loadNPCs, 10_000);
    return () => clearInterval(interval);
  }, [activeDistrict.id]);

  // Proximity check: update nearPortalId and nearbyNPC whenever the player moves
  useEffect(() => {
    const near = portals.find(
      (p) => Math.hypot(p.x - playerAvatar.position.x, p.y - playerAvatar.position.y) < 3
    );
    setNearPortalId(near?.id ?? null);
  }, [playerAvatar.position, portals]);

  // NPC proximity: track nearest NPC within 3 units + dispatch tutorial action
  const _prevNearNPCIdRef = useRef<string | null>(null);
  useEffect(() => {
    const pos = playerAvatar.position;
    const nearest = rawWorldNPCs.reduce<(typeof rawWorldNPCs)[number] | null>((best, npc) => {
      const d = Math.hypot(npc.position.x - pos.x, npc.position.y - pos.y);
      if (d > 3) return best;
      const bd = best ? Math.hypot(best.position.x - pos.x, best.position.y - pos.y) : Infinity;
      return d < bd ? npc : best;
    }, null);
    setNearbyNPC(nearest);
    // Dispatch tutorial action only once per NPC approach
    if (nearest && nearest.id !== _prevNearNPCIdRef.current) {
      _prevNearNPCIdRef.current = nearest.id;
      window.dispatchEvent(
        new CustomEvent('concordia:tutorial-action', {
          detail: { action: 'near-npc' },
        })
      );
    } else if (!nearest) {
      _prevNearNPCIdRef.current = null;
    }
  }, [playerAvatar.position, rawWorldNPCs]);

  // E key: portal entry OR nearest NPC dialogue (portal takes priority)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'e' && e.key !== 'E') return;
      // Portal first
      const nearPortal = portals.find(
        (p) => Math.hypot(p.x - playerAvatar.position.x, p.y - playerAvatar.position.y) < 3
      );
      if (nearPortal?.accessible) {
        setActiveLensOverride(nearPortal.lens_id);
        modeManager.switchTo('lens_work', { push: true });
        window.dispatchEvent(
          new CustomEvent('concordia:tutorial-action', {
            detail: { action: 'entered-lens-portal' },
          })
        );
        return;
      }
      // Nearest NPC dialogue — defer to a global event so the openNPCDialogue
      // callback (declared later) doesn't need to be in this effect's
      // dependency closure.
      if (nearbyNPC && !dialogueNPC) {
        try {
          window.dispatchEvent(new CustomEvent('concordia:open-dialogue', {
            detail: { npcId: nearbyNPC.id, npcName: nearbyNPC.name, occupation: nearbyNPC.archetype ?? null },
          }));
        } catch { /* dispatch best-effort */ }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [portals, playerAvatar.position, nearbyNPC, dialogueNPC]);

  // G key: toggle emote wheel in explore mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'g' && e.key !== 'G') return;
      if (inputMode !== 'exploration' && inputMode !== 'social') return;
      setShowEmoteWheel((v) => !v);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [inputMode]);

  // World quests — fetch for QuestLog panel, refresh every 45s
  useEffect(() => {
    const load = () => {
      fetch(`/api/worlds/${activeDistrict.id}/quests?limit=30`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.quests) setWorldQuests(d.quests);
        })
        .catch(() => {});
    };
    load();
    const iv = setInterval(load, 45_000);
    return () => clearInterval(iv);
  }, [activeDistrict.id]);

  // ── MMO multiplayer wiring ──────────────────────────────────────────
  // On mount: ask the server for our last-saved position, subscribe
  // to city:positions broadcasts (100ms tick) that populate other
  // players in the same chunk, and to player:load:ack + player:move:ack
  // for rehydration + low-latency nearby updates.
  useEffect(() => {
    if (!worldSocket.isConnected) return;

    // Request saved state on first connect
    worldSocket.emit('player:load');

    // Seed starter world event if district has none (fire-and-forget)
    fetch(`/api/worlds/${activeDistrict.id}/events?status=active&limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.events?.length) {
          // No active events — create a starter gathering event
          fetch(`/api/worlds/${activeDistrict.id}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'meetup',
              name: 'Community Gathering',
              description:
                'Citizens are gathering at the town square. Come explore and meet others.',
              maxParticipants: 50,
              duration: 3600,
            }),
          }).catch(() => {});
        }
      })
      .catch(() => {});

    const handleLoadAck = (msg: unknown) => {
      const data = msg as {
        ok: boolean;
        state?: {
          x: number;
          y: number;
          z: number;
          rotation?: number;
          currentAnimation?: string;
        } | null;
        deformations?: DeformationRecord[];
      };
      if (data?.ok && data.state) {
        setPlayerAvatar((prev) => ({
          ...prev,
          position: { x: data.state!.x, y: data.state!.y, z: data.state!.z },
          rotation: data.state!.rotation ?? 0,
          currentAnimation:
            (data.state!.currentAnimation as typeof prev.currentAnimation) ?? 'idle',
        }));
      }
      if (data?.deformations?.length) {
        deformStoreRef.current.hydrate(data.deformations);
        if (deformLookupRef.current) {
          replayDeformations(deformStoreRef.current, deformLookupRef.current);
        }
      }
    };

    // Convert city:positions broadcast chunks into a flat otherPlayers
    // array. The broadcast is per-chunk so multiple events may arrive
    // in a single tick — we dedupe by user id and prefer the most
    // recent entry per user.
    const handleCityPositions = (msg: unknown) => {
      const data = msg as {
        cityId: string;
        users: Array<{
          userId: string;
          x: number;
          y: number;
          z: number;
          direction?: number;
          rotation?: number;
          action?: string;
          avatar?: unknown;
          displayName?: string;
        }>;
      };
      if (!data?.users?.length) return;
      setOtherPlayers((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        for (const u of data.users) {
          if (u.userId === playerAvatar.id) continue;
          byId.set(u.userId, {
            id: u.userId,
            name: u.displayName || u.userId.slice(0, 12),
            // Reuse the local player's appearance config shape — the
            // server doesn't send an avatar yet so we render a default
            // silhouette until the profile lookup is wired.
            appearance: playerAvatar.appearance,
            position: { x: u.x, y: u.y, z: u.z },
            rotation: u.rotation ?? u.direction ?? 0,
            // Coerce remote player action string into the AnimationClip
            // union AvatarSystem3D accepts. Unknown actions fall
            // through to 'idle' rather than typechecking as a broader
            // union that the renderer can't handle.
            currentAnimation: (() => {
              const a = String(u.action || '').toLowerCase();
              const validClips = new Set([
                'idle',
                'walk',
                'run',
                'sit',
                'build',
                'inspect',
                'wave',
                'clap',
                'point',
                'celebrate',
                'craft',
              ]);
              return (validClips.has(a) ? a : 'idle') as
                | 'idle'
                | 'walk'
                | 'run'
                | 'sit'
                | 'build'
                | 'inspect'
                | 'wave'
                | 'clap'
                | 'point'
                | 'celebrate'
                | 'craft';
            })(),
            timestamp: Date.now(),
          });
        }
        // Drop stale entries (>5s without update) so ghosts don't linger
        const cutoff = Date.now() - 5000;
        const fresh = Array.from(byId.values()).filter((p) => p.timestamp >= cutoff);
        return fresh;
      });
    };

    const handleMoveAck = (msg: unknown) => {
      const data = msg as {
        nearby?: Array<{
          userId: string;
          x: number;
          y: number;
          z: number;
          direction?: number;
          action?: string;
          displayName?: string;
        }>;
      };
      if (!data?.nearby?.length) return;
      // Short-circuit: if the ack includes nearby players we apply
      // them immediately without waiting for the next broadcast tick.
      handleCityPositions({
        cityId: activeDistrict.id,
        users: data.nearby.map((n) => ({ ...n, rotation: n.direction })),
      });
    };

    // ── Anti-cheat / move-rejection reconciliation ─────────────────
    // The server validates every player:move and rejects speed-hacks,
    // teleports, and rate-floods. When that happens it sends back the
    // server's authoritative state (seq + position). We first try to
    // re-simulate from that state using unacknowledged inputs via
    // ReconciliationBuffer.reconcile(). If the error is too large
    // (> SNAP_THRESHOLD) or no recon buffer exists, fall back to a
    // hard snap so the client can't silently drift out of sync.
    const handleMoveNack = (msg: unknown) => {
      const data = msg as {
        reason?: string;
        prev?: { x: number; y: number; z: number };
        seq?: number;
      };
      if (!data?.prev) return;

      const serverMsg: ServerStateMsg = {
        seq: data.seq ?? 0,
        tick: 0,
        state: {
          seq: data.seq ?? 0,
          position: { x: data.prev.x, y: data.prev.y, z: data.prev.z },
          velocity: { x: 0, y: 0, z: 0 },
          onGround: true,
          health: combatStateRef.current.health,
          stamina: combatStateRef.current.stamina,
        },
      };

      // Attempt smooth reconciliation
      let reconPos = serverMsg.state.position;
      if (reconRef.current) {
        const reconState = reconRef.current.reconcile(serverMsg);
        const err = Math.hypot(
          reconState.position.x - (prevCharStateRef.current?.position.x ?? reconState.position.x),
          reconState.position.z - (prevCharStateRef.current?.position.z ?? reconState.position.z)
        );
        if (err < ReconciliationBuffer.SNAP_THRESHOLD) {
          reconPos = reconState.position;
          prevCharStateRef.current = reconState;
        } else {
          // Large error — hard snap and clear history
          reconRef.current.clearHistory();
          prevCharStateRef.current = serverMsg.state;
        }
      } else {
        prevCharStateRef.current = serverMsg.state;
      }

      setPlayerAvatar((prev) => ({
        ...prev,
        position: { x: reconPos.x, y: reconPos.y, z: reconPos.z },
      }));
      if (data.reason === 'speed_hack_detected' || data.reason === 'teleport_detected') {
        pushCombatLog(`Movement rejected: ${data.reason.replace(/_/g, ' ')}`, 'info');
      }
    };

    // ── Combat ack: our attack landed (or didn't) ──────────────────
    const handleCombatAck = (msg: unknown) => {
      const data = msg as {
        ok: boolean;
        error?: string;
        damage?: number;
        isCrit?: boolean;
        element?: string;
        targetHealth?: number;
        targetMaxHealth?: number;
        targetKilled?: boolean;
        attackerStamina?: number;
      };
      if (!data?.ok) {
        if (data?.error === 'out_of_range') pushCombatLog('Target out of range.', 'info');
        else if (data?.error === 'insufficient_stamina')
          pushCombatLog('Too tired to attack.', 'info');
        else if (data?.error === 'different_city')
          pushCombatLog('Target is in another city.', 'info');
        else if (data?.error === 'target_not_found') pushCombatLog('Target lost.', 'info');
        else if (data?.error)
          pushCombatLog(`Attack failed: ${data.error.replace(/_/g, ' ')}`, 'info');
        return;
      }
      dmgNumIdRef.current++;
      setCombatState((prev) => ({
        ...prev,
        stamina: typeof data.attackerStamina === 'number' ? data.attackerStamina : prev.stamina,
        target: prev.target
          ? {
              ...prev.target,
              health:
                typeof data.targetHealth === 'number' ? data.targetHealth : prev.target.health,
              maxHealth:
                typeof data.targetMaxHealth === 'number'
                  ? data.targetMaxHealth
                  : prev.target.maxHealth,
            }
          : prev.target,
        damageNumbers: [
          ...prev.damageNumbers,
          {
            id: `dmg-${dmgNumIdRef.current}`,
            amount: data.damage ?? 0,
            isCrit: !!data.isCrit,
            timestamp: Date.now(),
          },
        ].slice(-12),
      }));
      const targetName = data.targetKilled
        ? (combatStateRef.current.target?.name ?? 'target')
        : (combatStateRef.current.target?.name ?? 'target');
      pushCombatLog(
        `You hit ${targetName} for ${data.damage} damage${data.isCrit ? ' (crit)' : ''}.`,
        'damage-dealt'
      );
      combatMusicRef.current?.onCombatEvent(1.0);

      // Physics impact feedback — hit-stop + floating numbers + screen shake + audio
      if (typeof data.damage === 'number' && data.damage > 0) {
        const element =
          (data.element as 'fire' | 'ice' | 'lightning' | 'poison' | 'physical') ?? 'physical';
        emitHitNumber(data.damage, element, !!data.isCrit);
        // Severity tiers control hit-pause + zoom strength
        const severity: 'light' | 'heavy' | 'crit' = data.isCrit
          ? 'crit'
          : data.damage > 25
            ? 'heavy'
            : 'light';
        // Type-specific shake amplitude — crits lean harder than raw damage
        const shakeAmp = data.isCrit
          ? 6
          : data.damage > 25
            ? Math.min(5, 3 + Math.floor(data.damage / 30))
            : Math.min(3, Math.ceil(data.damage / 18));
        emitScreenShake(shakeAmp);
        // Hit-stop duration scales with severity for genuine pause-on-crit feel
        const hitStopMs = data.isCrit ? 160 : data.damage > 25 ? 110 : 70;
        emitHitStop(hitStopMs, severity);
        // Phase F fix 3: pass damage magnitude + target world position so
        // GameJuice can route through spatial audio (HRTF + occlusion) and
        // scale visual feedback intensity by hit weight.
        const targetPos = combatStateRef.current.target?.position;
        window.dispatchEvent(
          new CustomEvent('concordia:game-juice', {
            detail: {
              trigger: data.isCrit ? 'combat-crit' : 'combat-hit',
              opts: {
                magnitude: data.damage,
                targetId: combatStateRef.current.target?.id,
                position: targetPos
                  ? { x: targetPos.x, y: targetPos.y, z: targetPos.z }
                  : undefined,
              },
            },
          })
        );

        // Phase 4 hit reaction: make the target NPC visibly flinch/stagger.
        // AvatarSystem3D listens for `concordia:hit-reaction` and crossfades
        // a short reaction clip onto the target's mixer.
        // Phase 6: include hit direction so heavy/crit hits actually push
        // the target backward in world space (proxied from player yaw).
        const targetIdForReaction = combatStateRef.current.target?.id;
        if (targetIdForReaction) {
          const severity: 'light' | 'heavy' | 'crit' =
            data.isCrit ? 'crit' : data.damage > 25 ? 'heavy' : 'light';
          const yaw = playerAvatar.rotation;
          const hitDirection = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
          window.dispatchEvent(
            new CustomEvent('concordia:hit-reaction', {
              detail: { targetId: targetIdForReaction, severity, hitDirection },
            })
          );
          // EvoAsset: record interaction with the targeted NPC's asset
          // (crits weighted higher — combat highlights drive more evolution
          // pressure than passive presence). Best-effort fire-and-forget.
          try {
            import('@/lib/evo-asset/loader').then((m) =>
              m.recordAssetInteraction(
                'authored',
                `npc:${targetIdForReaction}`,
                data.isCrit ? 'combat_crit' : 'combat_hit',
                data.isCrit ? 2.0 : 1.0,
              ),
            ).catch(() => { /* network silent */ });
          } catch { /* import silent */ }
        }
        // Combo counter — consecutive hits on same target within 4 seconds
        const tid = combatStateRef.current.target?.id ?? null;
        if (tid && tid === comboTargetRef.current) {
          setComboCount((c) => c + 1);
        } else {
          setComboCount(1);
          comboTargetRef.current = tid;
        }
        if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
        comboTimerRef.current = setTimeout(() => {
          setComboCount(0);
          comboTargetRef.current = null;
        }, 4000);
      }

      if (data.targetKilled) {
        pushCombatLog(`${targetName} defeated!`, 'death');
        emitScreenShake(7);
        emitHitStop(260, 'kill');
        // Phase F fix 3: spatial-position the kill SFX so it plays from where
        // the kill happened rather than as a flat 2D blast.
        const killPos = combatStateRef.current.target?.position;
        window.dispatchEvent(
          new CustomEvent('concordia:game-juice', {
            detail: {
              trigger: 'combat-kill',
              opts: {
                targetId: combatStateRef.current.target?.id,
                position: killPos
                  ? { x: killPos.x, y: killPos.y, z: killPos.z }
                  : undefined,
              },
            },
          })
        );
        // Phase 5 death collapse: visible buckle + face-plant + 6.5s
        // opacity fade. Hit direction = attacker → target horizontal vector
        // so the body falls roughly in the direction of the killing blow.
        const killedTargetId = combatStateRef.current.target?.id;
        if (killedTargetId) {
          // Use the player's facing as a proxy for the killing-blow direction
          // (target's world position isn't tracked in CombatTargetInfo).
          const yaw = playerAvatar.rotation;
          const hitDirection = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
          window.dispatchEvent(
            new CustomEvent('concordia:death-collapse', {
              detail: { targetId: killedTargetId, hitDirection },
            })
          );
        }
        setComboCount(0);
        comboTargetRef.current = null;
        // Clear the killed target; the server will despawn it.
        setCombatState((prev) => ({ ...prev, target: null }));
      }

      // Apply limb damage if server sent it
      if ((data as Record<string, unknown>).limbDamage) {
        const ld = (data as Record<string, unknown>).limbDamage as Partial<LimbState>;
        setLimbState((prev) => ({ ...prev, ...ld }));
      }
      if ((data as Record<string, unknown>).limbArmor) {
        const la = (data as Record<string, unknown>).limbArmor as Partial<LimbArmorState>;
        setLimbArmorState((prev) => ({ ...prev, ...la }));
      }
    };

    // ── Combat hit: broadcast — someone (including us) landed a hit ─
    // We only care when WE'RE the target; otherwise the nearby-effect
    // particle layer can render it but it doesn't touch our HUD.
    const handleCombatHit = (msg: unknown) => {
      const data = msg as {
        attackerId: string;
        targetId: string;
        damage: number;
        isCrit: boolean;
        targetHealth: number;
        targetMaxHealth: number;
      };
      if (!data) return;
      if (data.targetId !== playerAvatar.id) return; // not us
      setCombatState((prev) => ({
        ...prev,
        health: data.targetHealth,
        maxHealth: data.targetMaxHealth,
        damageFlash: true,
      }));
      pushCombatLog(`Took ${data.damage} damage${data.isCrit ? ' (crit)' : ''}.`, 'damage-taken');
      // Player-taken hits shake harder than dealt hits (you feel your own pain)
      const incomingShake = data.isCrit
        ? 8
        : data.damage > 25
          ? Math.min(6, 4 + Math.floor(data.damage / 25))
          : Math.min(4, Math.ceil(data.damage / 15));
      emitScreenShake(incomingShake);
      const incomingSeverity: 'light' | 'heavy' | 'crit' = data.isCrit
        ? 'crit'
        : data.damage > 25
          ? 'heavy'
          : 'light';
      emitHitStop(data.isCrit ? 150 : data.damage > 25 ? 100 : 60, incomingSeverity);
      window.dispatchEvent(
        new CustomEvent('concordia:game-juice', {
          detail: { trigger: 'combat-hit' },
        })
      );
      // Phase 4/6 hit reaction on the player avatar itself, with knockback
      // direction = away from the attacker. Server doesn't send attacker
      // position, so use the inverse of the player's facing as a proxy
      // (player tends to face the attacker during combat).
      {
        const yaw = playerAvatar.rotation;
        const hitDirection = { x: Math.sin(yaw), z: Math.cos(yaw) };
        window.dispatchEvent(
          new CustomEvent('concordia:hit-reaction', {
            detail: {
              targetId: playerAvatar.id,
              severity: data.isCrit ? 'crit' : data.damage > 25 ? 'heavy' : 'light',
              hitDirection,
            },
          })
        );
      }
      // Heavy hit (> 25 dmg) or crit triggers stagger — slows movement briefly
      if (data.isCrit || data.damage > 25) {
        setStaggered(true);
        if (staggerTimerRef.current) clearTimeout(staggerTimerRef.current);
        staggerTimerRef.current = setTimeout(() => setStaggered(false), data.isCrit ? 1200 : 700);
      }
      // Apply incoming limb damage + armor if server sent it
      if ((data as Record<string, unknown>).limbDamage) {
        const ld = (data as Record<string, unknown>).limbDamage as Partial<LimbState>;
        setLimbState((prev) => ({ ...prev, ...ld }));
      }
      if ((data as Record<string, unknown>).limbArmor) {
        const la = (data as Record<string, unknown>).limbArmor as Partial<LimbArmorState>;
        setLimbArmorState((prev) => ({ ...prev, ...la }));
      }
      // Clear the flash after 300ms so pulsing red overlay fades
      setTimeout(() => {
        setCombatState((prev) => ({ ...prev, damageFlash: false }));
      }, 300);
    };

    // ── Combat kill: someone died. If it's us, toggle the death overlay.
    const handleCombatKill = (msg: unknown) => {
      const data = msg as { attackerId: string; targetId: string };
      if (!data) return;
      if (data.targetId === playerAvatar.id) {
        setCombatState((prev) => ({ ...prev, isDead: true, health: 0 }));
        pushCombatLog('You have fallen. Respawn to continue.', 'death');
        window.dispatchEvent(
          new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'combat-hit', opts: { magnitude: 10 } },
          })
        );
      } else if (data.attackerId === playerAvatar.id) {
        window.dispatchEvent(
          new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'milestone' },
          })
        );
      }
    };

    // ── Respawn ack: HP/stamina restored, position snapped to hub ──
    const handleRespawnAck = (msg: unknown) => {
      const data = msg as {
        ok: boolean;
        position?: { x: number; y: number; z: number };
        health?: number;
      };
      if (!data?.ok) return;
      setCombatState((prev) => ({
        ...prev,
        health: data.health ?? prev.maxHealth,
        stamina: prev.maxStamina,
        isDead: false,
        damageFlash: false,
      }));
      if (data.position) {
        setPlayerAvatar((prev) => ({
          ...prev,
          position: { x: data.position!.x, y: data.position!.y, z: data.position!.z },
        }));
      }
      pushCombatLog('Respawned at district hub.', 'info');
    };

    // ── World notifications & mechanic actions ─────────────────────
    // When a world-mechanic fires show_notification / world:action
    // we thread it through the combat log so players see feedback
    // without needing the notifications panel open.
    const handleWorldNotification = (msg: unknown) => {
      const data = msg as { message?: string };
      if (!data?.message) return;
      pushCombatLog(data.message, 'info');
    };

    const handleWorldAction = (msg: unknown) => {
      const data = msg as {
        action: string;
        params?: Record<string, unknown>;
        userId?: string;
      };
      if (!data?.action) return;
      // Only surface actions targeted at us (or global ones).
      if (data.userId && data.userId !== playerAvatar.id) return;
      if (data.action === 'award_xp') {
        pushCombatLog(`Awarded XP: +${data.params?.amount ?? 0}`, 'info');
        window.dispatchEvent(
          new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'milestone', opts: { value: `+${data.params?.amount ?? 0} XP` } },
          })
        );
      } else if (data.action === 'give_item') {
        pushCombatLog(`Received item: ${data.params?.itemId ?? 'unknown'}`, 'info');
      } else if (data.action === 'teleport_player' && data.params) {
        const p = data.params as { x?: number; y?: number; z?: number };
        setPlayerAvatar((prev) => ({
          ...prev,
          position: { x: Number(p.x ?? 0), y: Number(p.y ?? 0), z: Number(p.z ?? 0) },
        }));
        pushCombatLog('Teleported by world mechanic.', 'info');
      } else {
        pushCombatLog(`World action: ${data.action}`, 'info');
      }
    };

    const handleWeatherUpdate = (msg: unknown) => {
      const data = msg as { type?: string; intensity?: number };
      if (data?.type) {
        setWeatherData({ type: data.type, intensity: data.intensity ?? 0.5 });
      }
    };

    const handleWorldDeformation = (msg: unknown) => {
      const rec = msg as DeformationRecord;
      if (!rec?.id) return;
      deformStoreRef.current.apply(rec);
      if (deformLookupRef.current) applyDeformationRecord(rec, deformLookupRef.current);
    };

    worldSocket.on('player:load:ack', handleLoadAck);
    worldSocket.on('city:positions', handleCityPositions);
    worldSocket.on('player:move:ack', handleMoveAck);
    worldSocket.on('player:move:nack', handleMoveNack);
    const handleCombatDodgeAck = (msg: unknown) => {
      const data = msg as { userId?: string; direction?: 'left' | 'right' | 'back' };
      if (!data?.userId) return;
      const dir = data.direction === 'left' ? 'dodge-left' : data.direction === 'right' ? 'dodge-right' : 'dodge-back';
      window.dispatchEvent(new CustomEvent('concordia:combat-anim', {
        detail: { entityId: data.userId, animation: dir },
      }));
    };
    const handleCombatBlockAck = (msg: unknown) => {
      const data = msg as { userId?: string; active?: boolean };
      if (!data?.userId) return;
      window.dispatchEvent(new CustomEvent('concordia:combat-anim', {
        detail: { entityId: data.userId, animation: data.active ? 'block' : 'idle' },
      }));
    };
    worldSocket.on('combat:attack:ack', handleCombatAck);
    worldSocket.on('combat:hit', handleCombatHit);
    worldSocket.on('combat:dodge:ack', handleCombatDodgeAck);
    worldSocket.on('combat:block:ack', handleCombatBlockAck);
    worldSocket.on('combat:kill', handleCombatKill);
    worldSocket.on('player:respawn:ack', handleRespawnAck);
    worldSocket.on('world:notification', handleWorldNotification);
    worldSocket.on('world:action', handleWorldAction);
    worldSocket.on('weather:update', handleWeatherUpdate);
    worldSocket.on('world:deformation', handleWorldDeformation);

    return () => {
      worldSocket.off('player:load:ack', handleLoadAck);
      worldSocket.off('city:positions', handleCityPositions);
      worldSocket.off('player:move:ack', handleMoveAck);
      worldSocket.off('player:move:nack', handleMoveNack);
      worldSocket.off('combat:attack:ack', handleCombatAck);
      worldSocket.off('combat:hit', handleCombatHit);
      worldSocket.off('combat:dodge:ack', handleCombatDodgeAck);
      worldSocket.off('combat:block:ack', handleCombatBlockAck);
      worldSocket.off('combat:kill', handleCombatKill);
      worldSocket.off('player:respawn:ack', handleRespawnAck);
      worldSocket.off('world:notification', handleWorldNotification);
      worldSocket.off('world:action', handleWorldAction);
      worldSocket.off('weather:update', handleWeatherUpdate);
      worldSocket.off('world:deformation', handleWorldDeformation);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldSocket.isConnected, activeDistrict.id]);

  // Keep the live combat-state mirror fresh so socket handlers can
  // read the latest target / stamina / etc. without re-registering.
  useEffect(() => {
    combatStateRef.current = combatState;
  }, [combatState]);

  // Check first visit
  useEffect(() => {
    const visited = localStorage.getItem('world_lens_visited');
    if (!visited) {
      setShowOnboarding(true);
    }
  }, []);

  // Init CombatMusicSystem on first user gesture (AudioContext requires interaction)
  useEffect(() => {
    const initCombatMusic = () => {
      if (combatMusicRef.current) return;
      import('@/lib/world-lens/spatial-audio')
        .then(({ CombatMusicSystem }) => {
          const ctx = new AudioContext();
          const cms = new CombatMusicSystem(ctx);
          cms.start();
          combatMusicRef.current = cms;
        })
        .catch(() => {
          /* optional */
        });
    };
    window.addEventListener('pointerdown', initCombatMusic, { once: true });
    return () => {
      window.removeEventListener('pointerdown', initCombatMusic);
      combatMusicRef.current?.dispose();
      combatMusicRef.current = null;
    };
  }, []);

  // ── CombatMusicSystem per-frame update ────────────────────────────
  // Drives stem-gain decay / attack each frame and must be called even
  // when there is no combat event, so intensity decays back to 0.
  useEffect(() => {
    let rafId: number;
    let lastT = performance.now();

    function musicFrame(now: number) {
      const delta = Math.min((now - lastT) / 1000, 0.1); // cap at 100 ms
      lastT = now;
      const cms = combatMusicRef.current;
      if (cms) {
        const inCombat = !!(combatStateRef.current.target && !combatStateRef.current.isDead);
        cms.update(delta, inCombat);
      }
      rafId = requestAnimationFrame(musicFrame);
    }

    rafId = requestAnimationFrame(musicFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // DTU persistence
  const { items: _buildingItems, create: createBuilding } = useLensData('world', 'building', {
    seed: [],
    enabled: true,
  });

  const runWorldAction = useRunArtifact('world');
  const [worldActionResult, setWorldActionResult] = useState<{
    action: string;
    result: Record<string, unknown>;
  } | null>(null);
  const [worldActiveAction, setWorldActiveAction] = useState<string | null>(null);
  const [gatheringState, setGatheringState] = useState<{
    toolTier: number;
    resourceName: string;
  } | null>(null);
  const [questNotification, setQuestNotification] = useState<{
    quest: import('@/lib/concordia/quest-system').Quest;
    type: 'new' | 'completed' | 'failed';
  } | null>(null);
  const [showDesignHUD, setShowDesignHUD] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<{
    characterLevel: number;
    pendingUpgrades: number;
  } | null>(null);

  // Expose world event triggers to other components via window so any world sub-component can activate them
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__worldStartGathering = (toolTier: number, resourceName: string) =>
      setGatheringState({ toolTier, resourceName });
    w.__worldQuestEvent = (
      quest: import('@/lib/concordia/quest-system').Quest,
      type: 'new' | 'completed' | 'failed'
    ) => setQuestNotification({ quest, type });
    return () => {
      delete w.__worldStartGathering;
      delete w.__worldQuestEvent;
    };
  }, []);

  const handleWorldAction = useCallback(
    async (action: string) => {
      const id = _buildingItems[0]?.id;
      if (!id) return;
      setWorldActiveAction(action);
      try {
        const res = await runWorldAction.mutateAsync({ id, action });
        if (res.ok) setWorldActionResult({ action, result: res.result as Record<string, unknown> });
      } finally {
        setWorldActiveAction(null);
      }
    },
    [_buildingItems, runWorldAction]
  );

  // ── Handlers ──────────────────────────────────────────────────

  // ── Combat handlers ───────────────────────────────────────────
  // Open NPC dialogue — conscious NPCs get the full LLM-backed useDialogue flow;
  // others open the simpler NPCDialogue overlay.
  const openNPCDialogue = useCallback(
    (npc: (typeof rawWorldNPCs)[number]) => {
      if (npc.isConscious) {
        // Route through narrative bridge → enriched LLM dialogue
        dialogueCtx.startDialogue(
          npc.id,
          npc.name,
          {
            archetype: npc.archetype ?? 'guard',
            faction: npc.faction ?? '',
            speechStyle: 'formal',
            traits: [],
          },
          50,
          []
        );
        modeManager.switchTo('conversation', { push: true });
        window.dispatchEvent(
          new CustomEvent('concordia:tutorial-action', {
            detail: { action: 'completed-dialogue' },
          })
        );
      } else {
        setDialogueNPC(npc);
      }
    },
    [dialogueCtx]
  );

  // Right-click gather: ConcordiaScene dispatches concordia:gather-request
  // with a world position. POST to /api/world/gather and surface a toast
  // with the yielded resource + visual feedback (avatar swing animation +
  // particle burst at the gather point + floating yield text).
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { x: number; y: number; z: number } | undefined;
      if (!detail) return;

      // Immediate visual feedback before the network round-trip.
      window.dispatchEvent(new CustomEvent('concordia:combat-anim', {
        detail: { entityId: playerAvatar.id, animation: 'attack-light' },
      }));
      window.dispatchEvent(new CustomEvent('concordia:particle-effect', {
        detail: { type: 'dust', position: detail, count: 16 },
      }));

      const biome = activeDistrict.id?.includes('frontier') ? 'frontier'
        : activeDistrict.id?.includes('exchange') ? 'grassland'
        : activeDistrict.id?.includes('docks') ? 'water'
        : activeDistrict.id?.includes('forge') ? 'rocky'
        : 'forest';
      try {
        const r = await fetch('/api/world/gather', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ x: detail.x, z: detail.z, biome }),
        });
        const data = await r.json();
        if (data?.ok) {
          pushCombatLog(`Gathered ${data.yield.quantity}× ${data.yield.name}`, 'info');
          window.dispatchEvent(new CustomEvent('concordia:tutorial-action', {
            detail: { action: 'gathered' },
          }));
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'coin-clink', opts: { value: `+${data.yield.quantity} ${data.yield.name}` } },
          }));
          // Floating yield text via the existing hit-number renderer.
          window.dispatchEvent(new CustomEvent('concordia:floating-text', {
            detail: { text: `+${data.yield.quantity} ${data.yield.name}`, position: detail, color: '#fbbf24' },
          }));
        } else if (data?.error === 'gather_cooldown') {
          // Quiet — player is mashing.
        } else {
          pushCombatLog(`Gather failed: ${data?.error ?? 'unknown'}`, 'info');
        }
      } catch { /* network silent */ }
    };
    window.addEventListener('concordia:gather-request', handler);
    return () => window.removeEventListener('concordia:gather-request', handler);
  }, [activeDistrict.id, pushCombatLog, playerAvatar.id]);

  // Phase F fix 2: ConcordiaScene's canvas raycaster dispatches
  // `concordia:open-dialogue` when the player clicks an NPC mesh. Look up
  // the full NPC from rawWorldNPCs and route into openNPCDialogue, which
  // already handles conscious vs simple NPCs.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { npcId?: string } | undefined;
      const npcId = detail?.npcId;
      if (!npcId) return;
      const npc = rawWorldNPCs.find((n) => n.id === npcId);
      if (npc) openNPCDialogue(npc);
    };
    window.addEventListener('concordia:open-dialogue', handler);
    return () => window.removeEventListener('concordia:open-dialogue', handler);
  }, [rawWorldNPCs, openNPCDialogue]);

  const handleSelectCombatTarget = useCallback(
    (p: { id: string; name: string; type: 'enemy' | 'player' }) => {
      setCombatState((prev) => ({
        ...prev,
        target: {
          id: p.id,
          name: p.name,
          type: p.type,
          health: 100,
          maxHealth: 100,
          level: 1,
        },
      }));
      setShowPanel('combat');
    },
    []
  );

  const handleAttack = useCallback(() => {
    const target = combatStateRef.current.target;
    if (!target) {
      pushCombatLog('No target selected.', 'info');
      return;
    }
    if (!worldSocket.isConnected) return;
    const heavy = (combatStateRef.current.weapon?.damage ?? 10) > 18;
    window.dispatchEvent(new CustomEvent('concordia:combat-anim', {
      detail: { entityId: playerAvatar.id, animation: heavy ? 'attack-heavy' : 'attack-light' },
    }));
    worldSocket.emit('combat:attack', {
      targetId: target.id,
      baseDamage: combatStateRef.current.weapon?.damage ?? 10,
      range: 3,
      armorPierce: 0,
    });
  }, [worldSocket, pushCombatLog, playerAvatar.id]);

  const handleBlock = useCallback(() => {
    // Block raises cover bonus briefly; reflects client-side until
    // the server-side block action is wired.
    setCombatState((prev) => ({ ...prev, coverBonus: Math.max(prev.coverBonus, 20) }));
    pushCombatLog('Blocking — damage reduced while holding.', 'block');
    window.dispatchEvent(new CustomEvent('concordia:combat-anim', {
      detail: { entityId: playerAvatar.id, animation: 'block' },
    }));
    setTimeout(() => {
      setCombatState((prev) => ({ ...prev, coverBonus: 0 }));
    }, 2000);
  }, [pushCombatLog, playerAvatar.id]);

  const handleDodge = useCallback((direction: 'left' | 'right' | 'back' = 'back') => {
    if (combatStateRef.current.stamina < 15) {
      pushCombatLog('Too tired to dodge.', 'info');
      return;
    }
    setCombatState((prev) => ({ ...prev, stamina: Math.max(0, prev.stamina - 15) }));
    const anim = direction === 'left' ? 'dodge-left' : direction === 'right' ? 'dodge-right' : 'dodge-back';
    window.dispatchEvent(new CustomEvent('concordia:combat-anim', {
      detail: { entityId: playerAvatar.id, animation: anim },
    }));
    if (worldSocket.isConnected) {
      worldSocket.emit('combat:dodge', { direction });
    }
  }, [worldSocket, pushCombatLog, playerAvatar.id]);

  const handleRespawn = useCallback(() => {
    if (!worldSocket.isConnected) return;
    worldSocket.emit('player:respawn', {
      cityId: activeDistrict.id,
      x: 0,
      y: 0,
      z: 0,
    });
  }, [worldSocket, activeDistrict.id]);

  const handleBuildingClick = useCallback((building: PlacedBuildingDTU) => {
    setSelectedBuilding(building);
    setSelectedInfra(null);
    setSelectedTerrain(null);
    // EvoAsset: record building interaction so the asset's evolution_score
    // accumulates. Drives the heartbeat scheduler to refine frequently-used
    // buildings ahead of unused ones. Best-effort — fire-and-forget.
    try {
      import('@/lib/evo-asset/loader').then((m) =>
        m.recordAssetInteraction('authored', building.dtuId, 'building_inspect', 1.0),
      ).catch(() => { /* network errors silent */ });
    } catch { /* import failure silent */ }
    // Generate mock citations for demo
    setCitations([
      {
        id: 'c1',
        citingDTU: building.dtuId,
        citedDTU: 'comp-concrete-found-v2',
        citedCreator: '@engineer_jane',
        timestamp: new Date().toISOString(),
        context: 'foundation',
      },
      {
        id: 'c2',
        citingDTU: building.dtuId,
        citedDTU: 'mat-usb-a',
        citedCreator: '@materials_lab',
        timestamp: new Date().toISOString(),
        context: 'beam material',
      },
      {
        id: 'c3',
        citingDTU: building.dtuId,
        citedDTU: 'infra-water-1',
        citedCreator: '@civil_sara',
        timestamp: new Date().toISOString(),
        context: 'water connection',
      },
    ]);
  }, []);

  const handleInfraClick = useCallback((infra: InfrastructureDTU) => {
    setSelectedInfra(infra);
    setSelectedBuilding(null);
    setSelectedTerrain(null);
    setCitations([]);
  }, []);

  const handleTerrainClick = useCallback(
    (x: number, y: number) => {
      const cell = activeDistrict.terrain.grid[y]?.[x] || null;
      setSelectedTerrain(cell);
      setSelectedBuilding(null);
      setSelectedInfra(null);
      setCitations([]);
    },
    [activeDistrict]
  );

  const handleCloseInspector = useCallback(() => {
    setSelectedBuilding(null);
    setSelectedInfra(null);
    setSelectedTerrain(null);
    setCitations([]);
    setValidationReport(null);
  }, []);

  const handleToggleLayer = useCallback((layer: string) => {
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }, []);

  const handleRotate = useCallback(() => {
    setRotation((prev) => ((prev + 1) % 4) as 0 | 1 | 2 | 3);
  }, []);

  const handlePublishBuilding = useCallback(
    (building: BuildingDTU) => {
      createBuilding({
        title: building.name,
        data: building as unknown as Record<string, unknown>,
      });
      setCreationMode(null);
      // Add to district
      setActiveDistrict((prev) => ({
        ...prev,
        buildings: [
          ...prev.buildings,
          {
            id: `placed-${building.id}`,
            dtuId: building.id,
            position: { x: 10 + Math.random() * 5, y: 10 + Math.random() * 5 },
            rotation: 0,
            validationStatus: building.validationReport?.overallPass ? 'validated' : 'experimental',
            creator: building.creator,
            placedAt: new Date().toISOString().slice(0, 10),
          },
        ],
      }));
    },
    [createBuilding]
  );

  const handlePublishComponent = useCallback(
    (component: {
      name: string;
      category: string;
      materialId: string;
      dimensions: { length: number; width: number; height: number };
      crossSection: string;
    }) => {
      createBuilding({
        title: component.name,
        data: component as unknown as Record<string, unknown>,
      });
      setCreationMode(null);
    },
    [createBuilding]
  );

  const handlePublishRawDTU = useCallback(
    (dtu: Record<string, unknown>) => {
      createBuilding({
        title: (dtu.name as string) || 'Raw DTU',
        data: dtu,
      });
      setCreationMode(null);
    },
    [createBuilding]
  );

  const handleConcordiaDistrictSelect = useCallback((_district: ConcordiaDistrict) => {
    // In future: load actual district data from server
    setViewMode('district');
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    localStorage.setItem('world_lens_visited', '1');
    setShowOnboarding(false);
  }, []);

  return (
    <div data-lens-theme="world" className="flex flex-col h-full min-h-0">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Globe className="w-6 h-6 text-cyan-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold">World Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-[10px] text-gray-500">
              Design, validate, and publish DTU-based creations in shared districts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-black/40 border border-white/10 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('concordia')}
              className={`px-3 py-1.5 text-xs ${viewMode === 'concordia' ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:text-white'}`}
            >
              <Globe className="w-3.5 h-3.5 inline mr-1" />
              Concordia
            </button>
            <button
              onClick={() => setViewMode('district')}
              className={`px-3 py-1.5 text-xs ${viewMode === 'district' ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:text-white'}`}
            >
              <MapIcon className="w-3.5 h-3.5 inline mr-1" />
              District
            </button>
            <button
              onClick={() => setViewMode('explore')}
              className={`px-3 py-1.5 text-xs ${viewMode === 'explore' ? 'bg-emerald-500/20 text-emerald-300' : 'text-gray-400 hover:text-white'}`}
            >
              <Users className="w-3.5 h-3.5 inline mr-1" />
              Explore 3D
            </button>
            <button
              onClick={() => setViewMode('streams')}
              className={`px-3 py-1.5 text-xs ${viewMode === 'streams' ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:text-white'}`}
            >
              <Radio className="w-3.5 h-3.5 inline mr-1" />
              Streams
            </button>
          </div>
          <UniversalActions domain="world" artifactId={undefined} compact />
        </div>
      </header>

      {/* Main Content */}
      {viewMode === 'concordia' ? (
        <div className="flex-1 overflow-y-auto p-4">
          <ConcordiaHub
            onDistrictSelect={handleConcordiaDistrictSelect}
            onNavigateToLens={(lens) => router.push(`/lenses/${lens}`)}
          />
        </div>
      ) : viewMode === 'explore' ? (
        /* ── 3D Explore Mode ── */
        <div className="flex-1 relative min-h-0">
          <ConcordiaScene
            districtId={activeDistrict.id}
            quality={getStoredQualityPreset()}
            theme={concordiaTheme}
            renderStyle={concordiaRenderStyle}
            cameraMode={cameraMode}
            getPlayerPose={() => ({
              x: playerAvatar.position.x,
              y: playerAvatar.position.y,
              z: playerAvatar.position.z,
              yaw: playerAvatar.rotation,
            })}
            onBuildingClick={(id) => {
              const b = activeDistrict.buildings.find((b) => b.id === id);
              if (b) setSelectedBuilding(b);
            }}
            onTerrainClick={() => {}}
            onWeatherModifiers={(mods) => setWeatherModifiers(mods)}
            onSceneReady={(lookup) => {
              deformLookupRef.current = lookup;
              replayDeformations(deformStoreRef.current, lookup);
            }}
            width="100%"
            height="100%"
          />
          {/* Theme picker — 3 swatches + PBR/Toon toggle top-right */}
          <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-xl px-2 py-1.5 pointer-events-auto">
            {[
              { id: 'neon-punk' as const, swatch: '#6366f1', label: 'Neon Punk' },
              { id: 'classic' as const, swatch: '#e8c97a', label: 'Classic' },
              { id: 'minimal' as const, swatch: '#94a3b8', label: 'Minimal' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setConcordiaTheme(t.id)}
                title={t.label}
                className={`w-5 h-5 rounded-full border-2 transition-transform ${concordiaTheme === t.id ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                style={{ backgroundColor: t.swatch }}
              />
            ))}
            <div className="w-px h-4 bg-white/20 mx-0.5" />
            <button
              onClick={() => setConcordiaRenderStyle((s) => (s === 'pbr' ? 'toon' : 'pbr'))}
              title={
                concordiaRenderStyle === 'pbr'
                  ? 'Switch to Toon (cel shading)'
                  : 'Switch to PBR (realistic)'
              }
              className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors ${concordiaRenderStyle === 'toon' ? 'bg-indigo-500/70 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'}`}
            >
              {concordiaRenderStyle === 'pbr' ? 'PBR' : 'Toon'}
            </button>
          </div>
          {/* 3D scene rendering layers */}
          <TerrainRenderer districts={[]} lodCenter={{ x: 0, z: 0 }} quality="medium" />
          <BuildingRenderer3D buildings={[]} viewMode="normal" />
          <SkyWeatherRenderer
            timeOfDay={12}
            weather={(() => {
              const t = weatherData?.type ?? 'clear';
              if (t === 'clear' || t === 'rain' || t === 'snow' || t === 'fog' || t === 'overcast' || t === 'storm') return t;
              if (t === 'heavy_rain') return 'rain';
              if (t === 'blizzard') return 'snow';
              if (t === 'sandstorm') return 'fog';
              return 'clear';
            })()}
            windDirection={0}
            windSpeed={2 + (weatherData?.intensity ?? 0) * 6}
            season="summer"
            quality="medium"
          />
          <WaterRenderer
            riverConfig={{ width: 20, flowDirection: 0, flowSpeed: 1, centerX: 0, length: 100 }}
            creekPath={[]}
            timeOfDay={12}
            quality="medium"
          />
          <ParticleEffectsComponent
            canvasWidth={800}
            canvasHeight={600}
            emitters={[]}
            weather={null}
            active={false}
          />
          <SoundscapeEngine
            initialDistrict={activeDistrict.id}
            playerPosition={{
              x: playerAvatar.position.x,
              y: playerAvatar.position.y,
              z: playerAvatar.position.z,
              forwardX: Math.sin(playerAvatar.rotation),
              forwardZ: -Math.cos(playerAvatar.rotation),
            }}
            weatherOverride={weatherData ?? undefined}
          />
          <AnimationManager>
            <></>
          </AnimationManager>
          <GameJuice>
            <></>
          </GameJuice>
          <LevelUpJuiceBridge />
          <PerformanceOverlay />
          <BazaarLayer worldId="concordia" />
          <CurrencyHUD onClick={() => setShowPanel('profile')} />
          <DiegeticSurfaces
            playerPosition={playerAvatar.position}
            onOpenMap={() => setShowPanel('map')}
            onOpenSheet={() => setShowPanel('character')}
            onOpenInventory={() => setShowPanel('inventory')}
          />
          <SocialOverlay
            myUserId={playerAvatar.id}
            nearbyPlayers={otherPlayers.map((p) => ({ id: p.id, name: p.name }))}
          />
          <LoadingTransitions
            transition="district"
            destination={{ name: 'Loading...' }}
            progress={0}
            phase="terrain"
          />
          <div className="absolute inset-0 pointer-events-none">
            <AvatarSystem3D
              playerAvatar={playerAvatar}
              otherPlayers={otherPlayers}
              npcs={worldNPCs}
              weatherModifiers={weatherModifiers ?? undefined}
              quality="medium"
              cameraMode={cameraMode}
              onMove={(pos, rotation) => {
                // Update local avatar immediately for snappy response,
                // then emit to the server so other players see us move.
                setPlayerAvatar((prev) => ({ ...prev, position: pos, rotation }));
                // Advance tutorial on first significant movement
                window.dispatchEvent(
                  new CustomEvent('concordia:tutorial-action', {
                    detail: { action: 'moved-significant-distance' },
                  })
                );
                if (worldSocket.isConnected) {
                  worldSocket.emit('player:move', {
                    cityId: activeDistrict.id,
                    districtId: activeDistrict.id,
                    x: pos.x,
                    y: pos.y,
                    z: pos.z,
                    rotation,
                    direction: rotation,
                    action: 'walk',
                    currentAnimation: 'walk',
                  });

                  // ── ReconciliationBuffer: client-side prediction ────────────
                  // Build an InputFrame from the position delta vs last state,
                  // run it through the buffer's predict() so unacknowledged
                  // inputs are stored for re-simulation if the server rejects.
                  const seq = ++inputSeqRef.current;
                  const prev = prevCharStateRef.current;
                  const dt = 1 / 60; // nominal; AvatarSystem3D owns real delta
                  const dx = prev ? pos.x - prev.position.x : 0;
                  const dz = prev ? pos.z - prev.position.z : 0;
                  const len = Math.sqrt(dx * dx + dz * dz) || 1;
                  const inputFrame = {
                    seq,
                    delta: dt,
                    forward: dz / len,
                    strafe: dx / len,
                    jump: false,
                    sprint: false,
                    yaw: rotation,
                  };
                  const currentState: CharState = prev ?? {
                    seq: 0,
                    position: pos,
                    velocity: { x: 0, y: 0, z: 0 },
                    onGround: true,
                    health: combatState.health,
                    stamina: combatState.stamina,
                  };
                  const predicted = getRecon().predict(currentState, inputFrame);

                  // Delta-compressed binary move alongside JSON
                  if (prev) {
                    worldSocket.emit('player:move:delta', encodeDelta(prev, predicted));
                  }
                  prevCharStateRef.current = predicted;
                }
              }}
              onEmote={(emote) => {
                setPlayerAvatar((prev) => ({ ...prev, currentAnimation: emote as PlayerAnimationClip }));
                if (worldSocket.isConnected) {
                  worldSocket.emit('player:move', {
                    cityId: activeDistrict.id,
                    districtId: activeDistrict.id,
                    x: playerAvatar.position.x,
                    y: playerAvatar.position.y,
                    z: playerAvatar.position.z,
                    rotation: playerAvatar.rotation,
                    direction: playerAvatar.rotation,
                    action: emote,
                    currentAnimation: emote,
                  });
                }
              }}
            />
          </div>
          {/* Lens portal markers — rendered as 2D overlays */}
          {portals.map((portal) => {
            const isNearby = nearPortalId === portal.id;
            return (
              <div
                key={portal.id}
                className="absolute pointer-events-auto"
                style={{
                  left: `calc(50% + ${(portal.x - playerAvatar.position.x) * 32}px)`,
                  top: `calc(50% + ${(portal.y - playerAvatar.position.y) * 32}px)`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 15,
                }}
              >
                <LensPortalMarker
                  portal={{
                    ...portal,
                    district: 'concordia',
                    building_type: 'portal',
                    description: undefined,
                  }}
                  isNearby={isNearby}
                  onEnter={(p) => {
                    setActiveLensOverride(p.lens_id);
                    modeManager.switchTo('lens_work', { push: true });
                  }}
                />
              </div>
            );
          })}
          {/* NPC interaction overlays — clickable name tags near each NPC */}
          {rawWorldNPCs.map((npc) => {
            const dx = npc.position.x - playerAvatar.position.x;
            const dy = npc.position.y - playerAvatar.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 20) return null; // only show nearby NPCs
            const isNearby = dist < 4;
            return (
              <div
                key={npc.id}
                className="absolute pointer-events-auto"
                style={{
                  left: `calc(50% + ${dx * 32}px)`,
                  top: `calc(50% + ${dy * 32 - 36}px)`,
                  transform: 'translate(-50%, -100%)',
                  zIndex: 16,
                }}
              >
                <button
                  onClick={() => openNPCDialogue(npc)}
                  title={`Talk to ${npc.name}${npc.isConscious ? ' (conscious — full dialogue)' : ''}`}
                  className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border backdrop-blur-sm transition-all ${
                    npc.isWanted
                      ? 'bg-red-900/70 border-red-500/50 text-red-300'
                      : npc.isConscious
                        ? 'bg-yellow-900/70 border-yellow-500/50 text-yellow-300'
                        : (npc.griefLevel ?? 0) > 0.5
                          ? 'bg-blue-900/70 border-blue-500/40 text-blue-300'
                          : isNearby
                            ? 'bg-black/80 border-white/30 text-white'
                            : 'bg-black/60 border-white/10 text-white/60'
                  }`}
                >
                  {npc.isWanted && <span>⚠</span>}
                  {npc.isConscious && <span>⚡</span>}
                  <span>{npc.name}</span>
                  {isNearby && <span className="text-cyan-400/80 font-bold">[E]</span>}
                </button>
              </div>
            );
          })}

          {/* Building "Enter" overlays — shown when player is near a building */}
          {worldBuildings.map((b) => {
            const dx = b.x - playerAvatar.position.x;
            const dy = b.z - playerAvatar.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 8) return null; // only show when nearby
            return (
              <div
                key={b.id}
                className="absolute pointer-events-auto"
                style={{
                  left: `calc(50% + ${dx * 32}px)`,
                  top: `calc(50% + ${dy * 32 - 50}px)`,
                  transform: 'translate(-50%, -100%)',
                  zIndex: 16,
                }}
              >
                <button
                  onClick={() => setInteriorBuilding({ id: b.id, name: b.name || b.building_type })}
                  className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full bg-amber-900/80 border border-amber-500/50 text-amber-300 backdrop-blur-sm hover:bg-amber-800/80 transition-colors"
                >
                  <span>🚪</span>
                  <span>{b.name || b.building_type}</span>
                  <span className="text-amber-400/60">· enter</span>
                </button>
              </div>
            );
          })}

          {/* Camera mode controls */}
          <div className="absolute top-4 right-4 z-20">
            <CameraControls
              cameraState={{
                mode: cameraMode,
                zoom: 15,
                rotation: 'NE',
                followTarget: 'avatar',
                cinematicPlaying: false,
                cinematicTime: 0,
                cinematicDuration: 0,
                transitioning: false,
              }}
              onModeChange={(mode) => setCameraMode(mode as typeof cameraMode)}
              onZoom={() => {}}
              onRotate={() => {}}
              onTransition={() => {}}
            />
          </div>
          {/* HUD overlay — mode drives the top-bar label */}
          <HUDOverlay
            mode={(MODE_TO_HUD[inputMode] ?? 'explore') as HUDMode}
            district={activeDistrict.name}
            timeOfDay="day"
            weather="clear"
            playerCount={1}
            currency={{ concordCoin: 0, pendingRoyalties: 0 }}
            professionBadge=""
            reputationLevel={1}
            notifications={[]}
            unreadCount={0}
            tools={[]}
            onToolSelect={() => {}}
            onMenuOpen={() => {}}
          />

          {/* ── Concordia mode overlays ── */}
          {inputMode === 'combat' && (
            <CombatHUD
              state={combatCtx.state}
              comboCount={comboCount}
              staggered={staggered}
              limbState={limbState}
              limbArmorState={limbArmorState}
              onActivateSkill={combatCtx.activateSkill}
              onDodge={() => {
                combatCtx.dodge();
                window.dispatchEvent(
                  new CustomEvent('concordia:game-juice', {
                    detail: { trigger: 'combat-dodge' },
                  })
                );
              }}
              onBlock={(held) => {
                combatCtx.setBlock(held);
                if (held) {
                  window.dispatchEvent(
                    new CustomEvent('concordia:game-juice', {
                      detail: { trigger: 'combat-block' },
                    })
                  );
                }
              }}
              onToggleVATS={combatCtx.toggleVATS}
              onQueueShot={combatCtx.queueShot}
            />
          )}
          {inputMode === 'driving' && vehicleCtx.state.occupied && (
            <VehicleHUD
              state={vehicleCtx.state}
              onExit={() => {
                vehicleCtx.exitVehicle();
                modeManager.pop();
              }}
              onHorn={() => {}}
              onShiftUp={vehicleCtx.shiftUp}
              onShiftDown={vehicleCtx.shiftDown}
            />
          )}
          {inputMode === 'conversation' && dialogueCtx.state.active && (
            <DialoguePanel
              state={dialogueCtx.state}
              special={DEFAULT_SPECIAL}
              onSend={(msg, skillCheck) => {
                dialogueCtx.send(msg, skillCheck);
                window.dispatchEvent(
                  new CustomEvent('concordia:tutorial-action', {
                    detail: { action: 'completed-dialogue' },
                  })
                );
              }}
              onClose={() => {
                dialogueCtx.endDialogue();
                modeManager.pop();
              }}
            />
          )}
          {inputMode === 'creation' && (
            <CreationWorkshop
              playerPosition={playerAvatar.position}
              playerId={playerAvatar.id}
              onClose={() => modeManager.pop()}
            />
          )}
          {inputMode === 'lens_work' && (
            <LensWorkspace
              lensId="world"
              lensIdOverride={activeLensOverride ?? undefined}
              lensName={
                activeLensOverride
                  ? activeLensOverride.charAt(0).toUpperCase() +
                    activeLensOverride.slice(1).replace(/-/g, ' ')
                  : 'Concordia'
              }
              playerPosition={playerAvatar.position}
              onClose={() => {
                modeManager.pop();
                setActiveLensOverride(null);
              }}
            />
          )}
          {(inputMode === 'social' || inputMode === 'exploration') && (
            <>
              <EmoteWheelLegacy
                onEmote={(emoteId) => {
                  setPlayerAvatar((prev) => ({ ...prev, currentAnimation: 'wave' }));
                  if (worldSocket.isConnected) {
                    worldSocket.emit('player:move', {
                      cityId: activeDistrict.id,
                      districtId: activeDistrict.id,
                      x: playerAvatar.position.x,
                      y: playerAvatar.position.y,
                      z: playerAvatar.position.z,
                      rotation: playerAvatar.rotation,
                      direction: playerAvatar.rotation,
                      action: emoteId,
                      currentAnimation: emoteId,
                    });
                  }
                }}
                onClose={() => { /* legacy wheel auto-dismisses on emote */ }}
              />
              <QuickMessageBar
                onSend={(msg) => {
                  if (worldSocket.isConnected) worldSocket.emit('chat:message', { text: msg });
                }}
              />
            </>
          )}
          {inputMode === 'spectator' && (
            <SpectatorControls
              camera={{
                moveForward: () => {},
                moveBack: () => {},
                moveLeft: () => {},
                moveRight: () => {},
                moveUp: () => {},
                moveDown: () => {},
                rotate: (_dx, _dy) => {},
                zoom: (_d) => {},
              }}
              onFollowPlayer={() => {}}
              onTimeScrub={() => {}}
              availablePlayers={otherPlayers.map((p) => ({ id: p.id, name: p.name }))}
            />
          )}
          {/* Mobile touch controls — gated internally by useIsTouchDevice */}
          <MobileControls
            mode={inputMode}
            onMovement={() => {}}
            onCamera={() => {}}
            onJump={() => {}}
            onInteract={() => {}}
            onAttack={() => combatCtx.activateSkill(0)}
            onDodge={combatCtx.dodge}
            onBlock={combatCtx.setBlock}
            onThrottle={vehicleCtx.setThrottle}
            onBrake={vehicleCtx.setBrake}
            onSteer={vehicleCtx.setSteering}
            onExitVehicle={() => {
              vehicleCtx.exitVehicle();
              modeManager.pop();
            }}
            hotbarCount={combatCtx.state.hotbar.slots.length}
            onHotbar={combatCtx.activateSkill}
          />
          {/* Tutorial overlay — always present, shows ? button */}
          <TutorialOverlay />

          {/* District activity feed — live quests/events/NPC discovery */}
          <DistrictActivityFeed
            worldId={activeDistrict.id}
            npcs={rawWorldNPCs.map((n) => ({
              id: n.id,
              name: n.name,
              isConscious: n.isConscious,
              questAvailable: false,
              faction: n.faction,
              position: { x: n.position.x, y: n.position.y },
            }))}
            playerPosition={{ x: playerAvatar.position.x, y: playerAvatar.position.y }}
            onTalkToNpc={(npcId) => {
              const npc = rawWorldNPCs.find((n) => n.id === npcId);
              if (npc) openNPCDialogue(npc);
            }}
            onOpenWorldEvents={() => setShowPanel('worldevents')}
            onOpenQuestLog={() => setShowPanel('questlog')}
          />

          {/* Emote wheel — G key in exploration/social mode */}
          {showEmoteWheel && (
            <EmoteWheel
              onEmote={(emoteId) => {
                setPlayerAvatar((prev) => ({
                  ...prev,
                  currentAnimation: emoteId as typeof playerAvatar.currentAnimation,
                }));
                if (worldSocket.isConnected) {
                  worldSocket.emit('player:move', {
                    cityId: activeDistrict.id,
                    districtId: activeDistrict.id,
                    x: playerAvatar.position.x,
                    y: playerAvatar.position.y,
                    z: playerAvatar.position.z,
                    rotation: playerAvatar.rotation,
                    direction: playerAvatar.rotation,
                    action: emoteId,
                    currentAnimation: emoteId,
                  });
                }
                window.dispatchEvent(
                  new CustomEvent('concordia:tutorial-action', {
                    detail: { action: 'sent-quick-message' },
                  })
                );
              }}
              onClose={() => setShowEmoteWheel(false)}
            />
          )}

          {/* Gameplay toolbar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-black/70 border border-white/10 rounded-xl px-2 py-1.5 pointer-events-auto">
            {(
              [
                { key: 'inventory', label: 'Inventory', icon: Layers },
                { key: 'questlog', label: 'Quests', icon: Zap },
                { key: 'chat', label: 'Chat', icon: MessageSquare },
                { key: 'map', label: 'Map', icon: MapIcon },
                { key: 'crafting', label: 'Craft', icon: Layers },
                { key: 'players', label: 'Players', icon: Users },
                { key: 'profile', label: 'Profile', icon: Eye },
                { key: 'collaboration', label: 'Collab', icon: HeartHandshake },
                { key: 'livecollab', label: 'Live Co-op', icon: Radio },
                { key: 'events', label: 'Events', icon: CalendarDays },
                { key: 'socialproof', label: 'Social', icon: ThumbsUp },
                { key: 'notifications', label: 'Notifs', icon: Bell },
                { key: 'smartnotify', label: 'Smart', icon: BellRing },
                { key: 'moderation', label: 'Mod', icon: Shield },
                { key: 'ownership', label: 'Own', icon: Fingerprint },
                { key: 'federation', label: 'Fed', icon: Network },
                { key: 'voice', label: 'Voice', icon: Mic },
                { key: 'voiceassist', label: 'Assist', icon: AudioLines },
                { key: 'combat', label: 'Combat', icon: Swords },
                { key: 'skills', label: 'Skills', icon: Cpu },
                { key: 'modes', label: 'Modes', icon: Gamepad2 },
                { key: 'guild', label: 'Guild', icon: Users },
                { key: 'season', label: 'Season', icon: Award },
                { key: 'leaderboard', label: 'Board', icon: Trophy },
                { key: 'worldevents', label: 'Events+', icon: CalendarDays },
                { key: 'arena', label: 'Arena', icon: Swords },
                { key: 'jobs', label: 'Jobs', icon: Briefcase },
                { key: 'lore', label: 'Lore', icon: BookOpen },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setShowPanel(showPanel === key ? 'none' : key)}
                className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg text-[10px] transition-colors ${showPanel === key ? 'bg-emerald-500/20 text-emerald-300' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
            {/* Design HUD button — always visible */}
            <button
              onClick={() => setShowDesignHUD(true)}
              className="flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg text-[10px] transition-colors text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
            >
              <Cpu className="w-4 h-4" />
              Design
            </button>
          </div>
          {/* Side panels */}
          {showPanel === 'inventory' && (
            <div className="absolute top-4 left-4 z-20 w-80 max-h-[70vh] overflow-auto pointer-events-auto">
              <InventoryPanel onClose={() => setShowPanel('none')} />
            </div>
          )}
          {showPanel === 'quests' && (
            <div className="absolute top-4 left-4 z-20 w-80 max-h-[70vh] overflow-auto pointer-events-auto">
              <QuestPanel onClose={() => setShowPanel('none')} />
            </div>
          )}
          {showPanel === 'questlog' && (
            <div className="absolute top-4 left-4 z-20 w-80 max-h-[70vh] overflow-auto pointer-events-auto">
              {/* QuestLog — detailed quest journal with active/available/completed tabs */}
              <QuestLog
                quests={worldQuests.map((q) => ({
                  id: q.id,
                  title: q.title,
                  description: q.description,
                  status: (q.status === 'available' || q.status === 'active' || q.status === 'completed' || q.status === 'failed')
                    ? q.status
                    : 'available',
                  domain: 'mainland',
                  giverId: q.giver_npc_id ?? 'world',
                  giverName: q.giver_npc_id ?? 'World',
                  objectives: [],
                  reward: { cc: 0, xp: 0, karmaBonus: 0 },
                }))}
                worldId={activeDistrict.id}
                onClose={() => setShowPanel('none')}
              />
            </div>
          )}
          {showPanel === 'chat' && (
            <div className="absolute top-4 left-4 z-20 w-96 max-h-[70vh] overflow-auto pointer-events-auto">
              <ChatSystem />
            </div>
          )}
          {showPanel === 'map' && (
            <div className="absolute top-4 left-4 z-20 w-80 max-h-[70vh] overflow-auto pointer-events-auto">
              <MapNavigation
                playerPosition={{ x: 0, y: 0 }}
                district={activeDistrict.name}
                buildings={worldBuildings.map((b) => ({
                  id: b.id,
                  label: b.name || b.building_type,
                  position: { x: b.x, y: b.z },
                  type: b.building_type,
                }))}
                npcs={worldNPCs.map((n) => ({
                  id: n.id,
                  position: n.position,
                  name: n.name,
                  occupation: n.occupation,
                }))}
                players={[]}
                waypoints={[]}
                onWaypointPlace={() => {}}
                mapMode="district"
              />
            </div>
          )}
          {showPanel === 'crafting' && (
            <div className="space-y-3">
              <CraftingBench
                playerId={playerAvatar.id}
                toolTier={0}
                toolQuality={10}
                skillLevel={1}
                onClose={() => setShowPanel('none')}
              />
              <CraftingPanelV2 worldId="concordia" onClose={() => setShowPanel('none')} />
            </div>
          )}
          {showPanel === 'guild' && (
            <GuildPanel playerId={playerAvatar.id} onClose={() => setShowPanel('none')} />
          )}
          {showPanel === 'season' && <SeasonPassPanel onClose={() => setShowPanel('none')} />}
          {showPanel === 'leaderboard' && (
            <LeaderboardPanel
              currentUserId={playerAvatar.id}
              onClose={() => setShowPanel('none')}
            />
          )}
          {showPanel === 'worldevents' && (
            <WorldEventsPanel worldId="concordia-hub" onClose={() => setShowPanel('none')} />
          )}
          {showPanel === 'arena' && (
            <ArenaPanel playerId={playerAvatar.id} onClose={() => setShowPanel('none')} />
          )}
          {showPanel === 'jobs' && (
            <JobsBoardPanel playerId={playerAvatar.id} onClose={() => setShowPanel('none')} />
          )}
          {showPanel === 'lore' && (
            <LorePanel worldId="concordia-hub" onClose={() => setShowPanel('none')} />
          )}
          {showPanel === 'guild' && false /* CoopPanel handles party UX */}
          {(showPanel === 'players' || showPanel === 'guild') && (
            <div className="absolute top-4 right-4 z-20 max-h-[70vh] overflow-auto pointer-events-auto">
              <CoopPanel
                userId={playerAvatar.id}
                isLeader={false}
                onClose={() => setShowPanel('none')}
              />
            </div>
          )}
          {showPanel === 'players' && (
            <div className="absolute top-4 left-4 z-20 w-80 max-h-[70vh] overflow-auto pointer-events-auto">
              <PlayerPresence
                players={otherPlayers.map((op) => ({
                  id: op.id,
                  name: op.name,
                  profession: 'Citizen',
                  activity: (op.currentAnimation === 'build'
                    ? 'building'
                    : op.currentAnimation === 'walk'
                      ? 'exploring'
                      : op.currentAnimation === 'idle'
                        ? 'idle'
                        : 'socializing') as
                    | 'building'
                    | 'trading'
                    | 'exploring'
                    | 'socializing'
                    | 'mentoring'
                    | 'spectating'
                    | 'idle',
                  online: true,
                  distance: Math.round(
                    Math.hypot(
                      op.position.x - playerAvatar.position.x,
                      op.position.z - playerAvatar.position.z
                    )
                  ),
                }))}
                instancePlayerCount={otherPlayers.length + 1}
                onTargetPlayer={(t) =>
                  handleSelectCombatTarget({ id: t.id, name: t.name, type: 'player' })
                }
                onMessage={(playerId) => {
                  // Open chat focused on this player
                  setShowPanel('chat');
                  window.dispatchEvent(
                    new CustomEvent('concordia:tutorial-action', {
                      detail: { action: 'sent-quick-message' },
                    })
                  );
                  window.dispatchEvent(
                    new CustomEvent('concordia:chat-focus-player', {
                      detail: { playerId },
                    })
                  );
                }}
                onViewProfile={(playerId) => {
                  // Profile panel — show that player's info
                  setShowPanel('profile');
                  window.dispatchEvent(
                    new CustomEvent('concordia:view-player-profile', {
                      detail: { playerId },
                    })
                  );
                }}
                onAddFriend={(playerId) => {
                  fetch('/api/social/follow', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetId: playerId }),
                  }).catch(() => {});
                }}
              />
            </div>
          )}
          {showPanel === 'profile' && (
            <div className="absolute top-4 left-4 z-20 w-96 max-h-[70vh] overflow-auto pointer-events-auto">
              <PlayerProfile isOwnProfile />
            </div>
          )}
          {showPanel === 'collaboration' && (
            <div className="absolute top-4 left-4 z-20 w-96 max-h-[70vh] overflow-auto pointer-events-auto">
              <CollaborationTools />
            </div>
          )}
          {showPanel === 'livecollab' && (
            <div className="absolute top-4 left-4 z-20 w-96 max-h-[70vh] overflow-auto pointer-events-auto">
              <LiveCollaboration
                session={{
                  id: '',
                  dtuId: '',
                  dtuName: '',
                  branch: 'main',
                  isDraft: true,
                  validationStatus: 'checking',
                  validationMessages: [],
                }}
                participants={[]}
                editHistory={[]}
                conflicts={[]}
              />
            </div>
          )}
          {showPanel === 'events' && (
            <div className="absolute top-4 left-4 z-20 w-96 max-h-[70vh] overflow-auto pointer-events-auto">
              <EventsGatherings />
            </div>
          )}
          {showPanel === 'socialproof' && (
            <div className="absolute top-4 left-4 z-20 w-80 max-h-[70vh] overflow-auto pointer-events-auto">
              <SocialProofFeed />
            </div>
          )}
          {showPanel === 'notifications' && (
            <div className="absolute top-4 left-4 z-20 w-80 max-h-[70vh] overflow-auto pointer-events-auto">
              <NotificationFeed
                notifications={[]}
                preferences={{
                  citation: true,
                  royalty: true,
                  discovery: true,
                  event: true,
                  system: true,
                  social: true,
                  moderation: true,
                  milestone: true,
                }}
                onRead={() => {}}
                onReadAll={() => {}}
                onAction={() => {}}
                onPreferenceChange={() => {}}
              />
            </div>
          )}
          {showPanel === 'smartnotify' && (
            <div className="absolute top-4 left-4 z-20 w-80 max-h-[70vh] overflow-auto pointer-events-auto">
              <SmartNotifications
                notifications={[]}
                profile={{
                  interests: [],
                  quietHours: { enabled: false, start: '22:00', end: '08:00' },
                  smartMode: true,
                  analytics: { totalReceived: 0, readRate: 0, actionRate: 0, topDomains: [] },
                  learningSuggestions: [],
                }}
                rules={[]}
                onUpdateRule={() => {}}
                onDismiss={() => {}}
                onLearn={() => {}}
              />
            </div>
          )}
          {showPanel === 'moderation' && (
            <div className="absolute top-4 left-4 z-20 w-96 max-h-[70vh] overflow-auto pointer-events-auto">
              <ModerationPanel
                role="player"
                reports={[]}
                permissions={[]}
                undoHistory={[]}
                onReport={() => {}}
                onUndo={() => {}}
              />
            </div>
          )}
          {showPanel === 'ownership' && (
            <div className="absolute top-4 left-4 z-20 w-96 max-h-[70vh] overflow-auto pointer-events-auto">
              <OwnershipProfile />
            </div>
          )}
          {showPanel === 'federation' && (
            <div className="absolute top-4 left-4 z-20 w-96 max-h-[70vh] overflow-auto pointer-events-auto">
              <FederationPanel />
            </div>
          )}
          {showPanel === 'voice' && (
            <div className="absolute top-4 left-4 z-20 w-80 max-h-[70vh] overflow-auto pointer-events-auto">
              <VoiceInterface />
            </div>
          )}
          {showPanel === 'voiceassist' && (
            <div className="absolute top-4 left-4 z-20 w-80 max-h-[70vh] overflow-auto pointer-events-auto">
              <VoiceAssistant />
            </div>
          )}
          {showPanel === 'skills' && (
            <div className="absolute top-4 right-4 z-20 w-96 max-h-[70vh] overflow-auto pointer-events-auto">
              <SkillsPanel worldId={activeDistrict.id} onClose={() => setShowPanel('none')} />
            </div>
          )}
          <XPToast />
          <NemesisAlert />
          <LegendaryAnnouncement />
          <HybridReveal />

          {/* ── Loot bag HUD ──────────────────────────────────────────────── */}
          {lootBags.length > 0 && (
            <div className="absolute bottom-28 right-4 z-30 pointer-events-auto w-64">
              <div className="bg-black/80 backdrop-blur-sm border border-yellow-500/40 rounded-xl p-3 shadow-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-yellow-400 text-sm">⚔</span>
                  <span className="text-xs font-semibold text-yellow-300">Nearby Loot</span>
                  <span className="ml-auto text-[10px] text-gray-500">
                    {lootBags.length} bag{lootBags.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                  {lootBags.map((bag) => (
                    <div
                      key={bag.id}
                      className="flex items-center justify-between bg-white/5 rounded-lg px-2 py-1.5"
                    >
                      <div>
                        <span className="text-[11px] text-white font-medium">
                          {bag.itemCount} item{bag.itemCount !== 1 ? 's' : ''}
                        </span>
                        {bag.killerPriority && (
                          <span className="ml-1.5 text-[9px] text-yellow-400 bg-yellow-400/10 px-1 rounded">
                            Your kill
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => claimLootBag(bag.id)}
                        disabled={claimingBag === bag.id}
                        className="text-[10px] px-2 py-0.5 bg-yellow-500/20 hover:bg-yellow-500/40 text-yellow-300 rounded transition-colors disabled:opacity-50"
                      >
                        {claimingBag === bag.id ? '…' : 'Claim'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Resource Bars HUD (top-left, below minimap) */}
          <div className="absolute top-4 left-4 z-20 pointer-events-none flex flex-col gap-1 min-w-[160px]">
            {(
              [
                { key: 'hp', label: 'HP', color: '#ef4444', icon: '❤' },
                { key: 'mana', label: 'Mana', color: '#818cf8', icon: '✦' },
                { key: 'stamina', label: 'Stamina', color: '#f59e0b', icon: '⚡' },
                { key: 'bio_power', label: 'Bio Power', color: '#10b981', icon: '☿' },
                { key: 'perception', label: 'Perception', color: '#06b6d4', icon: '◎' },
              ] as const
            ).map(({ key, color, icon }) => {
              const val =
                key === 'hp' ? combatState.health : key === 'stamina' ? combatState.stamina : 100;
              const maxVal =
                key === 'hp'
                  ? combatState.maxHealth
                  : key === 'stamina'
                    ? combatState.maxStamina
                    : 100;
              const pct = Math.max(0, Math.min(100, (val / maxVal) * 100));
              return (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="text-[9px] w-2.5 flex-shrink-0" style={{ color }}>
                    {icon}
                  </span>
                  <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="text-[9px] text-white/40 w-8 text-right flex-shrink-0">
                    {Math.round(val)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Swimming indicator */}
          {isSwimming && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
              <div className="flex items-center gap-2 bg-blue-900/70 border border-blue-400/50 text-blue-200 text-xs px-4 py-2 rounded-full backdrop-blur-sm">
                <span className="text-base">🌊</span> Swimming — stamina draining
              </div>
            </div>
          )}

          {/* Nearby resource nodes — gather HUD (bottom-left) */}
          {nearbyNodes.filter((n) => !n.is_depleted).length > 0 && (
            <div className="absolute bottom-28 left-4 z-30 flex flex-col gap-1 max-w-[220px]">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">
                Nearby resources
              </p>
              {nearbyNodes
                .filter((n) => !n.is_depleted)
                .slice(0, 4)
                .map((node) => {
                  const icon =
                    node.node_type === 'tree'
                      ? '🌲'
                      : node.node_type === 'ore_vein'
                        ? '⛏'
                        : node.node_type === 'herb'
                          ? '🌿'
                          : node.node_type === 'crystal'
                            ? '💎'
                            : node.node_type === 'fuel'
                              ? '🪨'
                              : node.node_type === 'stone'
                                ? '🪨'
                                : '📦';
                  const qualColor =
                    node.quality === 'legendary'
                      ? 'text-orange-300 border-orange-500/50'
                      : node.quality === 'rare'
                        ? 'text-purple-300 border-purple-500/50'
                        : node.quality === 'uncommon'
                          ? 'text-blue-300 border-blue-500/50'
                          : 'text-gray-300 border-gray-600/50';
                  return (
                    <div
                      key={node.id}
                      className={`flex items-center justify-between bg-black/60 border ${qualColor} rounded-lg px-2 py-1.5 text-xs backdrop-blur-sm`}
                    >
                      <span>
                        {icon} {node.resource_name}
                      </span>
                      <button
                        onClick={() => gatherFromNode(node.id)}
                        disabled={gatheringNode === node.id}
                        className="ml-2 px-2 py-0.5 bg-emerald-600/70 hover:bg-emerald-500/80 text-emerald-100 rounded text-[10px] disabled:opacity-50 transition-colors"
                      >
                        {gatheringNode === node.id ? '…' : 'Gather'}
                      </button>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Gather result toast */}
          {gatherResult && (
            <div className="absolute bottom-20 left-4 z-30 pointer-events-none">
              <div className="bg-emerald-900/70 border border-emerald-500/50 text-emerald-200 text-xs px-3 py-2 rounded-lg backdrop-blur-sm">
                ✦ {gatherResult}
              </div>
            </div>
          )}

          {/* Loot claim notification */}
          {lootNotification && (
            <div className="absolute bottom-20 right-4 z-30 pointer-events-none">
              <div className="bg-yellow-500/20 border border-yellow-500/50 text-yellow-300 text-xs px-3 py-2 rounded-lg backdrop-blur-sm animate-pulse">
                ✦ {lootNotification}
              </div>
            </div>
          )}

          {/* Quest tracker HUD — bottom right, above HUD bar */}
          <div className="absolute bottom-24 right-4 z-25 flex flex-col gap-2 pointer-events-auto">
            <QuestTracker
              worldId={activeDistrict.id}
              onClaimReward={(_questId, _rewards) => {
                setGatherResult('Quest complete! Rewards granted.');
                setTimeout(() => setGatherResult(null), 3500);
              }}
            />
          </div>

          {/* QuestNotification — toast overlay for quest state changes (new/complete/failed).
              Renders top-right; fires when questNotification state is set. */}
          <div className="absolute top-16 right-4 z-30 flex flex-col gap-2 pointer-events-none">
            {questNotification && (
              <_QuestNotification
                quest={questNotification.quest}
                type={questNotification.type}
                onDismiss={() => setQuestNotification(null)}
              />
            )}
          </div>
          {gatheringState && (
            <_GatheringMinigame
              toolTier={gatheringState.toolTier}
              resourceName={gatheringState.resourceName}
              onComplete={(score) => {
                const resource = gatheringState.resourceName;
                setGatheringState(null);
                if (score > 0 && worldSocket?.emit)
                  worldSocket.emit('world:gather-complete', { resource, score });
              }}
              onCancel={() => setGatheringState(null)}
            />
          )}
          {/* Design HUD — full-screen skill/recipe design studio */}
          {showDesignHUD && (
            <DesignHUD
              worldId={activeDistrict.id}
              worldType="standard"
              onClose={() => setShowDesignHUD(false)}
            />
          )}

          {/* NPC Dialogue overlay */}
          {dialogueNPC && (
            <NPCDialogue
              npc={dialogueNPC}
              worldId={activeDistrict.id}
              onClose={() => setDialogueNPC(null)}
              onQuestAccepted={(questId) => {
                setDialogueNPC(null);
                setQuestNotification({
                  quest: {
                    id: questId,
                    title: 'New Quest',
                    description: 'Quest accepted!',
                  } as never,
                  type: 'new',
                });
                window.dispatchEvent(
                  new CustomEvent('concordia:game-juice', {
                    detail: { trigger: 'quest-complete' },
                  })
                );
                window.dispatchEvent(
                  new CustomEvent('concordia:tutorial-action', {
                    detail: { action: 'accepted-quest' },
                  })
                );
              }}
            />
          )}

          {/* Building Interior overlay */}
          {interiorBuilding && (
            <BuildingInterior
              buildingId={interiorBuilding.id}
              buildingName={interiorBuilding.name}
              worldId={activeDistrict.id}
              onClose={() => setInteriorBuilding(null)}
              onNPCClick={(npc) => {
                setInteriorBuilding(null);
                const fullNpc = rawWorldNPCs.find((n) => n.id === npc.id) ?? {
                  id: npc.id,
                  name: npc.name,
                  archetype: npc.archetype,
                  jobType: npc.jobType,
                };
                setDialogueNPC(fullNpc);
              }}
            />
          )}

          {/* Bar Upgrade Panel — appears on level-up, one choice per upgrade point */}
          {upgradePrompt && upgradePrompt.pendingUpgrades > 0 && (
            <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto">
              <div className="bg-black/90 border border-purple-500/40 rounded-2xl p-6 w-80 shadow-2xl shadow-purple-500/10">
                <div className="text-center mb-4">
                  <div className="text-purple-400 text-xs uppercase tracking-widest mb-1">
                    Level Up
                  </div>
                  <div className="text-white font-bold text-lg">
                    Character Level {upgradePrompt.characterLevel}
                  </div>
                  <div className="text-white/40 text-xs mt-1">
                    {upgradePrompt.pendingUpgrades} upgrade{' '}
                    {upgradePrompt.pendingUpgrades === 1 ? 'point' : 'points'} remaining
                  </div>
                </div>
                <p className="text-white/50 text-xs text-center mb-4">
                  Choose a bar to permanently increase by +10
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {(
                    [
                      {
                        key: 'hp',
                        label: 'Max HP',
                        color: 'border-red-500/40 hover:bg-red-900/20 text-red-400',
                        icon: '❤',
                      },
                      {
                        key: 'mana',
                        label: 'Max Mana',
                        color: 'border-indigo-500/40 hover:bg-indigo-900/20 text-indigo-400',
                        icon: '✦',
                      },
                      {
                        key: 'stamina',
                        label: 'Max Stamina',
                        color: 'border-amber-500/40 hover:bg-amber-900/20 text-amber-400',
                        icon: '⚡',
                      },
                      {
                        key: 'bio_power',
                        label: 'Max Bio Power',
                        color: 'border-emerald-500/40 hover:bg-emerald-900/20 text-emerald-400',
                        icon: '☿',
                      },
                      {
                        key: 'perception',
                        label: 'Max Perception',
                        color: 'border-cyan-500/40 hover:bg-cyan-900/20 text-cyan-400',
                        icon: '◎',
                      },
                    ] as const
                  ).map(({ key, label, color, icon }) => (
                    <button
                      key={key}
                      onClick={async () => {
                        try {
                          const r = await fetch('/api/crafting/upgrade-bar', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ worldId: activeDistrict.id, barType: key }),
                          });
                          const d = await r.json();
                          if (d.ok) {
                            const remaining = d.pendingUpgrades ?? 0;
                            if (remaining > 0) {
                              setUpgradePrompt({
                                characterLevel: d.characterLevel,
                                pendingUpgrades: remaining,
                              });
                            } else {
                              setUpgradePrompt(null);
                            }
                          }
                        } catch {
                          setUpgradePrompt(null);
                        }
                      }}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-sm transition-colors ${color}`}
                    >
                      <span className="text-base">{icon}</span>
                      <span className="flex-1 text-left">{label}</span>
                      <span className="text-white/30 text-xs">+10</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <CrisisBanner />
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
            <SeasonBanner onOpenPassPanel={() => setShowPanel('season')} />
          </div>
          <GameModeHUD />
          <GameModePicker open={showPanel === 'modes'} onClose={() => setShowPanel('none')} />
          {/* Combat HUD — renders its own fixed-position overlays
              (health bar, target panel, floating damage numbers,
              combat log, death overlay). Surfaces whenever the
              Combat panel is toggled, an active target is set, the
              player is dead, or we've taken recent damage. */}
          {(showPanel === 'combat' ||
            combatState.target ||
            combatState.isDead ||
            combatState.damageFlash) && (
            <CombatSystem
              combatState={combatState}
              combatMode="pve"
              onAttack={handleAttack}
              onBlock={handleBlock}
              onUseItem={() => pushCombatLog('No consumable equipped.', 'info')}
              onRespawn={handleRespawn}
            />
          )}
          {/* Impact feedback — floating damage numbers + screen shake */}
          <ImpactFeedback />
        </div>
      ) : viewMode === 'streams' ? (
        <CityStreamingSection />
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Left Sidebar: Toolbar + Creation Panel */}
          <div className="flex flex-col w-56 flex-shrink-0 border-r border-white/10 overflow-y-auto">
            <CreationToolbar
              activeMode={creationMode}
              onModeChange={setCreationMode}
              zoom={zoom}
              onZoomChange={setZoom}
              rotation={rotation}
              onRotate={handleRotate}
              visibleLayers={visibleLayers}
              onToggleLayer={handleToggleLayer}
              showValidationOverlay={showValidation}
              onToggleValidation={() => setShowValidation(!showValidation)}
              showWeatherOverlay={showWeather}
              onToggleWeather={() => setShowWeather(!showWeather)}
            />

            {/* Marketplace palette when in guided/component mode */}
            {(creationMode === 'guided' || creationMode === 'component') && (
              <div className="border-t border-white/10 p-2">
                <MarketplacePalette
                  onSelectComponent={(entry) => {
                    // Auto-cite when selecting from marketplace
                    void entry;
                  }}
                />
              </div>
            )}

            {/* ── Tools Panel ──────────────────────────────── */}
            <div className="border-t border-white/10">
              <button
                onClick={() => setToolsExpanded(!toolsExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-300 hover:text-white transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5 text-cyan-400" />
                  Tools
                  {activeTool && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                </span>
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform ${toolsExpanded ? 'rotate-90' : ''}`}
                />
              </button>
              {toolsExpanded && (
                <div className="px-2 pb-2 space-y-2">
                  {(['Build', 'Inspect', 'Export', 'Verify', 'Replay'] as const).map((group) => {
                    const tools = DISTRICT_TOOLS.filter((t) => t.group === group);
                    return (
                      <div key={group}>
                        <div className="text-[10px] uppercase tracking-wider text-gray-500 px-1 mb-1">
                          {group}
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {tools.map(({ key, label, icon: Icon }) => (
                            <button
                              key={key}
                              onClick={() => setActiveTool(activeTool === key ? null : key)}
                              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                                activeTool === key
                                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                  : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                              }`}
                            >
                              <Icon className="w-3 h-3 shrink-0" />
                              <span className="truncate">{label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Center: District Viewport */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Creation panels overlay */}
            {creationMode === 'guided' && (
              <div className="absolute left-60 top-24 z-20 w-80">
                <GuidedCreator
                  district={activeDistrict}
                  materials={materials}
                  onPublish={handlePublishBuilding}
                  onCancel={() => setCreationMode(null)}
                />
              </div>
            )}
            {creationMode === 'component' && (
              <div className="absolute left-60 top-24 z-20 w-72">
                <ComponentCreator
                  materials={materials}
                  onPublish={handlePublishComponent}
                  onCancel={() => setCreationMode(null)}
                />
              </div>
            )}
            {creationMode === 'raw' && (
              <div className="absolute left-60 top-24 z-20 w-96">
                <RawDTUEditor
                  materials={materials}
                  onPublish={handlePublishRawDTU}
                  onCancel={() => setCreationMode(null)}
                />
              </div>
            )}

            {/* ── Tool panel overlays ──────────────────────── */}
            {activeTool && (
              <div className="absolute left-60 top-24 z-20 w-[480px] max-h-[75vh] overflow-auto bg-gray-900/95 border border-white/10 rounded-xl shadow-2xl">
                <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 border-b border-white/10 bg-gray-900/95 backdrop-blur">
                  <span className="text-xs font-semibold text-cyan-300">
                    {DISTRICT_TOOLS.find((t) => t.key === activeTool)?.label}
                  </span>
                  <button
                    onClick={() => setActiveTool(null)}
                    className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-2">
                  {activeTool === 'snapbuild' && (
                    <SnapBuildCatalog onClose={() => setActiveTool(null)} />
                  )}
                  {activeTool === 'dsl' && <ConcordDSLEditor />}
                  {activeTool === 'terminal' && <ConcordTerminal />}
                  {activeTool === 'diff' && <DTUDiffViewer />}
                  {activeTool === 'standards' && <StandardsLibrary />}
                  {activeTool === 'fabrication' && <FabricationExportPanel />}
                  {activeTool === 'embed' && (
                    <ExportEmbed
                      dtuId={selectedBuilding?.dtuId ?? 'none'}
                      dtuName={selectedBuilding?.dtuId ?? 'Selected DTU'}
                    />
                  )}
                  {activeTool === 'notebook' && <NotebookEditor />}
                  {activeTool === 'depgraph' && <DependencyGraphViewer />}
                  {activeTool === 'digitaltwin' && <DigitalTwinDashboard />}
                  {activeTool === 'sensors' && <SensorDashboard />}
                  {activeTool === 'marketplace' && <ServiceMarketplace />}
                  {activeTool === 'certificates' && <CertificatePanel />}
                  {activeTool === 'notarization' && <NotarizationPanel />}
                  {activeTool === 'stresstest' && (
                    <StressTestPanel
                      districtId={activeDistrict.id}
                      buildingCount={activeDistrict.buildings.length}
                    />
                  )}
                  {activeTool === 'replay' && <ReplayForensics />}
                  {activeTool === 'spectator' && <ReplaySpectator />}
                </div>
              </div>
            )}

            <DistrictViewport
              district={activeDistrict}
              selectedBuildingId={selectedBuilding?.id || null}
              onBuildingClick={handleBuildingClick}
              onInfrastructureClick={handleInfraClick}
              onTerrainClick={handleTerrainClick}
              showValidationOverlay={showValidation}
              showWeatherOverlay={showWeather}
              visibleLayers={visibleLayers}
              zoom={zoom}
              rotation={rotation}
            />
          </div>

          {/* Right Sidebar: Inspector */}
          <InspectorPanel
            selectedBuilding={selectedBuilding}
            selectedInfra={selectedInfra}
            selectedTerrain={selectedTerrain}
            validationReport={validationReport}
            citations={citations}
            materials={materials}
            onClose={handleCloseInspector}
          />
        </div>
      )}

      {/* Bottom Status Bar */}
      <StatusBar district={viewMode === 'district' ? activeDistrict : null} />

      {/* World Actions Panel */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-neon-green" />
            World Actions
          </h3>
          {worldActionResult && (
            <button
              onClick={() => setWorldActionResult(null)}
              className="p-0.5 rounded hover:bg-white/5 text-gray-400"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          {(['countryCompare', 'indicatorTrack', 'tradeFlow', 'demographicProfile'] as const).map(
            (action) => (
              <button
                key={action}
                onClick={() => handleWorldAction(action)}
                disabled={!_buildingItems[0]?.id || worldActiveAction !== null}
                className="px-2.5 py-1 text-xs rounded-lg bg-neon-green/10 text-neon-green border border-neon-green/30 hover:bg-neon-green/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {worldActiveAction === action ? (
                  <div className="w-2.5 h-2.5 border border-neon-green border-t-transparent rounded-full animate-spin" />
                ) : null}
                {action === 'countryCompare'
                  ? 'Compare'
                  : action === 'indicatorTrack'
                    ? 'Indicators'
                    : action === 'tradeFlow'
                      ? 'Trade Flow'
                      : 'Demographics'}
              </button>
            )
          )}
        </div>
        {worldActionResult && (
          <div className="bg-white/[0.03] border border-white/10 rounded-lg p-2 text-xs space-y-1">
            {worldActionResult.action === 'countryCompare' &&
              (() => {
                const r = worldActionResult.result;
                const countries = Array.isArray(r.countries)
                  ? (r.countries as Array<Record<string, unknown>>)
                  : [];
                return (
                  <div className="space-y-1">
                    <div className="text-gray-400">
                      Comparing{' '}
                      <span className="text-white">
                        {String(r.comparisonCount ?? countries.length)}
                      </span>{' '}
                      countries
                    </div>
                    {countries.slice(0, 3).map((c, i) => (
                      <div key={i} className="flex justify-between bg-white/5 px-2 py-0.5 rounded">
                        <span className="text-gray-300">
                          {String(c.name ?? c.code ?? `Country ${i + 1}`)}
                        </span>
                        <span className="text-neon-green">{String(c.gdp ?? c.score ?? '-')}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            {worldActionResult.action === 'indicatorTrack' &&
              (() => {
                const r = worldActionResult.result;
                const indicators = Array.isArray(r.indicators)
                  ? (r.indicators as Array<Record<string, unknown>>)
                  : [];
                return (
                  <div className="space-y-1">
                    <div className="text-gray-400">
                      Tracked:{' '}
                      <span className="text-white">
                        {String(r.indicatorCount ?? indicators.length)}
                      </span>
                    </div>
                    {indicators.slice(0, 4).map((ind, i) => (
                      <div key={i} className="flex justify-between">
                        <span className="text-gray-300">{String(ind.name ?? ind.indicator)}</span>
                        <span className="text-white">
                          {String(ind.value ?? ind.current ?? '-')}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            {worldActionResult.action === 'tradeFlow' &&
              (() => {
                const r = worldActionResult.result;
                return (
                  <div className="flex flex-wrap gap-3">
                    <span className="text-gray-400">
                      Total Trade:{' '}
                      <span className="text-white font-medium">
                        {String(r.totalTradeVolume ?? r.totalVolume ?? 0)}
                      </span>
                    </span>
                    <span className="text-gray-400">
                      Partners: <span className="text-white">{String(r.partnerCount ?? 0)}</span>
                    </span>
                    <span className="text-gray-400">
                      Balance:{' '}
                      <span
                        className={
                          Number(r.tradeBalance ?? 0) >= 0 ? 'text-neon-green' : 'text-red-400'
                        }
                      >
                        {String(r.tradeBalance ?? 0)}
                      </span>
                    </span>
                  </div>
                );
              })()}
            {worldActionResult.action === 'demographicProfile' &&
              (() => {
                const r = worldActionResult.result;
                return (
                  <div className="flex flex-wrap gap-3">
                    <span className="text-gray-400">
                      Population:{' '}
                      <span className="text-white font-medium">{String(r.population ?? '-')}</span>
                    </span>
                    <span className="text-gray-400">
                      Median Age: <span className="text-white">{String(r.medianAge ?? '-')}</span>
                    </span>
                    <span className="text-gray-400">
                      Growth: <span className="text-white">{String(r.growthRate ?? '-')}%</span>
                    </span>
                    <span className="text-gray-400">
                      Urban: <span className="text-white">{String(r.urbanPercent ?? '-')}%</span>
                    </span>
                  </div>
                );
              })()}
          </div>
        )}
      </div>

      {/* Lens Features (collapsible) */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <span className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" /> Lens Features
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-3">
            <LensFeaturePanel lensId="world" />
          </div>
        )}
      </div>

      {/* Onboarding Tutorial */}
      {showOnboarding && (
        <OnboardingTutorial
          onComplete={handleOnboardingComplete}
          onDismiss={handleOnboardingComplete}
        />
      )}

      {/* Post-tutorial hints — rotates contextual tips after first visit */}
      {!showOnboarding && <PostTutorialHints />}
    </div>
  );
}

// ── NPC → AvatarSystem3D mapping ─────────────────────────────────────────────

const FACTION_SKIN: Record<string, string> = {
  villain: '#8b3a3a',
  invader: '#5c3080',
  rogue: '#7a5c00',
  monster: '#2d5a27',
  undead: '#4a5568',
  outlaw: '#6b4c2a',
  cult: '#4a1a6a',
  corp: '#1a3a6a',
  gang: '#7a2a1a',
  crime: '#6a1a1a',
  demon: '#8b1a1a',
  hero: '#1a3a8b',
  neutral: '#6b7280',
};

function _mapNPCToAvatarData(npc: {
  id: string;
  name?: string;
  // API may return x/y at top level (from world_npcs table) OR nested position
  x?: number;
  y?: number;
  position?: { x: number; y: number; z?: number };
  rotation?: number;
  occupation?: string;
  archetype?: string;
  bodyType?: string;
  faction?: string;
  isConscious?: boolean;
  // Behavioral state fields from updated worlds.js API
  griefLevel?: number;
  criminalRep?: number;
  isWanted?: boolean;
  jobType?: string;
  currentHp?: number;
  maxHp?: number;
}): import('@/components/world-lens/AvatarSystem3D').NPCData {
  const pos = npc.position ?? { x: npc.x ?? 0, y: npc.y ?? 0 };
  const isGrieving = (npc.griefLevel ?? 0) > 0.5;
  const isCriminal = (npc.criminalRep ?? 0) > 0.5;
  const isLowHp =
    npc.currentHp !== undefined && npc.maxHp ? npc.currentHp / npc.maxHp < 0.3 : false;

  // Skin color: faction base, overridden by behavioral state
  let skinColor = FACTION_SKIN[npc.faction ?? ''] ?? '#6b7280';
  if (npc.isWanted) skinColor = '#8b2222';
  else if (isCriminal) skinColor = '#6b3a1a';
  else if (isGrieving) skinColor = '#2d3a5a';
  else if (isLowHp) skinColor = '#5a4a2d';

  const occupationAnimation: Record<
    string,
    import('@/components/world-lens/AvatarSystem3D').NPCOccupationAnimation
  > = {
    blacksmith: 'hammer',
    scientist: 'read',
    farmer: 'tend-crops',
    guard: 'patrol',
    trader: 'count-coins',
    engineer: 'construct',
    medic: 'read',
    journalist: 'read',
  };
  const bodyTypeMap: Record<string, 'slim' | 'average' | 'stocky' | 'tall'> = {
    large: 'stocky',
    small: 'slim',
    giant: 'stocky',
    mech: 'stocky',
    alien: 'tall',
    undead: 'slim',
    cyborg: 'average',
    demon: 'stocky',
    dragon: 'stocky',
  };
  const occ = npc.occupation ?? npc.archetype ?? npc.jobType ?? 'guard';

  // Hair color reflects behavioral state
  let hairColor = '#333333';
  if (npc.isConscious) hairColor = '#ffd700';
  else if (isGrieving) hairColor = '#2a3a6a';
  else if (npc.isWanted) hairColor = '#cc2222';

  const clothingTop = npc.isConscious ? 'robe' : npc.isWanted ? 'vest' : 'vest';

  return {
    id: npc.id,
    name: npc.isConscious
      ? `⚡ ${npc.name ?? 'Unknown'}`
      : npc.isWanted
        ? `⚠ ${npc.name ?? 'Unknown'}`
        : (npc.name ?? 'Unknown'),
    position: { x: pos.x, y: pos.y, z: pos.z ?? 0 },
    rotation: npc.rotation ?? 0,
    occupation: occ,
    occupationAnimation: occupationAnimation[occ] ?? 'patrol',
    timestamp: Date.now(),
    appearance: {
      skinColor,
      hairColor,
      hairStyle: npc.isConscious ? 'long' : 'short',
      bodyType: bodyTypeMap[npc.bodyType ?? ''] ?? 'average',
      clothing: {
        top: { color: skinColor, type: clothingTop },
        bottom: { color: '#374151', type: 'pants' },
        ...(npc.isConscious ? { hat: { color: '#ffd700', type: 'tophat' } } : {}),
      },
    },
  };
}
