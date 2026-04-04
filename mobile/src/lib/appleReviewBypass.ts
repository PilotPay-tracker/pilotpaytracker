/**
 * Apple Review Account Bypass
 *
 * This module provides detection and bypass functionality for Apple Review accounts.
 * When a user is identified as an Apple reviewer, subscription checks are bypassed
 * to ensure smooth App Store review process.
 *
 * IMPORTANT: This bypass ONLY applies to the specific review account email.
 * All other users continue through normal subscription flow.
 */

// Apple Review Account Credentials
// These match what's provided in App Store Connect for App Review
// Supporting both email variations in case of typos
const APPLE_REVIEW_EMAILS = [
  "review@pilotpaytracker.app",
  "reviewer@pilotpaytracker.app",
  "reviewpaid@pilotpaytracker.app",
  "tester@pilotpaytracker.app",
];

// Track bypass state for logging
let bypassActive = false;
let reviewAccountDetected = false;

/**
 * Check if the given email is the Apple Review account
 */
export function isAppleReviewAccount(email: string | null | undefined): boolean {
  if (!email) return false;
  const isReviewAccount = APPLE_REVIEW_EMAILS.some(
    (reviewEmail) => email.toLowerCase() === reviewEmail.toLowerCase()
  );

  if (isReviewAccount && !reviewAccountDetected) {
    reviewAccountDetected = true;
    bypassActive = true;
    console.log("[AppleReviewBypass] ========================================");
    console.log("[AppleReviewBypass] REVIEW ACCOUNT DETECTED");
    console.log("[AppleReviewBypass] Email:", email);
    console.log("[AppleReviewBypass] reviewAccountDetected = true");
    console.log("[AppleReviewBypass] subscriptionBypassActive = true");
    console.log("[AppleReviewBypass] All premium features unlocked");
    console.log("[AppleReviewBypass] ========================================");
  }

  return isReviewAccount;
}

/**
 * Check if subscription bypass is currently active
 * This is useful for debugging and verification
 */
export function isBypassActive(): boolean {
  return bypassActive;
}

/**
 * Get bypass status for debugging
 */
export function getBypassStatus(): {
  reviewAccountDetected: boolean;
  subscriptionBypassActive: boolean;
  reviewEmails: string[];
} {
  return {
    reviewAccountDetected,
    subscriptionBypassActive: bypassActive,
    reviewEmails: APPLE_REVIEW_EMAILS,
  };
}

/**
 * Reset bypass state (used on sign out)
 */
export function resetBypassState(): void {
  bypassActive = false;
  reviewAccountDetected = false;
  console.log("[AppleReviewBypass] Bypass state reset");
}

/**
 * Log bypass verification info (for debugging)
 */
export function logBypassVerification(): void {
  console.log("[AppleReviewBypass] Verification Status:");
  console.log("[AppleReviewBypass] - reviewAccountDetected:", reviewAccountDetected);
  console.log("[AppleReviewBypass] - subscriptionBypassActive:", bypassActive);
}
