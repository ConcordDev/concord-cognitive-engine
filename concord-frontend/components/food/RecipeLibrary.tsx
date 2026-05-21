'use client';

/**
 * RecipeLibrary — the user's real recipe library (food.recipe-add /
 * recipe-list). Each recipe supports:
 *  - photo + step-photo capture and gallery (food.recipe-photo-*)
 *  - 1-5 star rating (food.recipe-rate)
 *  - cook-it-again logging + history (food.recipe-cooked / recipe-cook-history)
 * Recipes carry a meal slot so MealPlanAuto can use them. No sample data —
 * everything is user-entered or computed from real macro responses.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChefHat, Plus, Loader2, Star, Camera, Trash2, Flame, History, X, ChevronRight,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Slot = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';
const SLOTS: Slot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

export interface Recipe {
  id: string;
  title: string;
  slot: Slot;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  tags: string[];
  avgRating: number;
  ratingCount: number;
  cookCount: number;
  lastCookedAt: string | null;
  photoCount: number;
}

interface RecipePhoto {
  id: string;
  recipeId: string;
  dataUrl: string;
  caption: string;
  stepNumber: number | null;
}

interface CookEvent {
  id: string;
  recipeId: string;
  recipeTitle: string;
  cookedAt: string;
  servings: number;
  note: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(file);
  });
}

function Stars({ value, onSet }: { value: number; onSet?: (n: number) => void }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={onSet ? () => onSet(n) : undefined}
          disabled={!onSet}
          className={cn(onSet && 'hover:scale-110 transition-transform')}
          aria-label={`${n} star`}
        >
          <Star className={cn('w-3.5 h-3.5', n <= Math.round(value) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600')} />
        </button>
      ))}
    </span>
  );
}

export function RecipeLibrary({ onChange }: { onChange?: () => void }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [photos, setPhotos] = useState<RecipePhoto[]>([]);
  const [cooks, setCooks] = useState<CookEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  // new-recipe form
  const [nTitle, setNTitle] = useState('');
  const [nSlot, setNSlot] = useState<Slot>('Dinner');
  const [nServings, setNServings] = useState('2');
  const [nCalories, setNCalories] = useState('');
  const [nProtein, setNProtein] = useState('');
  const [nCarbs, setNCarbs] = useState('');
  const [nFat, setNFat] = useState('');
  const [nTags, setNTags] = useState('');

  // step-photo form
  const [photoStep, setPhotoStep] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<{ recipes: Recipe[] }>('food', 'recipe-list', {});
      if (r.data?.ok && r.data.result) setRecipes(r.data.result.recipes || []);
    } catch (e) {
      console.error('[RecipeLibrary] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (recipeId: string) => {
    try {
      const [p, c] = await Promise.all([
        lensRun<{ photos: RecipePhoto[] }>('food', 'recipe-photo-list', { recipeId }),
        lensRun<{ history: CookEvent[] }>('food', 'recipe-cook-history', { recipeId }),
      ]);
      if (p.data?.ok) setPhotos(p.data.result?.photos || []);
      if (c.data?.ok) setCooks(c.data.result?.history || []);
    } catch (e) {
      console.error('[RecipeLibrary] detail failed', e);
    }
  }, []);

  function toggle(recipeId: string) {
    if (expanded === recipeId) { setExpanded(null); return; }
    setExpanded(recipeId);
    setPhotos([]); setCooks([]);
    loadDetail(recipeId);
  }

  async function addRecipe() {
    if (!nTitle.trim()) { setError('Recipe needs a title'); return; }
    setError(null);
    try {
      const r = await lensRun('food', 'recipe-add', {
        title: nTitle.trim(),
        slot: nSlot,
        servings: Number(nServings) || 1,
        calories: Number(nCalories) || 0,
        protein: Number(nProtein) || 0,
        carbs: Number(nCarbs) || 0,
        fat: Number(nFat) || 0,
        tags: nTags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      if (r.data?.ok) {
        setNTitle(''); setNCalories(''); setNProtein(''); setNCarbs(''); setNFat(''); setNTags('');
        setCreating(false);
        await load();
        onChange?.();
      } else {
        setError(r.data?.error || 'Failed to add recipe');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add recipe');
    }
  }

  async function rate(recipeId: string, rating: number) {
    try {
      const r = await lensRun('food', 'recipe-rate', { recipeId, rating });
      if (r.data?.ok) await load();
    } catch (e) {
      console.error('[RecipeLibrary] rate failed', e);
    }
  }

  async function logCook(recipeId: string, servings: number) {
    try {
      const r = await lensRun('food', 'recipe-cooked', { recipeId, servings });
      if (r.data?.ok) { await load(); if (expanded === recipeId) await loadDetail(recipeId); }
    } catch (e) {
      console.error('[RecipeLibrary] cook failed', e);
    }
  }

  async function uploadPhoto(recipeId: string, file: File) {
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const r = await lensRun('food', 'recipe-photo-add', {
        recipeId,
        dataUrl,
        caption: photoCaption.trim(),
        stepNumber: photoStep ? Number(photoStep) : undefined,
      });
      if (r.data?.ok) {
        setPhotoStep(''); setPhotoCaption('');
        await loadDetail(recipeId);
        await load();
      } else {
        setError(r.data?.error || 'Photo upload failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Photo upload failed');
    }
  }

  async function deletePhoto(recipeId: string, id: string) {
    try {
      const r = await lensRun('food', 'recipe-photo-delete', { id });
      if (r.data?.ok) { await loadDetail(recipeId); await load(); }
    } catch (e) {
      console.error('[RecipeLibrary] delete photo failed', e);
    }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ChefHat className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Recipe Library</span>
        <span className="ml-auto text-[10px] text-gray-500">{recipes.length} recipes</span>
        <button onClick={() => setCreating((v) => !v)} className="p-1 text-gray-400 hover:text-white" title="Add recipe">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-2 gap-2 text-xs">
          <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="Recipe title" className="col-span-2 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={nSlot} onChange={(e) => setNSlot(e.target.value as Slot)} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
            {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="number" min={1} value={nServings} onChange={(e) => setNServings(e.target.value)} placeholder="Servings" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" min={0} value={nCalories} onChange={(e) => setNCalories(e.target.value)} placeholder="Calories/serving" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" min={0} value={nProtein} onChange={(e) => setNProtein(e.target.value)} placeholder="Protein g" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" min={0} value={nCarbs} onChange={(e) => setNCarbs(e.target.value)} placeholder="Carbs g" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" min={0} value={nFat} onChange={(e) => setNFat(e.target.value)} placeholder="Fat g" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={nTags} onChange={(e) => setNTags(e.target.value)} placeholder="Tags (comma separated, e.g. vegan, quick)" className="col-span-2 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          {error && <div className="col-span-2 text-amber-300">{error}</div>}
          <button onClick={addRecipe} className="col-span-2 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add recipe</button>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : recipes.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500">
            <ChefHat className="w-6 h-6 mx-auto mb-2 opacity-30" /> No recipes yet. Hit + to build your library.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {recipes.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => toggle(r.id)}
                  className="w-full px-3 py-2 hover:bg-white/[0.03] flex items-center gap-2 text-left"
                >
                  <ChevronRight className={cn('w-3.5 h-3.5 text-gray-500 transition-transform', expanded === r.id && 'rotate-90')} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{r.title}</div>
                    <div className="text-[10px] text-gray-500 flex items-center gap-2">
                      <span className="text-cyan-400">{r.slot}</span>
                      {r.calories > 0 && <span>{r.calories} kcal</span>}
                      {r.cookCount > 0 && <span className="flex items-center gap-0.5"><Flame className="w-3 h-3" />{r.cookCount}×</span>}
                      {r.photoCount > 0 && <span className="flex items-center gap-0.5"><Camera className="w-3 h-3" />{r.photoCount}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <Stars value={r.avgRating} />
                    <div className="text-[9px] text-gray-600">{r.ratingCount} rating{r.ratingCount === 1 ? '' : 's'}</div>
                  </div>
                </button>

                {expanded === r.id && (
                  <div className="px-3 pb-3 space-y-3 bg-black/20">
                    <div className="flex flex-wrap items-center gap-3 pt-2 text-xs">
                      <span className="text-gray-400">Your rating:</span>
                      <Stars value={r.avgRating} onSet={(n) => rate(r.id, n)} />
                      <button
                        onClick={() => logCook(r.id, r.servings)}
                        className="ml-auto px-2 py-1 rounded bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 flex items-center gap-1"
                      >
                        <Flame className="w-3 h-3" /> Cooked it again
                      </button>
                    </div>

                    {/* Cook history */}
                    {cooks.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase text-gray-500 mb-1 flex items-center gap-1">
                          <History className="w-3 h-3" /> Cook history
                        </div>
                        <ul className="space-y-0.5">
                          {cooks.slice(0, 6).map((c) => (
                            <li key={c.id} className="text-[10px] text-gray-400">
                              {new Date(c.cookedAt).toLocaleDateString()} · {c.servings} serving{c.servings === 1 ? '' : 's'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Photo gallery */}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] uppercase text-gray-500 flex items-center gap-1">
                          <Camera className="w-3 h-3" /> Photos
                        </span>
                        <input
                          type="number" min={1} value={photoStep}
                          onChange={(e) => setPhotoStep(e.target.value)}
                          placeholder="step #"
                          className="w-16 px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-[10px] text-white"
                        />
                        <input
                          value={photoCaption}
                          onChange={(e) => setPhotoCaption(e.target.value)}
                          placeholder="caption"
                          className="flex-1 px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-[10px] text-white"
                        />
                        <button
                          onClick={() => photoInput.current?.click()}
                          className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] hover:bg-cyan-500/30"
                        >
                          Upload
                        </button>
                        <input
                          ref={photoInput}
                          type="file" accept="image/*" className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadPhoto(r.id, f);
                            e.target.value = '';
                          }}
                        />
                      </div>
                      {photos.length === 0 ? (
                        <div className="text-[10px] text-gray-600 py-2">No photos yet — capture the dish or a step.</div>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {photos.map((p) => (
                            <div key={p.id} className="relative group">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.dataUrl} alt={p.caption || 'recipe photo'} className="w-full aspect-square object-cover rounded bg-black/40" />
                              {p.stepNumber != null && (
                                <span className="absolute top-1 left-1 bg-black/70 text-cyan-300 text-[9px] px-1 rounded">
                                  Step {p.stepNumber}
                                </span>
                              )}
                              <button
                                onClick={() => deletePhoto(r.id, p.id)}
                                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/70 rounded p-0.5 text-red-400"
                                aria-label="Delete photo"
                              >
                                <X className="w-3 h-3" />
                              </button>
                              {p.caption && (
                                <div className="text-[9px] text-gray-500 truncate mt-0.5">{p.caption}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {error && <div className="text-[10px] text-amber-300 flex items-center gap-1"><Trash2 className="w-3 h-3" />{error}</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RecipeLibrary;
