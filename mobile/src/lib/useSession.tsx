/**
 * useSession Hook
 *
 * Provides access to the current Better Auth session.
 * Re-exports the useAuth hook from BetterAuthProvider for convenience.
 */

import { useAuth } from "./BetterAuthProvider";
import { useQueryClient } from "@tanstack/react-query";

// Re-export useAuth as useSession for backwards compatibility
export const useSession = () => {
  const { session, user, isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();

  return {
    data: user ? { user, session } : null,
    isPending: isLoading,
    error: null,
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-session"] });
    },
  };
};
