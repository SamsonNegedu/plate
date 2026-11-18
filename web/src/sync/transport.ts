/** What the engine needs from the network. The real implementation is in api.ts; tests use a fake server. */
export type WireEntity = "entry" | "food" | "settings" | "saved_meal" | "favorite";

export interface PushOp {
  op_id: string;
  entity: WireEntity;
  type: "upsert" | "delete";
  id: string;
  base_seq?: number;
  client_ts: string;
  data?: unknown;
}

export interface PushResult {
  op_id: string;
  status: "applied" | "duplicate" | "rejected" | "tombstoned";
  server_seq?: number;
  conflict?: boolean;
  problem?: { code: string; detail: string };
  tombstone?: unknown;
}

export interface PushResponse {
  results: PushResult[];
  cursor: number;
}

export interface PullChange {
  seq: number;
  entity: string;
  id: string;
  op: "upsert" | "delete";
  data: unknown;
}

export interface PullResponse {
  changes: PullChange[];
  next: number;
  has_more: boolean;
}

export interface SnapshotResponse {
  cursor: number;
  min_seq: number;
  settings?: unknown;
  foods: unknown[];
  entries: unknown[];
  saved_meals: unknown[];
  favorites: unknown[];
}

export interface MetaResponse {
  enabled: boolean;
  head: number;
  min_seq: number;
  server_time: string;
}

export interface Transport {
  push(clientId: string, ops: PushOp[]): Promise<PushResponse>;
  pull(since: number, limit: number): Promise<PullResponse>;
  snapshot(): Promise<SnapshotResponse>;
  meta(): Promise<MetaResponse>;
}
