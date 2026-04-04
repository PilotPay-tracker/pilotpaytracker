import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createFlightRequestSchema,
  type CreateFlightResponse,
  type GetFlightsResponse,
  type DeleteFlightResponse,
  type FlightEntry,
} from "@/shared/contracts";
import { type AppType } from "../types";
import { db } from "../db";
import { ensureUserExists } from "../utils/ensureUser";

const flightsRouter = new Hono<AppType>();

// Helper to format flight entry for response
function formatFlightEntry(entry: {
  id: string;
  dateISO: string;
  airline: string;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  blockMinutes: number;
  creditMinutes: number;
  hourlyRateCentsAtEntry: number;
  totalPayCents: number;
  notes: string | null;
  createdAt: Date;
}): FlightEntry {
  return {
    id: entry.id,
    dateISO: entry.dateISO,
    airline: entry.airline,
    flightNumber: entry.flightNumber,
    origin: entry.origin,
    destination: entry.destination,
    blockMinutes: entry.blockMinutes,
    creditMinutes: entry.creditMinutes,
    hourlyRateCents: entry.hourlyRateCentsAtEntry,
    totalPayCents: entry.totalPayCents,
    notes: entry.notes,
    createdAt: entry.createdAt.toISOString(),
  };
}

// ============================================
// GET /api/flights - List flight entries
// ============================================
flightsRouter.get("/", async (c) => {
  const user = c.get("user");

  if (!user) {
    console.log("❌ [Flights] Unauthorized access attempt");
    return c.json({ error: "Unauthorized" }, 401);
  }

  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const limit = c.req.query("limit");

  console.log(`📋 [Flights] Fetching flights for user: ${user.id}`);

  const flights = await db.flightEntry.findMany({
    where: {
      userId: user.id,
      ...(startDate && endDate
        ? {
            dateISO: {
              gte: startDate,
              lte: endDate,
            },
          }
        : {}),
    },
    orderBy: { dateISO: "desc" },
    take: limit ? parseInt(limit, 10) : undefined,
  });

  const totalCount = await db.flightEntry.count({
    where: { userId: user.id },
  });

  const response: GetFlightsResponse = {
    flights: flights.map(formatFlightEntry),
    totalCount,
  };

  return c.json(response);
});

// ============================================
// POST /api/flights - Create flight entry
// ============================================
flightsRouter.post(
  "/",
  zValidator("json", createFlightRequestSchema),
  async (c) => {
    const user = c.get("user");

    if (!user) {
      console.log("❌ [Flights] Unauthorized access attempt");
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = c.req.valid("json");
    console.log(`✈️ [Flights] Creating flight for user: ${user.id}`);

    // Ensure user exists in local database (Supabase auth migration)
    await ensureUserExists(user, "Flights");

    // Get user profile for hourly rate
    let profile = await db.profile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      profile = await db.profile.create({
        data: { userId: user.id },
      });
    }

    // Calculate pay components
    const hourlyRateCents = profile.hourlyRateCents;
    const basePaoCents = Math.round((body.creditMinutes / 60) * hourlyRateCents);
    const overageMinutes = Math.max(0, body.blockMinutes - body.creditMinutes);
    const overagePaoCents = Math.round((overageMinutes / 60) * hourlyRateCents);
    const totalPayCents = basePaoCents + overagePaoCents;

    const flight = await db.flightEntry.create({
      data: {
        userId: user.id,
        dateISO: body.dateISO,
        airline: body.airline ?? "UPS",
        flightNumber: body.flightNumber ?? null,
        origin: body.origin ?? null,
        destination: body.destination ?? null,
        blockMinutes: body.blockMinutes,
        creditMinutes: body.creditMinutes,
        hourlyRateCentsAtEntry: hourlyRateCents,
        basePaoCents,
        overageMinutes,
        overagePaoCents,
        totalPayCents,
        notes: body.notes ?? null,
      },
    });

    console.log(`✅ [Flights] Created flight: ${flight.id}`);

    const response: CreateFlightResponse = {
      success: true,
      flight: formatFlightEntry(flight),
    };

    return c.json(response);
  }
);

// ============================================
// DELETE /api/flights/:id - Delete flight entry
// ============================================
flightsRouter.delete("/:id", async (c) => {
  const user = c.get("user");

  if (!user) {
    console.log("❌ [Flights] Unauthorized access attempt");
    return c.json({ error: "Unauthorized" }, 401);
  }

  const flightId = c.req.param("id");
  console.log(`🗑️ [Flights] Deleting flight: ${flightId} for user: ${user.id}`);

  // Verify ownership
  const flight = await db.flightEntry.findFirst({
    where: { id: flightId, userId: user.id },
  });

  if (!flight) {
    return c.json({ error: "Flight not found" }, 404);
  }

  await db.flightEntry.delete({
    where: { id: flightId },
  });

  console.log(`✅ [Flights] Deleted flight: ${flightId}`);

  const response: DeleteFlightResponse = { success: true };
  return c.json(response);
});

export { flightsRouter };
