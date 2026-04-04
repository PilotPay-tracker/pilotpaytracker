import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";

const sickRouter = new Hono<AppType>();

// ============================================
// Validation Schemas
// ============================================

const markSickSchema = z.object({
  tripId: z.string(),
  scope: z.enum(["entire_trip", "day", "legs"]),
  // For scope="day", specify dutyDayIds
  dutyDayIds: z.array(z.string()).optional(),
  // For scope="legs", specify legIds
  legIds: z.array(z.string()).optional(),
  // Optional user notes
  userNotes: z.string().optional(),
});

const undoSickSchema = z.object({
  sickCallEventId: z.string(),
  voidedReason: z.string().optional(),
});

// ============================================
// POST /api/sick/mark - Mark legs as SIK
// ============================================
sickRouter.post("/mark", zValidator("json", markSickSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const data = c.req.valid("json");
  const { tripId, scope, dutyDayIds, legIds, userNotes } = data;

  try {
    // 1. Verify trip belongs to user
    const trip = await db.trip.findFirst({
      where: { id: tripId, userId: user.id },
      include: {
        tripDutyDays: {
          include: { legs: true },
          orderBy: { dutyDayIndex: "asc" },
        },
      },
    });

    if (!trip) {
      return c.json({ error: "Trip not found" }, 404);
    }

    // 2. Determine which legs to mark as SIK
    let legsToMark: { id: string; creditMinutes: number; legDateLocal: string | null }[] = [];

    if (scope === "entire_trip") {
      // Mark all legs in the trip
      for (const dd of trip.tripDutyDays) {
        for (const leg of dd.legs) {
          legsToMark.push({
            id: leg.id,
            creditMinutes: leg.creditMinutes,
            legDateLocal: leg.legDateLocal || dd.dutyDate,
          });
        }
      }
    } else if (scope === "day" && dutyDayIds) {
      // Mark all legs in specified duty days
      for (const dd of trip.tripDutyDays) {
        if (dutyDayIds.includes(dd.id)) {
          for (const leg of dd.legs) {
            legsToMark.push({
              id: leg.id,
              creditMinutes: leg.creditMinutes,
              legDateLocal: leg.legDateLocal || dd.dutyDate,
            });
          }
        }
      }
    } else if (scope === "legs" && legIds) {
      // Mark specific legs
      for (const dd of trip.tripDutyDays) {
        for (const leg of dd.legs) {
          if (legIds.includes(leg.id)) {
            legsToMark.push({
              id: leg.id,
              creditMinutes: leg.creditMinutes,
              legDateLocal: leg.legDateLocal || dd.dutyDate,
            });
          }
        }
      }
    }

    if (legsToMark.length === 0) {
      return c.json({ error: "No legs found to mark as SIK" }, 400);
    }

    // 3. Calculate totals
    // If individual legs have 0 credit, use trip's total credit distributed proportionally
    let totalSickCreditMinutes = legsToMark.reduce((sum, leg) => sum + leg.creditMinutes, 0);

    // Fallback: if legs have no credit but trip does, use trip's total credit for entire_trip scope
    // or distribute proportionally for partial scope
    if (totalSickCreditMinutes === 0 && trip.totalCreditMinutes > 0) {
      const allLegsCount = trip.tripDutyDays.reduce((sum, dd) => sum + dd.legs.length, 0);
      if (scope === "entire_trip") {
        // Use full trip credit
        totalSickCreditMinutes = trip.totalCreditMinutes;
      } else if (allLegsCount > 0) {
        // Distribute proportionally based on legs marked vs total legs
        totalSickCreditMinutes = Math.round((trip.totalCreditMinutes * legsToMark.length) / allLegsCount);
      }
    }
    const uniqueDates = new Set(legsToMark.map((leg) => leg.legDateLocal).filter(Boolean));
    const sickDaysCount = uniqueDates.size;

    // Get date range
    const dates = legsToMark.map((leg) => leg.legDateLocal).filter(Boolean).sort();
    const startDateLocal = dates[0] || null;
    const endDateLocal = dates[dates.length - 1] || null;

    // 4. Generate auto notes
    const legSummaries = legsToMark.map((leg) => {
      const dd = trip.tripDutyDays.find((d) => d.legs.some((l) => l.id === leg.id));
      const legData = dd?.legs.find((l) => l.id === leg.id);
      if (legData) {
        return `${legData.origin || "?"}-${legData.destination || "?"} (FLT ${legData.flightNumber || "?"})`;
      }
      return leg.id;
    });

    // Phase 3: Check if trip is completed (backdated entry)
    const today = new Date().toISOString().slice(0, 10);
    const isTripCompleted = trip.endDate < today;
    const backdatedLabel = isTripCompleted ? " [Recorded After Trip (Backdated)]" : "";

    const autoNotes = `Pilot marked SIK for personal pay tracking. Credit classified as paid sick (SIK)${backdatedLabel}. Legs: ${legSummaries.join(", ")}.`;

    // 5. Create SickCallEvent and update legs in a transaction
    const result = await db.$transaction(async (tx) => {
      // Create the SickCallEvent
      const sickCallEvent = await tx.sickCallEvent.create({
        data: {
          userId: user.id,
          tripId,
          scope,
          startDateLocal,
          endDateLocal,
          sickCreditMinutes: totalSickCreditMinutes,
          sickDaysCount,
          autoNotes,
          userNotes,
          status: "active",
        },
      });

      // Create SickCallLegLink entries
      for (const leg of legsToMark) {
        await tx.sickCallLegLink.create({
          data: {
            sickCallEventId: sickCallEvent.id,
            tripDutyLegId: leg.id,
            legCreditMinutes: leg.creditMinutes,
            legDateLocal: leg.legDateLocal,
          },
        });

        // Update leg status to SIK
        await tx.tripDutyLeg.update({
          where: { id: leg.id },
          data: { legStatus: "SIK" },
        });
      }

      // Create LogEvent for audit trail
      const logEvent = await tx.logEvent.create({
        data: {
          userId: user.id,
          tripId,
          eventType: "sick",
          notes: userNotes,
          autoGeneratedNotes: autoNotes,
          status: "saved",
          changeSummaryJson: JSON.stringify({
            sickCallGroupId: sickCallEvent.sickCallGroupId,
            scope,
            legsMarked: legsToMark.length,
            sickCreditMinutes: totalSickCreditMinutes,
            sickDaysCount,
          }),
        },
      });

      // Link the legs to the LogEvent
      for (const leg of legsToMark) {
        await tx.logEventLeg.create({
          data: {
            logEventId: logEvent.id,
            tripDutyLegId: leg.id,
            isPrimaryLeg: false,
            changeSummary: JSON.stringify({ action: "marked_sick" }),
          },
        });
      }

      // Update SickCallEvent with logEventId
      await tx.sickCallEvent.update({
        where: { id: sickCallEvent.id },
        data: { logEventId: logEvent.id },
      });

      // PHASE 4: Deduct sick hours from sick bank
      const totalHoursUsed = totalSickCreditMinutes / 60;
      let bankDeductionResult: {
        balanceBefore: number;
        balanceAfter: number;
        hoursDeducted: number;
        coverageStatus: "FULL" | "PARTIAL" | "NONE";
      } | null = null;

      const sickBank = await tx.sickBank.findUnique({
        where: { userId: user.id },
      });

      if (sickBank && totalHoursUsed > 0) {
        const balanceBefore = sickBank.balanceHours;
        const balanceAfter = Math.max(0, balanceBefore - totalHoursUsed);
        const hoursDeducted = balanceBefore - balanceAfter;
        const coverageStatus: "FULL" | "PARTIAL" | "NONE" =
          hoursDeducted >= totalHoursUsed ? "FULL" :
          hoursDeducted > 0 ? "PARTIAL" : "NONE";

        // Update bank balance
        await tx.sickBank.update({
          where: { userId: user.id },
          data: {
            balanceHours: balanceAfter,
            capReached: balanceAfter >= sickBank.capHours,
          },
        });

        // Create usage log for audit trail
        await tx.sickUsageLog.create({
          data: {
            userId: user.id,
            startDate: startDateLocal || new Date().toISOString().slice(0, 10),
            endDate: endDateLocal || new Date().toISOString().slice(0, 10),
            hoursUsed: totalHoursUsed,
            tripId,
            coverageStatus,
            balanceBefore,
            balanceAfter,
            continuousCallId: sickCallEvent.sickCallGroupId,
            userNotes,
            autoSummary: `SIK marked: ${totalHoursUsed.toFixed(2)} hours deducted from sick bank`,
            status: "active",
          },
        });

        bankDeductionResult = {
          balanceBefore,
          balanceAfter,
          hoursDeducted,
          coverageStatus,
        };
      }

      return { sickCallEvent, logEvent, bankDeductionResult };
    });

    return c.json({
      success: true,
      sickCallEvent: result.sickCallEvent,
      logEventId: result.logEvent.id,
      summary: {
        legsMarked: legsToMark.length,
        sickCreditMinutes: totalSickCreditMinutes,
        sickDaysCount,
      },
      bankDeduction: result.bankDeductionResult,
    });
  } catch (error) {
    console.error("[Sick] Error marking sick:", error);
    return c.json({ error: "Failed to mark sick" }, 500);
  }
});

// ============================================
// POST /api/sick/undo - Undo a sick call (void) with bank refund
// Phase 2: Enhanced to properly refund hours back to sick bank
// ============================================
sickRouter.post("/undo", zValidator("json", undoSickSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { sickCallEventId, voidedReason } = c.req.valid("json");

  try {
    // 1. Find the SickCallEvent
    const sickCallEvent = await db.sickCallEvent.findFirst({
      where: { id: sickCallEventId, userId: user.id, status: "active" },
      include: { linkedLegs: true },
    });

    if (!sickCallEvent) {
      return c.json({ error: "Sick call event not found or already voided" }, 404);
    }

    // Calculate hours to refund (from linked legs)
    const hoursToRefund = sickCallEvent.sickCreditMinutes / 60;

    // 2. Void the event, restore legs, and refund bank in a transaction
    let bankRefundResult: { balanceBefore: number; balanceAfter: number } | null = null;

    await db.$transaction(async (tx) => {
      // Restore leg status to FLY
      for (const link of sickCallEvent.linkedLegs) {
        await tx.tripDutyLeg.update({
          where: { id: link.tripDutyLegId },
          data: { legStatus: "FLY" },
        });
      }

      // Void the SickCallEvent
      await tx.sickCallEvent.update({
        where: { id: sickCallEventId },
        data: {
          status: "voided",
          voidedAt: new Date(),
          voidedReason: voidedReason || "User undid sick marking",
        },
      });

      // Update the linked LogEvent status
      if (sickCallEvent.logEventId) {
        await tx.logEvent.update({
          where: { id: sickCallEvent.logEventId },
          data: {
            status: "voided",
            notes: `[VOIDED] ${voidedReason || "User undid sick marking"}`,
          },
        });
      }

      // PHASE 2: Refund hours back to sick bank
      if (hoursToRefund > 0) {
        const sickBank = await tx.sickBank.findUnique({
          where: { userId: user.id },
        });

        if (sickBank) {
          const balanceBefore = sickBank.balanceHours;
          const balanceAfter = Math.min(sickBank.balanceHours + hoursToRefund, sickBank.capHours);

          await tx.sickBank.update({
            where: { userId: user.id },
            data: {
              balanceHours: balanceAfter,
              capReached: balanceAfter >= sickBank.capHours,
            },
          });

          bankRefundResult = { balanceBefore, balanceAfter };

          // Create a reversal entry in SickUsageLog for audit trail
          await tx.sickUsageLog.create({
            data: {
              userId: user.id,
              startDate: sickCallEvent.startDateLocal || new Date().toISOString().slice(0, 10),
              endDate: sickCallEvent.endDateLocal || new Date().toISOString().slice(0, 10),
              hoursUsed: -hoursToRefund, // Negative to indicate refund
              tripId: sickCallEvent.tripId,
              coverageStatus: "REFUND",
              balanceBefore,
              balanceAfter,
              continuousCallId: `refund_${sickCallEvent.sickCallGroupId}`,
              userNotes: voidedReason || "SIK undone by user",
              autoSummary: `SIK Reversed: ${hoursToRefund.toFixed(2)} hours refunded`,
              status: "active",
            },
          });
        }
      }
    });

    return c.json({
      success: true,
      message: "Sick call voided successfully",
      legsRestored: sickCallEvent.linkedLegs.length,
      hoursRefunded: hoursToRefund,
      bankRefund: bankRefundResult,
      auditRecord: "SIK Reversed",
    });
  } catch (error) {
    console.error("[Sick] Error undoing sick:", error);
    return c.json({ error: "Failed to undo sick call" }, 500);
  }
});

// ============================================
// POST /api/sick/edit-scope - Edit SIK scope with reconciliation
// Phase 2: Change which legs are marked SIK, reconcile delta
// ============================================
const editScopeSchema = z.object({
  sickCallEventId: z.string(),
  newLegIds: z.array(z.string()), // The new set of legs to mark SIK
  userNotes: z.string().optional(),
});

sickRouter.post("/edit-scope", zValidator("json", editScopeSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { sickCallEventId, newLegIds, userNotes } = c.req.valid("json");

  try {
    // 1. Find the existing SickCallEvent
    const existingEvent = await db.sickCallEvent.findFirst({
      where: { id: sickCallEventId, userId: user.id, status: "active" },
      include: { linkedLegs: true },
    });

    if (!existingEvent) {
      return c.json({ error: "Sick call event not found or already voided" }, 404);
    }

    // 2. Get leg details for both old and new sets
    const oldLegIds = existingEvent.linkedLegs.map(l => l.tripDutyLegId);

    const allLegIds = [...new Set([...oldLegIds, ...newLegIds])];
    const allLegs = await db.tripDutyLeg.findMany({
      where: { id: { in: allLegIds } },
      include: { tripDutyDay: true },
    });

    const legMap = new Map(allLegs.map(l => [l.id, l]));

    // 3. Calculate credit changes
    const oldCreditMinutes = oldLegIds.reduce((sum, id) => {
      const leg = legMap.get(id);
      return sum + (leg?.creditMinutes || 0);
    }, 0);

    const newCreditMinutes = newLegIds.reduce((sum, id) => {
      const leg = legMap.get(id);
      return sum + (leg?.creditMinutes || 0);
    }, 0);

    const deltaMinutes = newCreditMinutes - oldCreditMinutes;
    const deltaHours = deltaMinutes / 60;

    // 4. Determine which legs to add/remove
    const legsToRemove = oldLegIds.filter(id => !newLegIds.includes(id));
    const legsToAdd = newLegIds.filter(id => !oldLegIds.includes(id));

    // 5. Get sick bank for reconciliation
    const sickBank = await db.sickBank.findUnique({
      where: { userId: user.id },
    });

    // 6. Apply changes in transaction
    let bankResult: { balanceBefore: number; balanceAfter: number; delta: number } | null = null;

    await db.$transaction(async (tx) => {
      // Remove legs that are no longer SIK
      for (const legId of legsToRemove) {
        await tx.tripDutyLeg.update({
          where: { id: legId },
          data: { legStatus: "FLY" },
        });

        await tx.sickCallLegLink.deleteMany({
          where: {
            sickCallEventId,
            tripDutyLegId: legId,
          },
        });
      }

      // Add new legs to SIK
      for (const legId of legsToAdd) {
        const leg = legMap.get(legId);
        if (!leg) continue;

        await tx.tripDutyLeg.update({
          where: { id: legId },
          data: { legStatus: "SIK" },
        });

        await tx.sickCallLegLink.create({
          data: {
            sickCallEventId,
            tripDutyLegId: legId,
            legCreditMinutes: leg.creditMinutes,
            legDateLocal: leg.tripDutyDay.dutyDate,
          },
        });
      }

      // Update SickCallEvent totals
      const uniqueDates = new Set(
        newLegIds
          .map(id => legMap.get(id)?.tripDutyDay.dutyDate)
          .filter(Boolean)
      );

      await tx.sickCallEvent.update({
        where: { id: sickCallEventId },
        data: {
          sickCreditMinutes: newCreditMinutes,
          sickDaysCount: uniqueDates.size,
          userNotes: userNotes || existingEvent.userNotes,
          autoNotes: `${existingEvent.autoNotes || ''} [Scope updated: ${deltaMinutes > 0 ? '+' : ''}${deltaMinutes} min]`,
        },
      });

      // Reconcile sick bank (only deduct/refund the DELTA)
      if (sickBank && deltaHours !== 0) {
        const balanceBefore = sickBank.balanceHours;
        let balanceAfter = balanceBefore;

        if (deltaHours > 0) {
          // Adding more sick hours - deduct from bank
          balanceAfter = Math.max(0, balanceBefore - deltaHours);
        } else {
          // Removing sick hours - refund to bank (up to cap)
          balanceAfter = Math.min(balanceBefore + Math.abs(deltaHours), sickBank.capHours);
        }

        await tx.sickBank.update({
          where: { userId: user.id },
          data: {
            balanceHours: balanceAfter,
            capReached: balanceAfter >= sickBank.capHours,
          },
        });

        bankResult = { balanceBefore, balanceAfter, delta: deltaHours };

        // Create audit entry
        await tx.sickUsageLog.create({
          data: {
            userId: user.id,
            startDate: existingEvent.startDateLocal || new Date().toISOString().slice(0, 10),
            endDate: existingEvent.endDateLocal || new Date().toISOString().slice(0, 10),
            hoursUsed: deltaHours,
            tripId: existingEvent.tripId,
            coverageStatus: deltaHours > 0 ? "SCOPE_INCREASE" : "SCOPE_DECREASE",
            balanceBefore,
            balanceAfter,
            continuousCallId: `scope_${existingEvent.sickCallGroupId}`,
            userNotes,
            autoSummary: `SIK Scope Updated: ${deltaHours > 0 ? '+' : ''}${deltaHours.toFixed(2)} hours (reconciled)`,
            status: "active",
          },
        });
      }
    });

    return c.json({
      success: true,
      message: "SIK scope updated successfully",
      changes: {
        legsRemoved: legsToRemove.length,
        legsAdded: legsToAdd.length,
        creditMinutesBefore: oldCreditMinutes,
        creditMinutesAfter: newCreditMinutes,
        deltaMinutes,
      },
      bankReconciliation: bankResult,
      auditRecord: "SIK Scope Updated (Reconciled)",
    });
  } catch (error) {
    console.error("[Sick] Error editing scope:", error);
    return c.json({ error: "Failed to edit SIK scope" }, 500);
  }
});

// ============================================
// GET /api/sick/trip/:tripId - Get sick info for a trip
// ============================================
sickRouter.get("/trip/:tripId", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tripId = c.req.param("tripId");

  try {
    // Get trip with legs
    const trip = await db.trip.findFirst({
      where: { id: tripId, userId: user.id },
      include: {
        tripDutyDays: {
          include: { legs: true },
          orderBy: { dutyDayIndex: "asc" },
        },
      },
    });

    if (!trip) {
      return c.json({ error: "Trip not found" }, 404);
    }

    // Get active sick call events for this trip
    const sickCallEvents = await db.sickCallEvent.findMany({
      where: { tripId, status: "active" },
      include: { linkedLegs: true },
      orderBy: { createdAt: "desc" },
    });

    // Calculate sick vs earned breakdown
    let earnedCreditMinutes = 0;
    let sickCreditMinutes = 0;
    const legStatuses: { [legId: string]: { status: string; creditMinutes: number } } = {};

    for (const dd of trip.tripDutyDays) {
      for (const leg of dd.legs) {
        legStatuses[leg.id] = {
          status: leg.legStatus,
          creditMinutes: leg.creditMinutes,
        };
        if (leg.legStatus === "SIK") {
          sickCreditMinutes += leg.creditMinutes;
        } else {
          earnedCreditMinutes += leg.creditMinutes;
        }
      }
    }

    // Determine trip-level status
    const allLegsAreSick = Object.values(legStatuses).every((l) => l.status === "SIK");
    const someLegsAreSick = Object.values(legStatuses).some((l) => l.status === "SIK");
    const tripSickStatus = allLegsAreSick ? "SIK" : someLegsAreSick ? "PARTIAL" : "FLY";

    // Calculate day-level statuses
    const dayStatuses: { [dutyDayId: string]: { status: string; sickLegs: number; totalLegs: number } } = {};
    for (const dd of trip.tripDutyDays) {
      const sickLegs = dd.legs.filter((l) => l.legStatus === "SIK").length;
      const totalLegs = dd.legs.length;
      dayStatuses[dd.id] = {
        status: sickLegs === 0 ? "FLY" : sickLegs === totalLegs ? "SIK" : "PARTIAL",
        sickLegs,
        totalLegs,
      };
    }

    return c.json({
      tripId,
      tripSickStatus,
      breakdown: {
        totalCreditMinutes: trip.totalCreditMinutes,
        earnedCreditMinutes,
        sickCreditMinutes,
      },
      dayStatuses,
      legStatuses,
      sickCallEvents,
      // Legal disclaimer
      disclaimer:
        "This is a personal historical record based on logged events. It does not represent an official sick bank, balance, or employer record.",
    });
  } catch (error) {
    console.error("[Sick] Error getting trip sick info:", error);
    return c.json({ error: "Failed to get sick info" }, 500);
  }
});

// ============================================
// GET /api/sick/summary - Rolling 12-month sick summary
// ============================================
sickRouter.get("/summary", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    // Calculate rolling 12-month window
    const now = new Date();
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const startDateISO = twelveMonthsAgo.toISOString().slice(0, 10); // YYYY-MM-DD format

    // 1. Sick Calls (distinct sick_call_group_id within rolling 12 months)
    const sickCallEvents = await db.sickCallEvent.findMany({
      where: {
        userId: user.id,
        status: "active",
        createdAt: { gte: twelveMonthsAgo },
      },
      include: { linkedLegs: true },
    });

    const sickCallsCount = sickCallEvents.length;

    // 2. Sick Days Covered (distinct legDateLocal within rolling 12 months)
    const allLegLinks = sickCallEvents.flatMap((e) => e.linkedLegs);
    const uniqueSickDates = new Set(
      allLegLinks
        .map((link) => link.legDateLocal)
        .filter((d): d is string => d !== null && d >= startDateISO)
    );
    const sickDaysCovered = uniqueSickDates.size;

    // 3. Total Sick Credit (sum of leg credits within rolling 12 months)
    const sickCreditMinutes = allLegLinks
      .filter((link) => link.legDateLocal !== null && link.legDateLocal >= startDateISO)
      .reduce((sum, link) => sum + link.legCreditMinutes, 0);

    // Format as HH:MM
    const formatMinutes = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}:${m.toString().padStart(2, "0")}`;
    };

    return c.json({
      rollingWindow: {
        startDate: startDateISO,
        endDate: now.toISOString().slice(0, 10),
      },
      summary: {
        sickCallsCount,
        sickDaysCovered,
        sickCreditMinutes,
        sickCreditFormatted: formatMinutes(sickCreditMinutes),
      },
      disclaimer:
        "This is a personal historical record based on logged events. It does not represent an official sick bank, balance, or employer record.",
    });
  } catch (error) {
    console.error("[Sick] Error getting summary:", error);
    return c.json({ error: "Failed to get sick summary" }, 500);
  }
});

// ============================================
// GET /api/sick/history - List all sick call events
// Phase 3: Enhanced with deep links to legs and SIK filter
// ============================================
sickRouter.get("/history", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const limit = parseInt(c.req.query("limit") || "50");
  const includeVoided = c.req.query("includeVoided") === "true";

  try {
    const events = await db.sickCallEvent.findMany({
      where: {
        userId: user.id,
        ...(includeVoided ? {} : { status: "active" }),
      },
      include: {
        linkedLegs: {
          include: {
            tripDutyLeg: {
              select: {
                id: true,
                flightNumber: true,
                origin: true,
                destination: true,
                creditMinutes: true,
                legStatus: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Phase 3: Get trip info for each event for deep linking
    const tripIds = [...new Set(events.map((e) => e.tripId))];
    const trips = await db.trip.findMany({
      where: { id: { in: tripIds } },
      select: {
        id: true,
        tripNumber: true,
        pairingId: true,
        startDate: true,
        endDate: true,
      },
    });
    const tripMap = new Map(trips.map((t) => [t.id, t]));

    // Phase 3: Format events with deep link info
    const formattedEvents = events.map((event) => {
      // Calculate coverage status
      const totalCreditMinutes = event.linkedLegs.reduce(
        (sum: number, link) => sum + link.legCreditMinutes,
        0
      );
      const hoursCovered = totalCreditMinutes / 60;

      // Determine if this was a backdated entry
      const isBackdated = event.autoNotes?.includes("Backdated") || false;

      // Get trip info for deep linking
      const trip = tripMap.get(event.tripId);

      return {
        ...event,
        // Phase 3: Deep link info
        deepLink: {
          type: "trip" as const,
          tripId: event.tripId,
          tripNumber: trip?.tripNumber || null,
          // Link to specific legs if available
          legIds: event.linkedLegs.map((link) => link.tripDutyLegId),
        },
        // Formatted summary for display
        displaySummary: `SIK applied — ${event.scope} — ${hoursCovered.toFixed(2)}h covered`,
        isBackdated,
        hoursApplied: hoursCovered,
        tripInfo: trip || null,
      };
    });

    return c.json({
      events: formattedEvents,
      count: formattedEvents.length,
      disclaimer:
        "This is a personal historical record based on logged events. It does not represent an official sick bank, balance, or employer record.",
    });
  } catch (error) {
    console.error("[Sick] Error getting history:", error);
    return c.json({ error: "Failed to get sick history" }, 500);
  }
});

// ============================================
// Upload-Detected SIK Support (Phase 1)
// ============================================

/**
 * POST /api/sick/preview-detected
 * Preview what SIK would be applied from upload-detected SIK data
 * Returns deduction preview without applying anything
 */
const previewDetectedSikSchema = z.object({
  sikDetected: z.object({
    detected: z.boolean(),
    dateRange: z.object({
      startDate: z.string(),
      endDate: z.string(),
    }).nullable().optional(),
    station: z.string().nullable().optional(),
    // NOTE: tafbHours is TAFB (Time Away From Base), NOT sick hours to deduct!
    // Actual sick credit comes from the trip's leg credit hours.
    tafbHours: z.number().nullable().optional(),
    rawText: z.string().nullable().optional(),
  }),
  // Optional: if user specifies a trip to match to
  tripId: z.string().optional(),
  // The schedule evidence ID (for proof attachment)
  scheduleEvidenceId: z.string().optional(),
  // Upload image URLs (for proof attachment)
  imageUrls: z.array(z.string()).optional(),
});

sickRouter.post("/preview-detected", zValidator("json", previewDetectedSikSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const data = c.req.valid("json");
  const { sikDetected } = data;

  if (!sikDetected?.detected || !sikDetected.dateRange) {
    return c.json({ error: "No valid SIK data provided" }, 400);
  }

  try {
    const { startDate, endDate } = sikDetected.dateRange;

    // 1. Find matching trips/legs for the date range
    const matchingTrips = await db.trip.findMany({
      where: {
        userId: user.id,
        OR: [
          // Trip overlaps with SIK date range
          {
            startDate: { lte: endDate },
            endDate: { gte: startDate },
          },
        ],
      },
      include: {
        tripDutyDays: {
          include: { legs: true },
          orderBy: { dutyDayIndex: "asc" },
        },
      },
      orderBy: { startDate: "asc" },
    });

    // 2. Calculate which legs would be marked SIK
    const targetLegs: Array<{
      legId: string;
      tripId: string;
      tripNumber: string | null;
      dutyDate: string;
      flightNumber: string | null;
      origin: string | null;
      destination: string | null;
      creditMinutes: number;
      alreadyMarkedSik: boolean;
    }> = [];

    for (const trip of matchingTrips) {
      for (const dd of trip.tripDutyDays) {
        // Check if duty day falls within SIK date range
        if (dd.dutyDate >= startDate && dd.dutyDate <= endDate) {
          for (const leg of dd.legs) {
            targetLegs.push({
              legId: leg.id,
              tripId: trip.id,
              tripNumber: trip.tripNumber,
              dutyDate: dd.dutyDate,
              flightNumber: leg.flightNumber,
              origin: leg.origin,
              destination: leg.destination,
              creditMinutes: leg.creditMinutes,
              alreadyMarkedSik: leg.legStatus === "SIK",
            });
          }
        }
      }
    }

    // 3. Calculate totals
    const legsToMark = targetLegs.filter(l => !l.alreadyMarkedSik);
    const alreadyMarked = targetLegs.filter(l => l.alreadyMarkedSik);
    // NOTE: We use trip credit hours for deduction, NOT TAFB (tafbHours is for reference only)
    const totalHoursRequested = legsToMark.reduce((sum, l) => sum + l.creditMinutes, 0) / 60;
    const hoursToDeduct = legsToMark.reduce((sum, l) => sum + l.creditMinutes, 0) / 60;

    // 4. Get sick bank balance for deduction preview
    const sickBank = await db.sickBank.findUnique({
      where: { userId: user.id },
    });

    const bankBalance = sickBank?.balanceHours ?? 0;
    const hoursAfterDeduction = Math.max(0, bankBalance - hoursToDeduct);
    const coveredHours = Math.min(hoursToDeduct, bankBalance);
    const unpaidHours = Math.max(0, hoursToDeduct - bankBalance);

    let coverageOutcome: "PAID" | "PARTIAL" | "UNPAID" = "PAID";
    if (unpaidHours >= hoursToDeduct) {
      coverageOutcome = "UNPAID";
    } else if (unpaidHours > 0) {
      coverageOutcome = "PARTIAL";
    }

    return c.json({
      preview: {
        dateRange: sikDetected.dateRange,
        station: sikDetected.station,
        tafbHoursFromUpload: sikDetected.tafbHours, // TAFB reference only, not for deduction
        matchingTrips: matchingTrips.map(t => ({
          id: t.id,
          tripNumber: t.tripNumber,
          startDate: t.startDate,
          endDate: t.endDate,
        })),
        legsToMark: legsToMark.length,
        legsAlreadyMarked: alreadyMarked.length,
        targetLegs,
      },
      deductionPreview: {
        hoursToDeduct: Math.round(hoursToDeduct * 100) / 100,
        bankBalanceBefore: Math.round(bankBalance * 100) / 100,
        bankBalanceAfter: Math.round(hoursAfterDeduction * 100) / 100,
        coveredHours: Math.round(coveredHours * 100) / 100,
        unpaidHours: Math.round(unpaidHours * 100) / 100,
        coverageOutcome,
      },
      canApply: legsToMark.length > 0,
      alreadyMarkedMessage: alreadyMarked.length > 0
        ? `${alreadyMarked.length} leg(s) already marked SIK — no change needed`
        : null,
    });
  } catch (error) {
    console.error("[Sick] Error previewing detected SIK:", error);
    return c.json({ error: "Failed to preview detected SIK" }, 500);
  }
});

/**
 * POST /api/sick/apply-detected
 * Apply SIK from upload-detected data
 * Uses the SAME logic as manual mark SIK to ensure consistency
 */
const applyDetectedSikSchema = z.object({
  sikDetected: z.object({
    detected: z.boolean(),
    dateRange: z.object({
      startDate: z.string(),
      endDate: z.string(),
    }).nullable().optional(),
    station: z.string().nullable().optional(),
    tafbHours: z.number().nullable().optional(), // TAFB reference only, not for deduction
    rawText: z.string().nullable().optional(),
  }),
  // Optional: specific leg IDs to mark (from preview)
  legIds: z.array(z.string()).optional(),
  // Schedule evidence ID for proof attachment
  scheduleEvidenceId: z.string().optional(),
  // Upload image URLs for proof attachment
  imageUrls: z.array(z.string()).optional(),
  // User notes
  userNotes: z.string().optional(),
});

sickRouter.post("/apply-detected", zValidator("json", applyDetectedSikSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const data = c.req.valid("json");
  const { sikDetected, legIds, scheduleEvidenceId, imageUrls, userNotes } = data;

  if (!sikDetected?.detected || !sikDetected.dateRange) {
    return c.json({ error: "No valid SIK data provided" }, 400);
  }

  try {
    const { startDate, endDate } = sikDetected.dateRange;

    // 1. Find legs to mark (either from provided legIds or by date range)
    let legsToMark: Array<{
      id: string;
      tripId: string;
      creditMinutes: number;
      legDateLocal: string | null;
      flightNumber: string | null;
      origin: string | null;
      destination: string | null;
    }> = [];

    if (legIds && legIds.length > 0) {
      // Use specific leg IDs from preview
      const legs = await db.tripDutyLeg.findMany({
        where: {
          id: { in: legIds },
          legStatus: { not: "SIK" }, // Skip already marked
        },
        include: {
          tripDutyDay: {
            include: { trip: true },
          },
        },
      });

      // Verify legs belong to this user
      legsToMark = legs
        .filter(l => l.tripDutyDay.trip.userId === user.id)
        .map(l => ({
          id: l.id,
          tripId: l.tripDutyDay.tripId,
          creditMinutes: l.creditMinutes,
          legDateLocal: l.tripDutyDay.dutyDate,
          flightNumber: l.flightNumber,
          origin: l.origin,
          destination: l.destination,
        }));
    } else {
      // Find by date range
      const matchingTrips = await db.trip.findMany({
        where: {
          userId: user.id,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        include: {
          tripDutyDays: {
            include: { legs: true },
          },
        },
      });

      for (const trip of matchingTrips) {
        for (const dd of trip.tripDutyDays) {
          if (dd.dutyDate >= startDate && dd.dutyDate <= endDate) {
            for (const leg of dd.legs) {
              if (leg.legStatus !== "SIK") {
                legsToMark.push({
                  id: leg.id,
                  tripId: trip.id,
                  creditMinutes: leg.creditMinutes,
                  legDateLocal: dd.dutyDate,
                  flightNumber: leg.flightNumber,
                  origin: leg.origin,
                  destination: leg.destination,
                });
              }
            }
          }
        }
      }
    }

    if (legsToMark.length === 0) {
      return c.json({
        success: true,
        message: "All legs in date range already marked SIK — no change needed",
        legsMarked: 0,
      });
    }

    // 2. Group legs by trip for creating SickCallEvents
    const legsByTrip = new Map<string, typeof legsToMark>();
    for (const leg of legsToMark) {
      if (!legsByTrip.has(leg.tripId)) {
        legsByTrip.set(leg.tripId, []);
      }
      legsByTrip.get(leg.tripId)!.push(leg);
    }

    // 3. Create SickCallEvent for each trip (using same logic as manual mark)
    const results: Array<{ tripId: string; sickCallEventId: string; legsMarked: number }> = [];

    await db.$transaction(async (tx) => {
      for (const [tripId, tripLegs] of legsByTrip) {
        const totalSickCreditMinutes = tripLegs.reduce((sum, leg) => sum + leg.creditMinutes, 0);
        const uniqueDates = new Set(tripLegs.map(leg => leg.legDateLocal).filter(Boolean));
        const sickDaysCount = uniqueDates.size;
        const dates = tripLegs.map(leg => leg.legDateLocal).filter(Boolean).sort();
        const startDateLocal = dates[0] || null;
        const endDateLocal = dates[dates.length - 1] || null;

        // Generate auto notes
        const legSummaries = tripLegs.map(leg =>
          `${leg.origin || "?"}-${leg.destination || "?"} (FLT ${leg.flightNumber || "?"})`
        );
        const autoNotes = `SIK applied from uploaded schedule (auto-detected). Source: ${sikDetected.rawText || 'Upload'}. Legs: ${legSummaries.join(", ")}.`;

        // Create SickCallEvent
        const sickCallEvent = await tx.sickCallEvent.create({
          data: {
            userId: user.id,
            tripId,
            scope: "legs",
            startDateLocal,
            endDateLocal,
            sickCreditMinutes: totalSickCreditMinutes,
            sickDaysCount,
            autoNotes,
            userNotes: userNotes || `Applied from upload-detected SIK (${startDate} to ${endDate})`,
            status: "active",
          },
        });

        // Create SickCallLegLink entries and update legs
        for (const leg of tripLegs) {
          await tx.sickCallLegLink.create({
            data: {
              sickCallEventId: sickCallEvent.id,
              tripDutyLegId: leg.id,
              legCreditMinutes: leg.creditMinutes,
              legDateLocal: leg.legDateLocal,
            },
          });

          await tx.tripDutyLeg.update({
            where: { id: leg.id },
            data: { legStatus: "SIK" },
          });
        }

        // Create LogEvent for audit trail
        await tx.logEvent.create({
          data: {
            userId: user.id,
            tripId,
            eventType: "sick",
            notes: userNotes,
            autoGeneratedNotes: autoNotes,
            status: "saved",
            changeSummaryJson: JSON.stringify({
              sickCallGroupId: sickCallEvent.sickCallGroupId,
              scope: "legs",
              legsMarked: tripLegs.length,
              sickCreditMinutes: totalSickCreditMinutes,
              sickDaysCount,
              source: "UPLOAD_DETECTED",
              scheduleEvidenceId,
            }),
          },
        });

        results.push({
          tripId,
          sickCallEventId: sickCallEvent.id,
          legsMarked: tripLegs.length,
        });
      }

      // 4. Attach proof (schedule upload) to the sick events if provided
      if (scheduleEvidenceId || (imageUrls && imageUrls.length > 0)) {
        // Create SickUsageLog entry for tracking (connects to SickBank)
        const totalHoursUsed = legsToMark.reduce((sum, l) => sum + l.creditMinutes, 0) / 60;

        // Get sick bank for deduction
        const sickBank = await tx.sickBank.findUnique({
          where: { userId: user.id },
        });

        if (sickBank) {
          const balanceBefore = sickBank.balanceHours;
          const balanceAfter = Math.max(0, balanceBefore - totalHoursUsed);
          const coverageStatus = balanceBefore >= totalHoursUsed ? "FULL" :
            balanceBefore > 0 ? "PARTIAL" : "NONE";

          // Create usage log
          const usageLog = await tx.sickUsageLog.create({
            data: {
              userId: user.id,
              startDate,
              endDate,
              hoursUsed: totalHoursUsed,
              tripId: results[0]?.tripId || null,
              tripNumber: null,
              coverageStatus,
              balanceBefore,
              balanceAfter,
              continuousCallId: `upload_${Date.now()}`,
              userNotes,
              autoSummary: `SIK from upload-detected schedule: ${Math.round(totalHoursUsed * 100) / 100} hours (${startDate} to ${endDate})`,
              status: "active",
            },
          });

          // Update bank balance
          await tx.sickBank.update({
            where: { userId: user.id },
            data: {
              balanceHours: balanceAfter,
              capReached: balanceAfter >= sickBank.capHours,
            },
          });

          // Attach proof images if provided
          if (imageUrls && imageUrls.length > 0) {
            for (const url of imageUrls) {
              await tx.sickUsageAttachment.create({
                data: {
                  sickUsageId: usageLog.id,
                  fileName: url.split("/").pop() || "upload.jpg",
                  fileUrl: url,
                  mimeType: url.endsWith(".png") ? "image/png" : "image/jpeg",
                  fileSize: 0,
                  description: "Auto-attached from schedule upload (SIK detected)",
                },
              });
            }
          }
        }
      }
    });

    return c.json({
      success: true,
      message: `Applied SIK to ${legsToMark.length} leg(s) from upload detection`,
      legsMarked: legsToMark.length,
      results,
      source: "UPLOAD_DETECTED",
    });
  } catch (error) {
    console.error("[Sick] Error applying detected SIK:", error);
    return c.json({ error: "Failed to apply detected SIK" }, 500);
  }
});

/**
 * POST /api/sick/check-already-marked
 * Check if legs for a date range are already marked SIK
 * Used to prevent double-marking
 */
sickRouter.post("/check-already-marked", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const body = await c.req.json();
    const { startDate, endDate, legIds } = body;

    let alreadyMarkedCount = 0;
    let totalLegsInRange = 0;

    if (legIds && legIds.length > 0) {
      const legs = await db.tripDutyLeg.findMany({
        where: { id: { in: legIds } },
        select: { id: true, legStatus: true },
      });
      totalLegsInRange = legs.length;
      alreadyMarkedCount = legs.filter(l => l.legStatus === "SIK").length;
    } else if (startDate && endDate) {
      const trips = await db.trip.findMany({
        where: {
          userId: user.id,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        include: {
          tripDutyDays: {
            include: { legs: true },
          },
        },
      });

      for (const trip of trips) {
        for (const dd of trip.tripDutyDays) {
          if (dd.dutyDate >= startDate && dd.dutyDate <= endDate) {
            for (const leg of dd.legs) {
              totalLegsInRange++;
              if (leg.legStatus === "SIK") {
                alreadyMarkedCount++;
              }
            }
          }
        }
      }
    }

    return c.json({
      totalLegsInRange,
      alreadyMarkedCount,
      unmarkedCount: totalLegsInRange - alreadyMarkedCount,
      allAlreadyMarked: alreadyMarkedCount >= totalLegsInRange && totalLegsInRange > 0,
    });
  } catch (error) {
    console.error("[Sick] Error checking already marked:", error);
    return c.json({ error: "Failed to check already marked" }, 500);
  }
});

export { sickRouter };
