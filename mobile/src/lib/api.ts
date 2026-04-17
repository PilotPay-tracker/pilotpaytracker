/**
 * API Client Module
 *
 * This module provides a centralized API client for making HTTP requests to the backend.
 * It handles authentication, request formatting, error handling, and response parsing.
 *
 * Uses Better Auth for authentication tokens.
 */

// Import fetch from expo/fetch for React Native compatibility
// This ensures fetch works correctly across different platforms (iOS, Android, Web)
import { fetch } from "expo/fetch";
import { Platform } from "react-native";

// Import Better Auth helpers for authentication
import { getAuthCookieHeader, getWebSessionToken } from "./authClient";

/**
 * Backend URL Configuration
 *
 * The backend URL is dynamically set by the Vibecode environment at runtime.
 * Format: https://[UNIQUE_ID].share.sandbox.dev/
 * This allows the app to connect to different backend instances without code changes.
 */
const getBackendUrl = (): string => {
  // On web (browser), MUST use relative paths so all requests go through the
  // same-origin Vercel proxy (/api/*). Calling the backend domain directly is
  // cross-origin — the browser will NOT send session cookies, causing 401s.
  if (Platform.OS === "web") {
    console.log("[API] Web mode — using relative paths (same-origin proxy)");
    return "";
  }
  // EXPO_PUBLIC_PRODUCTION_API_URL must be the server ORIGIN only
  // (e.g. https://pilotpaytracker.com, NOT https://pilotpaytracker.com/api).
  // API paths already include /api/... so appending /api from the base URL
  // doubles the prefix → 404 on every native request.
  const productionUrl = process.env.EXPO_PUBLIC_PRODUCTION_API_URL;
  if (productionUrl && productionUrl.startsWith("https://")) {
    // Defensive: strip any accidental trailing /api suffix
    const normalized = productionUrl.replace(/\/api\/?$/, "");
    if (normalized !== productionUrl) {
      console.warn("[API] EXPO_PUBLIC_PRODUCTION_API_URL had trailing /api — stripped. Fix the env var to avoid this warning.");
    }
    console.log("[API] Using production URL:", normalized);
    return normalized;
  }
  // EXPO_PUBLIC_VIBECODE_BACKEND_URL is injected by Vibecode's reverse proxy —
  // fallback for Vibecode sandbox development environments only.
  const vibecodeUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL;
  if (vibecodeUrl && vibecodeUrl.startsWith("http")) {
    console.log("[API] Using Vibecode sandbox URL:", vibecodeUrl);
    return vibecodeUrl;
  }
  // Fallback: local dev
  console.log("[API] Using localhost fallback");
  return "http://localhost:3000";
};

const BACKEND_URL = getBackendUrl();
console.log("[API] Using backend URL:", BACKEND_URL);

// Request timeout in milliseconds (15 seconds)
const REQUEST_TIMEOUT = 15000;

// Extra long timeout for AI-heavy operations like schedule parsing (5 minutes)
const AI_TIMEOUT = 300000;

// Upload timeout (2 minutes)
const UPLOAD_TIMEOUT = 120000;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

type FetchOptions = {
  method: HttpMethod;
  body?: object;
  timeout?: number;
};

/**
 * Create an AbortController with timeout
 */
function createTimeoutController(timeoutMs: number): { controller: AbortController; timeoutId: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

/**
 * Get the current auth headers for API requests.
 * - On web: use Bearer token from localStorage (avoids cross-origin cookie issues)
 * - On native: use the cookie stored by the expoClient plugin in SecureStore
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  if (Platform.OS === "web") {
    const token = getWebSessionToken();
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
    // No stored token yet — rely on browser cookie jar via credentials: "include"
    return {};
  }
  const cookie = await getAuthCookieHeader();
  return cookie ? { Cookie: cookie } : {};
}

/**
 * Core Fetch Function
 *
 * A generic, type-safe wrapper around the fetch API that handles all HTTP requests.
 */
const fetchFn = async <T>(path: string, options: FetchOptions): Promise<T> => {
  const { method, body, timeout = REQUEST_TIMEOUT } = options;

  // Get authentication cookie from Better Auth
  const authHeaders = await getAuthHeaders();

  // Create timeout controller
  const { controller, timeoutId } = createTimeoutController(timeout);

  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
      signal: controller.signal,
    });

    // Clear timeout on successful response
    clearTimeout(timeoutId);

    if (!response.ok) {
      // Try to parse error details
      let errorData: { error?: string; message?: string } = {};
      try {
        errorData = await response.json();
      } catch {
        // Response wasn't JSON
      }

      let errorMessage = errorData.error || errorData.message || response.statusText;

      // Translate unhelpful HTTP status messages into actionable ones
      if (
        response.status === 404 ||
        errorMessage.toLowerCase() === "not found" ||
        errorMessage.toLowerCase() === "cannot post" ||
        errorMessage.toLowerCase() === "cannot get"
      ) {
        errorMessage = "Service temporarily unavailable. Please try again in a moment.";
      } else if (response.status === 503 || response.status === 502 || response.status === 504) {
        errorMessage = "Server is temporarily unavailable. Please try again.";
      }

      // Create a more informative error
      const error = new Error(errorMessage);
      (error as any).status = response.status;
      (error as any).statusText = response.statusText;
      throw error;
    }

    return response.json() as Promise<T>;
  } catch (error: any) {
    clearTimeout(timeoutId);

    // Handle specific error types
    if (error.name === "AbortError") {
      console.log(`[API] Request timeout: ${path}`);
      throw new Error("Request timed out. Please check your internet connection.");
    }

    if (error.message?.includes("Network request failed") ||
        error.message?.includes("Failed to fetch") ||
        error.message?.includes("network")) {
      console.log(`[API] Network error: ${path}`, error.message);
      throw new Error("Connection error. Please check your internet connection.");
    }

    console.log(`[API] Error on ${path}:`, error.message);
    throw error;
  }
};

/**
 * API Client Object
 */
const api = {
  get: <T>(path: string, timeout?: number) => fetchFn<T>(path, { method: "GET", timeout }),
  post: <T>(path: string, body?: object, timeout?: number) => fetchFn<T>(path, { method: "POST", body, timeout }),
  put: <T>(path: string, body?: object, timeout?: number) => fetchFn<T>(path, { method: "PUT", body, timeout }),
  patch: <T>(path: string, body?: object, timeout?: number) => fetchFn<T>(path, { method: "PATCH", body, timeout }),
  delete: <T>(path: string, timeout?: number) => fetchFn<T>(path, { method: "DELETE", timeout }),
};

// Long timeout for operations that may take longer (30 seconds)
const LONG_TIMEOUT = 30000;

/**
 * Post with retry logic for critical operations
 * Retries on transient failures (network errors, timeouts)
 */
async function postWithRetry<T>(
  path: string,
  body?: object,
  options?: { maxRetries?: number; timeout?: number }
): Promise<T> {
  const { maxRetries = 2, timeout = LONG_TIMEOUT } = options ?? {};

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFn<T>(path, { method: "POST", body, timeout });
    } catch (error: any) {
      lastError = error;

      // Only retry on transient errors
      const isRetryable =
        error.name === "AbortError" ||
        error.message?.includes("fetch failed") ||
        error.message?.includes("canceled") ||
        error.message?.includes("network") ||
        error.message?.includes("timed out");

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      console.log(`[API] Retrying ${path}... (${maxRetries - attempt} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
    }
  }

  throw lastError;
}

export { postWithRetry, LONG_TIMEOUT, AI_TIMEOUT };

export { api, BACKEND_URL };

/**
 * Upload File with Authentication
 */
export async function uploadWithAuth<T>(path: string, formData: FormData): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const { controller, timeoutId } = createTimeoutController(60000); // 60s for uploads

  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      body: formData,
      headers: {
        ...authHeaders,
      },
      credentials: "include",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(errorData.error || `Upload failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === "AbortError") {
      throw new Error("Upload timed out. Please try again.");
    }

    throw error;
  }
}

/**
 * Upload Image via Base64 with retry logic
 */
export async function uploadImageBase64(
  base64: string,
  mimeType: string = "image/jpeg",
  retryCount: number = 0
): Promise<{ success: boolean; url: string; filename: string }> {
  const MAX_RETRIES = 2;
  const authHeaders = await getAuthHeaders();
  const { controller, timeoutId } = createTimeoutController(UPLOAD_TIMEOUT);

  console.log(`[uploadImageBase64] Starting upload, base64 length: ${base64.length} chars, mimeType: ${mimeType}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);

  try {
    const response = await fetch(`${BACKEND_URL}/api/upload/image-base64`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ base64, mimeType }),
      credentials: "include",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    console.log(`[uploadImageBase64] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[uploadImageBase64] Upload failed: ${response.status} - ${errorText}`);

      // Handle rate limiting with user-friendly message
      if (response.status === 429) {
        if (retryCount < MAX_RETRIES) {
          const delay = (retryCount + 1) * 2000;
          console.log(`[uploadImageBase64] Rate limited, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return uploadImageBase64(base64, mimeType, retryCount + 1);
        }
        throw new Error("Too many uploads. Please wait a moment and try again.");
      }

      // Retry on server errors
      if (response.status >= 500 && retryCount < MAX_RETRIES) {
        const delay = (retryCount + 1) * 1500;
        console.log(`[uploadImageBase64] Server error, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return uploadImageBase64(base64, mimeType, retryCount + 1);
      }

      let errorData: { error?: string } = { error: "Upload failed" };
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText || `Upload failed: ${response.status}` };
      }
      throw new Error(errorData.error || `Upload failed: ${response.status}`);
    }

    const result = await response.json();
    console.log(`[uploadImageBase64] Upload success, url: ${result.url}`);
    return result;
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === "AbortError") {
      if (retryCount < MAX_RETRIES) {
        console.log(`[uploadImageBase64] Timeout, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return uploadImageBase64(base64, mimeType, retryCount + 1);
      }
      throw new Error("Upload timed out. Please try again with a smaller image.");
    }

    // Retry on network errors
    if ((error.message?.includes("fetch failed") || error.message?.includes("network")) && retryCount < MAX_RETRIES) {
      const delay = (retryCount + 1) * 1500;
      console.log(`[uploadImageBase64] Network error, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return uploadImageBase64(base64, mimeType, retryCount + 1);
    }

    throw error;
  }
}

// ============================================
// Schedule Upload with Async Processing
// ============================================

export interface UploadJobStatus {
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  currentStep: string | null;
  createdTripIds: string[];
  updatedTripIds: string[];
  errorMessage: string | null;
  processingTimeMs: number | null;
  hasConflicts?: boolean;
  conflictsDetected?: Array<{
    tripNumber?: string;
    conflicts: any[];
    newTripSummary: any;
    parsedData: any;
  }>;
  // SIK detection from upload (Phase 1)
  hasSikDetected?: boolean;
  sikDetected?: Array<{
    tripId: string;
    sikDetected: {
      detected: boolean;
      dateRange?: { startDate: string; endDate: string } | null;
      station?: string | null;
      // NOTE: tafbHours is TAFB (Time Away From Base), NOT sick hours to deduct!
      tafbHours?: number | null;
      rawText?: string | null;
    };
  }>;
}

export interface ParseAsyncResponse {
  success: boolean;
  jobId: string;
  message: string;
  pollUrl: string;
}

/**
 * Parse schedule images asynchronously (queue-based)
 */
export async function parseScheduleAsync(images: string[]): Promise<ParseAsyncResponse> {
  return api.post<ParseAsyncResponse>("/api/schedule/parse-async", { images });
}

/**
 * Get the status of an upload job
 */
export async function getUploadJobStatus(jobId: string): Promise<UploadJobStatus> {
  return api.get<UploadJobStatus>(`/api/schedule/job-status/${jobId}`);
}

/**
 * Parse schedule with automatic polling and robust error handling
 */
export async function parseScheduleWithPolling(
  images: string[],
  onProgress?: (status: UploadJobStatus) => void
): Promise<UploadJobStatus> {
  // Start the async job
  let jobResponse: ParseAsyncResponse;
  try {
    jobResponse = await parseScheduleAsync(images);
  } catch (error: any) {
    console.error('[parseScheduleWithPolling] Failed to start async job:', error);
    throw new Error('Failed to start schedule processing. Please try again.');
  }

  const { jobId } = jobResponse;
  console.log(`[parseScheduleWithPolling] Job started: ${jobId}`);

  const maxPolls = 360;       // Max 6 minutes of polling (increased)
  let polls = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5;
  let lastStatus = '';
  let sameStatusCount = 0;

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const status = await getUploadJobStatus(jobId);
        consecutiveErrors = 0;

        // Track how long we've been in the same status for backoff
        if (status.status === lastStatus) {
          sameStatusCount++;
        } else {
          sameStatusCount = 0;
          lastStatus = status.status;
        }

        if (onProgress) {
          onProgress(status);
        }

        if (status.status === "completed") {
          console.log(`[parseScheduleWithPolling] Job completed in ${polls} polls`);
          resolve(status);
          return;
        }

        if (status.status === "failed") {
          console.error(`[parseScheduleWithPolling] Job failed:`, status.errorMessage);
          reject(new Error(status.errorMessage || "Schedule processing failed. Please try again."));
          return;
        }

        polls++;
        if (polls >= maxPolls) {
          console.error(`[parseScheduleWithPolling] Job timed out after ${maxPolls} polls`);
          reject(new Error("Schedule processing timed out. Please try again with fewer images."));
          return;
        }

        // Adaptive polling: slow down when pending (still in queue), faster when processing
        let nextPollMs: number;
        if (status.status === 'pending') {
          nextPollMs = 2000; // Still queued — check every 2s, not 1s
        } else if (sameStatusCount > 10) {
          nextPollMs = 2000; // Processing a while with no change — back off
        } else {
          nextPollMs = 1000; // Actively progressing — stay at 1s
        }

        setTimeout(poll, nextPollMs);
      } catch (error: any) {
        consecutiveErrors++;
        console.warn(`[parseScheduleWithPolling] Poll error (${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          reject(new Error('Lost connection to server. Please check your internet and try again.'));
          return;
        }

        polls++;
        if (polls >= maxPolls) {
          reject(new Error("Schedule processing timed out. Please try again."));
          return;
        }

        setTimeout(poll, 2000);
      }
    };

    // Start polling immediately
    poll();
  });
}

/**
 * Parse schedule synchronously with extended timeout and retry
 * This is the fallback when async parsing fails
 */
export async function parseScheduleSync<T>(
  images: string[],
  sourceType?: string
): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Create a fresh AbortController for each attempt
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

    try {
      console.log(`[parseScheduleSync] Attempt ${attempt + 1}/${maxRetries + 1}, timeout: ${AI_TIMEOUT}ms`);

      const response = await fetch(`${BACKEND_URL}/api/schedule/parse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          images,
          sourceType: sourceType === "auto" ? undefined : sourceType,
        }),
        credentials: "include",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error(`[parseScheduleSync] Request failed: ${response.status} - ${errorText}`);

        // Don't retry client errors (4xx) except for rate limiting
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          let errorMessage = "Failed to process schedule";
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorJson.message || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          throw new Error(errorMessage);
        }

        // Retry on rate limit or server errors
        if (response.status === 429 || response.status >= 500) {
          if (attempt < maxRetries) {
            const delay = (attempt + 1) * 2000;
            console.log(`[parseScheduleSync] Server error ${response.status}, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        throw new Error(errorText || `Request failed: ${response.status}`);
      }

      const result = await response.json();
      console.log(`[parseScheduleSync] Success on attempt ${attempt + 1}`);
      return result as T;
    } catch (error: any) {
      clearTimeout(timeoutId);
      lastError = error;

      const isRetryable =
        error.name === "AbortError" ||
        error.message?.includes("fetch failed") ||
        error.message?.includes("canceled") ||
        error.message?.includes("network") ||
        error.message?.includes("timed out");

      console.log(`[parseScheduleSync] Error on attempt ${attempt + 1}: ${error.message}, retryable: ${isRetryable}`);

      if (!isRetryable || attempt === maxRetries) {
        if (error.name === "AbortError") {
          throw new Error("Schedule processing timed out. Try uploading fewer images or clearer screenshots.");
        }
        throw error;
      }

      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }

  throw lastError || new Error("Schedule parsing failed after retries");
}

// ============================================
// Robust Schedule Import Pipeline (NEW)
// ============================================

/**
 * Robust schedule parsing result types
 */
export interface RobustParsedLeg {
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureTimeLocal: string;
  arrivalTimeLocal: string;
  departureDate: string;
  arrivalDate: string;
  blockMinutes: number;
  isDeadhead: boolean;
  equipment?: string;
  position?: string;
}

export interface RobustParsedLayover {
  airport: string;
  hotelName?: string;
  hotelPhone?: string;
  restHours?: number;
  city?: string;
}

export interface RobustParsedDutyDay {
  date: string;
  reportTimeLocal?: string;
  releaseTimeLocal?: string;
  dutyMinutes?: number;
  creditMinutes?: number;
  legs: RobustParsedLeg[];
  layover?: RobustParsedLayover;
}

export interface RobustParsedTrip {
  tripNumber: string;
  base?: string;
  equipment?: string;
  startDate: string;
  endDate: string;
  creditMinutes?: number;
  blockMinutes?: number;
  tafbMinutes?: number;
  dutyDays: RobustParsedDutyDay[];
}

export interface RobustParseResult {
  success: boolean;
  templateType: string;
  confidence: number;
  trips: RobustParsedTrip[];
  warnings: string[];
  errors: string[];
  validationPassed: boolean;
  action?: "created" | "updated" | "skipped" | "review_required" | "failed";
  createdTripIds?: string[];
  updatedTripIds?: string[];
  failureReason?: string;
  reviewId?: string;
}

export interface PendingReview {
  id: string;
  userId: string;
  ocrText: string;
  parsedData: RobustParsedTrip[];
  templateType: string;
  confidence: number;
  warnings: string[];
  errors: string[];
  imageUrls: string[];
  createdAt: string;
}

export interface PendingReviewsResponse {
  success: boolean;
  reviews: PendingReview[];
  count: number;
}

/**
 * Parse schedule images using the new robust pipeline
 * @param images - Array of image URLs to parse
 * @param baseDate - Optional base date for relative date parsing
 * @param dryRun - If true, only parse without saving to database
 */
export async function parseScheduleRobust(
  images: string[],
  baseDate?: string,
  dryRun: boolean = false
): Promise<RobustParseResult> {
  return api.post<RobustParseResult>(
    "/api/schedule/parse-robust",
    { images, baseDate, dryRun },
    AI_TIMEOUT
  );
}

/**
 * Get pending reviews (imports that need manual confirmation)
 */
export async function getPendingReviews(): Promise<PendingReviewsResponse> {
  return api.get<PendingReviewsResponse>("/api/schedule/pending-reviews");
}

/**
 * Confirm a reviewed import (save to database)
 * @param reviewId - The ID of the review evidence to confirm
 */
export async function confirmReviewedImport(reviewId: string): Promise<{
  success: boolean;
  action: string;
  createdTripIds: string[];
  updatedTripIds: string[];
}> {
  return api.post("/api/schedule/confirm-review", { reviewId });
}

/**
 * Dismiss a review item (delete without importing)
 * @param reviewId - The ID of the review evidence to dismiss
 */
export async function dismissReview(reviewId: string): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post("/api/schedule/dismiss-review", { reviewId });
}

/**
 * Parse schedule with robust pipeline and automatic polling
 * Uses the new template-aware parser with validation gates
 */
export async function parseScheduleRobustWithRetry(
  images: string[],
  baseDate?: string,
  maxRetries: number = 2
): Promise<RobustParseResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[parseScheduleRobust] Attempt ${attempt + 1}/${maxRetries + 1}`);
      const result = await parseScheduleRobust(images, baseDate, false);

      // Log result summary
      console.log(`[parseScheduleRobust] Result: ${result.action}, confidence: ${result.confidence}%, trips: ${result.trips.length}`);

      return result;
    } catch (error: any) {
      lastError = error;
      console.error(`[parseScheduleRobust] Error on attempt ${attempt + 1}:`, error.message);

      const isRetryable =
        error.name === "AbortError" ||
        error.message?.includes("fetch failed") ||
        error.message?.includes("network") ||
        error.message?.includes("timed out") ||
        error.status >= 500;

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }

  throw lastError || new Error("Robust schedule parsing failed after retries");
}

// ─── Bid Period Baseline ─────────────────────────────────────────────────────

import type {
  GetBidPeriodBaselineResponse,
  UpsertBidPeriodBaselineRequest,
  UpsertBidPeriodBaselineResponse,
  DeleteBidPeriodBaselineResponse,
} from "@/shared/contracts";

/** Fetch the awarded baseline for the given period key (or current period if omitted). */
export async function getBidPeriodBaseline(periodKey?: string): Promise<GetBidPeriodBaselineResponse> {
  const qs = periodKey ? `?periodKey=${encodeURIComponent(periodKey)}` : "";
  return fetchFn<GetBidPeriodBaselineResponse>(`/api/bid-period-baseline${qs}`, { method: "GET" });
}

/** Set or update the awarded credit baseline for a period. */
export async function upsertBidPeriodBaseline(
  data: UpsertBidPeriodBaselineRequest
): Promise<UpsertBidPeriodBaselineResponse> {
  return fetchFn<UpsertBidPeriodBaselineResponse>("/api/bid-period-baseline", {
    method: "PUT",
    body: data,
  });
}

/** Clear the baseline for a period (so the user can re-enter). */
export async function deleteBidPeriodBaseline(periodKey: string): Promise<DeleteBidPeriodBaselineResponse> {
  return fetchFn<DeleteBidPeriodBaselineResponse>(
    `/api/bid-period-baseline/${encodeURIComponent(periodKey)}`,
    { method: "DELETE" }
  );
}
