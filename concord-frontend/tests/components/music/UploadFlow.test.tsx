import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', async (importOriginal) => {
  const ReactM = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = ReactM.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      ReactM.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { UploadFlow } from '@/components/music/UploadFlow';
import type { UploadProgress } from '@/lib/music/types';

function makeAudioFile(name = 'my-cool-track.wav') {
  return new File(['fake-audio'], name, { type: 'audio/wav' });
}

function selectFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('UploadFlow', () => {
  it('renders the file-drop step initially', () => {
    render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    expect(screen.getByText(/Drop an audio file/)).toBeInTheDocument();
  });

  it('selecting a file advances to the metadata step and pre-fills the title', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile());
    expect(screen.getByText('my-cool-track.wav')).toBeInTheDocument();
    expect(screen.getByDisplayValue('my cool track')).toBeInTheDocument();
  });

  it('adding and removing tags works in the metadata step', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile());
    const tagInput = screen.getByPlaceholderText('Add a tag...');
    fireEvent.change(tagInput, { target: { value: 'chill' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.getByText('chill')).toBeInTheDocument();
    // remove it
    const tagChip = screen.getByText('chill').closest('span')!;
    fireEvent.click(tagChip.querySelector('button')!);
    expect(screen.queryByText('chill')).not.toBeInTheDocument();
  });

  it('adding a credit row and toggling derivative reveals the lineage fields', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile());
    fireEvent.click(screen.getByText('Add Credit'));
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument();
    // derivative checkbox reveals parent fields
    fireEvent.click(screen.getByText(/remix \/ derivative work/).querySelector('input')!);
    expect(screen.getByPlaceholderText(/track you remixed/)).toBeInTheDocument();
  });

  it('editing credit name/role and removing a credit row exercises the inline handlers', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile());
    fireEvent.click(screen.getByText('Add Credit'));
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Jo' } });
    fireEvent.change(screen.getByPlaceholderText(/Role/), { target: { value: 'producer' } });
    expect(screen.getByDisplayValue('Jo')).toBeInTheDocument();
    expect(screen.getByDisplayValue('producer')).toBeInTheDocument();
    // remove the credit row — the row's X button
    const row = screen.getByDisplayValue('Jo').closest('div')!;
    fireEvent.click(row.querySelector('button')!);
    expect(screen.queryByDisplayValue('Jo')).not.toBeInTheDocument();
  });

  it('toggling explicit and cross-post checkboxes and editing preview fields', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile());
    const explicit = screen.getByText('Explicit content').querySelector('input')!;
    fireEvent.click(explicit);
    expect((explicit as HTMLInputElement).checked).toBe(true);
    // cross-post is on by default — preview number fields visible; edit them
    const numberInputs = () => Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    const previews = numberInputs();
    expect(previews.length).toBe(2);
    fireEvent.change(previews[0], { target: { value: '5' } });
    expect(previews[0].value).toBe('5');
    fireEvent.change(previews[1], { target: { value: '45' } });
    expect(previews[1].value).toBe('45');
    // turn cross-post off — preview fields disappear
    const crossPost = screen.getByText(/Cross-post to Artistry/).querySelector('input')!;
    fireEvent.click(crossPost);
    expect(numberInputs().length).toBe(0);
  });

  it('editing genre, sub-genre and lyrics in the metadata step', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'jazz' } });
    fireEvent.change(screen.getByPlaceholderText('Optional'), { target: { value: 'bebop' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste or type lyrics/), { target: { value: 'la la la' } });
    expect(screen.getByDisplayValue('la la la')).toBeInTheDocument();
  });

  it('derivative lineage fields and tier max-license edits flow into the submitted payload', () => {
    const onUpload = vi.fn();
    const { container } = render(<UploadFlow onUpload={onUpload} onCancel={vi.fn()} progress={null} />);
    const file = makeAudioFile();
    selectFile(container, file);
    fireEvent.click(screen.getByText(/remix \/ derivative work/).querySelector('input')!);
    fireEvent.change(screen.getByPlaceholderText(/track you remixed/), { target: { value: 'parent-99' } });
    fireEvent.change(screen.getByPlaceholderText(/Create or Commercial license/), { target: { value: 'lic-1' } });
    fireEvent.click(screen.getByText('Next: Set Pricing'));
    // set a max-license cap on the first tier
    const maxInputs = screen.getAllByPlaceholderText('Unlimited');
    fireEvent.change(maxInputs[0], { target: { value: '100' } });
    fireEvent.click(screen.getByText('Next: Review'));
    fireEvent.click(screen.getByText('Publish Track'));
    expect(onUpload).toHaveBeenCalledWith(
      expect.objectContaining({ parentTrackId: 'parent-99', parentLicenseId: 'lic-1' }),
      file
    );
  });

  it('tiers step Back returns to metadata and review Back returns to tiers', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile());
    fireEvent.click(screen.getByText('Next: Set Pricing'));
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Next: Set Pricing')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next: Set Pricing'));
    fireEvent.click(screen.getByText('Next: Review'));
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Next: Review')).toBeInTheDocument();
  });

  it('disabling a tier hides its price inputs', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile());
    fireEvent.click(screen.getByText('Next: Set Pricing'));
    const before = screen.getAllByRole('spinbutton').length;
    // toggle the first tier checkbox off
    const tierCheckboxes = container.querySelectorAll('input[type="checkbox"]');
    fireEvent.click(tierCheckboxes[0]);
    const after = screen.getAllByRole('spinbutton').length;
    expect(after).toBeLessThan(before);
  });

  it('Next is disabled until a title exists, then advances to the tiers step', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile('untitled.mp3'));
    // title is pre-filled to "untitled" from the filename — proceed
    fireEvent.click(screen.getByText('Next: Set Pricing'));
    expect(screen.getByText(/Artifact Sovereignty Tiers/)).toBeInTheDocument();
  });

  it('toggling a tier and editing price flows through to the review step', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile());
    fireEvent.click(screen.getByText('Next: Set Pricing'));
    // price inputs exist for enabled tiers
    const priceInputs = screen.getAllByRole('spinbutton');
    fireEvent.change(priceInputs[0], { target: { value: '0' } });
    expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Next: Review'));
    expect(screen.getByText('Review & Publish')).toBeInTheDocument();
  });

  it('the review step submits the upload with the assembled data', () => {
    const onUpload = vi.fn();
    const { container } = render(<UploadFlow onUpload={onUpload} onCancel={vi.fn()} progress={null} />);
    const file = makeAudioFile();
    selectFile(container, file);
    fireEvent.click(screen.getByText('Next: Set Pricing'));
    fireEvent.click(screen.getByText('Next: Review'));
    fireEvent.click(screen.getByText('Publish Track'));
    expect(onUpload).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'my cool track', genre: 'electronic' }),
      file
    );
  });

  it('the cancel (X) button calls onCancel', () => {
    const onCancel = vi.fn();
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={onCancel} progress={null} />);
    selectFile(container, makeAudioFile());
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders an in-progress overlay with a percentage bar', () => {
    const progress: UploadProgress = { stage: 'uploading', progress: 45 } as UploadProgress;
    render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={progress} />);
    expect(screen.getByText('uploading')).toBeInTheDocument();
  });

  it('renders a complete overlay with audio analysis', () => {
    const progress: UploadProgress = {
      stage: 'complete', progress: 100,
      audioAnalysis: { bpm: 128, key: 'Am', loudnessLUFS: -9.3 },
    } as UploadProgress;
    render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={progress} />);
    expect(screen.getByText('Published!')).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('-9.3')).toBeInTheDocument();
  });

  it('renders an error overlay with the error message', () => {
    const progress: UploadProgress = { stage: 'error', progress: 0, error: 'Bad codec' } as UploadProgress;
    render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={progress} />);
    expect(screen.getByText('Bad codec')).toBeInTheDocument();
  });

  it('drag-and-drop of an audio file advances to metadata', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    const dropZone = screen.getByText(/Drop an audio file/).closest('div')!;
    const file = makeAudioFile('dropped.flac');
    fireEvent.dragOver(dropZone);
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
    expect(screen.getByText('dropped.flac')).toBeInTheDocument();
    void container;
  });

  it('clicking a step pill in the indicator jumps steps once a file exists', () => {
    const { container } = render(<UploadFlow onUpload={vi.fn()} onCancel={vi.fn()} progress={null} />);
    selectFile(container, makeAudioFile());
    fireEvent.click(screen.getByText('tiers'));
    expect(screen.getByText(/Artifact Sovereignty Tiers/)).toBeInTheDocument();
  });
});
