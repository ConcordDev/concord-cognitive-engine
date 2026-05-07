'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Eye,
  Brain,
  AlertTriangle,
  Loader2,
  Save,
  XCircle,
  BarChart3,
  MessageCircle,
  TrendingUp,
  Megaphone,
  Trophy,
  Sparkles,
  Share2,
  Lock,
  CheckCircle2,
  Info,
  Zap,
  X,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useQuery as useArtifactsQuery } from '@tanstack/react-query';
import { useState as usePrivacyState, useCallback as usePrivacyCallback } from 'react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

// ── Types ───────────────────────────────────────────────────────────────────

/** Frontend consent keys */
type ConsentKey =
  | 'marketplace'
  | 'regional'
  | 'regionalProfile'
  | 'national'
  | 'nationalProfile'
  | 'global'
  | 'globalProfile'
  | 'emergentAccess'
  | 'globalDTUCreation'
  | 'feedPosts'
  | 'dmFollowers'
  | 'dmAnyone';

type ConsentState = Record<ConsentKey, boolean>;

interface ConsentAPIEntry {
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
  revocable: boolean;
  prompt: string;
  scope: string;
}

interface ConsentAPIResponse {
  ok: boolean;
  consents: Record<string, ConsentAPIEntry>;
  stats: {
    dtusShared?: number;
    totalPromotes?: number;
    emergentInteractions?: number;
    feedPostCount?: number;
    [key: string]: number | undefined;
  };
}

// ── Mappings ────────────────────────────────────────────────────────────────

/** Maps frontend consent keys to backend action names */
const ACTION_MAP: Record<ConsentKey, string> = {
  marketplace: 'publish_to_marketplace',
  regional: 'publish_to_regional',
  regionalProfile: 'show_profile_regional',
  national: 'promote_to_national',
  nationalProfile: 'show_profile_national',
  global: 'promote_to_global',
  globalProfile: 'show_profile_global',
  emergentAccess: 'allow_emergent_learning',
  globalDTUCreation: 'allow_global_dtu_creation',
  feedPosts: 'publish_to_feed',
  dmFollowers: 'dm_from_followers',
  dmAnyone: 'dm_from_anyone',
};

/** Non-revocable consent keys */
const NON_REVOCABLE: ConsentKey[] = ['national', 'global'];

/** Social settings that may not yet have backend support */
const SOCIAL_KEYS: ConsentKey[] = ['dmFollowers', 'dmAnyone'];

// ── Category definitions ────────────────────────────────────────────────────

interface ConsentToggleDef {
  key: ConsentKey;
  label: string;
  description: string;
}

interface CategoryDef {
  id: string;
  title: string;
  icon: typeof Shield;
  color: string;
  toggles: ConsentToggleDef[];
  warning?: string;
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'publishing',
    title: 'Publishing',
    icon: Megaphone,
    color: 'text-neon-blue',
    toggles: [
      {
        key: 'marketplace',
        label: 'Marketplace Publishing',
        description: 'Allow your DTUs to appear in the Concord Marketplace.',
      },
      {
        key: 'regional',
        label: 'Regional Publishing',
        description: 'Publish your DTUs to the regional lattice for local discovery.',
      },
      {
        key: 'feedPosts',
        label: 'Feed Posts',
        description: 'Share your DTU activity in the public feed.',
      },
    ],
  },
  {
    id: 'leaderboards',
    title: 'Leaderboards',
    icon: Trophy,
    color: 'text-neon-purple',
    toggles: [
      {
        key: 'regionalProfile',
        label: 'Regional Profile',
        description: 'Show your profile on regional leaderboards.',
      },
      {
        key: 'nationalProfile',
        label: 'National Profile',
        description: 'Show your profile on national leaderboards.',
      },
      {
        key: 'globalProfile',
        label: 'Global Profile',
        description: 'Show your profile on global leaderboards.',
      },
    ],
  },
  {
    id: 'ai-emergents',
    title: 'AI & Emergents',
    icon: Brain,
    color: 'text-neon-cyan',
    toggles: [
      {
        key: 'emergentAccess',
        label: 'Emergent Access',
        description: 'Allow emergent AI agents to learn from your DTU interactions.',
      },
      {
        key: 'globalDTUCreation',
        label: 'Global DTU Creation',
        description: 'Permit creation of globally-scoped DTUs from your data.',
      },
    ],
  },
  {
    id: 'social',
    title: 'Social',
    icon: MessageCircle,
    color: 'text-neon-green',
    toggles: [
      {
        key: 'dmFollowers',
        label: 'DMs from Followers',
        description: 'Allow users who follow you to send direct messages.',
      },
      {
        key: 'dmAnyone',
        label: 'DMs from Anyone',
        description: 'Allow any user to send you direct messages.',
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    icon: AlertTriangle,
    color: 'text-amber-400',
    warning:
      'These actions cannot be undone. Once granted, national and global promotions are permanent and non-revocable.',
    toggles: [
      {
        key: 'national',
        label: 'National Promotion',
        description:
          'Promote your DTUs to the national lattice. This action is permanent.',
      },
      {
        key: 'global',
        label: 'Global Promotion',
        description:
          'Promote your DTUs to the global lattice. This action is permanent.',
      },
    ],
  },
];

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONSENT: ConsentState = {
  marketplace: false,
  regional: false,
  regionalProfile: false,
  national: false,
  nationalProfile: false,
  global: false,
  globalProfile: false,
  emergentAccess: false,
  globalDTUCreation: false,
  feedPosts: false,
  dmFollowers: false,
  dmAnyone: false,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function apiToConsentState(apiConsents: Record<string, ConsentAPIEntry>): ConsentState {
  const state = { ...DEFAULT_CONSENT };
  const reverseMap = Object.fromEntries(
    Object.entries(ACTION_MAP).map(([k, v]) => [v, k as ConsentKey])
  );
  for (const [action, entry] of Object.entries(apiConsents)) {
    const key = reverseMap[action];
    if (key) {
      state[key] = entry.granted;
    }
  }
  return state;
}

function consentStateToAPI(state: ConsentState): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(state)) {
    result[ACTION_MAP[key as ConsentKey]] = value;
  }
  return result;
}

// ── Toggle Switch Component ─────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  nonRevocable,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  nonRevocable?: boolean;
}) {
  const handleToggle = () => {
    if (disabled) return;
    if (nonRevocable && checked) return; // cannot uncheck non-revocable
    onChange(!checked);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={handleToggle}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue focus-visible:ring-offset-2 focus-visible:ring-offset-lattice-void',
        checked
          ? nonRevocable
            ? 'bg-amber-500'
            : 'bg-neon-blue'
          : 'bg-gray-600',
        disabled && 'opacity-50 cursor-not-allowed',
        nonRevocable && checked && 'cursor-not-allowed'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}

// ── Confirmation Modal ──────────────────────────────────────────────────────

function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className={ds.modalBackdrop} onClick={onCancel}>
      <div className={ds.modalContainer}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={cn(ds.modalPanel, 'max-w-md p-6 space-y-4')}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className={ds.heading3}>{title}</h3>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{message}</p>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onCancel} className={ds.btnSecondary}>
              Cancel
            </button>
            <button onClick={onConfirm} className={ds.btnDanger}>
              {confirmLabel}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ── Stats Card ──────────────────────────────────────────────────────────────

function StatsCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={ds.panel}
    >
      <Icon className={cn('w-5 h-5 mb-2', color)} />
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className={ds.textMuted}>{label}</p>
    </motion.div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function PrivacySharingPage() {
  useLensNav('privacy');
  const queryClient = useQueryClient();
  const runAction = useRunArtifact('privacy');
  const [privacyActionResult, setPrivacyActionResult] = usePrivacyState<Record<string, unknown> | null>(null);
  const [privacyActiveAction, setPrivacyActiveAction] = usePrivacyState<string | null>(null);

  const { data: privacyArtifacts } = useArtifactsQuery({
    queryKey: ['lens', 'privacy', 'list', {}],
    queryFn: async () => { const { api: apiClient } = await import('@/lib/api/client'); const { data } = await apiClient.get('/api/lens/privacy'); return data; },
  });
  const firstArtifactId = (privacyArtifacts as {artifacts?: {id: string}[]})?.artifacts?.[0]?.id;

  const handlePrivacyAction = usePrivacyCallback(async (action: string) => {
    if (!firstArtifactId) return;
    setPrivacyActiveAction(action);
    try {
      const res = await runAction.mutateAsync({ id: firstArtifactId, action });
      if (res.ok === false) { setPrivacyActionResult({ action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setPrivacyActionResult({ action, ...(res.result as Record<string, unknown>) }); }
    } catch (err) { console.error('Privacy action failed:', err); }
    finally { setPrivacyActiveAction(null); }
  }, [firstArtifactId, runAction]);

  // Local state mirrors API state for optimistic editing
  const [localConsent, setLocalConsent] = useState<ConsentState>(DEFAULT_CONSENT);
  const [dirty, setDirty] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    key: ConsentKey;
    value: boolean;
  } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Fetch consent data ──────────────────────────────────────────────────
  const {
    data: consentData,
    isLoading,
    isError,
    error,
  } = useQuery<ConsentAPIResponse>({
    queryKey: ['consent'],
    queryFn: async () => {
      const { data } = await api.get('/api/consent');
      return data;
    },
  });

  // Sync API data to local state on load
  useEffect(() => {
    if (consentData?.consents) {
      setLocalConsent(apiToConsentState(consentData.consents));
      setDirty(false);
    }
  }, [consentData]);

  // ── Save mutation ───────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (state: ConsentState) => {
      const { data } = await api.post('/api/consent/update', {
        consents: consentStateToAPI(state),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consent'] });
      setDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    },
  });

  // ── Revoke all mutation ─────────────────────────────────────────────────
  const revokeAllMutation = useMutation({
    mutationFn: async () => {
      const revocableState: Record<string, boolean> = {};
      for (const [key, action] of Object.entries(ACTION_MAP)) {
        if (!NON_REVOCABLE.includes(key as ConsentKey)) {
          revocableState[action] = false;
        }
      }
      const { data } = await api.post('/api/consent/update', {
        consents: revocableState,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consent'] });
    },
  });

  // ── Toggle handler ──────────────────────────────────────────────────────
  const handleToggle = useCallback(
    (key: ConsentKey, value: boolean) => {
      // Non-revocable toggles that are being enabled need confirmation
      if (NON_REVOCABLE.includes(key) && value) {
        setConfirmModal({ key, value });
        return;
      }

      setLocalConsent((prev) => ({ ...prev, [key]: value }));
      setDirty(true);
    },
    []
  );

  const handleConfirmNonRevocable = useCallback(() => {
    if (!confirmModal) return;
    setLocalConsent((prev) => ({ ...prev, [confirmModal.key]: confirmModal.value }));
    setDirty(true);
    setConfirmModal(null);
  }, [confirmModal]);

  const handleRevokeAll = useCallback(() => {
    setConfirmModal(null);
    revokeAllMutation.mutate();
  }, [revokeAllMutation]);

  // ── Stats ───────────────────────────────────────────────────────────────
  const stats = consentData?.stats ?? {};

  // ── Render ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className={cn(ds.pageContainer, 'flex items-center justify-center min-h-[60vh]')}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-neon-blue animate-spin" />
          <p className={ds.textMuted}>Loading privacy settings...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={cn(ds.pageContainer, 'flex items-center justify-center min-h-[60vh]')}>
        <div className="flex flex-col items-center gap-3 text-center">
          <XCircle className="w-8 h-8 text-red-400" />
          <p className="text-white font-medium">Failed to load consent settings</p>
          <p className={ds.textMuted}>
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={ds.pageContainer}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-neon-blue/20 border border-neon-blue/30">
            <Shield className="w-6 h-6 text-neon-blue" />
          </div>
          <div>
            <h1 className={ds.heading1}>Privacy & Sharing</h1>
            <p className={ds.textMuted}>
              Control how your DTUs and profile are shared across the Concord lattice.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRevokeAll}
            disabled={revokeAllMutation.isPending}
            className={ds.btnDanger}
          >
            {revokeAllMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            Revoke All
          </button>
          <button
            onClick={() => saveMutation.mutate(localConsent)}
            disabled={!dirty || saveMutation.isPending}
            className={cn(
              ds.btnPrimary,
              !dirty && 'opacity-50 cursor-not-allowed'
            )}
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saveSuccess ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saveSuccess ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard
          icon={Share2}
          label="DTUs Shared"
          value={stats.dtusShared ?? 0}
          color="text-neon-blue"
        />
        <StatsCard
          icon={TrendingUp}
          label="Total Promotions"
          value={stats.totalPromotes ?? 0}
          color="text-neon-purple"
        />
        <StatsCard
          icon={Sparkles}
          label="Emergent Interactions"
          value={stats.emergentInteractions ?? 0}
          color="text-neon-cyan"
        />
        <StatsCard
          icon={Megaphone}
          label="Feed Posts"
          value={stats.feedPostCount ?? 0}
          color="text-neon-green"
        />
      </div>

      {/* Mutation error banner */}
      <AnimatePresence>
        {saveMutation.isError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2"
          >
            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">
              Failed to save:{' '}
              {saveMutation.error instanceof Error
                ? saveMutation.error.message
                : 'Unknown error'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Consent Categories */}
      <div className="space-y-6">
        {CATEGORIES.map((category, ci) => (
          <motion.div
            key={category.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: ci * 0.06 }}
            className={ds.panel}
          >
            {/* Category header */}
            <div className="flex items-center gap-2 mb-4">
              <category.icon className={cn('w-5 h-5', category.color)} />
              <h2 className={ds.heading3}>{category.title}</h2>
            </div>

            {/* Warning banner for non-revocable */}
            {category.warning && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-300 leading-relaxed">
                  {category.warning}
                </p>
              </div>
            )}

            {/* Toggles */}
            <div className="space-y-1">
              {category.toggles.map((toggle, ti) => {
                const isNonRevocable = NON_REVOCABLE.includes(toggle.key);
                const isSocial = SOCIAL_KEYS.includes(toggle.key);
                const checked = localConsent[toggle.key];

                return (
                  <div
                    key={toggle.key}
                    className={cn(
                      'flex items-center justify-between gap-4 rounded-lg px-4 py-3 transition-colors',
                      'hover:bg-white/[0.03]',
                      isNonRevocable && checked && 'bg-amber-500/5'
                    )}
                    style={{ transitionDelay: `${ti * 30}ms` }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">
                          {toggle.label}
                        </p>
                        {isNonRevocable && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            <Lock className="w-2.5 h-2.5" />
                            Permanent
                          </span>
                        )}
                        {isSocial && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/20 text-gray-400">
                            <Info className="w-2.5 h-2.5" />
                            Beta
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {toggle.description}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={checked}
                      onChange={(v) => handleToggle(toggle.key, v)}
                      disabled={saveMutation.isPending}
                      nonRevocable={isNonRevocable}
                    />
                  </div>
                );
              })}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Privacy Domain Actions */}
      <div className="bg-white/3 border border-white/10 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neon-blue flex items-center gap-2"><Zap className="w-4 h-4" /> Privacy Analysis</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'dataInventory', label: 'Data Inventory' },
            { action: 'consentAudit', label: 'Consent Audit' },
            { action: 'impactAssessment', label: 'Impact Assessment' },
            { action: 'breachResponse', label: 'Breach Response' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handlePrivacyAction(action)} disabled={privacyActiveAction === action || !firstArtifactId}
              className="px-3 py-1.5 text-xs bg-neon-blue/10 border border-neon-blue/20 rounded-lg hover:bg-neon-blue/20 disabled:opacity-50 flex items-center gap-1.5">
              {privacyActiveAction === action ? <div className="w-3 h-3 border border-neon-blue border-t-transparent rounded-full animate-spin" /> : <Shield className="w-3 h-3 text-neon-blue" />}
              {label}
            </button>
          ))}
        </div>
        {privacyActionResult && (
          <div className="p-3 bg-black/30 rounded-lg border border-neon-blue/20 text-xs space-y-2">
            {privacyActionResult.action === 'dataInventory' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Total items: <span className="text-white font-mono">{String(privacyActionResult.totalItems ?? 0)}</span></span>
                  <span className="text-gray-400">Sensitive: <span className={`font-mono ${(privacyActionResult.sensitiveItems as number) > 0 ? 'text-red-400' : 'text-green-400'}`}>{String(privacyActionResult.sensitiveItems ?? 0)}</span></span>
                  <span className="text-gray-400">Risk: <span className={`font-mono ${privacyActionResult.riskLevel === 'high' ? 'text-red-400' : privacyActionResult.riskLevel === 'moderate' ? 'text-yellow-400' : 'text-green-400'}`}>{String(privacyActionResult.riskLevel ?? '')}</span></span>
                  {!!privacyActionResult.gdprRelevant && <span className="text-yellow-400">GDPR relevant</span>}
                </div>
                {Array.isArray(privacyActionResult.recommendations) && <ul className="space-y-0.5">{(privacyActionResult.recommendations as string[]).map((r, i) => <li key={i} className="text-gray-300">• {r}</li>)}</ul>}
              </div>
            )}
            {privacyActionResult.action === 'consentAudit' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Total: <span className="text-white font-mono">{String(privacyActionResult.totalConsents ?? 0)}</span></span>
                  <span className="text-gray-400">Active: <span className="text-green-400 font-mono">{String(privacyActionResult.active ?? 0)}</span></span>
                  <span className="text-gray-400">Expired: <span className="text-red-400 font-mono">{String(privacyActionResult.expired ?? 0)}</span></span>
                  <span className="text-gray-400">Compliance: <span className="text-neon-blue font-mono">{String(privacyActionResult.complianceRate ?? 0)}%</span></span>
                </div>
                {privacyActionResult.action && <p className="text-gray-300">{String(privacyActionResult.action)}</p>}
              </div>
            )}
            {privacyActionResult.action === 'impactAssessment' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Risk: <span className={`font-mono ${privacyActionResult.riskLevel === 'high' ? 'text-red-400' : privacyActionResult.riskLevel === 'moderate' ? 'text-yellow-400' : 'text-green-400'}`}>{String(privacyActionResult.riskLevel ?? '')}</span></span>
                  <span className="text-gray-400">DPIA required: <span className={`${privacyActionResult.dpiaRequired ? 'text-red-400' : 'text-green-400'}`}>{privacyActionResult.dpiaRequired ? 'Yes' : 'No'}</span></span>
                </div>
                {Array.isArray(privacyActionResult.riskFactors) && privacyActionResult.riskFactors.length > 0 && (
                  <div className="flex flex-wrap gap-1">{(privacyActionResult.riskFactors as string[]).map(f => <span key={f} className="px-1.5 py-0.5 bg-red-500/10 text-red-300 rounded">{f}</span>)}</div>
                )}
              </div>
            )}
            {privacyActionResult.action === 'breachResponse' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Severity: <span className={`font-mono ${privacyActionResult.severity === 'high' ? 'text-red-400' : privacyActionResult.severity === 'medium' ? 'text-yellow-400' : 'text-green-400'}`}>{String(privacyActionResult.severity ?? '')}</span></span>
                  <span className="text-gray-400">Affected: <span className="text-white font-mono">{String(privacyActionResult.affectedUsers ?? 0)}</span></span>
                  <span className="text-gray-400">Deadline: <span className="text-neon-blue">{String(privacyActionResult.regulatoryDeadline ?? '')}</span></span>
                </div>
                {Array.isArray(privacyActionResult.priorityActions) && (
                  <div className="space-y-0.5">
                    <p className="text-gray-500 font-semibold">Immediate actions:</p>
                    {(privacyActionResult.priorityActions as string[]).map((a, i) => <p key={i} className="text-gray-300">• {a}</p>)}
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setPrivacyActionResult(null)} className="text-gray-600 hover:text-gray-400 text-xs flex items-center gap-1"><X className="w-3 h-3" /> Dismiss</button>
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="flex items-start gap-2 pt-2 pb-4">
        <Eye className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
        <p className="text-xs text-gray-500 leading-relaxed">
          Your privacy settings are encrypted and stored securely. Changes take
          effect immediately after saving. Non-revocable actions cannot be undone
          once granted. Social DM settings are in beta and may not be fully
          operational yet.
        </p>
      </div>

      {/* Confirmation modal for non-revocable toggles */}
      <AnimatePresence>
        <ConfirmModal
          open={!!confirmModal}
          title="Permanent Action"
          message={`You are about to enable "${
            confirmModal
              ? CATEGORIES.flatMap((c) => c.toggles).find(
                  (t) => t.key === confirmModal.key
                )?.label
              : ''
          }". This action is non-revocable and cannot be undone. Are you sure you want to proceed?`}
          confirmLabel="Enable Permanently"
          onConfirm={handleConfirmNonRevocable}
          onCancel={() => setConfirmModal(null)}
        />
      </AnimatePresence>
    </div>
  );
}
