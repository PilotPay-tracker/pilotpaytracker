/**
 * Trip Version Routes
 * API endpoints for Trip Version system, Pay Protection, and Roster Changes
 *
 * Routes:
 * GET  /api/trips/:tripId/versions - List all versions for a trip
 * GET  /api/trips/:tripId/versions/:versionId - Get specific version
 * GET  /api/trips/:tripId/pay-protection - Get pay protection state
 * GET  /api/trips/:tripId/changes - Get roster changes for a trip
 * GET  /api/trips/:tripId/review-changes - Get Review Changes screen data
 * POST /api/trips/:tripId/changes/:changeId/acknowledge - Acknowledge a change
 * GET  /api/roster-changes/pending - Get all pending changes across trips
 * GET  /api/records - List audit records
 * GET  /api/records/:recordId - Get single audit record
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db";
import type { AppType } from "../types";
import {
  createTripVersion,
  evaluatePayCredit,
  getPayProtection,
  generatePayOutcomeBanner,
  determineUserActionStatus,
  getActiveVersion,
  getTripVersions,
  setActiveVersion,
  formatMinutes,
  createAuditRecord,
} from "../lib/trip-version-engine";
import {
  compareTripVersions,
  saveRosterChanges,
  getPendingChanges,
  acknowledgeChange,
  areAllChangesAcknowledged,
} from "../lib/roster-diff-engine";
import type {
  TripVersionScheduleData,
  RosterChangeSeverity,
} from "../../../shared/contracts";

const tripVersionRoutes = new Hono<AppType>();

// ============================================
// GET /api/trips/:tripId/versions - List all versions
// ============================================

tripVersionRoutes.get("/:tripId/versions", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tripId } = c.req.param();

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  const versions = await getTripVersions(tripId);
  const activeVersion = versions.find((v) => v.isActiveVersion) || null;
  const payProtection = await getPayProtection(tripId);

  return c.json({
    versions: versions.map((v) => ({
      ...v,
      createdAt: v.createdAt.toISOString(),
    })),
    activeVersion: activeVersion
      ? { ...activeVersion, createdAt: activeVersion.createdAt.toISOString() }
      : null,
    payProtection: payProtection
      ? {
          ...payProtection,
          protectedSetAt: payProtection.protectedSetAt?.toISOString() || null,
          protectionAppliedAt: payProtection.protectionAppliedAt?.toISOString() || null,
          lastEvaluatedAt: payProtection.lastEvaluatedAt.toISOString(),
          createdAt: payProtection.createdAt.toISOString(),
          updatedAt: payProtection.updatedAt.toISOString(),
        }
      : null,
  });
});

// ============================================
// GET /api/trips/:tripId/versions/pay-protection - Get pay protection for trip
// ============================================

tripVersionRoutes.get("/:tripId/versions/pay-protection", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tripId } = c.req.param();

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  const payProtection = await getPayProtection(tripId);

  return c.json({
    payProtection: payProtection
      ? {
          tripId: payProtection.tripId,
          protectedCreditMinutes: payProtection.protectedCreditMinutes,
          currentCreditMinutes: payProtection.currentCreditMinutes,
          payCreditMinutes: payProtection.payCreditMinutes,
          payCreditSource: payProtection.payCreditSource,
          isPayProtected: payProtection.isPayProtected,
          protectedAt: payProtection.protectedSetAt?.toISOString(),
          lastEvaluatedAt: payProtection.lastEvaluatedAt.toISOString(),
        }
      : null,
  });
});

// ============================================
// GET /api/trips/:tripId/versions/status - Get trip change status
// ============================================

tripVersionRoutes.get("/:tripId/versions/status", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tripId } = c.req.param();

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
    select: { id: true, pendingVersionId: true },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  // Get pending changes
  const pendingChanges = await db.rosterChange.findMany({
    where: {
      tripId,
      userId: user.id,
      requiresAck: true,
      acknowledged: false,
    },
    orderBy: { createdAt: "desc" },
  });

  // Get active version
  const activeVersion = await db.tripVersion.findFirst({
    where: { tripId, isActiveVersion: true },
  });

  // Get pay protection
  const payProtection = await getPayProtection(tripId);

  const hasChangePending = pendingChanges.length > 0;
  const changePendingSince = hasChangePending
    ? pendingChanges[pendingChanges.length - 1]?.createdAt.toISOString()
    : undefined;

  return c.json({
    hasChangePending,
    changePendingSince,
    pendingVersionId: trip.pendingVersionId || undefined,
    activeVersionId: activeVersion?.id,
    pendingChanges: pendingChanges.map((c) => ({
      id: c.id,
      tripId: c.tripId,
      changeType: c.changeType,
      severity: c.severity,
      fieldChanged: c.fieldChanged,
      oldValue: c.oldValue,
      newValue: c.newValue,
      changeSummary: c.changeSummary,
      creditDiffMinutes: c.creditDiffMinutes,
      estimatedPayDiffCents: c.estimatedPayDiffCents,
      isPremiumCandidate: c.isPremiumCandidate,
      premiumCandidateType: c.premiumCandidateType,
      premiumConfidence: c.premiumConfidence,
      requiresAck: c.requiresAck,
      acknowledged: c.acknowledged,
      acknowledgedAt: c.acknowledgedAt?.toISOString(),
      createdAt: c.createdAt.toISOString(),
    })),
    payProtection: payProtection
      ? {
          tripId: payProtection.tripId,
          protectedCreditMinutes: payProtection.protectedCreditMinutes,
          currentCreditMinutes: payProtection.currentCreditMinutes,
          payCreditMinutes: payProtection.payCreditMinutes,
          payCreditSource: payProtection.payCreditSource,
          isPayProtected: payProtection.isPayProtected,
          protectedAt: payProtection.protectedSetAt?.toISOString(),
          lastEvaluatedAt: payProtection.lastEvaluatedAt.toISOString(),
        }
      : undefined,
  });
});

// ============================================
// GET /api/trips/:tripId/versions/:versionId - Get specific version
// ============================================

tripVersionRoutes.get("/:tripId/versions/:versionId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tripId, versionId } = c.req.param();

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  const version = await db.tripVersion.findFirst({
    where: { id: versionId, tripId },
  });

  if (!version) {
    return c.json({ error: "Version not found" }, 404);
  }

  let scheduleData: TripVersionScheduleData;
  try {
    scheduleData = JSON.parse(version.scheduleData);
  } catch {
    return c.json({ error: "Invalid schedule data" }, 500);
  }

  return c.json({
    version: {
      ...version,
      createdAt: version.createdAt.toISOString(),
    },
    scheduleData,
  });
});

// ============================================
// GET /api/trips/:tripId/pay-protection - Get pay protection state
// ============================================

tripVersionRoutes.get("/:tripId/pay-protection", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tripId } = c.req.param();

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  const payProtection = await getPayProtection(tripId);

  if (!payProtection) {
    return c.json({
      payProtection: null,
      payOutcome: null,
      userActionStatus: "no_action_required" as const,
    });
  }

  // Get pending changes to determine if review is required
  const pendingChanges = await getPendingChanges(tripId);
  const hasPendingChanges = pendingChanges.length > 0;
  const hasPremiumCandidates = pendingChanges.some((c) => c.isPremiumCandidate);

  // Generate pay outcome banner
  const payOutcome = generatePayOutcomeBanner(
    {
      protectedCreditMinutes: payProtection.protectedCreditMinutes,
      currentCreditMinutes: payProtection.currentCreditMinutes,
      payCreditMinutes: payProtection.payCreditMinutes,
      payCreditSource: payProtection.payCreditSource as "protected" | "current",
      isPayProtected: payProtection.isPayProtected,
      creditDeltaMinutes: payProtection.creditDeltaMinutes,
      estimatedDeltaCents: payProtection.estimatedDeltaCents,
    },
    hasPendingChanges
  );

  // Determine user action status
  const userActionStatus = determineUserActionStatus(
    hasPendingChanges,
    hasPendingChanges, // requiresAck
    hasPremiumCandidates
  );

  return c.json({
    payProtection: {
      ...payProtection,
      protectedSetAt: payProtection.protectedSetAt?.toISOString() || null,
      protectionAppliedAt: payProtection.protectionAppliedAt?.toISOString() || null,
      lastEvaluatedAt: payProtection.lastEvaluatedAt.toISOString(),
      createdAt: payProtection.createdAt.toISOString(),
      updatedAt: payProtection.updatedAt.toISOString(),
    },
    payOutcome,
    userActionStatus,
  });
});

// ============================================
// GET /api/trips/:tripId/changes - Get roster changes
// ============================================

tripVersionRoutes.get("/:tripId/changes", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tripId } = c.req.param();

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  const changes = await db.rosterChange.findMany({
    where: { tripId },
    orderBy: { createdAt: "desc" },
  });

  const pendingAckCount = changes.filter((c) => c.requiresAck && !c.acknowledged).length;
  const hasPremiumCandidates = changes.some((c) => c.isPremiumCandidate && !c.acknowledged);

  return c.json({
    changes: changes.map((c) => ({
      ...c,
      acknowledgedAt: c.acknowledgedAt?.toISOString() || null,
      createdAt: c.createdAt.toISOString(),
    })),
    pendingAckCount,
    hasPremiumCandidates,
  });
});

// ============================================
// GET /api/trips/:tripId/review-changes - Review Changes screen data
// ============================================

tripVersionRoutes.get("/:tripId/review-changes", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tripId } = c.req.param();

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  // Get versions
  const versions = await getTripVersions(tripId);
  const activeVersion = versions.find((v) => v.isActiveVersion);
  const latestVersion = versions[0]; // Sorted desc by version number

  if (!latestVersion) {
    return c.json({ error: "No versions found" }, 404);
  }

  // Get pay protection
  const payProtection = await getPayProtection(tripId);

  // Get pending changes
  const pendingChanges = await getPendingChanges(tripId);
  const hasPendingChanges = pendingChanges.length > 0;
  const hasPremiumCandidates = pendingChanges.some((c) => c.isPremiumCandidate);

  // Parse schedule data
  let oldScheduleData: TripVersionScheduleData | null = null;
  let newScheduleData: TripVersionScheduleData;

  try {
    newScheduleData = JSON.parse(latestVersion.scheduleData);
    if (activeVersion && activeVersion.id !== latestVersion.id) {
      oldScheduleData = JSON.parse(activeVersion.scheduleData);
    }
  } catch {
    return c.json({ error: "Invalid schedule data" }, 500);
  }

  // Generate pay outcome banner
  const payOutcome = payProtection
    ? generatePayOutcomeBanner(
        {
          protectedCreditMinutes: payProtection.protectedCreditMinutes,
          currentCreditMinutes: payProtection.currentCreditMinutes,
          payCreditMinutes: payProtection.payCreditMinutes,
          payCreditSource: payProtection.payCreditSource as "protected" | "current",
          isPayProtected: payProtection.isPayProtected,
          creditDeltaMinutes: payProtection.creditDeltaMinutes,
          estimatedDeltaCents: payProtection.estimatedDeltaCents,
        },
        hasPendingChanges
      )
    : {
        state: "unchanged" as const,
        title: "No Pay Data",
        message: "Pay protection not initialized.",
        subtext: null,
        protectedCreditMinutes: 0,
        currentCreditMinutes: newScheduleData.totals.creditMinutes,
        payCreditMinutes: newScheduleData.totals.creditMinutes,
        creditDeltaMinutes: 0,
        estimatedDeltaCents: null,
      };

  // Determine user action status
  const userActionStatus = determineUserActionStatus(
    hasPendingChanges,
    hasPendingChanges,
    hasPremiumCandidates
  );

  // Build premium candidates list
  const premiumCandidates = pendingChanges
    .filter((c) => c.isPremiumCandidate)
    .map((c) => ({
      changeId: c.id,
      candidateType: c.premiumCandidateType as any,
      confidence: (c.premiumConfidence || "medium") as any,
      reason: c.changeSummary,
      affectedDates: c.affectedDays ? JSON.parse(c.affectedDays) : [],
    }));

  return c.json({
    data: {
      payOutcome,
      userActionStatus,
      oldVersion: activeVersion
        ? { ...activeVersion, createdAt: activeVersion.createdAt.toISOString() }
        : null,
      oldScheduleData,
      newVersion: { ...latestVersion, createdAt: latestVersion.createdAt.toISOString() },
      newScheduleData,
      changes: pendingChanges.map((c) => ({
        ...c,
        acknowledgedAt: c.acknowledgedAt?.toISOString() || null,
        createdAt: c.createdAt.toISOString(),
      })),
      creditSummary: {
        protectedCreditMinutes: payProtection?.protectedCreditMinutes || 0,
        newRosterCreditMinutes: newScheduleData.totals.creditMinutes,
        payCreditUsedMinutes: payProtection?.payCreditMinutes || newScheduleData.totals.creditMinutes,
        explanation: "We always use the higher of your awarded credit or your current roster credit.",
      },
      premiumCandidates,
    },
  });
});

// ============================================
// POST /api/trips/:tripId/changes/:changeId/acknowledge
// ============================================

const acknowledgeChangeSchema = z.object({
  createLogEvent: z.boolean().optional(),
});

tripVersionRoutes.post(
  "/:tripId/changes/:changeId/acknowledge",
  zValidator("json", acknowledgeChangeSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { tripId, changeId } = c.req.param();
    const body = c.req.valid("json");

    // Verify trip ownership
    const trip = await db.trip.findFirst({
      where: { id: tripId, userId: user.id },
    });

    if (!trip) {
      return c.json({ error: "Trip not found" }, 404);
    }

    // Acknowledge the change
    const change = await acknowledgeChange(changeId, user.id);

    // Check if all changes are acknowledged
    const allAcknowledged = await areAllChangesAcknowledged(tripId);

    // If all changes acknowledged, set latest version as active
    let logEventId: string | null = null;
    if (allAcknowledged) {
      const versions = await getTripVersions(tripId);
      const latestVersion = versions[0];
      if (latestVersion) {
        await setActiveVersion(tripId, latestVersion.id, user.id);
      }
    }

    // Create log event if requested
    if (body.createLogEvent && change.isPremiumCandidate) {
      // Create draft log event
      const logEvent = await db.payEvent.create({
        data: {
          userId: user.id,
          eventType: mapPremiumTypeToEventType(change.premiumCandidateType),
          airlineLabel: "UPS",
          eventDateISO: new Date().toISOString().split("T")[0] ?? new Date().toISOString().substring(0, 10),
          tripId,
          title: `Premium Pay — ${change.premiumCandidateType}`,
          description: change.changeSummary,
          originalCreditMinutes: null,
          newCreditMinutes: null,
          creditDifferenceMinutes: change.creditDiffMinutes,
          payDifferenceCents: change.estimatedPayDiffCents,
          status: "open",
          needsReview: false,
        },
      });
      logEventId = logEvent.id;

      // Update change with log event reference
      await db.rosterChange.update({
        where: { id: changeId },
        data: {
          logEventId: logEvent.id,
          logEventStatus: "draft",
        },
      });
    }

    // Create audit record
    const auditRecord = await createAuditRecord({
      userId: user.id,
      recordType: "roster_acknowledged",
      tripId,
      rosterChangeId: changeId,
      logEventId: logEventId || undefined,
      title: "Roster Change Acknowledged",
      summary: `User acknowledged: ${change.changeSummary}`,
      severity: change.severity as RosterChangeSeverity,
    });

    return c.json({
      success: true,
      change: {
        ...change,
        acknowledgedAt: change.acknowledgedAt?.toISOString() || null,
        createdAt: change.createdAt.toISOString(),
      },
      logEventId,
      auditRecordId: auditRecord.id,
    });
  }
);

// ============================================
// GET /api/roster-changes/pending - All pending changes
// ============================================

const rosterChangesRoutes = new Hono<AppType>();

rosterChangesRoutes.get("/pending", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const severityFilter = c.req.query("severityFilter");

  const whereClause: any = {
    userId: user.id,
    requiresAck: true,
    acknowledged: false,
  };

  if (severityFilter) {
    whereClause.severity = severityFilter;
  }

  const changes = await db.rosterChange.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    include: {
      trip: {
        select: { tripNumber: true, startDate: true },
      },
    },
  });

  // Group by trip
  const byTrip = new Map<string, { tripId: string; tripNumber: string | null; changeCount: number; severity: RosterChangeSeverity }>();
  for (const change of changes) {
    const existing = byTrip.get(change.tripId);
    if (existing) {
      existing.changeCount++;
      // Upgrade severity if needed
      if (change.severity === "major" || (change.severity === "moderate" && existing.severity === "minor")) {
        existing.severity = change.severity as RosterChangeSeverity;
      }
    } else {
      byTrip.set(change.tripId, {
        tripId: change.tripId,
        tripNumber: change.trip?.tripNumber || null,
        changeCount: 1,
        severity: change.severity as RosterChangeSeverity,
      });
    }
  }

  return c.json({
    changes: changes.map((c) => ({
      ...c,
      tripNumber: c.trip?.tripNumber || null,
      tripStartDate: c.trip?.startDate || "",
      acknowledgedAt: c.acknowledgedAt?.toISOString() || null,
      createdAt: c.createdAt.toISOString(),
    })),
    totalCount: changes.length,
    byTrip: Array.from(byTrip.values()),
  });
});

// ============================================
// POST /api/roster-changes/acknowledge - Batch acknowledge changes
// ============================================

const batchAcknowledgeSchema = z.object({
  tripId: z.string(),
  changeIds: z.array(z.string()),
});

rosterChangesRoutes.post(
  "/acknowledge",
  zValidator("json", batchAcknowledgeSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { tripId, changeIds } = c.req.valid("json");

    // Verify trip ownership
    const trip = await db.trip.findFirst({
      where: { id: tripId, userId: user.id },
    });

    if (!trip) {
      return c.json({ error: "Trip not found" }, 404);
    }

    if (changeIds.length === 0) {
      return c.json({ error: "No changes to acknowledge" }, 400);
    }

    // Acknowledge all specified changes
    const now = new Date();
    const acknowledgedChanges = await db.rosterChange.updateMany({
      where: {
        id: { in: changeIds },
        tripId,
        userId: user.id,
        acknowledged: false,
      },
      data: {
        acknowledged: true,
        acknowledgedAt: now,
      },
    });

    // Check if all changes for this trip are now acknowledged
    const allAcknowledged = await areAllChangesAcknowledged(tripId);

    // If all changes acknowledged, set the latest version as active
    if (allAcknowledged) {
      const versions = await getTripVersions(tripId);
      const latestVersion = versions[0]; // Sorted by version number desc
      if (latestVersion && !latestVersion.isActiveVersion) {
        await setActiveVersion(tripId, latestVersion.id, user.id);
      }
    }

    // Create audit record for the batch acknowledgment
    await createAuditRecord({
      userId: user.id,
      recordType: "roster_acknowledged",
      tripId,
      title: `Acknowledged ${acknowledgedChanges.count} roster change${acknowledgedChanges.count !== 1 ? 's' : ''}`,
      summary: `User acknowledged ${acknowledgedChanges.count} change${acknowledgedChanges.count !== 1 ? 's' : ''} for trip ${trip.tripNumber || tripId.slice(0, 8)}`,
    });

    return c.json({
      success: true,
      acknowledgedCount: acknowledgedChanges.count,
      allChangesAcknowledged: allAcknowledged,
    });
  }
);

// ============================================
// POST /api/roster-changes/acknowledge-all - Acknowledge ALL roster changes across all trips
// ============================================

rosterChangesRoutes.post("/acknowledge-all", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Find all unacknowledged roster changes for this user
  const unacknowledgedChanges = await db.rosterChange.findMany({
    where: {
      userId: user.id,
      acknowledged: false,
    },
    select: { id: true, tripId: true },
  });

  if (unacknowledgedChanges.length === 0) {
    return c.json({
      success: true,
      acknowledgedCount: 0,
      message: "No unacknowledged roster changes found",
    });
  }

  // Bulk update all to acknowledged
  const now = new Date();
  const result = await db.rosterChange.updateMany({
    where: {
      userId: user.id,
      acknowledged: false,
    },
    data: {
      acknowledged: true,
      acknowledgedAt: now,
    },
  });

  // Get unique trip IDs to update their active versions
  const tripIds = [...new Set(unacknowledgedChanges.map((c) => c.tripId))];

  // For each trip, check if all changes are now acknowledged and set latest version as active
  for (const tripId of tripIds) {
    const allAcknowledged = await areAllChangesAcknowledged(tripId);
    if (allAcknowledged) {
      const versions = await getTripVersions(tripId);
      const latestVersion = versions[0];
      if (latestVersion && !latestVersion.isActiveVersion) {
        await setActiveVersion(tripId, latestVersion.id, user.id);
      }
    }
  }

  return c.json({
    success: true,
    acknowledgedCount: result.count,
    message: `Successfully acknowledged ${result.count} roster change${result.count !== 1 ? "s" : ""}`,
  });
});

// ============================================
// GET /api/roster-changes/trip/:tripId/pending - Get pending changes for a trip
// ============================================

rosterChangesRoutes.get("/trip/:tripId/pending", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tripId } = c.req.param();

  // Verify trip ownership
  const trip = await db.trip.findFirst({
    where: { id: tripId, userId: user.id },
  });

  if (!trip) {
    return c.json({ error: "Trip not found" }, 404);
  }

  const changes = await db.rosterChange.findMany({
    where: {
      tripId,
      userId: user.id,
      requiresAck: true,
      acknowledged: false,
    },
    orderBy: { createdAt: "desc" },
  });

  return c.json({
    changes: changes.map((c) => ({
      ...c,
      acknowledgedAt: c.acknowledgedAt?.toISOString() || null,
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

// ============================================
// AUDIT RECORDS ROUTES
// ============================================

const recordsRoutes = new Hono<AppType>();

// GET /api/records - List audit records
recordsRoutes.get("/", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const tripId = c.req.query("tripId");
  const recordType = c.req.query("recordType");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  const whereClause: any = { userId: user.id };

  if (tripId) whereClause.tripId = tripId;
  if (recordType) whereClause.recordType = recordType;
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate);
    if (endDate) whereClause.createdAt.lte = new Date(endDate);
  }

  const [records, totalCount] = await Promise.all([
    db.auditRecord.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.auditRecord.count({ where: whereClause }),
  ]);

  return c.json({
    records: records.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    totalCount,
    hasMore: offset + records.length < totalCount,
  });
});

// GET /api/records/:recordId - Get single audit record
recordsRoutes.get("/:recordId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { recordId } = c.req.param();

  const record = await db.auditRecord.findFirst({
    where: { id: recordId, userId: user.id },
  });

  if (!record) {
    return c.json({ error: "Record not found" }, 404);
  }

  // Get related version if exists
  let relatedVersion = null;
  if (record.tripVersionId) {
    relatedVersion = await db.tripVersion.findUnique({
      where: { id: record.tripVersionId },
    });
  }

  // Get related change if exists
  let relatedChange = null;
  if (record.rosterChangeId) {
    relatedChange = await db.rosterChange.findUnique({
      where: { id: record.rosterChangeId },
    });
  }

  return c.json({
    record: {
      ...record,
      createdAt: record.createdAt.toISOString(),
    },
    relatedVersion: relatedVersion
      ? { ...relatedVersion, createdAt: relatedVersion.createdAt.toISOString() }
      : null,
    relatedChange: relatedChange
      ? {
          ...relatedChange,
          acknowledgedAt: relatedChange.acknowledgedAt?.toISOString() || null,
          createdAt: relatedChange.createdAt.toISOString(),
        }
      : null,
  });
});

// GET /api/records/summary - Get summary statistics for records
recordsRoutes.get("/summary/stats", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  const whereClause: any = { userId: user.id };
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate);
    if (endDate) whereClause.createdAt.lte = new Date(endDate);
  }

  // Get counts by record type
  const allRecords = await db.auditRecord.findMany({
    where: whereClause,
    select: {
      recordType: true,
      severity: true,
      creditContext: true,
    },
  });

  // Count by type
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = { minor: 0, moderate: 0, major: 0 };
  let totalPayProtectionEvents = 0;
  let totalCreditDelta = 0;

  for (const record of allRecords) {
    byType[record.recordType] = (byType[record.recordType] || 0) + 1;

    if (record.severity) {
      bySeverity[record.severity] = (bySeverity[record.severity] || 0) + 1;
    }

    if (record.recordType === "pay_protection_applied") {
      totalPayProtectionEvents++;
    }

    // Parse credit context for delta
    if (record.creditContext) {
      try {
        const ctx = JSON.parse(record.creditContext);
        if (ctx.delta) totalCreditDelta += ctx.delta;
      } catch {
        // Ignore parse errors
      }
    }
  }

  return c.json({
    totalRecords: allRecords.length,
    byType,
    bySeverity,
    payProtectionEvents: totalPayProtectionEvents,
    totalCreditDeltaMinutes: totalCreditDelta,
    recordTypeLabels: getRecordTypeLabels(),
  });
});

// GET /api/records/trip/:tripId/statement - Generate statement for a trip
recordsRoutes.get("/trip/:tripId/statement", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tripId } = c.req.param();

  // Get trip details
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

  // Get all records for this trip
  const records = await db.auditRecord.findMany({
    where: { tripId, userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  // Get pay protection status
  const payProtection = await db.tripPayProtection.findUnique({
    where: { tripId },
  });

  // Get all versions for this trip
  const versions = await db.tripVersion.findMany({
    where: { tripId },
    orderBy: { versionNumber: "asc" },
  });

  // Get roster changes
  const rosterChanges = await db.rosterChange.findMany({
    where: { tripId },
    orderBy: { createdAt: "asc" },
  });

  // Build statement
  const statement = {
    tripNumber: trip.tripNumber,
    pairingId: trip.pairingId,
    dates: `${trip.startDate} to ${trip.endDate}`,
    dutyDays: trip.dutyDaysCount,

    // Credit summary
    creditSummary: {
      totalCreditMinutes: trip.totalCreditMinutes,
      protectedCreditMinutes: payProtection?.protectedCreditMinutes ?? trip.totalCreditMinutes,
      payCreditMinutes: payProtection?.payCreditMinutes ?? trip.totalCreditMinutes,
      isPayProtected: payProtection?.isPayProtected ?? false,
      payCreditSource: payProtection?.payCreditSource ?? "current",
    },

    // Version history
    versionCount: versions.length,
    versions: versions.map((v) => ({
      versionNumber: v.versionNumber,
      isBaseline: v.isBaselineVersion,
      isActive: v.isActiveVersion,
      creditMinutes: v.totalCreditMinutes,
      createdAt: v.createdAt.toISOString(),
    })),

    // Change history
    changeCount: rosterChanges.length,
    changes: rosterChanges.map((ch) => ({
      changeType: ch.changeType,
      severity: ch.severity,
      summary: ch.changeSummary,
      creditDiff: ch.creditDiffMinutes,
      acknowledged: ch.acknowledged,
      isPremiumCandidate: ch.isPremiumCandidate,
      premiumType: ch.premiumCandidateType,
      createdAt: ch.createdAt.toISOString(),
    })),

    // Audit trail
    auditTrail: records.map((r) => ({
      type: r.recordType,
      typeLabel: getRecordTypeLabel(r.recordType),
      title: r.title,
      summary: r.summary,
      severity: r.severity,
      createdAt: r.createdAt.toISOString(),
    })),
  };

  return c.json({ statement });
});

// GET /api/records/export - Export records as JSON (for user download)
recordsRoutes.get("/export", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const tripId = c.req.query("tripId");

  const whereClause: any = { userId: user.id };
  if (tripId) whereClause.tripId = tripId;
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate);
    if (endDate) whereClause.createdAt.lte = new Date(endDate);
  }

  const records = await db.auditRecord.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
  });

  // Format for export
  const exportData = {
    exportedAt: new Date().toISOString(),
    userId: user.id,
    filters: { startDate, endDate, tripId },
    recordCount: records.length,
    records: records.map((r) => ({
      id: r.id,
      type: r.recordType,
      typeLabel: getRecordTypeLabel(r.recordType),
      title: r.title,
      summary: r.summary,
      severity: r.severity,
      tripId: r.tripId,
      creditContext: r.creditContext ? JSON.parse(r.creditContext) : null,
      payContext: r.payContext ? JSON.parse(r.payContext) : null,
      linkedEvidence: r.linkedEvidence ? JSON.parse(r.linkedEvidence) : null,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      createdAt: r.createdAt.toISOString(),
    })),
  };

  // Set headers for file download
  c.header("Content-Type", "application/json");
  c.header(
    "Content-Disposition",
    `attachment; filename="pilot-pay-records-${new Date().toISOString().split("T")[0]}.json"`
  );

  return c.json(exportData);
});

// ============================================
// HELPERS
// ============================================

function mapPremiumTypeToEventType(premiumType: string | null): string {
  switch (premiumType) {
    case "layover_premium":
      return "PREMIUM_TRIGGER";
    case "additional_flying":
      return "SCHEDULE_CHANGE";
    case "duty_extension":
      return "DUTY_EXTENSION";
    case "reassignment":
      return "REASSIGNMENT";
    case "pay_protection":
      return "PAY_PROTECTION";
    case "deadhead_rig":
      return "DEADHEAD";
    default:
      return "OTHER";
  }
}

/**
 * Get human-readable label for a record type
 */
function getRecordTypeLabel(recordType: string): string {
  const labels: Record<string, string> = {
    trip_imported: "Trip Imported",
    roster_change_detected: "Roster Change Detected",
    roster_updated_minor: "Minor Roster Update",
    roster_acknowledged: "Change Acknowledged",
    pay_protection_applied: "Pay Protection Applied",
    credit_increased: "Credit Increased",
    premium_detected: "Premium Pay Detected",
    log_event_created: "Log Event Created",
    log_event_submitted: "Log Event Submitted",
    manual_review_recommended: "Manual Review Recommended",
  };
  return labels[recordType] || recordType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get all record type labels as a map
 */
function getRecordTypeLabels(): Record<string, string> {
  return {
    trip_imported: "Trip Imported",
    roster_change_detected: "Roster Change Detected",
    roster_updated_minor: "Minor Roster Update",
    roster_acknowledged: "Change Acknowledged",
    pay_protection_applied: "Pay Protection Applied",
    credit_increased: "Credit Increased",
    premium_detected: "Premium Pay Detected",
    log_event_created: "Log Event Created",
    log_event_submitted: "Log Event Submitted",
    manual_review_recommended: "Manual Review Recommended",
  };
}

export { tripVersionRoutes, rosterChangesRoutes, recordsRoutes };
