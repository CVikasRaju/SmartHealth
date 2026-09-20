/**
 * Session provider.
 *
 * Owns the credential half of the application: whether anybody is signed in,
 * and what to attach to each API request. It deliberately does not hold the
 * hospital record — `AppStoreProvider` loads that from the API once a session
 * exists, so there is exactly one source of truth for each.
 *
 * Two modes are supported:
 *
 *   supabase — email and password verified by Supabase Auth; the access token
 *              travels with every request.
 *   demo     — no credentials. The operator picks one of the seeded identities,
 *              which is sent as a header that the API only honours when it is
 *              itself running against the seeded dataset.
 *
 * Which one applies is decided by the *API*, not by the build. Vite inlines
 * `VITE_*` variables when the bundle is produced, so a deployment rebuilt without
 * them would otherwise render a sign-in form with nothing to sign in to. The
 * provider therefore asks `/api/health` first — it is the one endpoint that
 * answers before authentication — and falls back to the build-time variables
 * only when the API cannot be reached at all.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ApiError, createApiClient, describeError, type ApiClient, type DemoProfileView } from "@/lib/apiClient";
import { createAuthClient, readClientAuthConfig } from "@/lib/supabaseAuth";

const DEMO_ACTOR_KEY = "smartmedic.demo.actor.v1";

export type SessionMode = "supabase" | "demo";
export type SessionStatus = "loading" | "signed_out" | "signed_in";

/** The subset of `GET /api/health` this provider needs. */
interface HealthPayload {
  mode: SessionMode;
  auth: { url: string; anonKey: string } | null;
}

interface SessionValue {
  status: SessionStatus;
  mode: SessionMode;
  /** True when a Supabase client could be built, so passwords can be checked. */
  configured: boolean;
  /**
   * The API answered, and refused to run because it is missing credentials.
   * Distinct from an unreachable API: this one is a deployment problem with a
   * specific fix, and saying so beats offering a local-only hint.
   */
  apiMisconfigured: boolean;
  api: ApiClient;
  /** Identities the demo sign-in screen offers. */
  demoProfiles: DemoProfileView[];
  demoProfilesLoading: boolean;
  error: string | null;
  signIn(email: string, password: string): Promise<void>;
  signInAs(profileId: string): Promise<void>;
  signOut(): Promise<void>;
  clearError(): void;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Turn Supabase's auth errors into something an operator can act on. */
function describeSignInError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "That email and password combination was not recognised.";
  }
  if (/email not confirmed/i.test(message)) {
    return "This account has not been confirmed. Re-run the seed script to confirm the demo identities.";
  }
  return message;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const buildAuthConfig = useMemo(() => readClientAuthConfig(), []);

  const [status, setStatus] = useState<SessionStatus>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [demoActor, setDemoActor] = useState<string | null>(null);
  const [demoProfiles, setDemoProfiles] = useState<DemoProfileView[]>([]);
  const [demoProfilesLoading, setDemoProfilesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Credentials are read through a ref so the API client keeps a stable
  // identity: a token refresh must not re-trigger a bootstrap.
  const credentials = useRef({ token, demoActor });
  credentials.current = { token, demoActor };
  const api = useMemo(() => createApiClient(() => credentials.current), []);

  /* -------- Which credential model applies -------- */

  const [server, setServer] = useState<{ mode: SessionMode; auth: HealthPayload["auth"] } | null>(null);
  const [apiMisconfigured, setApiMisconfigured] = useState(false);
  const [discoveryDone, setDiscoveryDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void api
      .request<HealthPayload>("GET", "/health")
      .then((payload) => {
        if (!cancelled) setServer({ mode: payload.mode, auth: payload.auth ?? null });
      })
      .catch((cause: unknown) => {
        // The API is unreachable, so the build's own configuration is all there
        // is to go on. A configuration refusal is reported separately, because
        // its fix is a deployment setting rather than a local server.
        if (cancelled) return;
        setServer(null);
        setApiMisconfigured(cause instanceof ApiError && cause.code === "not_configured");
      })
      .finally(() => {
        if (!cancelled) setDiscoveryDone(true);
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  const mode: SessionMode = server?.mode ?? (buildAuthConfig ? "supabase" : "demo");

  // Plain strings rather than an object, so the client below is built once.
  const authUrl = mode === "supabase" ? server?.auth?.url ?? buildAuthConfig?.url ?? null : null;
  const authAnonKey = mode === "supabase" ? server?.auth?.anonKey ?? buildAuthConfig?.anonKey ?? null : null;
  const authClient = useMemo(
    () => (authUrl && authAnonKey ? createAuthClient({ url: authUrl, anonKey: authAnonKey }) : null),
    [authUrl, authAnonKey],
  );

  /* -------- Credential lifecycle -------- */

  useEffect(() => {
    if (!authClient) return;

    let cancelled = false;

    void authClient.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setToken(data.session?.access_token ?? null);
      setStatus(data.session ? "signed_in" : "signed_out");
    });

    const { data: subscription } = authClient.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token ?? null);
      setStatus(session ? "signed_in" : "signed_out");
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [authClient]);

  /* -------- Demo identities -------- */

  useEffect(() => {
    if (!discoveryDone || mode !== "demo") return;

    let cancelled = false;
    setDemoProfilesLoading(true);

    void api
      .demoProfiles()
      .then((profiles) => {
        if (cancelled) return;
        setDemoProfiles(profiles);

        // Always start on the sign-in page so the user can select their role
        setStatus("signed_out");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(describeError(cause));
        setStatus("signed_out");
      })
      .finally(() => {
        if (!cancelled) setDemoProfilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, discoveryDone, mode]);

  /* -------- Actions -------- */

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!authClient) {
        throw new Error(
          "This deployment has no browser authentication configuration, so password sign-in is unavailable.",
        );
      }
      setError(null);
      const { error: signInError } = await authClient.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        const message = describeSignInError(signInError.message);
        setError(message);
        throw new Error(message);
      }
    },
    [authClient],
  );

  const signInAs = useCallback(async (profileId: string) => {
    window.localStorage.setItem(DEMO_ACTOR_KEY, profileId);
    setDemoActor(profileId);
    setError(null);
    setStatus("signed_in");
  }, []);

  const signOut = useCallback(async () => {
    if (authClient) {
      await authClient.auth.signOut();
      setToken(null);
    }
    window.localStorage.removeItem(DEMO_ACTOR_KEY);
    setDemoActor(null);
    setStatus("signed_out");
  }, [authClient]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      mode,
      configured: Boolean(authClient),
      apiMisconfigured,
      api,
      demoProfiles,
      demoProfilesLoading,
      error,
      signIn,
      signInAs,
      signOut,
      clearError: () => setError(null),
    }),
    [
      api,
      apiMisconfigured,
      authClient,
      demoProfiles,
      demoProfilesLoading,
      error,
      mode,
      signIn,
      signInAs,
      signOut,
      status,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside a SessionProvider");
  }
  return context;
}

export { ApiError };
