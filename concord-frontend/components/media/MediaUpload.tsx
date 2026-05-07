'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import NextImage from 'next/image';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  X,
  File,
  Image as ImageIcon,
  Music,
  Video,
  FileText,
  Radio,

  Lock,
  Globe,
  Users,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

type MediaType = 'audio' | 'video' | 'image' | 'document' | 'stream';
type Privacy = 'public' | 'private' | 'followers-only';
type UploadStatus = 'idle' | 'validating' | 'uploading' | 'processing' | 'complete' | 'error';

interface UploadFile {
  file: File | null;
  name: string;
  size: number;
  type: string;
  mediaType: MediaType;
  previewUrl: string | null;
}

interface MediaUploadProps {
  onUploadComplete?: (mediaDTU: Record<string, unknown>) => void;
  onCancel?: () => void;
  defaultMediaType?: MediaType;
  className?: string;
  authorId?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES: Record<MediaType, string[]> = {
  audio: ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.webm'],
  video: ['.mp4', '.webm', '.ogg', '.mov', '.mkv'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'],
  document: ['.pdf', '.txt', '.md', '.epub'],
  stream: [],
};

const MAX_SIZES: Record<MediaType, number> = {
  audio: 500 * 1024 * 1024,
  video: 5 * 1024 * 1024 * 1024,
  image: 50 * 1024 * 1024,
  document: 100 * 1024 * 1024,
  stream: 0,
};

const MEDIA_TYPE_ICONS: Record<MediaType, typeof Music> = {
  audio: Music,
  video: Video,
  image: ImageIcon,
  document: FileText,
  stream: Radio,
};

const MEDIA_TYPE_COLORS: Record<MediaType, string> = {
  audio: 'text-neon-cyan',
  video: 'text-neon-purple',
  image: 'text-neon-pink',
  document: 'text-neon-blue',
  stream: 'text-red-400',
};

const PRIVACY_OPTIONS: Array<{ value: Privacy; label: string; icon: typeof Globe; desc: string }> = [
  { value: 'public', label: 'Public', icon: Globe, desc: 'Anyone can view' },
  { value: 'followers-only', label: 'Followers', icon: Users, desc: 'Only followers can view' },
  { value: 'private', label: 'Private', icon: Lock, desc: 'Only you can view' },
];

const DTU_TIERS = ['regular', 'premium', 'sovereign'];

// ── File type detection ──────────────────────────────────────────────────────

function detectMediaType(file: File): MediaType {
  const type = file.type.toLowerCase();
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf' || type.startsWith('text/')) return 'document';
  // Fallback by extension
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  for (const [mediaType, exts] of Object.entries(ACCEPTED_TYPES)) {
    if (exts.includes(`.${ext}`)) return mediaType as MediaType;
  }
  return 'document';
}

function validateFile(file: File, mediaType: MediaType): string | null {
  const maxSize = MAX_SIZES[mediaType];
  if (maxSize > 0 && file.size > maxSize) {
    return `File exceeds maximum size of ${formatBytes(maxSize)} for ${mediaType}`;
  }
  return null;
}

// ── Component ────────────────────────────────────────────────────────────────

export function MediaUpload({
  onUploadComplete,
  onCancel,
  defaultMediaType,
  className,
  authorId = 'current-user',
}: MediaUploadProps) {
  // File state
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('public');
  const [tier, setTier] = useState('regular');
  const [showPrivacyDropdown, setShowPrivacyDropdown] = useState(false);
  const [showTierDropdown, setShowTierDropdown] = useState(false);

  // Upload state
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  // Get all accepted extensions
  const allAccepted = useMemo(() => {
    if (defaultMediaType) return ACCEPTED_TYPES[defaultMediaType].join(',');
    return Object.values(ACCEPTED_TYPES).flat().join(',');
  }, [defaultMediaType]);

  // ── File handling ────────────────────────────────────────────────────

  const processFile = useCallback((file: File) => {
    const mediaType = defaultMediaType || detectMediaType(file);
    const error = validateFile(file, mediaType);

    if (error) {
      setErrorMessage(error);
      setUploadStatus('error');
      return;
    }

    let previewUrl: string | null = null;
    if (mediaType === 'image') {
      previewUrl = URL.createObjectURL(file);
    }

    setUploadFile({
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      mediaType,
      previewUrl,
    });

    // Auto-populate title from filename
    if (!title) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      setTitle(nameWithoutExt.replace(/[-_]/g, ' '));
    }

    setUploadStatus('idle');
    setErrorMessage('');
  }, [defaultMediaType, title]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const removeFile = useCallback(() => {
    if (uploadFile?.previewUrl) {
      URL.revokeObjectURL(uploadFile.previewUrl);
    }
    setUploadFile(null);
    setUploadStatus('idle');
    setErrorMessage('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadFile]);

  // ── Tag handling ─────────────────────────────────────────────────────

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim().toLowerCase().replace(/^#/, '');
    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
      setTags(prev => [...prev, trimmed]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  const removeTag = useCallback((tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
  }, []);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  }, [addTag]);

  // ── Upload mutation ──────────────────────────────────────────────────

  const uploadMutation = useMutation({
    mutationFn: async () => {
      setUploadStatus('validating');
      setUploadProgress(10);

      if (!uploadFile) throw new Error('No file selected');
      if (!title.trim()) throw new Error('Title is required');

      setUploadStatus('uploading');

      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 80) {
            clearInterval(progressInterval);
            return 80;
          }
          return prev + Math.random() * 15;
        });
      }, 300);

      try {
        // Convert file to base64 for binary storage
        if (!uploadFile.file) throw new Error('File data is missing');
        const arrayBuffer = await uploadFile.file.arrayBuffer();
        const base64Data = btoa(
          new Uint8Array(arrayBuffer).reduce((d, byte) => d + String.fromCharCode(byte), '')
        );

        const response = await api.post('/api/media/upload', {
          authorId,
          title: title.trim(),
          description: description.trim(),
          mediaType: uploadFile.mediaType,
          mimeType: uploadFile.type,
          fileSize: uploadFile.size,
          originalFilename: uploadFile.name,
          tags,
          privacy,
          tier,
          data: base64Data,
        });

        clearInterval(progressInterval);
        setUploadProgress(100);
        setUploadStatus('processing');

        // Brief processing phase
        await new Promise(resolve => setTimeout(resolve, 500));
        setUploadStatus('complete');

        return response.data;
      } catch (err) {
        clearInterval(progressInterval);
        throw err;
      }
    },
    onSuccess: (data) => {
      onUploadComplete?.(data.mediaDTU || data);
    },
    onError: (error: Error) => {
      setUploadStatus('error');
      setErrorMessage(error.message || 'Upload failed');
    },
  });

  const handleUpload = useCallback(() => {
    setErrorMessage('');
    uploadMutation.mutate();
  }, [uploadMutation]);

  // ── Render ───────────────────────────────────────────────────────────

  const selectedPrivacy = PRIVACY_OPTIONS.find(p => p.value === privacy) || PRIVACY_OPTIONS[0];
  const MediaIcon = uploadFile ? MEDIA_TYPE_ICONS[uploadFile.mediaType] : File;
  const mediaColor = uploadFile ? MEDIA_TYPE_COLORS[uploadFile.mediaType] : 'text-gray-400';

  return (
    <div className={cn('rounded-xl bg-lattice-surface border border-lattice-border overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
        <h2 className="text-lg font-semibold text-white">Upload Media</h2>
        {onCancel && (
          <button
            onClick={onCancel}
            className="p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* Drop zone */}
        {!uploadFile ? (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all',
              isDragOver
                ? 'border-neon-cyan bg-neon-cyan/5'
                : 'border-lattice-border hover:border-gray-500 hover:bg-lattice-deep/50'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={allAccepted}
              onChange={handleFileSelect}
              className="hidden"
            />

            <motion.div
              animate={isDragOver ? { scale: 1.05, y: -5 } : { scale: 1, y: 0 }}
              className="space-y-3"
            >
              <Upload className={cn('w-10 h-10 mx-auto', isDragOver ? 'text-neon-cyan' : 'text-gray-500')} />
              <div>
                <p className="text-white font-medium">
                  {isDragOver ? 'Drop to upload' : 'Drag and drop your file here'}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  or click to browse
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-3">
                {Object.entries(MEDIA_TYPE_ICONS).map(([type, Icon]) => (
                  <span
                    key={type}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-full text-xs',
                      MEDIA_TYPE_COLORS[type as MediaType],
                      'bg-lattice-deep'
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {type}
                  </span>
                ))}
              </div>
            </motion.div>
          </div>
        ) : (
          /* File preview */
          <div className="rounded-xl bg-lattice-deep border border-lattice-border p-4">
            <div className="flex items-start gap-4">
              {/* Thumbnail / icon */}
              <div className="flex-shrink-0">
                {uploadFile.previewUrl ? (
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-gray-800">
                    <NextImage
                      src={uploadFile.previewUrl}
                      alt={uploadFile.name}
                      width={80}
                      height={80}
                      className="w-full h-full object-cover"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className={cn('w-20 h-20 rounded-lg flex items-center justify-center bg-gray-800', mediaColor)}>
                    <MediaIcon className="w-8 h-8" />
                  </div>
                )}
              </div>

              {/* File info */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">{uploadFile.name}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full bg-lattice-surface', mediaColor)}>
                    {uploadFile.mediaType}
                  </span>
                  <span className="text-xs text-gray-400">{formatBytes(uploadFile.size)}</span>
                  <span className="text-xs text-gray-500">{uploadFile.type}</span>
                </div>
              </div>

              {/* Remove button */}
              {uploadStatus !== 'uploading' && uploadStatus !== 'processing' && (
                <button
                  onClick={removeFile}
                  className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Upload progress */}
            <AnimatePresence>
              {(uploadStatus === 'uploading' || uploadStatus === 'processing' || uploadStatus === 'validating') && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-gray-400">
                      {uploadStatus === 'validating' && 'Validating...'}
                      {uploadStatus === 'uploading' && 'Uploading...'}
                      {uploadStatus === 'processing' && 'Processing...'}
                    </span>
                    <span className="text-xs text-neon-cyan tabular-nums">{Math.round(uploadProgress)}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-neon-cyan to-neon-blue rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${uploadProgress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Metadata form */}
        {uploadFile && uploadStatus !== 'complete' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Title */}
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Title *</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Give your content a title"
                className="w-full px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50 transition-colors"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Describe your content..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50 transition-colors resize-none"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-neon-cyan/10 text-neon-cyan text-xs"
                  >
                    #{tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="hover:text-white transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Add a tag..."
                  className="flex-1 px-3 py-1.5 rounded-lg bg-lattice-deep border border-lattice-border text-white placeholder-gray-500 text-sm focus:outline-none focus:border-neon-cyan/50 transition-colors"
                />
                <button
                  onClick={addTag}
                  disabled={!tagInput.trim()}
                  className="px-3 py-1.5 rounded-lg bg-lattice-deep border border-lattice-border text-gray-400 hover:text-neon-cyan disabled:opacity-30 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Privacy & Tier row */}
            <div className="flex gap-3">
              {/* Privacy selector */}
              <div className="flex-1 relative">
                <label className="block text-sm text-gray-300 mb-1.5">Privacy</label>
                <button
                  onClick={() => { setShowPrivacyDropdown(prev => !prev); setShowTierDropdown(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border text-white text-sm hover:border-gray-500 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <selectedPrivacy.icon className="w-4 h-4 text-gray-400" />
                    {selectedPrivacy.label}
                  </span>
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                </button>
                <AnimatePresence>
                  {showPrivacyDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="absolute top-full left-0 right-0 mt-1 bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden z-50 shadow-xl"
                    >
                      {PRIVACY_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => { setPrivacy(opt.value); setShowPrivacyDropdown(false); }}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-lattice-deep transition-colors',
                            privacy === opt.value ? 'text-neon-cyan' : 'text-gray-300'
                          )}
                        >
                          <opt.icon className="w-4 h-4" />
                          <div>
                            <div className="font-medium">{opt.label}</div>
                            <div className="text-xs text-gray-500">{opt.desc}</div>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Tier selector */}
              <div className="flex-1 relative">
                <label className="block text-sm text-gray-300 mb-1.5">DTU Tier</label>
                <button
                  onClick={() => { setShowTierDropdown(prev => !prev); setShowPrivacyDropdown(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border text-white text-sm hover:border-gray-500 transition-colors"
                >
                  <span className="capitalize">{tier}</span>
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                </button>
                <AnimatePresence>
                  {showTierDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="absolute top-full left-0 right-0 mt-1 bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden z-50 shadow-xl"
                    >
                      {DTU_TIERS.map(t => (
                        <button
                          key={t}
                          onClick={() => { setTier(t); setShowTierDropdown(false); }}
                          className={cn(
                            'w-full px-3 py-2 text-left text-sm capitalize hover:bg-lattice-deep transition-colors',
                            tier === t ? 'text-neon-cyan' : 'text-gray-300'
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}

        {/* Success state */}
        <AnimatePresence>
          {uploadStatus === 'complete' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-xl bg-green-500/10 border border-green-500/20 p-6 text-center"
            >
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <h3 className="text-white font-medium mb-1">Upload Complete</h3>
              <p className="text-sm text-gray-400">Your media is being processed and will be available shortly.</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error state */}
        <AnimatePresence>
          {uploadStatus === 'error' && errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20"
            >
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300">{errorMessage}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Actions */}
        {uploadStatus !== 'complete' && (
          <div className="flex items-center justify-end gap-3 pt-2">
            {onCancel && (
              <button
                onClick={onCancel}
                disabled={uploadStatus === 'uploading' || uploadStatus === 'processing'}
                className="px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-lattice-deep transition-colors disabled:opacity-30"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleUpload}
              disabled={!uploadFile || !title.trim() || uploadStatus === 'uploading' || uploadStatus === 'processing'}
              className={cn(
                'flex items-center gap-2 px-5 py-2 rounded-lg font-medium transition-all',
                uploadFile && title.trim()
                  ? 'bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 border border-neon-cyan/30'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              )}
            >
              {(uploadStatus === 'uploading' || uploadStatus === 'processing' || uploadStatus === 'validating') ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {uploadStatus === 'uploading' ? 'Uploading...' : 'Processing...'}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default MediaUpload;
