import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import type * as Auth from "@/lib/_core/auth";

type AuthContextValue = {
  user: Auth.User | null;
  loading: boolean;
  isAuthenticated: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  isAuthenticated: false,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth({ autoFetch: true });
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  return useContext(AuthContext);
}
