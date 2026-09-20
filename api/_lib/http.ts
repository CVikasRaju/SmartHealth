/**
 * Request/response contract shared by the Vercel function entry point and the
 * local development server.
 *
 * Handlers are plain async functions over a typed context rather than Express
 * middleware, which keeps them directly testable: a test can call `routeRequest`
 * with a fabricated context and assert on the returned status and body.
 */

import type { Role } from "../../src/types";
import type { ApiConfig } from "./config";
import type { ProfileRecord, Repository } from "./repo/types";

/** Any failure that should be reported to the client as a status + code pair. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HttpError";
  }
}

/**
 * Query parameter carrying the matched route.
 *
 * `vercel.json` rewrites `/api/*` onto the single function in `api/index.ts`
 * and names the route it matched here. A non-Next project has no catch-all file
 * routing, so this is what tells the function which endpoint was called — and
 * it keeps that independent of whether the platform preserves the request path
 * through a rewrite. Must stay in step with the rewrite in `vercel.json`.
 */
export const ROUTE_PARAM = "__route";

export interface ApiRequest {
  /** Upper-cased HTTP method. */
  method: string;
  /** Path with the `/api` prefix removed, e.g. `/patients/patient-1`. */
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
  /** Bearer token presented by the caller, already trimmed. */
  token: string | null;
  requestId: string;
}

export interface RequestContext {
  config: ApiConfig;
  repo: Repository;
  req: ApiRequest;
  /** Named segments extracted from the route pattern. */
  params: Record<string, string>;
  /** Authenticated caller. */
  actor: ProfileRecord;
  /** Audit identity, matching the client's `ActorRef` shape. */
  actorRef: { id: string; name: string; role: Role };
}

export interface RouteResult {
  status: number;
  body: unknown;
}

export type RouteHandler = (ctx: RequestContext) => Promise<RouteResult> | RouteResult;

export const ok = (body: unknown, status = 200): RouteResult => ({ status, body });

/* ------------------------------------------------------------------ */
/* Authorisation helpers                                               */
/* ------------------------------------------------------------------ */

export function requireRole(ctx: RequestContext, roles: Role[]): void {
  if (!roles.includes(ctx.actor.role)) {
    throw new HttpError(
      403,
      "forbidden",
      `The ${ctx.actor.role} role may not perform this action. Permitted: ${roles.join(", ")}.`,
    );
  }
}

/**
 * The patient portal may only ever touch its own record. Staff acting on a
 * patient are unrestricted here because their role already implies it.
 */
export function requirePatientScope(ctx: RequestContext, patientId: string): void {
  if (ctx.actor.role !== "patient") return;
  if (ctx.actor.patientId !== patientId) {
    throw new HttpError(403, "forbidden", "A patient account may only access its own records.");
  }
}

/* ------------------------------------------------------------------ */
/* Body validation                                                     */
/* ------------------------------------------------------------------ */

export function readBody(ctx: RequestContext): Record<string, unknown> {
  const body = ctx.req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_body", "Expected a JSON object body.");
  }
  return body as Record<string, unknown>;
}

export function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "invalid_body", `Field "${key}" must be a non-empty string.`);
  }
  return value;
}

export function optionalString(source: Record<string, unknown>, key: string, fallback = ""): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

export function requireNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  throw new HttpError(400, "invalid_body", `Field "${key}" must be a number.`);
}

export function optionalEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = source[key];
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  return fallback;
}

export function requireEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = source[key];
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new HttpError(400, "invalid_body", `Field "${key}" must be one of: ${allowed.join(", ")}.`);
}

export function requireObject(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_body", `Field "${key}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function requireArray(source: Record<string, unknown>, key: string): unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new HttpError(400, "invalid_body", `Field "${key}" must be an array.`);
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Request construction                                                */
/* ------------------------------------------------------------------ */

/** Response headers applied to every API reply. */
export const API_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function newRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `req-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Normalise a raw HTTP request into an `ApiRequest`. Shared by the Vercel
 * function entry point and the local development server so both agree on how a
 * path, header, and token are interpreted.
 */
export function buildApiRequest(input: {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}): ApiRequest {
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input.headers)) {
    if (raw === undefined) continue;
    headers[key.toLowerCase()] = Array.isArray(raw) ? raw.join(", ") : raw;
  }

  const url = input.url && input.url.length > 0 ? input.url : "/";
  const [rawPath, rawQuery = ""] = url.split("?");
  const query = new URLSearchParams(rawQuery);

  // Prefer the route the rewrite matched. Failing that — the local dev server,
  // or a runtime that passes the original path straight through — the function
  // is mounted at /api, so the router works on the remaining path.
  const rewritten = query.get(ROUTE_PARAM);
  query.delete(ROUTE_PARAM);

  let path = rewritten
    ? `/${rewritten.replace(/^\/+/, "").split("?")[0]}`
    : rawPath.replace(/^\/api(?=\/|$)/, "");
  if (path.length === 0) path = "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  const authorization = headers.authorization ?? "";
  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : null;

  return {
    method: (input.method ?? "GET").toUpperCase(),
    path,
    query,
    headers,
    body: input.body ?? null,
    token: token && token.length > 0 ? token : null,
    requestId: headers["x-request-id"] ?? newRequestId(),
  };
}
