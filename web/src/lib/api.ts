import createClient from "openapi-fetch";
import type { paths } from "@/api/schema";
import { AccessExpired, NetworkError } from "@/sync/errors";

interface FieldError {
  message: string;
  location?: string;
}

/** A problem+json answer from the server. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
    readonly requestId: string | undefined,
    readonly fields: FieldError[] = [],
    readonly extra: Record<string, unknown> = {},
  ) {
    super(detail || code);
    this.name = "ApiError";
  }
}

const NO_BODY = new Set([204, 205, 304]);

/**
 * Wraps fetch so callers see two clear failures: the server is unreachable, or something that is not our API answered
 * (Cloudflare Access returns an HTML login page or a redirect when its session expires).
 */
const apiFetch: typeof fetch = async (input, init) => {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new NetworkError();
  }
  const type = res.headers.get("content-type") ?? "";
  const json = type.includes("json");
  const binary = type.startsWith("image/");
  if (
    res.redirected ||
    res.type === "opaqueredirect" ||
    (!json && !binary && !NO_BODY.has(res.status))
  ) {
    throw new AccessExpired();
  }
  return res;
};

export const api = createClient<paths>({
  baseUrl: `${typeof location === "undefined" ? "" : location.origin}/api/v1`,
  credentials: "include",
  fetch: apiFetch,
});

export function toApiError(status: number, body: unknown): ApiError {
  const p = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const errors = Array.isArray(p.errors) ? p.errors : [];
  const fields: FieldError[] = errors.flatMap((e) =>
    typeof e === "object" && e !== null && "message" in e && typeof e.message === "string"
      ? [
          {
            message: e.message,
            ...("location" in e && typeof e.location === "string" ? { location: e.location } : {}),
          },
        ]
      : [],
  );
  return new ApiError(
    status,
    typeof p.code === "string" ? p.code : "error",
    typeof p.detail === "string" ? p.detail : "",
    typeof p.request_id === "string" ? p.request_id : undefined,
    fields,
    p,
  );
}
