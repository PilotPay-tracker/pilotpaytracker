import { Hono } from "hono";
import {
  type GetDashboardResponse,
  type FlightEntry,
  type BaselinePayAnalysis,
} from "@/shared/contracts";
import { type AppType } from "../types";
import { db } from "../db";
import { ensureUserExists } from "../utils/ensureUser";
import { getPayPeriodForDate as getUPSPayPeriod } from "../lib/constants";

const dashboardRouter = new Hono<AppType>();

// Helper to get current UPS pay period using the real 28-day pay calendar
function getPayPeriodRange(): { startISO: string; endISO: string; period: number } {
  const today = new Date().toISOString().split("T")[0] ?? "";
  const upsPeriod = getUPSPayPeriod(today);

  if (upsPeriod) {
    return {
      startISO: upsPeriod.startDate,
      endISO: upsPeriod.endDate,
      period: upsPeriod.periodNumber,
    };
  }

  // Fallback: bi-monthly split if date is outside known calendar
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const formatDate = (d: Date): string => d.toISOString().split("T")[0] ?? "";

  if (day <= 15) {
    return { startISO: formatDate(new Date(year, month, 1)), endISO: formatDate(new Date(year, month, 15)), period: 1 };
  } else {
    return { startISO: formatDate(new Date(year, month, 16)), endISO: formatDate(new Date(year, month + 1, 0)), period: 2 };
  }
}

// Helper to format flight entry
function formatFlightEntry(entry: {
  id: string;
  dateISO: string;
  airline: string;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  blockMinutes: number;
  creditMinutes: number;
  hourlyRateCentsAtEntry: number;
  totalPayCents: number;
  notes: string | null;
  createdAt: Date;
}): FlightEntry {
  return {
    id: entry.id,
    dateISO: entry.dateISO,
    airline: entry.airline,
    flightNumber: entry.flightNumber,
    origin: entry.origin,
    destination: entry.destination,
    blockMinutes: entry.blockMinutes,
    creditMinutes: entry.creditMinutes,
    hourlyRateCents: entry.hourlyRateCentsAtEntry,
    totalPayCents: entry.totalPayCents,
    notes: entry.notes,
    createdAt: entry.createdAt.toISOString(),
  };
}

// ============================================
// GET /api/dashboard - Get dashboard data
// ============================================
dashboardRouter.get("/", async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { startISO, endISO, period } = getPayPeriodRange();

  // Ensure user exists in local database
  await ensureUserExists(user, "Dashboard");


  // Get user profile for hourly rate and period type
  let profile = await db.profile.findUnique({
    where: { userId: user.id },
    select: { hourlyRateCents: true, creditCapPeriodType: true }, // Also need period type for guarantee
  });

  if (!profile) {
    profile = await db.profile.create({
      data: { userId: user.id },
      select: { hourlyRateCents: true, creditCapPeriodType: true },
    });
  }

  // Get trips for current pay period with only needed fields
  // Use composite index for efficient query
  // IMPORTANT: Exclude override trips from pay totals by default
  // Override trips (status="override") are visible but should NOT count toward pay
  // Company-removed trips are excluded from currentScheduleCredit but their credit
  // is preserved in protectedPayCredit (fetched separately below).
  const periodTrips = await db.trip.findMany({
    where: {
      userId: user.id,
      status: { notIn: ["cancelled", "override", "dropped", "company_removed"] }, // Exclude cancelled, override, user-dropped, and company-removed from active schedule
      OR: [
        { startDate: { gte: startISO, lte: endISO } },
        { endDate: { gte: startISO, lte: endISO } },
      ],
    },
    select: {
      id: true,
      tripNumber: true,
      totalBlockMinutes: true,
      totalCreditMinutes: true,
      totalPayCents: true,
      // Phase 5: Pay Credit fields
      payCreditMinutes: true,
      protectedCreditMinutes: true,
      currentCreditMinutes: true,
      status: true,
      pickupType: true,
      dutyDays: {
        select: {
          dutyDate: true,
          actualBlockMinutes: true,
          actualCreditMinutes: true,
          finalCreditMinutes: true,
          plannedCreditMinutes: true,
          totalPayCents: true,
          legs: {
            select: {
              actualBlockMinutes: true,
              plannedBlockMinutes: true,
              creditMinutes: true,
              plannedCreditMinutes: true,
              calculatedPayCents: true,
            },
          },
        },
        orderBy: { dutyDate: "asc" },
      },
    },
    orderBy: { startDate: "desc" },
  });

  // Calculate totals from trips/legs
  // Credit source priority:
  //   1. payCreditMinutes (trip-level, authoritative — includes pay protection)
  //   2. totalCreditMinutes (trip-level fallback)
  // We intentionally do NOT sum leg.creditMinutes for credit totals because
  // imported trip data frequently has corrupted leg-level credit values.
  // Block minutes are summed from legs (block data is reliable).
  let totalBlockMinutes = 0;
  let totalCreditMinutes = 0;
  let jaPickupCreditMinutes = 0; // JA pickup credit tracked separately for guarantee calc
  let totalPayCents = 0;
  let legCount = 0;

  // Deduplicate trips by tripNumber — keep the most recently created one per tripNumber.
  // Duplicate trips can appear after re-imports and would double-count credit.
  const tripsByNumber = new Map<string, typeof periodTrips[0]>();
  for (const trip of periodTrips) {
    const key = trip.tripNumber || trip.id; // unnamed trips use id as key
    const existing = tripsByNumber.get(key);
    if (!existing || trip.id > existing.id) {
      // Prefer the trip with the larger (more recent) CUID
      tripsByNumber.set(key, trip);
    }
  }
  const deduplicatedTrips = Array.from(tripsByNumber.values());

  for (const trip of deduplicatedTrips) {
    // Use payCreditMinutes as the authoritative credit value (includes pay protection).
    // Fall back to totalCreditMinutes if payCreditMinutes is not set.
    const authoritativeCredit = trip.payCreditMinutes || trip.totalCreditMinutes || 0;
    const isJaPickup = trip.pickupType === "ja";

    // Determine how many duty days fall within this pay period
    const inPeriodDutyDays = trip.dutyDays.filter(
      (d) => d.dutyDate >= startISO && d.dutyDate <= endISO
    );

    if (trip.dutyDays.length === 0) {
      // No duty days at all — use trip-level totals directly
      if (trip.totalCreditMinutes > 0 || trip.totalPayCents > 0) {
        totalBlockMinutes += trip.totalBlockMinutes || 0;
        totalCreditMinutes += authoritativeCredit;
        if (isJaPickup) jaPickupCreditMinutes += authoritativeCredit;
        totalPayCents += trip.totalPayCents || 0;
        legCount++;
      }
    } else if (inPeriodDutyDays.length > 0) {
      // Prorate credit by the fraction of duty days that fall within this period.
      // This correctly handles trips that span a pay-period boundary.
      const inPeriodRatio = inPeriodDutyDays.length / trip.dutyDays.length;
      const proratedCredit = Math.round(authoritativeCredit * inPeriodRatio);
      totalCreditMinutes += proratedCredit;
      if (isJaPickup) jaPickupCreditMinutes += proratedCredit;

      // For block minutes, sum actual/planned block from in-period legs (block data is reliable)
      for (const dutyDay of inPeriodDutyDays) {
        if (dutyDay.legs.length === 0) {
          // Reserve/ground duty day with no legs — use duty day block
          totalBlockMinutes += dutyDay.actualBlockMinutes || 0;
          legCount++;
        } else {
          for (const leg of dutyDay.legs) {
            totalBlockMinutes += leg.actualBlockMinutes || leg.plannedBlockMinutes || 0;
            legCount++;
          }
        }
      }
    }
  }

  // Compute pay from credit minutes using the hourly rate.
  // (Leg-level calculatedPayCents is unreliable for the same reason as leg credit.)
  if (profile.hourlyRateCents > 0 && totalCreditMinutes > 0) {
    totalPayCents = Math.round((totalCreditMinutes / 60) * profile.hourlyRateCents);
  }

  // Note: payCreditMinutes on each trip already includes any applied premium credit,
  // so we do NOT add premium event deltas separately (that would double-count).

  // Check legacy flightEntry table with only needed fields
  const periodFlights = await db.flightEntry.findMany({
    where: {
      userId: user.id,
      dateISO: { gte: startISO, lte: endISO },
    },
    select: {
      blockMinutes: true,
      creditMinutes: true,
      totalPayCents: true,
    },
  });

  for (const flight of periodFlights) {
    totalBlockMinutes += flight.blockMinutes;
    totalCreditMinutes += flight.creditMinutes;
    totalPayCents += flight.totalPayCents;
  }

  // Get recent flights (last 5) - legacy support
  const recentFlights = await db.flightEntry.findMany({
    where: { userId: user.id },
    orderBy: { dateISO: "desc" },
    take: 5,
  });

  // Contract Guarantee Floor
  // Core rules:
  //   1. Protected base credit (company-built/awarded line) is floored to guarantee
  //   2. JA pickups are NOT used to fill the guarantee gap — they pay at 150% on top
  //   3. Straight pickups DO fill the guarantee gap first (math works out naturally)
  //   4. User-dropped trips reduce the guarantee floor (no protection for user-caused drops)
  const GUARANTEE_BY_PERIOD: Record<string, number> = {
    "28_DAY": 75 * 60,
    "28-DAY": 75 * 60,
    "35_DAY": 96 * 60,
    "35-DAY": 96 * 60,
    // UPS bid-period types — guarantee is per half-month (bid period = ~14 days)
    "BID_56": 75 * 60, // ~75 hrs/month guarantee, split across two periods
  };
  const rawPeriodType = (profile.creditCapPeriodType ?? "28_DAY").toUpperCase().replace(/-/g, "_");
  const guaranteeMinutes = GUARANTEE_BY_PERIOD[rawPeriodType] ?? (75 * 60);

  // Fetch user-dropped trips for this period to reduce the guarantee floor
  const droppedTrips = await db.trip.findMany({
    where: {
      userId: user.id,
      tripActionType: "dropped_by_user",
      OR: [
        { startDate: { gte: startISO, lte: endISO } },
        { endDate: { gte: startISO, lte: endISO } },
      ],
    },
    select: { payCreditMinutes: true, totalCreditMinutes: true },
  });
  const droppedByUserCreditMinutes = droppedTrips.reduce(
    (sum, t) => sum + (t.payCreditMinutes || t.totalCreditMinutes || 0),
    0
  );

  // Fetch company-removed trips for this period.
  // When the company removes a trip, the pilot's pay credit is protected —
  // we add that credit back so it isn't lost from the payable total.
  const companyRemovedTrips = await db.trip.findMany({
    where: {
      userId: user.id,
      tripActionType: "company_removed",
      OR: [
        { startDate: { gte: startISO, lte: endISO } },
        { endDate: { gte: startISO, lte: endISO } },
      ],
    },
    select: { payCreditMinutes: true, totalCreditMinutes: true },
  });
  const companyRemovedCreditMinutes = companyRemovedTrips.reduce(
    (sum, t) => sum + (t.payCreditMinutes || t.totalCreditMinutes || 0),
    0
  );

  // === GUARANTEE LOGIC ===
  //
  // Base credit = active schedule credit MINUS JA pickup credit.
  // JA pickups are never applied toward the guarantee gap — they always
  // pay at 150% on top of whatever the guaranteed base is.
  //
  // Straight pickups fill the guarantee gap first (Rule 2):
  //   base=70, straight=20 → total non-JA=90 → max(90,75)=90 → correct!
  //
  // protectedBaseCredit = base schedule credit + company-removed credit
  const baseScheduleCredit = totalCreditMinutes - jaPickupCreditMinutes;
  const protectedBaseCredit = baseScheduleCredit + companyRemovedCreditMinutes;

  // Reduce guarantee floor by user-dropped credit (Rule 4)
  const adjustedGuaranteeFloor = Math.max(0, guaranteeMinutes - droppedByUserCreditMinutes);

  // Guarantee applies only to base credit (not JA)
  const paidBaseCreditMinutes = Math.max(protectedBaseCredit, adjustedGuaranteeFloor);
  const bufferMinutes = Math.max(0, paidBaseCreditMinutes - protectedBaseCredit);

  // JA pay: always at 150% (base rate × 1.5), never subject to guarantee
  const jaPayCents = Math.round((jaPickupCreditMinutes / 60) * profile.hourlyRateCents * 1.5);
  // Base pay: guarantee-floored base credit at 1.0×
  const basePayCents = Math.round((paidBaseCreditMinutes / 60) * profile.hourlyRateCents);
  // Total pay = base (guarantee-floored) + JA at 150%
  totalPayCents = basePayCents + jaPayCents;

  // Total "paid credit equivalent" for UI display:
  // base paid credit + JA credit (shown at face value for hour display)
  const paidCreditMinutes = paidBaseCreditMinutes + jaPickupCreditMinutes;

  // Determine whether guarantee was waived by user drop
  // (user-dropped credit caused or contributed to falling below guarantee)
  const isGuaranteeWaivedByUserDrop =
    droppedByUserCreditMinutes > 0 &&
    (protectedBaseCredit + droppedByUserCreditMinutes) >= guaranteeMinutes &&
    protectedBaseCredit < guaranteeMinutes;

  // Whether guarantee floor is actively being applied (protecting a low base line)
  const isGuaranteeActive = paidBaseCreditMinutes > protectedBaseCredit && droppedByUserCreditMinutes === 0;

  // ─── AWARDED BASELINE ANALYSIS ──────────────────────────────────────────
  // Fetch the pilot's originally-awarded line credit for this period.
  // If no baseline has been set, we still produce an analysis (with isBaselineSet=false)
  // so the dashboard can prompt the user and the explanation can flag missing info.

  const periodKey = (() => {
    const upsPeriod = getUPSPayPeriod(startISO);
    if (upsPeriod) {
      return `${upsPeriod.year}-P${String(upsPeriod.periodNumber).padStart(2, "0")}`;
    }
    // Fallback key
    const d = new Date(startISO);
    return `${d.getFullYear()}-M${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const storedBaseline = await db.bidPeriodBaseline.findUnique({
    where: { userId_periodKey: { userId: user.id, periodKey } },
  });

  // Straight pickups = all non-JA pickups (those that contribute to guarantee fill first)
  const straightPickupCreditMinutes = (() => {
    let sum = 0;
    for (const trip of deduplicatedTrips) {
      if (trip.pickupType === "straight") {
        const credit = trip.payCreditMinutes || trip.totalCreditMinutes || 0;
        const inPeriod = trip.dutyDays.filter(
          (d) => d.dutyDate >= startISO && d.dutyDate <= endISO
        );
        if (trip.dutyDays.length === 0) {
          sum += credit;
        } else if (inPeriod.length > 0) {
          sum += Math.round(credit * (inPeriod.length / trip.dutyDays.length));
        }
      }
    }
    return sum;
  })();

  let baselineAnalysis: BaselinePayAnalysis | undefined;

  {
    const isBaselineSet = !!storedBaseline;
    // Use stored baseline or fall back to 0 (unknown) — signals missing data
    const awardedCreditMinutes = storedBaseline?.awardedCreditMinutes ?? 0;
    const awardedCreditHours = Math.round((awardedCreditMinutes / 60) * 100) / 100;
    const source = (storedBaseline?.source ?? "estimated") as BaselinePayAnalysis["source"];
    const confidence = (storedBaseline?.confidence ?? "low") as BaselinePayAnalysis["confidence"];

    // Guarantee gap = how far the awarded line fell below the guarantee
    const guaranteeGapMinutes = Math.max(0, guaranteeMinutes - awardedCreditMinutes);

    // Of straight pickups, how many are just filling the gap vs genuinely extra
    const pickupsFillGuaranteeGapMinutes = Math.min(straightPickupCreditMinutes, guaranteeGapMinutes);
    const pickupsAboveGuaranteeMinutes = Math.max(0, straightPickupCreditMinutes - pickupsFillGuaranteeGapMinutes);

    const awardedAboveGuarantee = awardedCreditMinutes >= guaranteeMinutes;

    // Extra paid above guarantee = awarded overage (if any) + pickups truly above guarantee
    const awardedOverageMinutes = Math.max(0, awardedCreditMinutes - guaranteeMinutes);
    const extraPaidAboveGuaranteeMinutes = awardedOverageMinutes + pickupsAboveGuaranteeMinutes;

    // Drop analysis: did the drop push the pilot below guarantee?
    const dropsReducedPaidCredit = droppedByUserCreditMinutes > 0 && isGuaranteeWaivedByUserDrop;

    // Build explanation lines
    const fmtHrs = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
    const explanationLines: string[] = [];

    if (!isBaselineSet) {
      explanationLines.push("No awarded line credit set for this period — set your baseline for more accurate pay analysis.");
    } else {
      explanationLines.push(
        `You were awarded ${fmtHrs(awardedCreditMinutes)} of credit for this period (source: ${source}).`
      );
    }

    if (awardedAboveGuarantee) {
      explanationLines.push(
        `Your awarded line (${fmtHrs(awardedCreditMinutes)}) exceeded the ${fmtHrs(guaranteeMinutes)} guarantee, so you started above the floor.`
      );
    } else if (isBaselineSet) {
      explanationLines.push(
        `Your awarded line (${fmtHrs(awardedCreditMinutes)}) was ${fmtHrs(guaranteeGapMinutes)} below the ${fmtHrs(guaranteeMinutes)} guarantee — guarantee applies.`
      );
    }

    if (straightPickupCreditMinutes > 0) {
      if (pickupsFillGuaranteeGapMinutes > 0 && !awardedAboveGuarantee) {
        explanationLines.push(
          `Straight pickups (${fmtHrs(straightPickupCreditMinutes)}) first filled ${fmtHrs(pickupsFillGuaranteeGapMinutes)} of guarantee gap; only ${fmtHrs(pickupsAboveGuaranteeMinutes)} generated extra pay on top.`
        );
      } else {
        explanationLines.push(
          `Straight pickups (${fmtHrs(straightPickupCreditMinutes)}) all count as extra pay above the guarantee.`
        );
      }
    }

    if (jaPickupCreditMinutes > 0) {
      explanationLines.push(
        `JA pickups (${fmtHrs(jaPickupCreditMinutes)}) pay at 150% and are never used to fill the guarantee gap.`
      );
    }

    if (droppedByUserCreditMinutes > 0) {
      if (dropsReducedPaidCredit) {
        explanationLines.push(
          `You dropped ${fmtHrs(droppedByUserCreditMinutes)} of credit; this waived guarantee protection and reduced your paid credit.`
        );
      } else {
        explanationLines.push(
          `You dropped ${fmtHrs(droppedByUserCreditMinutes)} of credit; guarantee still protects your remaining base line.`
        );
      }
    }

    if (extraPaidAboveGuaranteeMinutes > 0) {
      explanationLines.push(
        `Total extra paid above guarantee: ${fmtHrs(extraPaidAboveGuaranteeMinutes)}.`
      );
    }

    baselineAnalysis = {
      awardedCreditMinutes,
      awardedCreditHours,
      source,
      confidence,
      isBaselineSet,
      guaranteeGapMinutes,
      straightPickupCreditMinutes,
      pickupsFillGuaranteeGapMinutes,
      pickupsAboveGuaranteeMinutes,
      awardedAboveGuarantee,
      droppedCreditMinutes: droppedByUserCreditMinutes,
      dropsReducedPaidCredit,
      extraPaidAboveGuaranteeMinutes,
      explanationLines,
    };
  }

  const entryCount = legCount + periodFlights.length;

  const response: GetDashboardResponse = {
    currentPeriod: period,
    periodStart: startISO,
    periodEnd: endISO,
    totalBlockMinutes,
    totalCreditMinutes,
    totalPayCents,
    entryCount,
    hourlyRateCents: profile.hourlyRateCents,
    recentFlights: recentFlights.map(formatFlightEntry),
    // Guarantee breakdown fields
    paidCreditMinutes,
    jaPickupCreditMinutes,
    droppedByUserCreditMinutes,
    bufferMinutes,
    isGuaranteeActive,
    isGuaranteeWaivedByUserDrop,
    // Extended audit fields
    companyRemovedCreditMinutes,
    baseScheduleCredit,
    protectedBaseCredit,
    paidBaseCreditMinutes,
    basePayCents,
    jaPayCents,
    guaranteeMinutes,
    adjustedGuaranteeFloor,
    baselineAnalysis,
  };

  return c.json(response);
});

export { dashboardRouter };
