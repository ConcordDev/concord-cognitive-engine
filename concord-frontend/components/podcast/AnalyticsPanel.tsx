'use client';

/**
 * AnalyticsPanel — plays / subscribers / top episodes + DTU overview.
 * Extracted from former podcast/page.tsx Analytics tab. Publishes a real
 * DTU id (not an episode id) via useLensDTUs.publishToMarketplace.
 */

import { useCallback, useMemo, useState } from 'react';
import { Mic2, Headphones, Users, Clock, Rss } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useMyPodcastShow } from './useMyPodcastShow';
import { formatDuration } from './types';

export function AnalyticsPanel() {
  const { episodes, subscriberCount } = useMyPodcastShow();
  const { insights: realtimeInsights } = useRealtimeLens('podcast');
  const {
    contextDTUs, hyperDTUs, megaDTUs, regularDTUs,
    publishToMarketplace, isLoading: dtusLoading,
  } = useLensDTUs({ lens: 'podcast' });
  const [publishingDtu, setPublishingDtu] = useState(false);

  const analytics = useMemo(() => {
    const totalPlays = episodes.reduce((sum, e) => sum + (e.playCount || 0), 0);
    const totalEpisodes = episodes.length;
    const publishedEpisodes = episodes.filter((e) => e.status === 'published').length;
    const totalDuration = episodes.reduce((sum, e) => sum + (e.durationSec || 0), 0);
    return { totalPlays, totalEpisodes, publishedEpisodes, totalDuration, subscriberCount };
  }, [episodes, subscriberCount]);

  const publishableDtuId = regularDTUs[0]?.id ?? contextDTUs[0]?.id ?? null;
  const handlePublishDtu = useCallback(async () => {
    if (!publishableDtuId) return;
    setPublishingDtu(true);
    try {
      await publishToMarketplace({ dtuId: publishableDtuId });
      showToast('success', 'Published to marketplace');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishingDtu(false);
    }
  }, [publishableDtuId, publishToMarketplace]);

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Plays', value: analytics.totalPlays, icon: <Headphones className="w-5 h-5" />, color: 'text-neon-cyan' },
          { label: 'Subscribers', value: analytics.subscriberCount, icon: <Users className="w-5 h-5" />, color: 'text-purple-400' },
          { label: 'Episodes', value: `${analytics.publishedEpisodes}/${analytics.totalEpisodes}`, icon: <Mic2 className="w-5 h-5" />, color: 'text-neon-green' },
          { label: 'Total Duration', value: formatDuration(analytics.totalDuration), icon: <Clock className="w-5 h-5" />, color: 'text-orange-400' },
        ].map((stat) => (
          <div key={stat.label} className="p-4 bg-white/5 rounded-xl border border-white/5">
            <div className={cn('mb-2', stat.color)}>{stat.icon}</div>
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Top Episodes</h3>
      <div className="space-y-2">
        {[...episodes]
          .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
          .slice(0, 10)
          .map((ep, i) => (
            <div key={ep.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-lg">
              <span className="text-xs text-gray-400 w-5 text-right font-mono">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{ep.title}</p>
                <p className="text-xs text-gray-400">S{ep.seasonNumber || 1}E{ep.episodeNumber || 1}</p>
              </div>
              <span className="text-xs text-gray-400">{ep.playCount || 0} plays</span>
            </div>
          ))}
      </div>

      {!dtusLoading && (contextDTUs.length > 0 || regularDTUs.length > 0 || hyperDTUs.length > 0 || megaDTUs.length > 0) && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Data Transfer Units</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {contextDTUs.length > 0 && (
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-xs text-gray-400">Context DTUs</p>
                <p className="text-xl font-bold text-neon-cyan">{contextDTUs.length}</p>
              </div>
            )}
            {regularDTUs.length > 0 && (
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-xs text-gray-400">Regular DTUs</p>
                <p className="text-xl font-bold text-purple-400">{regularDTUs.length}</p>
              </div>
            )}
            {hyperDTUs.length > 0 && (
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-xs text-gray-400">Hyper DTUs</p>
                <p className="text-xl font-bold text-neon-pink">{hyperDTUs.length}</p>
              </div>
            )}
            {megaDTUs.length > 0 && (
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-xs text-gray-400">Mega DTUs</p>
                <p className="text-xl font-bold text-neon-green">{megaDTUs.length}</p>
              </div>
            )}
          </div>
          {publishableDtuId && (
            <button
              onClick={handlePublishDtu}
              disabled={publishingDtu}
              className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-400/10 text-purple-400 text-sm hover:bg-purple-400/20 disabled:opacity-40 transition-colors"
            >
              <Rss className="w-4 h-4" /> {publishingDtu ? 'Publishing…' : 'Publish to Marketplace'}
            </button>
          )}
        </div>
      )}
      {dtusLoading && (
        <div className="mt-6 flex items-center gap-2 text-gray-400 text-sm">
          <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          Loading DTUs...
        </div>
      )}

      {realtimeInsights.length > 0 && (
        <RealtimeDataPanel data={null} insights={realtimeInsights} />
      )}
    </div>
  );
}

export default AnalyticsPanel;
