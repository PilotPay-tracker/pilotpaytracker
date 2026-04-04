import { Hono } from "hono";
import { type AppType } from "../types";
import { db } from "../db";
import {
  PAY_PERIODS_2026,
  getPayPeriodForDate,
  getNextPayDate,
} from "../lib/constants";

const payPeriodsRouter = new Hono<AppType>();

// ============================================
// GET /api/pay-periods - List all pay periods
// ============================================
payPeriodsRouter.get("/", async (c) => {
  const year = c.req.query("year");

  // For now, return hardcoded 2026 periods
  // In production, this would come from the database
  let periods = PAY_PERIODS_2026;

  if (year) {
    periods = periods.filter((p) => p.year === parseInt(year, 10));
  }

  return c.json({
    periods: periods.map((p) => ({
      year: p.year,
      periodNumber: p.periodNumber,
      startDate: p.startDate,
      endDate: p.endDate,
      payDate: p.payDate,
      payType: p.payType,
    })),
  });
});

// ============================================
// GET /api/pay-periods/current - Get current pay period
// ============================================
payPeriodsRouter.get("/current", async (c) => {
  const user = c.get("user");
  const today = new Date().toISOString().split("T")[0] ?? "";

  const period = getPayPeriodForDate(today);

  if (!period) {
    return c.json({
      error: "No pay period found for current date",
      today,
    }, 404);
  }

  // If user is authenticated, get their totals for this period
  let periodTotals = null;
  if (user) {
    // Get trip data (primary source)
    const trips = await db.trip.findMany({
      where: {
        userId: user.id,
        OR: [
          { startDate: { gte: period.startDate, lte: period.endDate } },
          { endDate: { gte: period.startDate, lte: period.endDate } },
          {
            AND: [
              { startDate: { lte: period.startDate } },
              { endDate: { gte: period.endDate } },
            ],
          },
        ],
      },
      include: {
        dutyDays: {
          include: { legs: true },
        },
      },
    });

    // Calculate totals from trip legs within the pay period
    let tripBlockMinutes = 0;
    let tripCreditMinutes = 0;
    let tripPayCents = 0;
    let tripLegCount = 0;

    for (const trip of trips) {
      for (const dutyDay of trip.dutyDays) {
        if (dutyDay.dutyDate >= period.startDate && dutyDay.dutyDate <= period.endDate) {
          for (const leg of dutyDay.legs) {
            tripBlockMinutes += leg.actualBlockMinutes || leg.plannedBlockMinutes;
            tripCreditMinutes += leg.creditMinutes || leg.plannedCreditMinutes;
            tripPayCents += leg.calculatedPayCents;
            tripLegCount++;
          }
        }
      }
    }

    // Also get FlightEntry data
    const flightEntries = await db.flightEntry.aggregate({
      where: {
        userId: user.id,
        dateISO: {
          gte: period.startDate,
          lte: period.endDate,
        },
      },
      _sum: {
        blockMinutes: true,
        creditMinutes: true,
        totalPayCents: true,
      },
      _count: true,
    });

    // Combine totals (trip data takes priority, flight entries are fallback)
    const hasTrips = tripLegCount > 0;
    const hasFlightEntries = flightEntries._count > 0;

    if (hasTrips) {
      // Use trip data primarily
      periodTotals = {
        flightCount: tripLegCount,
        blockMinutes: tripBlockMinutes,
        creditMinutes: tripCreditMinutes,
        totalPayCents: tripPayCents,
      };
    } else if (hasFlightEntries) {
      // Fallback to flight entries
      periodTotals = {
        flightCount: flightEntries._count,
        blockMinutes: flightEntries._sum.blockMinutes ?? 0,
        creditMinutes: flightEntries._sum.creditMinutes ?? 0,
        totalPayCents: flightEntries._sum.totalPayCents ?? 0,
      };
    } else {
      periodTotals = {
        flightCount: 0,
        blockMinutes: 0,
        creditMinutes: 0,
        totalPayCents: 0,
      };
    }
  }

  return c.json({
    period: {
      year: period.year,
      periodNumber: period.periodNumber,
      startDate: period.startDate,
      endDate: period.endDate,
      payDate: period.payDate,
    },
    totals: periodTotals,
  });
});

// ============================================
// GET /api/pay-periods/next-pay-date - Get next pay date
// ============================================
payPeriodsRouter.get("/next-pay-date", async (c) => {
  const today = new Date().toISOString().split("T")[0] ?? "";

  const nextPay = getNextPayDate(today);

  if (!nextPay) {
    return c.json({ error: "No upcoming pay dates found" }, 404);
  }

  // Calculate days until pay
  const todayDate = new Date(today + "T00:00:00Z");
  const payDate = new Date(nextPay.payDate + "T00:00:00Z");
  const daysUntilPay = Math.ceil(
    (payDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  return c.json({
    payDate: nextPay.payDate,
    payType: nextPay.payType,
    daysUntilPay,
    today,
  });
});

// ============================================
// GET /api/pay-periods/upcoming-pay-dates - Get next N pay dates
// ============================================
payPeriodsRouter.get("/upcoming-pay-dates", async (c) => {
  const today = new Date().toISOString().split("T")[0] ?? "";
  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 4;

  const allPayDates = PAY_PERIODS_2026
    .map(p => ({ payDate: p.payDate, payType: p.payType, periodNumber: p.periodNumber, year: p.year }))
    .sort((a, b) => a.payDate.localeCompare(b.payDate))
    .filter(pd => pd.payDate >= today)
    .slice(0, limit);

  return c.json({
    payDates: allPayDates,
    today,
  });
});

// ============================================
// GET /api/pay-periods/:year/:period - Get specific period
// ============================================
payPeriodsRouter.get("/:year/:period", async (c) => {
  const user = c.get("user");
  const year = parseInt(c.req.param("year"), 10);
  const periodNumber = parseInt(c.req.param("period"), 10);

  const period = PAY_PERIODS_2026.find(
    (p) => p.year === year && p.periodNumber === periodNumber && p.payType === "standard"
  );

  if (!period) {
    return c.json({ error: "Pay period not found" }, 404);
  }

  // Get all pay dates for this period
  const payDates = PAY_PERIODS_2026.filter(
    (p) => p.year === year && p.periodNumber === periodNumber
  ).map((p) => ({
    payDate: p.payDate,
    payType: p.payType,
  }));

  // If user is authenticated, get their totals
  let periodTotals = null;
  let flights: Array<{
    id: string;
    dateISO: string;
    flightNumber: string | null;
    origin: string | null;
    destination: string | null;
    blockMinutes: number;
    creditMinutes: number;
    totalPayCents: number;
  }> = [];

  if (user) {
    // First, try to get data from Trip/DutyDay/Leg (the primary source for imported trips)
    const trips = await db.trip.findMany({
      where: {
        userId: user.id,
        OR: [
          // Trip starts within pay period
          { startDate: { gte: period.startDate, lte: period.endDate } },
          // Trip ends within pay period
          { endDate: { gte: period.startDate, lte: period.endDate } },
          // Trip spans the entire pay period
          {
            AND: [
              { startDate: { lte: period.startDate } },
              { endDate: { gte: period.endDate } },
            ],
          },
        ],
      },
      include: {
        dutyDays: {
          include: { legs: true },
          orderBy: { dutyDate: "asc" },
        },
      },
      orderBy: { startDate: "desc" },
    });

    // Extract all legs from trips that fall within the pay period
    const tripLegs: Array<{
      id: string;
      dateISO: string;
      flightNumber: string | null;
      origin: string | null;
      destination: string | null;
      blockMinutes: number;
      creditMinutes: number;
      totalPayCents: number;
    }> = [];

    for (const trip of trips) {
      for (const dutyDay of trip.dutyDays) {
        // Only include duty days that fall within the pay period
        if (dutyDay.dutyDate >= period.startDate && dutyDay.dutyDate <= period.endDate) {
          for (const leg of dutyDay.legs) {
            tripLegs.push({
              id: leg.id,
              dateISO: dutyDay.dutyDate,
              flightNumber: leg.flightNumber,
              origin: leg.origin,
              destination: leg.destination,
              blockMinutes: leg.actualBlockMinutes || leg.plannedBlockMinutes,
              creditMinutes: leg.creditMinutes || leg.plannedCreditMinutes,
              totalPayCents: leg.calculatedPayCents,
            });
          }
        }
      }
    }

    // Also check FlightEntry for any standalone flight entries
    const flightEntryData = await db.flightEntry.findMany({
      where: {
        userId: user.id,
        dateISO: {
          gte: period.startDate,
          lte: period.endDate,
        },
      },
      select: {
        id: true,
        dateISO: true,
        flightNumber: true,
        origin: true,
        destination: true,
        blockMinutes: true,
        creditMinutes: true,
        totalPayCents: true,
      },
      orderBy: { dateISO: "desc" },
    });

    // Combine trip legs and flight entries, avoiding duplicates by checking if
    // a flight entry is already represented in trip legs (by date + flight number)
    const tripLegKeys = new Set(
      tripLegs.map((l) => `${l.dateISO}-${l.flightNumber ?? ""}`)
    );

    const uniqueFlightEntries = flightEntryData.filter(
      (f) => !tripLegKeys.has(`${f.dateISO}-${f.flightNumber ?? ""}`)
    );

    // Merge all flights
    flights = [...tripLegs, ...uniqueFlightEntries].sort((a, b) =>
      b.dateISO.localeCompare(a.dateISO)
    );

    // Calculate totals
    const totals = flights.reduce(
      (acc, f) => ({
        blockMinutes: acc.blockMinutes + f.blockMinutes,
        creditMinutes: acc.creditMinutes + f.creditMinutes,
        totalPayCents: acc.totalPayCents + f.totalPayCents,
      }),
      { blockMinutes: 0, creditMinutes: 0, totalPayCents: 0 }
    );

    periodTotals = {
      flightCount: flights.length,
      ...totals,
    };
  }

  return c.json({
    period: {
      year: period.year,
      periodNumber: period.periodNumber,
      startDate: period.startDate,
      endDate: period.endDate,
      payDates,
    },
    totals: periodTotals,
    flights,
  });
});

export { payPeriodsRouter };
