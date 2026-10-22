/** One recorded pass. The buffer is immutable; comping only points at it. */
export interface AudioTake {
  id: string;
  audioBufferId: string;
  startBeat: number;
  lengthBeats: number;
  /** Seconds into the buffer that correspond to startBeat. */
  offsetSec: number;
  name: string;
  createdAt: number;
  /** 1 = starred. Absent = not starred. */
  rating?: number;
}

/** Comp coverage. Gaps (no region) are silence. Adjacent regions of the same take merge. */
export interface CompRegion {
  takeId: string;
  startBeat: number;
  endBeat: number;
}
