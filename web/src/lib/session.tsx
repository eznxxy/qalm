"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { api, setAccessToken, setRefreshHandler } from "@/lib/endpoints";
import { AuthSession, User } from "@/lib/api-types";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

export interface BootstrapCredentials {
  name: string;
  email: string;
  password: string;
}

interface SessionContextValue {
  user: User | null;
  status: SessionStatus;
  login: (email: string, password: string) => Promise<User>;
  bootstrap: (credentials: BootstrapCredentials) => Promise<User>;
  logout: () => Promise<void>;
  /** Update the cached user after a successful PATCH /auth/me. */
  setUser: (user: User) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Refresh this many seconds before the access token actually expires. */
const REFRESH_MARGIN_SECONDS = 60;
/** Never schedule a refresh sooner than this, even with tiny expires_in. */
const MIN_REFRESH_DELAY_MS = 5_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRefresh = useRef<Promise<string | null> | null>(null);
  const refreshRef = useRef<() => Promise<string | null>>(async () => null);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimer.current !== null) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback(
    (expiresInSeconds: number) => {
      clearRefreshTimer();
      const delayMs = Math.max(
        (expiresInSeconds - REFRESH_MARGIN_SECONDS) * 1000,
        MIN_REFRESH_DELAY_MS
      );
      refreshTimer.current = setTimeout(() => {
        void refreshRef.current();
      }, delayMs);
    },
    [clearRefreshTimer]
  );

  /**
   * Silent refresh. Shared in-flight promise so a burst of 401s (or the
   * proactive timer racing an interceptor retry) triggers exactly one
   * POST /auth/refresh — the contract rotates the cookie on every use, so
   * concurrent refreshes would trip the replay defense.
   */
  const refreshSilently = useCallback(async (): Promise<string | null> => {
    if (inFlightRefresh.current) return inFlightRefresh.current;
    const promise = (async () => {
      try {
        const result = await api.refresh();
        setAccessToken(result.access_token);
        scheduleRefresh(result.expires_in);
        return result.access_token;
      } catch {
        // Refresh failed → the session is dead: logged-out state.
        clearRefreshTimer();
        setAccessToken(null);
        setUserState(null);
        setStatus("unauthenticated");
        return null;
      } finally {
        inFlightRefresh.current = null;
      }
    })();
    inFlightRefresh.current = promise;
    return promise;
  }, [scheduleRefresh, clearRefreshTimer]);

  useEffect(() => {
    refreshRef.current = refreshSilently;
  }, [refreshSilently]);

  const applySession = useCallback(
    (session: AuthSession) => {
      setAccessToken(session.access_token);
      setUserState(session.user);
      setStatus("authenticated");
      scheduleRefresh(session.expires_in);
    },
    [scheduleRefresh]
  );

  // Bootstrap the session on mount: try a silent refresh first — a valid
  // refresh cookie restores the session across reloads and yields expires_in
  // for the proactive timer. The refresh response carries no user payload per
  // the contract, so GET /auth/me follows on success. refreshSilently()
  // already flips to the logged-out state on failure.
  useEffect(() => {
    setRefreshHandler(() => refreshRef.current());
    let cancelled = false;
    void (async () => {
      const token = await refreshSilently();
      if (!token || cancelled) return;
      try {
        const me = await api.me();
        if (!cancelled) {
          setUserState(me);
          setStatus("authenticated");
        }
      } catch {
        if (!cancelled) {
          setAccessToken(null);
          setUserState(null);
          setStatus("unauthenticated");
        }
      }
    })();
    return () => {
      cancelled = true;
      clearRefreshTimer();
    };
  }, [refreshSilently, clearRefreshTimer]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api.login({ email, password });
      applySession(session);
      return session.user;
    },
    [applySession]
  );

  const bootstrap = useCallback(
    async (credentials: BootstrapCredentials) => {
      const session = await api.bootstrap(credentials);
      applySession(session);
      return session.user;
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Best-effort: the server call may already be dead; clear locally regardless.
    }
    clearRefreshTimer();
    setAccessToken(null);
    setUserState(null);
    setStatus("unauthenticated");
  }, [clearRefreshTimer]);

  const setUser = useCallback((next: User) => setUserState(next), []);

  const value = useMemo(
    () => ({ user, status, login, bootstrap, logout, setUser }),
    [user, status, login, bootstrap, logout, setUser]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return ctx;
}
