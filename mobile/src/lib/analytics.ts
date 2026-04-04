/**
 * PostHog Analytics Integration
 *
 * Tracks user activity, feature usage, and app performance.
 * Configure EXPO_PUBLIC_POSTHOG_API_KEY in your environment.
 */

import PostHog from "posthog-react-native";
import type { PostHogEventProperties } from "@posthog/core";
import Constants from "expo-constants";

// Initialize PostHog client
const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let posthogClient: PostHog | null = null;

export function initAnalytics(): void {
  if (!POSTHOG_API_KEY) {
    console.log("[Analytics] PostHog API key not configured, skipping initialization");
    return;
  }

  try {
    posthogClient = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      // Capture app lifecycle events
      captureAppLifecycleEvents: true,
      // Flush events every 30 seconds
      flushInterval: 30,
      // Flush when 20 events are queued
      flushAt: 20,
    });
    console.log("[Analytics] PostHog initialized successfully");
  } catch (error) {
    console.error("[Analytics] Failed to initialize PostHog:", error);
  }
}

/**
 * Identify a user for analytics tracking
 */
export function identifyUser(userId: string, properties?: PostHogEventProperties): void {
  if (!posthogClient) return;

  posthogClient.identify(userId, {
    ...properties,
    appVersion: Constants.expoConfig?.version || "unknown",
  });
}

/**
 * Track a custom event
 */
export function trackEvent(
  eventName: string,
  properties?: PostHogEventProperties
): void {
  if (!posthogClient) return;

  posthogClient.capture(eventName, properties);
}

/**
 * Track screen views
 */
export function trackScreen(screenName: string, properties?: PostHogEventProperties): void {
  if (!posthogClient) return;

  posthogClient.screen(screenName, properties);
}

/**
 * Reset user identity (on logout)
 */
export function resetAnalytics(): void {
  if (!posthogClient) return;

  posthogClient.reset();
}

/**
 * Flush pending events immediately
 */
export async function flushAnalytics(): Promise<void> {
  if (!posthogClient) return;

  await posthogClient.flush();
}

// Pre-defined event names for consistency
export const AnalyticsEvents = {
  // Auth events
  USER_SIGNED_UP: "user_signed_up",
  USER_SIGNED_IN: "user_signed_in",
  USER_SIGNED_OUT: "user_signed_out",

  // Feature usage
  TRIP_CREATED: "trip_created",
  TRIP_IMPORTED: "trip_imported",
  SCHEDULE_SYNCED: "schedule_synced",
  PAY_EVENT_LOGGED: "pay_event_logged",
  OOOI_CAPTURED: "oooi_captured",

  // Tools
  PAY_CALCULATOR_USED: "pay_calculator_used",
  PER_DIEM_CALCULATOR_USED: "per_diem_calculator_used",
  THIRTY_IN_SEVEN_VIEWED: "30_in_7_viewed",

  // Pay features
  PAY_SUMMARY_VIEWED: "pay_summary_viewed",
  PAY_STATEMENT_GENERATED: "pay_statement_generated",

  // Support
  ISSUE_REPORTED: "issue_reported",

  // Errors
  ERROR_OCCURRED: "error_occurred",
  API_ERROR: "api_error",
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];
