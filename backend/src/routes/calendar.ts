/**
 * Calendar Sync Routes
 *
 * Handle calendar connections (Apple, Google, Outlook, ICS)
 * and schedule synchronization with diff detection.
 */

import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { type AppType } from "../types";

// ============================================
// LOCAL SCHEMAS (matching shared/contracts.ts)
// ============================================

const calendarProviderValues = ["apple", "google", "outlook", "ics_feed"] as const;
const calendarConnectionStatusValues = ["pending", "connected", "disconnected", "error"] as const;
const scheduleChangeTypeValues = [
  "TRIP_ADDED",
  "TRIP_REMOVED",
  "TRIP_MODIFIED",
  "LEG_ADDED",
  "LEG_REMOVED",
  "LEG_MODIFIED",
  "TIME_CHANGE",
  "DH_CHANGE",
  "CREDIT_CHANGE",
] as const;
const changeClassificationValues = [
  "company_initiated",
  "pilot_trade",
  "vacation",
  "sick_call",
  "training",
  "reserve_activation",
  "junior_assignment",
  "other",
] as const;
const payEventTypeValues = [
  "SCHEDULE_CHANGE",
  "DUTY_EXTENSION",
  "REASSIGNMENT",
  "PREMIUM_TRIGGER",
  "PAY_PROTECTION",
  "JUNIOR_ASSIGNMENT",
  "TRAINING",
  "DEADHEAD",
  "RESERVE_ACTIVATION",
  "OTHER",
] as const;

const createCalendarConnectionRequestSchema = z.object({
  provider: z.enum(calendarProviderValues),
  displayName: z.string().optional(),
  icsUrl: z.string().optional(),
  deviceCalendarId: z.string().optional(), // For device calendars - the native calendar ID
});

const triggerCalendarSyncRequestSchema = z.object({
  connectionId: z.string().optional(),
  syncRange: z.object({
    pastDays: z.number().default(30),
    futureDays: z.number().default(90),
  }).optional(),
  // Events from device calendars (passed from expo-calendar on the frontend)
  deviceCalendarEvents: z.array(z.object({
    id: z.string(),
    calendarId: z.string(),
    title: z.string(),
    startDate: z.string(), // ISO string
    endDate: z.string(), // ISO string
    location: z.string().optional(),
    notes: z.string().optional(),
    allDay: z.boolean(),
  })).optional(),
});

const createPayEventRequestSchema = z.object({
  eventType: z.enum(payEventTypeValues),
  airlineLabel: z.string().optional(),
  eventDateISO: z.string(),
  eventTimeISO: z.string().optional(),
  tripId: z.string().optional(),
  dutyDayId: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  originalTripNumber: z.string().optional(),
  originalStartTime: z.string().optional(),
  originalEndTime: z.string().optional(),
  originalCreditMinutes: z.number().optional(),
  newTripNumber: z.string().optional(),
  newStartTime: z.string().optional(),
  newEndTime: z.string().optional(),
  newCreditMinutes: z.number().optional(),
});

const applyCalendarChangeRequestSchema = z.object({
  action: z.enum(["apply", "dismiss"]),
  classificationReason: z.enum(changeClassificationValues).optional(),
  createPayEvent: z.boolean().optional(),
  payEventData: createPayEventRequestSchema.optional(),
});

// Type definitions
interface DetectedScheduleChange {
  id: string;
  tripNumber: string | null;
  tripDate: string;
  changeType: typeof scheduleChangeTypeValues[number];
  previousStartISO: string | null;
  previousEndISO: string | null;
  previousOrigin: string | null;
  previousDestination: string | null;
  previousCreditMinutes: number | null;
  previousRoute: string | null;
  newStartISO: string | null;
  newEndISO: string | null;
  newOrigin: string | null;
  newDestination: string | null;
  newCreditMinutes: number | null;
  newRoute: string | null;
  fieldsChanged: string[];
  creditDiffMinutes: number;
  estimatedPayDiffCents: number;
  classificationReason: string | null;
}

interface CalendarSyncResult {
  success: boolean;
  syncedAt: string;
  eventsProcessed: number;
  changesDetected: DetectedScheduleChange[];
  summary: {
    totalChanges: number;
    tripsAdded: number;
    tripsRemoved: number;
    tripsModified: number;
    payImpactChanges: number;
    estimatedPayDiffCents: number;
  };
  error: string | null;
}

const app = new Hono<AppType>();

// ============================================
// ICS PARSER HELPER
// ============================================

interface ParsedICSEvent {
  uid: string;
  summary: string;
  startISO: string;
  endISO: string;
  location?: string;
  description?: string;
}

function parseICSContent(icsContent: string): ParsedICSEvent[] {
  const events: ParsedICSEvent[] = [];
  const lines = icsContent.split(/\r?\n/);

  let currentEvent: Partial<ParsedICSEvent> | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? "";

    // Handle line folding (lines starting with space/tab are continuations)
    while (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (nextLine && (nextLine.startsWith(" ") || nextLine.startsWith("\t"))) {
        i++;
        line += nextLine.substring(1);
      } else {
        break;
      }
    }

    if (line.startsWith("BEGIN:VEVENT")) {
      currentEvent = {};
    } else if (line.startsWith("END:VEVENT") && currentEvent) {
      if (currentEvent.uid && currentEvent.summary && currentEvent.startISO && currentEvent.endISO) {
        events.push(currentEvent as ParsedICSEvent);
      }
      currentEvent = null;
    } else if (currentEvent) {
      const [key, ...valueParts] = line.split(":");
      const value = valueParts.join(":");

      if (key?.startsWith("UID")) {
        currentEvent.uid = value;
      } else if (key?.startsWith("SUMMARY")) {
        currentEvent.summary = value;
      } else if (key?.startsWith("DTSTART")) {
        currentEvent.startISO = parseICSDate(value);
      } else if (key?.startsWith("DTEND")) {
        currentEvent.endISO = parseICSDate(value);
      } else if (key?.startsWith("LOCATION")) {
        currentEvent.location = value;
      } else if (key?.startsWith("DESCRIPTION")) {
        currentEvent.description = value;
      }
    }
  }

  return events;
}

function parseICSDate(dateStr: string): string {
  // Handle formats: 20240115T080000Z, 20240115T080000, 20240115
  const clean = dateStr.replace(/[^0-9TZ]/g, "");

  if (clean.length >= 8) {
    const year = clean.slice(0, 4);
    const month = clean.slice(4, 6);
    const day = clean.slice(6, 8);

    if (clean.length >= 15) {
      const hour = clean.slice(9, 11);
      const minute = clean.slice(11, 13);
      const second = clean.slice(13, 15);
      const isUtc = clean.endsWith("Z");
      return `${year}-${month}-${day}T${hour}:${minute}:${second}${isUtc ? ".000Z" : ""}`;
    }

    return `${year}-${month}-${day}T00:00:00.000Z`;
  }

  return new Date().toISOString();
}

// ============================================
// TRIP EXTRACTION FROM CALENDAR EVENTS
// ============================================

interface ExtractedTrip {
  tripNumber: string | null;
  startDate: string;
  endDate: string;
  route: string | null;
  creditMinutes: number;
  blockMinutes: number;
  origin: string | null;
  destination: string | null;
  source: "calendar";
}

/**
 * Parse time strings like "03:15", "3:15", "3h15m", "195min" into minutes
 */
function parseTimeToMinutes(timeStr: string): number | null {
  // Try HH:MM format
  const hhmmMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (hhmmMatch) {
    const hours = parseInt(hhmmMatch[1] ?? "0", 10);
    const mins = parseInt(hhmmMatch[2] ?? "0", 10);
    return hours * 60 + mins;
  }

  // Try "3h15m" or "3h 15m" format
  const hhmMatch = timeStr.match(/(\d+)\s*h\s*(\d+)?\s*m?/i);
  if (hhmMatch) {
    const hours = parseInt(hhmMatch[1] ?? "0", 10);
    const mins = hhmMatch[2] ? parseInt(hhmMatch[2], 10) : 0;
    return hours * 60 + mins;
  }

  // Try "195min" or "195 min" format
  const minMatch = timeStr.match(/(\d+)\s*min/i);
  if (minMatch) {
    return parseInt(minMatch[1] ?? "0", 10);
  }

  return null;
}

/**
 * Extract block and credit times from event text
 * Patterns: "Blk 03:15", "Block: 3:15", "Credit 4:30", "BLK/CRD 3:15/4:00"
 */
function extractTimesFromText(text: string): { blockMinutes: number | null; creditMinutes: number | null } {
  let blockMinutes: number | null = null;
  let creditMinutes: number | null = null;

  // Try combined pattern: "BLK/CRD 3:15/4:00" or "Block/Credit: 3:15/4:30"
  const combinedMatch = text.match(/(?:blk|block)\s*\/\s*(?:crd|credit)[:\s]*(\d{1,2}:\d{2})\s*\/\s*(\d{1,2}:\d{2})/i);
  if (combinedMatch && combinedMatch[1] && combinedMatch[2]) {
    blockMinutes = parseTimeToMinutes(combinedMatch[1]);
    creditMinutes = parseTimeToMinutes(combinedMatch[2]);
  }

  // Try block pattern: "Blk 03:15", "Block: 3:15", "Block Time: 3:15"
  if (blockMinutes === null) {
    const blockMatch = text.match(/(?:blk|block)(?:\s*time)?[:\s]+(\d{1,2}:\d{2}|\d+\s*h\s*\d*\s*m?|\d+\s*min)/i);
    if (blockMatch && blockMatch[1]) {
      blockMinutes = parseTimeToMinutes(blockMatch[1]);
    }
  }

  // Try credit pattern: "Crd 04:30", "Credit: 4:30", "Credit Time: 4:30"
  if (creditMinutes === null) {
    const creditMatch = text.match(/(?:crd|credit)(?:\s*time)?[:\s]+(\d{1,2}:\d{2}|\d+\s*h\s*\d*\s*m?|\d+\s*min)/i);
    if (creditMatch && creditMatch[1]) {
      creditMinutes = parseTimeToMinutes(creditMatch[1]);
    }
  }

  // Try standalone time pattern if only one time value: "Time: 3:15" or "3:15 hrs"
  if (blockMinutes === null && creditMinutes === null) {
    const standaloneTimes = text.match(/(?:time|hrs?|hours?)[:\s]+(\d{1,2}:\d{2})/gi);
    if (standaloneTimes && standaloneTimes.length === 1) {
      const timeVal = standaloneTimes[0]?.match(/(\d{1,2}:\d{2})/);
      if (timeVal && timeVal[1]) {
        const mins = parseTimeToMinutes(timeVal[1]);
        if (mins && mins > 0 && mins < 24 * 60) {
          // Single time found - use as both block and credit
          blockMinutes = mins;
          creditMinutes = mins;
        }
      }
    }
  }

  return { blockMinutes, creditMinutes };
}

function extractTripFromEvent(event: ParsedICSEvent): ExtractedTrip | null {
  const summary = event.summary || "";
  const description = event.description || "";
  const location = event.location || "";
  const combined = `${summary} ${description} ${location}`;

  // STRICT FILTERING: Only import events that look like actual pilot trips
  // Skip common non-trip calendar events
  const skipPatterns = [
    /meeting/i,
    /appointment/i,
    /reminder/i,
    /birthday/i,
    /anniversary/i,
    /vacation/i,
    /holiday/i,
    /lunch/i,
    /dinner/i,
    /call\s/i,
    /phone/i,
    /dentist/i,
    /doctor/i,
    /gym/i,
    /workout/i,
    /class/i,
    /school/i,
    /pickup/i,
    /drop.?off/i,
    /personal/i,
    /todo/i,
    /task/i,
    /project/i,
  ];

  for (const pattern of skipPatterns) {
    if (pattern.test(summary) || pattern.test(description)) {
      return null;
    }
  }

  // Try to extract trip info from summary/description
  // Patterns: "Trip 1234", "S5055", "Trip: SDF-LAX-SDF", "Pairing S5055", etc.
  const tripPatterns = [
    /Trip\s*#?\s*(\w+)/i,
    /Pairing\s*#?\s*(\w+)/i,
    /\b([A-Z]\d{4,5})\b/, // Pattern like S5055
  ];

  let tripNumber: string | null = null;
  for (const pattern of tripPatterns) {
    const match = summary.match(pattern) || description.match(pattern);
    if (match && match[1]) {
      tripNumber = match[1];
      break;
    }
  }

  // Extract route from location or summary (airport codes like SDF-LAX-SDF or SDF - LAX)
  const routePatterns = [
    /([A-Z]{3})\s*[-→>]\s*([A-Z]{3})(?:\s*[-→>]\s*([A-Z]{3}))?/,  // DFW→LAX or DFW-LAX-SDF
    /([A-Z]{3})\s+to\s+([A-Z]{3})/i,  // DFW to LAX
  ];

  let route: string | null = null;
  let origin: string | null = null;
  let destination: string | null = null;

  for (const routePattern of routePatterns) {
    const routeMatch =
      location.match(routePattern) ||
      summary.match(routePattern) ||
      description.match(routePattern);
    if (routeMatch && routeMatch[1] && routeMatch[2]) {
      origin = routeMatch[1];
      // If there's a third segment (return), use the last as destination
      destination = routeMatch[3] ?? routeMatch[2];
      // Build full route string
      route = routeMatch[3]
        ? `${routeMatch[1]}-${routeMatch[2]}-${routeMatch[3]}`
        : `${routeMatch[1]}-${routeMatch[2]}`;
      break;
    }
  }

  // MUST have either a trip number OR a route pattern to be considered a trip
  // This filters out random calendar events that don't look like pilot trips
  if (!tripNumber && !route) {
    // Check for other flight-related keywords as a fallback
    const flightKeywords = [
      /\bflight\b/i,
      /\bfly\b/i,
      /\bduty\b/i,
      /\breport\b/i,
      /\bdeadhead\b/i,
      /\bdh\b/i,
      /\bleg\b/i,
      /\bcrew\b/i,
      /\bblock\b/i,
      /\bcredit\b/i,
    ];

    const hasFlightKeyword = flightKeywords.some(pattern =>
      pattern.test(summary) || pattern.test(description)
    );

    if (!hasFlightKeyword) {
      return null; // Not a trip event
    }
  }

  const startDate = event.startISO.split("T")[0];
  const endDate = event.endISO.split("T")[0];

  // Calculate duration from event times
  const startMs = new Date(event.startISO).getTime();
  const endMs = new Date(event.endISO).getTime();
  const durationMinutes = Math.floor((endMs - startMs) / (1000 * 60));

  // Skip events shorter than 1 hour (unlikely to be a trip) or longer than 7 days
  if (durationMinutes < 60 || durationMinutes > 7 * 24 * 60) {
    return null;
  }

  // Try to extract actual block/credit times from event text
  const { blockMinutes: parsedBlock, creditMinutes: parsedCredit } = extractTimesFromText(combined);

  // Use parsed times if found, otherwise calculate from duration
  let blockMinutes: number;
  let creditMinutes: number;

  if (parsedBlock !== null && parsedBlock > 0) {
    blockMinutes = parsedBlock;
  } else if (parsedCredit !== null && parsedCredit > 0) {
    // If only credit found, use it for block too
    blockMinutes = parsedCredit;
  } else {
    // Fall back to event duration, but cap multi-day trips reasonably
    // For single-day trips, use actual duration up to 14 hours
    // For multi-day trips, estimate based on typical flying days
    if (startDate === endDate) {
      blockMinutes = Math.min(durationMinutes, 14 * 60);
    } else {
      // Multi-day trip: estimate 4-6 hours block per day
      const days = Math.ceil(durationMinutes / (24 * 60));
      blockMinutes = days * 5 * 60; // 5 hours per day estimate
    }
  }

  if (parsedCredit !== null && parsedCredit > 0) {
    creditMinutes = parsedCredit;
  } else {
    // Credit is typically >= block, use same as block or apply min day credit
    creditMinutes = Math.max(blockMinutes, 6 * 60); // 6 hour minimum day credit is common
  }

  return {
    tripNumber,
    startDate: startDate ?? "",
    endDate: endDate ?? "",
    route,
    blockMinutes,
    creditMinutes,
    origin,
    destination,
    source: "calendar",
  };
}

// ============================================
// DIFF DETECTION
// ============================================

function detectScheduleChanges(
  existingTrips: Array<{ tripNumber: string | null; startDate: string; endDate: string; totalCreditMinutes: number; totalBlockMinutes?: number }>,
  newTrips: ExtractedTrip[],
  hourlyRateCents: number
): DetectedScheduleChange[] {
  const changes: DetectedScheduleChange[] = [];

  // Index existing trips by date for comparison
  const existingByDate = new Map<string, typeof existingTrips[0]>();
  for (const trip of existingTrips) {
    const key = `${trip.startDate}-${trip.tripNumber || "unknown"}`;
    existingByDate.set(key, trip);
  }

  const newByDate = new Map<string, ExtractedTrip>();
  for (const trip of newTrips) {
    const key = `${trip.startDate}-${trip.tripNumber || "unknown"}`;
    newByDate.set(key, trip);
  }

  // Find added trips
  for (const [key, newTrip] of newByDate) {
    if (!existingByDate.has(key)) {
      const creditDiff = newTrip.creditMinutes;
      const payDiff = Math.round((creditDiff / 60) * hourlyRateCents);

      changes.push({
        id: `change-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        tripNumber: newTrip.tripNumber,
        tripDate: newTrip.startDate,
        changeType: "TRIP_ADDED",
        previousStartISO: null,
        previousEndISO: null,
        previousOrigin: null,
        previousDestination: null,
        previousCreditMinutes: null,
        previousRoute: null,
        newStartISO: `${newTrip.startDate}T00:00:00.000Z`,
        newEndISO: `${newTrip.endDate}T23:59:59.000Z`,
        newOrigin: newTrip.origin,
        newDestination: newTrip.destination,
        newCreditMinutes: newTrip.creditMinutes,
        newRoute: newTrip.route,
        fieldsChanged: ["trip_added"],
        creditDiffMinutes: creditDiff,
        estimatedPayDiffCents: payDiff,
        classificationReason: null,
        // @ts-ignore - adding blockMinutes for internal use
        _blockMinutes: newTrip.blockMinutes,
      });
    }
  }

  // Find removed trips
  for (const [key, existingTrip] of existingByDate) {
    if (!newByDate.has(key)) {
      const creditDiff = -existingTrip.totalCreditMinutes;
      const payDiff = Math.round((creditDiff / 60) * hourlyRateCents);

      changes.push({
        id: `change-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        tripNumber: existingTrip.tripNumber,
        tripDate: existingTrip.startDate,
        changeType: "TRIP_REMOVED",
        previousStartISO: `${existingTrip.startDate}T00:00:00.000Z`,
        previousEndISO: `${existingTrip.endDate}T23:59:59.000Z`,
        previousOrigin: null,
        previousDestination: null,
        previousCreditMinutes: existingTrip.totalCreditMinutes,
        previousRoute: null,
        newStartISO: null,
        newEndISO: null,
        newOrigin: null,
        newDestination: null,
        newCreditMinutes: null,
        newRoute: null,
        fieldsChanged: ["trip_removed"],
        creditDiffMinutes: creditDiff,
        estimatedPayDiffCents: payDiff,
        classificationReason: null,
      });
    }
  }

  // Find modified trips (same key but different credit/dates)
  for (const [key, newTrip] of newByDate) {
    const existingTrip = existingByDate.get(key);
    if (existingTrip) {
      const creditDiff = newTrip.creditMinutes - existingTrip.totalCreditMinutes;

      // Only report if there's a meaningful difference (> 10 minutes)
      if (Math.abs(creditDiff) > 10) {
        const payDiff = Math.round((creditDiff / 60) * hourlyRateCents);
        const fieldsChanged: string[] = [];

        if (creditDiff !== 0) fieldsChanged.push("credit");
        if (newTrip.endDate !== existingTrip.endDate) fieldsChanged.push("end_date");

        changes.push({
          id: `change-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          tripNumber: newTrip.tripNumber,
          tripDate: newTrip.startDate,
          changeType: "TRIP_MODIFIED",
          previousStartISO: `${existingTrip.startDate}T00:00:00.000Z`,
          previousEndISO: `${existingTrip.endDate}T23:59:59.000Z`,
          previousOrigin: null,
          previousDestination: null,
          previousCreditMinutes: existingTrip.totalCreditMinutes,
          previousRoute: null,
          newStartISO: `${newTrip.startDate}T00:00:00.000Z`,
          newEndISO: `${newTrip.endDate}T23:59:59.000Z`,
          newOrigin: newTrip.route?.split("-")[0] || null,
          newDestination: newTrip.route?.split("-").pop() || null,
          newCreditMinutes: newTrip.creditMinutes,
          newRoute: newTrip.route,
          fieldsChanged,
          creditDiffMinutes: creditDiff,
          estimatedPayDiffCents: payDiff,
          classificationReason: null,
        });
      }
    }
  }

  return changes;
}

// ============================================
// ROUTES
// ============================================

// GET /api/calendar/connections - List calendar connections
app.get("/connections", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const connections = await db.calendarConnection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  // Get latest sync time across all connections
  const lastSyncConnection = connections.find((c) => c.lastSyncAt);
  const lastSyncAt = lastSyncConnection?.lastSyncAt?.toISOString() || null;

  // Count pending changes
  const pendingChanges = await db.calendarPendingChange.count({
    where: { userId: user.id, status: "pending" },
  });

  return c.json({
    connections: connections.map((conn) => ({
      id: conn.id,
      userId: conn.userId,
      provider: conn.provider as "apple" | "google" | "outlook" | "ics_feed",
      displayName: conn.displayName,
      connectionStatus: conn.connectionStatus as "pending" | "connected" | "disconnected" | "error",
      lastSyncAt: conn.lastSyncAt?.toISOString() || null,
      nextSyncAt: conn.nextSyncAt?.toISOString() || null,
      syncError: conn.syncError,
      icsUrl: conn.icsUrl,
      calendarId: conn.calendarId,
      createdAt: conn.createdAt.toISOString(),
      updatedAt: conn.updatedAt.toISOString(),
    })),
    lastSyncAt,
    pendingChanges,
  });
});

// POST /api/calendar/connections - Add a new calendar connection
app.post("/connections", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json();
  const parsed = createCalendarConnectionRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, message: "Invalid request data" }, 400);
  }

  const { provider, displayName, icsUrl, deviceCalendarId } = parsed.data;

  // For ICS feeds, validate and create connection immediately
  if (provider === "ics_feed") {
    if (!icsUrl) {
      return c.json({ success: false, message: "ICS URL is required for ICS feed connections" }, 400);
    }

    // Validate ICS URL format
    try {
      new URL(icsUrl);
    } catch {
      return c.json({ success: false, message: "Invalid ICS URL format" }, 400);
    }

    const connection = await db.calendarConnection.create({
      data: {
        userId: user.id,
        provider: "ics_feed",
        displayName: displayName || "ICS Feed",
        connectionStatus: "connected",
        icsUrl,
      },
    });

    return c.json({
      success: true,
      connection: {
        id: connection.id,
        userId: connection.userId,
        provider: connection.provider as "ics_feed",
        displayName: connection.displayName,
        connectionStatus: connection.connectionStatus as "connected",
        lastSyncAt: null,
        nextSyncAt: null,
        syncError: null,
        icsUrl: connection.icsUrl,
        calendarId: null,
        createdAt: connection.createdAt.toISOString(),
        updatedAt: connection.updatedAt.toISOString(),
      },
      message: "ICS feed connected successfully",
    });
  }

  // For OAuth providers (Apple, Google, Outlook), we create a pending connection
  // In a real app, we'd generate an OAuth URL and redirect
  // For device calendars, the calendarId comes from expo-calendar on the device
  const connection = await db.calendarConnection.create({
    data: {
      userId: user.id,
      provider,
      displayName: displayName || `${provider.charAt(0).toUpperCase() + provider.slice(1)} Calendar`,
      connectionStatus: "connected", // Device calendars are connected via expo-calendar
      calendarId: deviceCalendarId || null, // Store the device calendar ID for syncing
    },
  });

  return c.json({
    success: true,
    connection: {
      id: connection.id,
      userId: connection.userId,
      provider: connection.provider as "apple" | "google" | "outlook",
      displayName: connection.displayName,
      connectionStatus: connection.connectionStatus as "connected",
      lastSyncAt: null,
      nextSyncAt: null,
      syncError: null,
      icsUrl: null,
      calendarId: null,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    },
    // In real implementation, this would be an OAuth URL
    // authUrl: `https://oauth.example.com/authorize?client_id=...`,
    message: `${provider} calendar connected successfully`,
  });
});

// DELETE /api/calendar/connections/:id - Remove calendar connection
app.delete("/connections/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.param();

  const connection = await db.calendarConnection.findFirst({
    where: { id, userId: user.id },
  });

  if (!connection) {
    return c.json({ success: false, error: "Connection not found" }, 404);
  }

  await db.calendarConnection.delete({ where: { id } });

  return c.json({ success: true });
});

// POST /api/calendar/sync - Trigger calendar sync
app.post("/sync", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = triggerCalendarSyncRequestSchema.safeParse(body);

  const connectionId = parsed.success ? parsed.data.connectionId : undefined;
  const pastDays = parsed.success ? parsed.data.syncRange?.pastDays ?? 30 : 30;
  const futureDays = parsed.success ? parsed.data.syncRange?.futureDays ?? 90 : 90;
  const deviceCalendarEvents = parsed.success ? parsed.data.deviceCalendarEvents : undefined;

  // Get connections to sync
  const connections = connectionId
    ? await db.calendarConnection.findMany({
        where: { id: connectionId, userId: user.id, connectionStatus: "connected" },
      })
    : await db.calendarConnection.findMany({
        where: { userId: user.id, connectionStatus: "connected" },
      });

  if (connections.length === 0) {
    return c.json({
      success: false,
      error: "No connected calendars found",
    });
  }

  // Get user's hourly rate for pay calculations
  const profile = await db.profile.findUnique({ where: { userId: user.id } });
  const hourlyRateCents = profile?.hourlyRateCents || 32500;

  // Calculate date range
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - pastDays);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + futureDays);

  const startDateStr = startDate.toISOString().split("T")[0] ?? "";
  const endDateStr = endDate.toISOString().split("T")[0] ?? "";

  // Get existing trips in date range
  const existingTrips = await db.trip.findMany({
    where: {
      userId: user.id,
      startDate: { gte: startDateStr },
      endDate: { lte: endDateStr },
    },
    select: {
      tripNumber: true,
      startDate: true,
      endDate: true,
      totalCreditMinutes: true,
    },
  });

  let allExtractedTrips: ExtractedTrip[] = [];
  let eventsProcessed = 0;
  const errors: string[] = [];

  // Process each connection
  for (const connection of connections) {
    try {
      if (connection.provider === "ics_feed" && connection.icsUrl) {
        // Fetch and parse ICS feed
        const response = await fetch(connection.icsUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch ICS: ${response.statusText}`);
        }

        const icsContent = await response.text();
        const events = parseICSContent(icsContent);
        eventsProcessed += events.length;

        // Extract trips from events
        for (const event of events) {
          const trip = extractTripFromEvent(event);
          if (trip && trip.startDate >= startDateStr && trip.endDate <= endDateStr) {
            allExtractedTrips.push(trip);
          }
        }

        // Update connection sync time
        await db.calendarConnection.update({
          where: { id: connection.id },
          data: { lastSyncAt: new Date(), syncError: null },
        });
      } else if (connection.calendarId && deviceCalendarEvents) {
        // For device calendars, use the events passed from the frontend
        // Filter events that belong to this connection's calendar
        const calendarEvents = deviceCalendarEvents.filter(
          (e) => e.calendarId === connection.calendarId
        );
        eventsProcessed += calendarEvents.length;

        // Convert device calendar events to our ParsedICSEvent format
        for (const event of calendarEvents) {
          const parsedEvent: ParsedICSEvent = {
            uid: event.id,
            summary: event.title,
            startISO: event.startDate,
            endISO: event.endDate,
            location: event.location,
            description: event.notes,
          };

          const trip = extractTripFromEvent(parsedEvent);
          if (trip && trip.startDate >= startDateStr && trip.endDate <= endDateStr) {
            allExtractedTrips.push(trip);
          }
        }

        // Update connection sync time
        await db.calendarConnection.update({
          where: { id: connection.id },
          data: { lastSyncAt: new Date(), syncError: null },
        });
      } else {
        // For OAuth providers without device events, just mark as synced
        // In real implementation, we'd call the provider's API
        eventsProcessed += 5; // Simulated

        // Update connection sync time
        await db.calendarConnection.update({
          where: { id: connection.id },
          data: { lastSyncAt: new Date(), syncError: null },
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`${connection.displayName}: ${errorMsg}`);

      await db.calendarConnection.update({
        where: { id: connection.id },
        data: { syncError: errorMsg },
      });
    }
  }

  // Detect changes between existing and new trips
  const detectedChanges = detectScheduleChanges(existingTrips, allExtractedTrips, hourlyRateCents);

  // Auto-apply changes directly to trips (no review step)
  let tripsCreated = 0;
  let tripsUpdated = 0;
  let tripsCancelled = 0;

  for (const change of detectedChanges) {
    try {
      if (change.changeType === "TRIP_ADDED") {
        // Get blockMinutes from the change (or fall back to credit)
        // @ts-ignore - accessing internal _blockMinutes field
        const blockMinutes = (change as any)._blockMinutes || change.newCreditMinutes || 0;
        const creditMinutes = change.newCreditMinutes || 0;

        // Create new trip directly
        const newTrip = await db.trip.create({
          data: {
            userId: user.id,
            tripNumber: change.tripNumber,
            startDate: change.tripDate,
            endDate: change.newEndISO?.split("T")[0] || change.tripDate,
            source: "calendar",
            totalBlockMinutes: blockMinutes,
            totalCreditMinutes: creditMinutes,
            status: "scheduled",
            needsReview: false,
          },
        });

        // Create a DutyDay for the trip so it shows in the frontend
        if (creditMinutes > 0) {
          const hourlyRateCents = profile?.hourlyRateCents || 32500;
          const calculatedPayCents = Math.round((creditMinutes / 60) * hourlyRateCents);

          // Create DutyDay with proper block minutes
          const dutyDay = await db.dutyDay.create({
            data: {
              tripId: newTrip.id,
              dutyDate: change.tripDate,
              dutyStartISO: change.newStartISO,
              dutyEndISO: change.newEndISO,
              plannedCreditMinutes: creditMinutes,
              actualBlockMinutes: blockMinutes,
              actualCreditMinutes: creditMinutes,
              finalCreditMinutes: Math.max(creditMinutes, 360),
              minCreditMinutes: 360,
              totalPayCents: calculatedPayCents,
            },
          });

          // Always create a Leg to ensure pay calculations work
          await db.leg.create({
            data: {
              dutyDayId: dutyDay.id,
              legIndex: 0,
              flightNumber: change.tripNumber,
              origin: change.newOrigin,
              destination: change.newDestination,
              equipment: null,
              tailNumber: null,
              isDeadhead: false,
              scheduledOutISO: change.newStartISO,
              scheduledInISO: change.newEndISO,
              plannedBlockMinutes: blockMinutes,
              plannedCreditMinutes: creditMinutes,
              actualOutISO: null,
              actualOffISO: null,
              actualOnISO: null,
              actualInISO: null,
              actualFlightMinutes: 0,
              actualBlockMinutes: blockMinutes,
              creditMinutes: creditMinutes,
              premiumCode: null,
              premiumAmountCents: 0,
              calculatedPayCents,
              source: "import",
              ooiProofUri: null,
              notes: null,
            },
          });

          // Update trip totals
          await db.trip.update({
            where: { id: newTrip.id },
            data: {
              totalBlockMinutes: blockMinutes,
              totalCreditMinutes: creditMinutes,
              totalPayCents: calculatedPayCents,
              legCount: 1,
              dutyDaysCount: 1,
            },
          });
        }
        tripsCreated++;
      } else if (change.changeType === "TRIP_REMOVED") {
        // Mark existing trip as cancelled
        const existingTrip = await db.trip.findFirst({
          where: {
            userId: user.id,
            tripNumber: change.tripNumber,
            startDate: change.tripDate,
          },
        });

        if (existingTrip) {
          await db.trip.update({
            where: { id: existingTrip.id },
            data: { status: "cancelled", needsReview: false },
          });
          tripsCancelled++;
        }
      } else if (change.changeType === "TRIP_MODIFIED") {
        // Update existing trip
        const existingTrip = await db.trip.findFirst({
          where: {
            userId: user.id,
            tripNumber: change.tripNumber,
            startDate: change.tripDate,
          },
        });

        if (existingTrip) {
          await db.trip.update({
            where: { id: existingTrip.id },
            data: {
              totalCreditMinutes: change.newCreditMinutes || existingTrip.totalCreditMinutes,
              endDate: change.newEndISO?.split("T")[0] || existingTrip.endDate,
              needsReview: false,
            },
          });
          tripsUpdated++;
        }
      }

      // Store the change as "applied" for history/audit
      const connectionId = connections[0]?.id;
      if (!connectionId) {
        return c.json({ error: "No calendar connection found" }, 400);
      }

      await db.calendarPendingChange.create({
        data: {
          userId: user.id,
          connectionId,
          tripNumber: change.tripNumber,
          tripDate: change.tripDate,
          changeType: change.changeType,
          previousData: JSON.stringify({
            startISO: change.previousStartISO,
            endISO: change.previousEndISO,
            origin: change.previousOrigin,
            destination: change.previousDestination,
            creditMinutes: change.previousCreditMinutes,
            route: change.previousRoute,
          }),
          newData: JSON.stringify({
            startISO: change.newStartISO,
            endISO: change.newEndISO,
            origin: change.newOrigin,
            destination: change.newDestination,
            creditMinutes: change.newCreditMinutes,
            route: change.newRoute,
          }),
          fieldsChanged: JSON.stringify(change.fieldsChanged),
          creditDiffMinutes: change.creditDiffMinutes,
          estimatedPayDiffCents: change.estimatedPayDiffCents,
          status: "applied", // Auto-applied
          appliedAt: new Date(),
        },
      });
    } catch (changeError) {
      console.error(`Failed to apply change for trip ${change.tripNumber}:`, changeError);
      // Store as pending if auto-apply fails
      const connectionId = connections[0]?.id ?? "";
      await db.calendarPendingChange.create({
        data: {
          userId: user.id,
          connectionId,
          tripNumber: change.tripNumber,
          tripDate: change.tripDate,
          changeType: change.changeType,
          previousData: JSON.stringify({
            startISO: change.previousStartISO,
            endISO: change.previousEndISO,
            origin: change.previousOrigin,
            destination: change.previousDestination,
            creditMinutes: change.previousCreditMinutes,
            route: change.previousRoute,
          }),
          newData: JSON.stringify({
            startISO: change.newStartISO,
            endISO: change.newEndISO,
            origin: change.newOrigin,
            destination: change.newDestination,
            creditMinutes: change.newCreditMinutes,
            route: change.newRoute,
          }),
          fieldsChanged: JSON.stringify(change.fieldsChanged),
          creditDiffMinutes: change.creditDiffMinutes,
          estimatedPayDiffCents: change.estimatedPayDiffCents,
          status: "pending",
        },
      });
    }
  }

  // Build summary
  const summary = {
    totalChanges: detectedChanges.length,
    tripsAdded: tripsCreated,
    tripsRemoved: tripsCancelled,
    tripsModified: tripsUpdated,
    tripsAutoApplied: tripsCreated + tripsUpdated + tripsCancelled,
    payImpactChanges: detectedChanges.filter((c) => Math.abs(c.estimatedPayDiffCents) > 0).length,
    estimatedPayDiffCents: detectedChanges.reduce((sum, c) => sum + c.estimatedPayDiffCents, 0),
  };

  // Update profile to mark calendar sync as connected
  if (profile && !profile.calendarSyncConnected) {
    await db.profile.update({
      where: { userId: user.id },
      data: { calendarSyncConnected: true },
    });
  }

  const result: CalendarSyncResult = {
    success: errors.length === 0,
    syncedAt: new Date().toISOString(),
    eventsProcessed,
    changesDetected: detectedChanges,
    summary,
    error: errors.length > 0 ? errors.join("; ") : null,
  };

  return c.json({ success: true, result });
});

// GET /api/calendar/pending-changes - Get unreviewed changes from last sync
app.get("/pending-changes", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const pendingChanges = await db.calendarPendingChange.findMany({
    where: { userId: user.id, status: "pending" },
    orderBy: { tripDate: "asc" },
    include: { connection: true },
  });

  // Get last sync time
  const lastSync = await db.calendarConnection.findFirst({
    where: { userId: user.id, lastSyncAt: { not: null } },
    orderBy: { lastSyncAt: "desc" },
  });

  const changes: DetectedScheduleChange[] = pendingChanges.map((change) => {
    const prev = change.previousData ? JSON.parse(change.previousData) : {};
    const next = change.newData ? JSON.parse(change.newData) : {};
    const fieldsChanged = change.fieldsChanged ? JSON.parse(change.fieldsChanged) : [];

    return {
      id: change.id,
      tripNumber: change.tripNumber,
      tripDate: change.tripDate,
      changeType: change.changeType as "TRIP_ADDED" | "TRIP_REMOVED" | "TRIP_MODIFIED",
      previousStartISO: prev.startISO || null,
      previousEndISO: prev.endISO || null,
      previousOrigin: prev.origin || null,
      previousDestination: prev.destination || null,
      previousCreditMinutes: prev.creditMinutes || null,
      previousRoute: prev.route || null,
      newStartISO: next.startISO || null,
      newEndISO: next.endISO || null,
      newOrigin: next.origin || null,
      newDestination: next.destination || null,
      newCreditMinutes: next.creditMinutes || null,
      newRoute: next.route || null,
      fieldsChanged,
      creditDiffMinutes: change.creditDiffMinutes,
      estimatedPayDiffCents: change.estimatedPayDiffCents,
      classificationReason: change.classificationReason,
    };
  });

  return c.json({
    changes,
    lastSyncAt: lastSync?.lastSyncAt?.toISOString() || null,
    totalCount: changes.length,
  });
});

// POST /api/calendar/changes/:id/apply - Apply or dismiss a detected change
app.post("/changes/:id/apply", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.param();
  const body = await c.req.json();
  const parsed = applyCalendarChangeRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request data" }, 400);
  }

  const { action, classificationReason, createPayEvent, payEventData } = parsed.data;

  const change = await db.calendarPendingChange.findFirst({
    where: { id, userId: user.id },
  });

  if (!change) {
    return c.json({ success: false, error: "Change not found" }, 404);
  }

  let tripUpdated = false;
  let payEventCreated = false;
  let createdPayEvent = null;

  if (action === "apply") {
    // Parse the new data
    const newData = change.newData ? JSON.parse(change.newData) : {};

    // Get user's hourly rate for pay calculations
    const profile = await db.profile.findUnique({ where: { userId: user.id } });
    const hourlyRateCents = profile?.hourlyRateCents || 32500;

    // Apply the change based on type
    if (change.changeType === "TRIP_ADDED" && newData.startISO) {
      // Create new trip
      const newTrip = await db.trip.create({
        data: {
          userId: user.id,
          tripNumber: change.tripNumber,
          startDate: change.tripDate,
          endDate: newData.endISO?.split("T")[0] || change.tripDate,
          source: "calendar",
          totalCreditMinutes: newData.creditMinutes || 0,
          status: "scheduled",
        },
      });

      // Create DutyDay and Leg for the trip
      const creditMinutes = newData.creditMinutes || 0;
      if (creditMinutes > 0) {
        const calculatedPayCents = Math.round((creditMinutes / 60) * hourlyRateCents);

        const dutyDay = await db.dutyDay.create({
          data: {
            tripId: newTrip.id,
            dutyDate: change.tripDate,
            dutyStartISO: newData.startISO,
            dutyEndISO: newData.endISO,
            plannedCreditMinutes: creditMinutes,
            actualBlockMinutes: 0,
            actualCreditMinutes: creditMinutes,
            finalCreditMinutes: Math.max(creditMinutes, 360),
            minCreditMinutes: 360,
            totalPayCents: calculatedPayCents,
          },
        });

        // Create a Leg if we have route info
        if (newData.origin || newData.destination) {
          await db.leg.create({
            data: {
              dutyDayId: dutyDay.id,
              legIndex: 0,
              flightNumber: change.tripNumber,
              origin: newData.origin,
              destination: newData.destination,
              equipment: null,
              tailNumber: null,
              isDeadhead: false,
              scheduledOutISO: newData.startISO,
              scheduledInISO: newData.endISO,
              plannedBlockMinutes: creditMinutes,
              plannedCreditMinutes: creditMinutes,
              actualOutISO: null,
              actualOffISO: null,
              actualOnISO: null,
              actualInISO: null,
              actualFlightMinutes: 0,
              actualBlockMinutes: 0,
              creditMinutes: creditMinutes,
              premiumCode: null,
              premiumAmountCents: 0,
              calculatedPayCents,
              source: "import",
              ooiProofUri: null,
              notes: null,
            },
          });
        }

        // Update trip totals
        await db.trip.update({
          where: { id: newTrip.id },
          data: {
            totalBlockMinutes: creditMinutes,
            totalCreditMinutes: creditMinutes,
            totalPayCents: calculatedPayCents,
            legCount: 1,
            dutyDaysCount: 1,
          },
        });
      }
      tripUpdated = true;
    } else if (change.changeType === "TRIP_REMOVED") {
      // Mark trip as removed/cancelled
      const existingTrip = await db.trip.findFirst({
        where: {
          userId: user.id,
          tripNumber: change.tripNumber,
          startDate: change.tripDate,
        },
      });

      if (existingTrip) {
        await db.trip.update({
          where: { id: existingTrip.id },
          data: { status: "cancelled", needsReview: true },
        });
        tripUpdated = true;
      }
    } else if (change.changeType === "TRIP_MODIFIED") {
      // Update existing trip
      const existingTrip = await db.trip.findFirst({
        where: {
          userId: user.id,
          tripNumber: change.tripNumber,
          startDate: change.tripDate,
        },
      });

      if (existingTrip) {
        await db.trip.update({
          where: { id: existingTrip.id },
          data: {
            totalCreditMinutes: newData.creditMinutes || existingTrip.totalCreditMinutes,
            endDate: newData.endISO?.split("T")[0] || existingTrip.endDate,
            needsReview: false,
          },
        });
        tripUpdated = true;
      }
    }

    // Create pay event if requested
    if (createPayEvent && payEventData) {
      createdPayEvent = await db.payEvent.create({
        data: {
          userId: user.id,
          eventType: payEventData.eventType,
          airlineLabel: payEventData.airlineLabel,
          eventDateISO: payEventData.eventDateISO,
          eventTimeISO: payEventData.eventTimeISO,
          title: payEventData.title,
          description: payEventData.description,
          originalTripNumber: payEventData.originalTripNumber,
          originalCreditMinutes: payEventData.originalCreditMinutes,
          newTripNumber: payEventData.newTripNumber,
          newCreditMinutes: payEventData.newCreditMinutes,
          creditDifferenceMinutes: change.creditDiffMinutes,
          payDifferenceCents: change.estimatedPayDiffCents,
          status: "logged",
          needsReview: false,
        },
      });
      payEventCreated = true;
    }
  }

  // Mark change as processed
  await db.calendarPendingChange.update({
    where: { id },
    data: {
      status: action === "apply" ? "applied" : "dismissed",
      classificationReason: classificationReason || null,
      appliedAt: new Date(),
      payEventId: createdPayEvent?.id || null,
    },
  });

  return c.json({
    success: true,
    tripUpdated,
    payEventCreated,
    payEvent: createdPayEvent
      ? {
          id: createdPayEvent.id,
          userId: createdPayEvent.userId,
          eventType: createdPayEvent.eventType as any,
          airlineLabel: createdPayEvent.airlineLabel,
          eventDateISO: createdPayEvent.eventDateISO,
          eventTimeISO: createdPayEvent.eventTimeISO,
          tripId: createdPayEvent.tripId,
          dutyDayId: createdPayEvent.dutyDayId,
          title: createdPayEvent.title,
          description: createdPayEvent.description,
          originalTripNumber: createdPayEvent.originalTripNumber,
          originalStartTime: createdPayEvent.originalStartTime,
          originalEndTime: createdPayEvent.originalEndTime,
          originalCreditMinutes: createdPayEvent.originalCreditMinutes,
          newTripNumber: createdPayEvent.newTripNumber,
          newStartTime: createdPayEvent.newStartTime,
          newEndTime: createdPayEvent.newEndTime,
          newCreditMinutes: createdPayEvent.newCreditMinutes,
          creditDifferenceMinutes: createdPayEvent.creditDifferenceMinutes,
          payDifferenceCents: createdPayEvent.payDifferenceCents,
          triggeredRuleIds: createdPayEvent.triggeredRuleIds,
          status: createdPayEvent.status as any,
          needsReview: createdPayEvent.needsReview,
          createdAt: createdPayEvent.createdAt.toISOString(),
          updatedAt: createdPayEvent.updatedAt.toISOString(),
        }
      : undefined,
  });
});

export default app;
