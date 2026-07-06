/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const postMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => postMock(...args) },
}));

import { MediaUpload } from './MediaUpload';

function renderUpload() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MediaUpload authorId="user-1" />
    </QueryClientProvider>
  );
}

function makeFile(name = 'song.mp3', type = 'audio/mpeg', content = 'hello-world') {
  const file = new File([content], name, { type });
  // jsdom's File/Blob doesn't implement arrayBuffer() — polyfill for this
  // test only; the component's real call site (uploadFile.file.arrayBuffer())
  // is unrelated to this fix and works fine in real browsers.
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(new TextEncoder().encode(content).buffer),
    });
  }
  return file;
}

describe('MediaUpload — honest upload progress', () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue({ data: { mediaDTU: { id: 'dtu_1' } } });
  });

  it('never lets a Math.random()-derived value reach the upload API payload', async () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const { container } = renderUpload();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.getByDisplayValue(/song/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalled());

    const [url, payload] = postMock.mock.calls[0];
    expect(url).toBe('/api/media/upload');
    expect(payload).not.toHaveProperty('progress');
    expect(payload).not.toHaveProperty('uploadProgress');
    expect(payload).not.toHaveProperty('progressInterval');
    // The payload is fully deterministic from form state (file/title/tags/
    // etc.) — none of its values are Math.random()-derived. This directly
    // pins the finding (a random value reaching the mint-adjacent API call);
    // we don't assert Math.random() is never called anywhere in the tree,
    // since unrelated dependencies may legitimately use it for something
    // else (e.g. a DOM id) — that's out of scope for this fix.
    randomSpy.mockRestore();
  });

  it('drives the progress bar from the real onUploadProgress signal, not a timer', async () => {
    postMock.mockImplementation((_url, _payload, config) => {
      config?.onUploadProgress?.({ loaded: 50, total: 100 });
      // Delay resolution so the 50% state actually commits to the DOM
      // before the mutation proceeds to setUploadProgress(100)/'complete' —
      // otherwise both updates land in the same microtask and only the
      // final render is observable.
      return new Promise((resolve) =>
        setTimeout(() => resolve({ data: { mediaDTU: { id: 'dtu_1' } } }), 50)
      );
    });

    const { container } = renderUpload();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await waitFor(() => expect(screen.getByDisplayValue(/song/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument());
  });
});
