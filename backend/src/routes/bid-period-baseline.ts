/**
 * Bid Period Baseline Route
 *
 * Manages the originally-awarded line credit for each UPS bid period.
 * This baseline is the foundation for correct pay logic:
 *   - Determines whether guarantee applies
 *   - Classifies pickups as "filling guarantee gap" vs "truly extra paid"
 *   - Determines whether dropped trips reduced actual paid credit
 *   - Powers "Why This Amount?" explanations
 */

import { Hono } from "hono";
import { type AppType } from "../types";
import { db } from "../db";
import { ensureUserExists } from "../utils/ensureUser";
import { getPayPeriodForDate } from "../lib/constants";
import {
  upsertBidPeriodBaselineRequestSchema,
  type GetBidPeriodBaselineResponse,
  type UpsertBidPeriodBaselineResponse,
  type DeleteBidPeriodBaselineResponse,
} from "@/shared/contracts";

const bidPeriodBaselineRouter = new Hono<AppType>();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build the period key string, e.g. "2026-P04" */
function buildPeriodKey(year: number, periodNumber: number): string {
  return `${year}-P${String(periodNumber).padStart(2, "0")}`;
}

/** Resolve the current period key + date range from today's date. */
function getCurrentPeriodInfo(): {
  periodKey: string;
  periodStartISO: string;
  periodEndISO: string;
} {
  const today = new Date().toISOString().split("T")[0] ?? "";
  const period = getPayPeriodForDate(today);

  if (period) {
    return {
      periodKey: buildPeriodKey(period.year, period.periodNumber),
      periodStartISO: period.startDate,
      periodEndISO: period.endDate,
    };
  }

  // Fallback: bi-monthly split
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const fmt = (d: Date) => d.toISOString().split("T")[0] ?? "";

  if (day <= 15) {
    return {
      periodKey: `${year}-M${String(month + 1).padStart(2, "0")}-A`,
      periodStartISO: fmt(new Date(year, month, 1)),
      periodEndISO: fmt(new Date(year, month, 15)),
    };
  }
  return {
    periodKey: `${year}-M${String(month + 1).padStart(2, "0")}-B`,
    periodStartISO: fmt(new Date(year, month, 16)),
    periodEndISO: fmt(new Date(year, month + 1, 0)),
  };
}

/** Resolve period key + dates from a query param, or fall back to current. */
function resolvePeriod(periodKeyParam?: string): {
  periodKey: string;
  periodStartISO: string;
  periodEndISO: string;
} {
  if (!periodKeyParam) return getCurrentPeriodInfo();

  // Try to look up by key from the UPS calendar.
  // Key format: "2026-P04" → year=2026, period=4
  const match = periodKeyParam.match(/^(\d{4})-P(\d{1,2})$/);
  if (match) {
    const year = parseInt(match[1]!);
    const periodNum = parseInt(match[2]!);
    // Find period info from constants
    const { getPayPeriodForDate: _unused, ...rest } = { getPayPeriodForDate };
    void rest;
    // Find from PAY_PERIODS_2026 by year+periodNumber
    try {
      const { PAY_PERIODS_2026 } = require("../lib/constants") as {
        PAY_PERIODS_2026: Array<{ year: number; periodNumber: number; startDate: string; endDate: string }>;
      };
      const found = PAY_PERIODS_2026.find(
        (p) => p.year === year && p.periodNumber === periodNum
      );
      if (found) {
        return {
          periodKey: periodKeyParam,
          periodStartISO: found.startDate,
          periodEndISO: found.endDate,
        };
      }
    } catch {
      // ignore
    }
  }

  // Fallback: use current period
  return getCurrentPeriodInfo();
}

const GUARANTEE_BY_PERIOD: Record<string, number> = {
  "28_DAY": 75 * 60,
  "28-DAY": 75 * 60,
  "35_DAY": 96 * 60,
  "35-DAY": 96 * 60,
  BID_56: 75 * 60,
};

// ─── GET /api/bid-period-baseline ───────────────────────────────────────────
// Returns the baseline for the given period (or current period if not specified).

bidPeriodBaselineRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  await ensureUserExists(user, "BidPeriodBaseline");

  const periodKeyParam = c.req.query("periodKey");
  const { periodKey, periodStartISO, periodEndISO } = resolvePeriod(periodKeyParam);

  // Fetch existing baseline
  const baseline = await db.bidPeriodBaseline.findUnique({
    where: { userId_periodKey: { userId: user.id, periodKey } },
  });

  // Count active trips in this period to determine "blank month" state
  const tripCount = await db.trip.count({
    where: {
      userId: user.id,
      status: { notIn: ["cancelled", "override"] },
      OR: [
        { startDate: { gte: periodStartISO, lte: periodEndISO } },
        { endDate: { gte: periodStartISO, lte: periodEndISO } },
      ],
    },
  });

  // Get profile for guarantee
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    select: { creditCapPeriodType: true },
  });
  const rawPeriodType = ((profile?.creditCapPeriodType ?? "28_DAY")).toUpperCase().replace(/-/g, "_");
  const guaranteeMinutes = GUARANTEE_BY_PERIOD[rawPeriodType] ?? 75 * 60;

  // Sum current active credit for context
  const trips = await db.trip.findMany({
    where: {
      userId: user.id,
      status: { notIn: ["cancelled", "override", "dropped", "company_removed"] },
      OR: [
        { startDate: { gte: periodStartISO, lte: periodEndISO } },
        { endDate: { gte: periodStartISO, lte: periodEndISO } },
      ],
    },
    select: { payCreditMinutes: true, totalCreditMinutes: true },
  });
  const currentCreditMinutes = trips.reduce(
    (sum, t) => sum + (t.payCreditMinutes || t.totalCreditMinutes || 0),
    0
  );

  const response: GetBidPeriodBaselineResponse = {
    baseline: baseline
      ? {
          id: baseline.id,
          periodKey: baseline.periodKey,
          periodStartISO: baseline.periodStartISO,
          periodEndISO: baseline.periodEndISO,
          awardedCreditMinutes: baseline.awardedCreditMinutes,
          source: baseline.source as "uploaded_award" | "manual_entry" | "estimated",
          sourceNote: baseline.sourceNote,
          uploadId: baseline.uploadId,
          confidence: baseline.confidence as "high" | "medium" | "low",
          createdAt: baseline.createdAt.toISOString(),
          updatedAt: baseline.updatedAt.toISOString(),
        }
      : null,
    periodKey,
    periodStartISO,
    periodEndISO,
    hasImportedTrips: tripCount > 0,
    currentCreditMinutes,
    guaranteeMinutes,
  };

  return c.json(response);
});

// ─── PUT /api/bid-period-baseline ───────────────────────────────────────────
// Create or update the awarded credit baseline for a period.

bidPeriodBaselineRouter.put("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  await ensureUserExists(user, "BidPeriodBaseline");

  const body = await c.req.json();
  const parseResult = upsertBidPeriodBaselineRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request", details: parseResult.error.flatten() }, 400);
  }

  const { periodKey, awardedCreditHours, source, sourceNote, uploadId, confidence } = parseResult.data;
  const awardedCreditMinutes = Math.round(awardedCreditHours * 60);

  // Resolve period dates from the period key
  const { periodStartISO, periodEndISO } = resolvePeriod(periodKey);

  const baseline = await db.bidPeriodBaseline.upsert({
    where: { userId_periodKey: { userId: user.id, periodKey } },
    create: {
      userId: user.id,
      periodKey,
      periodStartISO,
      periodEndISO,
      awardedCreditMinutes,
      source,
      sourceNote: sourceNote ?? null,
      uploadId: uploadId ?? null,
      confidence: confidence ?? "medium",
    },
    update: {
      awardedCreditMinutes,
      source,
      sourceNote: sourceNote ?? null,
      uploadId: uploadId ?? null,
      confidence: confidence ?? "medium",
      updatedAt: new Date(),
    },
  });

  const response: UpsertBidPeriodBaselineResponse = {
    success: true,
    baseline: {
      id: baseline.id,
      periodKey: baseline.periodKey,
      periodStartISO: baseline.periodStartISO,
      periodEndISO: baseline.periodEndISO,
      awardedCreditMinutes: baseline.awardedCreditMinutes,
      source: baseline.source as "uploaded_award" | "manual_entry" | "estimated",
      sourceNote: baseline.sourceNote,
      uploadId: baseline.uploadId,
      confidence: baseline.confidence as "high" | "medium" | "low",
      createdAt: baseline.createdAt.toISOString(),
      updatedAt: baseline.updatedAt.toISOString(),
    },
  };

  return c.json(response);
});

// ─── DELETE /api/bid-period-baseline/:periodKey ──────────────────────────────
// Remove the baseline for a specific period (so user can re-enter).

bidPeriodBaselineRouter.delete("/:periodKey", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  await ensureUserExists(user, "BidPeriodBaseline");

  const periodKey = c.req.param("periodKey");

  const existing = await db.bidPeriodBaseline.findUnique({
    where: { userId_periodKey: { userId: user.id, periodKey } },
  });

  if (!existing) {
    return c.json({ error: "Baseline not found" }, 404);
  }

  await db.bidPeriodBaseline.delete({
    where: { userId_periodKey: { userId: user.id, periodKey } },
  });

  const response: DeleteBidPeriodBaselineResponse = { success: true };
  return c.json(response);
});

export { bidPeriodBaselineRouter };
