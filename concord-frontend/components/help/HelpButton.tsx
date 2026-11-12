"use client";

/**
 * HelpButton — a global, always-reachable help + bug-report affordance.
 *
 * The per-lens FeedbackWidget rates a specific lens; this is the universal
 * "I'm stuck / something's broken / how do I…" escape hatch, mounted once in
 * AppShell so it's available on every surface. A user who can't find help (or
 * hit a bug) has somewhere to go instead of bouncing with a one-star review.
 *
 * Bug reports + feedback POST to the existing /api/feedback/submit intake
 * (targetType:"system") and route bug reports through the client-error funnel,
 * exactly like FeedbackWidget — no new backend needed.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle, X, Send, BookOpen, Bug, Mail } from "lucide-react";
import { useUIStore } from "@/store/ui";
import { reportClientError } from "@/hooks/useBugContext";
import { Z_INDEX } from "@/lib/ui/z-index";
import { isFullHeightLens } from "@/lib/full-height-lenses";

const SUPPORT_EMAIL = "support@concord-os.org";

// Desktop: the floating trigger is hidden (it covered lens CTAs); the sidebar
// rail's help icon dispatches concord:open-help instead. Mobile keeps it.
export function HelpButton() {
  // On app-style lenses the composer docks at the bottom; sit above it.
  const aboveComposer = isFullHeightLens(usePathname());
  // While the PWA install banner is showing, sit above its measured
  // footprint (oc-social-3afix): at phone width the launcher's old
  // bottom offset landed exactly on the banner's X close button, so
  // tapping X opened this menu and the banner could not be dismissed.
  // The banner publishes its real rect so the two can never share a
  // position at any viewport width.
  const installBannerFootprint = useUIStore((s) => s.installBannerFootprint);
  const aboveBanner = installBannerFootprint > 0;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "report">("menu");
  const [kind, setKind] = useState("bug_report");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Esc closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Dialog focus contract (FIX-export-012): when the popover opens, focus
  // moves inside it; Tab cycles within it instead of escaping to the page
  // behind; closing returns focus to whatever had it (the launcher or the
  // sidebar rail's help icon). Switching menu ↔ report re-homes focus to
  // the new view's first control.
  useEffect(() => {
    if (!open) return;
    if (!restoreFocusRef.current) {
      restoreFocusRef.current = (document.activeElement as HTMLElement) || null;
    }
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const first = dialog.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), select, textarea, input, [tabindex]:not([tabindex="-1"])'
      );
      (first || dialog).focus();
    }
  }, [open, mode]);

  useEffect(() => {
    if (open) return;
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (target && document.contains(target)) target.focus();
  }, [open]);

  const onDialogKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select, textarea, input, [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // Let any surface open the help panel: window.dispatchEvent(new Event('concord:open-help'))
  useEffect(() => {
    const openHandler = () => { setOpen(true); setMode("menu"); };
    window.addEventListener("concord:open-help", openHandler);
    return () => window.removeEventListener("concord:open-help", openHandler);
  }, []);

  const submit = useCallback(async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "system",
          targetId: typeof window !== "undefined" ? window.location.pathname : "app",
          feedbackType: kind,
          description: message,
          context: {
            path: typeof window !== "undefined" ? window.location.pathname : "",
            ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
            timestamp: new Date().toISOString(),
          },
        }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      if (kind === "bug_report") {
        reportClientError({ kind: "feedback", message });
      }
      setSent(true);
      setMessage("");
    } catch (e) {
      console.error("[Help] submit failed:", e);
      useUIStore.getState().addToast({ type: "error", message: "Could not send — email " + SUPPORT_EMAIL });
    }
    setSubmitting(false);
  }, [kind, message]);

  return (
    <>
      {/* Floating launcher — bottom-right, above the mobile nav.
          Below md the global bottom bar (h-14 + safe-area inset) is fixed
          too, so offset by its height instead of a hard-coded bottom-20 that
          a notched phone's home indicator overlaps. While the install banner
          is showing, the measured footprint (which already includes the
          bottom-bar + safe-area clearance the banner sits above) positions
          the launcher 16px above the banner top — inline style wins over the
          class offsets at every width. */}
      <button
        onClick={() => { setOpen((v) => !v); setMode("menu"); setSent(false); }}
        aria-label="Help and feedback"
        style={{ zIndex: Z_INDEX.HELP, ...(aboveBanner ? { bottom: `${installBannerFootprint + 16}px` } : {}) }}
        className={`fixed ${aboveComposer ? "bottom-40 md:bottom-36" : "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-5"} right-4 md:right-5 w-11 h-11 rounded-full bg-lattice-surface border border-lattice-border text-neon-cyan shadow-lg hover:shadow-neon-cyan/25 hover:border-neon-cyan/50 transition-all flex items-center justify-center lg:hidden`}
        title="Help & feedback"
      >
        {open ? <X className="w-5 h-5" /> : <HelpCircle className="w-5 h-5" />}
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Help and feedback"
          tabIndex={-1}
          onKeyDown={onDialogKeyDown}
          style={{ zIndex: Z_INDEX.HELP, ...(aboveBanner ? { bottom: `${installBannerFootprint + 64}px` } : {}) }}
          className="fixed right-4 md:right-5 md:bottom-20 w-[320px] max-w-[calc(100vw-2rem)] rounded-xl bg-lattice-surface border border-lattice-border shadow-2xl p-4 text-sm bottom-[calc(7rem+env(safe-area-inset-bottom,0px))]"
        >
          {mode === "menu" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-white font-semibold mb-1">Need a hand?</h2>
                <button type="button" data-overlay-close="" aria-label="Close" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-white">Close</button>
              </div>
              <Link href="/onboarding" onClick={() => setOpen(false)} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-lattice-deep text-gray-300 hover:text-white transition-colors">
                <BookOpen className="w-4 h-4 text-neon-blue shrink-0" />
                <span>Getting started — replay the intro</span>
              </Link>
              <button onClick={() => { setMode("report"); setKind("bug_report"); }} className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-lattice-deep text-gray-300 hover:text-white transition-colors text-left">
                <Bug className="w-4 h-4 text-red-400 shrink-0" />
                <span>Report a bug or problem</span>
              </button>
              <button onClick={() => { setMode("report"); setKind("feature_request"); }} className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-lattice-deep text-gray-300 hover:text-white transition-colors text-left">
                <Send className="w-4 h-4 text-neon-cyan shrink-0" />
                <span>Share feedback or an idea</span>
              </button>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-lattice-deep text-gray-300 hover:text-white transition-colors">
                <Mail className="w-4 h-4 text-neon-purple shrink-0" />
                <span>Email us — {SUPPORT_EMAIL}</span>
              </a>
            </div>
          )}

          {mode === "report" && (
            <div className="space-y-3">
              {sent ? (
                <div className="text-center py-4">
                  <p className="text-emerald-400 font-medium">Thank you — we got it.</p>
                  <p className="text-gray-400 text-xs mt-1">We read every report.</p>
                  <button onClick={() => { setMode("menu"); setSent(false); }} className="mt-3 text-neon-cyan text-xs underline">Back</button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="text-white font-semibold">{kind === "bug_report" ? "Report a problem" : "Share feedback"}</h2>
                    <button onClick={() => setMode("menu")} className="text-gray-400 hover:text-white text-xs">Back</button>
                  </div>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs rounded bg-lattice-deep border border-lattice-border text-gray-200"
                  >
                    <option value="bug_report">Something is broken</option>
                    <option value="feature_request">Feature request / idea</option>
                    <option value="dislike">Something that needs work</option>
                    <option value="like">Something I love</option>
                  </select>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={kind === "bug_report" ? "What happened? What did you expect?" : "Tell us what's on your mind…"}
                    rows={4}
                    className="w-full px-2 py-2 text-xs rounded bg-lattice-deep border border-lattice-border text-gray-200 placeholder:text-gray-500 resize-none"
                  />
                  <button
                    onClick={submit}
                    disabled={submitting || !message.trim()}
                    className="w-full px-3 py-2 text-xs font-medium rounded bg-gradient-to-r from-neon-cyan to-neon-blue text-white disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {submitting ? "Sending…" : "Send"}
                  </button>
                  <p className="text-[11px] text-gray-500">Your current page is attached automatically to help us reproduce it.</p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default HelpButton;
