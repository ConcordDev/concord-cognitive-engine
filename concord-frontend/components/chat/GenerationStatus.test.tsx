import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GenerationStatus, generationStage } from './GenerationStatus';

describe('generationStage', () => {
  it('is idle when nothing is generating', () => {
    expect(generationStage({ generating: false, streamingContent: '' })).toBe('idle');
    expect(generationStage({ generating: false, streamingContent: 'leftover' })).toBe('idle');
  });
  it('is thinking while generating with nothing streamed yet', () => {
    expect(generationStage({ generating: true, streamingContent: '' })).toBe('thinking');
  });
  it('is writing once streamed content exists', () => {
    expect(generationStage({ generating: true, streamingContent: 'partial ans' })).toBe('writing');
  });
});

describe('GenerationStatus', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<GenerationStatus generating={false} streamingContent="" />);
    expect(container.firstChild).toBeNull();
  });
  it('shows the Thinking stage with an elapsed clock', () => {
    render(<GenerationStatus generating streamingContent="" />);
    const el = screen.getByTestId('generation-status');
    expect(el.getAttribute('data-stage')).toBe('thinking');
    expect(el.textContent).toContain('Thinking');
    expect(el.textContent).toMatch(/\d+s/);
  });
  it('shows the Writing stage while content streams', () => {
    render(<GenerationStatus generating streamingContent="half an answer" />);
    const el = screen.getByTestId('generation-status');
    expect(el.getAttribute('data-stage')).toBe('writing');
    expect(el.textContent).toContain('Writing');
  });
});
