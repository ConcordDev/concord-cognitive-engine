'use client';

import { Sliders } from 'lucide-react';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';

/** Editing entry — vision macro + pointer to Lightroom Develop/Darkroom. */
export function EditingPanel() {
  return (
    <div className="text-center py-16 text-gray-400">
      <Sliders className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="text-sm mb-2">Photo Editing</p>
      <p className="text-xs text-gray-400">Exposure, contrast, color grading, and LUT presets.</p>
      <VisionAnalyzeButton domain="photography" viaMacro onResult={() => {}} />
    </div>
  );
}
