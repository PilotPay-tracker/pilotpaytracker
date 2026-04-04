/**
 * Hotel Directory Routes
 *
 * Manages user's learned hotel directory (per-airline + per-station)
 * Supports:
 * - Viewing hotels for stations
 * - Confirming/rejecting hotel suggestions
 * - Auto-populating from directory
 * - Opt-in sharing across same-airline users
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";
import {
  lookupHotelFromDirectory,
  confirmHotelInDirectory,
  rejectHotelInDirectory,
} from "../lib/canonical-import-pipeline";

const hotelDirectoryRouter = new Hono<AppType>();

// ============================================
// Validation Schemas
// ============================================

const lookupHotelSchema = z.object({
  station: z.string().length(3),
  baseCode: z.string().optional(),
  equipmentCode: z.string().optional(),
});

const confirmHotelSchema = z.object({
  station: z.string().length(3),
  hotelName: z.string().min(1),
  hotelPhone: z.string().optional(),
  hotelAddress: z.string().optional(),
  baseCode: z.string().optional(),
  equipmentCode: z.string().optional(),
  isShared: z.boolean().optional(),
});

const rejectHotelSchema = z.object({
  station: z.string().length(3),
  hotelName: z.string().min(1),
});

const updateLayoverHotelSchema = z.object({
  hotelName: z.string().min(1),
  hotelPhone: z.string().optional(),
  hotelAddress: z.string().optional(),
  hotelStatus: z.string().optional(),
  action: z.enum(["confirm", "edit", "reject"]),
});

// ============================================
// GET /api/hotel-directory - List user's hotels
// ============================================
hotelDirectoryRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Get user's airline from profile
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  const airlineCode = profile?.airline ?? "UPS";

  const hotels = await db.userHotelDirectory.findMany({
    where: {
      userId: user.id,
      airlineCode,
    },
    orderBy: [
      { station: "asc" },
      { confirmCount: "desc" },
    ],
  });

  // Group by station
  const byStation: Record<string, typeof hotels> = {};
  for (const hotel of hotels) {
    if (!byStation[hotel.station]) {
      byStation[hotel.station] = [];
    }
    byStation[hotel.station]!.push(hotel);
  }

  return c.json({
    airlineCode,
    stationCount: Object.keys(byStation).length,
    hotelCount: hotels.length,
    byStation,
  });
});

// ============================================
// GET /api/hotel-directory/lookup - Lookup hotel for station
// ============================================
hotelDirectoryRouter.get("/lookup", zValidator("query", lookupHotelSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { station, baseCode, equipmentCode } = c.req.valid("query");

  // Get user's airline from profile
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  const airlineCode = profile?.airline ?? "UPS";

  const result = await lookupHotelFromDirectory(
    user.id,
    airlineCode,
    station,
    baseCode,
    equipmentCode
  );

  if (!result) {
    return c.json({
      found: false,
      station,
      message: "No hotel found for this station",
    });
  }

  return c.json({
    found: true,
    station,
    hotel: result,
  });
});

// ============================================
// POST /api/hotel-directory/confirm - Confirm hotel for station
// ============================================
hotelDirectoryRouter.post("/confirm", zValidator("json", confirmHotelSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");

  // Get user's airline from profile
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  const airlineCode = profile?.airline ?? "UPS";

  await confirmHotelInDirectory(
    user.id,
    airlineCode,
    body.station,
    body.hotelName,
    body.hotelPhone,
    body.hotelAddress,
    body.baseCode,
    body.equipmentCode,
    body.isShared ?? false
  );

  return c.json({
    success: true,
    message: `Hotel "${body.hotelName}" confirmed for ${body.station}`,
  });
});

// ============================================
// POST /api/hotel-directory/reject - Reject hotel for station
// ============================================
hotelDirectoryRouter.post("/reject", zValidator("json", rejectHotelSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = c.req.valid("json");

  // Get user's airline from profile
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  const airlineCode = profile?.airline ?? "UPS";

  await rejectHotelInDirectory(
    user.id,
    airlineCode,
    body.station,
    body.hotelName
  );

  return c.json({
    success: true,
    message: `Hotel "${body.hotelName}" rejected for ${body.station}`,
  });
});

// ============================================
// PUT /api/hotel-directory/layover/:id - Update layover hotel
// ============================================
hotelDirectoryRouter.put(
  "/layover/:id",
  zValidator("json", updateLayoverHotelSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const layoverId = c.req.param("id");
    const body = c.req.valid("json");

    // Verify ownership through trip
    const layover = await db.tripLayover.findUnique({
      where: { id: layoverId },
      include: {
        tripDutyDay: {
          include: {
            trip: true,
          },
        },
      },
    });

    if (!layover || layover.tripDutyDay.trip.userId !== user.id) {
      return c.json({ error: "Layover not found" }, 404);
    }

    // Get user's airline from profile
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    });

    const airlineCode = profile?.airline ?? "UPS";

    // Handle action
    if (body.action === "confirm" || body.action === "edit") {
      // Update layover
      await db.tripLayover.update({
        where: { id: layoverId },
        data: {
          hotelName: body.hotelName,
          hotelPhone: body.hotelPhone ?? null,
          hotelAddress: body.hotelAddress ?? null,
          hotelStatus: body.hotelStatus ?? null,
          hotelSource: body.action === "confirm" ? "directory" : "manual",
          hotelConfidence: 1.0, // User confirmed
        },
      });

      // Update directory
      await confirmHotelInDirectory(
        user.id,
        airlineCode,
        layover.station,
        body.hotelName,
        body.hotelPhone,
        body.hotelAddress,
        layover.tripDutyDay.trip.baseFleet?.split(" ")[0],
        layover.tripDutyDay.trip.baseFleet?.split(" ")[1],
        false
      );

      return c.json({
        success: true,
        action: body.action,
        message: `Hotel "${body.hotelName}" ${body.action}ed for ${layover.station}`,
      });
    } else if (body.action === "reject") {
      // Clear hotel from layover
      await db.tripLayover.update({
        where: { id: layoverId },
        data: {
          hotelName: null,
          hotelPhone: null,
          hotelAddress: null,
          hotelStatus: null,
          hotelSource: null,
          hotelConfidence: 0,
        },
      });

      // Record rejection in directory
      await rejectHotelInDirectory(
        user.id,
        airlineCode,
        layover.station,
        body.hotelName
      );

      return c.json({
        success: true,
        action: "reject",
        message: `Hotel "${body.hotelName}" rejected for ${layover.station}`,
      });
    }

    return c.json({ error: "Invalid action" }, 400);
  }
);

// ============================================
// GET /api/hotel-directory/stations - List all stations with hotels
// ============================================
hotelDirectoryRouter.get("/stations", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Get user's airline from profile
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  const airlineCode = profile?.airline ?? "UPS";

  // Get unique stations from user's directory
  const userStations = await db.userHotelDirectory.findMany({
    where: {
      userId: user.id,
      airlineCode,
    },
    select: {
      station: true,
    },
    distinct: ["station"],
  });

  // Get stats per station
  const stations: Array<{
    station: string;
    hotelCount: number;
    topHotel?: string;
    lastUsed: Date;
  }> = [];

  for (const { station } of userStations) {
    const hotels = await db.userHotelDirectory.findMany({
      where: {
        userId: user.id,
        airlineCode,
        station,
      },
      orderBy: { confirmCount: "desc" },
      take: 1,
    });

    const topHotel = hotels[0];
    if (topHotel) {
      stations.push({
        station,
        hotelCount: await db.userHotelDirectory.count({
          where: { userId: user.id, airlineCode, station },
        }),
        topHotel: topHotel.hotelName,
        lastUsed: topHotel.lastSeenAt,
      });
    }
  }

  // Sort by station code
  stations.sort((a, b) => a.station.localeCompare(b.station));

  return c.json({
    airlineCode,
    stations,
  });
});

// ============================================
// DELETE /api/hotel-directory/:id - Delete hotel entry
// ============================================
hotelDirectoryRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const hotelId = c.req.param("id");

  const hotel = await db.userHotelDirectory.findUnique({
    where: { id: hotelId },
  });

  if (!hotel || hotel.userId !== user.id) {
    return c.json({ error: "Hotel not found" }, 404);
  }

  await db.userHotelDirectory.delete({
    where: { id: hotelId },
  });

  return c.json({
    success: true,
    message: `Hotel "${hotel.hotelName}" removed from directory`,
  });
});

export { hotelDirectoryRouter };
