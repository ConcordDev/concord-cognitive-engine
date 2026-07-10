'use client';

/**
 * AssetLibrary — the AR lens's asset-cataloging surface, distinct from
 * `SceneStudio`'s scene-composition job. Two real sources, not one
 * duplicated generic CRUD:
 *
 *  1. "My Models" — a small persisted catalog of 3D-model *references* a
 *     creator plans to use inside a scene (name, format, poly count, file
 *     size, source URL — all self-reported descriptive metadata, nothing
 *     computed or fabricated). Backed by the real generic lens-artifact
 *     store (`useLensData('ar', 'Model3D', …)` → `/api/lens/ar` →
 *     `runMacro('lens', …)` → `STATE.lensArtifacts`, persisted to disk).
 *     Each entry's "Preview in AR" button calls the REAL `ar.render` macro
 *     (via `useRunArtifact('ar')`, the artifact-scoped dispatch path) and
 *     hands the resulting render plan up to the page's live Three.js/WebXR
 *     viewport — a single-object preview, the AR-tool equivalent of
 *     Sketchfab's own "View in AR" button, not a scene.
 *  2. Sketchfab search (`SketchfabModels`, already real — a live,
 *     no-key-required call to api.sketchfab.com/v3/search) for discovering
 *     third-party models to reference.
 *
 * The former 6-tab generic artifact CRUD (Scene/Layer/Anchor/Model3D/
 * Config/Capture) that used to live directly in app/lenses/ar/page.tsx is
 * NOT reproduced here beyond Model3D — see docs/lens-specs/ar-capability-map.md
 * for why: "Scene" duplicated `SceneStudio`'s real ar_scenes-backed model
 * with a strictly worse flat one; "Layer"/"Config" carried fields
 * (`dtuDensity`, disconnected `trackingMode`/`renderQuality`/`resolution`/
 * `fps`) that no macro anywhere reads — sliders that went nowhere; "Anchor"
 * is now a real workbench input in `SpatialDiagnostics` instead of a
 * disconnected catalog record; "Capture" had no backing capture pipeline
 * (no macro, no getUserMedia code) and is honestly scoped as a future
 * build, not shipped as an empty-looking feature.
 */

import { useState } from 'react';
import { Box, Plus, Trash2, Eye, Search, Loader2 } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { EmptyState, ErrorState } from '@/components/ui';
import { SketchfabModels } from '@/components/ar/SketchfabModels';

const MODEL_FORMATS = ['GLTF', 'GLB', 'USDZ', 'OBJ', 'FBX', 'STL'];

interface ModelAsset {
  name: string;
  description?: string;
  format: string;
  polyCount?: number;
  fileSize?: string;
  sourceUrl?: string;
  model?: string;
  position?: string;
  rotation?: string;
  scale?: number;
  notes?: string;
}

export interface ArRenderPlan {
  drawList?: unknown[];
  objectCount?: number;
  requiredFeatures?: string[];
  [key: string]: unknown;
}

export function AssetLibrary({ onPreview }: { onPreview: (plan: ArRenderPlan, title: string) => void }) {
  const { items, isLoading, isError, error, refetch, create, remove } = useLensData<ModelAsset>('ar', 'Model3D', { seed: [] });
  const runAction = useRunArtifact('ar');
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [format, setFormat] = useState(MODEL_FORMATS[0]);
  const [polyCount, setPolyCount] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [description, setDescription] = useState('');

  const resetForm = () => {
    setName(''); setFormat(MODEL_FORMATS[0]); setPolyCount(''); setFileSize(''); setSourceUrl(''); setDescription('');
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    await create({
      title: name,
      data: {
        name, format, description,
        polyCount: polyCount ? parseInt(polyCount, 10) : undefined,
        fileSize: fileSize || undefined,
        sourceUrl: sourceUrl || undefined,
        model: format,
        position: '0, 0, 0', rotation: '0, 0, 0', scale: 1,
      },
      meta: { tags: ['ar', 'model'], status: 'active', visibility: 'private' },
    });
    resetForm();
    setFormOpen(false);
  };

  const handlePreview = async (item: LensItem<ModelAsset>) => {
    setPreviewingId(item.id);
    try {
      const res = await runAction.mutateAsync({ id: item.id, action: 'render' });
      const plan = ((res as { result?: ArRenderPlan })?.result ?? res) as ArRenderPlan;
      if (plan && Array.isArray(plan.drawList)) onPreview(plan, item.data.name || item.title);
    } catch (e) {
      console.error('Preview render failed:', e);
    } finally {
      setPreviewingId(null);
    }
  };

  if (isError) return <ErrorState message={error?.message || 'Failed to load the model catalog.'} onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <section className={cn(ds.panel, 'space-y-3')}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className={ds.heading3}>My Models</h3>
            <p className={ds.textMuted}>Reference catalog of 3D assets you plan to place in a scene — format, poly count, and source, self-reported.</p>
          </div>
          <button onClick={() => setFormOpen((v) => !v)} className={ds.btnPrimary}>
            <Plus className="w-4 h-4" /> Add model
          </button>
        </div>

        {formOpen && (
          <div className="rounded-lg border border-lattice-border p-3 space-y-2">
            <div className="grid md:grid-cols-2 gap-2">
              <div><label className={ds.label}>Name</label><input className={ds.input} value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><label className={ds.label}>Format</label><select className={ds.select} value={format} onChange={(e) => setFormat(e.target.value)}>{MODEL_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
            </div>
            <div className="grid md:grid-cols-3 gap-2">
              <div><label className={ds.label}>Poly count</label><input type="number" className={ds.input} value={polyCount} onChange={(e) => setPolyCount(e.target.value)} /></div>
              <div><label className={ds.label}>File size</label><input className={ds.input} value={fileSize} onChange={(e) => setFileSize(e.target.value)} placeholder="e.g. 4.2 MB" /></div>
              <div><label className={ds.label}>Source URL</label><input className={ds.input} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://sketchfab.com/…" /></div>
            </div>
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setFormOpen(false); resetForm(); }} className={ds.btnSecondary}>Cancel</button>
              <button onClick={handleCreate} className={ds.btnPrimary} disabled={!name.trim()}>Save</button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-neon-purple" /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Box className="w-5 h-5" />}
            title="No models cataloged yet"
            description="Add a reference to a model you plan to place in a scene, or find one via Sketchfab below."
            action={{ label: 'Add model', onClick: () => setFormOpen(true) }}
            compact
          />
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className={cn(ds.panelBare, 'p-3 flex items-center justify-between gap-3')}>
                <div className="flex items-center gap-3 min-w-0">
                  <Box className="w-5 h-5 text-neon-purple shrink-0" />
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{item.data.name || item.title}</p>
                    <p className={cn(ds.textMuted, 'truncate')}>
                      {item.data.format}{item.data.polyCount ? ` · ${item.data.polyCount.toLocaleString()} polys` : ''}{item.data.fileSize ? ` · ${item.data.fileSize}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {item.data.sourceUrl && (
                    <a href={item.data.sourceUrl} target="_blank" rel="noreferrer" className={ds.btnGhost} aria-label="Open source">
                      <Search className="w-4 h-4" />
                    </a>
                  )}
                  <button onClick={() => handlePreview(item)} className={ds.btnGhost} aria-label={`Preview ${item.data.name} in AR`} disabled={previewingId === item.id}>
                    {previewingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4 text-neon-cyan" />}
                  </button>
                  <button onClick={() => remove(item.id)} className={ds.btnGhost} aria-label={`Delete ${item.data.name}`}>
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={cn(ds.panel)}>
        <SketchfabModels />
      </section>
    </div>
  );
}
