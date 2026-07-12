import { useState } from 'react';
import { api, lensRun } from '@/lib/api/client';

interface VisionResult {
  analysis: string;
  suggestedTags?: string[];
  metadata?: Record<string, unknown>;
}

interface DomainVisionMacroResult {
  ok: boolean;
  content?: string;
  error?: string;
  source?: string;
  model?: string;
}

export function useVisionAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * @param viaMacro - when true, routes through this domain's own
   *   `vision` registerLensAction macro (`POST /api/lens/run`,
   *   {domain, action:'vision', input:{imageB64}}) instead of the generic
   *   `/api/chat?full=1 mode=vision` path. Only a subset of domains register
   *   a real `vision` macro (photography does — server/domains/photography.js;
   *   it picks its own domain-specific prompt server-side and the `prompt`
   *   argument here is ignored on that path) — callers must confirm the
   *   target domain actually has one before passing `viaMacro`, otherwise
   *   the call 404s honestly (`unknown_macro`) rather than silently
   *   falling back.
   */
  const analyzeImage = async (imageFile: File, domain: string, prompt?: string, viaMacro?: boolean) => {
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const base64 = await fileToBase64(imageFile);

      if (viaMacro) {
        const res = await lensRun<DomainVisionMacroResult>(domain, 'vision', { imageB64: base64 });
        if (!res.data.ok || res.data.result?.ok === false) {
          const msg = res.data.error || res.data.result?.error || 'Vision analysis failed';
          setError(msg);
          return null;
        }
        const content = res.data.result?.content || '';
        const payload = { analysis: content, suggestedTags: [], metadata: { domain, source: res.data.result?.source, model: res.data.result?.model } };
        setResult(payload);
        return payload;
      }

      const defaultPrompt = `Analyze this image in the context of ${domain}. Describe what you see and suggest relevant metadata, tags, and any actionable insights.`;
      const res = await api.post('/api/chat?full=1', {
        message: prompt || defaultPrompt,
        images: [base64],
        mode: 'vision',
        // model resolved server-side from OLLAMA_VISION_MODEL env var
      });
      const content = res.data?.reply || res.data?.content || res.data?.message || '';
      // Extract tags from response if present
      const tagMatch = content.match(/tags?:\s*(.+)/i);
      const suggestedTags = tagMatch
        ? tagMatch[1].split(',').map((t: string) => t.trim().toLowerCase())
        : [];
      setResult({ analysis: content, suggestedTags, metadata: { domain } });
      return { analysis: content, suggestedTags, metadata: { domain } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Vision analysis failed';
      setError(msg);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

  return {
    analyzeImage,
    isAnalyzing,
    result,
    error,
    reset: () => {
      setResult(null);
      setError(null);
    },
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // Remove data:image/...;base64, prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
