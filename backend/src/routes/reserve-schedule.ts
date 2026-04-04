import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Context } from "hono";
import { type AppType } from "../types";
import { db } from "../db";

// ============================================
// Local Constants (avoid ESM import issues from contracts.ts)
// ============================================

// Schedule Types
const reserveScheduleTypeValues = ["RSVA", "RSVB", "RSVC", "RSVD", "HOT", "LCO", "RCID", "TRNG"] as const;
type ReserveScheduleType = (typeof reserveScheduleTypeValues)[number];

// RSV types specifically (for credit lock rules)
const rsvScheduleTypeValues = ["RSVA", "RSVB", "RSVC", "RSVD"] as const;

// Activation status
const activationStatusValues = ["UNACTIVATED", "PARTIAL", "ACTIVATED"] as const;

// Domicile values
const domicileValues = ["SDF", "MIA", "ONT", "ANC"] as const;

// Report-for-duty rules (in minutes)
const REPORT_FOR_DUTY_MINUTES = {
  RSV_SDF: 90,        // 1.5 hours for SDF reserve
  RSV_OTHER: 120,     // 2 hours for non-SDF reserve
  LCO: 960,           // 16 hours for long call out
} as const;

// Reserve Window Configuration type
interface ReserveWindowConfig {
  domicile: string;
  scheduleType: string;
  windowStart: string;
  windowEnd: string;
}

// Domicile-specific reserve windows (EXACT from spec)
const RESERVE_WINDOW_CONFIGS: ReserveWindowConfig[] = [
  // SDF
  { domicile: "SDF", scheduleType: "RSVA", windowStart: "2400", windowEnd: "1159" },
  { domicile: "SDF", scheduleType: "RSVB", windowStart: "1200", windowEnd: "2359" },
  { domicile: "SDF", scheduleType: "RSVC", windowStart: "1600", windowEnd: "0359" },
  { domicile: "SDF", scheduleType: "RSVD", windowStart: "0400", windowEnd: "1559" },
  // MIA (same as SDF)
  { domicile: "MIA", scheduleType: "RSVA", windowStart: "2400", windowEnd: "1159" },
  { domicile: "MIA", scheduleType: "RSVB", windowStart: "1200", windowEnd: "2359" },
  { domicile: "MIA", scheduleType: "RSVC", windowStart: "1600", windowEnd: "0359" },
  { domicile: "MIA", scheduleType: "RSVD", windowStart: "0400", windowEnd: "1559" },
  // ONT
  { domicile: "ONT", scheduleType: "RSVA", windowStart: "2300", windowEnd: "1059" },
  { domicile: "ONT", scheduleType: "RSVB", windowStart: "1200", windowEnd: "2359" },
  { domicile: "ONT", scheduleType: "RSVC", windowStart: "1559", windowEnd: "0358" },
  { domicile: "ONT", scheduleType: "RSVD", windowStart: "0400", windowEnd: "1559" },
  // ANC
  { domicile: "ANC", scheduleType: "RSVA", windowStart: "0730", windowEnd: "1929" },
  { domicile: "ANC", scheduleType: "RSVB", windowStart: "0300", windowEnd: "1459" },
  { domicile: "ANC", scheduleType: "RSVC", windowStart: "2015", windowEnd: "0814" },
  { domicile: "ANC", scheduleType: "RSVD", windowStart: "1545", windowEnd: "0344" },
];

const reserveScheduleRouter = new Hono<AppType>();

// ============================================
// Local Helper Functions (avoid ESM import issues)
// ============================================

/**
 * Get report-for-duty minutes for RSV/LCO schedule types
 */
function getReportForDutyMinutes(scheduleType: ReserveScheduleType, domicile: string): number | null {
  if (["RSVA", "RSVB", "RSVC", "RSVD"].includes(scheduleType)) {
    return domicile === "SDF" ? REPORT_FOR_DUTY_MINUTES.RSV_SDF : REPORT_FOR_DUTY_MINUTES.RSV_OTHER;
  }
  if (scheduleType === "LCO") {
    return REPORT_FOR_DUTY_MINUTES.LCO;
  }
  // HOT, RCID, TRNG - null unless explicitly defined
  return null;
}

/**
 * Check if schedule type should have credit locked
 */
function shouldCreditBeLocked(scheduleType: ReserveScheduleType): boolean {
  // RSV*, HOT, LCO, RCID all have credit locked
  return ["RSVA", "RSVB", "RSVC", "RSVD", "HOT", "LCO", "RCID"].includes(scheduleType);
}

// ============================================
// Validation Schemas
// ============================================

const createReserveScheduleSchema = z.object({
  scheduleType: z.enum(reserveScheduleTypeValues),
  domicile: z.string(),
  startDtLocal: z.string(),
  endDtLocal: z.string(),
  creditHours: z.number(),
  notes: z.string().optional(),
  sourceUploadId: z.string().optional(),
});

const updateReserveScheduleSchema = z.object({
  domicile: z.string().optional(),
  startDtLocal: z.string().optional(),
  endDtLocal: z.string().optional(),
  creditHours: z.number().optional(),
  notes: z.string().optional(),
});

const activateLegSchema = z.object({
  flightNumber: z.string().optional(),
  origin: z.string(),
  destination: z.string(),
  depDtLocal: z.string(),
  arrDtLocal: z.string(),
  blockMinutes: z.number().optional(),
  equipment: z.string().optional(),
  tailNumber: z.string().optional(),
  isDeadhead: z.boolean().optional(),
  actualOutISO: z.string().optional(),
  actualOffISO: z.string().optional(),
  actualOnISO: z.string().optional(),
  actualInISO: z.string().optional(),
});

const activateReserveScheduleSchema = z.object({
  legs: z.array(activateLegSchema),
  sourceUploadId: z.string().optional(),
});

const matchLegSchema = z.object({
  flightNumber: z.string().optional(),
  origin: z.string(),
  destination: z.string(),
  depDtLocal: z.string(),
  arrDtLocal: z.string(),
  blockMinutes: z.number().optional(),
  equipment: z.string().optional(),
});

const matchActivationSchema = z.object({
  legs: z.array(matchLegSchema),
  sourceUploadId: z.string().optional(),
});

const listQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  scheduleType: z.enum(reserveScheduleTypeValues).optional(),
  activationStatus: z.enum(activationStatusValues).optional(),
  includeLegs: z.string().optional(), // "true" or "false"
});

type ActivateLeg = z.infer<typeof activateLegSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * Get reserve window configuration for a domicile and schedule type
 */
function getReserveWindowConfig(
  domicile: string,
  scheduleType: string
): { windowStart: string; windowEnd: string } | null {
  const config = RESERVE_WINDOW_CONFIGS.find(
    (c: { domicile: string; scheduleType: string }) =>
      c.domicile === domicile && c.scheduleType === scheduleType
  );
  return config ? { windowStart: config.windowStart, windowEnd: config.windowEnd } : null;
}

/**
 * Audit a blocked credit modification attempt
 */
async function auditCreditLockViolation(
  userId: string,
  reserveScheduleEventId: string,
  attemptedCreditHours: number,
  originalCreditHours: number,
  reason: string
): Promise<void> {
  await db.creditLockAuditLog.create({
    data: {
      userId,
      reserveScheduleEventId,
      attemptedCreditHours,
      originalCreditHours,
      actionTaken: "BLOCKED",
      reason,
    },
  });
}

// ============================================
// GET /api/reserve-schedule - List reserve schedule events
// ============================================
reserveScheduleRouter.get("/", zValidator("query", listQuerySchema), async (c: Context<AppType>) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const query = c.req.valid("query" as never) as z.infer<typeof listQuerySchema>;
  const { startDate, endDate, scheduleType, activationStatus, includeLegs } = query;

  const where: {
    userId: string;
    startDtLocal?: { gte: string };
    endDtLocal?: { lte: string };
    scheduleType?: string;
    activationStatus?: string;
  } = { userId: user.id };

  if (startDate) {
    where.startDtLocal = { gte: startDate };
  }
  if (endDate) {
    where.endDtLocal = { lte: endDate };
  }
  if (scheduleType) {
    where.scheduleType = scheduleType;
  }
  if (activationStatus) {
    where.activationStatus = activationStatus;
  }

  const events = await db.reserveScheduleEvent.findMany({
    where,
    include: {
      activationLegs: includeLegs === "true" ? { orderBy: { legIndex: "asc" } } : false,
    },
    orderBy: { startDtLocal: "asc" },
  });

  return c.json({
    events,
    totalCount: events.length,
  });
});

// ============================================
// GET /api/reserve-schedule/window-configs - Get all reserve window configurations
// ============================================
reserveScheduleRouter.get("/window-configs", async (c: Context<AppType>) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Return the static configs from contracts
  return c.json({ configs: RESERVE_WINDOW_CONFIGS });
});

// ============================================
// GET /api/reserve-schedule/audit-log - Get credit lock audit log
// ============================================
reserveScheduleRouter.get("/audit-log", async (c: Context<AppType>) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const logs = await db.creditLockAuditLog.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return c.json({ logs, totalCount: logs.length });
});

// ============================================
// POST /api/reserve-schedule/seed-configs - Seed reserve window configs to DB
// ============================================
reserveScheduleRouter.post("/seed-configs", async (c: Context<AppType>) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Seed the reserve window configs to the database
  const seeded = [];
  for (const config of RESERVE_WINDOW_CONFIGS) {
    const existing = await db.reserveWindowConfig.findFirst({
      where: {
        domicile: config.domicile,
        scheduleType: config.scheduleType,
      },
    });

    if (!existing) {
      const created = await db.reserveWindowConfig.create({
        data: {
          domicile: config.domicile,
          scheduleType: config.scheduleType,
          windowStart: config.windowStart,
          windowEnd: config.windowEnd,
          isActive: true,
        },
      });
      seeded.push(created);
    }
  }

  return c.json({ success: true, seededCount: seeded.length, configs: seeded });
});

// ============================================
// POST /api/reserve-schedule/seed-test-data - Seed test RSV/LCO/HOT/RCID data
// FOR TESTING ONLY - Creates sample reserve schedule events
// ============================================
reserveScheduleRouter.post("/seed-test-data", async (c: Context<AppType>) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Get the current date for realistic test data
  const today = new Date();
  const formatDate = (d: Date) => d.toISOString().split("T")[0];

  // Helper to add days to a date
  const addDays = (date: Date, days: number): Date => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  // Test data scenarios
  const testEvents = [
    // 1. RSVA at SDF (credit locked) - Tomorrow
    {
      scheduleType: "RSVA" as const,
      domicile: "SDF",
      startDtLocal: `${formatDate(addDays(today, 1))}T00:00:00`,
      endDtLocal: `${formatDate(addDays(today, 1))}T11:59:00`,
      creditHours: 4.5,
      notes: "Test RSVA - SDF domicile, credit locked",
    },
    // 2. RSVB at SDF (credit locked) - Day after tomorrow
    {
      scheduleType: "RSVB" as const,
      domicile: "SDF",
      startDtLocal: `${formatDate(addDays(today, 2))}T12:00:00`,
      endDtLocal: `${formatDate(addDays(today, 2))}T23:59:00`,
      creditHours: 5.0,
      notes: "Test RSVB - SDF domicile, credit locked",
    },
    // 3. RSVA at ONT (non-SDF, different report-for-duty) - In 3 days
    {
      scheduleType: "RSVA" as const,
      domicile: "ONT",
      startDtLocal: `${formatDate(addDays(today, 3))}T23:00:00`,
      endDtLocal: `${formatDate(addDays(today, 4))}T10:59:00`,
      creditHours: 4.0,
      notes: "Test RSVA - ONT domicile (non-SDF), 2hr report-for-duty",
    },
    // 4. RSVB at ANC (another non-SDF) - In 4 days
    {
      scheduleType: "RSVB" as const,
      domicile: "ANC",
      startDtLocal: `${formatDate(addDays(today, 4))}T03:00:00`,
      endDtLocal: `${formatDate(addDays(today, 4))}T14:59:00`,
      creditHours: 4.5,
      notes: "Test RSVB - ANC domicile, credit locked",
    },
    // 5. HOT (Airport Standby) at SDF - In 5 days
    {
      scheduleType: "HOT" as const,
      domicile: "SDF",
      startDtLocal: `${formatDate(addDays(today, 5))}T06:00:00`,
      endDtLocal: `${formatDate(addDays(today, 5))}T18:00:00`,
      creditHours: 5.0,
      notes: "Test HOT - Airport Standby at SDF",
    },
    // 6. LCO (Long Call Out) at MIA - In 6 days
    {
      scheduleType: "LCO" as const,
      domicile: "MIA",
      startDtLocal: `${formatDate(addDays(today, 6))}T00:00:00`,
      endDtLocal: `${formatDate(addDays(today, 6))}T23:59:00`,
      creditHours: 4.0,
      notes: "Test LCO - Long Call Out at MIA (16hr report-for-duty)",
    },
    // 7. RCID at SDF - In 7 days
    {
      scheduleType: "RCID" as const,
      domicile: "SDF",
      startDtLocal: `${formatDate(addDays(today, 7))}T08:00:00`,
      endDtLocal: `${formatDate(addDays(today, 7))}T17:00:00`,
      creditHours: 4.0,
      notes: "Test RCID at SDF",
    },
    // 8. RSVC at SDF (overlapping date for matching test) - In 2 days (same as #2)
    {
      scheduleType: "RSVC" as const,
      domicile: "SDF",
      startDtLocal: `${formatDate(addDays(today, 2))}T16:00:00`,
      endDtLocal: `${formatDate(addDays(today, 3))}T03:59:00`,
      creditHours: 4.5,
      notes: "Test RSVC - Overlapping date with RSVB for matching rules test",
    },
  ];

  const created = [];
  const skipped = [];

  for (const eventData of testEvents) {
    // Check if similar event already exists
    const existing = await db.reserveScheduleEvent.findFirst({
      where: {
        userId: user.id,
        scheduleType: eventData.scheduleType,
        startDtLocal: eventData.startDtLocal,
      },
    });

    if (existing) {
      skipped.push({
        scheduleType: eventData.scheduleType,
        startDtLocal: eventData.startDtLocal,
        reason: "Already exists",
      });
      continue;
    }

    // Get reserve window config if RSV type
    const windowConfig = getReserveWindowConfig(eventData.domicile, eventData.scheduleType);

    // Calculate report-for-duty minutes
    const reportForDutyMinutes = getReportForDutyMinutes(
      eventData.scheduleType as ReserveScheduleType,
      eventData.domicile
    );

    // Determine if credit should be locked
    const creditLocked = shouldCreditBeLocked(eventData.scheduleType as ReserveScheduleType);

    const event = await db.reserveScheduleEvent.create({
      data: {
        userId: user.id,
        scheduleType: eventData.scheduleType,
        domicile: eventData.domicile,
        startDtLocal: eventData.startDtLocal,
        endDtLocal: eventData.endDtLocal,
        windowStartLocal: windowConfig?.windowStart || null,
        windowEndLocal: windowConfig?.windowEnd || null,
        reportForDutyMinutes,
        creditHours: eventData.creditHours,
        blockHours: 0,
        creditLocked,
        activationStatus: "UNACTIVATED",
        notes: eventData.notes,
      },
    });

    // Create log event for creation
    await db.reserveLogEvent.create({
      data: {
        userId: user.id,
        reserveScheduleEventId: event.id,
        eventType: "created",
        autoGeneratedNotes: `[TEST SEED] Created ${eventData.scheduleType} event at ${eventData.domicile} with ${eventData.creditHours} credit hours. Credit locked: ${creditLocked}.`,
        status: "saved",
      },
    });

    created.push(event);
  }

  return c.json({
    success: true,
    createdCount: created.length,
    skippedCount: skipped.length,
    events: created,
    skipped,
  });
});

// ============================================
// POST /api/reserve-schedule/match-activation - Match legs to existing RSV
// Used during import to find matching RSV events for flying legs
// ============================================
reserveScheduleRouter.post(
  "/match-activation",
  zValidator("json", matchActivationSchema),
  async (c: Context<AppType>) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const data = c.req.valid("json" as never) as z.infer<typeof matchActivationSchema>;

    if (data.legs.length === 0) {
      return c.json({ matched: false, matchedEvent: null, reason: "no_legs_provided" });
    }

    // Get date range from legs
    const legDates = data.legs.map((l) => l.depDtLocal.split("T")[0]).sort();
    const firstLegDate = legDates[0];
    const lastLegDate = legDates[legDates.length - 1];

    if (!firstLegDate || !lastLegDate) {
      return c.json({ matched: false, matchedEvent: null, reason: "invalid_leg_dates" });
    }

    // Find RSV events that overlap with the leg dates
    // Looking for: RSV event where startDtLocal/endDtLocal overlaps with leg date range
    const rsvTypes = ["RSVA", "RSVB", "RSVC", "RSVD"];

    const matchingEvents = await db.reserveScheduleEvent.findMany({
      where: {
        userId: user.id,
        scheduleType: { in: rsvTypes },
        // Event starts before or on last leg date AND ends after or on first leg date
        startDtLocal: { lte: lastLegDate + "T23:59:59" },
        endDtLocal: { gte: firstLegDate + "T00:00:00" },
      },
      include: {
        activationLegs: true,
      },
      orderBy: { startDtLocal: "asc" },
    });

    if (matchingEvents.length === 0) {
      return c.json({ matched: false, matchedEvent: null, reason: "no_rsv_found" });
    }

    // Return the first matching event (closest to leg dates)
    const matchedEvent = matchingEvents[0];

    return c.json({
      matched: true,
      matchedEvent,
      reason: "date_overlap",
    });
  }
);

// ============================================
// GET /api/reserve-schedule/:id - Get single event
// ============================================
reserveScheduleRouter.get("/:id", async (c: Context<AppType>) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");

  const event = await db.reserveScheduleEvent.findFirst({
    where: { id, userId: user.id },
    include: {
      activationLegs: { orderBy: { legIndex: "asc" } },
      logEvents: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!event) {
    return c.json({ error: "Reserve schedule event not found" }, 404);
  }

  return c.json({ event });
});

// ============================================
// POST /api/reserve-schedule - Create reserve schedule event
// ============================================
reserveScheduleRouter.post(
  "/",
  zValidator("json", createReserveScheduleSchema),
  async (c: Context<AppType>) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const data = c.req.valid("json" as never) as z.infer<typeof createReserveScheduleSchema>;
    const { scheduleType, domicile, startDtLocal, endDtLocal, creditHours, notes, sourceUploadId } =
      data;

    // Get reserve window config if RSV type
    const windowConfig = getReserveWindowConfig(domicile, scheduleType);

    // Calculate report-for-duty minutes
    const reportForDutyMinutes = getReportForDutyMinutes(
      scheduleType as ReserveScheduleType,
      domicile
    );

    // Determine if credit should be locked
    const creditLocked = shouldCreditBeLocked(scheduleType as ReserveScheduleType);

    // Check for duplicate
    const existing = await db.reserveScheduleEvent.findFirst({
      where: {
        userId: user.id,
        scheduleType,
        startDtLocal,
      },
    });

    if (existing) {
      return c.json(
        { error: "A reserve schedule event already exists for this type and start time" },
        409
      );
    }

    const event = await db.reserveScheduleEvent.create({
      data: {
        userId: user.id,
        scheduleType,
        domicile,
        startDtLocal,
        endDtLocal,
        windowStartLocal: windowConfig?.windowStart || null,
        windowEndLocal: windowConfig?.windowEnd || null,
        reportForDutyMinutes,
        creditHours,
        blockHours: 0,
        creditLocked,
        activationStatus: "UNACTIVATED",
        sourceUploadId: sourceUploadId || null,
        notes: notes || null,
      },
      include: {
        activationLegs: true,
      },
    });

    // Create log event for creation
    await db.reserveLogEvent.create({
      data: {
        userId: user.id,
        reserveScheduleEventId: event.id,
        eventType: "created",
        autoGeneratedNotes: `Created ${scheduleType} event at ${domicile} with ${creditHours} credit hours. Credit locked: ${creditLocked}.`,
        status: "saved",
      },
    });

    return c.json({ success: true, event }, 201);
  }
);

// ============================================
// PUT /api/reserve-schedule/:id - Update reserve schedule event
// NOTE: creditHours can ONLY be updated if creditLocked = FALSE
// ============================================
reserveScheduleRouter.put(
  "/:id",
  zValidator("json", updateReserveScheduleSchema),
  async (c: Context<AppType>) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id") as string;
    const data = c.req.valid("json" as never) as z.infer<typeof updateReserveScheduleSchema>;

    const existing = await db.reserveScheduleEvent.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return c.json({ error: "Reserve schedule event not found" }, 404);
    }

    // CHECK: If credit is locked and trying to update creditHours, BLOCK IT
    let creditLockViolation = false;
    const updateData: Record<string, unknown> = { ...data };

    if (data.creditHours !== undefined && existing.creditLocked) {
      if (data.creditHours !== existing.creditHours) {
        // Log the blocked attempt
        await auditCreditLockViolation(
          user.id,
          id,
          data.creditHours,
          existing.creditHours,
          `Attempted to change credit from ${existing.creditHours} to ${data.creditHours} on ${existing.scheduleType} event. Credit is locked.`
        );
        creditLockViolation = true;
        // Remove creditHours from update data
        delete updateData.creditHours;
      }
    }

    // Update window config if domicile changes
    if (data.domicile && data.domicile !== existing.domicile) {
      const windowConfig = getReserveWindowConfig(data.domicile, existing.scheduleType);
      updateData.windowStartLocal = windowConfig?.windowStart || null;
      updateData.windowEndLocal = windowConfig?.windowEnd || null;
      updateData.reportForDutyMinutes = getReportForDutyMinutes(
        existing.scheduleType as ReserveScheduleType,
        data.domicile
      );
    }

    const event = await db.reserveScheduleEvent.update({
      where: { id },
      data: updateData,
      include: {
        activationLegs: { orderBy: { legIndex: "asc" } },
      },
    });

    // Create log event for update
    const changes = Object.entries(data)
      .filter(([, val]) => val !== undefined)
      .map(([key, val]) => `${key}: ${val}`)
      .join(", ");
    await db.reserveLogEvent.create({
      data: {
        userId: user.id,
        reserveScheduleEventId: event.id,
        eventType: "updated",
        autoGeneratedNotes: `Updated event: ${changes}${creditLockViolation ? " (credit update blocked - locked)" : ""}`,
        status: "saved",
      },
    });

    return c.json({ success: true, event, creditLockViolation });
  }
);

// ============================================
// DELETE /api/reserve-schedule/:id - Delete reserve schedule event
// Supports deletion regardless of activation status - user has full control
// ============================================
reserveScheduleRouter.delete("/:id", async (c: Context<AppType>) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");

  const existing = await db.reserveScheduleEvent.findFirst({
    where: { id, userId: user.id },
    include: {
      activationLegs: true,
      logEvents: true,
    },
  });

  if (!existing) {
    return c.json({ error: "Reserve schedule event not found" }, 404);
  }

  // Log deletion info for debugging
  console.log(`🗑️ [RSV Delete] Deleting RSV ${id}:`);
  console.log(`   Type: ${existing.scheduleType}, Status: ${existing.activationStatus}`);
  console.log(`   Activation legs: ${existing.activationLegs.length}`);
  console.log(`   Log events: ${existing.logEvents.length}`);
  console.log(`   Credit: ${existing.creditHours}h, Block: ${existing.blockHours}h`);

  // Delete the event (cascades to activationLegs and logEvents)
  await db.reserveScheduleEvent.delete({
    where: { id },
  });

  console.log(`🗑️ [RSV Delete] Successfully deleted RSV ${id} and all related records`);

  return c.json({
    success: true,
    deleted: {
      eventId: id,
      scheduleType: existing.scheduleType,
      activationStatus: existing.activationStatus,
      legsDeleted: existing.activationLegs.length,
      logEventsDeleted: existing.logEvents.length,
    },
  });
});

// ============================================
// POST /api/reserve-schedule/:id/activate - Attach activation legs
// This attaches flying legs to an existing RSV event
// ============================================
reserveScheduleRouter.post(
  "/:id/activate",
  zValidator("json", activateReserveScheduleSchema),
  async (c: Context<AppType>) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id") as string;
    const data = c.req.valid("json" as never) as z.infer<typeof activateReserveScheduleSchema>;

    const existing = await db.reserveScheduleEvent.findFirst({
      where: { id, userId: user.id },
      include: { activationLegs: true },
    });

    if (!existing) {
      return c.json({ error: "Reserve schedule event not found" }, 404);
    }

    // Create activation legs in a transaction
    const result = await db.$transaction(async (tx) => {
      let totalBlockMinutes = 0;
      const createdLegs = [];

      // Get current max leg index
      const maxLegIndex =
        existing.activationLegs.length > 0
          ? Math.max(...existing.activationLegs.map((l) => l.legIndex))
          : -1;

      for (const [index, leg] of data.legs.entries()) {
        const blockMinutes = leg.blockMinutes ?? 0;
        totalBlockMinutes += blockMinutes;

        const createdLeg = await tx.activationLeg.create({
          data: {
            reserveScheduleEventId: id,
            flightNumber: leg.flightNumber ?? null,
            origin: leg.origin,
            destination: leg.destination,
            depDtLocal: leg.depDtLocal,
            arrDtLocal: leg.arrDtLocal,
            blockMinutes,
            equipment: leg.equipment ?? null,
            tailNumber: leg.tailNumber ?? null,
            isDeadhead: leg.isDeadhead ?? false,
            actualOutISO: leg.actualOutISO ?? null,
            actualOffISO: leg.actualOffISO ?? null,
            actualOnISO: leg.actualOnISO ?? null,
            actualInISO: leg.actualInISO ?? null,
            legIndex: maxLegIndex + 1 + index,
            sourceUploadId: data.sourceUploadId ?? null,
          },
        });
        createdLegs.push(createdLeg);
      }

      // Calculate total block hours from all legs (existing + new)
      const allLegs = await tx.activationLeg.findMany({
        where: { reserveScheduleEventId: id },
      });
      const totalBlockHours = allLegs.reduce((sum, l) => sum + l.blockMinutes, 0) / 60;

      // Update the event - update blockHours but NEVER creditHours
      // Determine activation status
      const activationStatus =
        allLegs.length > 0 ? (totalBlockMinutes > 0 ? "ACTIVATED" : "PARTIAL") : "UNACTIVATED";

      const updatedEvent = await tx.reserveScheduleEvent.update({
        where: { id },
        data: {
          blockHours: totalBlockHours,
          activationStatus,
        },
        include: {
          activationLegs: { orderBy: { legIndex: "asc" } },
        },
      });

      // Create log event
      await tx.reserveLogEvent.create({
        data: {
          userId: user.id,
          reserveScheduleEventId: id,
          eventType: "activation",
          autoGeneratedNotes: `Attached ${createdLegs.length} activation legs. Total block: ${totalBlockHours.toFixed(2)} hours. Credit remains locked at ${existing.creditHours} hours.`,
          status: "saved",
        },
      });

      return {
        event: updatedEvent,
        legsAdded: createdLegs.length,
        blockHoursUpdated: totalBlockHours,
      };
    });

    return c.json({
      success: true,
      event: result.event,
      legsAdded: result.legsAdded,
      blockHoursUpdated: result.blockHoursUpdated,
      creditLocked: existing.creditLocked,
    });
  }
);

export { reserveScheduleRouter };
