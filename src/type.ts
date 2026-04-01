export interface SnapshotPayload { exchange: string; pairCount: number; pairs: string[]; prices?: Record<string, { bid: number; ask: number; ts: number }>; }
