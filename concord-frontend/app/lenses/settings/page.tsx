'use client';

import { QualityPresetSelector } from '@/components/settings/QualityPresetSelector';
import { MouseSensitivitySlider } from '@/components/settings/MouseSensitivitySlider';

export default function SettingsPage() {
  return (
    <main className="min-h-screen p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>
      <section className="space-y-4">
        <QualityPresetSelector />
        <MouseSensitivitySlider />
      </section>
      <p className="text-[11px] text-gray-500 mt-8">
        More settings (audio volume, accessibility, language) live in their respective lenses.
      </p>
    </main>
  );
}
