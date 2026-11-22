import {
  createContext,
  type ReactNode,
  useCallback,
  use,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useDb } from "@/db/context";
import { getMeta, META, setMeta } from "@/db/meta";
import { wipeLocal } from "@/features/settings/dataTools";
import { ApiError, api, toApiError } from "@/lib/api";
import { solveChallenge } from "@/lib/pow";
import { AccessExpired, NetworkError } from "@/sync/errors";

type AuthStatus = "loading" | "authed" | "anon" | "access";

/**
 * One state, so a username can never exist without a session and "offline" only exists where it means something:
 * authed + offline is a device that was signed in earlier and could not reach the server to confirm; anon + offline is
 * a sign-in screen shown because the network is down.
 */
type AuthState =
  | { status: "loading" }
  | { status: "authed"; username: string | null; codesSaved: boolean | null; offline: boolean }
  | { status: "anon"; offline: boolean }
  | { status: "access" };

const SIGNED_OUT: AuthState = { status: "anon", offline: false };

interface AuthValue {
  status: AuthStatus;
  username: string | null;
  /** False until the person confirms they saved their recovery codes; null when the server could not be asked. */
  codesSaved: boolean | null;
  /** Authenticated earlier on this device, but the server could not be reached to confirm. */
  offline: boolean;
  login(username: string, password: string): Promise<void>;
  /** Creates the account and starts its session. Call `recheck` once the person has saved the returned codes. */
  signup(username: string, password: string): Promise<string[]>;
  resetPassword(username: string, recoveryCode: string, newPassword: string): Promise<void>;
  logout(): Promise<void>;
  /** The server said the session is gone. Local data stays; the user signs in again. */
  expire(): void;
  recheck(): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const recheck = useCallback(async () => {
    try {
      const res = await api.GET("/auth/me");
      if (res.data) {
        // One browser database serves every account on this device, so another account never sees or syncs these rows.
        const previous = await getMeta<string>(db, META.userId);
        if (previous && previous !== res.data.user.id) await wipeLocal(db, { everything: false });
        await setMeta(db, META.userId, res.data.user.id);
        await setMeta(db, META.username, res.data.user.username);
        setState({
          status: "authed",
          username: res.data.user.username,
          codesSaved: res.data.recovery_codes_saved,
          offline: false,
        });
        return;
      }
      if (res.response.status === 401) {
        setState(SIGNED_OUT);
        return;
      }
      throw toApiError(res.response.status, res.error);
    } catch (err) {
      const cachedUser = await getMeta<string>(db, META.userId);
      if (err instanceof AccessExpired) {
        setState({ status: "access" });
      } else if ((err instanceof NetworkError || err instanceof ApiError) && cachedUser) {
        // Only a 401 ends the session. A 429 or 5xx means the server could not confirm it right now.
        const username = (await getMeta<string>(db, META.username)) ?? null;
        setState({ status: "authed", username, codesSaved: null, offline: true });
      } else {
        setState({ status: "anon", offline: err instanceof NetworkError });
      }
    }
  }, [db]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the session check is an external fetch; state is set after the await
    void recheck();
  }, [recheck]);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.POST("/auth/login", { body: { username, password } });
      if (!res.data) throw toApiError(res.response.status, res.error);
      await recheck();
    },
    [recheck],
  );

  const signup = useCallback(async (username: string, password: string) => {
    const challenge = await api.GET("/auth/challenge");
    if (!challenge.data) throw toApiError(challenge.response.status, challenge.error);
    const counter = await solveChallenge(challenge.data);
    const res = await api.POST("/auth/signup", {
      body: { username, password, challenge: challenge.data, counter },
    });
    if (!res.data) throw toApiError(res.response.status, res.error);
    return res.data.recovery_codes;
  }, []);

  const resetPassword = useCallback(
    async (username: string, recoveryCode: string, newPassword: string) => {
      const res = await api.POST("/auth/reset", {
        body: { username, recovery_code: recoveryCode, new_password: newPassword },
      });
      if (!res.response.ok) throw toApiError(res.response.status, res.error);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.POST("/auth/logout");
    } catch {
      // Signing out locally still works when the server is unreachable.
    }
    setState(SIGNED_OUT);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status: state.status,
      username: state.status === "authed" ? state.username : null,
      codesSaved: state.status === "authed" ? state.codesSaved : null,
      offline: (state.status === "authed" || state.status === "anon") && state.offline,
      login,
      signup,
      resetPassword,
      logout,
      expire: () => setState(SIGNED_OUT),
      recheck,
    }),
    [state, login, signup, resetPassword, logout, recheck],
  );
  return <Ctx value={value}>{children}</Ctx>;
}

export function useAuth(): AuthValue {
  const v = use(Ctx);
  if (!v) throw new Error("useAuth needs an AuthProvider");
  return v;
}

export { ApiError };
