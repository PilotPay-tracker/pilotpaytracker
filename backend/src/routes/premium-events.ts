/**
 * Premium Events Routes
 *
 * API endpoints for Phase 5: Premium Pay Detection + Log Event Drafting
 *
 * Key principle: System SUGGESTS, user DECIDES
 * - Never auto-claim premium pay
 * - Always require explicit user action
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import {
  getPremiumCandidatesForTrip,
  getAllPremiumCandidatesForUser,
  createLogEventDraft,
  getDraftLogEvents,
  submitLogEvent,
  dismissLogEvent,
  getEvidenceForChange,
  linkEvidenceToEvent,
} from "../lib/premium-event-engine";

const premiumEventsRouter = new Hono<AppType>();

// ============================================
// GET /api/premium-events/candidates
// Get all premium candidates for user (dashboard view)
// ============================================
premiumEventsRouter.get("/candidates", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const candidates = await getAllPremiumCandidatesForUser(user.id);
    return c.json({
      success: true,
      data: candidates,
      totalCandidates: candidates.reduce((sum, t) => sum + t.candidates.length, 0),
    });
  } catch (error) {
    console.error("[PremiumEvents] Error getting candidates:", error);
    return c.json({ error: "Failed to get premium candidates" }, 500);
  }
});

// ============================================
// GET /api/premium-events/trips/:tripId/candidates
// Get premium candidates for a specific trip
// ============================================
premiumEventsRouter.get("/trips/:tripId/candidates", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tripId } = c.req.param();

  try {
    const candidates = await getPremiumCandidatesForTrip(tripId);
    return c.json({
      success: true,
      data: candidates,
    });
  } catch (error) {
    console.error("[PremiumEvents] Error getting trip candidates:", error);
    return c.json({ error: "Failed to get premium candidates" }, 500);
  }
});

// ============================================
// POST /api/premium-events/draft
// Create a draft Log Event from a premium candidate
// ============================================
const createDraftSchema = z.object({
  tripId: z.string(),
  rosterChangeId: z.string(),
});

premiumEventsRouter.post(
  "/draft",
  zValidator("json", createDraftSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { tripId, rosterChangeId } = c.req.valid("json");

    try {
      // Get the candidate from the roster change
      const candidates = await getPremiumCandidatesForTrip(tripId);
      const candidate = candidates.find((c) => c.rosterChangeId === rosterChangeId);

      if (!candidate) {
        return c.json({ error: "Premium candidate not found" }, 404);
      }

      const result = await createLogEventDraft(user.id, tripId, candidate);
      return c.json({
        success: true,
        draftId: result.draftId,
        message: "Draft Log Event created. Review and submit when ready.",
      });
    } catch (error) {
      console.error("[PremiumEvents] Error creating draft:", error);
      return c.json({ error: "Failed to create draft" }, 500);
    }
  }
);

// ============================================
// GET /api/premium-events/drafts
// Get all draft Log Events for user
// ============================================
premiumEventsRouter.get("/drafts", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const drafts = await getDraftLogEvents(user.id);
    return c.json({
      success: true,
      data: drafts,
    });
  } catch (error) {
    console.error("[PremiumEvents] Error getting drafts:", error);
    return c.json({ error: "Failed to get drafts" }, 500);
  }
});

// ============================================
// POST /api/premium-events/drafts/:draftId/submit
// Submit a draft Log Event (user claims premium)
// ============================================
const submitDraftSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  creditDifferenceMinutes: z.number().optional(),
});

premiumEventsRouter.post(
  "/drafts/:draftId/submit",
  zValidator("json", submitDraftSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { draftId } = c.req.param();
    const updates = c.req.valid("json");

    try {
      const result = await submitLogEvent(draftId, user.id, updates);
      return c.json({
        success: true,
        eventId: result.eventId,
        message: "Log Event submitted successfully.",
      });
    } catch (error) {
      console.error("[PremiumEvents] Error submitting draft:", error);
      const message = error instanceof Error ? error.message : "Failed to submit";
      return c.json({ error: message }, 400);
    }
  }
);

// ============================================
// POST /api/premium-events/drafts/:draftId/dismiss
// Dismiss a draft Log Event (user declines to claim)
// ============================================
const dismissDraftSchema = z.object({
  reason: z.string().optional(),
});

premiumEventsRouter.post(
  "/drafts/:draftId/dismiss",
  zValidator("json", dismissDraftSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { draftId } = c.req.param();
    const { reason } = c.req.valid("json");

    try {
      await dismissLogEvent(draftId, user.id, reason);
      return c.json({
        success: true,
        message: "Draft dismissed.",
      });
    } catch (error) {
      console.error("[PremiumEvents] Error dismissing draft:", error);
      const message = error instanceof Error ? error.message : "Failed to dismiss";
      return c.json({ error: message }, 400);
    }
  }
);

// ============================================
// GET /api/premium-events/changes/:changeId/evidence
// Get evidence supporting a roster change
// ============================================
premiumEventsRouter.get("/changes/:changeId/evidence", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { changeId } = c.req.param();

  try {
    const evidence = await getEvidenceForChange(changeId);
    return c.json({
      success: true,
      data: evidence,
    });
  } catch (error) {
    console.error("[PremiumEvents] Error getting evidence:", error);
    return c.json({ error: "Failed to get evidence" }, 500);
  }
});

// ============================================
// POST /api/premium-events/drafts/:draftId/evidence
// Link evidence to a draft Log Event
// ============================================
const linkEvidenceSchema = z.object({
  evidenceIds: z.array(z.string()),
});

premiumEventsRouter.post(
  "/drafts/:draftId/evidence",
  zValidator("json", linkEvidenceSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { draftId } = c.req.param();
    const { evidenceIds } = c.req.valid("json");

    try {
      await linkEvidenceToEvent(draftId, evidenceIds);
      return c.json({
        success: true,
        message: "Evidence linked to draft.",
      });
    } catch (error) {
      console.error("[PremiumEvents] Error linking evidence:", error);
      return c.json({ error: "Failed to link evidence" }, 500);
    }
  }
);

export { premiumEventsRouter };
