/**
 * Career Insight Engine — PilotPay
 *
 * Generates personalized, data-driven career strategy insights by analyzing:
 *   - User's career profile (position, DOH, DOB, hourly rate)
 *   - Pay table data (FO vs Captain earnings at each seniority step)
 *   - Retirement forecast (upgrade scenario vs FO-only)
 *   - Career priority preference (Maximize Earnings / Schedule Quality / Balanced)
 *
 * Insight types:
 *   UPGRADE_PAY_LEVERAGE      — Captain earnings significantly exceed FO
 *   BREAK_EVEN_ANALYSIS       — When upgrading becomes financially superior
 *   RETIREMENT_IMPACT         — How upgrade timing affects retirement income
 *   QUALITY_OF_LIFE_TRADEOFF  — Early upgrade + low seniority schedule warning
 *   SENIOR_FO_VIABILITY       — Strong case for remaining FO long-term
 *   BALANCED_CAREER_STRATEGY  — Mid-career upgrade provides good balance
 */

import type { PilotProfile } from "@/lib/contracts";
import type { RetirementForecast } from "@/lib/state/retirement-store";
import {
  UPS_PAY_TABLES,
  getPayTableForYear,
  DEFAULT_UPGRADE_YEARS_FROM_DOH,
} from "@/lib/state/retirement-store";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type InsightType =
  | "UPGRADE_PAY_LEVERAGE"
  | "BREAK_EVEN_ANALYSIS"
  | "RETIREMENT_IMPACT"
  | "QUALITY_OF_LIFE_TRADEOFF"
  | "SENIOR_FO_VIABILITY"
  | "BALANCED_CAREER_STRATEGY";

export type InsightImportance = "high" | "medium" | "low";

export type CareerPriority = "maximize_earnings" | "maximize_schedule" | "balanced";

export interface CareerInsightItem {
  type: InsightType;
  title: string;
  message: string;
  importance: InsightImportance;
  /** Numeric score for sorting; higher = display first */
  score: number;
  /** Optional supporting data for potential future chart use */
  meta?: {
    upgradeYear?: number;
    annualDifferenceDollars?: number;
    lifetimeDifferenceDollars?: number;
    yearsToBreakEven?: number;
    retirementImpactDollars?: number;
    currentYearOfService?: number;
    yearsUntilBreakEven?: number;
  };
}

export interface CareerInsightContext {
  /** User's current profile */
  profile: PilotProfile;
  /** Retirement forecast for upgrade scenario */
  upgradeForecast: RetirementForecast | null;
  /** Retirement forecast for FO-only scenario */
  foOnlyForecast: RetirementForecast | null;
  /** User's career priority preference */
  careerPriority: CareerPriority;
  /** Expected upgrade year (calendar year, e.g. 2028) */
  expectedUpgradeYear: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmt(dollars: number): string {
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}K`;
  return `$${Math.round(dollars).toLocaleString()}`;
}

function currentYOS(dateOfHire: string | null): number {
  if (!dateOfHire) return 1;
  const hire = new Date(dateOfHire);
  const now = new Date();
  return Math.max(1, Math.floor((now.getTime() - hire.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) + 1);
}

function upgradeYOSFromCalendarYear(upgradeCalYear: number, doh: string): number {
  const dohYear = new Date(doh).getFullYear();
  return Math.max(1, Math.min(upgradeCalYear - dohYear, 15));
}

/** Get avg total pay (dollars) for a seat at a given YOS step */
function avgTotalAtStep(seat: "fo" | "captain", yosStep: number): number {
  // Use the most recent pay table
  const table = getPayTableForYear(new Date().getFullYear());
  const rows = seat === "fo" ? table.fo : table.captain;
  const row = rows.find((r) => r.yearOfService === yosStep) ?? rows[rows.length - 1];
  return row.avgTotalPayCents / 100;
}

/** Compute cumulative earnings from upgradeYOS to capYOS for both FO and CPT paths */
function computeBreakEven(
  upgradeYOS: number,
  doh: string,
  horizonYears: number = 20
): { yearsToBreakEven: number | null; lifetimeGain: number } {
  let foRunning = 0;
  let cptRunning = 0;
  let breakEvenYear: number | null = null;

  for (let i = 0; i < horizonYears; i++) {
    const step = Math.max(1, Math.min(upgradeYOS + i, 15));
    foRunning += avgTotalAtStep("fo", step);
    cptRunning += avgTotalAtStep("captain", step);

    if (breakEvenYear === null && cptRunning > foRunning) {
      breakEvenYear = i + 1; // 1-indexed year after upgrade
    }
  }

  return {
    yearsToBreakEven: breakEvenYear,
    lifetimeGain: Math.round(cptRunning - foRunning),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INSIGHT GENERATORS
// Each returns an InsightItem or null if conditions are not met
// ─────────────────────────────────────────────────────────────────────────────

function genUpgradePayLeverage(ctx: CareerInsightContext): CareerInsightItem | null {
  const { profile } = ctx;
  if (!profile.dateOfHire) return null;

  const yos = currentYOS(profile.dateOfHire);
  const foAnnual = avgTotalAtStep("fo", Math.min(yos, 15));
  const cptAnnual = avgTotalAtStep("captain", Math.min(yos, 15));
  const diff = cptAnnual - foAnnual;

  // Only trigger when captain earns significantly more ($100K+ annually)
  if (diff < 100_000) return null;

  const upgradeYear = ctx.expectedUpgradeYear;
  const upgradeLabel = upgradeYear
    ? String(upgradeYear)
    : `Year ${yos + DEFAULT_UPGRADE_YEARS_FROM_DOH}`;

  const lifetimeGain = diff * 20; // 20-year simple horizon

  let scoreBoost = 0;
  if (ctx.careerPriority === "maximize_earnings") scoreBoost = 30;
  else if (ctx.careerPriority === "balanced") scoreBoost = 10;

  return {
    type: "UPGRADE_PAY_LEVERAGE",
    title: "Captain Pay Leverage",
    message: `Upgrading in ${upgradeLabel} increases projected annual earnings by approximately ${fmt(diff)}. Over a 20-year horizon, this represents over ${fmt(lifetimeGain)} in additional income compared to remaining FO.`,
    importance: "high",
    score: 90 + scoreBoost,
    meta: {
      upgradeYear: upgradeYear ?? undefined,
      annualDifferenceDollars: Math.round(diff),
      lifetimeDifferenceDollars: Math.round(lifetimeGain),
    },
  };
}

function genBreakEvenAnalysis(ctx: CareerInsightContext): CareerInsightItem | null {
  const { profile } = ctx;
  if (!profile.dateOfHire) return null;

  const upgradeYear = ctx.expectedUpgradeYear;
  if (!upgradeYear) return null;

  const upgradeYOS = upgradeYOSFromCalendarYear(upgradeYear, profile.dateOfHire);
  const { yearsToBreakEven, lifetimeGain } = computeBreakEven(upgradeYOS, profile.dateOfHire);

  if (yearsToBreakEven === null) return null;

  const breakEvenLabel = yearsToBreakEven === 1 ? "1 year" : `${yearsToBreakEven} years`;

  return {
    type: "BREAK_EVEN_ANALYSIS",
    title: "Upgrade Break-Even",
    message: `Based on pay table projections, upgrading to Captain pays off financially after approximately ${breakEvenLabel} in the left seat. Over a 20-year horizon, the Captain path generates approximately ${fmt(lifetimeGain)} more in cumulative earnings.`,
    importance: "medium",
    score: 70,
    meta: {
      yearsToBreakEven,
      lifetimeDifferenceDollars: Math.round(lifetimeGain),
    },
  };
}

function genRetirementImpact(ctx: CareerInsightContext): CareerInsightItem | null {
  const { upgradeForecast, foOnlyForecast } = ctx;
  if (!upgradeForecast || !foOnlyForecast) return null;

  const retirementDiff =
    (upgradeForecast.projectedTotalAnnualRetirementIncomeCents -
      foOnlyForecast.projectedTotalAnnualRetirementIncomeCents) / 100;

  if (Math.abs(retirementDiff) < 2_000) return null;

  const upgradeYear = ctx.expectedUpgradeYear;
  const upgradeLabel = upgradeYear ? String(upgradeYear) : "at upgrade";

  if (retirementDiff > 0) {
    return {
      type: "RETIREMENT_IMPACT",
      title: "Retirement Leverage",
      message: `Upgrading to Captain (expected ${upgradeLabel}) increases your projected retirement income by approximately ${fmt(retirementDiff)}/year. This is driven by higher pension Final Average Earnings and increased Plan B contributions over your career.`,
      importance: "high",
      score: 85,
      meta: {
        retirementImpactDollars: Math.round(retirementDiff),
        upgradeYear: upgradeYear ?? undefined,
      },
    };
  } else {
    // FO path is actually better for retirement (unusual but possible)
    return {
      type: "RETIREMENT_IMPACT",
      title: "FO Retirement Parity",
      message: `Your retirement projections show minimal difference between FO and Captain career paths — the gap is approximately ${fmt(Math.abs(retirementDiff))}/year. This gives you flexibility to prioritize schedule quality without sacrificing long-term income.`,
      importance: "low",
      score: 40,
      meta: {
        retirementImpactDollars: Math.round(retirementDiff),
      },
    };
  }
}

function genQualityOfLifeTradeoff(ctx: CareerInsightContext): CareerInsightItem | null {
  const { profile } = ctx;
  if (!profile.dateOfHire) return null;

  const yos = currentYOS(profile.dateOfHire);
  const upgradeYear = ctx.expectedUpgradeYear;
  if (!upgradeYear) return null;

  const upgradeYOS = upgradeYOSFromCalendarYear(upgradeYear, profile.dateOfHire);

  // QoL concern: upgrading in first 7 years means low seniority as new captain
  if (upgradeYOS >= 7) return null;

  const yearsToWait = 7 - upgradeYOS;
  const waitLabel = yearsToWait === 1 ? "1 additional year" : `${yearsToWait} additional years`;

  let scoreBoost = 0;
  if (ctx.careerPriority === "maximize_schedule") scoreBoost = 40;
  else if (ctx.careerPriority === "balanced") scoreBoost = 15;

  return {
    type: "QUALITY_OF_LIFE_TRADEOFF",
    title: "Upgrade Timing Strategy",
    message: `Upgrading at Year ${upgradeYOS} maximizes earnings potential, but early-upgrade captains typically hold less desirable schedules initially due to low Captain seniority. Waiting ${waitLabel} could allow access to higher-quality Captain trips and better bases.`,
    importance: ctx.careerPriority === "maximize_schedule" ? "high" : "medium",
    score: 60 + scoreBoost,
    meta: {
      currentYearOfService: yos,
      upgradeYear: upgradeYear,
    },
  };
}

function genSeniorFOViability(ctx: CareerInsightContext): CareerInsightItem | null {
  const { profile } = ctx;
  if (!profile.dateOfHire) return null;

  const yos = currentYOS(profile.dateOfHire);
  // Relevant when pilot is senior FO (8+ YOS) still on FO track
  if (yos < 8) return null;

  const foAnnual = avgTotalAtStep("fo", Math.min(yos, 15));
  const cptAnnual = avgTotalAtStep("captain", Math.min(yos, 15));
  const diff = cptAnnual - foAnnual;

  // Only relevant if Captain pay advantage is moderate (not overwhelming)
  if (diff > 150_000) return null;

  let scoreBoost = 0;
  if (ctx.careerPriority === "maximize_schedule") scoreBoost = 50;

  return {
    type: "SENIOR_FO_VIABILITY",
    title: "Senior First Officer Strategy",
    message: `At Year ${yos}, remaining a senior First Officer provides strong schedule control and competitive earnings — within ${fmt(diff)} of Captain. This path maximizes schedule quality, base access, and work-life balance while maintaining solid income.`,
    importance: ctx.careerPriority === "maximize_schedule" ? "high" : "low",
    score: 35 + scoreBoost,
    meta: {
      currentYearOfService: yos,
      annualDifferenceDollars: Math.round(diff),
    },
  };
}

function genBalancedCareerStrategy(ctx: CareerInsightContext): CareerInsightItem | null {
  const { profile } = ctx;
  if (!profile.dateOfHire) return null;

  const upgradeYear = ctx.expectedUpgradeYear;
  if (!upgradeYear) return null;

  const upgradeYOS = upgradeYOSFromCalendarYear(upgradeYear, profile.dateOfHire);

  // Balanced insight is most relevant when upgrade happens between YOS 7–12
  if (upgradeYOS < 7 || upgradeYOS > 12) return null;

  let scoreBoost = 0;
  if (ctx.careerPriority === "balanced") scoreBoost = 25;

  return {
    type: "BALANCED_CAREER_STRATEGY",
    title: "Balanced Career Path",
    message: `Upgrading around Year ${upgradeYOS} strikes a strong balance between earnings growth and schedule flexibility. You'll enter the Captain seat with meaningful seniority, improving trip quality while capturing the full pay advantage over your remaining career.`,
    importance: "medium",
    score: 55 + scoreBoost,
    meta: {
      upgradeYear: upgradeYear,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a prioritized list of career insights from user data.
 * Returns insights sorted by score (highest first).
 * The first item is the primary insight to display.
 */
export function generateCareerInsights(ctx: CareerInsightContext): CareerInsightItem[] {
  const generators = [
    genUpgradePayLeverage,
    genRetirementImpact,
    genBreakEvenAnalysis,
    genQualityOfLifeTradeoff,
    genSeniorFOViability,
    genBalancedCareerStrategy,
  ];

  const insights: CareerInsightItem[] = [];

  for (const gen of generators) {
    try {
      const result = gen(ctx);
      if (result) insights.push(result);
    } catch {
      // Silently skip failed insight generators — never crash the UI
    }
  }

  // Sort by score descending
  insights.sort((a, b) => b.score - a.score);

  return insights;
}

/**
 * Get the single highest-priority insight for a given context.
 * Returns null if no insights are applicable.
 */
export function getPrimaryCareerInsight(ctx: CareerInsightContext): CareerInsightItem | null {
  const insights = generateCareerInsights(ctx);
  return insights.length > 0 ? insights[0] : null;
}
