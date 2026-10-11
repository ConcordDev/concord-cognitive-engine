'use client';

/**
 * ConnectiveTissueBar — actions that are real for this lens.
 *
 * The signed-in user comes from the session (useAuth), never a prop.
 * Publish runs only when the host supplies getPublishable() and writes a
 * private DTU from that payload. Tip and Fork render only when the host
 * passes a concrete target. Search and bounty stay, and they report
 * failure instead of pretending the action landed.
 */

import { useState } from 'react';
import {
  Coins, Gift, Search, GitFork, Award, Upload,
  X, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useTip, usePostBounty, useForkDTU,
  useMeritCredit, useDTUSearch,
} from '@/hooks/useConnectiveTissue';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import { useAuth } from '@/hooks/useAuth';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { isConcreteId } from '@/components/lens/concreteId';

export interface Publishable {
  title: string;
  content: string;
}

export interface TipTarget {
  creatorId: string;
  contentId: string;
  contentType?: string;
}

export interface ForkTarget {
  dtuId: string;
}

interface ConnectiveTissueBarProps {
  lensId: string;
  className?: string;
  /** Called at click time. Omit it and Publish is not rendered. */
  getPublishable?: () => Publishable | null | Promise<Publishable | null>;
  tipTarget?: TipTarget | null;
  forkTarget?: ForkTarget | null;
}

export function ConnectiveTissueBar({
  lensId,
  className,
  getPublishable,
  tipTarget,
  forkTarget,
}: ConnectiveTissueBarProps) {
  const { user, isLoading: authLoading } = useAuth();
  const addToast = useUIStore((s) => s.addToast);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [tipAmount, setTipAmount] = useState('1');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDtuId, setSelectedDtuId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const tipMutation = useTip();
  const postBountyMutation = usePostBounty();
  const forkMutation = useForkDTU();
  const { data: searchData } = useDTUSearch({ query: searchQuery, lensId });
  const { data: meritData } = useMeritCredit(user?.id || '');

  const showTip = isConcreteId(tipTarget?.creatorId) && isConcreteId(tipTarget?.contentId);
  const showFork = isConcreteId(forkTarget?.dtuId);
  const showPublish = typeof getPublishable === 'function';

  const togglePanel = (panel: string) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  async function publish() {
    if (!getPublishable || publishing) return;
    if (authLoading) return;
    if (!user?.id) {
      addToast({ type: 'error', message: 'Sign in to publish a DTU.' });
      return;
    }
    let payload: Publishable | null;
    try {
      payload = await getPublishable();
    } catch {
      addToast({ type: 'error', message: 'Could not read this page to publish.' });
      return;
    }
    const title = payload?.title?.trim() ?? '';
    const content = payload?.content ?? '';
    if (!title || !content.trim()) {
      addToast({ type: 'error', message: 'Nothing to publish yet.' });
      return;
    }
    setPublishing(true);
    try {
      const created = await lensRun<{ ok?: boolean; dtu?: { id?: string; content?: string }; error?: string }>(
        'dtu',
        'create',
        withContentLicense({
          title,
          content,
          source: 'lens',
          domain: lensId,
          lens: lensId,
          visibility: 'private',
          human: { summary: content.slice(0, 320) },
          tags: [lensId],
          consent: {
            publishToMarketplace: false,
            shareToFeed: false,
            allowCitations: false,
            allowAiTraining: false,
          },
          meta: {
            visibility: 'private',
            lens: lensId,
            consent: { allowCitations: false },
          },
        }, 'knowledge', ['private']),
      );
      if (!created.data.ok) {
        addToast({ type: 'error', message: created.data.error || 'Publish failed.' });
        return;
      }
      const id = created.data.result?.dtu?.id;
      if (!id) {
        addToast({ type: 'error', message: 'Publish did not return a DTU.' });
        return;
      }
      const read = await lensRun<{ dtu?: { id?: string; content?: string } }>('dtu', 'get', { id });
      const stored = read.data.ok ? read.data.result?.dtu?.content : undefined;
      if (stored !== content) {
        addToast({
          type: 'error',
          message: `DTU ${id} was saved, but its content did not match this page.`,
        });
        return;
      }
      addToast({
        type: 'success',
        message: `Private DTU ${id}`,
        href: `/dtu/${encodeURIComponent(id)}`,
        linkLabel: 'Open',
        duration: 8000,
      });
      setActivePanel(null);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className={cn('border-t border-white/10 bg-black/20', className)}>
      <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto">
        {showTip && (
          <ActionButton
            icon={Coins}
            label="Tip"
            color="text-neon-green"
            active={activePanel === 'tip'}
            onClick={() => togglePanel('tip')}
          />
        )}
        {showPublish && (
          <ActionButton
            icon={Upload}
            label="Publish DTU"
            color="text-neon-cyan"
            active={activePanel === 'publish'}
            onClick={() => togglePanel('publish')}
          />
        )}
        <ActionButton
          icon={Gift}
          label="Bounty"
          color="text-neon-purple"
          active={activePanel === 'bounty'}
          onClick={() => togglePanel('bounty')}
        />
        {showFork && (
          <ActionButton
            icon={GitFork}
            label="Fork"
            color="text-yellow-400"
            active={activePanel === 'fork'}
            onClick={() => togglePanel('fork')}
          />
        )}
        <ActionButton
          icon={Search}
          label="Search"
          color="text-blue-400"
          active={activePanel === 'search'}
          onClick={() => togglePanel('search')}
        />
        {user?.id && meritData?.data?.total !== undefined && (
          <div className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 text-xs">
            <Award className="w-3.5 h-3.5 text-neon-green" />
            <span className="text-gray-400">Merit:</span>
            <span className="text-neon-green font-mono">{meritData.data.total}</span>
          </div>
        )}
      </div>

      {showTip && activePanel === 'tip' && tipTarget && (
        <Panel title="Tip with CC" onClose={() => setActivePanel(null)}>
          {!user?.id ? (
            <p className="text-xs text-gray-400">Sign in to send a tip.</p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={tipAmount}
                onChange={(e) => setTipAmount(e.target.value)}
                className="w-24 px-2 py-1 bg-black/40 border border-white/10 rounded text-sm text-white"
                placeholder="Amount"
              />
              <span className="text-xs text-gray-400">CC</span>
              <button
                type="button"
                onClick={() => {
                  const amount = Number(tipAmount);
                  if (!Number.isFinite(amount) || amount <= 0) {
                    addToast({ type: 'error', message: 'Enter a tip amount greater than zero.' });
                    return;
                  }
                  tipMutation.mutate(
                    {
                      tipperId: user.id,
                      creatorId: tipTarget.creatorId,
                      contentId: tipTarget.contentId,
                      contentType: tipTarget.contentType || 'dtu',
                      lensId,
                      amount,
                    },
                    {
                      onSuccess: (res) => {
                        const data = (res as { data?: { ok?: boolean; error?: string } })?.data;
                        if (data?.ok === false || data?.error) {
                          addToast({ type: 'error', message: data.error || 'Tip was not sent.' });
                          return;
                        }
                        addToast({ type: 'success', message: `Tipped ${amount} CC.` });
                      },
                      onError: (err) => {
                        addToast({ type: 'error', message: err instanceof Error ? err.message : 'Tip was not sent.' });
                      },
                    },
                  );
                }}
                disabled={tipMutation.isPending}
                className="px-3 py-1 bg-neon-green/20 text-neon-green rounded text-sm hover:bg-neon-green/30 transition"
              >
                {tipMutation.isPending ? 'Sending...' : 'Send Tip'}
              </button>
            </div>
          )}
        </Panel>
      )}

      {showPublish && activePanel === 'publish' && (
        <Panel title="Publish as a private DTU" onClose={() => setActivePanel(null)}>
          <p className="text-xs text-gray-400">
            Saves the current document on your account. It is not listed for sale.
          </p>
          <button
            type="button"
            onClick={() => { void publish(); }}
            disabled={publishing || authLoading}
            className="mt-2 px-3 py-1 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 transition disabled:opacity-50"
          >
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </Panel>
      )}

      {activePanel === 'bounty' && (
        <Panel title="Post a Bounty" onClose={() => setActivePanel(null)}>
          {!user?.id ? (
            <p className="text-xs text-gray-400">Sign in to post a bounty. CC is escrowed from your balance.</p>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-2">
                Escrow CC from your balance. The answer is stored as a DTU when someone claims it.
              </p>
              <BountyForm lensId={lensId} userId={user.id} postBountyMutation={postBountyMutation} />
            </>
          )}
        </Panel>
      )}

      {activePanel === 'search' && (
        <Panel title="Search DTUs" onClose={() => setActivePanel(null)}>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-2 py-1 bg-black/40 border border-white/10 rounded text-sm text-white"
              placeholder={`Search ${lensId} DTUs`}
            />
          </div>
          {searchData?.data?.results && searchData.data.results.length > 0 ? (
            <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
              {searchData.data.results.map((r: { id: string; title?: string; score?: number }) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedDtuId(r.id)}
                  className="w-full text-xs text-gray-300 flex items-center justify-between p-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <span className="truncate text-neon-cyan">{r.title || r.id}</span>
                  <span className="flex items-center gap-1 flex-shrink-0 ml-2">
                    {r.score !== undefined && <span className="text-gray-400">{r.score.toFixed(2)}</span>}
                    <ExternalLink className="w-3 h-3 text-gray-400" />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 mt-1">
              {searchQuery.trim() ? 'No DTUs matched that search.' : 'Type to search DTUs in this lens.'}
            </p>
          )}
        </Panel>
      )}

      {showFork && activePanel === 'fork' && forkTarget && (
        <Panel title="Fork a DTU" onClose={() => setActivePanel(null)}>
          {!user?.id ? (
            <p className="text-xs text-gray-400">Sign in to fork this DTU.</p>
          ) : (
            <>
              <p className="text-xs text-gray-400">
                Forks {forkTarget.dtuId}. Royalties follow the original when a sale happens.
              </p>
              <button
                type="button"
                onClick={() => {
                  forkMutation.mutate(
                    { forkerId: user.id, originalDtuId: forkTarget.dtuId, lensId },
                    {
                      onSuccess: (res) => {
                        const data = (res as { data?: { ok?: boolean; error?: string; dtu?: { id?: string } } })?.data;
                        if (data?.ok === false || data?.error) {
                          addToast({ type: 'error', message: data.error || 'Fork failed.' });
                          return;
                        }
                        const id = data?.dtu?.id;
                        addToast({
                          type: 'success',
                          message: id ? `Forked as ${id}` : 'Fork created.',
                          ...(id ? { href: `/dtu/${encodeURIComponent(id)}`, linkLabel: 'Open' } : {}),
                        });
                      },
                      onError: (err) => {
                        addToast({ type: 'error', message: err instanceof Error ? err.message : 'Fork failed.' });
                      },
                    },
                  );
                }}
                disabled={forkMutation.isPending}
                className="mt-2 px-3 py-1 bg-yellow-400/20 text-yellow-400 rounded text-sm hover:bg-yellow-400/30 transition"
              >
                {forkMutation.isPending ? 'Forking...' : 'Fork this DTU'}
              </button>
            </>
          )}
        </Panel>
      )}

      {selectedDtuId && (
        <DTUDetailView
          dtuId={selectedDtuId}
          onClose={() => setSelectedDtuId(null)}
          onNavigate={(id) => setSelectedDtuId(id)}
        />
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  color,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors',
        active
          ? 'bg-white/10 text-white'
          : 'text-gray-400 hover:text-white hover:bg-white/5',
      )}
    >
      <Icon className={cn('w-3.5 h-3.5', color)} />
      <span>{label}</span>
    </button>
  );
}

function BountyForm({
  lensId,
  userId,
  postBountyMutation,
}: {
  lensId: string;
  userId: string;
  postBountyMutation: ReturnType<typeof usePostBounty>;
}) {
  const addToast = useUIStore((s) => s.addToast);
  const [bountyDesc, setBountyDesc] = useState('');
  const [bountyAmount, setBountyAmount] = useState('');
  const amount = Number(bountyAmount);
  const amountOk = Number.isFinite(amount) && amount > 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={bountyDesc}
          onChange={(e) => setBountyDesc(e.target.value)}
          className="flex-1 px-2 py-1 bg-black/40 border border-white/10 rounded text-sm text-white"
          placeholder="What do you need?"
        />
        <input
          type="number"
          min="1"
          value={bountyAmount}
          onChange={(e) => setBountyAmount(e.target.value)}
          className="w-20 px-2 py-1 bg-black/40 border border-white/10 rounded text-sm text-white"
          placeholder="CC"
        />
      </div>
      <button
        type="button"
        onClick={() => {
          const description = bountyDesc.trim();
          if (!description || !amountOk) return;
          postBountyMutation.mutate(
            {
              lensId,
              posterId: userId,
              title: description.slice(0, 60),
              description,
              amount,
            },
            {
              onSuccess: (res) => {
                const data = (res as { data?: { ok?: boolean; error?: string } })?.data;
                if (data?.ok === false || data?.error) {
                  addToast({ type: 'error', message: data.error || 'Bounty was not posted.' });
                  return;
                }
                setBountyDesc('');
                setBountyAmount('');
                addToast({ type: 'success', message: 'Bounty posted. CC is in escrow.' });
              },
              onError: (err) => {
                addToast({ type: 'error', message: err instanceof Error ? err.message : 'Bounty was not posted.' });
              },
            },
          );
        }}
        disabled={postBountyMutation.isPending || !bountyDesc.trim() || !amountOk}
        className="px-3 py-1 bg-neon-purple/20 text-neon-purple rounded text-sm hover:bg-neon-purple/30 transition disabled:opacity-50"
      >
        {postBountyMutation.isPending ? 'Posting...' : 'Post Bounty'}
      </button>
    </div>
  );
}

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 pb-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-white">{title}</h4>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}
