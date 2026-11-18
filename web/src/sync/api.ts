import { api, toApiError } from "@/lib/api";
import { AuthError, ProtocolError, ResyncRequired, ServerError, SyncDisabled } from "./errors";
import type {
  MetaResponse,
  PullResponse,
  PushOp,
  PushResponse,
  SnapshotResponse,
  Transport,
} from "./transport";

type Result<T> = { data?: T; error?: unknown; response: Response };

/** Map the server's answers onto the failures the engine knows how to handle. */
function check<T>(r: Result<T>): T {
  if (r.error === undefined && r.data !== undefined) return r.data;
  const status = r.response.status;
  const err = toApiError(status, r.error);
  if (status === 401) throw new AuthError();
  if (status === 409 && err.code === "resync_required")
    throw new ResyncRequired(Number(err.extra.min_seq ?? 0));
  if (status === 503 && err.code === "sync_disabled") throw new SyncDisabled();
  if (status >= 500) throw new ServerError(err.detail || "The server had a problem.", status);
  throw new ProtocolError(`${status} ${err.code}: ${err.detail}`);
}

export const httpTransport: Transport = {
  async push(clientId: string, ops: PushOp[]): Promise<PushResponse> {
    const data = check(await api.POST("/sync/push", { body: { client_id: clientId, ops } }));
    return data as unknown as PushResponse;
  },
  async pull(since: number, limit: number): Promise<PullResponse> {
    const data = check(await api.GET("/sync/pull", { params: { query: { since, limit } } }));
    return data as unknown as PullResponse;
  },
  async snapshot(): Promise<SnapshotResponse> {
    const data = check(await api.GET("/sync/snapshot"));
    return data as unknown as SnapshotResponse;
  },
  async meta(): Promise<MetaResponse> {
    return check(await api.GET("/sync/meta"));
  },
};
