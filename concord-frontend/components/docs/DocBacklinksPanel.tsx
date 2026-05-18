'use client';

import { useState, useEffect, useCallback } from 'react';
import { callDocsMacro } from '@/lib/api/docs';
import { Link2, ArrowDownLeft, ArrowUpRight, Loader2 } from 'lucide-react';

interface Link {
  source_doc_id?: string;
  target_doc_id?: string | null;
  target_dtu_id?: string | null;
  target_kind: string;
  target_label?: string | null;
  target_uri?: string | null;
  source_title?: string | null;
  source_icon?: string | null;
}

interface Props { documentId: string; }

export function DocBacklinksPanel({ documentId }: Props) {
  const [incoming, setIncoming] = useState<Link[]>([]);
  const [outgoing, setOutgoing] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inR, outR] = await Promise.all([
        callDocsMacro<{ incoming?: Link[] }>('backlinks_in', { documentId }),
        callDocsMacro<{ outgoing?: Link[] }>('backlinks_out', { documentId }),
      ]);
      setIncoming(inR?.incoming || []);
      setOutgoing(outR?.outgoing || []);
    } catch (e) { console.error('backlinks', e); }
    finally { setLoading(false); }
  }, [documentId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-white/40">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-2 space-y-4">
      <Section
        title="Linked from"
        empty="No incoming links."
        icon={<ArrowDownLeft className="w-3.5 h-3.5" />}
        items={incoming}
        renderItem={(l, i) => (
          <div key={`in-${i}`} className="text-sm text-white/80 px-2 py-1 hover:bg-white/5 rounded">
            <div className="flex items-center gap-2">
              <span>{l.source_icon || '📄'}</span>
              <span className="truncate">{l.source_title || l.source_doc_id}</span>
            </div>
          </div>
        )}
      />
      <Section
        title="Linked to"
        empty="No outgoing links."
        icon={<ArrowUpRight className="w-3.5 h-3.5" />}
        items={outgoing}
        renderItem={(l, i) => (
          <div key={`out-${i}`} className="text-sm text-white/80 px-2 py-1 hover:bg-white/5 rounded">
            <div className="flex items-center gap-2">
              <Link2 className="w-3 h-3 text-white/40" />
              <span className="truncate">{l.target_label || l.target_uri || l.target_doc_id || l.target_dtu_id}</span>
              <span className="text-xs text-white/40">{l.target_kind}</span>
            </div>
          </div>
        )}
      />
    </div>
  );
}

function Section<T>({ title, items, empty, icon, renderItem }: {
  title: string;
  items: T[];
  empty: string;
  icon: React.ReactNode;
  renderItem: (item: T, i: number) => React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/40 px-2 py-1">
        {icon}{title}
        <span className="ml-auto">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-white/30 px-2 py-2">{empty}</div>
      ) : (
        <div className="space-y-0.5">{items.map(renderItem)}</div>
      )}
    </div>
  );
}
