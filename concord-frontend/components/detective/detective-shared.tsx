"use client";

/** Shared detective types — extracted from lenses/detective/page.tsx */

import { statusToken, type StatusKind } from "@/lib/design-system";

export interface Crime {
  id: string;
  crime_type: string;
  location_type?: string;
  location_id: string;
  victim_id: string | null;
  confidence?: number;
  occurred_at: number;
}

export interface CrimeDetail extends Crime {
  world_id?: string;
  status: string;
  resolved_at?: number | null;
}

export type LoadState = "loading" | "error" | "ready";

export const KNOWN_WORLD_IDS = [
  "concordia-hub", "tunya", "sovereign-ruins", "concord-link-frontier",
  "crime", "cyber", "superhero", "fantasy", "lattice-crucible", "sere",
];

export function formatCrimeType(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CaseStatusBadge({ status }: { status: string }) {
  const kind: StatusKind = status === "solved" ? "success" : status === "open" ? "warning" : status === "unsolved" ? "error" : "pending";
  const token = statusToken(kind);
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ ...token.bgStyle, ...token.textStyle, ...token.borderStyle, borderWidth: 1, borderStyle: "solid" }}
    >
      {status}
    </span>
  );
}
