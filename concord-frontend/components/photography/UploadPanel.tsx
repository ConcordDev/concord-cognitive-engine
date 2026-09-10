'use client';

import { useCallback, useRef, useState } from 'react';
import Image from 'next/image';
import { Camera, Upload } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import type { PhotoItem } from './photo-types';

/** Upload form — media API + lens artifact create. Extracted from page.tsx. */
export function UploadPanel({ onUploaded }: { onUploaded?: () => void }) {
  const queryClient = useQueryClient();
  const { create: createPhoto, refetch } = useLensData<PhotoItem>('photography', 'photo', { seed: [] });

  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadCamera, setUploadCamera] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      setUploadFile(file);
      setUploadPreview(URL.createObjectURL(file));
      if (!uploadTitle) setUploadTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
    },
    [uploadTitle],
  );

  const uploadMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      let base64Data: string | undefined;
      if (uploadFile) {
        const arrayBuffer = await uploadFile.arrayBuffer();
        base64Data = btoa(
          new Uint8Array(arrayBuffer).reduce((d, byte) => d + String.fromCharCode(byte), ''),
        );
      }
      const mediaResp = await api.post('/api/media/upload', {
        title: data.title,
        mediaType: 'image',
        mimeType: uploadFile?.type || 'image/jpeg',
        fileSize: uploadFile?.size || 0,
        originalFilename: uploadFile?.name,
        tags: data.tags,
        description: data.description,
        ...(base64Data ? { data: base64Data } : {}),
      });
      await createPhoto({
        title: data.title as string,
        data: {
          ...data,
          mediaId: mediaResp.data?.mediaDTU?.id || mediaResp.data?.id,
          createdAt: new Date().toISOString(),
          likes: 0,
          views: 0,
        },
      });
      return mediaResp.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lens', 'photography'] });
      setUploadTitle('');
      setUploadDesc('');
      setUploadTags('');
      setUploadFile(null);
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
      setUploadPreview(null);
      refetch();
      onUploaded?.();
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const handleUpload = useCallback(() => {
    uploadMutation.mutate({
      title: uploadTitle || 'Untitled Photo',
      description: uploadDesc,
      tags: uploadTags.split(',').map((t) => t.trim()).filter(Boolean),
      camera: uploadCamera,
    });
  }, [uploadTitle, uploadDesc, uploadTags, uploadCamera, uploadMutation]);

  return (
    <div className="max-w-md mx-auto bg-white/5 border border-white/10 rounded-lg p-6 space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Upload className="w-5 h-5 text-sky-400" /> Upload Photo
      </h2>
      <div
        className="border-2 border-dashed border-white/10 rounded-lg p-8 text-center cursor-pointer hover:border-sky-500/30 transition-colors"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const f = e.dataTransfer.files[0];
          if (f) handleFileSelect(f);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).click();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
          }}
        />
        {uploadPreview ? (
          <Image
            src={uploadPreview}
            alt="Preview"
            width={400}
            height={192}
            className="max-h-48 mx-auto rounded-lg mb-2 w-auto"
          />
        ) : (
          <Camera className="w-8 h-8 mx-auto mb-2 text-gray-400" />
        )}
        <p className="text-xs text-gray-400">
          {uploadFile ? uploadFile.name : 'Drag & drop or click to upload'}
        </p>
      </div>
      <input
        value={uploadTitle}
        onChange={(e) => setUploadTitle(e.target.value)}
        placeholder="Photo title"
        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm"
      />
      <DraftedTextarea
        lensId="photography"
        draftKey="upload-description"
        initial={uploadDesc}
        onValueChange={setUploadDesc}
        placeholder="Description"
        rows={2}
        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm resize-none"
      />
      <input
        value={uploadCamera}
        onChange={(e) => setUploadCamera(e.target.value)}
        placeholder="Camera / lens info"
        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm"
      />
      <input
        value={uploadTags}
        onChange={(e) => setUploadTags(e.target.value)}
        placeholder="Tags (comma separated)"
        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm"
      />
      <button
        onClick={handleUpload}
        disabled={uploadMutation.isPending}
        className="w-full py-2 bg-sky-500/20 border border-sky-500/30 rounded-lg text-sm hover:bg-sky-500/30 disabled:opacity-50"
      >
        {uploadMutation.isPending ? 'Uploading...' : 'Upload Photo'}
      </button>
    </div>
  );
}
