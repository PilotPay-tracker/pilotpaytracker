/**
 * Log Events API Routes
 * Track schedule changes with leg-level linking, premiums, and documentation
 *
 * Routes:
 * GET    /api/log-events              - List log events (with leg details)
 * GET    /api/log-events/:id          - Get single log event with legs and attachments
 * POST   /api/log-events              - Create log event with leg linking
 * PUT    /api/log-events/:id          - Update log event
 * DELETE /api/log-events/:id          - Delete log event
 * POST   /api/log-events/:id/legs     - Link legs to an existing log event
 * DELETE /api/log-events/:id/legs/:legId - Unlink a leg from log event
 * POST   /api/log-events/from-change  - Create log event from a schedule change (auto-populated)
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db";
import type { AppType } from "../types";

export const logEventsRouter = new Hono<AppType>();

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
// PREMIUM CODE SUGGESTIONS
// Maps change types to suggested AP codes
// ============================================
const PREMIUM_SUGGESTIONS: Record<string, { code: string; name: string; minutes: number; confidence: string }[]> = {
  // Route change
  route_change: [
    { code: "AP3", name: "Reassignment", minutes: 60, confidence: "high" },
    { code: "AP6", name: "Additional Flying (per segment)", minutes: 120, confidence: "medium" },
  ],
  // Leg added
  leg_added: [
    { code: "AP6", name: "Additional Flying (per segment)", minutes: 120, confidence: "high" },
  ],
  // Leg removed
  leg_removed: [
    { code: "AP2", name: "Reduced Flying", minutes: 0, confidence: "low" },
  ],
  // Layover change
  layover_change: [
    { code: "AP2", name: "Layover Change", minutes: 60, confidence: "high" },
  ],
  // Report time change (earlier)
  time_change: [
    { code: "AP7", name: "Early Report", minutes: 60, confidence: "medium" },
  ],
  // Duty extension
  duty_extension: [
    { code: "AP4", name: "Duty Extension", minutes: 120, confidence: "high" },
    { code: "EXT", name: "Extension Premium", minutes: 0, confidence: "medium" },
  ],
  // Reassignment
  reassignment: [
    { code: "AP3", name: "Reassignment", minutes: 60, confidence: "high" },
    { code: "RA", name: "Reassignment (RA)", minutes: 120, confidence: "high" },
  ],
};

function suggestPremiums(changeType: string): { code: string; name: string; minutes: number; confidence: string }[] {
  return PREMIUM_SUGGESTIONS[changeType] || [];
}

// ============================================
// LIST LOG EVENTS
// ============================================
logEventsRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const tripId = c.req.query("tripId");
  const eventType = c.req.query("eventType");
  const status = c.req.query("status");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  const where: Record<string, unknown> = { userId: user.id };
  if (tripId) where.tripId = tripId;
  if (eventType) where.eventType = eventType;
  if (status) where.status = status;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) (where.createdAt as Record<string, Date>).gte = new Date(startDate);
    if (endDate) (where.createdAt as Record<string, Date>).lte = new Date(endDate);
  }

  const [events, total] = await Promise.all([
    db.logEvent.findMany({
      where,
      include: {
        trip: {
          select: {
            tripNumber: true,
            pairingId: true,
            startDate: true,
            endDate: true,
          },
        },
        linkedLegs: {
          include: {
            tripDutyLeg: {
              include: {
                tripDutyDay: {
                  select: {
                    dutyDate: true,
                    dutyDayIndex: true,
                  },
                },
              },
            },
          },
        },
        attachments: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.logEvent.count({ where }),
  ]);

  // Format response with leg details
  const formattedEvents = events.map((event) => {
    // Build leg summary for display
    const legSummaries = event.linkedLegs.map((link) => {
      const leg = link.tripDutyLeg;
      return {
        id: leg.id,
        flightNumber: leg.flightNumber,
        origin: leg.origin,
        destination: leg.destination,
        isDeadhead: leg.isDeadhead,
        dutyDate: leg.tripDutyDay.dutyDate,
        dutyDayIndex: leg.tripDutyDay.dutyDayIndex,
        isPrimary: link.isPrimaryLeg,
        changeSummary: link.changeSummary ? JSON.parse(link.changeSummary) : null,
      };
    });

    // Primary leg for headline display
    const primaryLeg = legSummaries.find((l) => l.isPrimary) || legSummaries[0];

    return {
      id: event.id,
      tripId: event.tripId,
      tripNumber: event.trip?.tripNumber || null,
      pairingId: event.trip?.pairingId || null,
      tripDates: event.trip ? `${event.trip.startDate} - ${event.trip.endDate}` : null,
      eventType: event.eventType,
      premiumCode: event.premiumCode,
      premiumMinutesDelta: event.premiumMinutesDelta,
      premiumMultiplier: event.premiumMultiplier,
      notes: event.notes,
      autoGeneratedNotes: event.autoGeneratedNotes,
      changeSummary: event.changeSummaryJson ? JSON.parse(event.changeSummaryJson) : null,
      status: event.status,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      // Leg-level info for display
      primaryLeg: primaryLeg || null,
      legs: legSummaries,
      legCount: legSummaries.length,
      attachmentCount: event.attachments.length,
      // Headline for list view (e.g., "MCO–RFD • FLT 5903 • Jan 15")
      headline: primaryLeg
        ? `${primaryLeg.origin}–${primaryLeg.destination} • FLT ${primaryLeg.flightNumber || "N/A"} • ${formatDateShort(primaryLeg.dutyDate)}`
        : `Trip ${event.trip?.tripNumber || event.tripId.slice(0, 8)}`,
    };
  });

  return c.json({
    events: formattedEvents,
    total,
    hasMore: offset + events.length < total,
  });
});

// Helper to format date
function formatDateShort(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// ============================================
// GET SINGLE LOG EVENT
// ============================================
logEventsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const eventId = c.req.param("id");

  const event = await db.logEvent.findFirst({
    where: { id: eventId, userId: user.id },
    include: {
      trip: {
        select: {
          id: true,
          tripNumber: true,
          pairingId: true,
          startDate: true,
          endDate: true,
          totalCreditMinutes: true,
          protectedCreditMinutes: true,
          currentCreditMinutes: true,
        },
      },
      linkedLegs: {
        include: {
          tripDutyLeg: {
            include: {
              tripDutyDay: {
                select: {
                  id: true,
                  dutyDate: true,
                  dutyDayIndex: true,
                  reportTimeISO: true,
                  releaseTimeISO: true,
                  creditMinutes: true,
                },
              },
            },
          },
        },
      },
      attachments: true,
    },
  });

  if (!event) {
    return c.json({ error: "Log event not found" }, 404);
  }

  // Format legs with full details
  const legs = event.linkedLegs.map((link) => {
    const leg = link.tripDutyLeg;
    const changeSummary = link.changeSummary ? JSON.parse(link.changeSummary) : null;

    return {
      id: leg.id,
      linkId: link.id,
      isPrimary: link.isPrimaryLeg,
      flightNumber: leg.flightNumber,
      origin: leg.origin,
      destination: leg.destination,
      equipment: leg.equipment,
      isDeadhead: leg.isDeadhead,
      scheduledOutISO: leg.scheduledOutISO,
      scheduledInISO: leg.scheduledInISO,
      actualOutISO: leg.actualOutISO,
      actualInISO: leg.actualInISO,
      plannedBlockMinutes: leg.plannedBlockMinutes,
      actualBlockMinutes: leg.actualBlockMinutes,
      creditMinutes: leg.creditMinutes,
      premiumCode: leg.premiumCode,
      premiumAmountCents: leg.premiumAmountCents,
      // Duty day context
      dutyDayId: leg.tripDutyDay.id,
      dutyDate: leg.tripDutyDay.dutyDate,
      dutyDayIndex: leg.tripDutyDay.dutyDayIndex,
      dutyReportTime: leg.tripDutyDay.reportTimeISO,
      dutyReleaseTime: leg.tripDutyDay.releaseTimeISO,
      dutyCreditMinutes: leg.tripDutyDay.creditMinutes,
      // Change details for this leg
      changeSummary,
    };
  });

  return c.json({
    event: {
      id: event.id,
      tripId: event.tripId,
      eventType: event.eventType,
      premiumCode: event.premiumCode,
      premiumMinutesDelta: event.premiumMinutesDelta,
      premiumMultiplier: event.premiumMultiplier,
      notes: event.notes,
      autoGeneratedNotes: event.autoGeneratedNotes,
      changeSummary: event.changeSummaryJson ? JSON.parse(event.changeSummaryJson) : null,
      status: event.status,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    },
    trip: event.trip
      ? {
          id: event.trip.id,
          tripNumber: event.trip.tripNumber,
          pairingId: event.trip.pairingId,
          startDate: event.trip.startDate,
          endDate: event.trip.endDate,
          totalCreditMinutes: event.trip.totalCreditMinutes,
          protectedCreditMinutes: event.trip.protectedCreditMinutes,
          currentCreditMinutes: event.trip.currentCreditMinutes,
        }
      : null,
    legs,
    attachments: event.attachments.map((att) => ({
      id: att.id,
      url: att.attachmentUrl || (att.uploadId ? `/api/uploads/${att.uploadId}` : null),
      type: att.attachmentType,
      description: att.description,
      createdAt: att.createdAt.toISOString(),
    })),
  });
});

// ============================================
// CREATE LOG EVENT
// ============================================
const createLogEventSchema = z.object({
  tripId: z.string(),
  eventType: z.string(),
  premiumCode: z.string().optional(),
  premiumMinutesDelta: z.number().optional(),
  premiumMultiplier: z.number().optional(),
  notes: z.string().optional(),
  autoGeneratedNotes: z.string().optional(),
  changeSummary: z.any().optional(), // JSON object for before/after
  status: z.enum(["draft", "saved", "exported"]).optional(),
  // Leg linking
  legIds: z.array(z.string()).optional(), // TripDutyLeg IDs to link
  primaryLegId: z.string().optional(), // Primary leg for this event
  legChangeSummaries: z.record(z.string(), z.any()).optional(), // { legId: changeSummary }
  // Attachments
  attachmentUrls: z.array(z.string()).optional(),
  // Pay modifier fields
  appliesTo: z.enum(["trip", "day", "leg"]).optional(),
  contractReference: z.string().optional(),
  proofStatus: z.enum(["attached", "missing", "not_required"]).optional(),
  applicationStatus: z.enum(["logged", "needs_proof", "ready_to_apply", "applied", "review"]).optional(),
  eventDate: z.string().optional(),
  isPayAffecting: z.boolean().optional(),
  payDeltaCents: z.number().optional(),
  // Context for smart prefill
  dutyDayDate: z.string().optional(),
  aircraftType: z.string().optional(),
  position: z.string().optional(),
});

logEventsRouter.post("/", zValidator("json", createLogEventSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const data = c.req.valid("json");

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: data.tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  // Create log event
  const event = await db.logEvent.create({
    data: {
      userId: user.id,
      tripId: data.tripId,
      eventType: data.eventType,
      premiumCode: data.premiumCode || null,
      premiumMinutesDelta: data.premiumMinutesDelta || null,
      premiumMultiplier: data.premiumMultiplier || null,
      notes: data.notes || null,
      autoGeneratedNotes: data.autoGeneratedNotes || null,
      changeSummaryJson: data.changeSummary ? JSON.stringify(data.changeSummary) : null,
      status: data.status || "draft",
      // Pay modifier fields
      appliesTo: data.appliesTo || null,
      contractReference: data.contractReference || null,
      proofStatus: data.proofStatus || (data.attachmentUrls?.length ? "attached" : (data.isPayAffecting ? "missing" : null)),
      applicationStatus: data.applicationStatus || (data.isPayAffecting ? (data.attachmentUrls?.length ? "ready_to_apply" : "needs_proof") : "logged"),
      eventDate: data.eventDate || null,
      isPayAffecting: data.isPayAffecting || (!!data.premiumCode || !!data.premiumMultiplier),
      payDeltaCents: data.payDeltaCents || null,
      dutyDayDate: data.dutyDayDate || null,
      aircraftType: data.aircraftType || null,
      position: data.position || null,
    },
  });

  // Link legs if provided
  if (data.legIds && data.legIds.length > 0) {
    const legLinks = data.legIds.map((legId) => ({
      logEventId: event.id,
      tripDutyLegId: legId,
      isPrimaryLeg: legId === data.primaryLegId,
      changeSummary: data.legChangeSummaries?.[legId]
        ? JSON.stringify(data.legChangeSummaries[legId])
        : null,
    }));

    await db.logEventLeg.createMany({ data: legLinks });
  }

  // Add attachments if provided
  if (data.attachmentUrls && data.attachmentUrls.length > 0) {
    const attachments = data.attachmentUrls.map((url) => ({
      logEventId: event.id,
      attachmentUrl: url,
      attachmentType: "image",
    }));

    await db.logEventAttachment.createMany({ data: attachments });
  }

  // Fetch the created event with relations
  const createdEvent = await db.logEvent.findUnique({
    where: { id: event.id },
    include: {
      linkedLegs: {
        include: { tripDutyLeg: true },
      },
      attachments: true,
    },
  });

  return c.json({
    success: true,
    event: {
      id: createdEvent!.id,
      tripId: createdEvent!.tripId,
      eventType: createdEvent!.eventType,
      premiumCode: createdEvent!.premiumCode,
      premiumMinutesDelta: createdEvent!.premiumMinutesDelta,
      status: createdEvent!.status,
      createdAt: createdEvent!.createdAt.toISOString(),
      legCount: createdEvent!.linkedLegs.length,
      attachmentCount: createdEvent!.attachments.length,
    },
  });
});

// ============================================
// CREATE LOG EVENT FROM SCHEDULE CHANGE
// Auto-populates from before/after data
// ============================================
const createFromChangeSchema = z.object({
  tripId: z.string(),
  dutyDayId: z.string().optional(),
  changeType: z.string(), // route_change, leg_added, leg_removed, time_change, etc.
  before: z.any(), // JSON: { legs, credit, times, etc. }
  after: z.any(), // JSON: { legs, credit, times, etc. }
  legIds: z.array(z.string()).optional(),
  primaryLegId: z.string().optional(),
  attachmentUrls: z.array(z.string()).optional(),
});

logEventsRouter.post("/from-change", zValidator("json", createFromChangeSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const data = c.req.valid("json");

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: data.tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  // Generate auto notes from before/after
  const changes: string[] = [];
  const before = data.before as Record<string, unknown>;
  const after = data.after as Record<string, unknown>;

  // Compare and generate change descriptions
  if (before.flightNumber !== after.flightNumber) {
    changes.push(`Flight: ${before.flightNumber || "N/A"} → ${after.flightNumber || "N/A"}`);
  }
  if (before.origin !== after.origin || before.destination !== after.destination) {
    changes.push(`Route: ${before.origin}-${before.destination} → ${after.origin}-${after.destination}`);
  }
  if (before.scheduledOut !== after.scheduledOut) {
    changes.push(`Departure: ${before.scheduledOut || "N/A"} → ${after.scheduledOut || "N/A"}`);
  }
  if (before.scheduledIn !== after.scheduledIn) {
    changes.push(`Arrival: ${before.scheduledIn || "N/A"} → ${after.scheduledIn || "N/A"}`);
  }
  if (before.creditMinutes !== after.creditMinutes) {
    const diff = (after.creditMinutes as number) - (before.creditMinutes as number);
    const sign = diff > 0 ? "+" : "";
    changes.push(`Credit: ${formatMinutes(before.creditMinutes as number)} → ${formatMinutes(after.creditMinutes as number)} (${sign}${formatMinutes(diff)})`);
  }
  if (before.layoverCity !== after.layoverCity) {
    changes.push(`Layover: ${before.layoverCity || "N/A"} → ${after.layoverCity || "N/A"}`);
  }
  if ((before.legCount as number) !== (after.legCount as number)) {
    const diff = (after.legCount as number) - (before.legCount as number);
    if (diff > 0) {
      changes.push(`Legs Added: +${diff}`);
    } else {
      changes.push(`Legs Removed: ${diff}`);
    }
  }

  const autoGeneratedNotes = changes.length > 0
    ? `Schedule Change Detected:\n• ${changes.join("\n• ")}`
    : "Schedule change detected";

  // Get premium suggestions
  const premiumSuggestions = suggestPremiums(data.changeType);
  const topSuggestion = premiumSuggestions[0];

  // Create log event
  const event = await db.logEvent.create({
    data: {
      userId: user.id,
      tripId: data.tripId,
      eventType: "schedule_change",
      premiumCode: topSuggestion?.code || null,
      premiumMinutesDelta: topSuggestion?.minutes || null,
      notes: null,
      autoGeneratedNotes,
      changeSummaryJson: JSON.stringify({
        changeType: data.changeType,
        before: data.before,
        after: data.after,
        changes,
      }),
      status: "draft",
    },
  });

  // Link legs if provided
  if (data.legIds && data.legIds.length > 0) {
    const legLinks = data.legIds.map((legId) => ({
      logEventId: event.id,
      tripDutyLegId: legId,
      isPrimaryLeg: legId === data.primaryLegId,
      changeSummary: JSON.stringify({ before: data.before, after: data.after }),
    }));

    await db.logEventLeg.createMany({ data: legLinks });
  }

  // Add attachments
  if (data.attachmentUrls && data.attachmentUrls.length > 0) {
    const attachments = data.attachmentUrls.map((url) => ({
      logEventId: event.id,
      attachmentUrl: url,
      attachmentType: "screenshot",
      description: "Schedule change proof",
    }));

    await db.logEventAttachment.createMany({ data: attachments });
  }

  return c.json({
    success: true,
    event: {
      id: event.id,
      tripId: event.tripId,
      eventType: event.eventType,
      premiumCode: event.premiumCode,
      premiumMinutesDelta: event.premiumMinutesDelta,
      autoGeneratedNotes: event.autoGeneratedNotes,
      status: event.status,
      createdAt: event.createdAt.toISOString(),
    },
    premiumSuggestions,
    changes,
  });
});

// Helper to format minutes as HH:MM
function formatMinutes(minutes: number): string {
  if (!minutes && minutes !== 0) return "N/A";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${h}:${m.toString().padStart(2, "0")}`;
}

// ============================================
// UPDATE LOG EVENT
// ============================================
const updateLogEventSchema = z.object({
  eventType: z.string().optional(),
  premiumCode: z.string().nullable().optional(),
  premiumMinutesDelta: z.number().nullable().optional(),
  premiumMultiplier: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  changeSummary: z.any().optional(),
  status: z.enum(["draft", "saved", "exported"]).optional(),
  // Pay modifier fields
  appliesTo: z.enum(["trip", "day", "leg"]).nullable().optional(),
  contractReference: z.string().nullable().optional(),
  proofStatus: z.enum(["attached", "missing", "not_required"]).nullable().optional(),
  applicationStatus: z.enum(["logged", "needs_proof", "ready_to_apply", "applied", "review"]).nullable().optional(),
  eventDate: z.string().nullable().optional(),
  isPayAffecting: z.boolean().optional(),
  payDeltaCents: z.number().nullable().optional(),
});

logEventsRouter.put("/:id", zValidator("json", updateLogEventSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const eventId = c.req.param("id");
  const data = c.req.valid("json");

  // Verify ownership
  const existing = await db.logEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });

  if (!existing) {
    return c.json({ error: "Log event not found" }, 404);
  }

  const updateData: Record<string, unknown> = {};
  if (data.eventType !== undefined) updateData.eventType = data.eventType;
  if (data.premiumCode !== undefined) updateData.premiumCode = data.premiumCode;
  if (data.premiumMinutesDelta !== undefined) updateData.premiumMinutesDelta = data.premiumMinutesDelta;
  if (data.premiumMultiplier !== undefined) updateData.premiumMultiplier = data.premiumMultiplier;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.changeSummary !== undefined) updateData.changeSummaryJson = JSON.stringify(data.changeSummary);
  if (data.status !== undefined) updateData.status = data.status;
  // Pay modifier fields
  if (data.appliesTo !== undefined) updateData.appliesTo = data.appliesTo;
  if (data.contractReference !== undefined) updateData.contractReference = data.contractReference;
  if (data.proofStatus !== undefined) updateData.proofStatus = data.proofStatus;
  if (data.applicationStatus !== undefined) updateData.applicationStatus = data.applicationStatus;
  if (data.eventDate !== undefined) updateData.eventDate = data.eventDate;
  if (data.isPayAffecting !== undefined) updateData.isPayAffecting = data.isPayAffecting;
  if (data.payDeltaCents !== undefined) updateData.payDeltaCents = data.payDeltaCents;

  const event = await db.logEvent.update({
    where: { id: eventId },
    data: updateData,
    include: {
      linkedLegs: {
        include: { tripDutyLeg: true },
      },
      attachments: true,
    },
  });

  return c.json({
    success: true,
    event: {
      id: event.id,
      tripId: event.tripId,
      eventType: event.eventType,
      premiumCode: event.premiumCode,
      premiumMinutesDelta: event.premiumMinutesDelta,
      status: event.status,
      updatedAt: event.updatedAt.toISOString(),
    },
  });
});

// ============================================
// DELETE LOG EVENT
// ============================================
logEventsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const eventId = c.req.param("id");

  // Verify ownership
  const existing = await db.logEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });

  if (!existing) {
    return c.json({ error: "Log event not found" }, 404);
  }

  // Delete (cascades to legs and attachments)
  await db.logEvent.delete({ where: { id: eventId } });

  return c.json({ success: true });
});

// ============================================
// LINK LEGS TO LOG EVENT
// ============================================
const linkLegsSchema = z.object({
  legIds: z.array(z.string()),
  primaryLegId: z.string().optional(),
  changeSummaries: z.record(z.string(), z.any()).optional(),
});

logEventsRouter.post("/:id/legs", zValidator("json", linkLegsSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const eventId = c.req.param("id");
  const data = c.req.valid("json");

  // Verify ownership
  const existing = await db.logEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });

  if (!existing) {
    return c.json({ error: "Log event not found" }, 404);
  }

  // Create leg links
  const legLinks = data.legIds.map((legId) => ({
    logEventId: eventId,
    tripDutyLegId: legId,
    isPrimaryLeg: legId === data.primaryLegId,
    changeSummary: data.changeSummaries?.[legId]
      ? JSON.stringify(data.changeSummaries[legId])
      : null,
  }));

  // Use upsert to avoid duplicates
  for (const link of legLinks) {
    await db.logEventLeg.upsert({
      where: {
        logEventId_tripDutyLegId: {
          logEventId: link.logEventId,
          tripDutyLegId: link.tripDutyLegId,
        },
      },
      create: link,
      update: {
        isPrimaryLeg: link.isPrimaryLeg,
        changeSummary: link.changeSummary,
      },
    });
  }

  return c.json({ success: true, linkedCount: legLinks.length });
});

// ============================================
// UNLINK LEG FROM LOG EVENT
// ============================================
logEventsRouter.delete("/:id/legs/:legId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const eventId = c.req.param("id");
  const legId = c.req.param("legId");

  // Verify ownership
  const existing = await db.logEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });

  if (!existing) {
    return c.json({ error: "Log event not found" }, 404);
  }

  // Delete the link
  await db.logEventLeg.deleteMany({
    where: {
      logEventId: eventId,
      tripDutyLegId: legId,
    },
  });

  return c.json({ success: true });
});

// ============================================
// GET PREMIUM SUGGESTIONS FOR CHANGE TYPE
// ============================================
logEventsRouter.get("/premium-suggestions/:changeType", async (c) => {
  const changeType = c.req.param("changeType");
  const suggestions = suggestPremiums(changeType);

  return c.json({ suggestions });
});

// ============================================
// GET LOG EVENTS SUMMARY BY TRIP
// ============================================
logEventsRouter.get("/summary/by-trip/:tripId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const tripId = c.req.param("tripId");

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
    select: {
      id: true,
      tripNumber: true,
      totalCreditMinutes: true,
    },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  // Get all log events for this trip with premiums
  const events = await db.logEvent.findMany({
    where: { tripId, userId: user.id },
    include: {
      linkedLegs: {
        include: {
          tripDutyLeg: {
            select: {
              origin: true,
              destination: true,
              flightNumber: true,
              creditMinutes: true,
            },
          },
        },
      },
    },
  });

  // Calculate premium totals
  let totalPremiumMinutes = 0;
  const premiumsByCode: Record<string, { count: number; totalMinutes: number }> = {};
  const premiumsByLeg: { legId: string; origin: string; destination: string; flightNumber: string | null; premiumCode: string; premiumMinutes: number }[] = [];

  for (const event of events) {
    if (event.premiumCode && event.premiumMinutesDelta) {
      totalPremiumMinutes += event.premiumMinutesDelta;

      if (!premiumsByCode[event.premiumCode]) {
        premiumsByCode[event.premiumCode] = { count: 0, totalMinutes: 0 };
      }
      const bucket = premiumsByCode[event.premiumCode]!;
      bucket.count++;
      bucket.totalMinutes += event.premiumMinutesDelta;

      // Add per-leg breakdown
      for (const link of event.linkedLegs) {
        premiumsByLeg.push({
          legId: link.tripDutyLegId,
          origin: link.tripDutyLeg.origin || "",
          destination: link.tripDutyLeg.destination || "",
          flightNumber: link.tripDutyLeg.flightNumber,
          premiumCode: event.premiumCode,
          premiumMinutes: event.premiumMinutesDelta / Math.max(1, event.linkedLegs.length), // Split evenly
        });
      }
    }
  }

  return c.json({
    tripId,
    tripNumber: trip.tripNumber,
    baseCreditMinutes: trip.totalCreditMinutes,
    totalPremiumMinutes,
    totalCreditWithPremiums: trip.totalCreditMinutes + totalPremiumMinutes,
    eventCount: events.length,
    premiumsByCode: Object.entries(premiumsByCode).map(([code, data]) => ({
      code,
      count: data.count,
      totalMinutes: data.totalMinutes,
      formatted: `+${formatMinutes(data.totalMinutes)}`,
    })),
    premiumsByLeg,
  });
});

// ============================================
// RECALCULATE TRIP PAY WITH MODIFIERS
// ============================================
logEventsRouter.post("/recalculate/:tripId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const tripId = c.req.param("tripId");

  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
    select: {
      id: true,
      tripNumber: true,
      totalCreditMinutes: true,
      totalBlockMinutes: true,
      totalPayCents: true,
      protectedCreditMinutes: true,
    },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  const payEvents = await db.logEvent.findMany({
    where: { tripId, userId: user.id, isPayAffecting: true },
    orderBy: { createdAt: "asc" },
  });

  const profile = await db.profile.findFirst({
    where: { userId: user.id },
    select: { hourlyRateCents: true },
  });
  const hourlyRateCents = (profile as any)?.hourlyRateCents ?? 32500;

  const baseCreditMinutes = trip.totalCreditMinutes ?? 0;
  const basePayCents = Math.round((baseCreditMinutes / 60) * hourlyRateCents);

  let premiumCreditMinutes = 0;
  let premiumPayCents = 0;
  const appliedRules: Array<{
    eventId: string;
    premiumCode: string | null;
    description: string;
    creditDeltaMinutes: number;
    payDeltaCents: number;
    applicationStatus: string | null;
    contractReference: string | null;
    proofStatus: string | null;
  }> = [];

  for (const event of payEvents) {
    if ((event as any).applicationStatus === "review") continue;

    if ((event as any).premiumMultiplier && (event as any).premiumMultiplier !== 1) {
      const multiplier = (event as any).premiumMultiplier as number;
      const multipliedCredit = Math.round(baseCreditMinutes * multiplier);
      const creditDelta = multipliedCredit - baseCreditMinutes;
      const payDelta = Math.round((creditDelta / 60) * hourlyRateCents);
      premiumCreditMinutes += creditDelta;
      premiumPayCents += payDelta;
      appliedRules.push({
        eventId: event.id,
        premiumCode: event.premiumCode,
        description: `${event.premiumCode || event.eventType} ${multiplier}x multiplier`,
        creditDeltaMinutes: creditDelta,
        payDeltaCents: payDelta,
        applicationStatus: (event as any).applicationStatus,
        contractReference: (event as any).contractReference,
        proofStatus: (event as any).proofStatus,
      });
    } else if (event.premiumMinutesDelta && event.premiumMinutesDelta > 0) {
      const payDelta = Math.round((event.premiumMinutesDelta / 60) * hourlyRateCents);
      premiumCreditMinutes += event.premiumMinutesDelta;
      premiumPayCents += payDelta;
      appliedRules.push({
        eventId: event.id,
        premiumCode: event.premiumCode,
        description: `${event.premiumCode || event.eventType} +${formatMinutes(event.premiumMinutesDelta)}`,
        creditDeltaMinutes: event.premiumMinutesDelta,
        payDeltaCents: payDelta,
        applicationStatus: (event as any).applicationStatus,
        contractReference: (event as any).contractReference,
        proofStatus: (event as any).proofStatus,
      });
    }
  }

  const totalCreditMinutes = baseCreditMinutes + premiumCreditMinutes;
  const totalPayCents = basePayCents + premiumPayCents;

  const hasAppliedPremiums = appliedRules.some(r => r.applicationStatus === "applied");
  const hasNeedsProof = payEvents.some(e => (e as any).applicationStatus === "needs_proof" || (e as any).proofStatus === "missing");
  const hasReview = payEvents.some(e => (e as any).applicationStatus === "review");
  const hasLoggedEvents = payEvents.length > 0;

  let tripPayState = "normal";
  if (hasReview || hasNeedsProof) tripPayState = "needs_review";
  else if (hasAppliedPremiums) tripPayState = "premium_applied";
  else if (hasLoggedEvents) tripPayState = "event_logged";

  return c.json({
    tripId,
    tripNumber: trip.tripNumber,
    baseCreditMinutes,
    basePayCents,
    premiumCreditMinutes,
    premiumPayCents,
    totalCreditMinutes,
    totalPayCents,
    hourlyRateCents,
    appliedRules,
    payEventCount: payEvents.length,
    tripPayState,
    hasNeedsProof,
    hasReview,
  });
});

// ============================================
// APPLY PREMIUM TO TRIP
// POST /api/log-events/apply-premium
// Directly applies a premium code to a trip, creating a LogEvent automatically
// ============================================

const applyPremiumSchema = z.object({
  tripId: z.string(),
  premiumCode: z.string(),
  premiumName: z.string(),
  premiumType: z.enum(["minutes", "multiplier", "manual", "fixed_minutes"]),
  // For minutes type
  creditMinutesDelta: z.number().optional(),
  // For multiplier type
  multiplierValue: z.number().optional(),
  // Original pay before this premium (in cents) — used for reference only
  originalPayCents: z.number().optional(),
  contractReference: z.string().optional(),
  notes: z.string().optional(),
});

logEventsRouter.post("/apply-premium", zValidator("json", applyPremiumSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");

  // Verify trip belongs to user
  const trip = await db.trip.findFirst({
    where: { id: body.tripId, userId: user.id },
    select: {
      id: true,
      tripNumber: true,
      totalCreditMinutes: true,
      payCreditMinutes: true,
      totalPayCents: true,
    },
  });
  if (!trip) return c.json({ error: "Trip not found" }, 404);

  // Look up premium code for contract reference and details
  const premiumCodeRecord = await db.premiumCode.findFirst({
    where: { code: body.premiumCode.toUpperCase(), isActive: true },
  });

  const contractRef = body.contractReference ?? premiumCodeRecord?.contractRef ?? null;

  // Calculate pay impact
  const profile = await db.profile.findFirst({
    where: { userId: user.id },
    select: { hourlyRateCents: true },
  });
  const hourlyRateCents = (profile as any)?.hourlyRateCents ?? 32500;
  // Use payCreditMinutes (already updated by previous premiums) as the base for calculation
  const baseCreditMinutes = (trip as any).payCreditMinutes || trip.totalCreditMinutes || 0;

  let creditDeltaMinutes = 0;
  let payDeltaCents = 0;
  let premiumMultiplier: number | null = null;
  let premiumMinutesDelta: number | null = null;

  if (body.premiumType === "multiplier" && body.multiplierValue) {
    premiumMultiplier = body.multiplierValue;
    const multipliedCredit = Math.round(baseCreditMinutes * body.multiplierValue);
    creditDeltaMinutes = multipliedCredit - baseCreditMinutes;
    payDeltaCents = Math.round((creditDeltaMinutes / 60) * hourlyRateCents);
    // Store the credit delta minutes so YTD/projections can use it directly
    premiumMinutesDelta = creditDeltaMinutes;
  } else if ((body.premiumType === "minutes" || body.premiumType === "fixed_minutes") && body.creditMinutesDelta) {
    premiumMinutesDelta = body.creditMinutesDelta;
    creditDeltaMinutes = body.creditMinutesDelta;
    payDeltaCents = Math.round((creditDeltaMinutes / 60) * hourlyRateCents);
  }

  // Auto-generate notes for the log event
  const autoNotes = body.premiumType === "multiplier"
    ? `Applied ${body.premiumCode} (${((body.multiplierValue ?? 1) * 100).toFixed(0)}%) to trip ${trip.tripNumber ?? body.tripId}. Original pay: $${((body.originalPayCents ?? 0) / 100).toFixed(2)}`
    : `Applied ${body.premiumCode} (+${Math.floor(creditDeltaMinutes / 60)}:${(creditDeltaMinutes % 60).toString().padStart(2, "0")}) to trip ${trip.tripNumber ?? body.tripId}`;

  // Create the log event
  const logEvent = await db.logEvent.create({
    data: {
      userId: user.id,
      tripId: body.tripId,
      eventType: "PREMIUM_APPLIED",
      premiumCode: body.premiumCode.toUpperCase(),
      premiumMinutesDelta: premiumMinutesDelta,
      premiumMultiplier: premiumMultiplier,
      notes: body.notes ?? null,
      autoGeneratedNotes: autoNotes,
      status: "active",
      appliesTo: "trip",
      contractReference: contractRef,
      proofStatus: "not_required",
      applicationStatus: "applied",
      isPayAffecting: true,
      payDeltaCents: payDeltaCents,
      changeSummaryJson: JSON.stringify({
        premiumCode: body.premiumCode,
        premiumName: body.premiumName,
        premiumType: body.premiumType,
        creditDeltaMinutes,
        payDeltaCents,
        multiplierValue: body.multiplierValue,
        originalPayCents: body.originalPayCents,
      }),
    },
  });

  // Update trip's payCreditMinutes and totalPayCents so monthly rollups reflect the premium
  const newTotalCreditMinutes = baseCreditMinutes + creditDeltaMinutes;
  const newTotalPayCents = Math.round((newTotalCreditMinutes / 60) * hourlyRateCents);
  await db.trip.update({
    where: { id: body.tripId },
    data: {
      payCreditMinutes: newTotalCreditMinutes,
      totalPayCents: newTotalPayCents,
    },
  });

  // Return the new log event with computed pay impact
  return c.json({
    success: true,
    logEvent: {
      id: logEvent.id,
      premiumCode: logEvent.premiumCode,
      premiumName: body.premiumName,
      creditDeltaMinutes,
      payDeltaCents,
      applicationStatus: logEvent.applicationStatus,
      contractReference: logEvent.contractReference,
    },
    payImpact: {
      originalPayCents: body.originalPayCents ?? Math.round((baseCreditMinutes / 60) * hourlyRateCents),
      payDeltaCents,
      newEstimatedPayCents: (body.originalPayCents ?? Math.round((baseCreditMinutes / 60) * hourlyRateCents)) + payDeltaCents,
      creditDeltaMinutes,
    },
  }, 201);
});
