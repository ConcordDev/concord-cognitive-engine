/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import {
  FolderPlus, Eye, Heart, MessageSquare, Trash2, X, Plus, Loader2, ImageIcon, ListOrdered, Upload,
} from 'lucide-react';

interface ProjImage { url: string; caption: string; order: number }
interface ProcStep { title: string; detail: string }
interface Project {
  id: string; title: string; description: string; discipline: string;
  tools: string[]; tags: string[]; images: ProjImage[]; processSteps: ProcStep[];
  coverUrl: string; published: boolean; views: number;
  appreciations?: number; commentCount?: number; createdAt: string;
}
interface Comment { id: string; userId: string; body: string; createdAt: string }

// Resolves an `artistry-img:<id>` reference — minted by the real
// artistry.project-image-upload macro (server/domains/artistry.js, closes
// docs/WAVE4_INVENTORY.md line 101's "no native image upload/blob-storage
// pipeline" gap) — back to a real `data:` URL via project-image-download.
// A plain external URL (the pre-existing, still-supported path) is used
// as-is with no round trip. Resolved data URLs are cached at module scope
// so the same reference is only downloaded once per session.
const RESOLVED_IMG_CACHE = new Map<string, string>();
const IMG_REF_PREFIX = 'artistry-img:';

function ResolvedImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const isRef = src.startsWith(IMG_REF_PREFIX);
  const [resolved, setResolved] = useState<string | null>(isRef ? RESOLVED_IMG_CACHE.get(src) || null : src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isRef) { setResolved(src); setFailed(false); return; }
    const cached = RESOLVED_IMG_CACHE.get(src);
    if (cached) { setResolved(cached); return; }
    let cancelled = false;
    setResolved(null);
    setFailed(false);
    (async () => {
      const r = await lensRun('artistry', 'project-image-download', { id: src });
      if (cancelled) return;
      if (r.data?.ok && r.data.result) {
        const dataUrl = `data:${r.data.result.mimeType};base64,${r.data.result.data}`;
        RESOLVED_IMG_CACHE.set(src, dataUrl);
        setResolved(dataUrl);
      } else {
        setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [src, isRef]);

  if (failed) return <ImageIcon className="w-8 h-8 text-gray-600" data-testid="artistry-img-failed" />;
  if (!resolved) return <Loader2 className="w-5 h-5 animate-spin text-gray-500" data-testid="artistry-img-loading" />;
  return <img src={resolved} alt={alt} className={className} />;
}

export function ProjectStudio() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ project: Project; comments: Comment[]; appreciations: number; appreciated: boolean } | null>(null);
  const [commentBody, setCommentBody] = useState('');

  // Form state
  const [fTitle, setFTitle] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fDiscipline, setFDiscipline] = useState('illustration');
  const [fTools, setFTools] = useState('');
  const [fTags, setFTags] = useState('');
  const [fCover, setFCover] = useState('');
  const [fImages, setFImages] = useState('');
  const [fSteps, setFSteps] = useState('');
  const [saving, setSaving] = useState(false);
  const fFileRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('artistry', 'projectList', {});
    setProjects((r.data?.result?.projects as Project[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openProject = useCallback(async (id: string) => {
    setOpenId(id);
    setDetail(null);
    const r = await lensRun('artistry', 'projectView', { projectId: id });
    if (r.data?.ok) setDetail(r.data.result as any);
  }, []);

  const submit = useCallback(async () => {
    if (!fTitle.trim()) return;
    setSaving(true);
    const images = fImages.split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
      const [url, ...cap] = line.split('|');
      return { url: url.trim(), caption: cap.join('|').trim(), order: i };
    });
    const processSteps = fSteps.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [title, ...det] = line.split('|');
      return { title: title.trim(), detail: det.join('|').trim() };
    });
    const r = await lensRun('artistry', 'projectCreate', {
      title: fTitle, description: fDesc, discipline: fDiscipline,
      tools: fTools.split(',').map((t) => t.trim()).filter(Boolean),
      tags: fTags.split(',').map((t) => t.trim()).filter(Boolean),
      coverUrl: fCover, images, processSteps,
    });
    setSaving(false);
    if (r.data?.ok) {
      setShowForm(false);
      setFTitle(''); setFDesc(''); setFTools(''); setFTags(''); setFCover(''); setFImages(''); setFSteps('');
      load();
    }
  }, [fTitle, fDesc, fDiscipline, fTools, fTags, fCover, fImages, fSteps, load]);

  // Reads the selected file as a base64 data: URL (same FileReader.readAsDataURL
  // idiom used by PatientChartPanel.tsx's onPhotoFileSelected / TravelDocsPanel.tsx's
  // onFileSelected), uploads it through the real artistry.project-image-upload
  // macro (native blob storage — server/domains/artistry.js), then appends the
  // resulting `artistry-img:<id>` reference as a new `url|caption` line in the
  // SAME free-text textarea the paste-an-external-URL flow already parses at
  // submit time. Uploading real bytes and pasting an external URL both keep
  // working, side by side, in the one field.
  const onImageFileSelected = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fFileRef.current) fFileRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setUploadError('Please choose an image file.'); return; }
    if (file.size > 8 * 1024 * 1024) { setUploadError('Image exceeds the 8 MB limit.'); return; }
    setUploadError(null);
    setUploadingImage(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read the image file'));
        reader.readAsDataURL(file);
      });
      const r = await lensRun('artistry', 'project-image-upload', {
        fileName: file.name, mimeType: file.type, data: dataUrl,
      });
      if (r.data?.ok && r.data.result?.image?.ref) {
        const ref = r.data.result.image.ref as string;
        setFImages((prev) => `${prev}${prev.trim() ? '\n' : ''}${ref}|${file.name}`);
      } else {
        setUploadError(r.data?.error || 'Upload failed — image was not saved.');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not read or upload the image.');
    } finally {
      setUploadingImage(false);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    await lensRun('artistry', 'projectDelete', { projectId: id });
    if (openId === id) { setOpenId(null); setDetail(null); }
    load();
  }, [openId, load]);

  const toggleAppreciate = useCallback(async (id: string) => {
    const r = await lensRun('artistry', 'appreciate', { projectId: id });
    if (r.data?.ok && r.data.result && detail) {
      setDetail({ ...detail, appreciated: r.data.result.appreciated, appreciations: r.data.result.count });
    }
  }, [detail]);

  const addComment = useCallback(async () => {
    if (!commentBody.trim() || !openId) return;
    const r = await lensRun('artistry', 'commentAdd', { projectId: openId, body: commentBody });
    if (r.data?.ok && r.data.result && detail) {
      setDetail({ ...detail, comments: [...detail.comments, r.data.result.comment] });
      setCommentBody('');
    }
  }, [commentBody, openId, detail]);

  // commentDelete — server-enforced to the comment's own author (see
  // artistry.js#commentDelete: `c.userId === artAid(ctx)`). Shown on every
  // comment (we don't know the viewer's id client-side); an attempt on
  // someone else's comment is rejected honestly rather than hidden client-side.
  const removeComment = useCallback(async (commentId: string) => {
    if (!openId || !detail) return;
    const r = await lensRun('artistry', 'commentDelete', { projectId: openId, commentId });
    if (r.data?.ok) {
      setDetail({ ...detail, comments: detail.comments.filter((c) => c.id !== commentId) });
    } else {
      useUIStore.getState().addToast({ type: 'error', message: 'You can only delete your own comments.' });
    }
  }, [openId, detail]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FolderPlus className="w-5 h-5 text-neon-pink" /> Project Case Studies
        </h2>
        <button onClick={() => setShowForm(true)} className="px-3 py-1.5 text-xs bg-neon-pink/20 border border-neon-pink/30 rounded-lg hover:bg-neon-pink/30 flex items-center gap-1">
          <Plus className="w-3 h-3" /> New Project
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-neon-pink" /></div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">No projects yet. Create a multi-image case study.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-neon-pink/30 transition-colors group">
              <button onClick={() => openProject(p.id)} className="block w-full text-left">
                <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
                  {(p.coverUrl || p.images[0]?.url)
                    ? <ResolvedImage src={p.coverUrl || p.images[0].url} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    : <ImageIcon className="w-8 h-8 text-gray-600" />}
                </div>
                <div className="p-3">
                  <h3 className="font-medium text-sm truncate">{p.title}</h3>
                  <div className="text-[11px] text-gray-400 capitalize mt-0.5">{p.discipline}</div>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{p.views}</span>
                    <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{p.appreciations ?? 0}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{p.commentCount ?? 0}</span>
                    {!p.published && <span className="text-yellow-500">Draft</span>}
                  </div>
                </div>
              </button>
              <div className="px-3 pb-2">
                <button onClick={() => remove(p.id)} className="text-[11px] text-gray-400 hover:text-red-400 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">New Project Case Study</h3>
              <button onClick={() => setShowForm(false)} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Project title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <textarea value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="Description" rows={3} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <select value={fDiscipline} onChange={(e) => setFDiscipline(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                {['illustration', 'painting', 'photography', '3d', 'animation', 'graphic-design', 'concept-art', 'typography'].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <input value={fTools} onChange={(e) => setFTools(e.target.value)} placeholder="Tools (comma separated): Photoshop, Blender" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <input value={fTags} onChange={(e) => setFTags(e.target.value)} placeholder="Tags (comma separated)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <input value={fCover} onChange={(e) => setFCover(e.target.value)} placeholder="Cover image URL" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <div className="space-y-1.5">
                <textarea value={fImages} onChange={(e) => setFImages(e.target.value)} placeholder="Images — one per line: url|caption (or upload below)" rows={3} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                <div className="flex items-center gap-2">
                  <input ref={fFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void onImageFileSelected(e); }} />
                  <button type="button" onClick={() => fFileRef.current?.click()} disabled={uploadingImage} className="px-2.5 py-1 text-[11px] bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 disabled:opacity-50 flex items-center gap-1">
                    {uploadingImage ? <><Loader2 className="w-3 h-3 animate-spin" />Uploading…</> : <><Upload className="w-3 h-3" />Upload image</>}
                  </button>
                  <span className="text-[10px] text-gray-500">Adds an artistry-img: reference line above — external URLs still work too.</span>
                </div>
                {uploadError && <p className="text-[11px] text-red-400">{uploadError}</p>}
              </div>
              <textarea value={fSteps} onChange={(e) => setFSteps(e.target.value)} placeholder="Process steps — one per line: title|detail" rows={3} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <button onClick={submit} disabled={saving || !fTitle.trim()} className="w-full py-2 bg-neon-pink/20 rounded-lg text-sm hover:bg-neon-pink/30 disabled:opacity-50">
                {saving ? 'Publishing...' : 'Publish Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {openId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => { setOpenId(null); setDetail(null); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="bg-gray-900 border border-white/10 rounded-lg w-full max-w-2xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            {!detail ? (
              <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-neon-pink" /></div>
            ) : (
              <div>
                <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
                  {(detail.project.coverUrl || detail.project.images[0]?.url)
                    ? <ResolvedImage src={detail.project.coverUrl || detail.project.images[0].url} alt={detail.project.title} className="w-full h-full object-cover" />
                    : <ImageIcon className="w-10 h-10 text-gray-600" />}
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-bold">{detail.project.title}</h3>
                      <div className="text-xs text-gray-400 capitalize">{detail.project.discipline}</div>
                    </div>
                    <button onClick={() => { setOpenId(null); setDetail(null); }} aria-label="Close"><X className="w-4 h-4" /></button>
                  </div>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{detail.project.description}</p>

                  {detail.project.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {detail.project.tools.map((t) => <span key={t} className="text-[11px] px-2 py-0.5 bg-white/5 border border-white/10 rounded-full text-gray-400">{t}</span>)}
                    </div>
                  )}
                  {detail.project.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {detail.project.tags.map((t) => <span key={t} className="text-[11px] px-2 py-0.5 bg-neon-pink/10 border border-neon-pink/20 rounded-full text-neon-pink">#{t}</span>)}
                    </div>
                  )}

                  {detail.project.images.length > 0 && (
                    <div className="space-y-2">
                      {detail.project.images.sort((a, b) => a.order - b.order).map((im, i) => (
                        <figure key={i}>
                          <ResolvedImage src={im.url} alt={im.caption || `image ${i + 1}`} className="w-full rounded-lg border border-white/10" />
                          {im.caption && <figcaption className="text-[11px] text-gray-400 mt-1">{im.caption}</figcaption>}
                        </figure>
                      ))}
                    </div>
                  )}

                  {detail.project.processSteps.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-1.5"><ListOrdered className="w-4 h-4" /> Process</h4>
                      {detail.project.processSteps.map((st, i) => (
                        <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-3">
                          <div className="text-sm font-medium">{i + 1}. {st.title}</div>
                          {st.detail && <p className="text-xs text-gray-400 mt-1">{st.detail}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-gray-400 border-t border-white/10 pt-3">
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{detail.project.views} views</span>
                    <button onClick={() => toggleAppreciate(detail.project.id)} className={`flex items-center gap-1 ${detail.appreciated ? 'text-neon-pink' : 'hover:text-neon-pink'}`}>
                      <Heart className={`w-3.5 h-3.5 ${detail.appreciated ? 'fill-neon-pink' : ''}`} />{detail.appreciations} appreciations
                    </button>
                  </div>

                  {/* Comments */}
                  <div className="space-y-2 border-t border-white/10 pt-3">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5"><MessageSquare className="w-4 h-4" /> Comments ({detail.comments.length})</h4>
                    {detail.comments.map((c) => (
                      <div key={c.id} className="bg-white/5 border border-white/10 rounded-lg p-2.5 flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[11px] text-gray-400">{c.userId} · {new Date(c.createdAt).toLocaleDateString()}</div>
                          <p className="text-sm text-gray-300 mt-0.5">{c.body}</p>
                        </div>
                        <button onClick={() => removeComment(c.id)} aria-label="Delete comment" className="text-gray-500 hover:text-red-400 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input value={commentBody} onChange={(e) => setCommentBody(e.target.value)} placeholder="Add a comment..." className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm" />
                      <button onClick={addComment} disabled={!commentBody.trim()} className="px-3 py-1.5 bg-neon-pink/20 rounded-lg text-xs hover:bg-neon-pink/30 disabled:opacity-50">Post</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
