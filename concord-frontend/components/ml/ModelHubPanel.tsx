'use client';

/**
 * ModelHubPanel — browsable Hugging Face model catalog with cards, tags,
 * downloads, and a per-model detail card. Wires ml.model-hub + ml.model-card.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import {
  Brain, Search, Download, Heart, Loader2, ExternalLink, X, RefreshCw, FileText, History,
} from 'lucide-react';
import { activateOnEnterOrSpace } from '@/lib/a11y/editable-target';

interface HubModel {
  id: string;
  name: string;
  author: string;
  task: string;
  library: string;
  downloads: number;
  likes: number;
  tags: string[];
  updatedAt: string | null;
  gated: boolean;
  url: string;
}

interface ModelCardDetail {
  id: string;
  name: string;
  author: string;
  task: string;
  library: string;
  downloads: number;
  likes: number;
  tags: string[];
  license: string;
  updatedAt: string | null;
  gated: boolean;
  siblings: string[];
  url: string;
}

const TASKS = [
  '', 'text-generation', 'text-classification', 'token-classification',
  'fill-mask', 'question-answering', 'summarization', 'translation',
  'image-classification', 'object-detection', 'text-to-image',
  'automatic-speech-recognition', 'sentence-similarity',
];

function fmt(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function ModelHubPanel({ onUseInPlayground }: { onUseInPlayground?: (modelId: string) => void }) {
  const [query, setQuery] = useState('');
  const [task, setTask] = useState('');
  const [sort, setSort] = useState('downloads');
  const [models, setModels] = useState<HubModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<ModelCardDetail | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  // D3/M2: the detail has two faces — front = the model card; flip =
  // provenance (where this model came from, under what licence, and
  // the keep-as-DTU act that closes the creation→lens loop).
  const [cardFace, setCardFace] = useState<'card' | 'provenance'>('card');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('ml', 'model-hub', { query, task, sort, limit: 24 });
    if (r.data?.ok && r.data.result) {
      setModels((r.data.result as { models: HubModel[] }).models || []);
    } else {
      setError(r.data?.error || 'Failed to load model hub');
      setModels([]);
    }
    setLoading(false);
  }, [query, task, sort]);

  // F10: the Task/Sort comboboxes must apply ON CHANGE — previously
  // load ran once at mount and filter changes sat inert until the
  // manual refresh button. Query text reloads debounced (600ms), the
  // same discipline as the arXiv filter.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; void load(); return; }
    const t = setTimeout(() => { void load(); }, 600);
    return () => clearTimeout(t);
  }, [load]);

  const openCard = async (modelId: string) => {
    setCardLoading(true);
    setCard(null);
    setCardFace('card');
    const r = await lensRun('ml', 'model-card', { modelId });
    if (r.data?.ok && r.data.result) {
      setCard((r.data.result as { card: ModelCardDetail }).card);
    } else {
      setError(r.data?.error || 'Failed to load model card');
    }
    setCardLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Search Hugging Face models..."
            className="w-full pl-9 pr-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none"
          />
        </div>
        <select value={task} onChange={(e) => setTask(e.target.value)}
          className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none">
          {TASKS.map((t) => <option key={t} value={t}>{t || 'All tasks'}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none">
          <option value="downloads">Most downloaded</option>
          <option value="likes">Most liked</option>
          <option value="lastModified">Recently updated</option>
        </select>
        <button onClick={load} disabled={loading} className="btn-neon small purple disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="py-12 text-center text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading models...
        </div>
      ) : models.length === 0 ? (
        <div className="py-12 text-center text-gray-400">No models found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {models.map((m) => (
            <div key={m.id} className="panel p-4 cursor-pointer hover:border-neon-purple/50 transition-colors"
              onClick={() => openCard(m.id)} role="button" tabIndex={0} onKeyDown={activateOnEnterOrSpace}>
              <div className="flex items-start gap-2 mb-2">
                <Brain className="w-4 h-4 text-neon-purple mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate" title={m.id}>{m.name}</p>
                  <p className="text-xs text-gray-400 truncate">{m.author}</p>
                </div>
              </div>
              <p className="text-xs text-neon-cyan mb-2">{m.task}</p>
              <div className="flex items-center gap-3 text-xs text-gray-400 mb-2">
                <span className="flex items-center gap-1"><Download className="w-3 h-3" />{fmt(m.downloads)}</span>
                <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{fmt(m.likes)}</span>
                {m.gated && <span className="text-yellow-400">gated</span>}
              </div>
              <div className="flex flex-wrap gap-1">
                {m.tags.slice(0, 3).map((t) => (
                  <span key={t} className="text-[10px] bg-lattice-surface px-1.5 py-0.5 rounded text-gray-400">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(card || cardLoading) && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setCard(null)} role="button" tabIndex={0} onKeyDown={activateOnEnterOrSpace}>
          <div className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={activateOnEnterOrSpace}>
            {cardLoading ? (
              <div className="p-12 text-center text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading card...
              </div>
            ) : card && (
              <>
                <div className="p-5 border-b border-lattice-border flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold">{card.name}</h3>
                    <p className="text-sm text-gray-400">{card.author} · {card.task} · {card.library}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCardFace(cardFace === 'card' ? 'provenance' : 'card')}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-lattice-surface hover:bg-white/10"
                      aria-label={cardFace === 'card' ? 'Show provenance' : 'Show model card'}
                    >
                      <History className="w-3.5 h-3.5" /> {cardFace === 'card' ? 'Provenance' : 'Card'}
                    </button>
                    <button onClick={() => setCard(null)} className="p-1 hover:bg-white/10 rounded" aria-label="Close">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                {cardFace === 'provenance' ? (
                  <div className="p-5 space-y-3 overflow-y-auto max-h-[60vh]">
                    <p className="text-xs text-gray-400 uppercase tracking-wider">Provenance</p>
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between gap-4"><dt className="text-gray-400">Source</dt><dd>Hugging Face Hub (live read)</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-gray-400">Model id</dt><dd className="font-mono text-xs">{card.id}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-gray-400">Author</dt><dd>{card.author}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-gray-400">Licence</dt><dd>{card.license}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-gray-400">Access</dt><dd>{card.gated ? 'Gated on the Hub' : 'Open'}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-gray-400">Last updated</dt><dd>{card.updatedAt ? new Date(card.updatedAt).toLocaleDateString() : '—'}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-gray-400">Canonical page</dt><dd><a className="text-neon-cyan hover:underline" href={card.url} target="_blank" rel="noreferrer">huggingface.co/{card.id}</a></dd></div>
                    </dl>
                    <p className="text-xs text-gray-400">
                      Counts and files on the card face are the Hub's own figures, read live — Concord keeps no copy.
                      Keeping the model as a DTU pins this card, with its provenance, into your library.
                    </p>
                    <SaveAsDtuButton
                      apiSource="huggingface-model"
                      apiUrl={card.url}
                      title={`HF model — ${card.id}`}
                      content={`${card.id} · ${card.task} · ${card.library}\nLicence: ${card.license} · Downloads: ${card.downloads} · Likes: ${card.likes}\n${card.url}`}
                      extraTags={['ml', 'modelcard']}
                      rawData={{ ...card }}
                    />
                  </div>
                ) : (
                <div className="p-5 space-y-4 overflow-y-auto max-h-[60vh]">
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div className="bg-lattice-surface p-3 rounded-lg">
                      <p className="text-lg font-bold text-neon-green">{fmt(card.downloads)}</p>
                      <p className="text-xs text-gray-400">Downloads</p>
                    </div>
                    <div className="bg-lattice-surface p-3 rounded-lg">
                      <p className="text-lg font-bold text-neon-pink">{fmt(card.likes)}</p>
                      <p className="text-xs text-gray-400">Likes</p>
                    </div>
                    <div className="bg-lattice-surface p-3 rounded-lg">
                      <p className="text-sm font-bold text-neon-cyan">{card.license}</p>
                      <p className="text-xs text-gray-400">License</p>
                    </div>
                    <div className="bg-lattice-surface p-3 rounded-lg">
                      <p className="text-sm font-bold">{card.gated ? 'Gated' : 'Open'}</p>
                      <p className="text-xs text-gray-400">Access</p>
                    </div>
                  </div>
                  {card.tags.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Tags</p>
                      <div className="flex flex-wrap gap-1">
                        {card.tags.map((t) => (
                          <span key={t} className="text-xs bg-lattice-surface px-2 py-0.5 rounded text-gray-300">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {card.siblings.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Files</p>
                      <div className="space-y-0.5 max-h-40 overflow-y-auto">
                        {card.siblings.map((f) => (
                          <p key={f} className="text-xs font-mono text-gray-400 flex items-center gap-1">
                            <FileText className="w-3 h-3" />{f}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    {onUseInPlayground && (
                      <button onClick={() => { onUseInPlayground(card.id); setCard(null); }}
                        className="btn-neon small purple flex-1">Use in Playground</button>
                    )}
                    <a href={card.url} target="_blank" rel="noreferrer"
                      className="btn-neon small flex-1 flex items-center justify-center gap-1">
                      <ExternalLink className="w-3 h-3" /> Open on HF
                    </a>
                  </div>
                </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
