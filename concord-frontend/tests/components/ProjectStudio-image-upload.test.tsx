/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the Wave 4 gap-closure of docs/WAVE4_INVENTORY.md line 101 /
// artistry-capability-map.md item 12 ("No native image upload/blob-storage
// pipeline for project images (URL-only)"). ProjectStudio's images field
// now offers a real file-upload control (FileReader -> base64 ->
// artistry.project-image-upload, the same idiom as TravelDocsPanel.tsx /
// PatientChartPanel.tsx) ALONGSIDE the pre-existing free-text `url|caption`
// textarea — both keep working. Uploaded images are referenced by a
// stable `artistry-img:<id>` string, resolved back to a real `data:` URL
// for <img src> via artistry.project-image-download.
//
// Every assertion checks the ACTUAL macro call the UI made and that
// nothing renders as an uploaded/resolved image until the backend macro
// call itself resolves ok:true — no fabricated success states.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: { getState: () => ({ addToast: vi.fn() }) },
}));

import { ProjectStudio } from '@/components/artistry/ProjectStudio';

function emptyList() {
  return { data: { ok: true, result: { projects: [], count: 0 } } };
}

function makeImageFile(name = 'cover.png', type = 'image/png', content = 'fake-png-bytes') {
  return new File([content], name, { type });
}

async function openForm() {
  fireEvent.click(screen.getByRole('button', { name: /New Project/i }));
}

// The modal backdrop + its inner container are BOTH `<div role="button">`
// (keyboard-dismissible overlay pattern, pre-existing in ProjectStudio),
// so `getByRole('button', { name })` inside an open modal is ambiguous —
// their computed accessible name is the concatenation of every descendant
// text node, which also matches any real button's label. Query the actual
// `<button>` elements directly instead.
function clickButton(container: HTMLElement, text: RegExp) {
  const buttons = Array.from(container.querySelectorAll('button'));
  const match = buttons.find((b) => text.test(b.textContent || ''));
  if (!match) throw new Error(`No <button> found matching ${text}`);
  fireEvent.click(match);
}

describe('ProjectStudio — new native image-upload pipeline', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders both the free-text URL textarea and a real "Upload image" control side by side', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'projectList') return emptyList();
      return { data: { ok: true, result: {} } };
    });
    const { container } = render(<ProjectStudio />);
    await openForm();
    expect(screen.getByPlaceholderText(/Images — one per line/i)).toBeInTheDocument();
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.some((b) => /Upload image/i.test(b.textContent || ''))).toBe(true);
  });

  it('selecting an image file reads it as base64 and calls artistry.project-image-upload, then appends the returned ref to the free-text field', async () => {
    lensRun.mockImplementation(async (domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'projectList') return emptyList();
      if (action === 'project-image-upload') {
        expect(domain).toBe('artistry');
        expect(params.fileName).toBe('cover.png');
        expect(params.mimeType).toBe('image/png');
        expect(String(params.data)).toMatch(/^data:image\/png;base64,/);
        return {
          data: {
            ok: true,
            result: { image: { id: 'img_1', fileName: 'cover.png', mimeType: 'image/png', bytes: 12, ref: 'artistry-img:img_1', createdAt: '' } },
          },
        };
      }
      return { data: { ok: true, result: {} } };
    });

    const { container } = render(<ProjectStudio />);
    await openForm();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [makeImageFile()] });
    fireEvent.change(fileInput);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('artistry', 'project-image-upload',
        expect.objectContaining({ fileName: 'cover.png', mimeType: 'image/png' })),
    );

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Images — one per line/i) as HTMLTextAreaElement;
      expect(textarea.value).toContain('artistry-img:img_1|cover.png');
    });
  });

  it('rejects a non-image file client-side without ever calling project-image-upload', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'projectList') return emptyList();
      return { data: { ok: true, result: {} } };
    });
    const { container } = render(<ProjectStudio />);
    await openForm();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = new File(['not an image'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', { value: [badFile] });
    fireEvent.change(fileInput);

    expect(await screen.findByText(/Please choose an image file/i)).toBeInTheDocument();
    expect(lensRun.mock.calls.some(([, action]) => action === 'project-image-upload')).toBe(false);
  });

  it('rejects an oversized image file client-side (8 MB cap) without calling the upload macro', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'projectList') return emptyList();
      return { data: { ok: true, result: {} } };
    });
    const { container } = render(<ProjectStudio />);
    await openForm();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = makeImageFile('huge.png');
    Object.defineProperty(bigFile, 'size', { value: 9 * 1024 * 1024 });
    Object.defineProperty(fileInput, 'files', { value: [bigFile] });
    fireEvent.change(fileInput);

    expect(await screen.findByText(/exceeds the 8 MB limit/i)).toBeInTheDocument();
    expect(lensRun.mock.calls.some(([, action]) => action === 'project-image-upload')).toBe(false);
  });

  it('surfaces the server\'s honest rejection from project-image-upload without fabricating a success', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'projectList') return emptyList();
      if (action === 'project-image-upload') return { data: { ok: false, result: null, error: 'data must be base64' } };
      return { data: { ok: true, result: {} } };
    });
    const { container } = render(<ProjectStudio />);
    await openForm();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [makeImageFile()] });
    fireEvent.change(fileInput);

    expect(await screen.findByText('data must be base64')).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(/Images — one per line/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  it('the pre-existing free-text external-URL path still works unchanged at submit time', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'projectList') return emptyList();
      if (action === 'projectCreate') {
        expect(params.images).toEqual([{ url: 'https://example.com/pic.png', caption: 'ext', order: 0 }]);
        return { data: { ok: true, result: { project: { id: 'proj_1' } } } };
      }
      return { data: { ok: true, result: {} } };
    });
    const { container } = render(<ProjectStudio />);
    await openForm();

    fireEvent.change(screen.getByPlaceholderText('Project title'), { target: { value: 'My Project' } });
    fireEvent.change(screen.getByPlaceholderText(/Images — one per line/i), { target: { value: 'https://example.com/pic.png|ext' } });
    clickButton(container, /Publish Project/i);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('artistry', 'projectCreate', expect.objectContaining({ title: 'My Project' })),
    );
    // Let the post-success setShowForm(false) + refresh load() settle before the test ends.
    await waitFor(() => expect(screen.queryByPlaceholderText('Project title')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/No projects yet/i)).toBeInTheDocument());
  });

  it('an uploaded ref and a pasted external URL can both be submitted together in the same field', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'projectList') return emptyList();
      if (action === 'project-image-upload') {
        return { data: { ok: true, result: { image: { id: 'img_9', fileName: 'shot.png', mimeType: 'image/png', bytes: 4, ref: 'artistry-img:img_9', createdAt: '' } } } };
      }
      if (action === 'projectCreate') {
        expect(params.images).toEqual([
          { url: 'artistry-img:img_9', caption: 'shot.png', order: 0 },
          { url: 'https://example.com/ext.png', caption: '', order: 1 },
        ]);
        return { data: { ok: true, result: { project: { id: 'proj_2' } } } };
      }
      return { data: { ok: true, result: {} } };
    });

    const { container } = render(<ProjectStudio />);
    await openForm();

    fireEvent.change(screen.getByPlaceholderText('Project title'), { target: { value: 'Mixed Sources' } });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [makeImageFile('shot.png')] });
    fireEvent.change(fileInput);
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Images — one per line/i) as HTMLTextAreaElement;
      expect(textarea.value).toContain('artistry-img:img_9|shot.png');
    });

    const textarea = screen.getByPlaceholderText(/Images — one per line/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: `${textarea.value}\nhttps://example.com/ext.png` } });
    clickButton(container, /Publish Project/i);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('artistry', 'projectCreate', expect.anything()));
    await waitFor(() => expect(screen.queryByPlaceholderText('Project title')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/No projects yet/i)).toBeInTheDocument());
  });
});

describe('ProjectStudio — resolving artistry-img: references for display', () => {
  beforeEach(() => lensRun.mockReset());

  function projectWithUploadedImage(refId: string) {
    return {
      id: `proj_${refId}`, title: `Uploaded Cover ${refId}`, description: '', discipline: 'illustration',
      tools: [], tags: [], processSteps: [], coverUrl: '',
      images: [{ url: `artistry-img:${refId}`, caption: '', order: 0 }],
      published: true, views: 0, createdAt: '2026-01-01T00:00:00.000Z',
    };
  }

  it('resolves an artistry-img: reference to a real data: URL via project-image-download and renders it', async () => {
    const project = projectWithUploadedImage('img_resolve_ok');
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'projectList') return { data: { ok: true, result: { projects: [project], count: 1 } } };
      if (action === 'project-image-download') {
        expect(params.id).toBe('artistry-img:img_resolve_ok');
        return { data: { ok: true, result: { id: 'img_resolve_ok', fileName: 'cover.png', mimeType: 'image/png', bytes: 4, data: Buffer.from('abcd').toString('base64') } } };
      }
      return { data: { ok: true, result: {} } };
    });
    render(<ProjectStudio />);
    await screen.findByText(project.title);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('artistry', 'project-image-download', { id: 'artistry-img:img_resolve_ok' }),
    );
    await waitFor(() => {
      const img = screen.getByRole('img', { name: project.title }) as HTMLImageElement;
      expect(img.src).toMatch(/^data:image\/png;base64,/);
    });
  });

  it('a failed download resolves to an honest fallback icon, never a broken/fabricated image', async () => {
    const project = projectWithUploadedImage('img_resolve_fail');
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'projectList') return { data: { ok: true, result: { projects: [project], count: 1 } } };
      if (action === 'project-image-download') return { data: { ok: false, result: null, error: 'image not found' } };
      return { data: { ok: true, result: {} } };
    });
    render(<ProjectStudio />);
    await screen.findByText(project.title);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('artistry', 'project-image-download', { id: 'artistry-img:img_resolve_fail' }),
    );
    await waitFor(() => expect(screen.getByTestId('artistry-img-failed')).toBeInTheDocument());
    expect(screen.queryByRole('img', { name: project.title })).not.toBeInTheDocument();
  });

  it('a plain external cover URL renders directly with no download round trip', async () => {
    const project = { ...projectWithUploadedImage('img_unused'), coverUrl: 'https://example.com/direct.png', images: [] };
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'projectList') return { data: { ok: true, result: { projects: [project], count: 1 } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ProjectStudio />);
    const img = (await screen.findByRole('img', { name: project.title })) as HTMLImageElement;
    expect(img.src).toBe('https://example.com/direct.png');
    expect(lensRun.mock.calls.some(([, action]) => action === 'project-image-download')).toBe(false);
  });
});
