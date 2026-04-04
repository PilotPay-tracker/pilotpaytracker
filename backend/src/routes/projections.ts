/**
 * Projections API Routes
 * Earnings forecasts, goal tracking, and "what-if" modeling
 */

import { Hono } from "hono";
import { db } from "../db";
import { type AppType } from "../types";
import { applyYTDGuaranteeFloorSimple, resolveGuaranteeMinutes } from "../lib/guarantee-engine";
import { getPayPeriodForDate as getUPSPayPeriod } from "../lib/constants";

export const projectionsRouter = new Hono<AppType>();

// ============================================
// HELPER: Require authentication
// ============================================
function requireAuth(userId: string | undefined): string {
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

// Helper: Get pay period boundaries using the real UPS 28-day pay calendar
function getPayPeriodForDate(dateISO: string): { start: string; end: string; period: number } {
  const upsPeriod = getUPSPayPeriod(dateISO);
  if (upsPeriod) {
    return { start: upsPeriod.startDate, end: upsPeriod.endDate, period: upsPeriod.periodNumber };
  }

  // Fallback: bi-monthly split if date is outside known calendar
  const date = new Date(dateISO);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const formatDate = (d: Date): string => d.toISOString().split("T")[0] ?? "";

  if (day <= 15) {
    return { start: formatDate(new Date(year, month, 1)), end: formatDate(new Date(year, month, 15)), period: 1 };
  } else {
    return { start: formatDate(new Date(year, month, 16)), end: formatDate(new Date(year, month + 1, 0)), period: 2 };
  }
}

// Helper: Get remaining days in period
function getRemainingDaysInPeriod(dateISO: string): number {
  const { end } = getPayPeriodForDate(dateISO);
  const today = new Date(dateISO);
  const endDate = new Date(end);
  const diffTime = endDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

// Helper: Get remaining days in month
function getRemainingDaysInMonth(dateISO: string): number {
  const date = new Date(dateISO);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const diffTime = lastDay.getTime() - date.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

// Helper: Get remaining days in year
function getRemainingDaysInYear(dateISO: string): number {
  const date = new Date(dateISO);
  const lastDay = new Date(date.getFullYear(), 11, 31);
  const diffTime = lastDay.getTime() - date.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

// ============================================
// GET /api/projections - Get earnings projections
// ============================================
projectionsRouter.get("/", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);

    const today = new Date().toISOString().split("T")[0] ?? "";
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();

    // Get user profile for hourly rate and period type
    const profile = await db.profile.findUnique({
      where: { userId },
    });
    const hourlyRateCents = profile?.hourlyRateCents ?? 32500;
    const creditCapPeriodType = profile?.creditCapPeriodType ?? null;

    // Current pay period
    const { start: periodStart, end: periodEnd, period: periodNumber } = getPayPeriodForDate(today);

    // Month boundaries
    const monthStart = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`;
    const monthEnd = new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0] ?? "";

    // Year boundaries
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear}-12-31`;

    // Get trips with legs for schedule sync data (primary source)
    // Exclude cancelled, override, user-dropped, and company-removed trips from active schedule totals
    // Company-removed trips are fetched separately to preserve their credit in protectedPayCredit
    const allTrips = await db.trip.findMany({
      where: {
        userId,
        status: { notIn: ["cancelled", "override", "dropped", "company_removed"] },
      },
      include: {
        dutyDays: {
          include: { legs: true },
        },
      },
    });

    // Fetch all applied premium log events for this user (pay + credit deltas)
    const allPremiumEvents = await db.logEvent.findMany({
      where: {
        userId,
        isPayAffecting: true,
        applicationStatus: "applied",
        eventType: "PREMIUM_APPLIED",
      },
      select: { tripId: true, premiumMinutesDelta: true },
    });

    // Build map: tripId -> total premium creditDeltaMinutes
    // We add premium credit on top of base leg/duty-day credit so premiums count exactly once.
    // (payCreditMinutes on the trip also has this baked in, so for no-duty-day trips
    //  we use totalCreditMinutes as base and add from this map.)
    const premiumCreditByTrip = new Map<string, number>();
    for (const event of allPremiumEvents) {
      if (!event.tripId) continue;
      // premiumMinutesDelta is now always stored for both multiplier and minutes types
      const creditDelta = event.premiumMinutesDelta ?? 0;
      premiumCreditByTrip.set(event.tripId, (premiumCreditByTrip.get(event.tripId) ?? 0) + creditDelta);
    }

    // Helper to calculate totals from trips within date range
    // Also returns a set of date+flightNumber keys for deduplication
    // IMPORTANT: Calculate pay from credit minutes * hourly rate (not stored totalPayCents)
    function calculateTripTotals(startDate: string, endDate: string) {
      let creditMinutes = 0;
      let blockMinutes = 0;
      let legCount = 0;
      const legKeys = new Set<string>(); // For deduplication with FlightEntry

      // Deduplicate trips by tripNumber (keep latest CUID) to avoid counting duplicates
      const seenTrips = new Map<string, typeof allTrips[0]>();
      for (const trip of allTrips) {
        const key = trip.tripNumber || trip.id;
        const existing = seenTrips.get(key);
        if (!existing || trip.id > existing.id) seenTrips.set(key, trip);
      }
      const deduplicatedTrips = Array.from(seenTrips.values());

      for (const trip of deduplicatedTrips) {
        for (const dutyDay of trip.dutyDays) {
          if (dutyDay.dutyDate >= startDate && dutyDay.dutyDate <= endDate) {
            // If duty day has legs, sum from legs
            if (dutyDay.legs.length > 0) {
              for (const leg of dutyDay.legs) {
                blockMinutes += leg.actualBlockMinutes || leg.plannedBlockMinutes || 0;
                creditMinutes += leg.creditMinutes || leg.plannedCreditMinutes || 0;
                legCount++;
                // Track for deduplication
                legKeys.add(`${dutyDay.dutyDate}-${leg.flightNumber ?? ""}`);
              }
            } else {
              // Use duty day totals if no legs
              blockMinutes += dutyDay.actualBlockMinutes || 0;
              creditMinutes += dutyDay.finalCreditMinutes || dutyDay.actualCreditMinutes || dutyDay.plannedCreditMinutes || 0;
              legCount++;
              legKeys.add(`${dutyDay.dutyDate}-`);
            }
          }
        }

        // If trip has no duty days but overlaps with date range, use trip totals.
        // Use totalCreditMinutes (original base) so we can add premium deltas consistently below.
        if (trip.dutyDays.length === 0 && trip.startDate >= startDate && trip.endDate <= endDate) {
          blockMinutes += trip.totalBlockMinutes || 0;
          creditMinutes += trip.totalCreditMinutes || 0;
          legCount++;
        }
      }

      // Add premium credit and pay deltas for trips within this date range.
      // We always use totalCreditMinutes as the base (not payCreditMinutes) so premiums are
      // counted exactly once here.
      for (const trip of deduplicatedTrips) {
        const tripInRange = trip.startDate >= startDate && trip.startDate <= endDate;
        if (tripInRange) {
          creditMinutes += premiumCreditByTrip.get(trip.id) ?? 0;
        }
      }

      // Calculate pay from credit minutes * hourly rate (consistent with dashboard)
      let payCents = Math.round((creditMinutes / 60) * hourlyRateCents);

      return { creditMinutes, blockMinutes, payCents, flights: legCount, legKeys };
    }

    // Use today as the cutoff for "actual" data — future scheduled trips must NOT be
    // included in actuals because they are already counted separately in periodFuture /
    // monthFuture / yearFuture via calculateScheduledFutureTotals. Including them in both
    // buckets would double-count every scheduled future trip and massively inflate the estimate.
    const periodTripsData = calculateTripTotals(periodStart, today);
    const monthTripsData = calculateTripTotals(monthStart, today);
    const yearTripsData = calculateTripTotals(yearStart, today);

    // Get legacy flight entry data - only entries NOT already in trips
    // Same cutoff: only fetch entries up through today to avoid double-counting.
    const [periodFlights, monthFlights, yearFlights] = await Promise.all([
      db.flightEntry.findMany({
        where: { userId, dateISO: { gte: periodStart, lte: today } },
        select: { dateISO: true, flightNumber: true, creditMinutes: true, blockMinutes: true, totalPayCents: true },
      }),
      db.flightEntry.findMany({
        where: { userId, dateISO: { gte: monthStart, lte: today } },
        select: { dateISO: true, flightNumber: true, creditMinutes: true, blockMinutes: true, totalPayCents: true },
      }),
      db.flightEntry.findMany({
        where: { userId, dateISO: { gte: yearStart, lte: today } },
        select: { dateISO: true, flightNumber: true, creditMinutes: true, blockMinutes: true, totalPayCents: true },
      }),
    ]);

    // Filter out FlightEntry records that are already represented in trips
    const uniquePeriodFlights = periodFlights.filter(
      (f) => !periodTripsData.legKeys.has(`${f.dateISO}-${f.flightNumber ?? ""}`)
    );
    const uniqueMonthFlights = monthFlights.filter(
      (f) => !monthTripsData.legKeys.has(`${f.dateISO}-${f.flightNumber ?? ""}`)
    );
    const uniqueYearFlights = yearFlights.filter(
      (f) => !yearTripsData.legKeys.has(`${f.dateISO}-${f.flightNumber ?? ""}`)
    );

    // Combine trips (primary) with unique flight entries (fallback)
    const periodActual = {
      creditMinutes: periodTripsData.creditMinutes + uniquePeriodFlights.reduce((sum, f) => sum + f.creditMinutes, 0),
      blockMinutes: periodTripsData.blockMinutes + uniquePeriodFlights.reduce((sum, f) => sum + f.blockMinutes, 0),
      payCents: periodTripsData.payCents + uniquePeriodFlights.reduce((sum, f) => sum + f.totalPayCents, 0),
      flights: periodTripsData.flights + uniquePeriodFlights.length,
    };

    const monthActual = {
      creditMinutes: monthTripsData.creditMinutes + uniqueMonthFlights.reduce((sum, f) => sum + f.creditMinutes, 0),
      blockMinutes: monthTripsData.blockMinutes + uniqueMonthFlights.reduce((sum, f) => sum + f.blockMinutes, 0),
      payCents: monthTripsData.payCents + uniqueMonthFlights.reduce((sum, f) => sum + f.totalPayCents, 0),
      flights: monthTripsData.flights + uniqueMonthFlights.length,
    };

    const yearActual = {
      creditMinutes: yearTripsData.creditMinutes + uniqueYearFlights.reduce((sum, f) => sum + f.creditMinutes, 0),
      blockMinutes: yearTripsData.blockMinutes + uniqueYearFlights.reduce((sum, f) => sum + f.blockMinutes, 0),
      payCents: yearTripsData.payCents + uniqueYearFlights.reduce((sum, f) => sum + f.totalPayCents, 0),
      flights: yearTripsData.flights + uniqueYearFlights.length,
    };

    // Apply contract guarantee floor to actual pay for both month and year.
    // Pilots are paid at least the monthly guarantee even when line credit is below it.
    // Exception: user-dropped trips reduce the guarantee floor — pilots don't get
    // the guarantee restored for trips they voluntarily dropped.
    const monthsElapsed = currentMonth + 1; // currentMonth is 0-indexed
    const guaranteeMin = resolveGuaranteeMinutes(creditCapPeriodType);

    // Compute dropped-by-user credit for the current month
    const droppedMonthTrips = await db.trip.findMany({
      where: {
        userId,
        tripActionType: "dropped_by_user",
        startDate: { gte: monthStart, lte: monthEnd },
      },
      select: { payCreditMinutes: true, totalCreditMinutes: true },
    });
    const droppedMonthCreditMinutes = droppedMonthTrips.reduce(
      (sum, t) => sum + (t.payCreditMinutes || t.totalCreditMinutes || 0), 0
    );

    // Compute company-removed credit for the current month — their credit is preserved
    const companyRemovedMonthTrips = await db.trip.findMany({
      where: {
        userId,
        tripActionType: "company_removed",
        startDate: { gte: monthStart, lte: monthEnd },
      },
      select: { payCreditMinutes: true, totalCreditMinutes: true },
    });
    const companyRemovedMonthCreditMinutes = companyRemovedMonthTrips.reduce(
      (sum, t) => sum + (t.payCreditMinutes || t.totalCreditMinutes || 0), 0
    );

    const adjustedMonthGuarantee = Math.max(0, guaranteeMin - droppedMonthCreditMinutes);
    // protectedMonthCredit = active schedule credit + company-removed credit (preserved)
    const protectedMonthCredit = monthActual.creditMinutes + companyRemovedMonthCreditMinutes;
    const monthCreditFloored = Math.max(protectedMonthCredit, adjustedMonthGuarantee);
    monthActual.payCents = Math.round((monthCreditFloored / 60) * hourlyRateCents);

    // For year projection, use trip-level payCreditMinutes (matches benchmarks endpoint calculation).
    // Leg-level credit summation can diverge from trip-level payCreditMinutes which is authoritative
    // (includes pay protection) — using trip-level keeps "On Pace For" in sync with Career Benchmarks.
    const deduplicatedTripsForYTD = (() => {
      const seen = new Map<string, typeof allTrips[0]>();
      for (const trip of allTrips) {
        const key = trip.tripNumber || trip.id;
        const existing = seen.get(key);
        if (!existing || trip.id > existing.id) seen.set(key, trip);
      }
      // Only current year trips up through today
      return Array.from(seen.values()).filter(t => t.startDate >= yearStart && t.startDate <= today);
    })();
    const ytdTripLevelCreditMinutes = deduplicatedTripsForYTD.reduce(
      (sum, t) => sum + (t.payCreditMinutes || t.totalCreditMinutes || 0), 0
    );

    // Compute YTD dropped credit to reduce YTD guarantee floor
    const droppedYTDTrips = await db.trip.findMany({
      where: {
        userId,
        tripActionType: "dropped_by_user",
        startDate: { gte: yearStart, lte: today },
      },
      select: { payCreditMinutes: true, totalCreditMinutes: true },
    });
    const droppedYTDCreditMinutes = droppedYTDTrips.reduce(
      (sum, t) => sum + (t.payCreditMinutes || t.totalCreditMinutes || 0), 0
    );

    // Compute YTD company-removed credit — preserved in protectedPayCredit
    const companyRemovedYTDTrips = await db.trip.findMany({
      where: {
        userId,
        tripActionType: "company_removed",
        startDate: { gte: yearStart, lte: today },
      },
      select: { payCreditMinutes: true, totalCreditMinutes: true },
    });
    const companyRemovedYTDCreditMinutes = companyRemovedYTDTrips.reduce(
      (sum, t) => sum + (t.payCreditMinutes || t.totalCreditMinutes || 0), 0
    );

    const adjustedYtdFloor = Math.max(0, guaranteeMin * monthsElapsed - droppedYTDCreditMinutes);
    // protectedYtdCredit = active YTD credit + company-removed credit (preserved)
    const protectedYtdCredit = ytdTripLevelCreditMinutes + companyRemovedYTDCreditMinutes;
    const ytdCreditFlooredForYear = Math.max(protectedYtdCredit, adjustedYtdFloor);
    yearActual.payCents = Math.round((ytdCreditFlooredForYear / 60) * hourlyRateCents);
    console.log(`[Projections] YTD trip-level: trips=${deduplicatedTripsForYTD.length}, credit=${ytdTripLevelCreditMinutes}min, companyRemoved=${companyRemovedYTDCreditMinutes}min, floored=${ytdCreditFlooredForYear}min, payCents=${yearActual.payCents}`);

    // Calculate days elapsed and remaining
    const periodDaysElapsed = Math.ceil(
      (new Date(today).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;
    const periodDaysTotal = Math.ceil(
      (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;
    const periodDaysRemaining = getRemainingDaysInPeriod(today);

    const monthDaysElapsed = new Date().getDate();
    const monthDaysTotal = new Date(currentYear, currentMonth + 1, 0).getDate();
    const monthDaysRemaining = getRemainingDaysInMonth(today);

    const dayOfYear = Math.floor(
      (new Date().getTime() - new Date(currentYear, 0, 0).getTime()) / (1000 * 60 * 60 * 24)
    );
    const yearDaysElapsed = dayOfYear;
    const yearDaysTotal = (currentYear % 4 === 0 && (currentYear % 100 !== 0 || currentYear % 400 === 0)) ? 366 : 365;
    const yearDaysRemaining = getRemainingDaysInYear(today);

    // Calculate daily averages (based on past flying pace, not calendar days)
    // Use elapsed days that actually had scheduled trips for a more accurate pace
    const periodDailyAvgCents = periodDaysElapsed > 0 ? Math.round(periodActual.payCents / periodDaysElapsed) : 0;
    const monthDailyAvgCents = monthDaysElapsed > 0 ? Math.round(monthActual.payCents / monthDaysElapsed) : 0;
    const yearDailyAvgCents = yearDaysElapsed > 0 ? Math.round(yearActual.payCents / yearDaysElapsed) : 0;

    // ── Schedule-aware projection ──────────────────────────────────────────────
    // For each remaining scope, calculate pay from SCHEDULED future trips directly
    // rather than naively extrapolating daily averages. If there are days beyond
    // the last scheduled trip we fill in with the historical daily average.

    function calculateScheduledFutureTotals(
      rangeStart: string,
      rangeEnd: string,
      afterDate: string  // only trips that START after this date are "future"
    ) {
      let creditMinutes = 0;
      let blockMinutes = 0;

      for (const trip of allTrips) {
        // Only trips that start after afterDate and fall within the range
        if (trip.startDate <= afterDate) continue;
        if (trip.startDate > rangeEnd || trip.endDate < rangeStart) continue;

        for (const dutyDay of trip.dutyDays) {
          if (dutyDay.dutyDate <= afterDate) continue;
          if (dutyDay.dutyDate < rangeStart || dutyDay.dutyDate > rangeEnd) continue;

          if (dutyDay.legs.length > 0) {
            for (const leg of dutyDay.legs) {
              blockMinutes += leg.actualBlockMinutes || leg.plannedBlockMinutes || 0;
              creditMinutes += leg.creditMinutes || leg.plannedCreditMinutes || 0;
            }
          } else {
            blockMinutes += dutyDay.actualBlockMinutes || 0;
            creditMinutes += dutyDay.finalCreditMinutes || dutyDay.actualCreditMinutes || dutyDay.plannedCreditMinutes || 0;
          }
        }

        // Trip with no duty days
        if (trip.dutyDays.length === 0 && trip.startDate > afterDate) {
          blockMinutes += trip.totalBlockMinutes || 0;
          creditMinutes += trip.payCreditMinutes || trip.totalCreditMinutes || 0;
        }
      }

      const payCents = Math.round((creditMinutes / 60) * hourlyRateCents);
      return { creditMinutes, blockMinutes, payCents };
    }

    // Find the last scheduled trip end date for each scope to detect "gap" days
    function getLastScheduledTripDate(rangeEnd: string, afterDate: string): string {
      let lastDate = afterDate;
      for (const trip of allTrips) {
        if (trip.startDate <= afterDate) continue;
        if (trip.endDate > rangeEnd) continue;
        if (trip.endDate > lastDate) lastDate = trip.endDate;
      }
      return lastDate;
    }

    // ── Pay period projection ──────────────────────────────────────────────────
    // Use ALL trips scheduled in the period (not just actuals+future+gap which
    // is unreliable early in the period when the daily average is based on 1-2 days).
    // This mirrors the dashboard's approach: prorate trips that extend beyond period end.
    let periodAllCreditMinutes = 0;
    let periodJaPickupCreditMinutes = 0; // JA pickup credit tracked separately (pays at 150%)
    const seenPeriodTrips = new Map<string, typeof allTrips[0]>();
    for (const trip of allTrips) {
      const key = trip.tripNumber || trip.id;
      const existing = seenPeriodTrips.get(key);
      if (!existing || trip.id > existing.id) seenPeriodTrips.set(key, trip);
    }
    for (const trip of seenPeriodTrips.values()) {
      // Check if this trip overlaps with the pay period
      if (trip.startDate > periodEnd || trip.endDate < periodStart) continue;
      const authoritativeCredit = trip.payCreditMinutes || trip.totalCreditMinutes || 0;
      const isJaPickup = trip.pickupType === "ja";
      if (trip.dutyDays.length === 0) {
        if (authoritativeCredit > 0) {
          periodAllCreditMinutes += authoritativeCredit;
          if (isJaPickup) periodJaPickupCreditMinutes += authoritativeCredit;
        }
      } else {
        const inPeriodDutyDays = trip.dutyDays.filter(
          (d) => d.dutyDate >= periodStart && d.dutyDate <= periodEnd
        );
        if (inPeriodDutyDays.length > 0) {
          const ratio = inPeriodDutyDays.length / trip.dutyDays.length;
          const proratedCredit = Math.round(authoritativeCredit * ratio);
          periodAllCreditMinutes += proratedCredit;
          if (isJaPickup) periodJaPickupCreditMinutes += proratedCredit;
        }
      }
    }
    // Apply guarantee floor to base credit only (JA credit never fills the gap)
    const guaranteeMinutesForPeriod = resolveGuaranteeMinutes(creditCapPeriodType);
    const periodBaseCredit = periodAllCreditMinutes - periodJaPickupCreditMinutes;
    const periodPaidBaseMinutes = Math.max(periodBaseCredit, guaranteeMinutesForPeriod);
    // JA credit pays at 150%, base credit at 1.0x
    const periodProjectedCents = Math.round((periodPaidBaseMinutes / 60) * hourlyRateCents)
      + Math.round((periodJaPickupCreditMinutes / 60) * hourlyRateCents * 1.5);
    const periodPaidCreditMinutes = periodPaidBaseMinutes + periodJaPickupCreditMinutes;
    const periodProjectedCredit = periodPaidCreditMinutes;

    // Month projection
    const monthFuture = calculateScheduledFutureTotals(monthStart, monthEnd, today);
    const monthLastTripDate = getLastScheduledTripDate(monthEnd, today);
    const monthGapDays = Math.max(0, Math.ceil(
      (new Date(monthEnd).getTime() - new Date(monthLastTripDate).getTime()) / (1000 * 60 * 60 * 24)
    ) - 1);
    const monthDailyCreditAvg = monthDaysElapsed > 0 ? Math.round(monthActual.creditMinutes / monthDaysElapsed) : 0;
    const monthGapCreditMinutes = monthDailyCreditAvg * monthGapDays;
    const monthGapPayCents = Math.round((monthGapCreditMinutes / 60) * hourlyRateCents);
    const monthProjectedCents = monthActual.payCents + monthFuture.payCents + monthGapPayCents;
    const monthProjectedCredit = monthActual.creditMinutes + monthFuture.creditMinutes + monthGapCreditMinutes;

    // Year projection — same simple extrapolation as benchmarks endpoint so they stay in sync:
    // ytdPayCents / dayOfYear * yearDaysTotal
    // yearActual.payCents is already guarantee-floored YTD pay (same as benchmarks ytdPayCents)
    const yearProjectedCents = yearDaysElapsed > 0
      ? Math.round((yearActual.payCents / yearDaysElapsed) * yearDaysTotal)
      : 0;
    const yearProjectedCredit = yearActual.creditMinutes;

    console.log(`[Projections] YTD: credit=${yearActual.creditMinutes}min, pay=$${(yearActual.payCents/100).toFixed(0)}, daysElapsed=${yearDaysElapsed}, projected=$${(yearProjectedCents/100).toFixed(0)}`);

    return c.json({
      asOfDate: today,
      hourlyRateCents,

      // Pay Period
      payPeriod: {
        start: periodStart,
        end: periodEnd,
        periodNumber,
        daysElapsed: periodDaysElapsed,
        daysRemaining: periodDaysRemaining,
        daysTotal: periodDaysTotal,
        actual: periodActual,
        dailyAvgCents: periodDailyAvgCents,
        projectedCents: periodProjectedCents,
        projectedCreditMinutes: periodProjectedCredit,
      },

      // Month
      month: {
        start: monthStart,
        end: monthEnd,
        name: new Date(currentYear, currentMonth, 1).toLocaleString("en-US", { month: "long" }),
        daysElapsed: monthDaysElapsed,
        daysRemaining: monthDaysRemaining,
        daysTotal: monthDaysTotal,
        actual: monthActual,
        dailyAvgCents: monthDailyAvgCents,
        projectedCents: monthProjectedCents,
        projectedCreditMinutes: monthProjectedCredit,
      },

      // Year
      year: {
        year: currentYear,
        start: yearStart,
        end: yearEnd,
        daysElapsed: yearDaysElapsed,
        daysRemaining: yearDaysRemaining,
        daysTotal: yearDaysTotal,
        actual: yearActual,
        dailyAvgCents: yearDailyAvgCents,
        projectedCents: yearProjectedCents,
        projectedCreditMinutes: yearProjectedCredit,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching projections:", error);
    return c.json({ error: "Failed to fetch projections" }, 500);
  }
});

// ============================================
// POST /api/projections/goal - Calculate required pace for income goal
// ============================================
projectionsRouter.post("/goal", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const body = await c.req.json();

    const { targetCents, scope } = body as {
      targetCents: number;
      scope: "PAY_PERIOD" | "MONTH" | "YEAR";
    };

    if (!targetCents || !scope) {
      return c.json({ error: "targetCents and scope are required" }, 400);
    }

    const today = new Date().toISOString().split("T")[0] ?? "";
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();

    // Get profile for hourly rate
    const profile = await db.profile.findUnique({
      where: { userId },
    });
    const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

    let startDate: string;
    let endDate: string;
    let daysRemaining: number;

    switch (scope) {
      case "PAY_PERIOD": {
        const { start, end } = getPayPeriodForDate(today);
        startDate = start;
        endDate = end;
        daysRemaining = getRemainingDaysInPeriod(today);
        break;
      }
      case "MONTH": {
        startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`;
        endDate = new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0] ?? "";
        daysRemaining = getRemainingDaysInMonth(today);
        break;
      }
      case "YEAR": {
        startDate = `${currentYear}-01-01`;
        endDate = `${currentYear}-12-31`;
        daysRemaining = getRemainingDaysInYear(today);
        break;
      }
      default:
        return c.json({ error: "Invalid scope" }, 400);
    }

    // Get current earnings in scope
    const flights = await db.flightEntry.findMany({
      where: { userId, dateISO: { gte: startDate, lte: endDate } },
      select: { creditMinutes: true, totalPayCents: true },
    });

    const currentCents = flights.reduce((sum, f) => sum + f.totalPayCents, 0);
    const currentCreditMinutes = flights.reduce((sum, f) => sum + f.creditMinutes, 0);

    // Calculate what's needed
    const remainingCents = Math.max(0, targetCents - currentCents);
    const percentComplete = targetCents > 0 ? Math.round((currentCents / targetCents) * 100) : 0;
    const isOnTrack = remainingCents === 0;

    // Calculate required daily pace
    const requiredDailyCents = daysRemaining > 0 ? Math.round(remainingCents / daysRemaining) : remainingCents;
    const requiredDailyCreditMinutes = hourlyRateCents > 0
      ? Math.round((requiredDailyCents / hourlyRateCents) * 60)
      : 0;

    // Calculate required weekly flying (assuming 5 flying days per week)
    const requiredWeeklyCreditMinutes = requiredDailyCreditMinutes * 5;
    const requiredWeeklyCents = requiredDailyCents * 5;

    return c.json({
      scope,
      startDate,
      endDate,
      targetCents,
      currentCents,
      remainingCents,
      percentComplete,
      isOnTrack,
      daysRemaining,
      hourlyRateCents,

      // Current pace
      currentCreditMinutes,

      // Required to meet goal
      required: {
        totalCents: remainingCents,
        dailyCents: requiredDailyCents,
        dailyCreditMinutes: requiredDailyCreditMinutes,
        weeklyCents: requiredWeeklyCents,
        weeklyCreditMinutes: requiredWeeklyCreditMinutes,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error calculating goal:", error);
    return c.json({ error: "Failed to calculate goal" }, 500);
  }
});

// ============================================
// POST /api/projections/what-if - "What-if" scenario modeling
// ============================================
projectionsRouter.post("/what-if", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const body = await c.req.json();

    const {
      additionalCreditMinutes,
      additionalTrips,
      newHourlyRateCents,
      scope,
    } = body as {
      additionalCreditMinutes?: number;
      additionalTrips?: number; // Assumes average trip credit
      newHourlyRateCents?: number;
      scope: "PAY_PERIOD" | "MONTH" | "YEAR";
    };

    if (!scope) {
      return c.json({ error: "scope is required" }, 400);
    }

    const today = new Date().toISOString().split("T")[0] ?? "";
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();

    // Get profile for hourly rate
    const profile = await db.profile.findUnique({
      where: { userId },
    });
    const currentHourlyRateCents = profile?.hourlyRateCents ?? 32500;
    const effectiveHourlyRateCents = newHourlyRateCents ?? currentHourlyRateCents;

    let startDate: string;
    let endDate: string;

    switch (scope) {
      case "PAY_PERIOD": {
        const { start, end } = getPayPeriodForDate(today);
        startDate = start;
        endDate = end;
        break;
      }
      case "MONTH": {
        startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`;
        endDate = new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0] ?? "";
        break;
      }
      case "YEAR": {
        startDate = `${currentYear}-01-01`;
        endDate = `${currentYear}-12-31`;
        break;
      }
      default:
        return c.json({ error: "Invalid scope" }, 400);
    }

    // Get current earnings
    const flights = await db.flightEntry.findMany({
      where: { userId, dateISO: { gte: startDate, lte: endDate } },
      select: { creditMinutes: true, totalPayCents: true },
    });

    const currentCents = flights.reduce((sum, f) => sum + f.totalPayCents, 0);
    const currentCreditMinutes = flights.reduce((sum, f) => sum + f.creditMinutes, 0);

    // Get average trip credit (for trip-based projection)
    const trips = await db.trip.findMany({
      where: { userId, status: "completed" },
      select: { totalCreditMinutes: true },
      take: 10,
      orderBy: { endDate: "desc" },
    });

    const avgTripCreditMinutes = trips.length > 0
      ? Math.round(trips.reduce((sum, t) => sum + t.totalCreditMinutes, 0) / trips.length)
      : 360 * 4; // Default: 4 duty days at 6:00 each

    // Calculate additional credit
    let totalAdditionalCreditMinutes = 0;
    if (additionalCreditMinutes) {
      totalAdditionalCreditMinutes += additionalCreditMinutes;
    }
    if (additionalTrips) {
      totalAdditionalCreditMinutes += additionalTrips * avgTripCreditMinutes;
    }

    // Calculate scenario results
    const additionalPayCents = Math.round((totalAdditionalCreditMinutes / 60) * effectiveHourlyRateCents);

    // If hourly rate changed, recalculate existing pay at new rate
    let rateChangeDifference = 0;
    if (newHourlyRateCents && newHourlyRateCents !== currentHourlyRateCents) {
      const currentPayAtNewRate = Math.round((currentCreditMinutes / 60) * newHourlyRateCents);
      rateChangeDifference = currentPayAtNewRate - currentCents;
    }

    const projectedCents = currentCents + additionalPayCents + rateChangeDifference;
    const projectedCreditMinutes = currentCreditMinutes + totalAdditionalCreditMinutes;

    return c.json({
      scope,
      startDate,
      endDate,

      // Current state
      current: {
        creditMinutes: currentCreditMinutes,
        payCents: currentCents,
        hourlyRateCents: currentHourlyRateCents,
      },

      // Scenario inputs
      scenario: {
        additionalCreditMinutes: totalAdditionalCreditMinutes,
        additionalTrips: additionalTrips ?? 0,
        avgTripCreditMinutes,
        newHourlyRateCents: effectiveHourlyRateCents,
      },

      // Projected results
      projected: {
        creditMinutes: projectedCreditMinutes,
        payCents: projectedCents,
        additionalPayCents,
        rateChangeDifference,
      },

      // Difference from current
      difference: {
        creditMinutes: totalAdditionalCreditMinutes,
        payCents: projectedCents - currentCents,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error calculating what-if:", error);
    return c.json({ error: "Failed to calculate scenario" }, 500);
  }
});

// ============================================
// GET /api/projections/history - Historical monthly data for trends
// ============================================
projectionsRouter.get("/history", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    // If "all" is passed, fetch from the earliest data point
    const monthsParam = c.req.query("months");
    const fetchAll = monthsParam === "all";

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    // Get profile for hourly rate
    const profile = await db.profile.findUnique({
      where: { userId },
      select: { hourlyRateCents: true },
    });
    const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

    // Get all trips with legs for schedule sync data
    // Exclude cancelled, override, and user-dropped trips
    const allTrips = await db.trip.findMany({
      where: {
        userId,
        status: { notIn: ["cancelled", "override", "dropped"] },
      },
      include: {
        dutyDays: {
          include: { legs: true },
        },
      },
    });

    // Helper to calculate totals from trips within date range
    // IMPORTANT: Calculate pay from credit minutes * hourly rate (not stored totalPayCents)
    function calculateTripTotals(startDate: string, endDate: string) {
      let creditMinutes = 0;
      let blockMinutes = 0;
      let legCount = 0;
      const legKeys = new Set<string>();

      for (const trip of allTrips) {
        for (const dutyDay of trip.dutyDays) {
          if (dutyDay.dutyDate >= startDate && dutyDay.dutyDate <= endDate) {
            if (dutyDay.legs.length > 0) {
              for (const leg of dutyDay.legs) {
                blockMinutes += leg.actualBlockMinutes || leg.plannedBlockMinutes || 0;
                creditMinutes += leg.creditMinutes || leg.plannedCreditMinutes || 0;
                legCount++;
                legKeys.add(`${dutyDay.dutyDate}-${leg.flightNumber ?? ""}`);
              }
            } else {
              blockMinutes += dutyDay.actualBlockMinutes || 0;
              creditMinutes += dutyDay.finalCreditMinutes || dutyDay.actualCreditMinutes || dutyDay.plannedCreditMinutes || 0;
              legCount++;
              legKeys.add(`${dutyDay.dutyDate}-`);
            }
          }
        }

        // If trip has no duty days but overlaps with date range
        // Use payCreditMinutes if available (includes pay protection)
        if (trip.dutyDays.length === 0 && trip.startDate >= startDate && trip.endDate <= endDate) {
          blockMinutes += trip.totalBlockMinutes || 0;
          creditMinutes += trip.payCreditMinutes || trip.totalCreditMinutes || 0;
          legCount++;
        }
      }

      // Calculate pay from credit minutes * hourly rate (consistent with dashboard)
      const payCents = Math.round((creditMinutes / 60) * hourlyRateCents);

      return { creditMinutes, blockMinutes, payCents, flights: legCount, legKeys };
    }

    const history: Array<{
      year: number;
      month: number;
      monthName: string;
      creditMinutes: number;
      payCents: number;
      flights: number;
    }> = [];

    // Determine how many months to fetch
    let totalMonths: number;
    if (fetchAll) {
      // Find earliest data point across trips and flight entries
      const earliestTrip = allTrips.reduce<string | null>((earliest, trip) => {
        const date = trip.startDate;
        return earliest === null || date < earliest ? date : earliest;
      }, null);
      const earliestFlightEntry = await db.flightEntry.findFirst({
        where: { userId },
        orderBy: { dateISO: "asc" },
        select: { dateISO: true },
      });
      const earliestFlight = earliestFlightEntry?.dateISO ?? null;
      const earliest = [earliestTrip, earliestFlight].filter(Boolean).sort()[0];
      if (earliest) {
        const earliestDate = new Date(earliest);
        const earliestYear = earliestDate.getFullYear();
        const earliestMonthIdx = earliestDate.getMonth();
        totalMonths = (currentYear - earliestYear) * 12 + (currentMonth - earliestMonthIdx) + 1;
        totalMonths = Math.max(totalMonths, 1);
      } else {
        totalMonths = 12;
      }
    } else {
      totalMonths = parseInt(monthsParam ?? "12", 10);
    }

    for (let i = 0; i < totalMonths; i++) {
      const targetMonth = currentMonth - i;
      const targetYear = currentYear + Math.floor(targetMonth / 12);
      const normalizedMonth = ((targetMonth % 12) + 12) % 12;

      const monthStart = `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}-01`;
      const monthEnd = new Date(targetYear, normalizedMonth + 1, 0).toISOString().split("T")[0] ?? "";

      // Get trip data for this month
      const tripData = calculateTripTotals(monthStart, monthEnd);

      // Get legacy flight entry data - only entries NOT already in trips
      const flights = await db.flightEntry.findMany({
        where: { userId, dateISO: { gte: monthStart, lte: monthEnd } },
        select: { dateISO: true, flightNumber: true, creditMinutes: true, totalPayCents: true },
      });

      // Filter out FlightEntry records that are already represented in trips
      const uniqueFlights = flights.filter(
        (f) => !tripData.legKeys.has(`${f.dateISO}-${f.flightNumber ?? ""}`)
      );

      // Combine trip data with unique flight entries
      const totalCreditMinutes = tripData.creditMinutes + uniqueFlights.reduce((sum, f) => sum + f.creditMinutes, 0);
      const totalPayCents = tripData.payCents + uniqueFlights.reduce((sum, f) => sum + f.totalPayCents, 0);
      const totalFlights = tripData.flights + uniqueFlights.length;

      history.push({
        year: targetYear,
        month: normalizedMonth + 1,
        monthName: new Date(targetYear, normalizedMonth, 1).toLocaleString("en-US", { month: "short" }),
        creditMinutes: totalCreditMinutes,
        payCents: totalPayCents,
        flights: totalFlights,
      });
    }

    // Reverse to show oldest first
    history.reverse();

    // Calculate averages
    const avgMonthlyCents = history.length > 0
      ? Math.round(history.reduce((sum, h) => sum + h.payCents, 0) / history.length)
      : 0;
    const avgMonthlyCreditMinutes = history.length > 0
      ? Math.round(history.reduce((sum, h) => sum + h.creditMinutes, 0) / history.length)
      : 0;

    return c.json({
      history,
      averages: {
        monthlyCents: avgMonthlyCents,
        monthlyCreditMinutes: avgMonthlyCreditMinutes,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching history:", error);
    return c.json({ error: "Failed to fetch history" }, 500);
  }
});
