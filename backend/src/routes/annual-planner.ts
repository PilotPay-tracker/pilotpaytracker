/**
 * Annual Pay Planner API Routes
 * Flagship PRO feature for income planning
 *
 * Philosophy:
 * - AWARENESS-BASED - SCENARIO-DRIVEN - CONTRACT-REFERENCED (READ-ONLY)
 * - NEVER implies "illegal", "violation", "guaranteed", "impossible"
 * - Uses 75-hour monthly guarantee as baseline floor (UPS contract)
 */

import { Hono } from "hono";
import { db } from "../db";
import { type AppType } from "../types";
import {
  type PlanningMode,
  type FeasibilityRating,
  type ScenarioType,
  type ScenarioResult,
  type BaselineTransparency,
  type HistoricalAverages,
  type PayComponentBreakdown,
} from "@/shared/contracts";
import {
  PAY_PERIODS_2026,
  getPayPeriodForDate,
  getRemainingBidPeriods,
  getCurrentBidPeriod,
  type BidPeriodEntry,
} from "../lib/constants";
import {
  type CreditCapPreferences,
  type CreditCapResult,
  buildCapInputsFromPrefs,
  computeMaxOpenTimeAllowed,
  evaluateCreditedTimeStatus,
  applyOpenTimeClamp,
  getPeriodLimits,
  formatDecimalToHHMM,
  DEFAULT_CREDIT_CAP_PREFERENCES,
} from "../lib/CreditCapEngine";
import { applyYTDGuaranteeFloorSimple } from "../lib/guarantee-engine";

export const annualPlannerRouter = new Hono<AppType>();

// ============================================
// CONSTANTS (UPS-specific)
// ============================================
const UPS_MONTHLY_GUARANTEE_HOURS = 75;
const UPS_MONTHLY_GUARANTEE_MINUTES = 75 * 60; // 4500
// UPS has 7 bid periods per year (6 × 56-day + 1 × 28-day)
const UPS_BID_PERIODS_PER_YEAR = 7;
// Default bid period days for BID_56 pilots (the majority)
const UPS_BID_PERIOD_DAYS_56 = 56;
// Default bid period days for BID_28 / PAY period pilots
const UPS_BID_PERIOD_DAYS_28 = 28;
const JA_PAY_MULTIPLIER = 1.5;
// Minimum months of data needed to trust rolling avg over guarantee
const MIN_MONTHS_FOR_ROLLING_BASELINE = 2;

// Legal disclaimer (exact text - required)
const LEGAL_DISCLAIMER =
  "Annual Pay Planner is a personal planning tool. Scenarios are estimates based on historical data and user inputs. This tool does not guarantee earnings, enforce contract rules, or provide legal advice.";

// ============================================
// HELPER: Require authentication
// ============================================
function requireAuth(userId: string | undefined): string {
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

// ============================================
// HELPER: Calculate historical averages
// ============================================
async function getHistoricalAverages(
  userId: string,
  rollingMonths: number = 12
): Promise<HistoricalAverages & { rolling90DayCreditMinutes: number; rolling90DayMonthCount: number }> {
  const today = new Date();
  const currentYear = today.getFullYear();
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - rollingMonths);
  const startDateISO = startDate.toISOString().split("T")[0] ?? "";
  const yearStartISO = `${currentYear}-01-01`;
  const todayISO = today.toISOString().split("T")[0] ?? "";

  // 90-day window for pace baseline
  const rolling90Start = new Date(today);
  rolling90Start.setDate(rolling90Start.getDate() - 90);
  const rolling90StartISO = rolling90Start.toISOString().split("T")[0] ?? "";

  // Get all trips with duty days in the rolling window (exclude cancelled/override)
  const trips = await db.trip.findMany({
    where: {
      userId,
      status: { notIn: ["cancelled", "override"] },
      startDate: { gte: startDateISO },
    },
    include: {
      dutyDays: true,
    },
  });

  // Calculate monthly credit totals
  const monthlyCredits: Map<string, number> = new Map();
  const monthlyPremiums: Map<string, number> = new Map();
  const monthly90Credits: Map<string, number> = new Map();
  let totalReserveActivations = 0;
  let totalTrips = 0;

  for (const trip of trips) {
    totalTrips++;

    // Check if this appears to be a reserve activation
    if (trip.tripNumber?.startsWith("R") || trip.source === "reserve") {
      totalReserveActivations++;
    }

    for (const dutyDay of trip.dutyDays) {
      const monthKey = dutyDay.dutyDate.substring(0, 7); // YYYY-MM
      const creditMinutes = dutyDay.finalCreditMinutes || dutyDay.actualCreditMinutes || dutyDay.plannedCreditMinutes || 0;
      const premiumCents = dutyDay.premiumPayCents || 0;

      monthlyCredits.set(monthKey, (monthlyCredits.get(monthKey) || 0) + creditMinutes);
      monthlyPremiums.set(monthKey, (monthlyPremiums.get(monthKey) || 0) + premiumCents);

      // Also bucket into 90-day window
      if (dutyDay.dutyDate >= rolling90StartISO) {
        monthly90Credits.set(monthKey, (monthly90Credits.get(monthKey) || 0) + creditMinutes);
      }
    }
  }

  // Calculate averages
  const monthCount = monthlyCredits.size || 1;
  const totalCreditMinutes = Array.from(monthlyCredits.values()).reduce((a, b) => a + b, 0);
  const totalPremiumCents = Array.from(monthlyPremiums.values()).reduce((a, b) => a + b, 0);

  const avgMonthlyCreditMinutes = Math.round(totalCreditMinutes / monthCount);
  const avgBidPeriodCreditMinutes = Math.round(
    (totalCreditMinutes / monthCount) * (UPS_BID_PERIOD_DAYS_56 / 30)
  );
  const avgPremiumCaptureCents = Math.round(totalPremiumCents / monthCount);
  const reserveActivationFrequency = totalTrips > 0 ? totalReserveActivations / totalTrips : 0;

  // 90-day rolling stats
  const rolling90MonthCount = monthly90Credits.size || 0;
  const rolling90TotalMinutes = Array.from(monthly90Credits.values()).reduce((a, b) => a + b, 0);
  const rolling90DayCreditMinutes = rolling90MonthCount > 0
    ? Math.round(rolling90TotalMinutes / rolling90MonthCount)
    : 0;

  // Get YTD totals
  const ytdTrips = await db.trip.findMany({
    where: {
      userId,
      status: { notIn: ["cancelled", "override"] },
      startDate: { gte: yearStartISO, lte: todayISO },
    },
    include: {
      dutyDays: true,
    },
  });

  // Sum YTD pay and credit directly from trips.
  // trip.totalPayCents and trip.payCreditMinutes are already updated when premiums are applied,
  // so we do NOT add premium event deltas separately (that would double-count).
  let ytdCreditMinutes = 0;
  let ytdPayCents = 0;

  for (const trip of ytdTrips) {
    ytdCreditMinutes += trip.payCreditMinutes || trip.totalCreditMinutes || 0;
    ytdPayCents += trip.totalPayCents || 0;
  }

  return {
    avgMonthlyCreditMinutes,
    avgBidPeriodCreditMinutes,
    avgPremiumCaptureCents,
    reserveActivationFrequency,
    totalMonthsOfData: monthCount,
    ytdCreditMinutes,
    ytdPayCents,
    rolling90DayCreditMinutes,
    rolling90DayMonthCount: rolling90MonthCount,
  };
}

// ============================================
// HELPER: Calculate baseline transparency
// ============================================
function calculateBaseline(
  historicalAverages: HistoricalAverages & { rolling90DayCreditMinutes: number; rolling90DayMonthCount: number },
  rollingMonths: number
): BaselineTransparency & { baselineSource: "rolling_90_day" | "guarantee" } {
  const contractGuaranteeHoursPerMonth = UPS_MONTHLY_GUARANTEE_HOURS;
  const userAvgCreditHoursPerMonth = historicalAverages.avgMonthlyCreditMinutes / 60;
  const userAvgCreditHoursPerBidPeriod = historicalAverages.avgBidPeriodCreditMinutes / 60;

  // Use 90-day rolling avg if we have >= 2 months of data — avoids the "22 hrs/month" sparse-data trap
  const use90Day = historicalAverages.rolling90DayMonthCount >= MIN_MONTHS_FOR_ROLLING_BASELINE;
  const rolling90HoursPerMonth = historicalAverages.rolling90DayCreditMinutes / 60;

  const activeAvgHoursPerMonth = use90Day ? rolling90HoursPerMonth : userAvgCreditHoursPerMonth;

  // Baseline = max(guarantee, active avg) — guarantee is the floor
  const plannerBaselineHoursPerMonth = Math.max(
    contractGuaranteeHoursPerMonth,
    activeAvgHoursPerMonth
  );
  const plannerBaselineHoursPerBidPeriod = Math.max(
    contractGuaranteeHoursPerMonth, // Flat 75-hr guarantee applies per bid period (not scaled)
    (historicalAverages.avgBidPeriodCreditMinutes / 60)
  );

  const hasData = historicalAverages.totalMonthsOfData > 0;
  const baselineSource: "rolling_90_day" | "guarantee" =
    use90Day && rolling90HoursPerMonth > contractGuaranteeHoursPerMonth
      ? "rolling_90_day"
      : "guarantee";

  return {
    contractGuaranteeHoursPerMonth,
    userAvgCreditHoursPerMonth: use90Day ? rolling90HoursPerMonth : userAvgCreditHoursPerMonth,
    userAvgCreditHoursPerBidPeriod,
    plannerBaselineHoursPerMonth,
    plannerBaselineHoursPerBidPeriod,
    rollingWindowMonths: use90Day ? 3 : rollingMonths,
    dataSource: use90Day
      ? "rolling 90-day average"
      : hasData
        ? "historical average (sparse data — using guarantee floor)"
        : "no data — using guarantee",
    baselineSource,
  };
}

// ============================================
// HELPER: Determine feasibility rating
// ============================================
function determineFeasibility(
  projectedCents: number,
  targetCents: number,
  requiredExtraHoursPerMonth: number
): FeasibilityRating {
  const percentOfTarget = targetCents > 0 ? (projectedCents / targetCents) * 100 : 0;

  // Very achievable: >= 95% of target with minimal extra effort
  if (percentOfTarget >= 95 && requiredExtraHoursPerMonth <= 5) {
    return "VERY_ACHIEVABLE";
  }

  // Achievable with effort: 80-95% or requires 5-15 extra hours/month
  if (percentOfTarget >= 80 || (requiredExtraHoursPerMonth > 5 && requiredExtraHoursPerMonth <= 15)) {
    return "ACHIEVABLE_WITH_EFFORT";
  }

  // Unlikely without significant change: 60-80%
  if (percentOfTarget >= 60) {
    return "UNLIKELY_WITHOUT_SIGNIFICANT_CHANGE";
  }

  // Highly unlikely
  return "HIGHLY_UNLIKELY_UNDER_CURRENT_CONDITIONS";
}

// ============================================
// HELPER: Generate scenario explanation
// ============================================
function generateExplanation(
  scenarioType: ScenarioType,
  baseline: BaselineTransparency & { baselineSource: "rolling_90_day" | "guarantee" },
  targetCents: number,
  projectedCents: number,
  requiredExtraHoursPerBidPeriod: number,
  includeJA150: boolean
): string {
  const targetFormatted = `$${(targetCents / 100).toLocaleString()}`;
  const projectedFormatted = `$${(projectedCents / 100).toLocaleString()}`;
  const guaranteeHours = baseline.contractGuaranteeHoursPerMonth;
  const avgHours = baseline.userAvgCreditHoursPerMonth.toFixed(1);
  const baselineHours = baseline.plannerBaselineHoursPerMonth.toFixed(1);

  let explanation = `Your plan starts at the UPS minimum guarantee of ${guaranteeHours} hours/month. `;

  if (baseline.userAvgCreditHoursPerMonth > guaranteeHours) {
    explanation += `Based on your current average of ${avgHours} hours/month, `;
  } else {
    explanation += `Using the contract guarantee as your baseline, `;
  }

  const delta = projectedCents - targetCents;
  if (delta >= 0) {
    explanation += `reaching ${targetFormatted} is projected at your current pace (${projectedFormatted}).`;
  } else {
    const shortfall = `$${(Math.abs(delta) / 100).toLocaleString()}`;
    explanation += `reaching ${targetFormatted} would require approximately +${requiredExtraHoursPerBidPeriod.toFixed(1)} credit hours per bid period. `;

    if (scenarioType === "CURRENT_PACE") {
      explanation += `At your current pace, you're projected to earn ${projectedFormatted}, which is ${shortfall} below target.`;
    } else if (scenarioType === "OPTIMIZED") {
      explanation += `With optimized premium capture and reserve assumptions, this becomes more achievable.`;
    } else {
      explanation += `This requires aggressive premium capture`;
      if (includeJA150) {
        explanation += ` and JA pay (150%)`;
      }
      explanation += ` throughout the year.`;
    }
  }

  return explanation;
}

// ============================================
// HELPER: Generate what would need to change
// ============================================
function generateWhatWouldNeedToChange(
  scenarioType: ScenarioType,
  targetCents: number,
  projectedCents: number,
  requiredExtraHoursPerBidPeriod: number,
  includeJA150: boolean
): string[] {
  const bullets: string[] = [];

  if (projectedCents >= targetCents) {
    bullets.push("Your current pace meets or exceeds this target");
    return bullets;
  }

  if (requiredExtraHoursPerBidPeriod > 0) {
    bullets.push(`Fly approximately ${requiredExtraHoursPerBidPeriod.toFixed(1)} more credit hours per bid period`);
  }

  if (scenarioType === "OPTIMIZED" || scenarioType === "AGGRESSIVE") {
    bullets.push("Maximize premium code capture opportunities");
    bullets.push("Maintain high availability during reserve periods");
  }

  if (scenarioType === "AGGRESSIVE") {
    bullets.push("Accept JA opportunities when available");
    if (includeJA150) {
      bullets.push("JA pay (150%) is included in this projection");
    }
  }

  if (requiredExtraHoursPerBidPeriod > 15) {
    bullets.push("Consider adjusting target to a more achievable level");
  }

  return bullets;
}

// ============================================
// HELPER: Calculate single scenario
// ============================================
function calculateScenario(
  scenarioType: ScenarioType,
  baseline: BaselineTransparency & { baselineSource: "rolling_90_day" | "guarantee" },
  historicalAverages: HistoricalAverages & { rolling90DayCreditMinutes: number; rolling90DayMonthCount: number },
  targetCents: number,
  hourlyRateCents: number,
  settings: {
    includePremiums: boolean;
    includeReserveActivation: boolean;
    includeAverageSickUsage: boolean;
    includeJA150: boolean;
    planningMode: PlanningMode;
    extraCreditHoursPerBidPeriod?: number;
  },
  capPrefs?: CreditCapPreferences,
  capResult?: CreditCapResult
): ScenarioResult {
  // Base credit hours from baseline
  let monthlyBaseHours = baseline.plannerBaselineHoursPerMonth;

  // Add scenario-specific adjustments
  let extraHoursPerBidPeriod = settings.extraCreditHoursPerBidPeriod || 0;

  switch (scenarioType) {
    case "CURRENT_PACE":
      // No extra hours - use baseline
      break;
    case "OPTIMIZED":
      // +5-10 hours per bid period
      extraHoursPerBidPeriod = settings.extraCreditHoursPerBidPeriod || 7;
      break;
    case "AGGRESSIVE":
      // +15 hours per bid period
      extraHoursPerBidPeriod = settings.extraCreditHoursPerBidPeriod || 15;
      break;
  }

  // ── Apply Credit Cap Engine clamp to Open Time ──────────────────────────
  // If cap prefs are configured (awardedLineCredit > 0), clamp OT by engine.
  if (capPrefs && capPrefs.awardedLineCredit > 0) {
    const capInputs = buildCapInputsFromPrefs(capPrefs, extraHoursPerBidPeriod);
    const maxOT = computeMaxOpenTimeAllowed(capInputs);
    extraHoursPerBidPeriod = Math.min(extraHoursPerBidPeriod, maxOT);
  }
  // ────────────────────────────────────────────────────────────────────────

  // Apply planning mode multipliers
  let modeMultiplier = 1.0;
  switch (settings.planningMode) {
    case "CONSERVATIVE":
      modeMultiplier = 0.95;
      break;
    case "BALANCED":
      modeMultiplier = 1.0;
      break;
    case "AGGRESSIVE":
      modeMultiplier = 1.05;
      break;
  }

  // Calculate monthly hours including scenario extras
  // Use actual contract period days: BID_56=56, PAY_35=35, BID_28=28
  const periodDays = capPrefs?.periodType === "BID_56" ? UPS_BID_PERIOD_DAYS_56
    : capPrefs?.periodType === "PAY_35" ? 35
    : UPS_BID_PERIOD_DAYS_28;
  const bidPeriodHours = baseline.plannerBaselineHoursPerBidPeriod + extraHoursPerBidPeriod;
  const monthlyHours = bidPeriodHours * (30 / periodDays);
  const annualHours = monthlyHours * 12 * modeMultiplier;

  // Calculate base pay
  const basePay = Math.round((annualHours * hourlyRateCents) / 100) * 100; // Round to dollars

  // Calculate premium contribution
  let premiumsContribution = 0;
  if (settings.includePremiums) {
    const monthlyPremiumAvg = historicalAverages.avgPremiumCaptureCents;
    // Adjust premiums based on scenario
    let premiumMultiplier = 1.0;
    if (scenarioType === "OPTIMIZED") premiumMultiplier = 1.2;
    if (scenarioType === "AGGRESSIVE") premiumMultiplier = 1.5;
    premiumsContribution = Math.round(monthlyPremiumAvg * 12 * premiumMultiplier * modeMultiplier);
  }

  // Calculate reserve contribution
  let reserveContribution = 0;
  if (settings.includeReserveActivation) {
    // Estimate reserve activation pay boost
    const reserveFrequency = historicalAverages.reserveActivationFrequency;
    let reserveMultiplier = 1.0;
    if (scenarioType === "OPTIMIZED") reserveMultiplier = 1.2;
    if (scenarioType === "AGGRESSIVE") reserveMultiplier = 1.5;
    // Assume reserve activation adds ~5% to base pay on average
    reserveContribution = Math.round(basePay * 0.05 * reserveFrequency * reserveMultiplier);
  }

  // Calculate JA contribution (ONLY if enabled, NEVER by default)
  let jaContribution = 0;
  if (settings.includeJA150 && scenarioType === "AGGRESSIVE") {
    // Assume ~10% of hours might be JA at 150%
    const jaHours = annualHours * 0.1;
    const jaBonus = jaHours * hourlyRateCents * (JA_PAY_MULTIPLIER - 1);
    jaContribution = Math.round(jaBonus);
  }

  // Deduct sick time if enabled (conservative estimate)
  let sickDeduction = 0;
  if (settings.includeAverageSickUsage) {
    // Average pilot uses ~3-5 sick days per year
    const sickDays = settings.planningMode === "CONSERVATIVE" ? 5 : 3;
    const sickHours = sickDays * 6; // Min daily credit
    sickDeduction = Math.round(sickHours * hourlyRateCents);
  }

  // Total projected pay
  const total = basePay + premiumsContribution + reserveContribution + jaContribution - sickDeduction;

  const payBreakdown: PayComponentBreakdown = {
    basePay,
    premiumsContribution,
    reserveContribution,
    jaContribution,
    total,
  };

  // Calculate delta vs target
  const deltaVsTargetCents = total - targetCents;
  const percentOfTarget = targetCents > 0 ? (total / targetCents) * 100 : 0;

  // Calculate required extra hours to meet target
  let requiredExtraCreditHoursPerMonth = 0;
  let requiredExtraCreditHoursPerBidPeriod = 0;

  if (deltaVsTargetCents < 0) {
    // Need more hours to meet target
    const shortfallCents = Math.abs(deltaVsTargetCents);
    const additionalHoursNeeded = shortfallCents / hourlyRateCents;
    requiredExtraCreditHoursPerMonth = additionalHoursNeeded / 12;
    requiredExtraCreditHoursPerBidPeriod = requiredExtraCreditHoursPerMonth * (periodDays / 30);
  }

  // Determine feasibility
  const feasibilityRating = determineFeasibility(
    total,
    targetCents,
    requiredExtraCreditHoursPerMonth
  );

  // Generate explanation
  const explanation = generateExplanation(
    scenarioType,
    baseline,
    targetCents,
    total,
    requiredExtraCreditHoursPerBidPeriod,
    settings.includeJA150
  );

  // Generate what would need to change
  const whatWouldNeedToChange = generateWhatWouldNeedToChange(
    scenarioType,
    targetCents,
    total,
    requiredExtraCreditHoursPerBidPeriod,
    settings.includeJA150
  );

  // Scenario names
  const scenarioNames: Record<ScenarioType, string> = {
    CURRENT_PACE: "Current Pace",
    OPTIMIZED: "Optimized",
    AGGRESSIVE: "Aggressive",
  };

  return {
    scenarioType,
    scenarioName: scenarioNames[scenarioType],
    projectedAnnualCreditHours: Math.round(annualHours * 10) / 10,
    projectedMonthlyAvgCreditHours: Math.round(monthlyHours * 10) / 10,
    projectedBidPeriodAvgCreditHours: Math.round(bidPeriodHours * 10) / 10,
    projectedAnnualPay: payBreakdown,
    deltaVsTargetCents,
    percentOfTarget: Math.round(percentOfTarget * 10) / 10,
    feasibilityRating,
    requiredExtraCreditHoursPerMonth: Math.round(requiredExtraCreditHoursPerMonth * 10) / 10,
    requiredExtraCreditHoursPerBidPeriod: Math.round(requiredExtraCreditHoursPerBidPeriod * 10) / 10,
    explanation,
    whatWouldNeedToChange,
  };
}

// ============================================
// POST /api/planner/annual - Calculate scenarios
// ============================================
annualPlannerRouter.post("/annual", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const body = await c.req.json();

    const {
      targetAnnualIncomeCents,
      hourlyRateCents: inputHourlyRate,
      includePremiums = true,
      includeReserveActivation = true,
      includeAverageSickUsage = true,
      includeJA150 = false, // NEVER default on
      planningMode = "BALANCED",
      extraCreditHoursPerBidPeriod,
      captureCommonPremiums,
      heavyReserveYear,
      conservativeAssumptions,
      periodType = "BID_56", // pilot's contract period — default UPS 56-day bid period
    } = body;

    // Actual period length in days for this pilot's contract
    const contractPeriodDays = periodType === "BID_56" ? UPS_BID_PERIOD_DAYS_56 : UPS_BID_PERIOD_DAYS_28; // 56 or 28

    if (!targetAnnualIncomeCents || targetAnnualIncomeCents <= 0) {
      return c.json({ error: "targetAnnualIncomeCents is required and must be positive" }, 400);
    }

    // Get profile for hourly rate if not provided
    const profile = await db.profile.findUnique({
      where: { userId },
    });
    const hourlyRateCents = inputHourlyRate || profile?.hourlyRateCents || 32500;

    // ── Build Credit Cap Preferences from profile ───────────────────────────
    const capPrefs: CreditCapPreferences = {
      periodType: (profile?.creditCapPeriodType as CreditCapPreferences["periodType"]) ?? "BID_56",
      awardedLineCredit: profile?.creditCapAwardedLineCredit ?? 0,
      isRDGLine: profile?.creditCapIsRDGLine ?? false,
      assignmentType: (profile?.creditCapAssignmentType as CreditCapPreferences["assignmentType"]) ?? "DOMESTIC",
      exclusionsDefaults: {
        vacationCredit: profile?.creditCapExclusionVacation ?? 0,
        shortTermTrainingCredit: profile?.creditCapExclusionTraining ?? 0,
        juniorManningCredit: profile?.creditCapExclusionJuniorManning ?? 0,
        crafActivationCredit: profile?.creditCapExclusionCRAF ?? 0,
        sickLeaveCredit: profile?.creditCapExclusionSick ?? 0,
      },
      allowTripCompletionOvercap: profile?.creditCapAllowTripCompletion ?? false,
      tripCompletionCreditOvercap: profile?.creditCapTripCompletionOvercap ?? 0,
      enableVacationDropCapRelief: profile?.creditCapEnableVacationRelief ?? false,
      droppedTripsCreditForVacation: profile?.creditCapDroppedTripsCredit ?? 0,
      hasVacationInPeriod: profile?.creditCapHasVacationInPeriod ?? false,
    };

    // Evaluate cap status for the "aggressive" scenario OT request (most informative)
    const aggressiveOT = extraCreditHoursPerBidPeriod ?? 15;
    const capResultForResponse = capPrefs.awardedLineCredit > 0
      ? evaluateCreditedTimeStatus(buildCapInputsFromPrefs(capPrefs, aggressiveOT))
      : null;
    // ────────────────────────────────────────────────────────────────────────

    // Get historical data
    const rollingMonths = 12;
    const historicalAverages = await getHistoricalAverages(userId, rollingMonths);

    // Calculate baseline
    const baseline = calculateBaseline(historicalAverages, rollingMonths);

    // Adjust settings based on fidgets
    const effectiveSettings = {
      includePremiums: captureCommonPremiums ?? includePremiums,
      includeReserveActivation: heavyReserveYear ?? includeReserveActivation,
      includeAverageSickUsage,
      includeJA150, // NEVER assume
      planningMode: (conservativeAssumptions ? "CONSERVATIVE" : planningMode) as PlanningMode,
      extraCreditHoursPerBidPeriod,
    };

    // Calculate all three scenarios (with cap enforcement)
    const scenarios: ScenarioResult[] = [
      calculateScenario("CURRENT_PACE", baseline, historicalAverages, targetAnnualIncomeCents, hourlyRateCents, effectiveSettings, capPrefs, capResultForResponse ?? undefined),
      calculateScenario("OPTIMIZED", baseline, historicalAverages, targetAnnualIncomeCents, hourlyRateCents, effectiveSettings, capPrefs, capResultForResponse ?? undefined),
      calculateScenario("AGGRESSIVE", baseline, historicalAverages, targetAnnualIncomeCents, hourlyRateCents, effectiveSettings, capPrefs, capResultForResponse ?? undefined),
    ];

    // Override CURRENT_PACE with YTD extrapolation — same formula as Career Benchmarks and Dashboard.
    // This ensures all three views show the same "projected annual" number:
    //   ytdPayCents (trip-level payCreditMinutes + guarantee floor) / dayOfYear * 365
    {
      const now = new Date();
      const yearStartISO = `${now.getFullYear()}-01-01`;
      const todayISO = now.toISOString().split("T")[0] ?? "";
      const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
      const monthsElapsedNow = now.getMonth() + 1;

      const ytdTripsForPace = await db.trip.findMany({
        where: {
          userId,
          status: { notIn: ["cancelled", "override"] },
          startDate: { gte: yearStartISO, lte: todayISO },
        },
        select: { id: true, tripNumber: true, payCreditMinutes: true, totalCreditMinutes: true },
      });

      // Deduplicate by tripNumber
      const seenForPace = new Map<string, typeof ytdTripsForPace[0]>();
      for (const t of ytdTripsForPace) {
        const key = t.tripNumber || t.id;
        const existing = seenForPace.get(key);
        if (!existing || t.id > existing.id) seenForPace.set(key, t);
      }
      const ytdTripCreditMinutes = Array.from(seenForPace.values()).reduce(
        (sum, t) => sum + (t.payCreditMinutes || t.totalCreditMinutes || 0), 0
      );
      const ytdCreditFloored = applyYTDGuaranteeFloorSimple(ytdTripCreditMinutes, monthsElapsedNow, profile?.creditCapPeriodType ?? null);
      const ytdPayCentsForPace = Math.round((ytdCreditFloored / 60) * hourlyRateCents);
      const currentYearForPace = now.getFullYear();
      const yearDaysTotalForPace = (currentYearForPace % 4 === 0 && (currentYearForPace % 100 !== 0 || currentYearForPace % 400 === 0)) ? 366 : 365;
      const ytdProjectedAnnualCents = dayOfYear > 0 ? Math.round((ytdPayCentsForPace / dayOfYear) * yearDaysTotalForPace) : 0;

      if (ytdProjectedAnnualCents > 0 && scenarios[0]) {
        const cp = scenarios[0];
        cp.projectedAnnualPay = {
          basePay: ytdProjectedAnnualCents,
          premiumsContribution: 0,
          reserveContribution: 0,
          jaContribution: 0,
          total: ytdProjectedAnnualCents,
        };
        cp.deltaVsTargetCents = ytdProjectedAnnualCents - targetAnnualIncomeCents;
        cp.percentOfTarget = targetAnnualIncomeCents > 0
          ? Math.round((ytdProjectedAnnualCents / targetAnnualIncomeCents) * 1000) / 10
          : 0;
        cp.feasibilityRating = determineFeasibility(
          ytdProjectedAnnualCents,
          targetAnnualIncomeCents,
          cp.deltaVsTargetCents < 0 ? Math.abs(cp.deltaVsTargetCents) / hourlyRateCents / 12 : 0
        );
        cp.projectedAnnualCreditHours = Math.round((ytdTripCreditMinutes / monthsElapsedNow) * 12 / 60 * 10) / 10;

        // Also anchor OPTIMIZED and AGGRESSIVE to YTD pace + extra OT per remaining period.
        // Without this, they use a historical/guarantee baseline that can be far below actual pace,
        // causing them to project less than CURRENT_PACE and appear NOT_REALISTIC incorrectly.
        const msLeftYTD = new Date(now.getFullYear(), 11, 31).getTime() - now.getTime();
        const daysLeftYTD = Math.max(1, Math.ceil(msLeftYTD / (1000 * 60 * 60 * 24)));
        const bpRemaining = Math.max(0, daysLeftYTD / contractPeriodDays);

        const optimizedBaseExtra = (effectiveSettings.extraCreditHoursPerBidPeriod ?? 7);
        const aggressiveBaseExtra = (effectiveSettings.extraCreditHoursPerBidPeriod ?? 15);

        // Clamp by cap if configured
        const optimizedExtraHrs = capPrefs.awardedLineCredit > 0
          ? Math.min(optimizedBaseExtra, computeMaxOpenTimeAllowed(buildCapInputsFromPrefs(capPrefs, optimizedBaseExtra)))
          : optimizedBaseExtra;
        const aggressiveExtraHrs = capPrefs.awardedLineCredit > 0
          ? Math.min(aggressiveBaseExtra, computeMaxOpenTimeAllowed(buildCapInputsFromPrefs(capPrefs, aggressiveBaseExtra)))
          : aggressiveBaseExtra;

        const optimizedProjected = ytdProjectedAnnualCents + Math.round(optimizedExtraHrs * bpRemaining * hourlyRateCents);
        const aggressiveProjected = ytdProjectedAnnualCents + Math.round(aggressiveExtraHrs * bpRemaining * hourlyRateCents);

        if (scenarios[1]) {
          const opt = scenarios[1];
          opt.projectedAnnualPay = { basePay: optimizedProjected, premiumsContribution: 0, reserveContribution: 0, jaContribution: 0, total: optimizedProjected };
          opt.deltaVsTargetCents = optimizedProjected - targetAnnualIncomeCents;
          opt.percentOfTarget = targetAnnualIncomeCents > 0 ? Math.round((optimizedProjected / targetAnnualIncomeCents) * 1000) / 10 : 0;
          opt.feasibilityRating = determineFeasibility(
            optimizedProjected,
            targetAnnualIncomeCents,
            opt.deltaVsTargetCents < 0 ? Math.abs(opt.deltaVsTargetCents) / hourlyRateCents / 12 : 0
          );
          opt.requiredExtraCreditHoursPerBidPeriod = optimizedExtraHrs;
        }

        if (scenarios[2]) {
          const agg = scenarios[2];
          agg.projectedAnnualPay = { basePay: aggressiveProjected, premiumsContribution: 0, reserveContribution: 0, jaContribution: 0, total: aggressiveProjected };
          agg.deltaVsTargetCents = aggressiveProjected - targetAnnualIncomeCents;
          agg.percentOfTarget = targetAnnualIncomeCents > 0 ? Math.round((aggressiveProjected / targetAnnualIncomeCents) * 1000) / 10 : 0;
          agg.feasibilityRating = determineFeasibility(
            aggressiveProjected,
            targetAnnualIncomeCents,
            agg.deltaVsTargetCents < 0 ? Math.abs(agg.deltaVsTargetCents) / hourlyRateCents / 12 : 0
          );
          agg.requiredExtraCreditHoursPerBidPeriod = aggressiveExtraHrs;
        }
      }
    }

    // Find best-fit scenario (closest to target that's achievable)
    let bestFitIndex = 0;
    const achievableRatings: FeasibilityRating[] = ["VERY_ACHIEVABLE", "ACHIEVABLE_WITH_EFFORT"];

    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      if (!scenario) continue;

      if (achievableRatings.includes(scenario.feasibilityRating)) {
        // Prefer the one closest to 100% of target
        if (Math.abs(scenario.percentOfTarget - 100) < Math.abs((scenarios[bestFitIndex]?.percentOfTarget ?? 0) - 100)) {
          bestFitIndex = i;
        }
      }
    }

    const today = new Date();

    // ——————————————————————————————————————————
    // NEW: Gap equivalents + From Today Forward
    // ——————————————————————————————————————————
    const bestScenario = scenarios[bestFitIndex];
    const projectedAnnualPay = bestScenario?.projectedAnnualPay.total ?? 0;

    // YTD earned so far (from historical query, actual logged trip pay)
    const ytdEarnedCents = historicalAverages.ytdPayCents;

    // gap = max(0, target - best-fit projected annual pay)
    // Using the scenario projection (not raw YTD) ensures the "from today" engine is
    // aligned with the scenario gap — both measure the same shortfall.
    const gapRemainingCents = Math.max(0, targetAnnualIncomeCents - projectedAnnualPay);

    // Hourly values
    const basePayPerCreditHour = hourlyRateCents;           // cents per hour
    const jaPayPerCreditHour = hourlyRateCents * JA_PAY_MULTIPLIER; // cents per JA hour

    // Gap → credit-hour equivalents
    const gapEquivBaseCreditHours = gapRemainingCents > 0
      ? Math.round((gapRemainingCents / basePayPerCreditHour) * 10) / 10
      : 0;
    const gapEquivJACreditHours = gapRemainingCents > 0
      ? Math.round((gapRemainingCents / jaPayPerCreditHour) * 10) / 10
      : 0;

    // From Today Forward
    const yearEnd = new Date(today.getFullYear(), 11, 31);
    const msLeft = yearEnd.getTime() - today.getTime();

    // remainingIncomeNeededCents: use the scenario-projection gap so the "from today"
    // pacing requirements are consistent with what the scenario engine already computed.
    // Raw ytdEarnedCents excludes premiums/bonuses that the projection includes, causing
    // the two engines to diverge and produce inflated monthly requirements.
    const remainingIncomeNeededCents = gapRemainingCents;

    // Contract-period-aware days: 56 for bid-period pilots, 28 for pay-period pilots
    const daysLeft = Math.max(1, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    const bidPeriodsRemaining = Math.max(1, Math.round((daysLeft / contractPeriodDays) * 10) / 10);

    // Pay periods remaining — always 28-day UPS pay periods (for the 28-day pay-period card)
    const todayISO = today.toISOString().split("T")[0] ?? "";
    const currentYear = today.getFullYear();
    let payPeriodsRemaining = 1;
    if (currentYear === 2026) {
      const distinctPeriods = new Set<number>();
      for (const pp of PAY_PERIODS_2026) {
        if (pp.payType === "standard" && pp.endDate >= todayISO) {
          distinctPeriods.add(pp.periodNumber);
        }
      }
      payPeriodsRemaining = Math.max(1, distinctPeriods.size);
    } else {
      payPeriodsRemaining = Math.max(1, Math.round(daysLeft / UPS_BID_PERIOD_DAYS_28));
    }

    // Contract guarantee for this pilot's period type
    const baselineHoursPerContractPeriod = periodType === "BID_56"
      ? UPS_MONTHLY_GUARANTEE_HOURS * 2   // 150 hrs per 56-day bid period
      : UPS_MONTHLY_GUARANTEE_HOURS;       // 75 hrs per 28-day pay period
    const baselineHoursPerMonth = UPS_MONTHLY_GUARANTEE_HOURS; // 75.0 always

    // Extra hours per period needed purely to close the income gap
    // gap / hourlyRate / periodsLeft = incremental hours above current trajectory
    const extraHoursPerBidPeriodBase =
      bidPeriodsRemaining > 0 && remainingIncomeNeededCents > 0
        ? Math.round((remainingIncomeNeededCents / basePayPerCreditHour / bidPeriodsRemaining) * 10) / 10
        : 0;
    const extraHoursPerPayPeriodBase =
      payPeriodsRemaining > 0 && remainingIncomeNeededCents > 0
        ? Math.round((remainingIncomeNeededCents / basePayPerCreditHour / payPeriodsRemaining) * 10) / 10
        : 0;

    // Total pace required per contract period = baseline + incremental gap hours
    const requiredCreditHoursPerBidPeriodBase =
      Math.round((baselineHoursPerContractPeriod + extraHoursPerBidPeriodBase) * 10) / 10;
    const requiredCreditHoursPerBidPeriodJA =
      Math.round((requiredCreditHoursPerBidPeriodBase / JA_PAY_MULTIPLIER) * 10) / 10;

    const requiredCreditHoursPerPayPeriodBase =
      Math.round((UPS_MONTHLY_GUARANTEE_HOURS + extraHoursPerPayPeriodBase) * 10) / 10;
    const requiredCreditHoursPerPayPeriodJA =
      Math.round((requiredCreditHoursPerPayPeriodBase / JA_PAY_MULTIPLIER) * 10) / 10;

    // Monthly: derive from the contract-period extra hours scaled to calendar months
    const monthsLeft = Math.max(1, Math.round((daysLeft / 30.44) * 10) / 10);
    const extraHoursPerMonthBase = Math.round((extraHoursPerBidPeriodBase * (30.44 / contractPeriodDays)) * 10) / 10;
    const requiredCreditHoursPerMonthFromTodayBase =
      Math.round((baselineHoursPerMonth + extraHoursPerMonthBase) * 10) / 10;
    const requiredCreditHoursPerMonthFromTodayJA =
      Math.round((requiredCreditHoursPerMonthFromTodayBase / JA_PAY_MULTIPLIER) * 10) / 10;

    // Best Lever: annual value of +10 credit hours/month
    const annualValueOf10ExtraHoursBase = Math.round(10 * basePayPerCreditHour * 12);
    const annualValueOf10ExtraHoursJA = Math.round(10 * jaPayPerCreditHour * 12);

    // Baselines (contractual truth)
    const baselineMonthlyHours = UPS_MONTHLY_GUARANTEE_HOURS;              // 75 hrs/month
    const baselineBidPeriodHours_28 = UPS_MONTHLY_GUARANTEE_HOURS;         // 75 hrs (28-day)
    const baselineBidPeriodHours_56 = UPS_MONTHLY_GUARANTEE_HOURS * 2;     // 150 hrs (56-day)
    const baselinePayPeriodHours = UPS_MONTHLY_GUARANTEE_HOURS;             // 75 hrs

    const requiredPaceRatio = baselineMonthlyHours > 0
      ? requiredCreditHoursPerMonthFromTodayBase / baselineMonthlyHours
      : 1;

    // Adjustment deltas = extra hours ABOVE the guarantee for this pilot's period type
    const adjustmentMonthlyBase    = Math.max(0, Math.round(extraHoursPerMonthBase * 10) / 10);
    const adjustmentMonthlyJA      = Math.max(0, Math.round((adjustmentMonthlyBase / JA_PAY_MULTIPLIER) * 10) / 10);
    // For the bid-period card: adjustment = extra above this period's guarantee
    const adjustmentBidPeriodBase_28 = Math.max(0, Math.round(extraHoursPerPayPeriodBase * 10) / 10);
    const adjustmentBidPeriodBase_56 = Math.max(0, Math.round(extraHoursPerBidPeriodBase * 10) / 10);
    // Legacy alias — matches whatever the pilot's actual contract period is
    const adjustmentBidPeriodBase  = periodType === "BID_56" ? adjustmentBidPeriodBase_56 : adjustmentBidPeriodBase_28;
    const adjustmentBidPeriodJA    = Math.max(0, Math.round((adjustmentBidPeriodBase / JA_PAY_MULTIPLIER) * 10) / 10);
    const adjustmentPayPeriodBase  = Math.max(0, Math.round(extraHoursPerPayPeriodBase * 10) / 10);
    const adjustmentPayPeriodJA    = Math.max(0, Math.round((adjustmentPayPeriodBase / JA_PAY_MULTIPLIER) * 10) / 10);

    // Normal variability range for bid period (±~15% of baseline, roughly ±12 hrs on 87 hr baseline)
    const normalBidVariability = Math.round(baselineBidPeriodHours_28 * 0.14 * 10) / 10;

    return c.json({
      targetAnnualIncomeCents,
      hourlyRateCents,
      currentYear: today.getFullYear(),
      asOfDate: today.toISOString().split("T")[0],
      baseline,
      historicalAverages,
      scenarios,
      bestFitScenarioIndex: bestFitIndex,
      // ——— NEW derived fields ———
      gapEquivalents: {
        gapRemainingCents,
        gapEquivBaseCreditHours,
        gapEquivJACreditHours,
        basePayPerCreditHour,
        jaPayPerCreditHour,
        jaMultiplier: JA_PAY_MULTIPLIER,
      },
      fromTodayForward: {
        monthsLeft,
        remainingIncomeNeededCents,
        requiredCreditHoursPerMonthBase: requiredCreditHoursPerMonthFromTodayBase,
        requiredCreditHoursPerMonthJA: requiredCreditHoursPerMonthFromTodayJA,
        bidPeriodsRemaining,
        payPeriodsRemaining,
        requiredCreditHoursPerBidPeriodBase,
        requiredCreditHoursPerBidPeriodJA,
        requiredCreditHoursPerPayPeriodBase,
        requiredCreditHoursPerPayPeriodJA,
        baselineMonthlyHours,
        baselineBidPeriodHours: baselineBidPeriodHours_28,
        baselineBidPeriodHours_28,
        baselineBidPeriodHours_56,
        baselinePayPeriodHours,
        adjustmentBidPeriodBase_28,
        adjustmentBidPeriodBase_56,
        // Adjustment deltas (required - baseline) — the hero numbers
        adjustmentMonthlyBase,
        adjustmentMonthlyJA,
        adjustmentBidPeriodBase,
        adjustmentBidPeriodJA,
        adjustmentPayPeriodBase,
        adjustmentPayPeriodJA,
        // Normal variability band for bid period
        normalBidVariability,
        paceRatio: Math.round(requiredPaceRatio * 100) / 100,
        baselineSource: baseline.baselineSource,
      },
      bestLever: {
        annualValueOf10ExtraHoursBase,
        annualValueOf10ExtraHoursJA,
      },
      // ——————————————————————————
      settingsUsed: {
        includePremiums: effectiveSettings.includePremiums,
        includeReserveActivation: effectiveSettings.includeReserveActivation,
        includeAverageSickUsage: effectiveSettings.includeAverageSickUsage,
        includeJA150: effectiveSettings.includeJA150,
        planningMode: effectiveSettings.planningMode,
      },
      // Credit Cap Engine result (null when awardedLineCredit not configured)
      creditCapResult: capResultForResponse,
      disclaimer: LEGAL_DISCLAIMER,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error calculating annual plan:", error);
    return c.json({ error: "Failed to calculate annual plan" }, 500);
  }
});

// ============================================
// POST /api/planner/annual/save - Save scenario
// ============================================
annualPlannerRouter.post("/annual/save", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const body = await c.req.json();

    const {
      scenarioName,
      targetAnnualIncomeCents,
      scenarioType,
      settings,
      projectedAnnualPayCents,
      feasibilityRating,
    } = body;

    if (!scenarioName || !targetAnnualIncomeCents || !scenarioType) {
      return c.json({ error: "scenarioName, targetAnnualIncomeCents, and scenarioType are required" }, 400);
    }

    const scenario = await db.savedPlannerScenario.create({
      data: {
        userId,
        scenarioName,
        targetAnnualIncomeCents,
        scenarioType,
        settingsJson: JSON.stringify(settings || {}),
        projectedAnnualPayCents: projectedAnnualPayCents || 0,
        feasibilityRating: feasibilityRating || "ACHIEVABLE_WITH_EFFORT",
        savedAt: new Date(),
      },
    });

    return c.json({
      success: true,
      scenario: {
        id: scenario.id,
        userId: scenario.userId,
        scenarioName: scenario.scenarioName,
        targetAnnualIncomeCents: scenario.targetAnnualIncomeCents,
        scenarioType: scenario.scenarioType,
        settings: JSON.parse(scenario.settingsJson),
        projectedAnnualPayCents: scenario.projectedAnnualPayCents,
        feasibilityRating: scenario.feasibilityRating,
        savedAt: scenario.savedAt.toISOString(),
        createdAt: scenario.createdAt.toISOString(),
        updatedAt: scenario.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error saving scenario:", error);
    return c.json({ error: "Failed to save scenario" }, 500);
  }
});

// ============================================
// GET /api/planner/annual/saved - List saved scenarios
// ============================================
annualPlannerRouter.get("/annual/saved", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);

    const scenarios = await db.savedPlannerScenario.findMany({
      where: { userId, isActive: true },
      orderBy: { savedAt: "desc" },
    });

    return c.json({
      scenarios: scenarios.map((s) => ({
        id: s.id,
        userId: s.userId,
        scenarioName: s.scenarioName,
        targetAnnualIncomeCents: s.targetAnnualIncomeCents,
        scenarioType: s.scenarioType,
        settings: JSON.parse(s.settingsJson),
        projectedAnnualPayCents: s.projectedAnnualPayCents,
        feasibilityRating: s.feasibilityRating,
        savedAt: s.savedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      totalCount: scenarios.length,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching saved scenarios:", error);
    return c.json({ error: "Failed to fetch saved scenarios" }, 500);
  }
});

// ============================================
// DELETE /api/planner/annual/saved/:id - Delete saved scenario
// ============================================
annualPlannerRouter.delete("/annual/saved/:id", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const id = c.req.param("id");

    // Soft delete by marking inactive
    await db.savedPlannerScenario.updateMany({
      where: { id, userId },
      data: { isActive: false },
    });

    return c.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error deleting scenario:", error);
    return c.json({ error: "Failed to delete scenario" }, 500);
  }
});

// ============================================
// GET /api/planner/annual/tracking - Get tracking vs saved plan
// ============================================
annualPlannerRouter.get("/annual/tracking", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);

    // Get the most recent saved plan
    const savedPlan = await db.savedPlannerScenario.findFirst({
      where: { userId, isActive: true },
      orderBy: { savedAt: "desc" },
    });

    const today = new Date();
    const currentYear = today.getFullYear();
    const yearStart = new Date(currentYear, 0, 1);
    const daysIntoYear = Math.floor((today.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const daysRemaining = (currentYear % 4 === 0 ? 366 : 365) - daysIntoYear;

    // Get YTD totals
    const yearStartISO = `${currentYear}-01-01`;
    const todayISO = today.toISOString().split("T")[0] ?? "";

    const ytdTrips = await db.trip.findMany({
      where: {
        userId,
        status: { notIn: ["cancelled", "override"] },
        startDate: { gte: yearStartISO, lte: todayISO },
      },
    });

    let ytdActualPayCents = 0;
    let ytdActualCreditMinutes = 0;

    for (const trip of ytdTrips) {
      ytdActualPayCents += trip.totalPayCents || 0;
      ytdActualCreditMinutes += trip.totalCreditMinutes || 0;
    }

    // Linear extrapolation for projected
    const dailyAvgPayCents = daysIntoYear > 0 ? ytdActualPayCents / daysIntoYear : 0;
    const ytdProjectedPayCents = Math.round(dailyAvgPayCents * (daysIntoYear + daysRemaining));

    // Determine tracking status vs plan
    let trackingStatus: "ABOVE_PLAN" | "ON_TRACK" | "BELOW_PLAN" = "ON_TRACK";
    let deltaVsPlanCents = 0;
    let deltaVsPlanPercent = 0;

    if (savedPlan) {
      const expectedByNow = Math.round(
        (savedPlan.projectedAnnualPayCents * daysIntoYear) / (daysIntoYear + daysRemaining)
      );
      deltaVsPlanCents = ytdActualPayCents - expectedByNow;
      deltaVsPlanPercent = expectedByNow > 0 ? (deltaVsPlanCents / expectedByNow) * 100 : 0;

      if (deltaVsPlanPercent > 5) {
        trackingStatus = "ABOVE_PLAN";
      } else if (deltaVsPlanPercent < -5) {
        trackingStatus = "BELOW_PLAN";
      }
    }

    return c.json({
      hasSavedPlan: !!savedPlan,
      savedPlan: savedPlan
        ? {
            id: savedPlan.id,
            userId: savedPlan.userId,
            scenarioName: savedPlan.scenarioName,
            targetAnnualIncomeCents: savedPlan.targetAnnualIncomeCents,
            scenarioType: savedPlan.scenarioType,
            settings: JSON.parse(savedPlan.settingsJson),
            projectedAnnualPayCents: savedPlan.projectedAnnualPayCents,
            feasibilityRating: savedPlan.feasibilityRating,
            savedAt: savedPlan.savedAt.toISOString(),
            createdAt: savedPlan.createdAt.toISOString(),
            updatedAt: savedPlan.updatedAt.toISOString(),
          }
        : null,
      ytdActualPayCents,
      ytdActualCreditMinutes,
      ytdProjectedPayCents,
      trackingStatus,
      deltaVsPlanCents,
      deltaVsPlanPercent: Math.round(deltaVsPlanPercent * 10) / 10,
      daysIntoYear,
      daysRemaining,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching tracking:", error);
    return c.json({ error: "Failed to fetch tracking" }, 500);
  }
});
