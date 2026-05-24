"use client";

import { useState } from "react";
import { useUIStore } from '@/store/ui';

interface FeedbackWidgetProps {
  targetType: "dtu" | "lens" | "entity" | "system";
  targetId: string;
}

export function FeedbackWidget({ targetType, targetId }: FeedbackWidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState("");
  const [feedbackType, setFeedbackType] = useState("lens_suggestion");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleQuick = async (type: "like" | "dislike") => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, feedbackType: type }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setSubmitted(type);
    } catch (e) { console.error('[Feedback] Failed to submit feedback:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to submit feedback' }); }
    setSubmitting(false);
  };

  const handleDetailed = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          feedbackType,
          description,
          context: { lens: targetId, timestamp: new Date().toISOString() },
        }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setSubmitted("detailed");
      setExpanded(false);
      setDescription("");
    } catch (e) { console.error('[Feedback] Failed to submit detailed feedback:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to submit feedback' }); }
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span>Feedback recorded</span>
        <button onClick={() => setSubmitted(null)} className="underline">More</button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleQuick("like")}
          disabled={submitting}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors text-sm"
          title="Like"
        >
          +1
        </button>
        <button
          onClick={() => handleQuick("dislike")}
          disabled={submitting}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition-colors text-sm"
          title="Needs work"
        >
          -1
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-blue-400 transition-colors text-sm"
          title="Detailed feedback"
        >
          ...
        </button>
      </div>

      {expanded && (
        <div className="space-y-2 p-3 rounded-lg bg-zinc-900 border border-zinc-700">
          <select
            value={feedbackType}
            onChange={(e) => setFeedbackType(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded bg-zinc-800 border border-zinc-600 text-zinc-200"
          >
            <option value="feature_request">Feature Request</option>
            <option value="bug_report">Bug Report</option>
            <option value="lens_suggestion">Lens Improvement</option>
            <option value="like">Something I Love</option>
            <option value="dislike">Something That Needs Work</option>
          </select>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What would make this better?"
            rows={3}
            className="w-full px-2 py-1.5 text-xs rounded bg-zinc-800 border border-zinc-600 text-zinc-200 placeholder:text-zinc-400 resize-none"
          />
          <button
            onClick={handleDetailed}
            disabled={submitting || !description.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      )}
    </div>
  );
}

export default FeedbackWidget;
