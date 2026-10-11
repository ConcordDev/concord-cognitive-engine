"use client";

import { useState, useCallback, useRef } from "react";

interface ArtifactUploaderProps {
  lens: string;
  onUploadComplete: (dtuId: string) => void;
  acceptTypes?: string;
  multi?: boolean;
  compact?: boolean;
}

export function ArtifactUploader({ lens, onUploadComplete, acceptTypes, multi = false, compact = false }: ArtifactUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    setUploading(true);
    setError(null);

    const readFailure = async (res: Response): Promise<string> => {
      try {
        const data = await res.json();
        if (typeof data?.error === "string" && data.error) return data.error;
        if (typeof data?.message === "string" && data.message) return data.message;
      } catch { /* body was not JSON */ }
      return `Upload failed (${res.status})`;
    };

    // Raw file bytes. The server treats Content-Type as the file MIME and
    // reads x-filename / x-title / x-domain. Multipart FormData was rejected
    // as an unknown type.
    const postFile = async (file: File) => {
      const res = await fetch("/api/artifact/upload", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name),
          "X-Title": encodeURIComponent(file.name),
          "X-Domain": lens,
        },
        body: file,
      });
      if (!res.ok) throw new Error(await readFailure(res));
      const data = await res.json();
      if (!data?.ok || !data.dtuId) throw new Error(data?.error || "Upload failed");
      return String(data.dtuId);
    };

    try {
      const fileArray = Array.from(files).filter(Boolean);
      if (!fileArray.length) throw new Error("Choose a file to upload.");
      const batch = multi ? fileArray : fileArray.slice(0, 1);
      for (const file of batch) {
        const dtuId = await postFile(file);
        onUploadComplete(dtuId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [lens, multi, onUploadComplete]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  if (compact) {
    return (
      <div className="inline-flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={acceptTypes || "*/*"}
          multiple={multi}
          onChange={(e) => e.target.files?.length && handleUpload(e.target.files)}
          disabled={uploading}
          className="hidden"
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`relative rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
        dragOver ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-700 hover:border-zinc-500"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={acceptTypes || "*/*"}
        multiple={multi}
        onChange={(e) => e.target.files?.length && handleUpload(e.target.files)}
        disabled={uploading}
        className="hidden"
      />
      <div className="space-y-2">
        <p className="text-sm text-zinc-400">
          {uploading ? "Uploading..." : "Drop files here or"}
        </p>
        {!uploading && (
          <button
            onClick={() => inputRef.current?.click()}
            className="px-4 py-2 text-sm font-medium rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            Browse Files
          </button>
        )}
        {uploading && (
          <div className="w-full bg-zinc-800 rounded-full h-2">
            <div className="bg-emerald-500 h-2 rounded-full animate-pulse w-2/3" />
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

export default ArtifactUploader;
