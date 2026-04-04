/**
 * Audit Trail Hooks
 * React Query hooks for fetching and managing audit trail data
 */

import { useSession } from "./useSession";
import { useTrips } from "./useTripsData";
import { usePayEvents } from "./usePayEvents";
import { useSnapshots, useScheduleChanges } from "./useSnapshotData";
import { useAllPendingRosterChanges, type RosterChangeWithTrip, formatRosterChangeType } from "./useRosterChanges";
import { useLogEvents as useLogEventsHook } from "./useLogEvents";
import type {
  AuditTrailEntry,
  AuditTrailEntryType,
  AuditConfidenceLevel,
  GetAuditTrailResponse,
  Trip,
  PayEvent,
  ScheduleSnapshot,
  ScheduleChange,
  LogEventListItem,
} from "@/lib/contracts";

// Filter type for audit trail
export interface AuditTrailFilters {
  payPeriodId?: string;
  startDate?: string;
  endDate?: string;
  entryTypes?: AuditTrailEntryType[];
  search?: string;
}

// Query keys
export const auditTrailKeys = {
  all: ["audit-trail"] as const,
  list: (filters: AuditTrailFilters) => [...auditTrailKeys.all, filters] as const,
};

/**
 * Group trips by their upload session
 * Uses a sliding window approach - trips within 5 minutes of the LAST trip in a group
 * are considered part of the same upload session. This handles cases where:
 * - Multiple images are processed sequentially
 * - AI parsing takes varying amounts of time
 * - Large uploads create many trips
 */
function groupTripsByUpload(trips: Trip[]): Map<string, Trip[]> {
  const groups = new Map<string, Trip[]>();

  // Sort trips by createdAt
  const sortedTrips = [...trips].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  for (const trip of sortedTrips) {
    const tripTime = new Date(trip.createdAt).getTime();
    let foundGroup = false;

    // Find an existing group where this trip fits
    // Use sliding window: compare to the MOST RECENT trip in the group
    for (const [groupKey, groupTrips] of groups) {
      // Get the most recent trip in the group
      const groupTimes = groupTrips.map((t) => new Date(t.createdAt).getTime());
      const latestInGroup = Math.max(...groupTimes);

      // If this trip is within 5 minutes of the latest trip in the group, add it
      if (tripTime - latestInGroup < 300000) { // 5 minute sliding window
        groupTrips.push(trip);
        foundGroup = true;
        break;
      }
    }

    if (!foundGroup) {
      groups.set(trip.createdAt, [trip]);
    }
  }

  return groups;
}

/**
 * Transform existing data into audit trail entries
 * This aggregates data from trips, pay events, schedule changes, roster changes, log events, etc.
 */
function buildAuditTrailFromData(
  trips: Trip[] | undefined,
  payEvents: PayEvent[] | undefined,
  snapshots: ScheduleSnapshot[] | undefined,
  changes: ScheduleChange[] | undefined,
  rosterChanges: RosterChangeWithTrip[] | undefined,
  logEvents: LogEventListItem[] | undefined,
  filters: AuditTrailFilters
): AuditTrailEntry[] {
  const entries: AuditTrailEntry[] = [];

  // Add trip entries - GROUP BY UPLOAD SESSION
  if (trips && trips.length > 0) {
    const tripGroups = groupTripsByUpload(trips);

    for (const [uploadTimestamp, groupTrips] of tripGroups) {
      // Calculate totals for the group
      const totalCredits = groupTrips.reduce((sum, t) => sum + t.totalCreditMinutes, 0);
      const totalPay = groupTrips.reduce((sum, t) => sum + t.totalPayCents, 0);
      const totalLegs = groupTrips.reduce((sum, t) => sum + t.legCount, 0);
      const anyNeedsReview = groupTrips.some((t) => t.needsReview);
      const allCompleted = groupTrips.every((t) => t.status === "completed");

      // Find earliest start date and latest end date
      const startDates = groupTrips.map((t) => t.startDate).sort();
      const endDates = groupTrips.map((t) => t.endDate).sort();
      const earliestStart = startDates[0];
      const latestEnd = endDates[endDates.length - 1];

      // Build trip numbers summary (show first 2-3, then "+X more")
      const tripNumbers = groupTrips
        .map((t) => t.tripNumber)
        .filter((n): n is string => !!n);
      let tripSummary: string;
      if (tripNumbers.length === 0) {
        tripSummary = groupTrips.length === 1
          ? `${groupTrips[0].legCount} legs`
          : `${groupTrips.length} trips · ${totalLegs} legs`;
      } else if (tripNumbers.length <= 2) {
        tripSummary = tripNumbers.join(", ");
      } else {
        tripSummary = `${tripNumbers.slice(0, 2).join(", ")} +${tripNumbers.length - 2} more`;
      }

      // Create single entry for the upload
      entries.push({
        id: `trip-upload-${uploadTimestamp}`,
        entryType: "TRIP_IMPORTED",
        timestamp: uploadTimestamp,
        title: allCompleted ? "Schedule Confirmed" : "Schedule Imported",
        subtitle: formatDateRange(earliestStart, latestEnd),
        status: anyNeedsReview ? "open" : "resolved",
        tripId: groupTrips[0].id, // Link to first trip for navigation
        tripIds: groupTrips.map((t) => t.id), // All trip IDs for batch operations
        payEventId: null,
        payPeriodId: null,
        scheduleChangeId: null,
        payRuleId: null,
        exportPacketId: null,
        creditMinutes: totalCredits,
        payImpactCents: totalPay,
        confidence: "high",
        needsReview: anyNeedsReview,
        suggestionStatus: null,
        attachmentCount: 0,
        routeSummary: tripSummary,
        dateRangeStart: earliestStart,
        dateRangeEnd: latestEnd,
        notes: groupTrips.length > 1 ? `${groupTrips.length} trips uploaded` : null,
        explanation: null,
        tripCount: groupTrips.length,
      });
    }
  }

  // Add pay event entries
  if (payEvents) {
    for (const event of payEvents) {
      entries.push({
        id: `pay-event-${event.id}`,
        entryType: "PAY_EVENT",
        timestamp: event.createdAt,
        title: event.title,
        subtitle: formatPayEventType(event.eventType),
        status: (event.status === "resolved" || event.status === "disputed")
          ? (event.status as "resolved" | "disputed")
          : "open",
        tripId: event.tripId,
        payEventId: event.id,
        payPeriodId: null,
        scheduleChangeId: null,
        payRuleId: null,
        exportPacketId: null,
        creditMinutes: event.creditDifferenceMinutes,
        payImpactCents: event.payDifferenceCents,
        confidence: null,
        needsReview: event.needsReview,
        suggestionStatus: null,
        attachmentCount: event.documentation?.length ?? 0,
        routeSummary: event.originalTripNumber || event.newTripNumber,
        dateRangeStart: event.eventDateISO,
        dateRangeEnd: null,
        notes: event.description,
        explanation: null,
      });
    }
  }

  // Add schedule change entries (detected changes)
  if (changes) {
    for (const change of changes) {
      if (!change.acknowledged) {
        entries.push({
          id: `change-${change.id}`,
          entryType: "DETECTED_CHANGE",
          timestamp: change.createdAt,
          title: "Schedule Change Detected",
          subtitle: formatChangeType(change.changeType),
          status: "open",
          tripId: null,
          payEventId: change.payEventId,
          payPeriodId: null,
          scheduleChangeId: change.id,
          payRuleId: null,
          exportPacketId: null,
          creditMinutes: change.creditDiffMinutes,
          payImpactCents: change.estimatedPayDiffCents,
          confidence: change.severity === "pay_impact" ? "high" : change.severity === "warning" ? "medium" : "low",
          needsReview: !change.acknowledged,
          suggestionStatus: null,
          attachmentCount: 0,
          routeSummary: change.tripNumber,
          dateRangeStart: change.tripDate,
          dateRangeEnd: null,
          notes: null,
          explanation: `${change.fieldChanged}: ${change.oldValue} → ${change.newValue}`,
        });
      }
    }
  }

  // Add roster change entries (from version-aware import system)
  // GROUP changes by trip + detection time to avoid showing 34 individual records
  if (rosterChanges && rosterChanges.length > 0) {
    // Group roster changes by trip ID and detection time (within 60 seconds)
    const rosterChangeGroups = new Map<string, RosterChangeWithTrip[]>();

    for (const change of rosterChanges) {
      // Skip if we already have a schedule change entry for this (avoid duplicates)
      const alreadyHasEntry = entries.some(
        (e) => e.scheduleChangeId === change.id || e.id === `roster-change-${change.id}`
      );
      if (alreadyHasEntry) continue;

      // Create group key based on tripId + minute timestamp (groups within same minute)
      const changeTime = new Date(change.createdAt);
      const minuteKey = `${change.tripId}-${changeTime.getFullYear()}-${changeTime.getMonth()}-${changeTime.getDate()}-${changeTime.getHours()}-${changeTime.getMinutes()}`;

      if (!rosterChangeGroups.has(minuteKey)) {
        rosterChangeGroups.set(minuteKey, []);
      }
      rosterChangeGroups.get(minuteKey)!.push(change);
    }

    // Create one audit entry per group
    for (const [groupKey, groupChanges] of rosterChangeGroups) {
      if (groupChanges.length === 0) continue;

      const firstChange = groupChanges[0];

      // Calculate aggregate stats
      const totalCreditDiff = groupChanges.reduce((sum, c) => sum + c.creditDiffMinutes, 0);
      const totalPayDiff = groupChanges.reduce((sum, c) => sum + c.estimatedPayDiffCents, 0);
      const anyRequiresAck = groupChanges.some((c) => c.requiresAck && !c.acknowledged);
      const anyPremiumCandidate = groupChanges.some((c) => c.isPremiumCandidate);

      // Determine highest severity
      const severities = groupChanges.map((c) => c.severity);
      const highestSeverity = severities.includes("major")
        ? "major"
        : severities.includes("moderate")
        ? "moderate"
        : "minor";

      // Determine confidence based on highest severity
      const confidence: AuditConfidenceLevel =
        highestSeverity === "major" ? "high" :
        highestSeverity === "moderate" ? "medium" : "low";

      // Build summary of change types
      const changeTypeCounts = new Map<string, number>();
      for (const c of groupChanges) {
        const type = formatRosterChangeType(c.changeType);
        changeTypeCounts.set(type, (changeTypeCounts.get(type) || 0) + 1);
      }

      // Build title and explanation
      let title: string;
      let explanation: string;

      if (groupChanges.length === 1) {
        // Single change - use detailed info
        title = formatRosterChangeType(firstChange.changeType);
        explanation = firstChange.changeSummary;
        if (firstChange.oldValue && firstChange.newValue) {
          explanation = `${firstChange.fieldChanged || "Value"}: ${firstChange.oldValue} → ${firstChange.newValue}`;
        }
      } else {
        // Multiple changes - summarize
        title = `${groupChanges.length} Schedule Changes`;
        const typeList = Array.from(changeTypeCounts.entries())
          .map(([type, count]) => count > 1 ? `${type} (×${count})` : type)
          .slice(0, 3) // Show max 3 types
          .join(", ");
        explanation = typeList;
        if (changeTypeCounts.size > 3) {
          explanation += ` +${changeTypeCounts.size - 3} more`;
        }
      }

      // Add credit difference info if significant
      if (totalCreditDiff !== 0) {
        const sign = totalCreditDiff > 0 ? "+" : "";
        const hours = Math.floor(Math.abs(totalCreditDiff) / 60);
        const mins = Math.abs(totalCreditDiff) % 60;
        explanation += ` (${sign}${hours}:${mins.toString().padStart(2, "0")} credit)`;
      }

      entries.push({
        id: `roster-change-${firstChange.id}`,
        entryType: "DETECTED_CHANGE",
        timestamp: firstChange.createdAt,
        title,
        subtitle: firstChange.tripNumber
          ? `Trip ${firstChange.tripNumber} · ${highestSeverity.charAt(0).toUpperCase() + highestSeverity.slice(1)}`
          : highestSeverity.charAt(0).toUpperCase() + highestSeverity.slice(1),
        status: anyRequiresAck ? "open" : "resolved",
        tripId: firstChange.tripId,
        payEventId: firstChange.logEventId ?? null,
        payPeriodId: null,
        scheduleChangeId: firstChange.id, // Use first change ID for navigation
        payRuleId: null,
        exportPacketId: null,
        creditMinutes: totalCreditDiff,
        payImpactCents: totalPayDiff,
        confidence,
        needsReview: anyRequiresAck,
        suggestionStatus: anyPremiumCandidate ? "pending" : null,
        attachmentCount: 0,
        routeSummary: firstChange.tripNumber ?? null,
        dateRangeStart: firstChange.tripStartDate,
        dateRangeEnd: null,
        notes: groupChanges.length > 1
          ? `${groupChanges.length} changes detected`
          : anyPremiumCandidate
          ? `Premium candidate: ${firstChange.premiumCandidateType?.replace(/_/g, " ")}`
          : null,
        explanation,
        // Store all change IDs for batch acknowledgment
        rosterChangeIds: groupChanges.map((c) => c.id),
      });
    }
  }

  // Add schedule uploaded entries from snapshots
  if (snapshots) {
    for (const snapshot of snapshots) {
      entries.push({
        id: `snapshot-${snapshot.id}`,
        entryType: "STATEMENT_UPLOADED",
        timestamp: snapshot.createdAt,
        title: "Schedule Uploaded",
        subtitle: formatDateRange(snapshot.startDate, snapshot.endDate),
        status: "resolved",
        tripId: null,
        payEventId: null,
        payPeriodId: null,
        scheduleChangeId: null,
        payRuleId: null,
        exportPacketId: null,
        creditMinutes: snapshot.totalCreditMinutes,
        payImpactCents: null,
        confidence: snapshot.confidence > 0.8 ? "high" : snapshot.confidence > 0.5 ? "medium" : "low",
        needsReview: false,
        suggestionStatus: null,
        attachmentCount: JSON.parse(snapshot.imageUrls || "[]").length,
        routeSummary: `${snapshot.tripCount} trips, ${snapshot.legCount} legs`,
        dateRangeStart: snapshot.startDate,
        dateRangeEnd: snapshot.endDate,
        notes: null,
        explanation: null,
      });
    }
  }

  // Add log event entries (sick events, company revisions, etc.)
  if (logEvents) {
    for (const event of logEvents) {
      // Use change summary from API response (already parsed)
      const changeSummary = event.changeSummary;

      // Determine entry type and title based on event type
      let title = "Log Event";
      let subtitle = event.eventType;
      let entryType: AuditTrailEntryType = "PAY_EVENT";

      if (event.eventType === "sick") {
        title = "Sick Time Used (SIK)";
        const hoursUsed = changeSummary?.sickCreditMinutes ? (changeSummary.sickCreditMinutes / 60).toFixed(1) : "0";
        const legsCount = changeSummary?.legsMarked ?? 0;
        subtitle = `${hoursUsed} hrs · ${legsCount} legs marked`;
        entryType = "PAY_EVENT"; // Show as a pay event since it affects pay
      } else if (event.eventType === "company_revision" || event.eventType === "schedule_change") {
        title = "Company Revision";
        subtitle = "Schedule Change";
        entryType = "DETECTED_CHANGE";
      }

      // Parse trip dates from tripDates string (format: "YYYY-MM-DD - YYYY-MM-DD")
      let startDate: string | null = null;
      let endDate: string | null = null;
      if (event.tripDates) {
        const [start, end] = event.tripDates.split(" - ");
        startDate = start ?? null;
        endDate = end ?? null;
      }
      const tripDateRange = startDate && endDate ? formatDateRange(startDate, endDate) : null;

      entries.push({
        id: `log-event-${event.id}`,
        entryType,
        timestamp: event.createdAt,
        title,
        subtitle: tripDateRange ? `${subtitle} · ${tripDateRange}` : subtitle,
        status: event.status === "saved" ? "resolved" : event.status === "disputed" ? "disputed" : "open",
        tripId: event.tripId,
        payEventId: event.id, // Use log event ID for detail navigation
        payPeriodId: null,
        scheduleChangeId: null,
        payRuleId: null,
        exportPacketId: null,
        creditMinutes: changeSummary?.sickCreditMinutes ?? null,
        payImpactCents: null,
        confidence: "high",
        needsReview: false,
        suggestionStatus: null,
        attachmentCount: event.attachmentCount,
        routeSummary: event.tripNumber ? `Trip ${event.tripNumber}` : null,
        dateRangeStart: startDate,
        dateRangeEnd: endDate,
        notes: event.notes || event.autoGeneratedNotes,
        explanation: event.autoGeneratedNotes,
      });
    }
  }

  // Sort by timestamp descending (most recent first)
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply filters
  let filtered = entries;

  if (filters.entryTypes && filters.entryTypes.length > 0) {
    filtered = filtered.filter((e) => filters.entryTypes!.includes(e.entryType));
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.title.toLowerCase().includes(searchLower) ||
        e.subtitle?.toLowerCase().includes(searchLower) ||
        e.routeSummary?.toLowerCase().includes(searchLower) ||
        e.notes?.toLowerCase().includes(searchLower)
    );
  }

  if (filters.startDate) {
    filtered = filtered.filter((e) => e.timestamp >= filters.startDate!);
  }

  if (filters.endDate) {
    filtered = filtered.filter((e) => e.timestamp <= filters.endDate!);
  }

  return filtered;
}

/**
 * Hook to get audit trail entries
 * Aggregates data from multiple sources into a unified timeline
 */
export function useAuditTrail(filters: AuditTrailFilters = {}) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  // Fetch all source data
  const { data: tripsData, isLoading: tripsLoading } = useTrips();
  const { data: payEventsData, isLoading: eventsLoading } = usePayEvents();
  const { data: snapshotsData, isLoading: snapshotsLoading } = useSnapshots();
  const { data: changesData, isLoading: changesLoading } = useScheduleChanges();
  const { data: rosterChangesData, isLoading: rosterChangesLoading } = useAllPendingRosterChanges();
  const { data: logEventsData, isLoading: logEventsLoading } = useLogEventsHook();

  const isLoading = tripsLoading || eventsLoading || snapshotsLoading || changesLoading || rosterChangesLoading || logEventsLoading;

  // Build audit trail from aggregated data
  const entries = buildAuditTrailFromData(
    tripsData?.trips,
    payEventsData?.events,
    snapshotsData?.snapshots,
    changesData?.changes,
    rosterChangesData?.changes,
    logEventsData?.events,
    filters
  );

  return {
    data: {
      entries,
      totalCount: entries.length,
      hasMore: false,
    },
    isLoading: !isAuthenticated ? false : isLoading,
    isAuthenticated,
  };
}

/**
 * Get summary stats for audit trail
 */
export function useAuditTrailSummary() {
  const { data, isLoading } = useAuditTrail();

  const summary = {
    totalEntries: data?.entries.length ?? 0,
    needsReview: data?.entries.filter((e) => e.needsReview).length ?? 0,
    byType: {} as Record<AuditTrailEntryType, number>,
    totalPayImpact: 0,
    totalCreditMinutes: 0,
  };

  if (data?.entries) {
    for (const entry of data.entries) {
      summary.byType[entry.entryType] = (summary.byType[entry.entryType] ?? 0) + 1;
      if (entry.payImpactCents) {
        summary.totalPayImpact += entry.payImpactCents;
      }
      if (entry.creditMinutes) {
        summary.totalCreditMinutes += entry.creditMinutes;
      }
    }
  }

  return { summary, isLoading };
}

// ============================================
// HELPERS
// ============================================

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(start + "T12:00:00");
  const endDate = new Date(end + "T12:00:00");
  const startStr = startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startStr} - ${endStr}`;
}

function formatPayEventType(eventType: string): string {
  const labels: Record<string, string> = {
    SCHEDULE_CHANGE: "Schedule Change",
    DUTY_EXTENSION: "Duty Extension",
    REASSIGNMENT: "Reassignment",
    PREMIUM_TRIGGER: "Premium Trigger",
    PAY_PROTECTION: "Pay Protection",
    JUNIOR_ASSIGNMENT: "Junior Assignment",
    TRAINING: "Training",
    DEADHEAD: "Deadhead",
    RESERVE_ACTIVATION: "Reserve Activation",
    OTHER: "Other Event",
  };
  return labels[eventType] || eventType;
}

function formatChangeType(changeType: string): string {
  const labels: Record<string, string> = {
    TRIP_ADDED: "Trip Added",
    TRIP_REMOVED: "Trip Removed",
    TRIP_MODIFIED: "Trip Modified",
    LEG_ADDED: "Leg Added",
    LEG_REMOVED: "Leg Removed",
    LEG_MODIFIED: "Leg Modified",
    TIME_CHANGE: "Time Changed",
    DH_CHANGE: "Deadhead Changed",
    CREDIT_CHANGE: "Credit Changed",
  };
  return labels[changeType] || changeType;
}

/**
 * Get display info for entry type
 */
export function getEntryTypeDisplay(entryType: AuditTrailEntryType): {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
} {
  const displays: Record<AuditTrailEntryType, { label: string; icon: string; color: string; bgColor: string }> = {
    TRIP_IMPORTED: {
      label: "Trip",
      icon: "Plane",
      color: "#3b82f6",
      bgColor: "bg-blue-500/20",
    },
    TRIP_CONFIRMED: {
      label: "Trip Confirmed",
      icon: "CheckCircle",
      color: "#22c55e",
      bgColor: "bg-green-500/20",
    },
    DETECTED_CHANGE: {
      label: "Change Detected",
      icon: "AlertTriangle",
      color: "#f59e0b",
      bgColor: "bg-amber-500/20",
    },
    PAY_EVENT: {
      label: "Pay Event",
      icon: "DollarSign",
      color: "#22c55e",
      bgColor: "bg-green-500/20",
    },
    STATEMENT_UPLOADED: {
      label: "Schedule Uploaded",
      icon: "FileText",
      color: "#8b5cf6",
      bgColor: "bg-purple-500/20",
    },
    RULE_CHANGE: {
      label: "Rule Change",
      icon: "Settings",
      color: "#64748b",
      bgColor: "bg-slate-500/20",
    },
    AI_SUGGESTION: {
      label: "Suggestion",
      icon: "Lightbulb",
      color: "#06b6d4",
      bgColor: "bg-cyan-500/20",
    },
    EXPORT_GENERATED: {
      label: "Export",
      icon: "Download",
      color: "#ec4899",
      bgColor: "bg-pink-500/20",
    },
  };
  return displays[entryType] || { label: entryType, icon: "Circle", color: "#64748b", bgColor: "bg-slate-500/20" };
}

/**
 * Format confidence level for display
 */
export function formatConfidence(confidence: AuditConfidenceLevel | null): {
  label: string;
  color: string;
  bgColor: string;
} {
  if (!confidence) return { label: "", color: "", bgColor: "" };

  const displays: Record<AuditConfidenceLevel, { label: string; color: string; bgColor: string }> = {
    high: { label: "High", color: "text-green-400", bgColor: "bg-green-500/20" },
    medium: { label: "Med", color: "text-amber-400", bgColor: "bg-amber-500/20" },
    low: { label: "Low", color: "text-red-400", bgColor: "bg-red-500/20" },
  };
  return displays[confidence];
}

/**
 * Format minutes as hours:minutes
 */
export function formatMinutesDisplay(minutes: number | null): string {
  if (minutes == null) return "-";
  const sign = minutes >= 0 ? "+" : "";
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  return `${sign}${hours}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Format cents as currency
 */
export function formatCentsDisplay(cents: number | null): string {
  if (cents == null) return "-";
  const sign = cents >= 0 ? "+" : "";
  const absCents = Math.abs(cents);
  return `${sign}$${(absCents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
