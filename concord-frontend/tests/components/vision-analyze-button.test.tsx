import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';

const analyzeImage = vi.fn();

vi.mock('@/lib/hooks/use-vision-analysis', () => ({
  useVisionAnalysis: () => ({
    analyzeImage,
    isAnalyzing: false,
    result: null,
    error: null,
    reset: vi.fn(),
  }),
}));

describe('VisionAnalyzeButton', () => {
  it('accepts image/* only and does not analyze a wav', async () => {
    analyzeImage.mockClear();
    const { container } = render(<VisionAnalyzeButton domain="music" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('image/*');
    const wav = new File([new Uint8Array([1, 2, 3])], 'tone.wav', { type: 'audio/wav' });
    fireEvent.change(input, { target: { files: [wav] } });
    expect(analyzeImage).not.toHaveBeenCalled();
    expect(screen.getByText('Vision accepts images only')).toBeTruthy();
  });
});
