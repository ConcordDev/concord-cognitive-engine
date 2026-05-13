'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Upload, Music, X, Plus, Tag, Info, ArrowRight,
  CheckCircle2, AlertTriangle, Loader2, GitFork,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UploadTrackData, TierConfig, ArtifactTier, TrackCredit, UploadProgress } from '@/lib/music/types';
import { ROYALTY_CONSTANTS } from '@/lib/music/royalty-cascade';

const GENRES = [
  'electronic', 'hip-hop', 'pop', 'rock', 'r&b', 'jazz', 'classical',
  'ambient', 'lo-fi', 'house', 'techno', 'drum & bass', 'dubstep',
  'trap', 'folk', 'country', 'blues', 'metal', 'punk', 'reggae',
  'soul', 'funk', 'world', 'experimental', 'soundtrack', 'other',
];

const DEFAULT_TIERS: TierConfig[] = [
  { tier: 'listen', enabled: true, price: 0, currency: 'USD', maxLicenses: null, licensesIssued: 0 },
  { tier: 'create', enabled: true, price: 9.99, currency: 'USD', maxLicenses: null, licensesIssued: 0 },
  { tier: 'commercial', enabled: true, price: 99.99, currency: 'USD', maxLicenses: null, licensesIssued: 0 },
];

interface UploadFlowProps {
  onUpload: (data: UploadTrackData, file: File) => void;
  onCancel: () => void;
  progress: UploadProgress | null;
}

type UploadStep = 'file' | 'metadata' | 'tiers' | 'review';

export function UploadFlow({ onUpload, onCancel, progress }: UploadFlowProps) {
  const [step, setStep] = useState<UploadStep>('file');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Metadata
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('electronic');
  const [subGenre, setSubGenre] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isExplicit, setIsExplicit] = useState(false);
  const [lyrics, setLyrics] = useState('');
  const [credits, setCredits] = useState<TrackCredit[]>([]);
  const [crossPost, setCrossPost] = useState(true);
  const [previewStart, setPreviewStart] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(30);

  // Lineage
  const [isDerivative, setIsDerivative] = useState(false);
  const [parentTrackId, setParentTrackId] = useState('');
  const [parentLicenseId, setParentLicenseId] = useState('');

  // Tiers
  const [tiers, setTiers] = useState<TierConfig[]>(DEFAULT_TIERS);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.type.startsWith('audio/') || f.name.match(/\.(wav|mp3|flac|ogg|aac|m4a)$/i))) {
      setFile(f);
      setFileName(f.name);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
      setStep('metadata');
    }
  }, [title]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setFileName(f.name);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
      setStep('metadata');
    }
  }, [title]);

  const addTag = useCallback(() => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t) && tags.length < 10) {
      setTags([...tags, t]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  const updateTier = useCallback((tier: ArtifactTier, updates: Partial<TierConfig>) => {
    setTiers(prev => prev.map(t => t.tier === tier ? { ...t, ...updates } : t));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!file) return;
    const data: UploadTrackData = {
      title,
      genre,
      subGenre: subGenre || null,
      tags,
      albumId: null,
      trackNumber: null,
      isExplicit,
      lyrics: lyrics || null,
      credits,
      tiers,
      previewStart,
      previewDuration,
      crossPostToArtistry: crossPost,
      parentTrackId: isDerivative ? parentTrackId : null,
      parentLicenseId: isDerivative ? parentLicenseId : null,
    };
    onUpload(data, file);
  }, [file, title, genre, subGenre, tags, isExplicit, lyrics, credits, tiers, previewStart, previewDuration, crossPost, isDerivative, parentTrackId, parentLicenseId, onUpload]);

  // ---- Upload Progress Overlay ----
  if (progress) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4 max-w-sm">
          {progress.stage === 'error' ? (
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
          ) : progress.stage === 'complete' ? (
            <CheckCircle2 className="w-12 h-12 text-neon-green mx-auto" />
          ) : (
            <Loader2 className="w-12 h-12 text-neon-cyan mx-auto animate-spin" />
          )}
          <h2 className="text-lg font-semibold capitalize">{progress.stage === 'complete' ? 'Published!' : progress.stage}</h2>

          {progress.stage !== 'complete' && progress.stage !== 'error' && (
            <div className="w-full bg-white/5 rounded-full h-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple transition-all"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          )}

          {progress.audioAnalysis && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 bg-white/5 rounded"><span className="text-gray-500">BPM</span><br/>{progress.audioAnalysis.bpm}</div>
              <div className="p-2 bg-white/5 rounded"><span className="text-gray-500">Key</span><br/>{progress.audioAnalysis.key}</div>
              <div className="p-2 bg-white/5 rounded"><span className="text-gray-500">LUFS</span><br/>{progress.audioAnalysis.loudnessLUFS.toFixed(1)}</div>
            </div>
          )}

          {progress.error && <p className="text-sm text-red-400">{progress.error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        {(['file', 'metadata', 'tiers', 'review'] as UploadStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="w-3 h-3 text-gray-600" />}
            <button
              onClick={() => { if (file) setStep(s); }}
              className={cn(
                'px-3 py-1 rounded-full capitalize transition-colors',
                step === s ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-gray-500 hover:text-white',
              )}
            >
              {s}
            </button>
          </div>
        ))}
        <button onClick={onCancel} className="ml-auto text-gray-500 hover:text-white" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Step: File */}
      {step === 'file' && (
        <div
          className="border-2 border-dashed border-white/10 rounded-xl p-12 text-center hover:border-neon-cyan/30 transition-colors cursor-pointer"
          onDragOver={e => e.preventDefault()}
          onDrop={handleFileDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} />
          <Upload className="w-12 h-12 text-gray-500 mx-auto mb-4" />
          <p className="text-sm text-gray-300">Drop an audio file or click to browse</p>
          <p className="text-xs text-gray-500 mt-1">WAV, MP3, FLAC, OGG, AAC (max 500MB)</p>
        </div>
      )}

      {/* Step: Metadata */}
      {step === 'metadata' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-400 bg-white/5 px-3 py-2 rounded-lg">
            <Music className="w-4 h-4" />
            <span>{fileName}</span>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Title *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-cyan/50"
              placeholder="Track title"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Genre *</label>
              <select
                value={genre}
                onChange={e => setGenre(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-cyan/50 capitalize"
              >
                {GENRES.map(g => <option key={g} value={g} className="bg-lattice-void capitalize">{g}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Sub-genre</label>
              <input
                value={subGenre}
                onChange={e => setSubGenre(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-cyan/50"
                placeholder="Optional"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Tags (up to 10)</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 text-xs text-gray-300">
                  <Tag className="w-2.5 h-2.5" /> {tag}
                  <button onClick={() => setTags(tags.filter(t => t !== tag))} className="text-gray-500 hover:text-white" aria-label="Close">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none focus:border-neon-cyan/50"
                placeholder="Add a tag..."
              />
              <button onClick={addTag} className="px-2 py-1.5 bg-white/5 rounded-lg text-xs hover:bg-white/10" aria-label="Add">
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Lyrics */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Lyrics (optional)</label>
            <textarea
              value={lyrics}
              onChange={e => setLyrics(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none focus:border-neon-cyan/50 resize-none font-mono"
              placeholder="Paste or type lyrics..."
            />
          </div>

          {/* Credits */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Credits</label>
            {credits.map((credit, i) => (
              <div key={i} className="flex gap-2 mb-1">
                <input
                  value={credit.name}
                  onChange={e => {
                    const next = [...credits];
                    next[i] = { ...next[i], name: e.target.value };
                    setCredits(next);
                  }}
                  className="flex-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs focus:outline-none"
                  placeholder="Name"
                />
                <input
                  value={credit.role}
                  onChange={e => {
                    const next = [...credits];
                    next[i] = { ...next[i], role: e.target.value };
                    setCredits(next);
                  }}
                  className="flex-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs focus:outline-none"
                  placeholder="Role (producer, vocalist...)"
                />
                <button onClick={() => setCredits(credits.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400" aria-label="Close">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setCredits([...credits, { name: '', role: '', userId: null }])}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white mt-1"
            >
              <Plus className="w-3 h-3" /> Add Credit
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isExplicit} onChange={e => setIsExplicit(e.target.checked)} className="accent-neon-pink" />
            Explicit content
          </label>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={crossPost} onChange={e => setCrossPost(e.target.checked)} className="accent-neon-cyan" />
            Cross-post to Artistry for discovery
          </label>

          {crossPost && (
            <div className="grid grid-cols-2 gap-4 pl-6">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Preview start (seconds)</label>
                <input type="number" value={previewStart} onChange={e => setPreviewStart(Number(e.target.value))} min={0}
                  className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Preview duration (seconds)</label>
                <input type="number" value={previewDuration} onChange={e => setPreviewDuration(Number(e.target.value))} min={10} max={60}
                  className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none" />
              </div>
            </div>
          )}

          {/* Derivative / Remix */}
          <div className="bg-white/[0.03] rounded-xl border border-white/5 p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={isDerivative} onChange={e => setIsDerivative(e.target.checked)} className="accent-neon-purple" />
              <GitFork className="w-4 h-4 text-neon-purple" />
              This is a remix / derivative work
            </label>
            {isDerivative && (
              <div className="pl-6 space-y-3">
                <div className="flex items-start gap-2 p-2 rounded bg-neon-purple/5 border border-neon-purple/10 text-xs text-gray-300">
                  <Info className="w-4 h-4 text-neon-purple flex-shrink-0 mt-0.5" />
                  <div>
                    <p>Royalty cascade applies: <strong>{(ROYALTY_CONSTANTS.BASE_RATE * 100)}%</strong> of net revenue goes to the original creator. This halves at each derivative level (floor: {(ROYALTY_CONSTANTS.ROYALTY_FLOOR * 100)}%).</p>
                    <p className="mt-1 text-gray-500">This is a system invariant — same for every creator.</p>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Parent Track ID</label>
                  <input value={parentTrackId} onChange={e => setParentTrackId(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none" placeholder="ID of the track you remixed" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Your License ID</label>
                  <input value={parentLicenseId} onChange={e => setParentLicenseId(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none" placeholder="Your Create or Commercial license ID" />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={() => setStep('tiers')} disabled={!title}
              className="px-4 py-2 rounded-lg bg-neon-cyan/10 text-neon-cyan text-sm hover:bg-neon-cyan/20 disabled:opacity-30 transition-colors">
              Next: Set Pricing
            </button>
          </div>
        </div>
      )}

      {/* Step: Tiers */}
      {step === 'tiers' && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-neon-cyan/5 border border-neon-cyan/10 text-xs text-gray-300 flex items-start gap-2">
            <Info className="w-4 h-4 text-neon-cyan flex-shrink-0 mt-0.5" />
            <div>
              <p><strong>Artifact Sovereignty Tiers</strong> — You control pricing. The platform controls royalty rates (same for everyone).</p>
              <p className="text-gray-500 mt-1">Platform fee: {(ROYALTY_CONSTANTS.PLATFORM_FEE_RATE * 100)}%. Derivative royalty: {(ROYALTY_CONSTANTS.BASE_RATE * 100)}% halving.</p>
            </div>
          </div>

          {tiers.map(tier => {
            const meta = { listen: { icon: '🎧', desc: 'Stream, background play, playlist, offline cache' }, create: { icon: '🎭', desc: 'All Listen + remix, sample, derivative works' }, commercial: { icon: '🏢', desc: 'All Create + commercial use, sync, public performance' } }[tier.tier];
            return (
              <div key={tier.tier} className={cn('rounded-xl border p-4 transition-colors', tier.enabled ? 'border-white/10 bg-white/[0.03]' : 'border-white/5 opacity-50')}>
                <div className="flex items-center justify-between mb-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={tier.enabled} onChange={e => updateTier(tier.tier, { enabled: e.target.checked })} className="accent-neon-cyan" />
                    <span className="text-lg">{meta.icon}</span>
                    <span className="text-sm font-semibold capitalize">{tier.tier}</span>
                  </label>
                </div>
                <p className="text-xs text-gray-500 mb-3">{meta.desc}</p>
                {tier.enabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Price (USD)</label>
                      <input type="number" value={tier.price} onChange={e => updateTier(tier.tier, { price: Math.max(0, Number(e.target.value)) })} min={0} step={0.01}
                        className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-cyan/50" />
                      {tier.price === 0 && <span className="text-[10px] text-neon-green">Free</span>}
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Max licenses</label>
                      <input type="number" value={tier.maxLicenses ?? ''} onChange={e => updateTier(tier.tier, { maxLicenses: e.target.value ? Number(e.target.value) : null })} min={1}
                        className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-cyan/50"
                        placeholder="Unlimited" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex justify-between">
            <button onClick={() => setStep('metadata')} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">Back</button>
            <button onClick={() => setStep('review')} className="px-4 py-2 rounded-lg bg-neon-cyan/10 text-neon-cyan text-sm hover:bg-neon-cyan/20">
              Next: Review
            </button>
          </div>
        </div>
      )}

      {/* Step: Review */}
      {step === 'review' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">Review & Publish</h2>

          <div className="bg-white/[0.03] rounded-xl border border-white/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Music className="w-5 h-5 text-neon-cyan" />
              <span className="text-sm font-semibold">{title}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
              <span>File: {fileName}</span>
              <span className="capitalize">Genre: {genre}{subGenre ? ` / ${subGenre}` : ''}</span>
              <span>Tags: {tags.join(', ') || 'None'}</span>
              <span>Explicit: {isExplicit ? 'Yes' : 'No'}</span>
              <span>Cross-post to Artistry: {crossPost ? 'Yes' : 'No'}</span>
              {isDerivative && <span className="text-neon-purple">Derivative work (royalty cascade applies)</span>}
            </div>
          </div>

          <div className="bg-white/[0.03] rounded-xl border border-white/5 p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Pricing</h3>
            <div className="space-y-1">
              {tiers.filter(t => t.enabled).map(tier => (
                <div key={tier.tier} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{tier.tier}</span>
                  <span className="font-mono">{tier.price === 0 ? 'Free' : `$${tier.price.toFixed(2)}`}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button onClick={() => setStep('tiers')} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">Back</button>
            <button
              onClick={handleSubmit}
              className="px-6 py-2.5 rounded-lg bg-neon-cyan text-black text-sm font-semibold hover:brightness-110 transition"
            >
              Publish Track
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
