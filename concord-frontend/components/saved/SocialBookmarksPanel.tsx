'use client';

import { useEffect, useState } from 'react';
import { BookmarksList } from '@/components/social/BookmarksList';
import { api } from '@/lib/api/client';

interface MeResponse { ok: boolean; user?: { id: string; username?: string }; }

export function SocialBookmarksPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<MeResponse>('/api/auth/me');
        setMe(r?.data ?? null);
      } catch { setMe(null); }
    })();
  }, []);
  return (
    <div className="max-w-6xl mx-auto px-4 py-4">
      <h2 className="text-sm font-semibold text-zinc-200 mb-3">Social bookmarks</h2>
      <BookmarksList currentUserId={me?.user?.id} />
    </div>
  );
}
