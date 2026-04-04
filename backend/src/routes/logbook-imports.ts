/**
 * Logbook Imports API
 *
 * Manages prior logbook hours entered by the user before app tracking.
 * These represent time from physical/digital logbooks from previous airlines,
 * flight training, etc. that the app then adds on top of with live tracking.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";
import { ensureUserExists } from "../utils/ensureUser";

const logbookImportsRouter = new Hono<AppType>();

// ─── Validation Schemas ────────────────────────────────────────────────────

const createLogbookImportSchema = z.object({
  label: z.string().min(1).max(100),
  totalBlockMinutes: z.number().int().min(0),
  totalFlightMinutes: z.number().int().min(0),
  totalFlights: z.number().int().min(0),
  notes: z.string().optional(),
  startDateISO: z.string().optional(),
  endDateISO: z.string().optional(),
});

const updateLogbookImportSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  totalBlockMinutes: z.number().int().min(0).optional(),
  totalFlightMinutes: z.number().int().min(0).optional(),
  totalFlights: z.number().int().min(0).optional(),
  notes: z.string().nullable().optional(),
  startDateISO: z.string().nullable().optional(),
  endDateISO: z.string().nullable().optional(),
});

// ─── GET /api/logbook-imports ──────────────────────────────────────────────

logbookImportsRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const imports = await db.logbookImport.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  // Compute totals across all imports
  const totalBlockMinutes = imports.reduce((s, i) => s + i.totalBlockMinutes, 0);
  const totalFlightMinutes = imports.reduce((s, i) => s + i.totalFlightMinutes, 0);
  const totalFlights = imports.reduce((s, i) => s + i.totalFlights, 0);

  return c.json({
    imports,
    totals: { totalBlockMinutes, totalFlightMinutes, totalFlights },
  });
});

// ─── POST /api/logbook-imports ─────────────────────────────────────────────

logbookImportsRouter.post(
  "/",
  zValidator("json", createLogbookImportSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    await ensureUserExists(user, "LogbookImports");
    const body = c.req.valid("json");

    const record = await db.logbookImport.create({
      data: {
        userId: user.id,
        label: body.label,
        totalBlockMinutes: body.totalBlockMinutes,
        totalFlightMinutes: body.totalFlightMinutes,
        totalFlights: body.totalFlights,
        notes: body.notes ?? null,
        startDateISO: body.startDateISO ?? null,
        endDateISO: body.endDateISO ?? null,
      },
    });

    console.log(`📓 [LogbookImports] Created import: ${record.id} for user: ${user.id}`);
    return c.json({ success: true, import: record });
  }
);

// ─── PUT /api/logbook-imports/:id ─────────────────────────────────────────

logbookImportsRouter.put(
  "/:id",
  zValidator("json", updateLogbookImportSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const existing = await db.logbookImport.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) return c.json({ error: "Not found" }, 404);

    const body = c.req.valid("json");
    const updated = await db.logbookImport.update({
      where: { id },
      data: {
        ...(body.label !== undefined && { label: body.label }),
        ...(body.totalBlockMinutes !== undefined && { totalBlockMinutes: body.totalBlockMinutes }),
        ...(body.totalFlightMinutes !== undefined && { totalFlightMinutes: body.totalFlightMinutes }),
        ...(body.totalFlights !== undefined && { totalFlights: body.totalFlights }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.startDateISO !== undefined && { startDateISO: body.startDateISO }),
        ...(body.endDateISO !== undefined && { endDateISO: body.endDateISO }),
      },
    });

    console.log(`✏️ [LogbookImports] Updated import: ${id}`);
    return c.json({ success: true, import: updated });
  }
);

// ─── DELETE /api/logbook-imports/:id ──────────────────────────────────────

logbookImportsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const existing = await db.logbookImport.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  await db.logbookImport.delete({ where: { id } });
  console.log(`🗑️ [LogbookImports] Deleted import: ${id}`);
  return c.json({ success: true });
});

export { logbookImportsRouter };
