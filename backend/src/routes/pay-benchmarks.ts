import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";
import { applyYTDGuaranteeFloorSimple, resolveGuaranteeMinutes } from "../lib/guarantee-engine";

const payBenchmarksRouter = new Hono<AppType>();

// ============================================
// Validation Schemas
// ============================================

const queryBenchmarksSchema = z.object({
  airline: z.string().optional(),
  seat: z.enum(["FO", "Captain"]).optional(),
  effectiveDate: z.string().optional(), // If not provided, uses latest
});

const createBenchmarkSchema = z.object({
  airline: z.string(),
  effectiveDate: z.string(),
  seat: z.enum(["FO", "Captain"]),
  yearOfService: z.number().int().min(1).max(30),
  hourlyRateCents: z.number().int().min(0),
  payAtGuaranteeCents: z.number().int().min(0),
  avgLinePayCents: z.number().int().min(0),
  avgTotalPayCents: z.number().int().min(0),
  sourceNote: z.string().optional(),
});

const bulkCreateSchema = z.object({
  benchmarks: z.array(createBenchmarkSchema),
});

const upgradeScenarioSchema = z.object({
  upgradeToYear: z.coerce.number().int().min(1).max(30),
  compareAgainstFoYear: z.coerce.number().int().min(1).max(30),
});

// ============================================
// Airline-Specific Insight Thresholds
// ============================================

interface InsightThresholds {
  seniorFoAdvantage: {
    foEarningsPercent: number; // FO >= this % of CPT triggers insight
    utilizationDiffPercent: number; // FO utilization >= CPT + this triggers insight
  };
  captainLeverage: {
    earningsDiffPercent: number; // CPT >= FO by this % triggers insight
    minUtilization: number; // CPT utilization must be >= this
  };
  premiumStrategy: {
    utilizationThreshold: number; // Utilization >= this triggers insight
    premiumPercentThreshold: number; // Premium % of earnings >= this triggers insight
  };
  neutral: {
    earningsWithinPercent: number; // Earnings within ±this % is neutral
    utilizationDiffMax: number; // Max utilization diff for neutral
  };
}

const AIRLINE_THRESHOLDS: Record<string, InsightThresholds> = {
  // UPS-Specific Thresholds (Authoritative)
  UPS: {
    seniorFoAdvantage: {
      foEarningsPercent: 95,
      utilizationDiffPercent: 10,
    },
    captainLeverage: {
      earningsDiffPercent: 15,
      minUtilization: 95,
    },
    premiumStrategy: {
      utilizationThreshold: 120,
      premiumPercentThreshold: 15,
    },
    neutral: {
      earningsWithinPercent: 7,
      utilizationDiffMax: 10,
    },
  },
  // FedEx - Similar to UPS
  FedEx: {
    seniorFoAdvantage: {
      foEarningsPercent: 95,
      utilizationDiffPercent: 10,
    },
    captainLeverage: {
      earningsDiffPercent: 15,
      minUtilization: 95,
    },
    premiumStrategy: {
      utilizationThreshold: 120,
      premiumPercentThreshold: 15,
    },
    neutral: {
      earningsWithinPercent: 7,
      utilizationDiffMax: 10,
    },
  },
  // Legacy Majors (DL/AA/UA-Style)
  Delta: {
    seniorFoAdvantage: {
      foEarningsPercent: 97,
      utilizationDiffPercent: 12,
    },
    captainLeverage: {
      earningsDiffPercent: 18,
      minUtilization: 90,
    },
    premiumStrategy: {
      utilizationThreshold: 125,
      premiumPercentThreshold: 20,
    },
    neutral: {
      earningsWithinPercent: 6,
      utilizationDiffMax: 10,
    },
  },
  American: {
    seniorFoAdvantage: {
      foEarningsPercent: 97,
      utilizationDiffPercent: 12,
    },
    captainLeverage: {
      earningsDiffPercent: 18,
      minUtilization: 90,
    },
    premiumStrategy: {
      utilizationThreshold: 125,
      premiumPercentThreshold: 20,
    },
    neutral: {
      earningsWithinPercent: 6,
      utilizationDiffMax: 10,
    },
  },
  United: {
    seniorFoAdvantage: {
      foEarningsPercent: 97,
      utilizationDiffPercent: 12,
    },
    captainLeverage: {
      earningsDiffPercent: 18,
      minUtilization: 90,
    },
    premiumStrategy: {
      utilizationThreshold: 125,
      premiumPercentThreshold: 20,
    },
    neutral: {
      earningsWithinPercent: 6,
      utilizationDiffMax: 10,
    },
  },
};

// LCC/Regional Fallback
const DEFAULT_THRESHOLDS: InsightThresholds = {
  seniorFoAdvantage: {
    foEarningsPercent: 98,
    utilizationDiffPercent: 10,
  },
  captainLeverage: {
    earningsDiffPercent: 12,
    minUtilization: 90,
  },
  premiumStrategy: {
    utilizationThreshold: 130,
    premiumPercentThreshold: 20,
  },
  neutral: {
    earningsWithinPercent: 5,
    utilizationDiffMax: 10,
  },
};

function getThresholds(airline: string): InsightThresholds {
  return AIRLINE_THRESHOLDS[airline] ?? DEFAULT_THRESHOLDS;
}

// ============================================
// Insight Generation Logic
// ============================================

interface InsightInput {
  airline: string;
  position: string;
  yearOfService: number;
  foEarningsCents: number;
  captainEarningsCents: number;
  foUtilization: number; // percentage (e.g., 110 = 110%)
  captainUtilization: number;
  premiumPercentOfEarnings: number;
  yearsUntilUpgrade?: number;
  hasDisplacementFlag?: boolean;
}

interface CareerInsight {
  type: string;
  priority: number;
  title: string;
  message: string;
}

function generateCareerInsight(input: InsightInput): CareerInsight | null {
  const thresholds = getThresholds(input.airline);
  const earningsRatio = (input.foEarningsCents / input.captainEarningsCents) * 100;
  const earningsDiff = ((input.captainEarningsCents - input.foEarningsCents) / input.foEarningsCents) * 100;
  const utilizationDiff = input.foUtilization - input.captainUtilization;

  // Priority 1: Senior FO Advantage
  if (
    input.foEarningsCents >= input.captainEarningsCents ||
    earningsRatio >= thresholds.seniorFoAdvantage.foEarningsPercent ||
    utilizationDiff >= thresholds.seniorFoAdvantage.utilizationDiffPercent
  ) {
    return {
      type: "senior_fo_advantage",
      priority: 1,
      title: "Senior FO Advantage",
      message:
        "Senior First Officers can often match or exceed some Captain earnings due to greater schedule control, premium trip access, and the ability to actively trade or pick up trips.",
    };
  }

  // Priority 2: Captain Leverage Over Time
  if (
    earningsDiff >= thresholds.captainLeverage.earningsDiffPercent &&
    input.captainUtilization >= thresholds.captainLeverage.minUtilization
  ) {
    return {
      type: "captain_leverage",
      priority: 2,
      title: "Captain Leverage",
      message:
        "As Captain seniority increases, improved trip access and higher hourly rates tend to widen earnings potential relative to First Officer roles.",
    };
  }

  // Priority 3: OE / Displacement Reality
  if (
    (input.yearsUntilUpgrade !== undefined && input.yearsUntilUpgrade <= 2) ||
    input.hasDisplacementFlag
  ) {
    return {
      type: "oe_displacement",
      priority: 3,
      title: "Transition Considerations",
      message:
        "Operational events such as OE or displacement are often paid and, at some airlines, may still allow additional trip pickups during the same period.",
    };
  }

  // Priority 4: Premium & Trading Strategy
  if (
    input.foUtilization >= thresholds.premiumStrategy.utilizationThreshold ||
    input.premiumPercentOfEarnings >= thresholds.premiumStrategy.premiumPercentThreshold
  ) {
    return {
      type: "premium_strategy",
      priority: 4,
      title: "Premium Flying Impact",
      message:
        "Effective use of trip trading and premium flying can allow First Officers to outperform junior or mid-seniority Captains.",
    };
  }

  // Priority 5: Neutral / Quality-of-Life (Fallback)
  const earningsWithinRange = Math.abs(earningsDiff) <= thresholds.neutral.earningsWithinPercent;
  const utilizationWithinRange = Math.abs(utilizationDiff) <= thresholds.neutral.utilizationDiffMax;

  if (earningsWithinRange && utilizationWithinRange && !input.hasDisplacementFlag) {
    return {
      type: "neutral",
      priority: 5,
      title: "Balanced Outlook",
      message:
        "At this seniority level, earnings between First Officer and Captain roles are closely aligned. Upgrade decisions may be driven more by schedule preference than pay alone.",
    };
  }

  return null;
}

// ============================================
// GET /api/pay-benchmarks - List benchmarks
// ============================================
payBenchmarksRouter.get(
  "/",
  zValidator("query", queryBenchmarksSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { airline, seat, effectiveDate } = c.req.valid("query");

    // Get user's airline from profile if not specified
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    });

    const targetAirline = airline ?? profile?.airline ?? "UPS";

    // Find the latest effective date for the airline if not specified
    let targetEffectiveDate = effectiveDate;
    if (!targetEffectiveDate) {
      const latest = await db.payBenchmark.findFirst({
        where: { airline: targetAirline },
        orderBy: { effectiveDate: "desc" },
        select: { effectiveDate: true },
      });
      targetEffectiveDate = latest?.effectiveDate ?? "";
    }

    // Build where clause
    const where: {
      airline: string;
      effectiveDate: string;
      seat?: string;
    } = {
      airline: targetAirline,
      effectiveDate: targetEffectiveDate,
    };

    if (seat) {
      where.seat = seat;
    }

    const benchmarks = await db.payBenchmark.findMany({
      where,
      orderBy: [{ seat: "asc" }, { yearOfService: "asc" }],
    });

    // Get all effective dates for this airline (for version selector)
    const effectiveDates = await db.payBenchmark.findMany({
      where: { airline: targetAirline },
      distinct: ["effectiveDate"],
      select: { effectiveDate: true, sourceNote: true },
      orderBy: { effectiveDate: "desc" },
    });

    return c.json({
      airline: targetAirline,
      effectiveDate: targetEffectiveDate,
      benchmarks,
      availableEffectiveDates: effectiveDates.map((d) => ({
        date: d.effectiveDate,
        sourceNote: d.sourceNote,
      })),
    });
  }
);

// ============================================
// GET /api/pay-benchmarks/user-comparison
// Compare user's YTD/projected pay to benchmarks
// UPDATED: Uses company seniority for captain pay (no Year 1 reset)
// ============================================
payBenchmarksRouter.get("/user-comparison", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  if (!profile) {
    console.log(`[Benchmarks] user-comparison: profile not found for user ${user.id}`);
    return c.json({ error: "Profile not found" }, 404);
  }

  const airline = profile.airline ?? "UPS";
  const position = profile.position ?? "FO";
  const dateOfHire = profile.dateOfHire;

  // Calculate year of service (company seniority)
  let yearOfService = 1;
  if (dateOfHire) {
    const hireDate = new Date(dateOfHire);
    const now = new Date();
    yearOfService = Math.max(1, Math.floor((now.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) + 1);
  }

  console.log(`[Benchmarks] user-comparison: airline=${airline} position=${position} yearOfService=${yearOfService}`);

  // Get latest benchmark for user's position and YOS
  const latest = await db.payBenchmark.findFirst({
    where: { airline },
    orderBy: { effectiveDate: "desc" },
    select: { effectiveDate: true },
  });

  if (!latest) {
    const totalCount = await db.payBenchmark.count();
    console.log(`[Benchmarks] user-comparison: NO benchmarks found for airline="${airline}". Total records in DB: ${totalCount}`);
    return c.json({
      hasBenchmarks: false,
      message: `No benchmarks available for ${airline}`,
    });
  }

  console.log(`[Benchmarks] user-comparison: latest effectiveDate=${latest.effectiveDate}`);

  const benchmark = await db.payBenchmark.findFirst({
    where: {
      airline,
      effectiveDate: latest.effectiveDate,
      seat: position === "CPT" ? "Captain" : "FO",
      yearOfService: Math.min(yearOfService, 15), // Cap at year 15
    },
  });

  console.log(`[Benchmarks] user-comparison: benchmark found=${!!benchmark} for seat=${position === "CPT" ? "Captain" : "FO"} yearOfService=${Math.min(yearOfService, 15)}`);

  // Get user's YTD earnings
  // IMPORTANT: Calculate pay from credit minutes * hourly rate (consistent with dashboard)
  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;
  const today = new Date().toISOString().split("T")[0]!;

  const hourlyRateCents = profile.hourlyRateCents ?? 32500;

  // Get trips using TRIP-LEVEL payCreditMinutes — identical to projections endpoint.
  // Leg-level summation diverges from payCreditMinutes (which includes pay protection),
  // so we must use the trip-level field to keep Career Benchmarks in sync with the
  // dashboard "On Pace For" and the Annual Pay Planner "Projected Annual".
  const trips = await db.trip.findMany({
    where: {
      userId: user.id,
      status: { notIn: ["cancelled", "override"] },
    },
    select: {
      id: true,
      tripNumber: true,
      startDate: true,
      payCreditMinutes: true,
      totalCreditMinutes: true,
      premiumCents: true,
    },
  });

  // Deduplicate trips by tripNumber (keep latest CUID) to avoid counting duplicates
  const seenTrips = new Map<string, typeof trips[0]>();
  for (const trip of trips) {
    const key = trip.tripNumber || trip.id;
    const existing = seenTrips.get(key);
    if (!existing || trip.id > existing.id) seenTrips.set(key, trip);
  }
  const deduplicatedTrips = Array.from(seenTrips.values());

  // Sum trip-level credit for YTD (startDate <= today, within current year).
  // payCreditMinutes already includes premium credit, so no separate premium delta needed.
  // This matches the projections endpoint exactly.
  let ytdTripCreditMinutes = 0;
  let ytdPremiumCents = 0;
  const tripStartKeys = new Set<string>(); // track which trips contributed (for FlightEntry dedup)

  for (const trip of deduplicatedTrips) {
    if (trip.startDate >= yearStart && trip.startDate <= today) {
      ytdTripCreditMinutes += trip.payCreditMinutes || trip.totalCreditMinutes || 0;
      ytdPremiumCents += trip.premiumCents || 0;
      tripStartKeys.add(trip.id);
    }
  }

  // Also include legacy FlightEntry records not already covered by trips
  // (Flight entries don't have trip IDs, so we still include them as a fallback)
  const yearFlightEntries = await db.flightEntry.findMany({
    where: { userId: user.id, dateISO: { gte: yearStart, lte: today } },
    select: { creditMinutes: true },
  });
  // Only add flight entries if there are no trips yet (pure fallback)
  const flightEntryCreditMinutes = tripStartKeys.size === 0
    ? yearFlightEntries.reduce((sum, fe) => sum + fe.creditMinutes, 0)
    : 0;

  const ytdCreditMinutes = ytdTripCreditMinutes + flightEntryCreditMinutes;
  const monthsElapsed = new Date().getMonth() + 1; // 1-12
  const creditCapPeriodType = profile.creditCapPeriodType ?? null;

  // Apply guarantee floor: YTD credit floored at monthsElapsed × monthly guarantee
  const ytdCreditFloored = applyYTDGuaranteeFloorSimple(ytdCreditMinutes, monthsElapsed, creditCapPeriodType);
  const ytdPayCents = Math.round((ytdCreditFloored / 60) * hourlyRateCents);

  // Projected annual: guarantee-floored YTD extrapolated to full year.
  // EXACT same formula as projections.ts yearProjectedCents to ensure Career Benchmarks
  // "Projected Annual" always matches the dashboard "On Pace For".
  const now = new Date();
  const yearDaysTotal = (currentYear % 4 === 0 && (currentYear % 100 !== 0 || currentYear % 400 === 0)) ? 366 : 365;
  const dayOfYear = Math.floor((now.getTime() - new Date(currentYear, 0, 0).getTime()) / (24 * 60 * 60 * 1000));
  const projectedAnnualCents = dayOfYear > 0 ? Math.round((ytdPayCents / dayOfYear) * yearDaysTotal) : 0;

  console.log(`[Benchmarks] YTD (trip-level): trips=${tripStartKeys.size}, credit=${ytdCreditMinutes}min, floored=${ytdCreditFloored}min, pay=$${(ytdPayCents/100).toFixed(0)}, dayOfYear=${dayOfYear}, projected=$${(projectedAnnualCents/100).toFixed(0)}`);

  // Calculate utilization (percentage of guarantee)
  // Default guarantee: 75 hrs/month = 900 hrs/year
  const guaranteeHoursYear = 75 * 12;
  const guaranteeAnnualCents = guaranteeHoursYear * hourlyRateCents;
  const utilizationPercent = guaranteeAnnualCents > 0
    ? Math.round((projectedAnnualCents / guaranteeAnnualCents) * 100)
    : 100;

  // Premium percentage of earnings
  const premiumPercentOfEarnings = ytdPayCents > 0
    ? Math.round((ytdPremiumCents / ytdPayCents) * 100)
    : 0;

  // Get captain benchmark at SAME company seniority year (not Year 1)
  // This is the key fix - captain pay is based on total company seniority
  const captainBenchmark = await db.payBenchmark.findFirst({
    where: {
      airline,
      effectiveDate: latest.effectiveDate,
      seat: "Captain",
      yearOfService: Math.min(yearOfService, 15), // Same company year, capped at 15
    },
  });

  // For captains, get FO equivalent at same seniority for reverse comparison
  let foEquivalentCents: number | null = null;
  if (position === "CPT") {
    const foBenchmark = await db.payBenchmark.findFirst({
      where: {
        airline,
        effectiveDate: latest.effectiveDate,
        seat: "FO",
        yearOfService: Math.min(yearOfService, 15),
      },
    });
    foEquivalentCents = foBenchmark?.avgTotalPayCents ?? null;
  }

  return c.json({
    hasBenchmarks: true,
    userProfile: {
      airline,
      position,
      yearOfService,
      hourlyRateCents: profile.hourlyRateCents,
    },
    currentBenchmark: benchmark
      ? {
          seat: benchmark.seat,
          yearOfService: benchmark.yearOfService,
          hourlyRateCents: benchmark.hourlyRateCents,
          payAtGuaranteeCents: benchmark.payAtGuaranteeCents,
          avgLinePayCents: benchmark.avgLinePayCents,
          avgTotalPayCents: benchmark.avgTotalPayCents,
          sourceNote: benchmark.sourceNote,
          effectiveDate: benchmark.effectiveDate,
        }
      : null,
    userPerformance: {
      ytdPayCents,
      projectedAnnualCents,
      dayOfYear,
      percentOfBenchmarkGuarantee: benchmark
        ? Math.round((projectedAnnualCents / benchmark.payAtGuaranteeCents) * 100)
        : null,
      percentOfBenchmarkAvgLine: benchmark
        ? Math.round((projectedAnnualCents / benchmark.avgLinePayCents) * 100)
        : null,
      percentOfBenchmarkAvgTotal: benchmark
        ? Math.round((projectedAnnualCents / benchmark.avgTotalPayCents) * 100)
        : null,
      deltaFromGuaranteeCents: benchmark
        ? projectedAnnualCents - benchmark.payAtGuaranteeCents
        : null,
      deltaFromAvgLineCents: benchmark
        ? projectedAnnualCents - benchmark.avgLinePayCents
        : null,
      utilizationPercent,
      premiumPercentOfEarnings,
    },
    // Upgrade simulation: Captain at same company seniority
    upgradeSimulation: captainBenchmark
      ? {
          captainYearHourlyCents: captainBenchmark.hourlyRateCents,
          captainYearAvgTotalCents: captainBenchmark.avgTotalPayCents,
          captainYear: captainBenchmark.yearOfService,
          potentialIncreaseCents: benchmark
            ? captainBenchmark.avgTotalPayCents - benchmark.avgTotalPayCents
            : captainBenchmark.avgTotalPayCents,
          percentIncrease: benchmark
            ? Math.round(
                ((captainBenchmark.avgTotalPayCents - benchmark.avgTotalPayCents) /
                  benchmark.avgTotalPayCents) *
                  100
              )
            : null,
        }
      : null,
    // For captains: show FO equivalent
    foEquivalentCents,
  });
});

// ============================================
// GET /api/pay-benchmarks/upgrade-scenario
// Compare FO at year X vs Captain at year Y
// ============================================
payBenchmarksRouter.get(
  "/upgrade-scenario",
  zValidator("query", upgradeScenarioSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { upgradeToYear, compareAgainstFoYear } = c.req.valid("query");

    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    });

    const airline = profile?.airline ?? "UPS";

    // Get latest effective date
    const latest = await db.payBenchmark.findFirst({
      where: { airline },
      orderBy: { effectiveDate: "desc" },
      select: { effectiveDate: true },
    });

    if (!latest) {
      return c.json({ error: "No benchmarks available" }, 404);
    }

    // Get FO benchmark at compareAgainstFoYear
    const foBenchmark = await db.payBenchmark.findFirst({
      where: {
        airline,
        effectiveDate: latest.effectiveDate,
        seat: "FO",
        yearOfService: Math.min(compareAgainstFoYear, 15),
      },
    });

    // Get Captain benchmark at upgradeToYear (company seniority)
    const captainBenchmark = await db.payBenchmark.findFirst({
      where: {
        airline,
        effectiveDate: latest.effectiveDate,
        seat: "Captain",
        yearOfService: Math.min(upgradeToYear, 15),
      },
    });

    if (!foBenchmark || !captainBenchmark) {
      return c.json({ error: "Benchmark data not found for specified years" }, 404);
    }

    const netDifferenceCents = captainBenchmark.avgTotalPayCents - foBenchmark.avgTotalPayCents;
    const percentIncrease = Math.round(
      ((captainBenchmark.avgTotalPayCents - foBenchmark.avgTotalPayCents) / foBenchmark.avgTotalPayCents) * 100
    );

    return c.json({
      foYear: compareAgainstFoYear,
      foAvgTotalCents: foBenchmark.avgTotalPayCents,
      foHourlyCents: foBenchmark.hourlyRateCents,
      captainYear: upgradeToYear,
      captainAvgTotalCents: captainBenchmark.avgTotalPayCents,
      captainHourlyCents: captainBenchmark.hourlyRateCents,
      netDifferenceCents,
      percentIncrease,
    });
  }
);

// ============================================
// GET /api/pay-benchmarks/career-insight
// Generate auto-prioritized career insight
// ============================================
payBenchmarksRouter.get("/career-insight", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  if (!profile) {
    return c.json({ error: "Profile not found" }, 404);
  }

  const airline = profile.airline ?? "UPS";
  const position = profile.position ?? "FO";
  const dateOfHire = profile.dateOfHire;

  // Calculate year of service
  let yearOfService = 1;
  if (dateOfHire) {
    const hireDate = new Date(dateOfHire);
    const now = new Date();
    yearOfService = Math.max(1, Math.floor((now.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) + 1);
  }

  // Get latest benchmarks
  const latest = await db.payBenchmark.findFirst({
    where: { airline },
    orderBy: { effectiveDate: "desc" },
    select: { effectiveDate: true },
  });

  if (!latest) {
    return c.json(null);
  }

  // Get FO and Captain benchmarks at same seniority
  const foBenchmark = await db.payBenchmark.findFirst({
    where: {
      airline,
      effectiveDate: latest.effectiveDate,
      seat: "FO",
      yearOfService: Math.min(yearOfService, 15),
    },
  });

  const captainBenchmark = await db.payBenchmark.findFirst({
    where: {
      airline,
      effectiveDate: latest.effectiveDate,
      seat: "Captain",
      yearOfService: Math.min(yearOfService, 15),
    },
  });

  if (!foBenchmark || !captainBenchmark) {
    return c.json(null);
  }

  // Get user's actual performance data
  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  // Exclude override trips from pay calculations
  // Override trips (status="override") are visible but should NOT count toward pay
  const trips = await db.trip.findMany({
    where: {
      userId: user.id,
      startDate: { gte: yearStart, lte: yearEnd },
      status: { notIn: ["cancelled", "override"] },
    },
    select: { totalPayCents: true, premiumCents: true, totalCreditMinutes: true },
  });

  const ytdPayCents = trips.reduce((sum, t) => sum + t.totalPayCents, 0);
  const ytdPremiumCents = trips.reduce((sum, t) => sum + t.premiumCents, 0);
  const ytdCreditMinutes = trips.reduce((sum, t) => sum + t.totalCreditMinutes, 0);

  // Calculate utilization
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - new Date(currentYear, 0, 0).getTime()) / (24 * 60 * 60 * 1000));
  const projectedAnnualCents = dayOfYear > 0 ? Math.round((ytdPayCents / dayOfYear) * 365) : 0;

  const guaranteeAnnualCents = foBenchmark.payAtGuaranteeCents;
  const utilizationPercent = guaranteeAnnualCents > 0
    ? Math.round((projectedAnnualCents / guaranteeAnnualCents) * 100)
    : 100;

  // Premium percentage
  const premiumPercentOfEarnings = ytdPayCents > 0
    ? Math.round((ytdPremiumCents / ytdPayCents) * 100)
    : 0;

  // Generate insight
  const insight = generateCareerInsight({
    airline,
    position,
    yearOfService,
    foEarningsCents: foBenchmark.avgTotalPayCents,
    captainEarningsCents: captainBenchmark.avgTotalPayCents,
    foUtilization: utilizationPercent,
    captainUtilization: 100, // Assume average captain utilization
    premiumPercentOfEarnings,
    yearsUntilUpgrade: undefined, // Would need upgrade projection data
    hasDisplacementFlag: false, // Would need displacement tracking
  });

  return c.json(insight);
});

// ============================================
// GET /api/pay-benchmarks/lookup
// Look up a single benchmark by seat + yearOfService (for onboarding)
// ============================================
payBenchmarksRouter.get(
  "/lookup",
  zValidator("query", z.object({
    seat: z.enum(["FO", "Captain"]),
    yearOfService: z.coerce.number().int().min(1).max(15),
    airline: z.string().optional(),
  })),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { seat, yearOfService, airline: airlineParam } = c.req.valid("query");

    const profile = await db.profile.findUnique({ where: { userId: user.id } });
    const airline = airlineParam ?? profile?.airline ?? "UPS";

    // Find latest effective date
    const latest = await db.payBenchmark.findFirst({
      where: { airline },
      orderBy: { effectiveDate: "desc" },
      select: { effectiveDate: true },
    });

    if (!latest) {
      return c.json({ error: "No benchmark data available" }, 404);
    }

    const benchmark = await db.payBenchmark.findUnique({
      where: {
        airline_effectiveDate_seat_yearOfService: {
          airline,
          effectiveDate: latest.effectiveDate,
          seat,
          yearOfService: Math.min(yearOfService, 15),
        },
      },
    });

    if (!benchmark) {
      return c.json({ error: "Benchmark not found" }, 404);
    }

    return c.json({
      airline,
      effectiveDate: benchmark.effectiveDate,
      seat: benchmark.seat,
      yearOfService: benchmark.yearOfService,
      hourlyRateCents: benchmark.hourlyRateCents,
      payAtGuaranteeCents: benchmark.payAtGuaranteeCents,
      avgLinePayCents: benchmark.avgLinePayCents,
      avgTotalPayCents: benchmark.avgTotalPayCents,
      sourceNote: benchmark.sourceNote,
    });
  }
);

// ============================================
// GET /api/pay-benchmarks/effective-dates
// Get all effective dates for an airline
// ============================================
payBenchmarksRouter.get("/effective-dates", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const airline = c.req.query("airline") ?? "UPS";

  const dates = await db.payBenchmark.findMany({
    where: { airline },
    distinct: ["effectiveDate"],
    select: { effectiveDate: true, sourceNote: true },
    orderBy: { effectiveDate: "desc" },
  });

  return c.json({
    airline,
    effectiveDates: dates.map((d) => ({
      date: d.effectiveDate,
      sourceNote: d.sourceNote,
    })),
  });
});

// ============================================
// POST /api/pay-benchmarks/seed - Seed benchmark data (admin)
// This would typically be admin-only, but for MVP we allow it
// ============================================
payBenchmarksRouter.post(
  "/seed",
  zValidator("json", bulkCreateSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { benchmarks } = c.req.valid("json");

    // Upsert all benchmarks
    let created = 0;
    let updated = 0;

    for (const benchmark of benchmarks) {
      const existing = await db.payBenchmark.findFirst({
        where: {
          airline: benchmark.airline,
          effectiveDate: benchmark.effectiveDate,
          seat: benchmark.seat,
          yearOfService: benchmark.yearOfService,
        },
      });

      if (existing) {
        await db.payBenchmark.update({
          where: { id: existing.id },
          data: benchmark,
        });
        updated++;
      } else {
        await db.payBenchmark.create({
          data: benchmark,
        });
        created++;
      }
    }

    return c.json({ success: true, created, updated });
  }
);

// ============================================
// POST /api/pay-benchmarks - Create single benchmark (admin)
// ============================================
payBenchmarksRouter.post(
  "/",
  zValidator("json", createBenchmarkSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const data = c.req.valid("json");

    const benchmark = await db.payBenchmark.create({
      data,
    });

    return c.json(benchmark, 201);
  }
);

// ============================================
// DELETE /api/pay-benchmarks/clear - Clear all benchmarks for airline/date
// ============================================
payBenchmarksRouter.delete("/clear", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const airline = c.req.query("airline");
  const effectiveDate = c.req.query("effectiveDate");

  if (!airline || !effectiveDate) {
    return c.json({ error: "airline and effectiveDate required" }, 400);
  }

  const deleted = await db.payBenchmark.deleteMany({
    where: { airline, effectiveDate },
  });

  return c.json({ success: true, deleted: deleted.count });
});

export { payBenchmarksRouter };
