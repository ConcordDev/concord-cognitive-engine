'use client';

/**
 * FoodParityPanel — the MyFitnessPal/Paprika parity surface for the food
 * lens: barcode scanning, macro-goal rings, a recipe library with photos
 * + ratings + cook history, pantry-aware auto meal-planning with
 * aisle-grouped shopping, and a restaurant map. Every panel is wired to
 * real food-domain macros — no sample data.
 */

import { useState } from 'react';
import { ScanBarcode, Target, ChefHat, CalendarDays, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BarcodeScanner } from './BarcodeScanner';
import { MacroGoalRings } from './MacroGoalRings';
import { RecipeLibrary } from './RecipeLibrary';
import { MealPlanAuto } from './MealPlanAuto';
import { RestaurantMap } from './RestaurantMap';

type Tab = 'track' | 'recipes' | 'plan' | 'discover';

const TABS: { id: Tab; label: string; icon: typeof Target }[] = [
  { id: 'track', label: 'Track', icon: Target },
  { id: 'recipes', label: 'Recipes', icon: ChefHat },
  { id: 'plan', label: 'Plan & Shop', icon: CalendarDays },
  { id: 'discover', label: 'Discover', icon: MapPin },
];

export function FoodParityPanel() {
  const [tab, setTab] = useState<Tab>('track');
  // bumped whenever logging happens, so dependent panels refetch.
  const [nutritionVersion, setNutritionVersion] = useState(0);
  const [recipeVersion, setRecipeVersion] = useState(0);

  return (
    <div className="bg-[#0a0e14] border border-cyan-500/20 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-white/10">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <ScanBarcode className="w-4 h-4 text-cyan-400" />
          Nutrition & Recipe Workbench
        </h2>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Barcode scan, calorie goals, recipe photos &amp; ratings, pantry-aware planning, restaurant map.
        </p>
      </header>

      <nav className="flex items-center gap-1 px-3 py-2 border-b border-white/10 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors',
              tab === t.id ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:text-white hover:bg-white/5')}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="p-3 space-y-4">
        {tab === 'track' && (
          <>
            <MacroGoalRings refreshKey={nutritionVersion} />
            <BarcodeScanner onLogged={() => setNutritionVersion((v) => v + 1)} />
          </>
        )}
        {tab === 'recipes' && (
          <RecipeLibrary onChange={() => setRecipeVersion((v) => v + 1)} />
        )}
        {tab === 'plan' && (
          <MealPlanAuto refreshKey={recipeVersion} />
        )}
        {tab === 'discover' && (
          <RestaurantMap />
        )}
      </div>
    </div>
  );
}

export default FoodParityPanel;
