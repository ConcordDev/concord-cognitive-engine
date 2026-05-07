import { useState } from 'react';
import { api } from '@/lib/api/client';

interface VisionResult {
  analysis: string;
  suggestedTags?: string[];
  metadata?: Record<string, unknown>;
}

export function useVisionAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyzeImage = async (imageFile: File, domain: string, prompt?: string) => {
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const base64 = await fileToBase64(imageFile);
      const defaultPrompt = `Analyze this image in the context of ${domain}. Describe what you see and suggest relevant metadata, tags, and any actionable insights.`;
      const res = await api.post('/api/chat', {
        message: prompt || defaultPrompt,
        images: [base64],
        model: 'llava:7b',
        mode: 'vision',
      });
      const content = res.data?.reply || res.data?.content || res.data?.message || '';
      // Extract tags from response if present
      const tagMatch = content.match(/tags?:\s*(.+)/i);
      const suggestedTags = tagMatch ? tagMatch[1].split(',').map((t: string) => t.trim().toLowerCase()) : [];
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

  return { analyzeImage, isAnalyzing, result, error, reset: () => { setResult(null); setError(null); } };
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
