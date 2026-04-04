/**
 * Year Plan API Routes
 * The shared planning entity between Benchmarks and Annual Pay Planner.
 * Planning layer only — NEVER mutates pay records, trips, or statements.
 */

import { Hono } from "hono";
import { db } from "../db";
import { type AppType } from "../types";

export const yearPlanRouter = new Hono<AppType>();

const JA_MULTIPLIER = 1.5;
const UPS_MONTHLY_GUARANTEE_HOURS = 75;
const UPS_BID_PERIOD_DAYS = 28;

function requireAuth(userId: string | undefined): string {
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

// ============================================================
// Compute plan health from math only
// ============================================================
function computePlanHealth(
  requiredPerMonthBase: number,
  guaranteeHours: number,
  monthsLeft: number
): "STRONG" | "WATCH" | "AT_RISK" {
  const ratio = guaranteeHours > 0 ? requiredPerMonthBase / guaranteeHours : 1;
  if (ratio <= 1.05) return "STRONG";        // Within 5% of guarantee
  if (ratio <= 1.25) return "WATCH";         // Up to 25% above guarantee
  return "AT_RISK";                          // > 25% above guarantee
}

// ============================================================
// Compute year plan snapshot (pure math, no mutations)
// ============================================================
async function computeSnapshot(userId: string, plan: {
  targetAnnualIncomeCents: number;
  hourlyRateCents: number;
  monthlyGuaranteeHours: number;
  jaMultiplier: number;
  planYear: number;
}) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const yearStartISO = `${plan.planYear}-01-01`;
  const yearEndISO = `${plan.planYear}-12-31`;
  const todayISO = today.toISOString().split("T")[0] ?? "";

  // Get YTD trips for the plan year
  const ytdTrips = await db.trip.findMany({
    where: {
      userId,
      status: { notIn: ["cancelled", "override"] },
      startDate: { gte: yearStartISO, lte: todayISO },
    },
    include: { dutyDays: true },
  });

  // Sum YTD pay and credit directly from trips.
  // trip.totalPayCents and trip.payCreditMinutes are already updated when premiums are applied,
  // so we do NOT add premium event deltas separately (that would double-count).
  let ytdPayCents = 0;
  let ytdCreditMinutes = 0;
  for (const trip of ytdTrips) {
    // payCreditMinutes reflects premiums; fall back to totalCreditMinutes for trips without premiums
    const creditMin = trip.payCreditMinutes || trip.totalCreditMinutes || 0;
    ytdCreditMinutes += creditMin;
    ytdPayCents += trip.totalPayCents || 0;
  }

  // Days elapsed in plan year
  const yearStart = new Date(`${plan.planYear}-01-01`);
  const yearEnd = new Date(`${plan.planYear}-12-31`);
  const effectiveToday = plan.planYear < currentYear ? yearEnd : today;
  const ytdDaysElapsed = Math.max(1, Math.floor((effectiveToday.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  // Projected annual based on YTD pace
  const dailyAvg = ytdPayCents / ytdDaysElapsed;
  const totalDaysInYear = plan.planYear % 4 === 0 ? 366 : 365;
  const ytdPaidEstimate = ytdPayCents;

  // Months left (fractional, at least 1)
  const msLeft = yearEnd.getTime() - effectiveToday.getTime();
  const monthsLeft = plan.planYear < currentYear ? 0 : Math.max(1, msLeft / (1000 * 60 * 60 * 24 * 30.44));

  // Remaining income needed
  const remainingIncomeNeeded = Math.max(0, plan.targetAnnualIncomeCents - ytdPayCents);

  // Credit equivalents for remaining
  const basePayPerHour = plan.hourlyRateCents;
  const jaPayPerHour = plan.hourlyRateCents * plan.jaMultiplier;

  const baseCreditEquivRemaining = remainingIncomeNeeded > 0
    ? Math.round((remainingIncomeNeeded / basePayPerHour) * 10) / 10
    : 0;
  const jaCreditEquivRemaining = remainingIncomeNeeded > 0
    ? Math.round((remainingIncomeNeeded / jaPayPerHour) * 10) / 10
    : 0;

  // Per-month and per-bid-period from today
  const requiredBasePerMonthFromToday = monthsLeft > 0
    ? Math.round((remainingIncomeNeeded / basePayPerHour / monthsLeft) * 10) / 10
    : 0;
  const requiredJAPerMonthFromToday = monthsLeft > 0
    ? Math.round((remainingIncomeNeeded / jaPayPerHour / monthsLeft) * 10) / 10
    : 0;
  const requiredBasePerBidPeriod = Math.round((requiredBasePerMonthFromToday * (UPS_BID_PERIOD_DAYS / 30)) * 10) / 10;

  // Plan health (math only)
  const planHealth = computePlanHealth(requiredBasePerMonthFromToday, plan.monthlyGuaranteeHours, monthsLeft);

  // YTD credit hours
  const ytdCreditHours = Math.round((ytdCreditMinutes / 60) * 10) / 10;

  return {
    planYear: plan.planYear,
    ytdPaidEstimateCents: ytdPaidEstimate,
    ytdCreditHours,
    ytdDaysElapsed,
    monthsLeft: Math.round(monthsLeft * 10) / 10,
    remainingIncomeNeededCents: remainingIncomeNeeded,
    baseCreditEquivRemainingHours: baseCreditEquivRemaining,
    jaCreditEquivRemainingHours: jaCreditEquivRemaining,
    requiredBaseCreditsPerMonthFromToday: requiredBasePerMonthFromToday,
    requiredJACreditsPerMonthFromToday: requiredJAPerMonthFromToday,
    requiredBaseCreditsPerBidPeriodFromToday: requiredBasePerBidPeriod,
    planHealth,
    targetAnnualIncomeCents: plan.targetAnnualIncomeCents,
    hourlyRateCents: plan.hourlyRateCents,
    monthlyGuaranteeHours: plan.monthlyGuaranteeHours,
    jaMultiplier: plan.jaMultiplier,
  };
}

// ============================================================
// GET /api/year-plan/active - Get active plan for current year
// ============================================================
yearPlanRouter.get("/active", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const currentYear = new Date().getFullYear();

    const plan = await db.yearPlan.findFirst({
      where: { userId, planYear: currentYear, isActive: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!plan) {
      return c.json({ plan: null, snapshot: null });
    }

    const snapshot = await computeSnapshot(userId, {
      targetAnnualIncomeCents: plan.targetAnnualIncomeCents,
      hourlyRateCents: plan.hourlyRateCents,
      monthlyGuaranteeHours: plan.monthlyGuaranteeHours,
      jaMultiplier: plan.jaMultiplier,
      planYear: plan.planYear,
    });

    return c.json({
      plan: {
        id: plan.id,
        planYear: plan.planYear,
        targetAnnualIncomeCents: plan.targetAnnualIncomeCents,
        hourlyRateCents: plan.hourlyRateCents,
        monthlyGuaranteeHours: plan.monthlyGuaranteeHours,
        jaMultiplier: plan.jaMultiplier,
        includeJA: plan.includeJA,
        includeOpenTime: plan.includeOpenTime,
        planningMode: plan.planningMode,
        isActive: plan.isActive,
        updatedAt: plan.updatedAt.toISOString(),
      },
      snapshot,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error getting active year plan:", error);
    return c.json({ error: "Failed to get year plan" }, 500);
  }
});

// ============================================================
// POST /api/year-plan/upsert - Create or update year plan
// ============================================================
yearPlanRouter.post("/upsert", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const body = await c.req.json();

    const {
      planYear,
      targetAnnualIncomeCents,
      hourlyRateCents,
      monthlyGuaranteeHours,
      jaMultiplier,
      includeJA,
      includeOpenTime,
      planningMode,
    } = body;

    if (!planYear || !targetAnnualIncomeCents) {
      return c.json({ error: "planYear and targetAnnualIncomeCents are required" }, 400);
    }

    // Get user's profile for defaults
    const profile = await db.profile.findUnique({ where: { userId } });
    const effectiveRate = hourlyRateCents ?? profile?.hourlyRateCents ?? 32500;

    // Deactivate old plans for this year
    await db.yearPlan.updateMany({
      where: { userId, planYear, isActive: true },
      data: { isActive: false },
    });

    // Create new active plan
    const plan = await db.yearPlan.create({
      data: {
        userId,
        planYear,
        targetAnnualIncomeCents,
        hourlyRateCents: effectiveRate,
        monthlyGuaranteeHours: monthlyGuaranteeHours ?? 75,
        jaMultiplier: jaMultiplier ?? 1.5,
        includeJA: includeJA ?? false,
        includeOpenTime: includeOpenTime ?? true,
        planningMode: planningMode ?? "BALANCED",
        isActive: true,
      },
    });

    const snapshot = await computeSnapshot(userId, {
      targetAnnualIncomeCents: plan.targetAnnualIncomeCents,
      hourlyRateCents: plan.hourlyRateCents,
      monthlyGuaranteeHours: plan.monthlyGuaranteeHours,
      jaMultiplier: plan.jaMultiplier,
      planYear: plan.planYear,
    });

    return c.json({
      success: true,
      plan: {
        id: plan.id,
        planYear: plan.planYear,
        targetAnnualIncomeCents: plan.targetAnnualIncomeCents,
        hourlyRateCents: plan.hourlyRateCents,
        monthlyGuaranteeHours: plan.monthlyGuaranteeHours,
        jaMultiplier: plan.jaMultiplier,
        includeJA: plan.includeJA,
        includeOpenTime: plan.includeOpenTime,
        planningMode: plan.planningMode,
        isActive: plan.isActive,
        updatedAt: plan.updatedAt.toISOString(),
      },
      snapshot,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error upserting year plan:", error);
    return c.json({ error: "Failed to save year plan" }, 500);
  }
});

// ============================================================
// PATCH /api/year-plan/update-guarantee - Update guarantee hours only
// Called from Benchmarks guarantee editor (Phase 4 sync)
// ============================================================
yearPlanRouter.patch("/update-guarantee", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const body = await c.req.json();
    const { monthlyGuaranteeHours } = body;

    if (typeof monthlyGuaranteeHours !== "number" || monthlyGuaranteeHours <= 0) {
      return c.json({ error: "monthlyGuaranteeHours must be a positive number" }, 400);
    }

    const currentYear = new Date().getFullYear();

    const updated = await db.yearPlan.updateMany({
      where: { userId, planYear: currentYear, isActive: true },
      data: { monthlyGuaranteeHours },
    });

    return c.json({ success: true, updated: updated.count });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error updating guarantee hours:", error);
    return c.json({ error: "Failed to update guarantee hours" }, 500);
  }
});

// ============================================================
// GET /api/year-plan/snapshot - Compute fresh snapshot on demand
// ============================================================
yearPlanRouter.get("/snapshot", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const currentYear = new Date().getFullYear();

    const plan = await db.yearPlan.findFirst({
      where: { userId, planYear: currentYear, isActive: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!plan) {
      return c.json({ snapshot: null });
    }

    const snapshot = await computeSnapshot(userId, {
      targetAnnualIncomeCents: plan.targetAnnualIncomeCents,
      hourlyRateCents: plan.hourlyRateCents,
      monthlyGuaranteeHours: plan.monthlyGuaranteeHours,
      jaMultiplier: plan.jaMultiplier,
      planYear: plan.planYear,
    });

    return c.json({ snapshot });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error computing year plan snapshot:", error);
    return c.json({ error: "Failed to compute snapshot" }, 500);
  }
});
