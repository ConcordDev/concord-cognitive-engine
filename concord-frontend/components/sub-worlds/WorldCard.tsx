'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Users, Star, Eye, Lock, Globe, EyeOff, Boxes, Pause, Play } from 'lucide-react';

export interface SubWorld {
  world_id: string;
  forge_app_dtu_id: string | null;
  name: string;
  description: string;
  thumbnail: string;
  kind: string;
  privacy: string;
  status: string;
  capacity: number;
  spawned_by_user_id: string;
  spawned_at: number;
  updated_at: number;
  visits: number;
  unique_visitors: number;
  favorites: number;
  editors: string[];
  popularity: number;
  is_owner: boolean;
  can_edit: boolean;
}

const PRIVACY_ICON: Record<string, any> = {
  public: Globe,
  unlisted: EyeOff,
  private: Lock,
};

const KIND_LABEL: Record<string, string> = {
  physics_simulator: 'Physics Sim',
  research_zone: 'Research Zone',
  concord_substrate: 'Substrate',
};

export function WorldCard({
  world,
  favorited,
  onVisit,
  onFavorite,
  onManage,
  onEdit,
}: {
  world: SubWorld;
  favorited: boolean;
  onVisit: () => void;
  onFavorite: () => void;
  onManage?: () => void;
  onEdit?: () => void;
}) {
  const PrivIcon = PRIVACY_ICON[world.privacy] || Globe;
  const archived = world.status === 'archived';
  const paused = world.status === 'paused';

  return (
    <div className="flex flex-col rounded-xl border border-zinc-700/60 bg-zinc-900/80 overflow-hidden">
      <div className="relative h-28 bg-gradient-to-br from-cyan-900/50 to-fuchsia-900/40 flex items-center justify-center">
        {world.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={world.thumbnail} alt={world.name} className="h-full w-full object-cover" />
        ) : (
          <Boxes className="h-10 w-10 text-cyan-400/40" />
        )}
        <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-200">
          <PrivIcon className="h-3 w-3" />
          {world.privacy}
        </span>
        {(paused || archived) && (
          <span className="absolute top-1.5 right-1.5 rounded bg-amber-900/80 px-1.5 py-0.5 text-[10px] text-amber-200">
            {world.status}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3 gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-100 truncate">{world.name}</p>
          <p className="text-[10px] text-zinc-400 font-mono">
            {KIND_LABEL[world.kind] || world.kind} · by {world.spawned_by_user_id.slice(0, 8)}
          </p>
        </div>
        {world.description && (
          <p className="text-[11px] text-zinc-400 line-clamp-2">{world.description}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
          <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" />{world.visits}</span>
          <span className="flex items-center gap-0.5"><Users className="h-3 w-3" />{world.unique_visitors}</span>
          <span className="flex items-center gap-0.5"><Star className="h-3 w-3" />{world.favorites}</span>
          <span className="text-cyan-400/70">★{world.popularity}</span>
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={onVisit}
            disabled={archived}
            className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <Play className="h-3 w-3" /> Enter
          </button>
          <button
            type="button"
            onClick={onFavorite}
            aria-label={favorited ? 'Unfavorite' : 'Favorite'}
            className={`rounded-lg border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500 ${
              favorited
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-amber-300'
            }`}
          >
            <Star className="h-3.5 w-3.5" fill={favorited ? 'currentColor' : 'none'} />
          </button>
          {world.can_edit && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg border border-fuchsia-700/50 bg-fuchsia-950/40 px-2 py-1.5 text-xs text-fuchsia-300 hover:bg-fuchsia-900/40 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              Edit
            </button>
          )}
          {world.is_owner && onManage && (
            <button
              type="button"
              onClick={onManage}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 hover:text-cyan-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
