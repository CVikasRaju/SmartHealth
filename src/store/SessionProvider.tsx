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

interface SessionValue {
  status: SessionStatus;
  mode: SessionMode;
  /** True when Supabase credentials are present in the build. */
  configured: boolean;
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
  const authConfig = useMemo(() => readClientAuthConfig(), []);
  const authClient = useMemo(() => (authConfig ? createAuthClient(authConfig) : null), [authConfig]);
  const mode: SessionMode = authClient ? "supabase" : "demo";

  const [status, setStatus] = useState<SessionStatus>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [demoActor, setDemoActor] = useState<string | null>(null);
  const [demoProfiles, setDemoProfiles] = useState<DemoProfileView[]>([]);
  const [demoProfilesLoading, setDemoProfilesLoading] = useState(mode === "demo");
  const [error, setError] = useState<string | null>(null);

  // Credentials are read through a ref so the API client keeps a stable
  // identity: a token refresh must not re-trigger a bootstrap.
  const credentials = useRef({ token, demoActor });
  credentials.current = { token, demoActor };
  const api = useMemo(() => createApiClient(() => credentials.current), []);

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
    if (mode !== "demo") return;

    let cancelled = false;
    void api
      .demoProfiles()
      .then((profiles) => {
        if (cancelled) return;
        setDemoProfiles(profiles);

        const stored = window.localStorage.getItem(DEMO_ACTOR_KEY);
        if (stored && profiles.some((profile) => profile.id === stored)) {
          setDemoActor(stored);
          setStatus("signed_in");
        } else {
          setStatus("signed_out");
        }
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
  }, [api, mode]);

  /* -------- Actions -------- */

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!authClient) {
        throw new Error("This build has no Supabase configuration, so password sign-in is unavailable.");
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
      configured: Boolean(authConfig),
      api,
      demoProfiles,
      demoProfilesLoading,
      error,
      signIn,
      signInAs,
      signOut,
      clearError: () => setError(null),
    }),
    [api, authConfig, demoProfiles, demoProfilesLoading, error, mode, signIn, signInAs, signOut, status],
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
