/**
 * Ensure Profile Exists
 *
 * Utility to ensure a user profile exists after successful authentication.
 * This prevents race conditions where auth succeeds but the profile hasn't
 * been created yet in the backend.
 *
 * Flow:
 * 1. Fetch the profile from backend
 * 2. If profile exists → return it
 * 3. If no profile (first time user) → backend creates it
 * 4. Retry up to 4 times with exponential backoff
 * 5. If still missing after retries → return error
 *
 * TIMEOUT: 30 seconds max (handles backend cold starts)
 */

import { api } from "./api";
import type { GetProfileResponse } from "@/lib/contracts";

const MAX_RETRIES = 4;
const INITIAL_RETRY_DELAY_MS = 1500;
const PROFILE_TIMEOUT_MS = 30000; // 30 second timeout to handle backend cold starts

interface EnsureProfileResult {
  success: boolean;
  profile: GetProfileResponse["profile"] | null;
  isComplete: boolean;
  error?: string;
  errorType?: "timeout" | "network" | "auth" | "unknown";
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a timeout promise that rejects after specified ms
 */
function createTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Profile load timed out after ${ms / 1000} seconds`)), ms);
  });
}

/**
 * Fetch the profile, with the backend creating it if it doesn't exist.
 * The backend's GET /api/profile endpoint already handles upsert.
 */
async function fetchProfile(): Promise<GetProfileResponse> {
  console.log("[ensureProfileExists] Fetching profile from backend (auto-creates if new user)...");
  const startTime = Date.now();
  try {
    const response = await api.get<GetProfileResponse>("/api/profile");
    console.log("[ensureProfileExists] Profile fetched/created in", Date.now() - startTime, "ms:", {
      id: response.profile?.id ?? "null",
      isComplete: response.isComplete,
      firstName: response.profile?.firstName ?? "(not set)",
    });
    return response;
  } catch (error) {
    console.log("[ensureProfileExists] Profile fetch/create failed in", Date.now() - startTime, "ms:", error);
    throw error;
  }
}

/**
 * Classify error type for better UX messaging
 */
function classifyError(error: Error): EnsureProfileResult["errorType"] {
  const msg = error.message.toLowerCase();

  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "timeout";
  }
  if (msg.includes("unauthorized") || msg.includes("401")) {
    return "auth";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("connection")) {
    return "network";
  }
  return "unknown";
}

/**
 * Ensures that a user profile exists in the database.
 *
 * This should be called after successful authentication (both signup and login)
 * to ensure the profile is created before navigating to the app.
 *
 * Features:
 * - 30 second timeout to handle backend cold starts
 * - 4 retry attempts with exponential backoff
 * - Error classification for better UX
 *
 * @param isNewSignup - If true, auth errors are retried (token may not be ready yet)
 * @returns EnsureProfileResult with success status and profile data
 */
export async function ensureProfileExists(isNewSignup = false): Promise<EnsureProfileResult> {
  let lastError: string | undefined;
  let lastErrorType: EnsureProfileResult["errorType"] = "unknown";
  const startTime = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[ensureProfileExists] Attempt ${attempt}/${MAX_RETRIES} (isNewSignup: ${isNewSignup})`);

      const elapsed = Date.now() - startTime;
      const remainingTimeout = PROFILE_TIMEOUT_MS - elapsed;

      if (remainingTimeout <= 0) {
        console.log("[ensureProfileExists] Overall timeout exceeded");
        return {
          success: false,
          profile: null,
          isComplete: false,
          error: "Profile load timed out. Please check your connection and try again.",
          errorType: "timeout",
        };
      }

      const data = await Promise.race([
        fetchProfile(),
        createTimeout(Math.min(remainingTimeout, 15000)),
      ]);

      if (data.profile) {
        console.log("[ensureProfileExists] Profile exists:", {
          id: data.profile.id,
          isComplete: data.isComplete,
          firstName: data.profile.firstName ?? "(not set)",
          durationMs: Date.now() - startTime,
        });

        return {
          success: true,
          profile: data.profile,
          isComplete: data.isComplete,
        };
      }

      console.log("[ensureProfileExists] Profile returned null, retrying...");
      lastError = "Profile returned null from backend";
      lastErrorType = "unknown";

    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      const errorType = classifyError(err);

      console.log(`[ensureProfileExists] Attempt ${attempt} failed:`, {
        message: err.message,
        type: errorType,
        durationMs: Date.now() - startTime,
      });

      lastError = err.message;
      lastErrorType = errorType;

      // For auth errors during new signup, the token may not be persisted yet — retry
      if (errorType === "auth") {
        // Always retry auth errors — on sign-in the cookie may not be ready yet,
        // and on signup the token may not have propagated yet.
        // If all retries exhaust with auth errors, we'll return the error below.
        console.log(`[ensureProfileExists] Auth error on attempt ${attempt}, will retry (token may not be ready)`);
      }
    }

    // Exponential backoff: 1.5s, 3s, 4.5s, 6s
    if (attempt < MAX_RETRIES) {
      const backoffMs = INITIAL_RETRY_DELAY_MS * attempt;
      console.log(`[ensureProfileExists] Waiting ${backoffMs}ms before retry...`);
      await delay(backoffMs);
    }
  }

  // All retries exhausted
  const totalDuration = Date.now() - startTime;
  console.log("[ensureProfileExists] All retries exhausted after", totalDuration, "ms");

  // Provide user-friendly error messages
  let userFriendlyError: string;
  switch (lastErrorType) {
    case "network":
      userFriendlyError = "Network error - please check your internet connection and try again.";
      break;
    case "timeout":
      userFriendlyError = "Request timed out - the server may be slow. Please try again.";
      break;
    case "auth":
      userFriendlyError = "Session expired - please sign in again.";
      break;
    default:
      userFriendlyError = lastError ?? "Failed to load profile. Please try again.";
  }

  return {
    success: false,
    profile: null,
    isComplete: false,
    error: userFriendlyError,
    errorType: lastErrorType,
  };
}
