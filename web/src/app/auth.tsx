import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useDb } from "@/db/context";
import { getMeta, META, setMeta } from "@/db/meta";
import { ApiError, api, toApiError } from "@/lib/api";
import { AccessExpired, NetworkError } from "@/sync/errors";

export type AuthStatus = "loading" | "authed" | "anon" | "access";

interface AuthValue {
  status: AuthStatus;
  email: string | null;
  /** Authenticated earlier on this device, but the server could not be reached to confirm. */
  offline: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** The server said the session is gone. Local data stays; the user signs in again. */
  expire(): void;
  recheck(): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const recheck = useCallback(async () => {
    try {
      const res = await api.GET("/auth/me");
      if (res.data) {
        await setMeta(db, META.userId, res.data.user.id);
        await setMeta(db, META.email, res.data.user.email);
        setEmail(res.data.user.email);
        setOffline(false);
        setStatus("authed");
        return;
      }
      if (res.response.status === 401) {
        setStatus("anon");
        return;
      }
      throw toApiError(res.response.status, res.error);
    } catch (err) {
      const cachedUser = await getMeta<string>(db, META.userId);
      if (err instanceof AccessExpired) {
        setStatus("access");
      } else if ((err instanceof NetworkError || err instanceof ApiError) && cachedUser) {
        // Only a 401 ends the session. A 429 or 5xx means the server could not confirm it right now.
        setEmail((await getMeta<string>(db, META.email)) ?? null);
        setOffline(true);
        setStatus("authed");
      } else {
        setStatus("anon");
        setOffline(err instanceof NetworkError);
      }
    }
  }, [db]);

  useEffect(() => {
    void recheck();
  }, [recheck]);

  const login = useCallback(
    async (emailIn: string, password: string) => {
      const res = await api.POST("/auth/login", { body: { email: emailIn, password } });
      if (!res.data) throw toApiError(res.response.status, res.error);
      await recheck();
    },
    [recheck],
  );

  const logout = useCallback(async () => {
    try {
      await api.POST("/auth/logout");
    } catch {
      // Signing out locally still works when the server is unreachable.
    }
    setStatus("anon");
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, email, offline, login, logout, expire: () => setStatus("anon"), recheck }),
    [status, email, offline, login, logout, recheck],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth needs an AuthProvider");
  return v;
}

export { ApiError };
