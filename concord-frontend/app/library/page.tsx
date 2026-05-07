'use client';

import { useState } from 'react';
import { Globe, Search, Download, Upload, Tag, Shield, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGlobalBrowse } from '@/lib/hooks/use-global-browse';

const DOMAINS = [
  'all', 'ai', 'math', 'physics', 'code', 'research', 'healthcare', 'finance',
  'legal', 'education', 'creative', 'music', 'art', 'engineering',
  'philosophy', 'science', 'ethics', 'quantum',
];

const TIER_COLORS: Record<string, string> = {
  canonical: 'bg-neon-green/15 text-neon-green border-neon-green/30',
  verified: 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/30',
  community: 'bg-neon-blue/15 text-neon-blue border-neon-blue/30',
  draft: 'bg-neon-purple/15 text-neon-purple border-neon-purple/30',
};

export default function LibraryPage() {
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState('all');
  const [page, setPage] = useState(1);
  const [domainOpen, setDomainOpen] = useState(false);

  const {
    dtus,
    total,
    hasMore,
    isLoading,
    syncToUniverse,
    submitToCouncil,
  } = useGlobalBrowse({
    domain: domain === 'all' ? undefined : domain,
    search: search || undefined,
    page,
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  return (
    <div className="min-h-screen bg-dark-950 text-gray-100">
      {/* Background glow effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-20 left-1/3 w-[500px] h-[500px] bg-neon-cyan/5 rounded-full blur-3xl" />
        <div className="absolute bottom-40 right-1/4 w-[400px] h-[400px] bg-neon-purple/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Globe className="w-8 h-8 text-neon-cyan" />
            <h1 className="text-3xl font-bold text-white">Global Sacred Timeline</h1>
          </div>
          <p className="text-gray-400 text-lg">
            Browse canonical knowledge units from the global lattice. Sync DTUs to your universe or submit them for Council review.
          </p>
          {!isLoading && (
            <p className="text-gray-500 text-sm mt-1">
              {total.toLocaleString()} DTUs available
            </p>
          )}
        </div>

        {/* Search & Filters */}
        <form onSubmit={handleSearch} className="mb-8">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search DTUs by title, tag, or content..."
                className={cn(
                  'w-full pl-11 pr-4 py-3 rounded-lg',
                  'bg-dark-800/50 backdrop-blur-sm border border-dark-700',
                  'text-gray-100 placeholder-gray-500',
                  'focus:outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/25',
                  'transition-colors'
                )}
              />
            </div>

            {/* Domain filter dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setDomainOpen(!domainOpen)}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 rounded-lg min-w-[180px]',
                  'bg-dark-800/50 backdrop-blur-sm border border-dark-700',
                  'text-gray-100 hover:border-dark-600 transition-colors',
                  domainOpen && 'border-neon-cyan/50'
                )}
              >
                <Tag className="w-4 h-4 text-gray-400" />
                <span className="flex-1 text-left capitalize">
                  {domain === 'all' ? 'All Domains' : domain}
                </span>
                <ChevronDown className={cn(
                  'w-4 h-4 text-gray-400 transition-transform',
                  domainOpen && 'rotate-180'
                )} />
              </button>

              {domainOpen && (
                <div className={cn(
                  'absolute top-full mt-1 left-0 right-0 z-20',
                  'bg-dark-800 border border-dark-700 rounded-lg shadow-xl',
                  'max-h-60 overflow-y-auto'
                )}>
                  {DOMAINS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setDomain(d);
                        setDomainOpen(false);
                        setPage(1);
                      }}
                      className={cn(
                        'w-full text-left px-4 py-2 text-sm capitalize',
                        'hover:bg-dark-700 transition-colors',
                        d === domain ? 'text-neon-cyan' : 'text-gray-300'
                      )}
                    >
                      {d === 'all' ? 'All Domains' : d}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Search button */}
            <button
              type="submit"
              className={cn(
                'px-6 py-3 rounded-lg font-medium',
                'bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan',
                'hover:bg-neon-cyan/20 hover:border-neon-cyan/50',
                'transition-colors'
              )}
            >
              Search
            </button>
          </div>
        </form>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center space-y-4">
              <div className="w-12 h-12 border-4 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-gray-400">Browsing the Sacred Timeline...</p>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && dtus.length === 0 && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center space-y-3">
              <Globe className="w-12 h-12 text-gray-600 mx-auto" />
              <h3 className="text-xl font-semibold text-gray-300">No DTUs found</h3>
              <p className="text-gray-500">
                Try adjusting your search or filters to find what you&apos;re looking for.
              </p>
            </div>
          </div>
        )}

        {/* DTU grid */}
        {!isLoading && dtus.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {dtus.map((dtu) => (
              <div
                key={dtu.id}
                className={cn(
                  'group rounded-xl p-5',
                  'bg-dark-800/50 backdrop-blur-sm border border-dark-700',
                  'hover:border-neon-cyan/30 transition-all duration-200',
                  'flex flex-col'
                )}
              >
                {/* Card header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h3 className="text-white font-semibold leading-snug line-clamp-2 flex-1">
                    {dtu.title}
                  </h3>
                  <div className="flex items-center gap-1 shrink-0">
                    <Shield className="w-3.5 h-3.5 text-neon-cyan" />
                    <span className="text-sm font-mono text-neon-cyan">
                      {dtu.authority.score.toFixed(1)}
                    </span>
                  </div>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className={cn(
                    'px-2 py-0.5 rounded-full text-xs font-medium border capitalize',
                    TIER_COLORS[dtu.tier] ?? 'bg-dark-700 text-gray-400 border-dark-600'
                  )}>
                    {dtu.tier}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-dark-700 text-gray-300 border border-dark-600 capitalize">
                    {dtu.domain}
                  </span>
                </div>

                {/* Tags */}
                {dtu.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {dtu.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded text-xs bg-dark-900/80 text-gray-400 border border-dark-700"
                      >
                        {tag}
                      </span>
                    ))}
                    {dtu.tags.length > 5 && (
                      <span className="px-2 py-0.5 rounded text-xs text-gray-500">
                        +{dtu.tags.length - 5}
                      </span>
                    )}
                  </div>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Actions */}
                <div className="flex gap-2 mt-2 pt-3 border-t border-dark-700">
                  <button
                    onClick={() => syncToUniverse.mutate([dtu.id])}
                    disabled={syncToUniverse.isPending}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium',
                      'bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan',
                      'hover:bg-neon-cyan/20 hover:border-neon-cyan/50',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                      'transition-colors'
                    )}
                  >
                    <Download className="w-4 h-4" />
                    Sync
                  </button>
                  <button
                    onClick={() => submitToCouncil.mutate({ dtuId: dtu.id })}
                    disabled={submitToCouncil.isPending}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium',
                      'bg-neon-purple/10 border border-neon-purple/30 text-neon-purple',
                      'hover:bg-neon-purple/20 hover:border-neon-purple/50',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                      'transition-colors'
                    )}
                  >
                    <Upload className="w-4 h-4" />
                    Council
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load more */}
        {!isLoading && hasMore && (
          <div className="flex justify-center mt-8">
            <button
              onClick={() => setPage((p) => p + 1)}
              className={cn(
                'px-8 py-3 rounded-lg font-medium',
                'bg-dark-800/50 backdrop-blur-sm border border-dark-700',
                'text-gray-300 hover:text-white hover:border-neon-cyan/30',
                'transition-colors'
              )}
            >
              Load More
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
