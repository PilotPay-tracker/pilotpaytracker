/**
 * Premium Event Engine
 *
 * Handles detection of premium pay candidates and suggests Log Events.
 * Per Phase 5 spec:
 * - System SUGGESTS but NEVER auto-claims
 * - User must explicitly create Log Events
 * - Evidence is auto-attached from schedule changes
 *
 * PREMIUM CATEGORIES:
 * 1. Pay Protection: Credit decreased but protected
 * 2. Additional Flying: Trip extended, new legs added
 * 3. Duty Extension: Report earlier or release later
 * 4. Reassignment: Route changes, equipment changes
 * 5. Layover Premium: Short rest, hotel change
 */

import { db } from "../db";
import type {
  PremiumCandidateType,
  RosterChangeSeverity,
} from "../../../shared/contracts";

// ============================================
// TYPES
// ============================================

export interface PremiumCandidate {
  rosterChangeId: string;
  changeType: string;
  severity: RosterChangeSeverity;
  premiumType: PremiumCandidateType;
  confidence: "high" | "medium" | "low";
  suggestedEventType: string;
  suggestedTitle: string;
  suggestedDescription: string;
  estimatedPayImpactCents: number;
  creditDiffMinutes: number;
  evidenceIds: string[];
}

export interface LogEventDraft {
  tripId: string;
  userId: string;
  eventType: string;
  title: string;
  description: string;
  estimatedValueCents: number;
  creditMinutes: number;
  linkedRosterChangeIds: string[];
  linkedEvidenceIds: string[];
  status: "draft";
}

// ============================================
// PREMIUM DETECTION
// ============================================

/**
 * Get all premium candidates for a trip's roster changes
 * Returns suggestions for Log Events the user might want to create
 */
export async function getPremiumCandidatesForTrip(tripId: string): Promise<PremiumCandidate[]> {
  const rosterChanges = await db.rosterChange.findMany({
    where: {
      tripId,
      isPremiumCandidate: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const candidates: PremiumCandidate[] = [];

  for (const change of rosterChanges) {
    const candidate = mapChangeToPremiumCandidate(change);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

/**
 * Map a roster change to a premium candidate suggestion
 */
function mapChangeToPremiumCandidate(change: {
  id: string;
  changeType: string;
  severity: string;
  premiumCandidateType: string | null;
  premiumConfidence: string | null;
  creditDiffMinutes: number;
  estimatedPayDiffCents: number;
  changeSummary: string;
}): PremiumCandidate | null {
  if (!change.premiumCandidateType) return null;

  const premiumType = change.premiumCandidateType as PremiumCandidateType;
  const confidence = (change.premiumConfidence || "medium") as "high" | "medium" | "low";

  // Generate suggestion based on premium type
  const suggestion = generatePremiumSuggestion(
    premiumType,
    change.changeType,
    change.creditDiffMinutes,
    change.changeSummary
  );

  return {
    rosterChangeId: change.id,
    changeType: change.changeType,
    severity: change.severity as RosterChangeSeverity,
    premiumType,
    confidence,
    suggestedEventType: suggestion.eventType,
    suggestedTitle: suggestion.title,
    suggestedDescription: suggestion.description,
    estimatedPayImpactCents: change.estimatedPayDiffCents,
    creditDiffMinutes: change.creditDiffMinutes,
    evidenceIds: [], // Will be populated from schedule evidence
  };
}

/**
 * Generate suggestion text for a premium candidate
 */
function generatePremiumSuggestion(
  premiumType: PremiumCandidateType,
  changeType: string,
  creditDiffMinutes: number,
  changeSummary: string
): { eventType: string; title: string; description: string } {
  switch (premiumType) {
    case "pay_protection":
      return {
        eventType: "COMPANY_CHANGE",
        title: "Pay Protection Claim",
        description: `Company-initiated schedule change reduced your credit. ${changeSummary}. Your original credit is protected.`,
      };

    case "additional_flying":
      return {
        eventType: "ADDITIONAL_FLYING",
        title: "Additional Flying",
        description: `New flying added to your trip. ${changeSummary}. Review for premium pay eligibility.`,
      };

    case "duty_extension":
      return {
        eventType: "DUTY_EXTENSION",
        title: "Duty Period Extension",
        description: `Your duty period was extended. ${changeSummary}. May qualify for extension premium.`,
      };

    case "reassignment":
      return {
        eventType: "REASSIGNMENT",
        title: "Trip Reassignment",
        description: `You were reassigned to different flying. ${changeSummary}. Check contract for reassignment pay.`,
      };

    case "layover_premium":
      return {
        eventType: "LAYOVER_CHANGE",
        title: "Layover Change",
        description: `Your layover was modified. ${changeSummary}. May qualify for short rest premium.`,
      };

    default:
      return {
        eventType: "OTHER",
        title: "Schedule Change",
        description: `Schedule change detected. ${changeSummary}. Review for premium pay eligibility.`,
      };
  }
}

// ============================================
// LOG EVENT DRAFTING
// ============================================

/**
 * Create a draft Log Event from a premium candidate
 * User must review and submit - this is NOT auto-claimed
 *
 * Uses the existing PayEvent model with status="draft"
 */
export async function createLogEventDraft(
  userId: string,
  tripId: string,
  candidate: PremiumCandidate
): Promise<{ draftId: string }> {
  // Get trip info for dates
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: { startDate: true, tripNumber: true },
  });

  // Create draft pay event using existing schema
  const draft = await db.payEvent.create({
    data: {
      userId,
      tripId,
      eventType: candidate.suggestedEventType,
      title: candidate.suggestedTitle,
      description: candidate.suggestedDescription,
      status: "draft",
      eventDateISO: trip?.startDate || new Date().toISOString().split("T")[0]!,
      originalTripNumber: trip?.tripNumber,
      creditDifferenceMinutes: Math.abs(candidate.creditDiffMinutes),
      payDifferenceCents: candidate.estimatedPayImpactCents,
      // Store premium metadata in triggeredRuleIds as JSON
      triggeredRuleIds: JSON.stringify({
        premiumType: candidate.premiumType,
        confidence: candidate.confidence,
        changeType: candidate.changeType,
        severity: candidate.severity,
        rosterChangeId: candidate.rosterChangeId,
        autoGenerated: true,
        generatedAt: new Date().toISOString(),
      }),
    },
  });

  // Link the roster change to this draft
  await db.rosterChange.update({
    where: { id: candidate.rosterChangeId },
    data: {
      logEventId: draft.id,
      logEventStatus: "draft",
    },
  });

  return { draftId: draft.id };
}

/**
 * Get all draft Log Events for a user
 */
export async function getDraftLogEvents(userId: string) {
  return db.payEvent.findMany({
    where: {
      userId,
      status: "draft",
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Submit a draft Log Event (user explicitly claims)
 */
export async function submitLogEvent(
  eventId: string,
  userId: string,
  updates?: {
    title?: string;
    description?: string;
    creditDifferenceMinutes?: number;
  }
): Promise<{ success: boolean; eventId: string }> {
  // Verify ownership
  const event = await db.payEvent.findUnique({
    where: { id: eventId },
  });

  if (!event || event.userId !== userId) {
    throw new Error("Event not found or access denied");
  }

  if (event.status !== "draft") {
    throw new Error("Only draft events can be submitted");
  }

  // Update and submit
  const submitted = await db.payEvent.update({
    where: { id: eventId },
    data: {
      status: "submitted",
      title: updates?.title ?? event.title,
      description: updates?.description ?? event.description,
      creditDifferenceMinutes: updates?.creditDifferenceMinutes ?? event.creditDifferenceMinutes,
    },
  });

  // Get linked roster change from triggeredRuleIds
  let rosterChangeId: string | null = null;
  try {
    const metadata = JSON.parse(event.triggeredRuleIds || "{}");
    rosterChangeId = metadata.rosterChangeId;
  } catch {
    // Ignore parse errors
  }

  // Update linked roster change
  if (rosterChangeId) {
    await db.rosterChange.update({
      where: { id: rosterChangeId },
      data: {
        logEventStatus: "submitted",
      },
    });
  }

  // Create audit record
  await db.auditRecord.create({
    data: {
      userId,
      recordType: "log_event_submitted",
      tripId: event.tripId,
      logEventId: eventId,
      title: "Log Event Submitted",
      summary: `User submitted pay claim: ${submitted.title}. Credit diff: ${submitted.creditDifferenceMinutes ?? 0} min.`,
    },
  });

  return { success: true, eventId };
}

/**
 * Dismiss a draft Log Event (user decides not to claim)
 */
export async function dismissLogEvent(
  eventId: string,
  userId: string,
  reason?: string
): Promise<{ success: boolean }> {
  const event = await db.payEvent.findUnique({
    where: { id: eventId },
  });

  if (!event || event.userId !== userId) {
    throw new Error("Event not found or access denied");
  }

  // Get existing metadata
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(event.triggeredRuleIds || "{}");
  } catch {
    // Ignore parse errors
  }

  // Update status to dismissed
  await db.payEvent.update({
    where: { id: eventId },
    data: {
      status: "dismissed",
      triggeredRuleIds: JSON.stringify({
        ...metadata,
        dismissedAt: new Date().toISOString(),
        dismissReason: reason,
      }),
    },
  });

  // Update linked roster change
  const rosterChangeId = metadata.rosterChangeId as string | undefined;
  if (rosterChangeId) {
    await db.rosterChange.update({
      where: { id: rosterChangeId },
      data: {
        logEventStatus: "dismissed",
      },
    });
  }

  return { success: true };
}

// ============================================
// EVIDENCE LINKING
// ============================================

/**
 * Get evidence (schedule screenshots) that support a premium candidate
 */
export async function getEvidenceForChange(rosterChangeId: string) {
  const change = await db.rosterChange.findUnique({
    where: { id: rosterChangeId },
    select: {
      tripId: true,
      oldVersionId: true,
      newVersionId: true,
    },
  });

  if (!change) return [];

  // Get schedule evidence for this trip
  const evidence = await db.scheduleEvidence.findMany({
    where: {
      tripId: change.tripId,
      parseStatus: "success",
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      imageUrl: true,
      sourceType: true,
      createdAt: true,
    },
  });

  return evidence;
}

/**
 * Link evidence to a Log Event via PayEventDocument
 */
export async function linkEvidenceToEvent(
  eventId: string,
  evidenceIds: string[]
): Promise<void> {
  // Get the schedule evidence records
  const evidenceRecords = await db.scheduleEvidence.findMany({
    where: { id: { in: evidenceIds } },
    select: { id: true, imageUrl: true, sourceType: true },
  });

  // Create PayEventDocument for each evidence
  for (const evidence of evidenceRecords) {
    await db.payEventDocument.create({
      data: {
        payEventId: eventId,
        docType: "schedule_screenshot",
        attachmentUrl: evidence.imageUrl,
        content: `Schedule evidence (${evidence.sourceType}) - ID: ${evidence.id}`,
      },
    });
  }
}

/**
 * Get all premium candidates across all trips for a user
 * Useful for dashboard/notification display
 */
export async function getAllPremiumCandidatesForUser(userId: string): Promise<{
  tripId: string;
  tripNumber: string | null;
  candidates: PremiumCandidate[];
}[]> {
  // Get all trips with premium candidates
  const tripsWithCandidates = await db.rosterChange.findMany({
    where: {
      userId,
      isPremiumCandidate: true,
      logEventId: null, // Not yet converted to log event
    },
    select: {
      tripId: true,
    },
    distinct: ["tripId"],
  });

  const results: {
    tripId: string;
    tripNumber: string | null;
    candidates: PremiumCandidate[];
  }[] = [];

  for (const { tripId } of tripsWithCandidates) {
    const trip = await db.trip.findUnique({
      where: { id: tripId },
      select: { tripNumber: true },
    });

    const candidates = await getPremiumCandidatesForTrip(tripId);
    if (candidates.length > 0) {
      results.push({
        tripId,
        tripNumber: trip?.tripNumber ?? null,
        candidates,
      });
    }
  }

  return results;
}
