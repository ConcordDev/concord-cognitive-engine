'use client';

/**
 * ConnectiveTissueBar — Universal action bar for lens economy integration.
 *
 * Provides: CC tip button, DTU publish, bounty post, fork, CRETI badge,
 * merit credit display, and search. Drop into any lens page.
 */

import { useState } from 'react';
import {
  Coins, Gift, Search, GitFork, Award, Upload,
  X, Sparkles, Target, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useTip, useCreateDTU, usePostBounty, useForkDTU,
  useMeritCredit, useDTUSearch,
} from '@/hooks/useConnectiveTissue';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';

interface ConnectiveTissueBarProps {
  lensId: string;
  userId?: string;
  className?: string;
}

export function ConnectiveTissueBar({ lensId, userId, className }: ConnectiveTissueBarProps) {
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [tipAmount, setTipAmount] = useState('1');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDtuId, setSelectedDtuId] = useState<string | null>(null);

  const tipMutation = useTip();
  const createDTUMutation = useCreateDTU();
  const postBountyMutation = usePostBounty();
  const forkMutation = useForkDTU();
  const { data: searchData } = useDTUSearch({ query: searchQuery, lensId });
  const { data: meritData } = useMeritCredit(userId || '');

  const togglePanel = (panel: string) => {
    setActivePanel(prev => prev === panel ? null : panel);
  };

  return (
    <div className={cn("border-t border-white/10 bg-black/20", className)}>
      {/* Action Buttons */}
      <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto">
        <ActionButton
          icon={Coins}
          label="Tip"
          color="text-neon-green"
          active={activePanel === 'tip'}
          onClick={() => togglePanel('tip')}
        />
        <ActionButton
          icon={Upload}
          label="Publish DTU"
          color="text-neon-cyan"
          active={activePanel === 'publish'}
          onClick={() => togglePanel('publish')}
        />
        <ActionButton
          icon={Gift}
          label="Bounty"
          color="text-neon-purple"
          active={activePanel === 'bounty'}
          onClick={() => togglePanel('bounty')}
        />
        <ActionButton
          icon={GitFork}
          label="Fork"
          color="text-yellow-400"
          active={activePanel === 'fork'}
          onClick={() => togglePanel('fork')}
        />
        <ActionButton
          icon={Search}
          label="Search"
          color="text-blue-400"
          active={activePanel === 'search'}
          onClick={() => togglePanel('search')}
        />
        {userId && meritData?.data?.total !== undefined && (
          <div className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 text-xs">
            <Award className="w-3.5 h-3.5 text-neon-green" />
            <span className="text-gray-400">Merit:</span>
            <span className="text-neon-green font-mono">{meritData.data.total}</span>
          </div>
        )}
      </div>

      {/* Expandable Panels */}
      {activePanel === 'tip' && (
        <Panel title="Tip with CC" onClose={() => setActivePanel(null)}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={tipAmount}
              onChange={e => setTipAmount(e.target.value)}
              className="w-24 px-2 py-1 bg-black/40 border border-white/10 rounded text-sm text-white"
              placeholder="Amount"
            />
            <span className="text-xs text-gray-400">CC</span>
            <button
              onClick={() => {
                if (!userId) return;
                tipMutation.mutate({
                  tipperId: userId,
                  creatorId: 'target_creator', // Would be populated by context
                  contentId: 'target_content',
                  lensId,
                  amount: parseFloat(tipAmount),
                });
              }}
              disabled={tipMutation.isPending}
              className="px-3 py-1 bg-neon-green/20 text-neon-green rounded text-sm hover:bg-neon-green/30 transition"
            >
              {tipMutation.isPending ? 'Sending...' : 'Send Tip'}
            </button>
          </div>
        </Panel>
      )}

      {activePanel === 'publish' && (
        <Panel title="Publish as DTU" onClose={() => setActivePanel(null)}>
          <p className="text-xs text-gray-400 mb-2">
            Turn any content into a sellable, citable, forkable DTU with one click.
          </p>
          <div className="flex items-center gap-2 text-xs">
            <Sparkles className="w-4 h-4 text-neon-cyan" />
            <span className="text-gray-300">CRETI scoring applied automatically</span>
          </div>
          <div className="flex items-center gap-2 text-xs mt-1">
            <Target className="w-4 h-4 text-neon-purple" />
            <span className="text-gray-300">95% creator share on all sales</span>
          </div>
          <button
            onClick={() => {
              if (!userId) return;
              createDTUMutation.mutate({
                lensId,
                creatorId: userId,
                title: 'New DTU',
                content: 'New DTU',
              });
            }}
            disabled={createDTUMutation.isPending}
            className="mt-2 px-3 py-1 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 transition"
          >
            {createDTUMutation.isPending ? 'Publishing...' : 'Publish'}
          </button>
        </Panel>
      )}

      {activePanel === 'bounty' && (
        <Panel title="Post a Bounty" onClose={() => setActivePanel(null)}>
          <p className="text-xs text-gray-400 mb-2">
            Escrow CC for someone to solve your problem. Answer becomes a sellable DTU.
          </p>
          <BountyForm lensId={lensId} userId={userId} postBountyMutation={postBountyMutation} />
        </Panel>
      )}

      {activePanel === 'search' && (
        <Panel title="Search DTUs" onClose={() => setActivePanel(null)}>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 px-2 py-1 bg-black/40 border border-white/10 rounded text-sm text-white"
              placeholder="Search across all lenses..."
            />
          </div>
          {searchData?.data?.results && searchData.data.results.length > 0 ? (
            <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
              {searchData.data.results.map((r: { id: string; title?: string; score?: number }) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedDtuId(r.id)}
                  className="w-full text-xs text-gray-300 flex items-center justify-between p-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <span className="truncate text-neon-cyan">{r.title || r.id}</span>
                  <span className="flex items-center gap-1 flex-shrink-0 ml-2">
                    {r.score !== undefined && <span className="text-gray-500">{r.score.toFixed(2)}</span>}
                    <ExternalLink className="w-3 h-3 text-gray-500" />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 mt-1">
              Results ranked by CRETI score. Filter by lens, tier, or price.
            </p>
          )}
        </Panel>
      )}

      {activePanel === 'fork' && (
        <Panel title="Fork a DTU" onClose={() => setActivePanel(null)}>
          <p className="text-xs text-gray-400">
            Create a derivative work. The original creator automatically earns
            royalties from all sales of your fork.
          </p>
          <button
            onClick={() => {
              forkMutation.mutate({ forkerId: userId || 'anonymous', originalDtuId: 'target_dtu', lensId });
            }}
            disabled={forkMutation.isPending}
            className="mt-2 px-3 py-1 bg-yellow-400/20 text-yellow-400 rounded text-sm hover:bg-yellow-400/30 transition"
          >
            {forkMutation.isPending ? 'Forking...' : 'Fork Selected DTU'}
          </button>
        </Panel>
      )}

      {/* DTU Detail View modal */}
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
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors",
        active
          ? "bg-white/10 text-white"
          : "text-gray-400 hover:text-white hover:bg-white/5"
      )}
    >
      <Icon className={cn("w-3.5 h-3.5", color)} />
      <span>{label}</span>
    </button>
  );
}

function BountyForm({ lensId, userId, postBountyMutation }: { lensId: string; userId?: string; postBountyMutation: ReturnType<typeof usePostBounty> }) {
  const [bountyDesc, setBountyDesc] = useState('');
  const [bountyAmount, setBountyAmount] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={bountyDesc}
          onChange={e => setBountyDesc(e.target.value)}
          className="flex-1 px-2 py-1 bg-black/40 border border-white/10 rounded text-sm text-white"
          placeholder="What do you need?"
        />
        <input
          type="number"
          min="1"
          value={bountyAmount}
          onChange={e => setBountyAmount(e.target.value)}
          className="w-20 px-2 py-1 bg-black/40 border border-white/10 rounded text-sm text-white"
          placeholder="CC"
        />
      </div>
      <button
        onClick={() => {
          if (!bountyDesc.trim() || !userId) return;
          postBountyMutation.mutate({
            lensId,
            posterId: userId || 'anonymous',
            title: bountyDesc.trim().slice(0, 60),
            description: bountyDesc.trim(),
            amount: parseFloat(bountyAmount) || 1,
          });
          setBountyDesc('');
          setBountyAmount('');
        }}
        disabled={postBountyMutation.isPending || !bountyDesc.trim()}
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
        <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}
