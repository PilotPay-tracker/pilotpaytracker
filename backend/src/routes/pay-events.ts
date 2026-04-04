/**
 * Pay Events API Routes
 * Track pay-affecting events with documentation
 */

import { Hono } from "hono";
import { db } from "../db";
import { type AppType } from "../types";
import {
  createPayEventRequestSchema,
  updatePayEventRequestSchema,
  createPayEventDocumentRequestSchema,
} from "@/shared/contracts";

export const payEventsRouter = new Hono<AppType>();

// ============================================
// HELPER: Require authentication
// ============================================
function requireAuth(userId: string | undefined): string {
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

// Helper to calculate pay difference
function calculatePayDifference(
  originalMinutes: number | null | undefined,
  newMinutes: number | null | undefined,
  hourlyRateCents: number
): { creditDifferenceMinutes: number | null; payDifferenceCents: number | null } {
  if (originalMinutes == null || newMinutes == null) {
    return { creditDifferenceMinutes: null, payDifferenceCents: null };
  }
  const creditDifferenceMinutes = newMinutes - originalMinutes;
  const payDifferenceCents = Math.round((creditDifferenceMinutes / 60) * hourlyRateCents);
  return { creditDifferenceMinutes, payDifferenceCents };
}

// ============================================
// PAY EVENTS ROUTES
// ============================================

// GET /api/pay-events - List pay events
payEventsRouter.get("/", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const eventType = c.req.query("eventType");
    const tripId = c.req.query("tripId");
    const status = c.req.query("status");

    const where: Record<string, unknown> = { userId };
    if (eventType) where.eventType = eventType;
    if (tripId) where.tripId = tripId;
    if (status) where.status = status;
    if (startDate) where.eventDateISO = { ...(where.eventDateISO as object || {}), gte: startDate };
    if (endDate) where.eventDateISO = { ...(where.eventDateISO as object || {}), lte: endDate };

    const events = await db.payEvent.findMany({
      where,
      include: {
        documentation: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { eventDateISO: "desc" },
    });

    return c.json({
      events: events.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
        documentation: event.documentation.map((doc) => ({
          ...doc,
          createdAt: doc.createdAt.toISOString(),
        })),
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching pay events:", error);
    return c.json({ error: "Failed to fetch pay events" }, 500);
  }
});

// GET /api/pay-events/:id - Get single pay event with documents
payEventsRouter.get("/:id", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const eventId = c.req.param("id");

    const event = await db.payEvent.findFirst({
      where: { id: eventId, userId },
      include: {
        documentation: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!event) {
      return c.json({ error: "Pay event not found" }, 404);
    }

    return c.json({
      event: {
        ...event,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
        documentation: event.documentation.map((doc) => ({
          ...doc,
          createdAt: doc.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching pay event:", error);
    return c.json({ error: "Failed to fetch pay event" }, 500);
  }
});

// POST /api/pay-events - Create pay event
payEventsRouter.post("/", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const body = await c.req.json();
    const parsed = createPayEventRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const data = parsed.data;

    // Get user's hourly rate for pay calculation
    const profile = await db.profile.findUnique({ where: { userId } });
    const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

    // Calculate pay difference if we have both original and new credit
    const { creditDifferenceMinutes, payDifferenceCents } = calculatePayDifference(
      data.originalCreditMinutes,
      data.newCreditMinutes,
      hourlyRateCents
    );

    const event = await db.payEvent.create({
      data: {
        userId,
        eventType: data.eventType,
        airlineLabel: data.airlineLabel ?? null,
        eventDateISO: data.eventDateISO,
        eventTimeISO: data.eventTimeISO ?? null,
        tripId: data.tripId ?? null,
        dutyDayId: data.dutyDayId ?? null,
        title: data.title,
        description: data.description ?? null,
        originalTripNumber: data.originalTripNumber ?? null,
        originalStartTime: data.originalStartTime ?? null,
        originalEndTime: data.originalEndTime ?? null,
        originalCreditMinutes: data.originalCreditMinutes ?? null,
        newTripNumber: data.newTripNumber ?? null,
        newStartTime: data.newStartTime ?? null,
        newEndTime: data.newEndTime ?? null,
        newCreditMinutes: data.newCreditMinutes ?? null,
        creditDifferenceMinutes,
        payDifferenceCents,
        // Phase 3: Premium Code fields
        premiumCode: data.premiumCode ?? null,
        premiumVariantKey: data.premiumVariantKey ?? null,
        premiumMinutes: data.newCreditMinutes ?? null, // Use newCreditMinutes as premiumMinutes when set from picker
        status: "logged",
        needsReview: false,
      },
      include: {
        documentation: true,
      },
    });

    return c.json({
      success: true,
      event: {
        ...event,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
        documentation: event.documentation.map((doc) => ({
          ...doc,
          createdAt: doc.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error creating pay event:", error);
    return c.json({ error: "Failed to create pay event" }, 500);
  }
});

// PUT /api/pay-events/:id - Update pay event
payEventsRouter.put("/:id", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const eventId = c.req.param("id");
    const body = await c.req.json();
    const parsed = updatePayEventRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    // Verify ownership
    const existing = await db.payEvent.findFirst({
      where: { id: eventId, userId },
    });

    if (!existing) {
      return c.json({ error: "Pay event not found" }, 404);
    }

    const data = parsed.data;
    const updateData: Record<string, unknown> = {};

    // Copy over all provided fields
    if (data.eventType !== undefined) updateData.eventType = data.eventType;
    if (data.airlineLabel !== undefined) updateData.airlineLabel = data.airlineLabel;
    if (data.eventDateISO !== undefined) updateData.eventDateISO = data.eventDateISO;
    if (data.eventTimeISO !== undefined) updateData.eventTimeISO = data.eventTimeISO;
    if (data.tripId !== undefined) updateData.tripId = data.tripId;
    if (data.dutyDayId !== undefined) updateData.dutyDayId = data.dutyDayId;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.originalTripNumber !== undefined) updateData.originalTripNumber = data.originalTripNumber;
    if (data.originalStartTime !== undefined) updateData.originalStartTime = data.originalStartTime;
    if (data.originalEndTime !== undefined) updateData.originalEndTime = data.originalEndTime;
    if (data.originalCreditMinutes !== undefined) updateData.originalCreditMinutes = data.originalCreditMinutes;
    if (data.newTripNumber !== undefined) updateData.newTripNumber = data.newTripNumber;
    if (data.newStartTime !== undefined) updateData.newStartTime = data.newStartTime;
    if (data.newEndTime !== undefined) updateData.newEndTime = data.newEndTime;
    if (data.newCreditMinutes !== undefined) updateData.newCreditMinutes = data.newCreditMinutes;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.needsReview !== undefined) updateData.needsReview = data.needsReview;

    // Recalculate pay difference if credit minutes changed
    const originalMinutes = data.originalCreditMinutes ?? existing.originalCreditMinutes;
    const newMinutes = data.newCreditMinutes ?? existing.newCreditMinutes;

    if (data.originalCreditMinutes !== undefined || data.newCreditMinutes !== undefined) {
      const profile = await db.profile.findUnique({ where: { userId } });
      const hourlyRateCents = profile?.hourlyRateCents ?? 32500;
      const { creditDifferenceMinutes, payDifferenceCents } = calculatePayDifference(
        originalMinutes,
        newMinutes,
        hourlyRateCents
      );
      updateData.creditDifferenceMinutes = creditDifferenceMinutes;
      updateData.payDifferenceCents = payDifferenceCents;
    }

    const event = await db.payEvent.update({
      where: { id: eventId },
      data: updateData,
      include: {
        documentation: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return c.json({
      success: true,
      event: {
        ...event,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
        documentation: event.documentation.map((doc) => ({
          ...doc,
          createdAt: doc.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error updating pay event:", error);
    return c.json({ error: "Failed to update pay event" }, 500);
  }
});

// DELETE /api/pay-events/:id - Delete pay event
payEventsRouter.delete("/:id", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const eventId = c.req.param("id");

    // Verify ownership
    const existing = await db.payEvent.findFirst({
      where: { id: eventId, userId },
    });

    if (!existing) {
      return c.json({ error: "Pay event not found" }, 404);
    }

    // Delete event (documents will cascade delete)
    await db.payEvent.delete({
      where: { id: eventId },
    });

    return c.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error deleting pay event:", error);
    return c.json({ error: "Failed to delete pay event" }, 500);
  }
});

// DELETE /api/pay-events - Delete all pay events for user
payEventsRouter.delete("/", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);

    // Delete all pay event documents first (cascade)
    await db.payEventDocument.deleteMany({
      where: {
        payEvent: {
          userId,
        },
      },
    });

    // Delete all pay events
    const result = await db.payEvent.deleteMany({
      where: { userId },
    });

    return c.json({
      success: true,
      deletedCount: result.count,
      message: `Deleted ${result.count} pay event${result.count !== 1 ? "s" : ""}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error deleting all pay events:", error);
    return c.json({ error: "Failed to delete pay events" }, 500);
  }
});

// ============================================
// DOCUMENTATION ROUTES
// ============================================

// POST /api/pay-events/:id/documents - Add document to event
payEventsRouter.post("/:id/documents", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const eventId = c.req.param("id");
    const body = await c.req.json();
    const parsed = createPayEventDocumentRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    // Verify event ownership
    const event = await db.payEvent.findFirst({
      where: { id: eventId, userId },
    });

    if (!event) {
      return c.json({ error: "Pay event not found" }, 404);
    }

    const data = parsed.data;

    const document = await db.payEventDocument.create({
      data: {
        payEventId: eventId,
        docType: data.docType,
        contactName: data.contactName ?? null,
        contactId: data.contactId ?? null,
        contactPhone: data.contactPhone ?? null,
        content: data.content ?? null,
        attachmentUrl: data.attachmentUrl ?? null,
        interactionTimeISO: data.interactionTimeISO ?? null,
      },
    });

    return c.json({
      success: true,
      document: {
        ...document,
        createdAt: document.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error creating document:", error);
    return c.json({ error: "Failed to create document" }, 500);
  }
});

// DELETE /api/pay-events/:eventId/documents/:docId - Delete document
payEventsRouter.delete("/:eventId/documents/:docId", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const eventId = c.req.param("eventId");
    const docId = c.req.param("docId");

    // Verify event ownership
    const event = await db.payEvent.findFirst({
      where: { id: eventId, userId },
    });

    if (!event) {
      return c.json({ error: "Pay event not found" }, 404);
    }

    // Verify document belongs to event
    const document = await db.payEventDocument.findFirst({
      where: { id: docId, payEventId: eventId },
    });

    if (!document) {
      return c.json({ error: "Document not found" }, 404);
    }

    await db.payEventDocument.delete({
      where: { id: docId },
    });

    return c.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error deleting document:", error);
    return c.json({ error: "Failed to delete document" }, 500);
  }
});

// ============================================
// SUMMARY ROUTE - Get event counts by type
// ============================================

// GET /api/pay-events/summary - Get event summary
payEventsRouter.get("/summary", async (c) => {
  try {
    const userId = requireAuth(c.get("user")?.id);
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");

    const where: Record<string, unknown> = { userId };
    if (startDate) where.eventDateISO = { ...(where.eventDateISO as object || {}), gte: startDate };
    if (endDate) where.eventDateISO = { ...(where.eventDateISO as object || {}), lte: endDate };

    const events = await db.payEvent.findMany({
      where,
      select: {
        eventType: true,
        status: true,
        creditDifferenceMinutes: true,
        payDifferenceCents: true,
      },
    });

    // Group by event type
    const byType: Record<string, { count: number; totalCreditMinutes: number; totalPayCents: number }> = {};
    const byStatus: Record<string, number> = {};

    for (const event of events) {
      // By type
      if (!byType[event.eventType]) {
        byType[event.eventType] = { count: 0, totalCreditMinutes: 0, totalPayCents: 0 };
      }
      const bucket = byType[event.eventType]!;
      bucket.count++;
      bucket.totalCreditMinutes += event.creditDifferenceMinutes ?? 0;
      bucket.totalPayCents += event.payDifferenceCents ?? 0;

      // By status
      byStatus[event.status] = (byStatus[event.status] ?? 0) + 1;
    }

    return c.json({
      totalEvents: events.length,
      byType,
      byStatus,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error("Error fetching summary:", error);
    return c.json({ error: "Failed to fetch summary" }, 500);
  }
});
