/**
 * Browser API client.
 *
 * All reads and writes go through the API in `api/`; the browser never talks to
 * Postgres directly. Credentials are supplied lazily by the session provider, so
 * a token refresh does not invalidate this client's identity.
 *
 * The demo identity header is the counterpart of `DEMO_ACTOR_HEADER` in
 * `api/_lib/auth.ts` and is only honoured when the server itself is running
 * against the seeded dataset.
 */

import type { CollectionKey, DatabaseState, Role } from "@/types";

const API_BASE = "/api";
const DEMO_ACTOR_HEADER = "x-smartmedic-actor";

export interface ApiCredentials {
  /** Supabase access token, absent in demo mode. */
  token: string | null;
  /** Seeded identity to act as, used only in demo mode. */
  demoActor: string | null;
}

/** A transport or domain failure reported by the API. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ProfileView {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  staffId: string | null;
  patientId: string | null;
  isActive: boolean;
  lastLogin: string | null;
}

/** Rows the server has committed, for the client to merge into its state. */
export interface AppliedPatch {
  collections: Partial<Record<CollectionKey, unknown[]>>;
  counters?: Record<string, number>;
}

export interface BootstrapPayload {
  profile: ProfileView;
  db: DatabaseState;
  mode: "supabase" | "demo";
}

export interface DemoProfileView {
  id: string;
  fullName: string;
  role: Role;
  email: string;
}

export interface ApiClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  post(path: string, body?: unknown): Promise<AppliedPatch>;
  patch(path: string, body?: unknown): Promise<AppliedPatch>;
  bootstrap(): Promise<BootstrapPayload>;
  demoProfiles(): Promise<DemoProfileView[]>;
  resetDemo(): Promise<{ db: DatabaseState; counters: Record<string, number> }>;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; requestId?: string };
}

export function createApiClient(readCredentials: () => ApiCredentials): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { token, demoActor } = readCredentials();

    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    if (demoActor) headers[DEMO_ACTOR_HEADER] = demoActor;

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new ApiError(
        0,
        "network",
        "Could not reach the SmartMedic API. Check that the server is running and that this origin is allowed.",
      );
    }

    let envelope: Envelope<T> | null = null;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      envelope = null;
    }

    if (!response.ok || !envelope?.success) {
      throw new ApiError(
        response.status,
        envelope?.error?.code ?? "request_failed",
        envelope?.error?.message ?? `The request failed with status ${response.status}.`,
        envelope?.error?.requestId,
      );
    }

    return envelope.data as T;
  }

  /** Mutations answer with the rows the server committed. */
  async function mutate(method: string, path: string, body?: unknown): Promise<AppliedPatch> {
    const data = await request<{ applied?: AppliedPatch }>(method, path, body);
    return data.applied ?? { collections: {} };
  }

  return {
    request,
    post: (path, body) => mutate("POST", path, body),
    patch: (path, body) => mutate("PATCH", path, body),
    bootstrap: () => request<BootstrapPayload>("GET", "/bootstrap"),
    demoProfiles: async () => {
      const data = await request<{ profiles: DemoProfileView[] }>("GET", "/demo/profiles");
      return data.profiles;
    },
    resetDemo: () => request<{ db: DatabaseState; counters: Record<string, number> }>("POST", "/demo/reset"),
  };
}

/** Human-readable text for any failure surfaced to the operator. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}
