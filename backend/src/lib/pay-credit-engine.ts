/**
 * Pay Credit Engine
 * Phase 5: Enforces UPS pay-protection rules
 *
 * CORE RULE (NON-NEGOTIABLE):
 * pay_credit = max(protected_credit, current_credit)
 *
 * Company schedule changes can NEVER reduce a pilot's pay credit.
 * The protected credit (from first upload) is IMMUTABLE.
 */

import { db } from "../db";

// ============================================
// Types
// ============================================

export type PayCreditScenario = "decreased" | "increased" | "unchanged";

export interface PayCreditCalculation {
  protectedCreditMinutes: number;
  currentCreditMinutes: number;
  payCreditMinutes: number;
  scenario: PayCreditScenario;
  creditDeltaMinutes: number; // current - protected (negative = decrease, positive = increase)
  isPayProtected: boolean; // True when current < protected
}

export interface PayProtectionMessage {
  title: string;
  message: string;
  footer?: string;
  estimatedPayImpact?: number; // In cents, only for increases
}

// ============================================
// Core Calculation
// ============================================

/**
 * Calculate pay credit from protected and current credits
 * THIS IS THE ONLY FUNCTION THAT SHOULD CALCULATE PAY CREDIT
 *
 * @param protectedCreditMinutes - Original/awarded credit (IMMUTABLE)
 * @param currentCreditMinutes - Latest roster credit
 * @returns PayCreditCalculation with scenario classification
 */
export function calculatePayCredit(
  protectedCreditMinutes: number,
  currentCreditMinutes: number
): PayCreditCalculation {
  // CORE RULE: pay_credit = max(protected, current)
  const payCreditMinutes = Math.max(protectedCreditMinutes, currentCreditMinutes);

  const creditDeltaMinutes = currentCreditMinutes - protectedCreditMinutes;

  let scenario: PayCreditScenario;
  if (creditDeltaMinutes < 0) {
    scenario = "decreased";
  } else if (creditDeltaMinutes > 0) {
    scenario = "increased";
  } else {
    scenario = "unchanged";
  }

  return {
    protectedCreditMinutes,
    currentCreditMinutes,
    payCreditMinutes,
    scenario,
    creditDeltaMinutes,
    isPayProtected: scenario === "decreased",
  };
}

/**
 * Calculate pay credit and update trip record
 * Called after every snapshot update
 */
export async function updateTripPayCredit(tripId: string): Promise<PayCreditCalculation> {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: {
      protectedCreditMinutes: true,
      currentCreditMinutes: true,
    },
  });

  if (!trip) {
    throw new Error(`Trip not found: ${tripId}`);
  }

  const calculation = calculatePayCredit(
    trip.protectedCreditMinutes,
    trip.currentCreditMinutes
  );

  // Update pay_credit_minutes in database
  await db.trip.update({
    where: { id: tripId },
    data: {
      payCreditMinutes: calculation.payCreditMinutes,
    },
  });

  console.log(
    `[PayCreditEngine] Updated trip ${tripId}: protected=${calculation.protectedCreditMinutes}, current=${calculation.currentCreditMinutes}, pay=${calculation.payCreditMinutes}, scenario=${calculation.scenario}`
  );

  return calculation;
}

// ============================================
// User-Facing Messages
// ============================================

/**
 * Generate user-facing message for pay credit scenario
 *
 * @param calculation - Pay credit calculation result
 * @param hourlyRateCents - User's hourly rate for pay impact (optional)
 * @returns PayProtectionMessage for UI display
 */
export function getPayProtectionMessage(
  calculation: PayCreditCalculation,
  hourlyRateCents?: number
): PayProtectionMessage | null {
  const { scenario, protectedCreditMinutes, currentCreditMinutes, payCreditMinutes, creditDeltaMinutes } =
    calculation;

  const protectedFormatted = formatCreditTime(protectedCreditMinutes);
  const currentFormatted = formatCreditTime(currentCreditMinutes);
  const payFormatted = formatCreditTime(payCreditMinutes);
  const deltaFormatted = formatCreditTime(Math.abs(creditDeltaMinutes));

  switch (scenario) {
    case "decreased":
      // CASE 1 — CREDIT DECREASED (PAY PROTECTED)
      return {
        title: "Roster Changed — Pay Protected",
        message: `The company modified your trip. While the roster credit decreased from ${protectedFormatted} to ${currentFormatted}, your pay is protected. You will still be credited ${payFormatted}, which is the amount you were originally awarded.`,
        footer: "Company changes cannot reduce your awarded trip credit.",
      };

    case "increased":
      // CASE 2 — CREDIT INCREASED
      const baseMessage = `The updated schedule increased your trip credit by +${deltaFormatted}. Your pay credit has been updated to ${payFormatted}.`;

      let estimatedPayImpact: number | undefined;
      let payImpactText = "";

      if (hourlyRateCents && hourlyRateCents > 0) {
        // Calculate estimated additional pay
        estimatedPayImpact = Math.round((creditDeltaMinutes / 60) * hourlyRateCents);
        const payImpactDollars = (estimatedPayImpact / 100).toFixed(2);
        payImpactText = `\n\nEstimated additional pay: +$${payImpactDollars}`;
      }

      return {
        title: "Trip Credit Increased",
        message: baseMessage + payImpactText,
        estimatedPayImpact,
      };

    case "unchanged":
      // CASE 3 — CREDIT UNCHANGED
      // No special credit messaging required
      return null;
  }
}

// ============================================
// Batch Operations
// ============================================

/**
 * Recalculate pay credit for all trips belonging to a user
 * Used for data migration or recalculation
 */
export async function recalculateAllUserPayCredits(userId: string): Promise<number> {
  const trips = await db.trip.findMany({
    where: { userId },
    select: {
      id: true,
      protectedCreditMinutes: true,
      currentCreditMinutes: true,
    },
  });

  let updatedCount = 0;

  for (const trip of trips) {
    const calculation = calculatePayCredit(
      trip.protectedCreditMinutes,
      trip.currentCreditMinutes
    );

    await db.trip.update({
      where: { id: trip.id },
      data: {
        payCreditMinutes: calculation.payCreditMinutes,
      },
    });

    updatedCount++;
  }

  console.log(`[PayCreditEngine] Recalculated pay credit for ${updatedCount} trips (user: ${userId})`);

  return updatedCount;
}

/**
 * Get aggregated pay credit totals for a date range
 * MUST use pay_credit_minutes for all pay calculations
 */
export async function getPayCreditTotals(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{
  totalProtectedMinutes: number;
  totalCurrentMinutes: number;
  totalPayMinutes: number;
  tripCount: number;
  protectedTripsCount: number;
}> {
  const trips = await db.trip.findMany({
    where: {
      userId,
      startDate: { gte: startDate },
      endDate: { lte: endDate },
    },
    select: {
      protectedCreditMinutes: true,
      currentCreditMinutes: true,
      payCreditMinutes: true,
    },
  });

  const totals = trips.reduce(
    (acc, trip) => {
      acc.totalProtectedMinutes += trip.protectedCreditMinutes;
      acc.totalCurrentMinutes += trip.currentCreditMinutes;
      acc.totalPayMinutes += trip.payCreditMinutes;
      acc.tripCount++;
      if (trip.currentCreditMinutes < trip.protectedCreditMinutes) {
        acc.protectedTripsCount++;
      }
      return acc;
    },
    {
      totalProtectedMinutes: 0,
      totalCurrentMinutes: 0,
      totalPayMinutes: 0,
      tripCount: 0,
      protectedTripsCount: 0,
    }
  );

  return totals;
}

// ============================================
// Formatting Helpers
// ============================================

/**
 * Format minutes to HH:MM display format
 */
export function formatCreditTime(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  return `${sign}${hours}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Parse HH:MM string to minutes
 */
export function parseCreditTime(timeStr: string): number {
  const match = timeStr.match(/^(-)?(\d+):(\d{2})$/);
  if (!match) return 0;

  const sign = match[1] ? -1 : 1;
  const hours = parseInt(match[2] ?? "0", 10);
  const mins = parseInt(match[3] ?? "0", 10);

  return sign * (hours * 60 + mins);
}

// ============================================
// Validation
// ============================================

/**
 * Validate that pay credit is correctly calculated
 * Used for testing and data integrity checks
 */
export function validatePayCredit(
  protectedMinutes: number,
  currentMinutes: number,
  payMinutes: number
): { valid: boolean; expected: number; message: string } {
  const expected = Math.max(protectedMinutes, currentMinutes);
  const valid = payMinutes === expected;

  return {
    valid,
    expected,
    message: valid
      ? "Pay credit correctly calculated"
      : `Pay credit mismatch: expected ${expected}, got ${payMinutes}`,
  };
}
