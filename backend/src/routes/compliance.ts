import { Hono } from "hono";
import { type AppType } from "../types";
import { db } from "../db";
import {
  calculate30In7BlockMinutes,
  get30In7Status,
  get30In7Remaining,
  formatMinutesAsHHMM,
} from "../lib/pay-calculator";
import {
  THIRTY_IN_SEVEN_LIMIT_MINUTES,
  type ThirtyInSevenStatus,
} from "../lib/constants";

const complianceRouter = new Hono<AppType>();

// ============================================
// GET /api/compliance/30-in-7 - Get 30-in-7 status
// ============================================
complianceRouter.get("/30-in-7", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const asOfDate = c.req.query("date") ?? new Date().toISOString().split("T")[0] ?? "";

  console.log(`📊 [Compliance] Checking 30-in-7 for user: ${user.id} as of ${asOfDate}`);

  // Get all flights for the user (we need 7 days of data)
  const sevenDaysAgo = new Date(asOfDate + "T00:00:00Z");
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const startDate = sevenDaysAgo.toISOString().split("T")[0] ?? "";

  // Pull from FlightEntry (manual entries)
  const flightEntries = await db.flightEntry.findMany({
    where: {
      userId: user.id,
      dateISO: { gte: startDate, lte: asOfDate },
    },
    select: { dateISO: true, blockMinutes: true },
  });

  // Pull from canonical TripDutyDay (imported/scheduled trips in the window)
  // Use actualBlockMinutes when available, fall back to plannedBlockMinutes from legs
  const tripDutyDays = await db.tripDutyDay.findMany({
    where: {
      trip: {
        userId: user.id,
      },
      dutyDate: { gte: startDate, lte: asOfDate },
    },
    select: {
      dutyDate: true,
      blockMinutes: true,
      legs: {
        select: {
          actualBlockMinutes: true,
          plannedBlockMinutes: true,
          isDeadhead: true,
        },
      },
    },
  });

  // Merge: build a per-date map, preferring trip data over manual entries
  // (trips are the authoritative source once imported)
  const dateBlockMap = new Map<string, number>();

  // First add FlightEntry data
  for (const fe of flightEntries) {
    const existing = dateBlockMap.get(fe.dateISO) ?? 0;
    dateBlockMap.set(fe.dateISO, existing + fe.blockMinutes);
  }

  // Then overlay TripDutyDay data - sum actual block minutes from non-deadhead legs
  // Group by date and accumulate
  const tripDateMap = new Map<string, number>();
  for (const tdd of tripDutyDays) {
    const legTotal = tdd.legs.reduce((sum, l) => {
      if (l.isDeadhead) return sum;
      // Use actual if available, else planned
      const mins = l.actualBlockMinutes > 0 ? l.actualBlockMinutes : l.plannedBlockMinutes;
      return sum + mins;
    }, 0);
    // Fall back to tdd.blockMinutes if no leg detail
    const dayMinutes = legTotal > 0 ? legTotal : tdd.blockMinutes;
    const existing = tripDateMap.get(tdd.dutyDate) ?? 0;
    tripDateMap.set(tdd.dutyDate, existing + dayMinutes);
  }

  // For dates where we have trip data, replace the manual entry total
  for (const [date, mins] of tripDateMap.entries()) {
    if (mins > 0) {
      dateBlockMap.set(date, mins);
    }
  }

  // Convert map to array for the calculator
  const mergedFlights = Array.from(dateBlockMap.entries()).map(([dateISO, blockMinutes]) => ({
    dateISO,
    blockMinutes,
  }));

  const rolling7DayMinutes = calculate30In7BlockMinutes(mergedFlights, asOfDate);
  const status = get30In7Status(rolling7DayMinutes);
  const remainingMinutes = get30In7Remaining(rolling7DayMinutes);

  // Calculate daily breakdown for the 7-day window
  const dailyBreakdown: Array<{
    date: string;
    blockMinutes: number;
    formatted: string;
  }> = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(asOfDate + "T00:00:00Z");
    d.setDate(d.getDate() - i);
    const dateISO = d.toISOString().split("T")[0] ?? "";

    const dayMinutes = dateBlockMap.get(dateISO) ?? 0;

    dailyBreakdown.push({
      date: dateISO,
      blockMinutes: dayMinutes,
      formatted: formatMinutesAsHHMM(dayMinutes),
    });
  }

  const response = {
    asOfDate,
    rolling7DayMinutes,
    rolling7DayFormatted: formatMinutesAsHHMM(rolling7DayMinutes),
    limitMinutes: THIRTY_IN_SEVEN_LIMIT_MINUTES,
    limitFormatted: formatMinutesAsHHMM(THIRTY_IN_SEVEN_LIMIT_MINUTES),
    remainingMinutes,
    remainingFormatted: formatMinutesAsHHMM(remainingMinutes),
    status: status as ThirtyInSevenStatus,
    dailyBreakdown,
  };

  return c.json(response);
});

// ============================================
// GET /api/compliance/30-in-7/projection - Project future status
// ============================================
complianceRouter.get("/30-in-7/projection", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const startDate = c.req.query("startDate") ?? new Date().toISOString().split("T")[0] ?? "";
  const daysToProject = parseInt(c.req.query("days") ?? "7", 10);

  // Get historical flights (need 6 days before startDate for rolling window)
  const historicalStart = new Date(startDate + "T00:00:00Z");
  historicalStart.setDate(historicalStart.getDate() - 6);
  const histStartISO = historicalStart.toISOString().split("T")[0] ?? "";

  const endDate = new Date(startDate + "T00:00:00Z");
  endDate.setDate(endDate.getDate() + daysToProject);
  const endDateISO = endDate.toISOString().split("T")[0] ?? "";

  // Pull FlightEntry for historical window
  const flightEntries = await db.flightEntry.findMany({
    where: {
      userId: user.id,
      dateISO: { gte: histStartISO },
    },
    select: { dateISO: true, blockMinutes: true },
  });

  // Pull TripDutyDay for the full range (historical + projection)
  const tripDutyDays = await db.tripDutyDay.findMany({
    where: {
      trip: { userId: user.id },
      dutyDate: { gte: histStartISO, lte: endDateISO },
    },
    select: {
      dutyDate: true,
      blockMinutes: true,
      legs: {
        select: {
          actualBlockMinutes: true,
          plannedBlockMinutes: true,
          isDeadhead: true,
        },
      },
    },
  });

  // Build a merged date→minutes map (same logic as the current status endpoint)
  const dateBlockMap = new Map<string, number>();

  for (const fe of flightEntries) {
    const existing = dateBlockMap.get(fe.dateISO) ?? 0;
    dateBlockMap.set(fe.dateISO, existing + fe.blockMinutes);
  }

  const tripDateMap = new Map<string, number>();
  for (const tdd of tripDutyDays) {
    const legTotal = tdd.legs.reduce((sum, l) => {
      if (l.isDeadhead) return sum;
      const mins = l.actualBlockMinutes > 0 ? l.actualBlockMinutes : l.plannedBlockMinutes;
      return sum + mins;
    }, 0);
    const dayMinutes = legTotal > 0 ? legTotal : tdd.blockMinutes;
    const existing = tripDateMap.get(tdd.dutyDate) ?? 0;
    tripDateMap.set(tdd.dutyDate, existing + dayMinutes);
  }

  for (const [date, mins] of tripDateMap.entries()) {
    if (mins > 0) {
      dateBlockMap.set(date, mins);
    }
  }

  const mergedFlights = Array.from(dateBlockMap.entries()).map(([dateISO, blockMinutes]) => ({
    dateISO,
    blockMinutes,
  }));

  // Build projection for each day
  const projection: Array<{
    date: string;
    projectedMinutes: number;
    projectedStatus: ThirtyInSevenStatus;
    scheduledFlights: number;
  }> = [];

  for (let i = 0; i <= daysToProject; i++) {
    const d = new Date(startDate + "T00:00:00Z");
    d.setDate(d.getDate() + i);
    const dateISO = d.toISOString().split("T")[0] ?? "";

    // Count scheduled legs for this day from TripDutyDay
    const tddForDay = tripDutyDays.filter((tdd) => tdd.dutyDate === dateISO);
    const scheduledFlights = tddForDay.reduce(
      (sum, tdd) => sum + tdd.legs.filter((l) => !l.isDeadhead).length,
      0
    );

    const projectedMinutes = calculate30In7BlockMinutes(mergedFlights, dateISO);
    const projectedStatus = get30In7Status(projectedMinutes);

    projection.push({
      date: dateISO,
      projectedMinutes,
      projectedStatus,
      scheduledFlights,
    });
  }

  return c.json({ startDate, daysProjected: daysToProject, projection });
});

export { complianceRouter };
