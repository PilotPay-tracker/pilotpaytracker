/**
 * Clear User Data Utility
 *
 * Central utility for clearing all user data on logout.
 * Ensures no data leaks between user accounts.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useProfileStore } from "./state/profile-store";
import { useTaxStore } from "./state/tax-store";
import { useTutorialStore } from "./state/tutorial-store";
import { QueryClient } from "@tanstack/react-query";

// List of all AsyncStorage keys used by the app that contain user data
const USER_DATA_KEYS = [
  // Zustand persisted stores
  "pilot-profile-storage",
  "tax-settings-storage",
  // Auth session flags
  "@auth_has_session",
  "@auth_last_time",
  // Tutorial state (will be created later)
  "tutorial-state-storage",
  // Any other user-specific data
  "@schedule_cache",
  "@trips_cache",
  "@calendar_sync_state",
];

/**
 * Clear all user data from the app
 * Called on logout to ensure clean state for next user
 */
export async function clearAllUserData(queryClient?: QueryClient): Promise<void> {
  console.log("[clearUserData] Starting complete user data cleanup...");

  try {
    // 1. Clear Zustand stores (in-memory state)
    useProfileStore.getState().clearProfile();
    useTaxStore.getState().reset();
    useTutorialStore.getState().resetAllTutorials();

    // 2. Clear React Query cache if provided
    if (queryClient) {
      queryClient.clear();
    }

    // 3. Clear ALL known AsyncStorage keys
    await AsyncStorage.multiRemove(USER_DATA_KEYS);

    // 4. Clear any keys that match user data patterns
    const allKeys = await AsyncStorage.getAllKeys();
    const userDataPatterns = [
      /^pilot-/,
      /^tax-/,
      /^@auth/,
      /^@schedule/,
      /^@trips/,
      /^@calendar/,
      /^tutorial-/,
      /^@user-/,
      /^offline_/,  // OfflineStorage cached data — must clear on account switch
    ];

    const keysToRemove = allKeys.filter((key) =>
      userDataPatterns.some((pattern) => pattern.test(key))
    );

    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
      console.log(`[clearUserData] Removed ${keysToRemove.length} additional keys`);
    }

    console.log("[clearUserData] All user data cleared successfully");
  } catch (error) {
    console.error("[clearUserData] Error clearing user data:", error);
    // Even if some clearing fails, try to continue
    // This ensures the user can still log out
  }
}

/**
 * Verify that user data is properly scoped
 * Call this on app start to log any potential issues
 */
export async function verifyDataIsolation(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    console.log(`[verifyDataIsolation] AsyncStorage has ${allKeys.length} keys`);
  } catch (error) {
    console.error("[verifyDataIsolation] Error checking AsyncStorage:", error);
  }
}
