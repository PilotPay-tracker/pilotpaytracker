import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";
import { calculateDutyDayTotals } from "../lib/pay-calculator";
import { getCanonicalTripBreakdown } from "../lib/canonical-import-pipeline";
import { checkTripConflicts } from "../lib/trip-conflict-detector";

const tripsRouter = new Hono<AppType>();

// ============================================
// Validation Schemas
// ============================================

const createTripSchema = z.object({
  tripNumber: z.string().optional(),
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string(),
  source: z.enum(["import", "oooi", "manual", "logbook"]).optional(),
});

const updateTripSchema = z.object({
  tripNumber: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  source: z.enum(["import", "oooi", "manual", "logbook"]).optional(),
  totalCreditMinutes: z.number().optional(),
  totalBlockMinutes: z.number().optional(),
});

const createDutyDaySchema = z.object({
  tripId: z.string(),
  dutyDate: z.string(),
  dutyStartISO: z.string().optional(),
  dutyEndISO: z.string().optional(),
  plannedCreditMinutes: z.number().optional(),
});

const createLegSchema = z.object({
  dutyDayId: z.string(),
  legIndex: z.number().optional(),
  flightNumber: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  equipment: z.string().optional(),
  tailNumber: z.string().optional(),
  isDeadhead: z.boolean().optional(),
  scheduledOutISO: z.string().optional(),
  scheduledInISO: z.string().optional(),
  plannedBlockMinutes: z.number().optional(),
  plannedCreditMinutes: z.number().optional(),
  actualOutISO: z.string().optional(),
  actualOffISO: z.string().optional(),
  actualOnISO: z.string().optional(),
  actualInISO: z.string().optional(),
  actualFlightMinutes: z.number().optional(),
  actualBlockMinutes: z.number().optional(),
  creditMinutes: z.number().optional(),
  premiumCode: z.string().optional(),
  premiumAmountCents: z.number().optional(),
  source: z.enum(["import", "oooi", "manual"]).optional(),
  ooiProofUri: z.string().optional(),
  notes: z.string().optional(),
});

const updateLegSchema = createLegSchema.partial();

// ============================================
// GET /api/trips - List trips
// ============================================
tripsRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const status = c.req.query("status");

  const trips = await db.trip.findMany({
    where: {
      userId: user.id,
      ...(startDate && endDate
        ? {
            OR: [
              { startDate: { gte: startDate, lte: endDate } },
              { endDate: { gte: startDate, lte: endDate } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
    },
    include: {
      dutyDays: {
        include: { legs: true },
        orderBy: { dutyDate: "asc" },
      },
      events: {
        orderBy: [{ sortOrder: "asc" }, { startTimeLocal: "asc" }],
      },
      // Include canonical breakdown
      tripDutyDays: {
        include: {
          legs: { orderBy: { legIndex: "asc" } },
          layover: true,
        },
        orderBy: { dutyDayIndex: "asc" },
      },
    },
    orderBy: { startDate: "desc" },
  });

  return c.json({ trips });
});

// ============================================
// DELETE /api/trips/month - Delete all trips for a month
// Must be defined BEFORE /:id routes to avoid "month" being matched as an id
// ============================================
tripsRouter.delete("/month", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  if (!startDate || !endDate) {
    return c.json({ error: "startDate and endDate are required" }, 400);
  }

  console.log(`🗑️ [Trips] Deleting trips for ${startDate} to ${endDate}`);

  // Find all trips in the date range
  const trips = await db.trip.findMany({
    where: {
      userId: user.id,
      OR: [
        { startDate: { gte: startDate, lte: endDate } },
        { endDate: { gte: startDate, lte: endDate } },
      ],
    },
    select: { id: true },
  });

  const tripIds = trips.map((t) => t.id);

  if (tripIds.length === 0) {
    return c.json({ success: true, deletedCount: 0 });
  }

  // Get all duty day IDs for these trips
  const dutyDays = await db.dutyDay.findMany({
    where: { tripId: { in: tripIds } },
    select: { id: true },
  });
  const dutyDayIds = dutyDays.map((d) => d.id);

  // Delete in order: legs -> duty days -> trip events -> trips
  if (dutyDayIds.length > 0) {
    await db.leg.deleteMany({
      where: { dutyDayId: { in: dutyDayIds } },
    });
    await db.dutyDay.deleteMany({
      where: { id: { in: dutyDayIds } },
    });
  }

  await db.tripEvent.deleteMany({
    where: { tripId: { in: tripIds } },
  });

  await db.trip.deleteMany({
    where: { id: { in: tripIds } },
  });

  console.log(`✅ [Trips] Deleted ${tripIds.length} trips for ${startDate} to ${endDate}`);

  return c.json({ success: true, deletedCount: tripIds.length });
});

// ============================================
// DELETE /api/trips/all - Delete all trips for user
// Must be defined BEFORE /:id routes
// ============================================
tripsRouter.delete("/all", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  console.log(`🗑️ [Trips] Deleting ALL trips for user: ${user.id}`);

  // Find all trips
  const trips = await db.trip.findMany({
    where: { userId: user.id },
    select: { id: true },
  });

  const tripIds = trips.map((t) => t.id);

  if (tripIds.length === 0) {
    return c.json({ success: true, deletedCount: 0, message: "No trips to delete" });
  }

  // Get all duty day IDs
  const dutyDays = await db.dutyDay.findMany({
    where: { tripId: { in: tripIds } },
    select: { id: true },
  });
  const dutyDayIds = dutyDays.map((d) => d.id);

  // Delete in order
  if (dutyDayIds.length > 0) {
    await db.leg.deleteMany({
      where: { dutyDayId: { in: dutyDayIds } },
    });
    await db.dutyDay.deleteMany({
      where: { id: { in: dutyDayIds } },
    });
  }

  await db.tripEvent.deleteMany({
    where: { tripId: { in: tripIds } },
  });

  // Delete roster changes
  await db.rosterChange.deleteMany({
    where: { tripId: { in: tripIds } },
  });

  // Delete trip versions
  await db.tripVersion.deleteMany({
    where: { tripId: { in: tripIds } },
  });

  // Delete pay protection records
  await db.tripPayProtection.deleteMany({
    where: { tripId: { in: tripIds } },
  });

  await db.trip.deleteMany({
    where: { id: { in: tripIds } },
  });

  console.log(`✅ [Trips] Deleted ${tripIds.length} trips for user: ${user.id}`);

  return c.json({
    success: true,
    deletedCount: tripIds.length,
    message: `Deleted ${tripIds.length} trip${tripIds.length !== 1 ? "s" : ""}`,
  });
});

// ============================================
// GET /api/trips/:id - Get single trip
// ============================================
tripsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");

  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
    include: {
      dutyDays: {
        include: { legs: { orderBy: { legIndex: "asc" } } },
        orderBy: { dutyDate: "asc" },
      },
      events: {
        orderBy: [{ sortOrder: "asc" }, { startTimeLocal: "asc" }],
      },
      // Include canonical breakdown
      tripDutyDays: {
        include: {
          legs: { orderBy: { legIndex: "asc" } },
          layover: true,
        },
        orderBy: { dutyDayIndex: "asc" },
      },
    },
  });

  if (!trip) return c.json({ error: "Trip not found" }, 404);

  // Populate credit fields if they are 0 but totalCreditMinutes is set
  // This handles trips created before the credit tracking was fully implemented
  let tripWithCredits = trip;
  if (
    trip.totalCreditMinutes > 0 &&
    trip.protectedCreditMinutes === 0 &&
    trip.currentCreditMinutes === 0 &&
    trip.payCreditMinutes === 0
  ) {
    const creditMinutes = trip.totalCreditMinutes;
    // Also build currentRosterSnapshot from tripDutyDays if not present
    let currentSnapshot = trip.currentRosterSnapshot;
    if (!currentSnapshot && trip.tripDutyDays && trip.tripDutyDays.length > 0) {
      const snapshotData = {
        dutyDays: trip.tripDutyDays.map((dd: any) => ({
          dayIndex: dd.dutyDayIndex,
          dutyDate: dd.dutyDate,
          reportTimeISO: dd.reportTimeISO,
          releaseTimeISO: dd.releaseTimeISO,
          legs: (dd.legs || []).map((leg: any) => ({
            legIndex: leg.legIndex,
            flightNumber: leg.flightNumber,
            origin: leg.origin,
            destination: leg.destination,
            scheduledOutISO: leg.scheduledOutISO,
            scheduledInISO: leg.scheduledInISO,
            equipment: leg.equipment,
            isDeadhead: leg.isDeadhead,
          })),
          layover: dd.layover ? { station: dd.layover.station, restMinutes: dd.layover.restMinutes } : undefined,
        })),
        totalCreditMinutes: creditMinutes,
        legCount: trip.legCount,
        dutyDaysCount: trip.dutyDaysCount,
      };
      currentSnapshot = JSON.stringify(snapshotData);
    }
    // Update the DB so subsequent fetches also have correct values
    const updateData: any = {
      protectedCreditMinutes: creditMinutes,
      currentCreditMinutes: creditMinutes,
      payCreditMinutes: creditMinutes,
    };
    if (currentSnapshot && !trip.currentRosterSnapshot) {
      updateData.currentRosterSnapshot = currentSnapshot;
    }
    if (!trip.originalRosterSnapshot && (currentSnapshot || trip.currentRosterSnapshot)) {
      updateData.originalRosterSnapshot = currentSnapshot ?? trip.currentRosterSnapshot;
    }
    await db.trip.update({
      where: { id: trip.id },
      data: updateData,
    });
    tripWithCredits = {
      ...trip,
      protectedCreditMinutes: creditMinutes,
      currentCreditMinutes: creditMinutes,
      payCreditMinutes: creditMinutes,
      currentRosterSnapshot: currentSnapshot ?? trip.currentRosterSnapshot,
      originalRosterSnapshot: trip.originalRosterSnapshot ?? currentSnapshot,
    };
    console.log(`[Trips] Auto-populated credit fields for trip ${trip.id}: ${creditMinutes} minutes`);
  }

  return c.json({ trip: tripWithCredits });
});

// ============================================
// GET /api/trips/:id/breakdown - Get canonical trip breakdown
// ============================================
tripsRouter.get("/:id/breakdown", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");

  // Verify ownership
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!trip) return c.json({ error: "Trip not found" }, 404);

  const breakdown = await getCanonicalTripBreakdown(tripId);

  return c.json({ breakdown });
});

// ============================================
// POST /api/trips - Create trip
// ============================================
// BACKEND GUARDRAIL: Checks for conflicts before creating
// If hard conflicts exist, returns 409 Conflict with conflict details
// This prevents silent duplicate creation even if frontend bypasses check
tripsRouter.post("/", zValidator("json", createTripSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");

  // GUARDRAIL: Check for conflicts before creating trip
  // This prevents silent duplicate/overlapping trips even if frontend skips the check
  const conflictResult = await checkTripConflicts({
    userId: user.id,
    startDate: body.startDate,
    endDate: body.endDate,
    tripNumber: body.tripNumber,
  });

  // Only block on HARD conflicts (duplicate or actual time overlap)
  // Soft conflicts (same day, different times) are allowed
  if (conflictResult.hasConflicts && conflictResult.conflictTier !== "soft_same_day" && conflictResult.conflictTier !== "none") {
    console.log(`🚫 [Trips] Backend guardrail: Blocking trip creation due to conflict. Tier: ${conflictResult.conflictTier}`);

    return c.json({
      error: "Conflict detected",
      message: "Cannot create trip - conflicts with existing trips. Use the import flow to resolve conflicts.",
      conflictTier: conflictResult.conflictTier,
      conflicts: conflictResult.conflicts.map(conflict => ({
        existingTripId: conflict.existingTrip.tripId,
        existingTripNumber: conflict.existingTrip.tripNumber,
        conflictType: conflict.conflictType,
        overlappingDates: conflict.overlappingDates,
      })),
      overlapSummary: conflictResult.overlapSummary,
    }, 409);
  }

  const trip = await db.trip.create({
    data: {
      userId: user.id,
      tripNumber: body.tripNumber ?? null,
      startDate: body.startDate,
      endDate: body.endDate,
      source: body.source ?? "manual",
    },
  });

  console.log(`✅ [Trips] Created trip: ${trip.id}`);

  return c.json({ success: true, trip });
});

// ============================================
// PUT /api/trips/:id - Update trip
// ============================================
tripsRouter.put("/:id", zValidator("json", updateTripSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");
  const body = c.req.valid("json");

  const existing = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!existing) return c.json({ error: "Trip not found" }, 404);

  // Get hourly rate for pay calculation
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });
  const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

  // Build update data
  const updateData: Record<string, unknown> = {};

  if (body.tripNumber !== undefined) updateData.tripNumber = body.tripNumber;
  if (body.startDate !== undefined) updateData.startDate = body.startDate;
  if (body.endDate !== undefined) updateData.endDate = body.endDate;
  if (body.source !== undefined) updateData.source = body.source;
  if (body.totalBlockMinutes !== undefined) updateData.totalBlockMinutes = body.totalBlockMinutes;

  // Handle credit minutes update - recalculate pay
  if (body.totalCreditMinutes !== undefined) {
    updateData.totalCreditMinutes = body.totalCreditMinutes;
    // Recalculate pay based on new credit
    const newPayCents = Math.round((body.totalCreditMinutes / 60) * hourlyRateCents);
    updateData.totalPayCents = newPayCents;
    console.log(`💰 [Trips] Updating trip ${tripId} credit to ${body.totalCreditMinutes} min, pay to ${newPayCents} cents`);
  }

  const trip = await db.trip.update({
    where: { id: tripId },
    data: updateData,
    include: {
      dutyDays: {
        include: { legs: true },
        orderBy: { dutyDate: "asc" },
      },
    },
  });

  return c.json({ success: true, trip });
});

// ============================================
// DELETE /api/trips/:id - Delete trip
// ============================================
tripsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");
  console.log(`🗑️ [Trips] Delete request for trip: ${tripId}`);

  const existing = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
    select: { id: true, tripNumber: true, totalCreditMinutes: true },
  });

  if (!existing) {
    console.log(`❌ [Trips] Trip not found: ${tripId}`);
    return c.json({ error: "Trip not found" }, 404);
  }

  console.log(`🗑️ [Trips] Found trip to delete: ${existing.tripNumber || tripId}, credit: ${existing.totalCreditMinutes} mins`);

  try {
    // Cascade delete handles duty days and legs
    await db.trip.delete({ where: { id: tripId } });
    console.log(`✅ [Trips] Successfully deleted trip: ${tripId}`);
    return c.json({ success: true });
  } catch (error) {
    console.error(`❌ [Trips] Failed to delete trip ${tripId}:`, error);
    return c.json({ error: "Failed to delete trip", details: String(error) }, 500);
  }
});

// ============================================
// PATCH /api/trips/:id/company-remove - Company-caused removal (protects pay credit)
// ============================================
tripsRouter.patch("/:id/company-remove", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");
  console.log(`🏢 [Trips] Company-remove request for trip: ${tripId}`);

  const existing = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
    select: { id: true, tripNumber: true, payCreditMinutes: true, totalCreditMinutes: true },
  });

  if (!existing) {
    return c.json({ error: "Trip not found" }, 404);
  }

  try {
    const updated = await db.trip.update({
      where: { id: tripId },
      data: {
        tripActionType: "company_removed",
        status: "company_removed",
      },
      select: { id: true, tripNumber: true, tripActionType: true, status: true },
    });
    console.log(`✅ [Trips] Company-removed trip: ${existing.tripNumber || tripId} (credit preserved: ${existing.payCreditMinutes || existing.totalCreditMinutes || 0}min)`);
    return c.json({ success: true, trip: updated });
  } catch (error) {
    console.error(`❌ [Trips] Failed to company-remove trip ${tripId}:`, error);
    return c.json({ error: "Failed to mark trip as company removed", details: String(error) }, 500);
  }
});

// ============================================
// PATCH /api/trips/:id/drop - Drop trip (user-caused removal)
// ============================================
tripsRouter.patch("/:id/drop", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");
  console.log(`✈️ [Trips] Drop request for trip: ${tripId}`);

  const existing = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
    select: { id: true, tripNumber: true, payCreditMinutes: true, totalCreditMinutes: true },
  });

  if (!existing) {
    return c.json({ error: "Trip not found" }, 404);
  }

  try {
    const updated = await db.trip.update({
      where: { id: tripId },
      data: {
        tripActionType: "dropped_by_user",
        status: "dropped",
      },
      select: { id: true, tripNumber: true, tripActionType: true, status: true },
    });
    console.log(`✅ [Trips] Dropped trip: ${existing.tripNumber || tripId}`);
    return c.json({ success: true, trip: updated });
  } catch (error) {
    console.error(`❌ [Trips] Failed to drop trip ${tripId}:`, error);
    return c.json({ error: "Failed to drop trip", details: String(error) }, 500);
  }
});

// ============================================
// PATCH /api/trips/:id/mark-pickup - Tag trip as straight or JA pickup
// ============================================
tripsRouter.patch("/:id/mark-pickup", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");
  let body: { pickupType: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const { pickupType } = body;
  if (!["none", "straight", "ja"].includes(pickupType)) {
    return c.json({ error: "pickupType must be 'none', 'straight', or 'ja'" }, 400);
  }

  const existing = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
    select: { id: true, tripNumber: true, pickupType: true },
  });

  if (!existing) {
    return c.json({ error: "Trip not found" }, 404);
  }

  try {
    const updated = await db.trip.update({
      where: { id: tripId },
      data: { pickupType },
      select: { id: true, tripNumber: true, pickupType: true },
    });
    console.log(`✅ [Trips] Marked trip ${existing.tripNumber || tripId} as pickupType=${pickupType}`);
    return c.json({ success: true, trip: updated });
  } catch (error) {
    console.error(`❌ [Trips] Failed to mark pickup type for trip ${tripId}:`, error);
    return c.json({ error: "Failed to update pickup type", details: String(error) }, 500);
  }
});

// ============================================
// POST /api/trips/:id/duty-days - Add duty day
// ============================================
tripsRouter.post(
  "/:id/duty-days",
  zValidator("json", createDutyDaySchema.omit({ tripId: true })),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const tripId = c.req.param("id");
    const body = c.req.valid("json");

    const trip = await db.trip.findFirst({
      where: { id: tripId, userId: user.id },
    });

    if (!trip) return c.json({ error: "Trip not found" }, 404);

    const dutyDay = await db.dutyDay.create({
      data: {
        tripId,
        dutyDate: body.dutyDate,
        dutyStartISO: body.dutyStartISO ?? null,
        dutyEndISO: body.dutyEndISO ?? null,
        plannedCreditMinutes: body.plannedCreditMinutes ?? 0,
      },
    });

    console.log(`✅ [Trips] Created duty day: ${dutyDay.id}`);

    return c.json({ success: true, dutyDay });
  }
);

// ============================================
// POST /api/trips/duty-days/:id/legs - Add leg
// ============================================
tripsRouter.post(
  "/duty-days/:id/legs",
  zValidator("json", createLegSchema.omit({ dutyDayId: true })),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const dutyDayId = c.req.param("id");
    const body = c.req.valid("json");

    // Verify ownership through trip
    const dutyDay = await db.dutyDay.findFirst({
      where: { id: dutyDayId },
      include: { trip: true },
    });

    if (!dutyDay || dutyDay.trip.userId !== user.id) {
      return c.json({ error: "Duty day not found" }, 404);
    }

    // Get user profile for hourly rate
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    });

    const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

    // Calculate pay for this leg
    const creditMinutes = body.creditMinutes ?? body.plannedCreditMinutes ?? 0;
    const calculatedPayCents = Math.round((creditMinutes / 60) * hourlyRateCents);

    const leg = await db.leg.create({
      data: {
        dutyDayId,
        legIndex: body.legIndex ?? 0,
        flightNumber: body.flightNumber ?? null,
        origin: body.origin ?? null,
        destination: body.destination ?? null,
        equipment: body.equipment ?? null,
        tailNumber: body.tailNumber ?? null,
        isDeadhead: body.isDeadhead ?? false,
        scheduledOutISO: body.scheduledOutISO ?? null,
        scheduledInISO: body.scheduledInISO ?? null,
        plannedBlockMinutes: body.plannedBlockMinutes ?? 0,
        plannedCreditMinutes: body.plannedCreditMinutes ?? 0,
        actualOutISO: body.actualOutISO ?? null,
        actualOffISO: body.actualOffISO ?? null,
        actualOnISO: body.actualOnISO ?? null,
        actualInISO: body.actualInISO ?? null,
        actualFlightMinutes: body.actualFlightMinutes ?? 0,
        actualBlockMinutes: body.actualBlockMinutes ?? 0,
        creditMinutes,
        premiumCode: body.premiumCode ?? null,
        premiumAmountCents: body.premiumAmountCents ?? 0,
        calculatedPayCents,
        source: body.source ?? "manual",
        ooiProofUri: body.ooiProofUri ?? null,
        notes: body.notes ?? null,
      },
    });

    // Recalculate duty day totals
    await recalculateDutyDay(dutyDayId, hourlyRateCents);

    console.log(`✅ [Trips] Created leg: ${leg.id}`);

    return c.json({ success: true, leg });
  }
);

// ============================================
// PUT /api/trips/legs/:id - Update leg
// ============================================
tripsRouter.put("/legs/:id", zValidator("json", updateLegSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const legId = c.req.param("id");
  const body = c.req.valid("json");

  // Verify ownership
  const existing = await db.leg.findFirst({
    where: { id: legId },
    include: { dutyDay: { include: { trip: true } } },
  });

  if (!existing || existing.dutyDay.trip.userId !== user.id) {
    return c.json({ error: "Leg not found" }, 404);
  }

  // Get hourly rate
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });
  const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

  // Calculate pay if credit changed
  const creditMinutes = body.creditMinutes ?? existing.creditMinutes;
  const calculatedPayCents = Math.round((creditMinutes / 60) * hourlyRateCents);

  const leg = await db.leg.update({
    where: { id: legId },
    data: {
      ...body,
      creditMinutes,
      calculatedPayCents,
      wasEdited: true,
      editedAt: new Date().toISOString(),
    },
  });

  // Recalculate duty day totals
  await recalculateDutyDay(existing.dutyDayId, hourlyRateCents);

  return c.json({ success: true, leg });
});

// ============================================
// DELETE /api/trips/legs/:id - Delete leg
// ============================================
tripsRouter.delete("/legs/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const legId = c.req.param("id");

  const existing = await db.leg.findFirst({
    where: { id: legId },
    include: { dutyDay: { include: { trip: true } } },
  });

  if (!existing || existing.dutyDay.trip.userId !== user.id) {
    return c.json({ error: "Leg not found" }, 404);
  }

  const dutyDayId = existing.dutyDayId;

  await db.leg.delete({ where: { id: legId } });

  // Get hourly rate and recalculate duty day
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });
  await recalculateDutyDay(dutyDayId, profile?.hourlyRateCents ?? 32500);

  console.log(`✅ [Trips] Deleted leg: ${legId}`);

  return c.json({ success: true });
});

// ============================================
// Helper: Recalculate duty day totals
// ============================================
async function recalculateDutyDay(dutyDayId: string, hourlyRateCents: number) {
  const legs = await db.leg.findMany({
    where: { dutyDayId },
  });

  const totals = calculateDutyDayTotals(
    legs.map((l) => ({
      blockMinutes: l.actualBlockMinutes,
      creditMinutes: l.creditMinutes,
      calculatedPayCents: l.calculatedPayCents,
    })),
    hourlyRateCents
  );

  // Update duty day
  await db.dutyDay.update({
    where: { id: dutyDayId },
    data: {
      actualBlockMinutes: totals.actualBlockMinutes,
      actualCreditMinutes: totals.actualCreditMinutes,
      finalCreditMinutes: totals.finalCreditMinutes,
      totalPayCents: totals.totalPayCents,
      proofCount: legs.filter((l) => l.ooiProofUri).length,
      hasAllActuals: legs.every(
        (l) => l.actualOutISO && l.actualOffISO && l.actualOnISO && l.actualInISO
      ),
      hasPartialActuals: legs.some(
        (l) => l.actualOutISO || l.actualOffISO || l.actualOnISO || l.actualInISO
      ),
    },
  });

  // Recalculate trip totals
  const dutyDay = await db.dutyDay.findUnique({
    where: { id: dutyDayId },
    select: { tripId: true },
  });

  if (dutyDay) {
    await recalculateTrip(dutyDay.tripId);
  }
}

// ============================================
// Helper: Recalculate trip totals
// ============================================
async function recalculateTrip(tripId: string) {
  const dutyDays = await db.dutyDay.findMany({
    where: { tripId },
    include: { legs: true },
  });

  const totalBlockMinutes = dutyDays.reduce((sum, d) => sum + d.actualBlockMinutes, 0);
  const totalCreditMinutes = dutyDays.reduce((sum, d) => sum + d.finalCreditMinutes + (d.premiumCreditMinutes || 0), 0);
  const totalPayCents = dutyDays.reduce((sum, d) => sum + d.totalPayCents + (d.premiumPayCents || 0), 0);
  const legCount = dutyDays.reduce((sum, d) => sum + d.legs.length, 0);

  await db.trip.update({
    where: { id: tripId },
    data: {
      totalBlockMinutes,
      totalCreditMinutes,
      totalPayCents,
      legCount,
    },
  });
}

// ============================================
// Schedule Change Schema
// ============================================
const legEditSchema = z.object({
  id: z.string(),
  legIndex: z.number(),
  flightNumber: z.string(),
  origin: z.string(),
  destination: z.string(),
  isDeadhead: z.boolean(),
  isModified: z.boolean(),
  isNew: z.boolean(),
  isDeleted: z.boolean(),
  originalOrigin: z.string().optional(),
  originalDestination: z.string().optional(),
});

// Log Event data for automatic pay event creation
const logEventSchema = z.object({
  eventType: z.enum([
    'SCHEDULE_CHANGE', 'DUTY_EXTENSION', 'REASSIGNMENT', 'PREMIUM_TRIGGER',
    'PAY_PROTECTION', 'JUNIOR_ASSIGNMENT', 'TRAINING', 'DEADHEAD',
    'RESERVE_ACTIVATION', 'OTHER'
  ]),
  eventDescription: z.string(),
  eventDate: z.string(),
  contactName: z.string().optional(),
  contactMethod: z.enum(['phone', 'acars', 'message', 'other']).optional(),
  contactTime: z.string().optional(),
  additionalNotes: z.string().optional(),
  proofUri: z.string().optional(),
});

const scheduleChangeSchema = z.object({
  reason: z.enum(['reassignment', 'reroute', 'timing_change', 'leg_added', 'leg_removed', 'other']),
  notes: z.string().optional(),
  creditMinutes: z.number().optional(),
  blockMinutes: z.number().optional(),
  premiumCode: z.enum(['JA', 'RA', 'EXT', 'LA']).nullable().optional(),
  premiumCreditMinutes: z.number().optional(),
  isOverride: z.boolean().default(false),
  legEdits: z.array(legEditSchema).optional(),
  logEvent: logEventSchema.optional(),
});

// ============================================
// PUT /api/trips/duty-days/:id/schedule-change
// Record a schedule change or override
// ============================================
tripsRouter.put(
  "/duty-days/:id/schedule-change",
  zValidator("json", scheduleChangeSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const dutyDayId = c.req.param("id");
    const body = c.req.valid("json");

    // First try to find in TripDutyDay (canonical breakdown)
    let tripDutyDay = await db.tripDutyDay.findFirst({
      where: { id: dutyDayId },
      include: { trip: true },
    });

    // Also check regular DutyDay
    const regularDutyDay = await db.dutyDay.findFirst({
      where: { id: dutyDayId },
      include: { trip: true },
    });

    // Verify ownership
    if (tripDutyDay && tripDutyDay.trip.userId !== user.id) {
      return c.json({ error: "Duty day not found" }, 404);
    }
    if (regularDutyDay && regularDutyDay.trip.userId !== user.id) {
      return c.json({ error: "Duty day not found" }, 404);
    }
    if (!tripDutyDay && !regularDutyDay) {
      return c.json({ error: "Duty day not found" }, 404);
    }

    // Get hourly rate for premium pay calculation
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    });
    const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

    // Calculate premium pay in cents
    const premiumCreditMinutes = body.premiumCode ? (body.premiumCreditMinutes ?? 0) : 0;
    const premiumPayCents = Math.round((premiumCreditMinutes / 60) * hourlyRateCents);

    // Prepare update data
    const now = new Date();
    const updateData: Record<string, any> = {
      hasScheduleChange: true,
      scheduleChangeAt: now,
      scheduleChangeReason: body.reason,
      scheduleChangeNotes: body.notes ?? null,
      premiumCode: body.premiumCode ?? null,
      premiumCreditMinutes,
      premiumPayCents,
      premiumAppliedAt: body.premiumCode ? now : null,
    };

    // If this is an override, set those fields
    if (body.isOverride) {
      updateData.hasOverride = true;
      updateData.overrideAt = now;
      updateData.overrideReason = body.reason;
      updateData.overridePersist = true;
    }

    // Update credit/block if provided
    if (body.creditMinutes !== undefined) {
      updateData.creditMinutes = body.creditMinutes;
    }
    if (body.blockMinutes !== undefined) {
      updateData.blockMinutes = body.blockMinutes;
    }

    let updatedDutyDay;
    let tripId: string;

    // Update TripDutyDay if exists
    if (tripDutyDay) {
      updatedDutyDay = await db.tripDutyDay.update({
        where: { id: dutyDayId },
        data: updateData,
      });
      tripId = tripDutyDay.tripId;
    }

    // Also update regular DutyDay if exists
    if (regularDutyDay) {
      // Map fields appropriately for regular duty day
      const regularUpdateData: Record<string, any> = {
        hasScheduleChange: true,
        scheduleChangeAt: now,
        scheduleChangeReason: body.reason,
        scheduleChangeNotes: body.notes ?? null,
        premiumCode: body.premiumCode ?? null,
        premiumCreditMinutes,
        premiumPayCents,
        premiumAppliedAt: body.premiumCode ? now : null,
      };

      if (body.isOverride) {
        regularUpdateData.hasOverride = true;
        regularUpdateData.overrideAt = now;
        regularUpdateData.overrideReason = body.reason;
        regularUpdateData.overridePersist = true;
      }

      if (body.creditMinutes !== undefined) {
        regularUpdateData.finalCreditMinutes = body.creditMinutes;
      }
      if (body.blockMinutes !== undefined) {
        regularUpdateData.actualBlockMinutes = body.blockMinutes;
      }

      await db.dutyDay.update({
        where: { id: dutyDayId },
        data: regularUpdateData,
      });
      tripId = regularDutyDay.tripId;

      // Recalculate trip totals
      await recalculateTrip(tripId);
    }

    // Get legs for detailed logging
    let legsInfo: { flightNumber: string | null; origin: string | null; destination: string | null }[] = [];
    if (tripDutyDay) {
      const legs = await db.tripDutyLeg.findMany({
        where: { tripDutyDayId: dutyDayId },
        orderBy: { legIndex: 'asc' },
        select: { flightNumber: true, origin: true, destination: true },
      });
      legsInfo = legs;
    } else if (regularDutyDay) {
      const legs = await db.leg.findMany({
        where: { dutyDayId },
        orderBy: { legIndex: 'asc' },
        select: { flightNumber: true, origin: true, destination: true },
      });
      legsInfo = legs;
    }

    // Format date for display
    const dutyDate = tripDutyDay?.dutyDate ?? regularDutyDay?.dutyDate;
    const formattedDate = dutyDate
      ? new Date(dutyDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : '';

    // Build detailed title with flight info
    const tripNumber = tripDutyDay?.trip.tripNumber ?? regularDutyDay?.trip.tripNumber ?? '';
    const firstLeg = legsInfo[0];
    const flightInfo = firstLeg?.flightNumber
      ? `FLT ${firstLeg.flightNumber} ${firstLeg.origin ?? ''}–${firstLeg.destination ?? ''}`
      : legsInfo.length > 0
        ? `${firstLeg?.origin ?? '???'}–${legsInfo[legsInfo.length - 1]?.destination ?? '???'}`
        : '';

    // Build description with leg edits if any
    let description = `Reason: ${body.reason}`;
    if (body.legEdits && body.legEdits.length > 0) {
      const routeChanges = body.legEdits
        .filter(leg => leg.isModified && (leg.originalOrigin !== leg.origin || leg.originalDestination !== leg.destination))
        .map(leg => `${leg.originalOrigin}–${leg.originalDestination} → ${leg.origin}–${leg.destination}`)
        .join(', ');
      if (routeChanges) {
        description += `. Route change: ${routeChanges}`;
      }
      const newLegs = body.legEdits.filter(leg => leg.isNew);
      if (newLegs.length > 0) {
        description += `. Added: ${newLegs.map(l => `${l.origin}–${l.destination}`).join(', ')}`;
      }
      const deletedLegs = body.legEdits.filter(leg => leg.isDeleted);
      if (deletedLegs.length > 0) {
        description += `. Removed: ${deletedLegs.map(l => `${l.origin}–${l.destination}`).join(', ')}`;
      }
    }
    if (body.notes) {
      description += `. Notes: ${body.notes}`;
    }

    // Use enhanced log event data if provided
    const logEvent = body.logEvent;
    const finalEventType = logEvent?.eventType ?? (body.isOverride ? 'OTHER' : 'SCHEDULE_CHANGE');
    const finalDescription = logEvent?.eventDescription || description;
    const finalEventDate = logEvent?.eventDate || dutyDate || (now.toISOString().split('T')[0] ?? "");

    // Build enhanced description with contact info
    let fullDescription = finalDescription;
    if (logEvent?.contactName) {
      fullDescription += `\nContact: ${logEvent.contactName}`;
      if (logEvent.contactMethod) {
        fullDescription += ` (${logEvent.contactMethod})`;
      }
      if (logEvent.contactTime) {
        fullDescription += ` at ${logEvent.contactTime}`;
      }
    }
    if (logEvent?.additionalNotes) {
      fullDescription += `\nDetails: ${logEvent.additionalNotes}`;
    }

    // Create a pay event to log the change with detailed flight info
    const eventTitle = body.isOverride
      ? `Override — ${flightInfo || `Trip ${tripNumber}`}${formattedDate ? ` (${formattedDate})` : ''}`
      : `Schedule Change — ${flightInfo || `Trip ${tripNumber}`}${formattedDate ? ` (${formattedDate})` : ''}`;

    const payEvent = await db.payEvent.create({
      data: {
        userId: user.id,
        tripId: tripDutyDay?.tripId ?? regularDutyDay?.tripId ?? '',
        eventType: finalEventType,
        eventDateISO: finalEventDate,
        title: eventTitle,
        description: fullDescription,
        newCreditMinutes: body.creditMinutes ?? null,
        creditDifferenceMinutes: premiumCreditMinutes > 0 ? premiumCreditMinutes : null,
        payDifferenceCents: premiumPayCents > 0 ? premiumPayCents : null,
        status: 'open',
      },
    });

    // Create a PayEventDocument for the proof attachment if provided
    if (logEvent?.proofUri) {
      await db.payEventDocument.create({
        data: {
          payEventId: payEvent.id,
          docType: 'screenshot',
          content: 'Schedule change proof',
          attachmentUrl: logEvent.proofUri,
          contactName: logEvent.contactName ?? null,
          interactionTimeISO: logEvent.contactTime ?? null,
        },
      });
      console.log(`📎 [Trips] Proof attachment added to pay event: ${payEvent.id}`);
    }

    console.log(`✅ [Trips] ${body.isOverride ? 'Override' : 'Schedule change'} applied to duty day: ${dutyDayId}`);
    console.log(`📝 [Trips] Pay event created: ${eventTitle}`);

    return c.json({
      success: true,
      dutyDay: updatedDutyDay ?? regularDutyDay,
      eventType: finalEventType,
    });
  }
);

// ============================================
// PUT /api/trips/trip-duty-legs/:id - Update TripDutyLeg OOOI times
// ============================================
const updateTripDutyLegSchema = z.object({
  actualOutISO: z.string().optional().nullable(),
  actualOffISO: z.string().optional().nullable(),
  actualOnISO: z.string().optional().nullable(),
  actualInISO: z.string().optional().nullable(),
  actualBlockMinutes: z.number().optional(),
  creditMinutes: z.number().optional(),
});

tripsRouter.put(
  "/trip-duty-legs/:id",
  zValidator("json", updateTripDutyLegSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const legId = c.req.param("id");
    const body = c.req.valid("json");

    // Find the TripDutyLeg and verify ownership through trip
    const existing = await db.tripDutyLeg.findFirst({
      where: { id: legId },
      include: {
        tripDutyDay: {
          include: {
            trip: true,
          },
        },
      },
    });

    if (!existing || existing.tripDutyDay.trip.userId !== user.id) {
      return c.json({ error: "Leg not found" }, 404);
    }

    // Update the TripDutyLeg with OOOI times
    const updatedLeg = await db.tripDutyLeg.update({
      where: { id: legId },
      data: {
        actualOutISO: body.actualOutISO,
        actualOffISO: body.actualOffISO,
        actualOnISO: body.actualOnISO,
        actualInISO: body.actualInISO,
        actualBlockMinutes: body.actualBlockMinutes ?? existing.actualBlockMinutes,
        creditMinutes: body.creditMinutes ?? existing.creditMinutes,
      },
    });

    // Recalculate TripDutyDay totals
    const tripDutyDayId = existing.tripDutyDayId;
    const allLegs = await db.tripDutyLeg.findMany({
      where: { tripDutyDayId },
    });

    const totalBlock = allLegs.reduce((sum, l) => sum + l.actualBlockMinutes, 0);
    const totalCredit = allLegs.reduce((sum, l) => sum + l.creditMinutes, 0);

    await db.tripDutyDay.update({
      where: { id: tripDutyDayId },
      data: {
        blockMinutes: totalBlock > 0 ? totalBlock : undefined,
        creditMinutes: totalCredit > 0 ? totalCredit : undefined,
      },
    });

    // Also update trip totals
    const tripId = existing.tripDutyDay.tripId;
    const allTripDutyDays = await db.tripDutyDay.findMany({
      where: { tripId },
      include: { legs: true },
    });

    const tripTotalBlock = allTripDutyDays.reduce((sum, d) => sum + d.blockMinutes, 0);
    const tripTotalCredit = allTripDutyDays.reduce(
      (sum, d) => sum + d.creditMinutes + (d.premiumCreditMinutes || 0),
      0
    );

    await db.trip.update({
      where: { id: tripId },
      data: {
        totalBlockMinutes: tripTotalBlock,
        totalCreditMinutes: tripTotalCredit,
      },
    });

    console.log(`✅ [Trips] Updated TripDutyLeg OOOI: ${legId}`);

    return c.json({ success: true, leg: updatedLeg });
  }
);

// ============================================
// POST /api/trips/:id/acknowledge - Phase 6: Acknowledge roster change
// Required for Moderate/Major changes before update can be applied
// ============================================
tripsRouter.post("/:id/acknowledge", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");

  // Find the trip
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  // Check if acknowledgment is even required
  if (!trip.acknowledgmentRequired) {
    return c.json({
      success: true,
      message: "No acknowledgment required for this trip",
      trip,
    });
  }

  // Check if already acknowledged
  if (trip.acknowledgedAt) {
    return c.json({
      success: true,
      message: "Trip already acknowledged",
      acknowledgedAt: trip.acknowledgedAt,
      trip,
    });
  }

  // Perform acknowledgment
  const now = new Date();

  const updatedTrip = await db.trip.update({
    where: { id: tripId },
    data: {
      acknowledgedAt: now,
      acknowledgmentRequired: false, // Clear the flag after ack
      hasChangePending: false, // Clear pending flag
      needsReview: false, // Clear review flag
    },
    include: {
      dutyDays: {
        include: { legs: { orderBy: { legIndex: "asc" } } },
        orderBy: { dutyDate: "asc" },
      },
      events: {
        orderBy: [{ sortOrder: "asc" }, { startTimeLocal: "asc" }],
      },
    },
  });

  // Create audit record for the acknowledgment
  try {
    await db.auditRecord.create({
      data: {
        userId: user.id,
        recordType: "roster_acknowledged",
        tripId,
        title: "Roster Change Acknowledged",
        summary: `Acknowledged roster change for trip ${trip.tripNumber || tripId}. Severity: ${trip.changeSeverity}`,
        severity: trip.changeSeverity || "none",
        creditContext: JSON.stringify({
          protected: trip.protectedCreditMinutes,
          current: trip.currentCreditMinutes,
          pay: trip.payCreditMinutes,
          delta: (trip.currentCreditMinutes ?? 0) - (trip.protectedCreditMinutes ?? 0),
        }),
      },
    });
    console.log(`📝 [Trips] Created audit record for acknowledgment: ${tripId}`);
  } catch (auditError) {
    // Don't fail the acknowledgment if audit record creation fails
    console.error(`⚠️ [Trips] Failed to create audit record:`, auditError);
  }

  console.log(`✅ [Trips] Acknowledged roster change for trip: ${tripId}`);

  return c.json({
    success: true,
    acknowledgedAt: now.toISOString(),
    trip: updatedTrip,
    auditRecordCreated: true,
  });
});

// ============================================
// POST /api/trips/:id/mark-reviewed - Clear needsReview flag without full acknowledgment
// Used when user views a trip that needsReview but acknowledgmentRequired is false
// ============================================
tripsRouter.post("/:id/mark-reviewed", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");

  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  if (!trip.needsReview) {
    return c.json({ success: true, message: "Trip does not need review" });
  }

  await db.trip.update({
    where: { id: tripId },
    data: { needsReview: false },
  });

  return c.json({ success: true, message: "Trip marked as reviewed" });
});

// ============================================
// POST /api/trips/recalculate-pay - Fix trips with $0 pay (missing hourly rate during import)
// ============================================
tripsRouter.post("/recalculate-pay", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const profile = await db.profile.findUnique({ where: { userId: user.id } });
  const hourlyRateCents = profile?.hourlyRateCents ?? 0;
  if (!hourlyRateCents) {
    return c.json({ error: "No hourly rate set in profile" }, 400);
  }

  // Find all canonical trips for this user with zero pay but non-zero credit
  const trips = await db.trip.findMany({
    where: { userId: user.id, totalPayCents: 0, totalCreditMinutes: { gt: 0 } },
    select: { id: true, totalCreditMinutes: true, tripNumber: true },
  });

  let updated = 0;
  for (const trip of trips) {
    const payCents = Math.round((trip.totalCreditMinutes / 60) * hourlyRateCents);
    await db.trip.update({
      where: { id: trip.id },
      data: {
        totalPayCents: payCents,
        payCreditMinutes: trip.totalCreditMinutes,
      },
    });
    updated++;
  }

  console.log(`[Trips] Recalculated pay for ${updated} trips at $${(hourlyRateCents / 100).toFixed(2)}/hr`);
  return c.json({ success: true, updated, hourlyRateCents });
});

// ============================================
const updateLegPremiumSchema = z.object({
  premiumCode: z.string(),
  premiumMinutes: z.number(),
  premiumAmountCents: z.number(),
  notes: z.string().optional(),
});

tripsRouter.put(
  "/trip-duty-legs/:id/premium",
  zValidator("json", updateLegPremiumSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const legId = c.req.param("id");
    const body = c.req.valid("json");

    // Find the TripDutyLeg and verify ownership through trip
    const existing = await db.tripDutyLeg.findFirst({
      where: { id: legId },
      include: {
        tripDutyDay: {
          include: {
            trip: true,
          },
        },
      },
    });

    if (!existing || existing.tripDutyDay.trip.userId !== user.id) {
      return c.json({ error: "Leg not found" }, 404);
    }

    // Update the TripDutyLeg with premium data
    const updatedLeg = await db.tripDutyLeg.update({
      where: { id: legId },
      data: {
        premiumCode: body.premiumCode,
        premiumAmountCents: body.premiumAmountCents,
      },
    });

    // Recalculate TripDutyDay totals including premiums
    const tripDutyDayId = existing.tripDutyDayId;
    const allLegs = await db.tripDutyLeg.findMany({
      where: { tripDutyDayId },
    });

    const totalPremiumCents = allLegs.reduce((sum, l) => sum + (l.premiumAmountCents || 0), 0);

    // Get hourly rate
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    });
    const hourlyRateCents = profile?.hourlyRateCents ?? 32500;
    const premiumPayCents = Math.round((body.premiumMinutes / 60) * hourlyRateCents);

    await db.tripDutyDay.update({
      where: { id: tripDutyDayId },
      data: {
        premiumCode: body.premiumCode,
        premiumCreditMinutes: body.premiumMinutes,
        premiumPayCents,
        premiumAppliedAt: new Date(),
      },
    });

    // Also update trip totals
    const tripId = existing.tripDutyDay.tripId;
    const allTripDutyDays = await db.tripDutyDay.findMany({
      where: { tripId },
    });

    const tripTotalPremiumMinutes = allTripDutyDays.reduce(
      (sum, d) => sum + (d.premiumCreditMinutes || 0),
      0
    );

    // Get current totals and add premium
    const currentTrip = await db.trip.findUnique({
      where: { id: tripId },
    });

    await db.trip.update({
      where: { id: tripId },
      data: {
        totalCreditMinutes: (currentTrip?.totalCreditMinutes ?? 0) + body.premiumMinutes,
        totalPayCents: (currentTrip?.totalPayCents ?? 0) + premiumPayCents,
      },
    });

    console.log(`✅ [Trips] Updated TripDutyLeg premium: ${legId} with code ${body.premiumCode}, ${body.premiumMinutes} mins`);

    return c.json({ success: true, leg: updatedLeg });
  }
);

// ============================================
// POST /api/trips/fix-leg-credit-minutes - Fix existing legs with creditMinutes = 0
// This copies plannedCreditMinutes to creditMinutes where creditMinutes is 0
// ============================================
tripsRouter.post("/fix-leg-credit-minutes", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    // Find all TripDutyLegs for this user where creditMinutes is 0 but plannedCreditMinutes is > 0
    const legsToFix = await db.tripDutyLeg.findMany({
      where: {
        creditMinutes: 0,
        plannedCreditMinutes: { gt: 0 },
        tripDutyDay: {
          trip: {
            userId: user.id,
          },
        },
      },
      select: {
        id: true,
        plannedCreditMinutes: true,
      },
    });

    console.log(`🔧 [Trips] Found ${legsToFix.length} legs to fix for user ${user.id}`);

    // Update each leg
    let fixedCount = 0;
    for (const leg of legsToFix) {
      await db.tripDutyLeg.update({
        where: { id: leg.id },
        data: { creditMinutes: leg.plannedCreditMinutes },
      });
      fixedCount++;
    }

    // Also fix regular Legs (dutyDays.legs)
    const regularLegsToFix = await db.leg.findMany({
      where: {
        creditMinutes: 0,
        plannedCreditMinutes: { gt: 0 },
        dutyDay: {
          trip: {
            userId: user.id,
          },
        },
      },
      select: {
        id: true,
        plannedCreditMinutes: true,
      },
    });

    console.log(`🔧 [Trips] Found ${regularLegsToFix.length} regular legs to fix for user ${user.id}`);

    for (const leg of regularLegsToFix) {
      await db.leg.update({
        where: { id: leg.id },
        data: { creditMinutes: leg.plannedCreditMinutes },
      });
      fixedCount++;
    }

    // Recalculate TripDutyDay totals for affected trips
    const affectedTripDutyDays = await db.tripDutyDay.findMany({
      where: {
        trip: {
          userId: user.id,
        },
      },
      include: {
        legs: true,
      },
    });

    let dutyDaysUpdated = 0;
    for (const tdd of affectedTripDutyDays) {
      const totalBlock = tdd.legs.reduce((sum, l) => sum + (l.actualBlockMinutes || l.plannedBlockMinutes), 0);
      const totalCredit = tdd.legs.reduce((sum, l) => {
        const credit = l.creditMinutes > 0 ? l.creditMinutes : l.plannedCreditMinutes;
        return sum + credit;
      }, 0);

      if (totalBlock !== tdd.blockMinutes || totalCredit !== tdd.creditMinutes) {
        await db.tripDutyDay.update({
          where: { id: tdd.id },
          data: {
            blockMinutes: totalBlock,
            creditMinutes: totalCredit,
          },
        });
        dutyDaysUpdated++;
      }
    }

    console.log(`✅ [Trips] Fixed ${fixedCount} legs and updated ${dutyDaysUpdated} duty days for user ${user.id}`);

    return c.json({
      success: true,
      fixedLegs: legsToFix.length + regularLegsToFix.length,
      dutyDaysUpdated,
    });
  } catch (error) {
    console.error("Failed to fix leg credit minutes:", error);
    return c.json({ error: "Failed to fix leg credit minutes" }, 500);
  }
});

// ============================================
// POST /api/trips/:id/recompute-block - Recompute trip block totals from leg data
// Use this to fix trips where block times were incorrectly computed
// ============================================
tripsRouter.post("/:id/recompute-block", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");

  try {
    // Find the trip and verify ownership
    const trip = await db.trip.findFirst({
      where: { id: tripId, userId: user.id },
      include: {
        tripDutyDays: {
          include: {
            legs: true,
          },
          orderBy: { dutyDayIndex: "asc" },
        },
        dutyDays: {
          include: {
            legs: true,
          },
          orderBy: { dutyDate: "asc" },
        },
      },
    });

    if (!trip) {
      return c.json({ error: "Trip not found" }, 404);
    }

    console.log(`🔧 [Trips] Recomputing block totals for trip ${trip.tripNumber || tripId}`);

    const changes: Array<{ type: string; id: string; oldValue: number; newValue: number }> = [];

    // Recompute TripDutyDay totals from legs
    for (const tdd of trip.tripDutyDays) {
      const legBlockSum = tdd.legs.reduce((sum, leg) => {
        // Use plannedBlockMinutes as the authoritative source
        return sum + leg.plannedBlockMinutes;
      }, 0);

      if (legBlockSum !== tdd.blockMinutes) {
        console.log(`  Day ${tdd.dutyDayIndex}: old=${tdd.blockMinutes}min, new=${legBlockSum}min`);
        changes.push({
          type: "TripDutyDay",
          id: tdd.id,
          oldValue: tdd.blockMinutes,
          newValue: legBlockSum,
        });

        await db.tripDutyDay.update({
          where: { id: tdd.id },
          data: { blockMinutes: legBlockSum },
        });
      }
    }

    // Recompute regular DutyDay totals from legs
    for (const dd of trip.dutyDays) {
      const legBlockSum = dd.legs.reduce((sum, leg) => {
        // Use plannedBlockMinutes or actualBlockMinutes
        return sum + (leg.actualBlockMinutes || leg.plannedBlockMinutes);
      }, 0);

      if (legBlockSum !== dd.actualBlockMinutes) {
        console.log(`  DutyDay ${dd.dutyDate}: old=${dd.actualBlockMinutes}min, new=${legBlockSum}min`);
        changes.push({
          type: "DutyDay",
          id: dd.id,
          oldValue: dd.actualBlockMinutes,
          newValue: legBlockSum,
        });

        await db.dutyDay.update({
          where: { id: dd.id },
          data: { actualBlockMinutes: legBlockSum },
        });
      }
    }

    // Recompute trip totals
    const tripDutyDayBlockSum = trip.tripDutyDays.reduce((sum, tdd) => {
      // Use the updated block minutes from legs
      return sum + tdd.legs.reduce((s, l) => s + l.plannedBlockMinutes, 0);
    }, 0);

    const dutyDayBlockSum = trip.dutyDays.reduce((sum, dd) => {
      return sum + dd.legs.reduce((s, l) => s + (l.actualBlockMinutes || l.plannedBlockMinutes), 0);
    }, 0);

    // Use the larger of the two (in case one is 0)
    const newTripBlockMinutes = Math.max(tripDutyDayBlockSum, dutyDayBlockSum);

    if (newTripBlockMinutes !== trip.totalBlockMinutes) {
      console.log(`  Trip total: old=${trip.totalBlockMinutes}min, new=${newTripBlockMinutes}min`);
      changes.push({
        type: "Trip",
        id: trip.id,
        oldValue: trip.totalBlockMinutes,
        newValue: newTripBlockMinutes,
      });

      await db.trip.update({
        where: { id: trip.id },
        data: { totalBlockMinutes: newTripBlockMinutes },
      });
    }

    console.log(`✅ [Trips] Recomputed block totals: ${changes.length} changes made`);

    return c.json({
      success: true,
      tripId,
      tripNumber: trip.tripNumber,
      changes,
      summary: {
        oldTotalBlockMinutes: trip.totalBlockMinutes,
        newTotalBlockMinutes: newTripBlockMinutes,
      },
    });
  } catch (error) {
    console.error("Failed to recompute block totals:", error);
    return c.json({ error: "Failed to recompute block totals", details: String(error) }, 500);
  }
});

// ============================================
// GET /api/trips/:id/leg-debug - Debug endpoint to inspect leg block times
// ============================================
tripsRouter.get("/:id/leg-debug", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("id");

  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
    include: {
      tripDutyDays: {
        include: {
          legs: { orderBy: { legIndex: "asc" } },
        },
        orderBy: { dutyDayIndex: "asc" },
      },
    },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  // Format output for debugging
  const debug = {
    tripId: trip.id,
    tripNumber: trip.tripNumber,
    totalBlockMinutes: trip.totalBlockMinutes,
    dutyDays: trip.tripDutyDays.map((tdd) => ({
      index: tdd.dutyDayIndex,
      date: tdd.dutyDate,
      blockMinutes: tdd.blockMinutes,
      legs: tdd.legs.map((leg) => ({
        flightNumber: leg.flightNumber,
        route: `${leg.origin}-${leg.destination}`,
        depTime: leg.scheduledOutISO,
        arrTime: leg.scheduledInISO,
        plannedBlockMinutes: leg.plannedBlockMinutes,
        actualBlockMinutes: leg.actualBlockMinutes,
        creditMinutes: leg.creditMinutes,
        isDeadhead: leg.isDeadhead,
      })),
      legsBlockSum: tdd.legs.reduce((sum, l) => sum + l.plannedBlockMinutes, 0),
    })),
    calculatedTripBlock: trip.tripDutyDays.reduce(
      (sum, tdd) => sum + tdd.legs.reduce((s, l) => s + l.plannedBlockMinutes, 0),
      0
    ),
  };

  return c.json(debug);
});

// ============================================
// POST /api/trips/debug-parse - Debug OCR parsing
// ============================================
// Accepts raw OCR text and returns detailed parsing results
// without creating any database records
tripsRouter.post("/debug-parse", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  const { ocrText } = body as { ocrText: string };

  if (!ocrText) {
    return c.json({ error: "ocrText is required" }, 400);
  }

  console.log(`🔍 [DebugParse] Parsing OCR text (${ocrText.length} chars)...`);

  // Import the parser dynamically to avoid circular dependencies
  const { parseScheduleFromOCRText, detectTemplate, parseCrewAccessTripInfo } = await import("../lib/robust-schedule-parser");
  const { formatMinutesAsDuration } = await import("../lib/airport-timezones");

  // Step 1: Detect template
  const templateDetection = detectTemplate(ocrText);

  // Step 2: Parse using robust parser
  const parseResult = parseScheduleFromOCRText(ocrText);

  // Step 3: If Crew Access, get detailed breakdown
  let crewAccessDebug = null;
  if (templateDetection.templateType === "crew_access_trip_info") {
    const caResult = parseCrewAccessTripInfo(ocrText);
    crewAccessDebug = {
      tripId: caResult.tripId,
      tripStartDate: caResult.tripStartDate,
      tripStartDateSource: caResult.tripStartDateSource,
      base: caResult.base,
      totalDutyDays: caResult.dutyDays.length,
      dutyDays: caResult.dutyDays.map((dd) => ({
        dayIndex: dd.dutyDayIndex,
        dayLabel: dd.dayLabel,
        calendarDate: dd.calendarDate,
        legsCount: dd.legs.length,
        dayBlockMinutes: dd.dayBlockMinutes,
        dayBlockFormatted: formatMinutesAsDuration(dd.dayBlockMinutes),
        legs: dd.legs.map((leg) => ({
          seq: leg.legSeq,
          flight: leg.flightNumber ?? "DH",
          route: `${leg.depAirport}-${leg.arrAirport}`,
          depLocal: leg.depLocalTime,
          arrLocal: leg.arrLocalTime,
          blockMinutes: leg.blockMinutes,
          blockFormatted: formatMinutesAsDuration(leg.blockMinutes),
          blockSource: leg.blockSource,
          isDeadhead: leg.dhFlag,
          needsReview: leg.needsReview,
          warnings: leg.warnings,
        })),
        layover: dd.layoverToNextDay
          ? {
              station: dd.layoverToNextDay.layoverStation,
              hotelName: dd.layoverToNextDay.hotelName,
              restMinutes: dd.layoverToNextDay.restMinutes,
            }
          : null,
      })),
      totals: {
        blockMinutes: caResult.totals.blockMinutes,
        blockFormatted: formatMinutesAsDuration(caResult.totals.blockMinutes),
        creditMinutes: caResult.totals.creditMinutes,
        creditFormatted: formatMinutesAsDuration(caResult.totals.creditMinutes),
        tafbMinutes: caResult.totals.tafbMinutes,
        tafbFormatted: formatMinutesAsDuration(caResult.totals.tafbMinutes),
      },
      computedBlockFromLegs: caResult.dutyDays.reduce((sum, dd) => sum + dd.dayBlockMinutes, 0),
      computedBlockFormatted: formatMinutesAsDuration(
        caResult.dutyDays.reduce((sum, dd) => sum + dd.dayBlockMinutes, 0)
      ),
      warnings: caResult.warnings,
    };
  }

  const response = {
    templateDetection: {
      type: templateDetection.templateType,
      confidence: templateDetection.confidence,
      keywords: templateDetection.matchedKeywords,
      warnings: templateDetection.warnings,
    },
    parseResult: parseResult.trip
      ? {
          tripId: parseResult.trip.tripId,
          tripStartDate: parseResult.trip.tripStartDate,
          tripEndDate: parseResult.trip.tripEndDate,
          tripDaysCount: parseResult.trip.tripDaysCount,
          dutyDaysCount: parseResult.trip.dutyDays.length,
          totalBlockMinutes: parseResult.trip.totals.blockMinutes,
          totalBlockFormatted: formatMinutesAsDuration(parseResult.trip.totals.blockMinutes),
          totalCreditMinutes: parseResult.trip.totals.creditMinutes,
          totalCreditFormatted: formatMinutesAsDuration(parseResult.trip.totals.creditMinutes),
          needsReview: parseResult.trip.needsReview,
          validationErrors: parseResult.validation.errors,
          validationWarnings: parseResult.validation.warnings,
        }
      : null,
    crewAccessDebug,
    ocrTextLength: ocrText.length,
    ocrTextPreview: ocrText.substring(0, 500) + (ocrText.length > 500 ? "..." : ""),
  };

  console.log(`🔍 [DebugParse] Result: ${JSON.stringify(response, null, 2)}`);

  return c.json(response);
});

export { tripsRouter };
