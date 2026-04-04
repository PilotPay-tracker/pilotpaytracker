import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";

const lifetimeEarningsRouter = new Hono<AppType>();

// ============================================
// Validation Schemas
// ============================================

const addPriorYearsRequestSchema = z.object({
  years: z.array(z.object({
    year: z.number(),
    grossEarningsCents: z.number(),
    notes: z.string().optional(),
  })),
});

const updateEarningsYearRequestSchema = z.object({
  grossEarningsCents: z.number().optional(),
  notes: z.string().optional(),
});

// ============================================
// Helper Functions
// ============================================

async function getUserProfile(userId: string) {
  return db.profile.findUnique({
    where: { userId },
    select: { airline: true },
  });
}

async function getOrCreateConfig(userId: string, airline: string) {
  let config = await db.lifetimeEarningsConfig.findUnique({
    where: { userId },
  });

  if (!config) {
    config = await db.lifetimeEarningsConfig.create({
      data: {
        userId,
        airline,
        startYear: new Date().getFullYear(),
        priorYearsAdded: false,
      },
    });
  }

  return config;
}

interface EarningsYearData {
  year: number;
  grossEarningsCents: number;
  isFinalized: boolean;
}

function computeSummary(years: EarningsYearData[]) {
  const currentYear = new Date().getFullYear();
  const finalizedYears = years.filter((y) => y.isFinalized);
  const currentYearData = years.find((y) => y.year === currentYear);

  const priorYears = years.filter((y) => y.year !== currentYear);
  const totalCareerEarningsCents = years.reduce((sum, y) => sum + y.grossEarningsCents, 0);
  const yearsActive = years.length;
  // Average excludes the current in-progress year for a realistic historical baseline
  const priorYearsTotal = priorYears.reduce((sum, y) => sum + y.grossEarningsCents, 0);
  const averageAnnualEarningsCents = priorYears.length > 0 ? Math.round(priorYearsTotal / priorYears.length) : 0;

  // Find highest/lowest from finalized years only
  let highestEarningYear: { year: number; grossEarningsCents: number } | null = null;
  let lowestEarningYear: { year: number; grossEarningsCents: number } | null = null;

  if (finalizedYears.length > 0) {
    const sorted = [...finalizedYears].sort((a, b) => b.grossEarningsCents - a.grossEarningsCents);
    const highest = sorted[0];
    const lowest = sorted[sorted.length - 1];
    if (highest) highestEarningYear = { year: highest.year, grossEarningsCents: highest.grossEarningsCents };
    if (lowest) lowestEarningYear = { year: lowest.year, grossEarningsCents: lowest.grossEarningsCents };
  }

  return {
    totalCareerEarningsCents,
    yearsActive,
    averageAnnualEarningsCents,
    highestEarningYear,
    lowestEarningYear,
    currentYearEarningsCents: currentYearData?.grossEarningsCents ?? 0,
    currentYearIsInProgress: currentYearData ? !currentYearData.isFinalized : true,
  };
}

// ============================================
// GET /api/lifetime-earnings - Get lifetime earnings data
// ============================================
lifetimeEarningsRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  console.log(`📊 [Lifetime Earnings] Fetching data for user: ${user.id}`);

  const profile = await getUserProfile(user.id);
  const airline = profile?.airline ?? "Unknown";

  const config = await getOrCreateConfig(user.id, airline);

  // Get all years for this user
  const years = await db.lifetimeEarningsYear.findMany({
    where: { userId: user.id },
    orderBy: { year: "desc" },
  });

  const summary = computeSummary(years);

  return c.json({
    config: {
      id: config.id,
      airline: config.airline,
      startYear: config.startYear,
      priorYearsAdded: config.priorYearsAdded,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    },
    years: years.map((y) => ({
      id: y.id,
      year: y.year,
      grossEarningsCents: y.grossEarningsCents,
      source: y.source,
      isFinalized: y.isFinalized,
      notes: y.notes,
      createdAt: y.createdAt.toISOString(),
      updatedAt: y.updatedAt.toISOString(),
    })),
    summary,
    airline,
  });
});

// ============================================
// POST /api/lifetime-earnings/prior-years - Add prior years earnings
// ============================================
lifetimeEarningsRouter.post(
  "/prior-years",
  zValidator("json", addPriorYearsRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { years } = c.req.valid("json");
    const currentYear = new Date().getFullYear();

    console.log(`📊 [Lifetime Earnings] Adding ${years.length} prior years for user: ${user.id}`);

    // Validate: all years must be reasonable (not in the future beyond 1 year)
    const invalidYears = years.filter((y) => y.year > currentYear + 1);
    if (invalidYears.length > 0) {
      return c.json({ error: "Year cannot be more than 1 year in the future" }, 400);
    }

    // Limit to 10 years
    if (years.length > 10) {
      return c.json({ error: "Maximum 10 years allowed" }, 400);
    }

    const profile = await getUserProfile(user.id);
    const airline = profile?.airline ?? "Unknown";

    // Ensure config exists
    const config = await getOrCreateConfig(user.id, airline);

    // Create or update each year
    const createdYears = [];
    for (const yearData of years) {
      const existing = await db.lifetimeEarningsYear.findUnique({
        where: { userId_year: { userId: user.id, year: yearData.year } },
      });

      if (existing) {
        // Update existing
        const updated = await db.lifetimeEarningsYear.update({
          where: { id: existing.id },
          data: {
            grossEarningsCents: yearData.grossEarningsCents,
            notes: yearData.notes ?? null,
          },
        });
        createdYears.push(updated);
      } else {
        // Create new
        const created = await db.lifetimeEarningsYear.create({
          data: {
            userId: user.id,
            year: yearData.year,
            grossEarningsCents: yearData.grossEarningsCents,
            source: "user",
            isFinalized: true, // Prior years are always finalized
            notes: yearData.notes ?? null,
          },
        });
        createdYears.push(created);
      }
    }

    // Mark config as having prior years added
    await db.lifetimeEarningsConfig.update({
      where: { id: config.id },
      data: { priorYearsAdded: true },
    });

    return c.json({
      success: true,
      yearsAdded: createdYears.length,
      years: createdYears.map((y) => ({
        id: y.id,
        year: y.year,
        grossEarningsCents: y.grossEarningsCents,
        source: y.source,
        isFinalized: y.isFinalized,
        notes: y.notes,
        createdAt: y.createdAt.toISOString(),
        updatedAt: y.updatedAt.toISOString(),
      })),
    });
  }
);

// ============================================
// PUT /api/lifetime-earnings/years/:year - Update a year's earnings
// ============================================
lifetimeEarningsRouter.put(
  "/years/:year",
  zValidator("json", updateEarningsYearRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const yearParam = parseInt(c.req.param("year"), 10);
    if (isNaN(yearParam)) {
      return c.json({ error: "Invalid year" }, 400);
    }

    const { grossEarningsCents, notes } = c.req.valid("json");

    console.log(`📊 [Lifetime Earnings] Updating year ${yearParam} for user: ${user.id}`);

    const existing = await db.lifetimeEarningsYear.findUnique({
      where: { userId_year: { userId: user.id, year: yearParam } },
    });

    if (!existing) {
      return c.json({ error: "Year not found" }, 404);
    }

    // Only block editing finalized app years (they're locked in)
    // Allow editing: user-entered years, app-tracked non-finalized years
    if (existing.source === "app" && existing.isFinalized && yearParam < new Date().getFullYear()) {
      return c.json({ error: "Cannot edit app-tracked finalized years" }, 400);
    }

    const updated = await db.lifetimeEarningsYear.update({
      where: { id: existing.id },
      data: {
        ...(grossEarningsCents !== undefined && { grossEarningsCents }),
        ...(notes !== undefined && { notes }),
      },
    });

    return c.json({
      success: true,
      year: {
        id: updated.id,
        year: updated.year,
        grossEarningsCents: updated.grossEarningsCents,
        source: updated.source,
        isFinalized: updated.isFinalized,
        notes: updated.notes,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  }
);

// ============================================
// DELETE /api/lifetime-earnings/years/:year - Delete a prior year
// ============================================
lifetimeEarningsRouter.delete("/years/:year", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const yearParam = parseInt(c.req.param("year"), 10);
  if (isNaN(yearParam)) {
    return c.json({ error: "Invalid year" }, 400);
  }

  console.log(`📊 [Lifetime Earnings] Deleting year ${yearParam} for user: ${user.id}`);

  const existing = await db.lifetimeEarningsYear.findUnique({
    where: { userId_year: { userId: user.id, year: yearParam } },
  });

  if (!existing) {
    return c.json({ error: "Year not found" }, 404);
  }

  // Only allow deleting user-entered years
  if (existing.source === "app") {
    return c.json({ error: "Cannot delete app-tracked years" }, 400);
  }

  await db.lifetimeEarningsYear.delete({
    where: { id: existing.id },
  });

  return c.json({ success: true });
});

// ============================================
// GET /api/lifetime-earnings/context - Get career context for Upgrade Simulation
// ============================================
lifetimeEarningsRouter.get("/context", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  console.log(`📊 [Lifetime Earnings] Getting career context for user: ${user.id}`);

  const years = await db.lifetimeEarningsYear.findMany({
    where: { userId: user.id },
  });

  if (years.length === 0) {
    return c.json({
      hasLifetimeData: false,
      averageAnnualEarningsCents: null,
      yearsTracked: 0,
    });
  }

  const summary = computeSummary(years);

  return c.json({
    hasLifetimeData: true,
    averageAnnualEarningsCents: summary.averageAnnualEarningsCents,
    yearsTracked: summary.yearsActive,
  });
});

// ============================================
// POST /api/lifetime-earnings/sync-current-year - Sync current year from app data
// This is called internally to update current year earnings
// IMPORTANT: Calculates pay from credit minutes * hourly rate (consistent with dashboard)
// ============================================
lifetimeEarningsRouter.post("/sync-current-year", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const currentYear = new Date().getFullYear();

  console.log(`📊 [Lifetime Earnings] Syncing current year ${currentYear} for user: ${user.id}`);

  // Get user profile for hourly rate
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    select: { hourlyRateCents: true, airline: true },
  });

  const hourlyRateCents = profile?.hourlyRateCents ?? 32500;
  const airline = profile?.airline ?? "Unknown";

  // Calculate current year earnings from trips
  // IMPORTANT: Use credit minutes * hourly rate (not stored totalPayCents which may be 0)
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  // Get all trips for this year with duty days and legs
  // Exclude cancelled and override trips
  const trips = await db.trip.findMany({
    where: {
      userId: user.id,
      status: { notIn: ["cancelled", "override"] },
    },
    include: {
      dutyDays: {
        include: { legs: true },
      },
    },
  });

  // Calculate total credit minutes for the year
  let yearCreditMinutes = 0;

  for (const trip of trips) {
    if (trip.dutyDays.length > 0) {
      for (const dutyDay of trip.dutyDays) {
        // Only count duty days within the current year
        if (dutyDay.dutyDate >= yearStart && dutyDay.dutyDate <= yearEnd) {
          if (dutyDay.legs.length > 0) {
            for (const leg of dutyDay.legs) {
              yearCreditMinutes += leg.creditMinutes || leg.plannedCreditMinutes || 0;
            }
          } else {
            yearCreditMinutes += dutyDay.finalCreditMinutes || dutyDay.actualCreditMinutes || dutyDay.plannedCreditMinutes || 0;
          }
        }
      }
    } else if (trip.totalCreditMinutes > 0) {
      // Trip has no duty days - use trip-level data if it falls within the year
      if (trip.startDate >= yearStart && trip.endDate <= yearEnd) {
        yearCreditMinutes += trip.payCreditMinutes || trip.totalCreditMinutes;
      }
    }
  }

  // Calculate pay from credit minutes * hourly rate
  const totalEarnings = Math.round((yearCreditMinutes / 60) * hourlyRateCents);

  console.log(`📊 [Lifetime Earnings] Year ${currentYear}: ${yearCreditMinutes} credit mins * $${hourlyRateCents / 100}/hr = $${totalEarnings / 100}`);

  // Upsert current year
  const existing = await db.lifetimeEarningsYear.findUnique({
    where: { userId_year: { userId: user.id, year: currentYear } },
  });

  if (existing) {
    await db.lifetimeEarningsYear.update({
      where: { id: existing.id },
      data: {
        grossEarningsCents: totalEarnings,
        source: "app",
        isFinalized: false, // Current year is never finalized
      },
    });
  } else {
    await db.lifetimeEarningsYear.create({
      data: {
        userId: user.id,
        year: currentYear,
        grossEarningsCents: totalEarnings,
        source: "app",
        isFinalized: false,
      },
    });
  }

  // Ensure config exists
  await getOrCreateConfig(user.id, airline);

  return c.json({
    success: true,
    year: currentYear,
    grossEarningsCents: totalEarnings,
  });
});

export { lifetimeEarningsRouter };
