import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, type User } from "firebase/auth";
import { firebaseAuth } from "../config/firebase";
import { transitionAccountScope } from "../services/api/accountScope";
import { getApplicationSession, type ApplicationSession } from "../services/api/session";

type SessionState =
  | { status: "checking"; session: null; error: null }
  | { status: "anonymous"; session: null; error: null }
  | { status: "authenticated"; session: ApplicationSession; error: null }
  | { status: "error"; session: null; error: unknown };

type SessionContextValue = SessionState & {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "checking", session: null, error: null });
  const requestNumber = useRef(0);
  const activeRequest = useRef<AbortController | undefined>(undefined);

  const loadSession = useCallback(async (user: User | null) => {
    const sequence = ++requestNumber.current;
    activeRequest.current?.abort();
    transitionAccountScope(user?.uid ?? null);
    if (!user) {
      setState({ status: "anonymous", session: null, error: null });
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ status: "checking", session: null, error: null });
    try {
      const session = await getApplicationSession(controller.signal);
      if (sequence === requestNumber.current) setState({ status: "authenticated", session, error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (sequence === requestNumber.current) setState({ status: "error", session: null, error });
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => { void loadSession(user); });
    return () => { activeRequest.current?.abort(); unsubscribe(); };
  }, [loadSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(firebaseAuth, email, password);
  }, []);

  const signOut = useCallback(async () => {
    transitionAccountScope(null);
    await firebaseSignOut(firebaseAuth);
  }, []);

  const retry = useCallback(async () => loadSession(firebaseAuth.currentUser), [loadSession]);

  return <SessionContext.Provider value={{ ...state, signIn, signOut, retry }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider.");
  return value;
}
