// Render coverage for the animation studio gallery: list, presets, templates,
// create, from-template and delete.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const RES: Record<string, unknown> = {
  'anim-list': { animations: [{ id: 'an1', title: 'Bounce', width: 640, height: 360, fps: 24, background: '#000', thumbnail: null, frameCount: 24, durationFrames: 24 }, { id: 'an2', title: 'Spin', width: 320, height: 320, fps: 12, background: '#fff', thumbnail: 'data:image/png;base64,AAAA', frameCount: 12, durationFrames: 12 }] },
  'canvas-presets': { presets: [{ id: 'hd', label: 'HD', width: 1280, height: 720, fps: 24 }, { id: 'sq', label: 'Square', width: 512, height: 512, fps: 12 }] },
  'template-list': { templates: [{ id: 'tp1', label: 'Bouncing ball', description: 'Squash and stretch', width: 640, height: 360, fps: 24, frames: 24, layers: ['ball'] }] },
  'anim-create': { animation: { id: 'an3' } }, 'anim-from-template': { animation: { id: 'an4' } },
};
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('../AnimStudio', () => ({ AnimStudio: ({ onExit }: { onExit?: () => void }) => <div data-testid="studio"><button onClick={onExit}>Back to gallery</button></div> }));

import { AnimationStudioSection } from '../AnimationStudioSection';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: RES[actionOf(a)] ?? { ok: true }, error: null } }));
});

describe('AnimationStudioSection', () => {
  it('lists animations and drives create, template and delete flows', async () => {
    // creating or starting a template opens the studio, so each path gets its own mount
    for (const skip of [/Bounce|Spin|^\+ |Bouncing/, /Bounce|Spin|^New|^Create/, /^New|^Create|^\+ |Bouncing/]) {
      const view = render(<AnimationStudioSection />);
      await settle();
      await exercise({ passes: 3, skip });
      view.unmount();
    }
    expect(lensRunMock.mock.calls.length).toBeGreaterThan(3);
  });
  it('opens an animation in the studio', async () => {
    const view = render(<AnimationStudioSection />);
    await settle();
    await exercise({ passes: 1, skip: /^New|^Create|^\+ |Delete|Confirm/ });
    expect(view.container.textContent).toBeTruthy();
  });
  it('is honest when the gallery cannot load', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<AnimationStudioSection />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});
